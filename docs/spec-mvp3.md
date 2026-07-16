# Spec — adaptive-model-router MVP-3 (Team-Hosted Control Plane) v1.0.0

> Generated: 2026-07-16
> Based on: PRD (`docs/en/mvp3-prd.md`) + Architecture (`docs/en/mvp3-architecture.md`, `docs/zh/mvp3-architecture.md`) + UIUX (`docs/en/mvp3-uiux.md`)
> Status: **Confirmed** (user approved the three documents 2026-07-16)
> Role: Internal engineering contract. Everything not listed here is out of scope. Development, design refinement, and QA all treat this Spec as the single source of truth.

---

## 1. Product definition

- **One-line**: Turn adaptive-model-router from a local, single-machine dashboard into a lightweight, self-hostable **team control plane** — members log in, switch Organization/Project, and view the routing decisions of the projects they belong to; deployable with a single command.
- **Target users**: (primary) platform/infra lead of a 2–15 person team, comfortable with Docker/one-click deploy but no dedicated DevOps; (secondary) SaaS developer embedding routing, isolating data per customer/environment (Org = self, Project = customer/env).
- **Core problem**: the moment >1 person uses the router, the local single-machine dashboard breaks down — there is no shared, access-controlled place to view routing decisions.

---

## 2. MVP scope (LOCKED — anything not in this list is not built)

RICE = (Reach × Impact × Confidence) / Effort.

| Priority | Feature | Acceptance summary | RICE |
|----------|---------|--------------------|------|
| **P0** | SDK → control-plane ingest path | Per-project ingest token; SDK opt-in POSTs traces; unconfigured = honest no-op, zero-dep | **8.5** |
| **P0** | Authenticated login (multi-user) | Email/password + GitHub OAuth; first registrant = owner; registration can be closed | **6.75** |
| **P0** | One-click deploy template | `docker compose up` + Render blueprint; dashboard reachable ≤3 min; data survives restart | **6.4** |
| **P0** | Two-tier Org → Project isolation + membership | Data owned per project; member sees only their projects; cross-project access = 403 | **5.4** |
| **P0** | Hosted persistence backend (Postgres) | Control-plane persists traces/users/projects; multi-user sees the same project data | **5.33** |
| **P1** | Member invitation flow | Invite link / email to add a member to a project | 3.27 |
| **P1** | Deployment health self-check page | `/health` + readiness guide page | 4.8 |

> **P0 = the five above** (all block the main line). **P1 = the two below** (do them if there is spare capacity after P0; they do not block delivery).

### Won't have this MVP (explicitly NOT built)

| Deferred | Reason |
|----------|--------|
| Fine-grained RBAC (Admin/Viewer differentiated permissions) | Only `owner`/`member` gating this MVP; `role` column reserved, four-tier UI may be shown as disabled/reserved. Enforcement → MVP-4+ |
| Full audit logs | Compliance-oriented; tone is "not heavyweight enterprise". → MVP-4+ |
| Team budget alerts | Needs cost aggregation + alerting pipeline. → MVP-4+ |
| SaaS-grade multi-tenant billing | This MVP draws only the project boundary; no billing. → MVP-4+ |
| SSO enforcement / SAML / SCIM | OAuth is enough for starter teams. → MVP-4+ |
| Dashboard becoming writable (edit weights) | Keep MVP-2 human-in-the-loop, read-only stance. → separate line |
| Google OAuth (as a hard requirement) | GitHub OAuth + email/password satisfy "at least one OAuth". Google is optional/nice-to-have, not a P0 gate |

---

## 3. Technical architecture (LOCKED)

- **New package**: `@adaptive-router/control-plane` — the ONLY package allowed to declare standard cloud dependencies. Wraps and reuses the existing dashboard; never modifies SDK or dashboard logic.
- **Auth**: **Better-Auth** (MIT, framework-agnostic, standalone Node HTTP handler, `organization` + email/OAuth plugins). Start with email/password + GitHub OAuth; magic-link optional. Lucia hard-excluded (deprecated 2026).
- **Persistence**: **Postgres + postgres.js** (0-dependency driver, TS-native, built-in pooling). **No ORM.** Migrations = hand-written SQL files + a version table.
- **Server runtime**: reuse Node built-in `node:http` + Better-Auth's Node HTTP handler. **No web framework** (no Express/Nest).
- **Deploy**: `docker-compose.yml` (control-plane + `postgres:17`, clone-and-run) + `render.yaml` blueprint (one-click, no credit card, free Postgres). Railway/Fly = README links only.
- **Node type shims**: control-plane continues the hand-written `node-shims.d.ts` convention; **no `@types/node`**.

### Dependency boundary (HARD RULE — machine-enforced)

- `@adaptive-router/sdk` → `dependencies: {}` forever. Optional capabilities (embeddings, `node:sqlite`, ingest reporter) load via dynamic-import shim / Node built-ins only.
- `@adaptive-router/dashboard` and `@adaptive-router/cli` → stay zero runtime dependency (workspace-only).
- `@adaptive-router/control-plane` → the only place Better-Auth / postgres.js / etc. appear.
- **CI assertion** (added to the gate, runs before/with lint→typecheck→build→test→smoke): asserts `sdk/package.json` `dependencies` is `{}`; asserts `dashboard`/`cli` deps are workspace-only allowlist.
- **No deep links**: control-plane imports only public SDK exports (eslint `no-restricted-imports` on `@adaptive-router/sdk/src/**`).
- **README "Design principles"** gains a line mirroring this boundary (owned by team-lead, lands in the MVP-3 PR).

### Reuse contract (control-plane → sdk, one-way only)

| SDK export (existing, unchanged) | Control-plane usage |
|----------------------------------|---------------------|
| `DashboardDataSource` / `createReadOnlyDataAccess` | Implement PG-backed `listTraces / listModels / store`, filtered by `project_id`, fed in |
| `Mvp2StoreExtension` / `ExtendedTraceStore` | Add `createPostgresTraceStore` implementing the same contract |
| `RouterTrace` / `StoredRequest` / `ModelProfile` types | DB-row ↔ API mapping targets; keep `{code,data,message}` envelope |
| `renderDashboardHtml` + the 12 `/api/*` endpoints | Reused as-is; wrapped with auth middleware + project-scope injection |

---

## 4. API endpoint inventory (LOCKED — the single source for backend dev)

All responses use the existing `{ code, data, message }` envelope where `code ∈ {"OK","ERROR"}` discriminates success/failure — this matches the shipped dashboard implementation (`dashboard/src/index.ts` emits `code: statusCode>=400 ? "ERROR" : "OK"`) and the CI smoke test that asserts `code === "OK"`. `code: "OK"` = success; `code: "ERROR"` + human-readable `message` + a real HTTP status (401/403/400) = failure. *(Team-lead ruling 2026-07-16: the string form is authoritative; earlier "code: 0" wording is superseded to keep Spec and code — and CI — in agreement.)*

### 4.1 Ingest (SDK → control-plane, P0 data path)

| Method | Path | Purpose | Auth | Request body | Response |
|--------|------|---------|------|--------------|----------|
| POST | `/ingest/traces` | SDK reports a routing decision | `Authorization: Bearer <INGEST_TOKEN>` (per-project) | `RouterTrace` JSON | `{code,data:{traceId},message}`; 401/403 on unknown/revoked token |

Rules: hash presented token → look up `ingest_tokens.token_hash` → resolve owning `project_id` server-side (never trust client body) → insert into `router_traces`. Revoked/unknown token → `code:"ERROR"`, HTTP 401/403.

### 4.2 Auth (served by Better-Auth Node HTTP handler, mounted under a base path)

| Method | Path | Purpose | Auth |
|--------|------|---------|------|
| * | `/api/auth/*` | Better-Auth routes: email/password sign-up/sign-in, GitHub OAuth callback, session, sign-out | public / session |
| GET | `/api/auth/session` | Current session/user | session cookie |

- First successful registration → that user becomes `owner` of a bootstrap Organization.
- Setting to close further registration (owner-only), read at sign-up time.

### 4.3 Organizations / Projects / Members / Tokens (control-plane management API)

| Method | Path | Purpose | Auth | Notes |
|--------|------|---------|------|-------|
| GET | `/api/orgs` | List orgs the user belongs to | session | |
| POST | `/api/orgs` | Create org (onboarding step 1) | session | creator = `owner` |
| GET | `/api/orgs/:orgId/projects` | List projects in org (scoped to membership) | session + org member | |
| POST | `/api/orgs/:orgId/projects` | Create project (onboarding step 2) | session + `owner` | auto-assign accent |
| GET | `/api/orgs/:orgId/members` | List members + role | session + org member | |
| POST | `/api/orgs/:orgId/invites` | Create invite (link/email) — **P1** | session + `owner` | |
| POST | `/api/orgs/:orgId/settings/registration` | Open/close registration | session + `owner` | |
| GET | `/api/projects/:projectId/tokens` | List ingest tokens (masked) | session + project member | |
| POST | `/api/projects/:projectId/tokens` | Create ingest token (plaintext shown once) | session + `owner` | store hash only |
| DELETE | `/api/projects/:projectId/tokens/:tokenId` | Revoke token (soft delete) | session + `owner` | set `revoked_at` |

### 4.4 Dashboard data API (existing 12 `/api/*`, reused as-is, project-scoped)

- The existing dashboard `/api/*` endpoints (requests list, request detail, models, model compare, stats, etc.) are **reused unchanged**, wrapped by:
  1. auth middleware (unauthenticated → redirect to `/login` for pages, `code:"ERROR"`/401 for API);
  2. project-scope injection — every query is forced `WHERE project_id = $current`; cross-project access returns 403, never leaks.
- Org-level view ("All projects") aggregates only across projects the user belongs to.

### 4.5 Health (P1)

| Method | Path | Purpose | Auth |
|--------|------|---------|------|
| GET | `/health` | Readiness: DB reachable, migrations applied, auth configured | public |

---

## 5. Database tables (LOCKED — Postgres)

| Table | Core columns | Indexes | Relations |
|-------|--------------|---------|-----------|
| `organizations` | `id uuid PK`, `name`, `created_at`, `updated_at` | PK | — |
| `users` | `id uuid PK`, `email UNIQUE`, `name`, `created_at`, `updated_at` | PK, email unique | — |
| `memberships` | `id uuid PK`, `user_id→users`, `org_id→organizations`, `role text (owner\|member)`, `created_at` | `idx_memberships_user(user_id)`, `UNIQUE(user_id, org_id)` | user↔org |
| `projects` | `id uuid PK`, `org_id→organizations`, `name`, `slug`, `accent`, `created_at`, `updated_at` | `UNIQUE(org_id, slug)` | org(1)→project(N) |
| `ingest_tokens` | `id uuid PK`, `project_id→projects`, `token_hash text`, `created_at`, `last_used_at`, `revoked_at` | project_id | project→tokens |
| `router_traces` | `trace_id text PK`, `project_id→projects`, `decision_id`, `status`, `chosen_model`, `reason`, `latency_ms`, `estimated bool`, `estimated_cost_usd real`, `input/output/total_tokens int`, `trace_json jsonb`, `created_at` | `idx_traces_project_created(project_id, created_at DESC)`, `idx_traces_project_status(project_id, status)` | project→traces |
| Better-Auth tables | `session` / `account` / `verification` (generated by Better-Auth migration) | per Better-Auth | user |

- **Migrations**: hand-written SQL files + a `schema_migrations` version table. No ORM.
- **`role` column**: physically may store more values; only `owner`/`member` are enforced this MVP.
- **`trace_json jsonb`**: full `RouterTrace` retained for forward field compatibility (append-only ethos).
- **Index discipline**: only high-frequency columns + FKs + sort keys; no speculative composite indexes.

---

## 6. Page inventory (LOCKED)

| Page | Route | Core components | Backing API | Notes |
|------|-------|-----------------|-------------|-------|
| Login / Auth | `/login` | Centered card, GitHub/email CTAs, SSO placeholder | `/api/auth/*` | Default/Loading/Error states |
| Onboarding | `/onboarding` | 3-step checklist (name org → create project → get ingest token + snippet) | `/api/orgs`, `/api/orgs/:id/projects`, `/api/projects/:id/tokens` | <1 min flow; "View deploy guide" |
| App Shell | (wraps all) | Collapsible sidebar: Org switcher (top), Project switcher/filter, nav (Requests/Models/Settings), Invite, avatar menu; top-bar breadcrumb + `⌘K` | — | Org-level "All projects" supported |
| Requests / Routing Decisions | `/requests` | Monospace table (`time·request_id·model·decision·latency·cost·by`), semantic-color decision badge, right-side explainable decision drawer | reused dashboard `/api/*` (project-scoped) | Empty state = snippet + deploy guide |
| Models | `/models` | Model comparison table (latency/cost/hit rate/count), side-by-side diff | reused dashboard `/api/*` (project-scoped) | Scoped to current project; empty state copy |
| Settings › Members | `/settings/members` | Member table (avatar·name·email·role·status), Invite popover | `/api/orgs/:id/members`, `/api/orgs/:id/invites` (P1) | Role dropdown = owner/member ONLY; Admin/Viewer disabled+"reserved MVP-4+" |
| Settings › API Keys (ingest tokens) | `/settings/api-keys` | Per-project token list (masked, created/last-used/revoke), create-once reveal | `/api/projects/:id/tokens` | Same ingest loop as onboarding |
| Empty-state family | (component) | Lucide/geometric illustration (no emoji), one-sentence copy, single CTA | — | 3 layers: no org/project, no data, data present |
| Health self-check (P1) | `/health` page | Component readiness list | `/health` | P1 |

---

## 7. Design Tokens (LOCKED)

- **Theme**: dark-primary (`data-theme="dark"`), light theme provided as a settings option (same semantic vars, different values).
- **Primary**: Indigo `#6366F1` (hover `#818CF8`, subtle `rgba(99,102,241,0.12)`). **No purple/pink gradient.**
- **Backgrounds**: `--bg-primary #0D1117`, `--bg-surface #161B22`, `--bg-elevated #21262D`, `--bg-overlay rgba(0,0,0,0.6)`.
- **Text**: `--text-primary #F0F6FC`, `--text-secondary #8B949E`, `--text-muted #484F58`.
- **Semantic (routing)**: success `#3FB950` (hit/healthy), warning `#D29922` (fallback/degraded), error `#F85149` (failure/timeout), info `#58A6FF` (annotation).
- **Border/radius/shadow**: `--border-default #30363D`, `--border-focus #6366F1`, radius 4/8/12, `--shadow-glow 0 0 40px rgba(99,102,241,0.10)`.
- **Motion**: fast 150ms, normal 250ms, `cubic-bezier(0.4,0,0.2,1)`; respect `prefers-reduced-motion`.
- **Fonts**: display/body = `Inter, Noto Sans SC, -apple-system`; mono = `JetBrains Mono, Fira Code` (all technical identifiers — request_id/model/cost/latency/ingest tokens — are monospace). Sizes: 12/14/16/18/20/24/32 only.
- **Icons**: **Lucide only** (16 inline / 20 in-button / 24 standalone). No emoji.
- **Project accent**: fixed 8-color palette for switcher dot + breadcrumb tag; never overrides the primary system.
- **Benchmark**: Linear (restraint/keyboard) × Vercel Dashboard (project-as-filter) × Langfuse (Org→Project→Key hierarchy).

---

## 8. Acceptance criteria (LOCKED — the single source for QA)

| # | Feature | Given | When | Then |
|---|---------|-------|------|------|
| A1 | Login (first user) | Freshly deployed instance | First user registers | Becomes `owner`; can close further registration in settings |
| A2 | Login (guard) | Unauthenticated user | Visits any dashboard page | Redirected to `/login`; sees no routing data |
| A3 | Login (OAuth) | GitHub OAuth configured | User logs in with GitHub | Account created/linked; lands in their projects |
| A4 | Isolation | User A belongs only to Project X (in their Org) | Logs in | Sees only Project X decisions, not Project Y |
| A5 | Ownership | A routing-decision record | Written to control-plane | Carries Project ownership; unowned records shown to no regular member |
| A6 | Cross-project denial | User A not in Project Y | Requests Project Y data | 403 (no leak), not 200 |
| A7 | Deploy (fresh) | Clean machine with Docker | Runs the single documented command | Within ~3 min dashboard reachable, enters first-registration flow |
| A8 | Deploy (persistence) | Completed deployment | Services restart | Produced traces + user/project data not lost |
| A9 | Hosted sharing | Two members of the same project log in separately | App produces a new routing decision | Both see the same decision in their sessions |
| A10 | Ingest (configured) | SDK configured with a project's ingest token | A routing decision is produced | It appears in the control-plane under that project |
| A11 | Ingest (opt-in / zero-dep) | No ingest token configured | Routing decisions produced | SDK behaves exactly as before — no upload, zero-dependency, honest no-op |
| A12 | Ingest (bad token) | Revoked/unknown ingest token | SDK POSTs a trace | 401/403 with readable message; nothing inserted |
| A13 | Guardrail | The repo at any commit | CI runs the dependency-boundary assertion | `@adaptive-router/sdk` `dependencies` = `{}`, else CI red |
| A14 | Env errors | Required env var missing at deploy | Service boots | Clear, human-readable error naming the missing variable |

**Boundary conditions QA must cover**: empty state (new project, no data), error states (OAuth callback failure, DB unreachable, invalid/expired ingest token), loading states, permission denial (403 not leak), concurrent logins, missing-env-var deploy errors.

**Success metrics (product-level, tracked)**: activation ≤5 min; ≥60% instances with ≥2 accounts within 7 days; cross-project denial = 100%; ingest loop ≥95%; deploy first-try ≥90%; SDK dependency count = 0.

---

## 9. Boundaries & constraints

- **SDK zero-dependency is inviolable** — Better-Auth / postgres.js / any reporter client live only in `@adaptive-router/control-plane`; CI-enforced.
- **MVP-1 `BUILTIN_WEIGHTS` byte-for-byte compatibility inviolable** — this work adds only an outer layer; does not touch routing scoring.
- **No ORM, no web framework** — postgres.js + hand-written SQL migrations; Better-Auth Node HTTP handler + `node:http`.
- **Hand-written node type shims** — control-plane also avoids `@types/node`.
- **Render free tier caveat** — Postgres expires after 30 days + 15-min sleep / 30–60s cold start; documented honestly; production → $6/mo or self-host docker-compose.
- **Responsive**: dashboard is desktop-first (developer tool); must remain usable at common laptop widths. No IE support.
- **PR-gated main**: all work lands via PR with CI green + review; squash-merge → PR title must be a Conventional Commit.
- **Verification discipline**: real build/test/smoke, no rubber-stamping; local-pass ≠ CI-pass (CI must `pnpm install --frozen-lockfile`).

---

## 10. Change log

| Date | Change | Reason | Impact |
|------|--------|--------|--------|
| 2026-07-16 | Spec v1.0.0 created from confirmed PRD + Architecture + UIUX | Phase 1.5 gate after user approval | Locks scope for all downstream MVP-3 development |
