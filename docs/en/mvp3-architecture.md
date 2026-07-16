# MVP-3 Architecture — Team Control Plane

> Status: **MVP-3 (planned)**. This document is the locked architecture for the
> hosted, multi-user control plane. It extends — but never modifies — the
> zero-dependency core SDK.

The MVP-3 goal is to turn the local read-only dashboard into a **multi-user
hosted control plane**: a team logs in, and each member sees the routing
decisions of the projects they can access. New standard cloud components
(Postgres, auth, OAuth) are allowed — but **only in a new control-plane layer**.
The core SDK's zero-dependency rule does not change.

## Summary

1. **Extend, do not rewrite.** The existing dashboard already exposes a clean
   `DashboardDataSource` abstraction behind a `{code,data,message}` envelope. The
   control plane wraps and reuses it — the SDK and the local dashboard need no
   logic changes.
2. **Choices honor the zero-dependency spirit.** Auth = **Better-Auth**
   (MIT, framework-agnostic, standalone Node HTTP handler, organization +
   magic-link plugins). Persistence = **Postgres + postgres.js** (0 dependencies,
   ~1250 LOC, TS-native). Deploy = **docker-compose** (clone-and-run) +
   **Render blueprint** (no credit card, free Postgres, one-click hosting).
3. **The boundary is enforced by machine.** Core SDK = zero runtime dependencies,
   asserted in CI. All new dependencies are physically isolated in the new
   control-plane package.

## Packages

- `@adaptive-router/sdk` — routing brain. **`dependencies: {}` — unchanged.**
- `@adaptive-router/dashboard` — local read-only dashboard. Unchanged.
- `@adaptive-router/cli` — developer helper commands. Unchanged.
- `@adaptive-router/control-plane` — **new.** Hosted, multi-user layer. The only
  package allowed to declare standard cloud dependencies.

## Layered architecture

```text
┌──────────────────────────────────────────────────────────────┐
│  Browser (team members)                                        │
│  Login  →  Project selector  →  routing decisions per project  │
└───────────────┬────────────────────────────────────────────────┘
                │ HTTPS + session cookie
┌───────────────▼────────────────────────────────────────────────┐
│  @adaptive-router/control-plane  (new; cloud components allowed) │
│  ┌────────────┐ ┌──────────────────┐ ┌──────────────────────┐  │
│  │ Auth       │ │ Multi-tenant      │ │ Reused dashboard      │  │
│  │ Better-Auth│ │ gateway:          │ │ render + /api/*       │  │
│  │ org + magic│ │ project scoping   │ │ (called as-is)        │  │
│  └─────┬──────┘ └────────┬──────────┘ └──────────┬───────────┘  │
│        │                 │                        │              │
│  ┌─────▼─────────────────▼────────────────────────▼──────────┐  │
│  │ PgDataAccess: implements the SDK DashboardDataSource       │  │
│  │ contract (listTraces / listModels / store), filtered by    │  │
│  │ project_id                                                 │  │
│  └───────────────────────────┬─────────────────────────────┘  │
│  ┌───────────────────────────▼─────────────────────────────┐  │
│  │ Ingest endpoint: SDK POSTs traces here (P0 data path)     │  │
│  └───────────────────────────┬─────────────────────────────┘  │
└──────────────────────────────┼───────────────────────────────────┘
                               │ postgres.js (0-dep)
                     ┌─────────▼──────────┐
                     │  Postgres          │
                     │  orgs / users /    │
                     │  projects / traces │
                     └────────────────────┘

═══════ Dependency boundary (hard rule, machine-enforced) ═══════
┌───────────────────────────────────────────────────────────────┐
│  @adaptive-router/sdk    dependencies: {}    ← not one byte     │
│  Imported by control-plane as a pure library; never depends back│
└───────────────────────────────────────────────────────────────┘
```

**Key insight (from reading the code):**
`createReadOnlyDataAccess(source: DashboardDataSource)` already abstracts *where
the data comes from*. `DashboardDataSource = { listTraces(), listModels?(),
store?: Mvp2StoreExtension }`. The control plane only needs a **PgDataAccess that
filters by `project_id`**, fed into the existing `createReadOnlyDataAccess`. The
12 `/api/*` endpoints and the HTML render layer become multi-tenant with **zero
changes**. This is why the change surface is small.

## Locked decisions (MVP-3 rulings)

### Ruling 1 — Organization hierarchy: two-level **Organization → Project**

MVP-3 **adopts the two-level `Organization → Project` model** as a locked
decision. An Organization owns Projects; a member's access is scoped through
Organization membership down to its Projects. Terminology is standardized to
**Organization** and **Project** everywhere (docs, schema, UI). This is the
agreed convergence — no single-level flattening.

### Ruling 2 — Roles: only **owner / member** are enforced in MVP-3

The `memberships.role` column is retained, but:

- **(a)** MVP-3 implements permission logic for **only two tiers: `owner` and
  `member`.** `owner` can manage the Organization and its Projects (create
  projects, issue/revoke ingest tokens, invite members); `member` has read
  access to the Projects they belong to.
- **(b)** The `role` column *can* physically store more values, but
  **fine-grained RBAC (differentiated Admin / Viewer permissions) is deferred to
  MVP-4+.** No differentiated-permission judgment is implemented this milestone.
  This holds the RBAC-deferral discipline.

### Ruling 3 — SDK reporting path (`ingest_tokens` + trace POST) is a **P0 data path**

For "multiple people see the same data" to hold, traces produced by an embedded
SDK must reach the control plane. This is the **P0 data path for MVP-3** and is
detailed in [SDK reporting path](#sdk-reporting-path-p0) below.

## Technology selection matrices

### Auth (team login)

| Candidate | Easy start | Org/scale | License | Self-host | Dep pollution | Score |
|-----------|-----------|-----------|---------|-----------|---------------|-------|
| **Better-Auth** ✅ | High (magic-link + OAuth plugins) | High (org plugin = teams/invites/roles, maps to project scoping) | MIT | Full | Isolated in new pkg | **9/10** |
| Auth.js (next-auth) | Med (historically Next.js-centric) | Med (no native org) | ISC | Full | Isolated in new pkg | 6/10 |
| Lucia v3 | Low (hand-rolled) | Manual | — | Full | **Deprecated in 2026** | **rejected** |
| Hand-rolled user/pass + session | Med | Hand-rolled | — | Full | None | 5/10 |

**Decision: Better-Auth.** It ships a standalone Node HTTP handler that coexists
with the current `node:http` dashboard (no forced web framework); its
`organization` plugin maps naturally onto Org → Project scoping and leaves a
clean upgrade path for deferred RBAC. Start with **magic-link + GitHub OAuth**
(developer audience), with password login as an offline self-host fallback.
Lucia is hard-excluded (deprecated).

### Persistence

| Candidate | Multi-tenant isolation | Concurrent writes | Hosting | Dep cost | Score |
|-----------|------------------------|-------------------|---------|----------|-------|
| **Postgres + postgres.js** ✅ | Strong (row-level project_id) | Strong | Excellent | **0 deps** | **9/10** |
| Keep SQLite/JSONL | Weak (single file, poor concurrency, no multi-instance sharing) | Weak | Poor (loss on restart) | 0 | 4/10 |
| Postgres + Prisma | Strong | Strong | Good | **Heavy** (engine binary) | 6/10 |
| Postgres + pg | Strong | Strong | Good | Has deps but mature | 7/10 |

**Decision: Postgres + postgres.js.** JSONL/SQLite are enough for local single
user but insufficient for hosted multi-user (single-file concurrency, stateless
container restarts lose data, no multi-instance sharing). postgres.js is chosen
over pg/Prisma because it is **0-dependency, ~1250 LOC, TS-native, with built-in
pooling** — even in a layer that allows cloud components, we pick the lightest to
echo the project's ethos. **No ORM** (a Prisma engine binary is over-design);
migrations are hand-written SQL files plus a version table.

> Compatibility: the SDK's `createSQLiteTraceStore` / `createJsonlTraceStore` and
> the `Mvp2StoreExtension` contract stay unchanged. The control plane adds a
> `createPostgresTraceStore` implementing the same contract — local users keep
> zero-dependency SQLite, hosted users use Postgres. One store interface.

### Hosting form and deploy templates

| Candidate | Clone-and-run | One-click host | Free tier (w/ Postgres) | Cold start | Credit card | Score |
|-----------|--------------|----------------|-------------------------|------------|-------------|-------|
| **docker-compose** ✅ | Excellent (`docker compose up`) | — | — | — | No | **9/10** (self-host) |
| **Render blueprint** ✅ | — | Excellent (auto Postgres) | Free PG 1GB / 30d | 30–60s | **No** | **9/10** (hosted) |
| Railway template | — | Excellent (Nixpacks) | $5 first month, then $1/mo | None | Card after trial | 7/10 |
| Fly.io | — | Good | Yes | 5–10s (fastest) | **Yes** | 6/10 |

**Decision: docker-compose + Render blueprint.** `docker-compose.yml`
(control-plane + `postgres:17`) covers clone-and-run and full self-hosting;
`render.yaml` covers one-click hosting and is the only **no-credit-card + free
Postgres** option — the lowest barrier for an open-source audience. Railway/Fly
are mentioned as "other platforms" links in the README, not primary maintenance
targets.

## Control-plane / SDK boundary contract

**Direction: `control-plane → sdk` only (never back).** The control plane reuses
the SDK through existing public contracts and adds no SDK surface area:

| SDK export (existing) | How the control plane uses it |
|-----------------------|-------------------------------|
| `DashboardDataSource` / `createReadOnlyDataAccess` | Implement a PG-backed `listTraces / listModels / store`, filtered by project, fed in |
| `Mvp2StoreExtension` / `ExtendedTraceStore` | Add `createPostgresTraceStore` implementing the same store contract |
| `RouterTrace` / `StoredRequest` / `ModelProfile` types | DB-row ↔ API mapping targets; keeps the envelope consistent |
| `renderDashboardHtml` and the 12 `/api/*` endpoints | Reused as-is; only wrapped with an auth middleware + project scope injection |

**Boundary rules:**

- The control plane may only `import` public SDK exports; deep-linking into
  `sdk/src/**` is forbidden (enforceable via eslint `no-restricted-imports`).
- All multi-tenant / auth / Postgres logic stays in the control-plane package and
  **never sinks into the SDK.**
- Any new SDK capability needed by the control plane must be **optional,
  zero-dependency, and side-effect-free for the local single-machine path**
  (the MVP-2 append-only principle).

## Data model (Postgres)

```text
organizations           users                   memberships
─────────────           ─────                   ───────────
id          uuid PK     id        uuid PK        id       uuid PK
name        text        email     text UNIQUE    user_id  → users
created_at  timestamptz name      text           org_id   → organizations
updated_at  timestamptz created_at timestamptz   role     text  (owner | member)
                        updated_at timestamptz    created_at timestamptz
                                                  UNIQUE(user_id, org_id)

projects                             ingest_tokens (SDK reporting credential)
────────                             ─────────────
id          uuid PK                  id           uuid PK
org_id      → organizations          project_id   → projects
name        text                     token_hash   text  (hash only)
slug        text                     created_at   timestamptz
created_at  timestamptz              last_used_at timestamptz
updated_at  timestamptz              revoked_at   timestamptz  (soft delete)
UNIQUE(org_id, slug)

router_traces (existing RouterTrace persisted to PG, with a tenant column)
─────────────
trace_id       text PK          latency_ms          int
project_id     → projects  ◄──  estimated           bool
decision_id    text NOT NULL    estimated_cost_usd  real
status         text             input/output/total_tokens  int
chosen_model   text             trace_json          jsonb  (full RouterTrace)
reason         text             created_at          timestamptz

Indexes:
  idx_traces_project_created  ON router_traces(project_id, created_at DESC)
  idx_traces_project_status   ON router_traces(project_id, status)
  idx_memberships_user        ON memberships(user_id)
  Better-Auth generates its own session / account / verification tables.
```

**Ruling 1 in schema:** `organizations` (1) → `projects` (N) is the locked
two-level hierarchy.

**Ruling 2 in schema:** `memberships.role` stores `owner | member` for MVP-3. The
column type allows more values later, but only `owner` / `member` are judged this
milestone; differentiated RBAC is MVP-4+.

**Index policy (MVP discipline):** only necessary indexes on high-frequency
columns + foreign keys + sort keys. `project_id` is always in the `WHERE` clause,
so it composes with `created_at` / `status`. No speculative composite indexes.
`trace_json jsonb` keeps the full trace for forward field compatibility (mirrors
the SDK's append-only ethos).

**Isolation mechanism:** every `/api/*` request passes an auth middleware that
resolves user → org → the set of accessible projects; PgDataAccess **forces
`WHERE project_id = $current` into every query.**

## SDK reporting path (P0)

**This is the P0 data path for MVP-3.** Without it, a locally embedded SDK's
traces never reach the hosted control plane, and "multiple people see the same
data" is impossible. The path is:

```text
Agent app (embeds @adaptive-router/sdk)
  │  createRouter({ store, reporter })   ← reporter is OPTIONAL, zero-dependency
  │  routes as usual, produces a RouterTrace
  ▼
POST  https://<control-plane>/ingest/traces
  Header: Authorization: Bearer <INGEST_TOKEN>   (per-project token)
  Body:   the RouterTrace JSON
  ▼
Control plane
  1. Hash the presented token, look up ingest_tokens.token_hash
  2. Resolve the owning project_id (reject if revoked / unknown → 401/403)
  3. Insert into router_traces with that project_id
  ▼
That project's members now see the trace in the dashboard.
```

Details:

- **Token storage:** ingest tokens are stored **as a hash only**
  (`ingest_tokens.token_hash`); the plaintext is shown once at creation and never
  persisted. Revocation is a soft delete (`revoked_at`).
- **Project attribution:** each token belongs to exactly one project; the trace's
  `project_id` is derived server-side from the token, never trusted from the
  client body.
- **Zero-dependency reporting client (hard rule):** if the SDK gains a reporting
  client, it **must be optional and zero-dependency**, built on Node's built-in
  `fetch` / `node:http` only. It **must not add any npm dependency to the SDK**.
  A router with no `reporter` configured behaves exactly as today (local store
  only) — honest, opt-in, no side effects.
- **Endpoint contract:** `POST /ingest/traces` returns the `{code,data,message}`
  envelope; `code: 0` on success, non-zero with a human-readable `message` on
  auth/validation failure.

## Deployment topology

```text
[Local / self-host]  docker compose up
  ┌─────────────────┐   ┌──────────────┐
  │ control-plane   │──▶│ postgres:17  │
  │ :4319 (Node 22) │   │ (named vol)  │
  └─────────────────┘   └──────────────┘
  clone → cp .env.example .env → docker compose up   ✅

[One-click hosted]  Render blueprint (render.yaml)
  Connect GitHub → auto-provisions:
  ┌─────────────────┐   ┌──────────────────┐
  │ Web Service     │──▶│ Render PostgreSQL │
  │ (control-plane) │   │ (free tier 1GB)   │
  └─────────────────┘   └──────────────────┘
  DATABASE_URL auto-injected → run migrations on first boot → public HTTPS URL ✅

SDK user side (unchanged, plus optional reporter):
  Agent app ──createRouter({ store })──▶ local routing
       └── optional: configure an ingest token to POST traces to the control plane
```

Environment variables (`.env`): `DATABASE_URL`, `BETTER_AUTH_SECRET`,
`BETTER_AUTH_URL`, `GITHUB_CLIENT_ID` / `GITHUB_CLIENT_SECRET` (optional), `PORT`.

## Dependency boundary

> This boundary will be mirrored into the README "Design principles" during the
> development phase (owned by team-lead).

### Principle

- **Core SDK (`@adaptive-router/sdk`) = zero runtime dependencies.** Its
  `dependencies` is always `{}`. Optional capabilities (embeddings ONNX,
  `node:sqlite`) load through a dynamic-import shim a bundler cannot pull in. This
  does not change for MVP-3.
- **Control-plane layer (`@adaptive-router/control-plane`) = standard cloud
  components allowed.** Auth (Better-Auth), the Postgres driver (postgres.js), and
  similar dependencies are declared **only** in this new package.
- **`@adaptive-router/dashboard` and `@adaptive-router/cli` stay as they are** —
  today they are zero runtime dependency (workspace-only), and MVP-3 adds no npm
  dependency to them.

### Why the boundary exists

The SDK embeds into other people's agent runtimes. Any runtime dependency the SDK
drags in becomes the downstream user's dependency, supply-chain risk, and bundle
weight. Zero dependency is the core promise and differentiator of an
SDK-first, embeddable product. The hosted control plane is a **standalone service
an operator deploys**; its dependencies affect only that operator and do not leak
downstream — so cloud components are legitimate in that layer.

### How it is machine-enforced

1. **Physical isolation** — cloud dependencies appear only in
   `packages/control-plane/package.json`.
2. **CI assertion** (added ahead of the existing lint → typecheck → build → test
   → smoke gate):

   ```bash
   node -e "const p=require('./packages/sdk/package.json');
     const d=Object.keys(p.dependencies||{});
     if(d.length){console.error('SDK dependency boundary VIOLATED:',d);process.exit(1)}
     console.log('SDK zero-dependency boundary OK')"
   ```

   The same check applies a workspace-only allowlist to `dashboard` / `cli`.
3. **No deep links** — the control plane imports only public SDK exports (eslint
   `no-restricted-imports`).

## Constraints and infeasibility warnings

Feasible (verified, small change surface):

- ✅ Multi-tenanting the dashboard: because `DashboardDataSource` already exists,
  the core change is a new PgDataAccess + one auth middleware; the 12 `/api/*`
  endpoints and HTML render layer need no changes.
- ✅ SDK reuse via existing public contracts; no new SDK surface area.
- ✅ Store contract continuity via `createPostgresTraceStore`.

Constraints / warnings:

- ⚠️ **No runtime dependency may be added to `packages/sdk`** — Better-Auth /
  postgres.js / any reporter client live only in the new package; violations turn
  CI red.
- ⚠️ **MVP-1 `BUILTIN_WEIGHTS` byte-for-byte compatibility is inviolable** — this
  work adds only an outer layer and does not touch routing scoring.
- ⚠️ **Keep hand-written node type shims** — the control plane also avoids
  `@types/node` (`node-shims.d.ts` convention).
- ⚠️ **Render free tier: Postgres expires after 30 days + 15-min sleep, 30–60s
  cold start** — documented honestly; for production hosting, upgrade to $6/mo or
  self-host with docker-compose.
- ⚠️ **Deferred out of MVP-3:** fine-grained RBAC (only `owner`/`member` this
  milestone; `role` column reserved), audit log, budgets, SaaS billing — held per
  the milestone lock.
- ⚠️ **No ORM / no web framework** (Express/Nest) — use Better-Auth's Node HTTP
  handler plus the existing `node:http`, avoiding over-design.
