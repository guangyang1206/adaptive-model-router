# Open decisions register

Decisions that have **not** been made yet. The companion to
[the ADRs](./README.md) in this directory: an ADR records a decision that was
taken, this file records one that is still open, together with the condition
that will let it close.

## How to use it

- **Append only.** New entries go at the end. Existing entries are never
  rewritten or deleted.
- **Close in place.** When an item is decided, change `## OPEN` to
  `## RESOLVED` and add a `Resolution:` line (what was decided, why, and the
  date). If the resolution is substantial, write an ADR and point to it. The
  entry stays either way — three months later "why didn't we do multi-region?"
  needs an answer, and the answer lives here.
- **Resurface at task start.** Read the `OPEN` entries before starting a
  milestone and decide, item by item, whether `Resolves when` has been met.
- **Three categories only**, per the register standard:
  `waiting-on-external-condition`, `design-decision-to-evaluate`,
  `existing-design-boundary`. Do not invent more.

Every entry carries: Date, Source, Open item, Related constraints, Current
leaning, Blocked by, Resolves when. `none yet` is a valid value; an empty field
is not.

Summary: **8 open, 0 resolved.**

---

## OPEN — waiting-on-external-condition — MVP-4 scope is not locked

- **Date:** 2026-09-18
- **Source:** `ROADMAP.md` (MVP-4 — Governance and Scale); maintainer decision recorded during the
  post-release review
- **Open item:** MVP-4 lists eight candidates with no ordering and no
  commitment — full RBAC matrix, audit log, team budgets and cost attribution,
  organisation-level provider keys, policy dry-run UI (carried from MVP-1),
  local proxy / HTTP bridge (carried from MVP-1), prompt/context compression
  (carried from MVP-2), Helicone/Langfuse exporter (carried from MVP-2). Which
  of these MVP-4 actually contains is undecided.
- **Related constraints:** `ROADMAP.md` ("How priorities are decided") locks scope per milestone, so
  anything outside the milestone list requires a spec change first — which
  means picking wrong is expensive to undo. The four carried-over items were
  already deferred twice, so age is not evidence of value. Four of the
  candidates (RBAC, audit, budgets, org keys) are governance features whose
  value depends entirely on whether anyone is running the control plane
  multi-user.
- **Current leaning:** wait. The packages went live on npm on 2026-09-18, so
  there is no usage signal at all yet. Locking scope now means locking a
  guess, and the roadmap explicitly labels these as candidates rather than
  commitments to keep that honest.
- **Blocked by:** absence of real usage signal — no installs telemetry, no
  issues, no discussions, no report of anyone self-hosting the control plane.
- **Resolves when:** a usage signal exists that discriminates between the
  candidates. Concretely, any of: an issue or discussion requesting a specific
  candidate; evidence that someone is running `@adaptive-router/control-plane`
  multi-user (which would promote the governance cluster); or a decision to
  proceed without user input, taken explicitly and recorded here rather than
  by default.

---

## OPEN — waiting-on-external-condition — Whether to adopt npm Trusted Publishing for release authentication

- **Date:** 2026-09-18
- **Source:** ADR-011; `RELEASING.md "Authentication: use a granular token, not a classic one"` option 3; `.github/workflows/release.yml`
- **Open item:** `.github/workflows/release.yml` authenticates with a granular
  access token held as the `NPM_TOKEN` repository secret (step "Publish to npm
  (dependency order)"). npm Trusted Publishing would replace that secret
  with a per-package trusted-publisher link and no long-lived credential at
  all. Whether to migrate is open.
  Note this is specifically about **authentication**. Provenance already works
  today under the token, and does **not** depend on Trusted Publishing — this
  was confirmed against npm's provenance documentation, whose reference
  workflow is exactly `--provenance` plus `NODE_AUTH_TOKEN` from a secret. The
  documented preconditions are `id-token: write`, a cloud-hosted runner, npm
  >= 9.5.0, and a public repository with a matching `repository` field; a
  trusted publisher is not among them, and scoped packages are not a special
  case. This workflow satisfies all four (`permissions: id-token: write`,
  `runs-on: ubuntu-latest`, `--provenance` in the publish step). What Trusted
  Publishing would add on top: it removes the `NPM_TOKEN` secret and makes
  provenance automatic, so the `--provenance` flag becomes unnecessary.
- **Related constraints:** ADR-011 names token-less auth as the preferred
  destination because it removes the long-lived credential entirely. It
  requires configuration on the npm side (a trusted publisher linked to this
  repository and this workflow file) that only an `@adaptive-router` org owner
  can perform, and that configuration is per package — four times. Granular
  tokens also expire, and an expired token fails with a message that reads like
  a permissions problem (ADR-011, negative consequences) — the workflow
  mitigates this by naming the cause in its failure output.
  Three traps attach to this, all worth knowing *before* adopting:
  1. A trusted-publisher link is pinned to a workflow **filename**, so
     renaming `release.yml` would break publishing in a way that is not
     obvious from the diff. The file carries a warning comment at its head.
  2. The same pinning extends to refactoring. If publishing ever moves behind
     `workflow_call` or `workflow_dispatch`, npm validates the **calling**
     workflow's filename rather than the one containing the publish command,
     and `id-token: write` must be granted to both parent and child. So the
     hazard is "do not rename **and** do not extract into a reusable
     workflow".
  3. Provenance is not generated for **private** repositories under either
     auth method. Irrelevant while this repo is public, and exactly the kind
     of thing that bites if visibility ever changes.
- **Current leaning:** keep the token for now. The automated workflow already
  removes the two failure modes that mattered — a credential on one person's
  laptop and a hand-remembered publish order — and the auth step is a small,
  self-contained thing to change later. Migrating is a strict improvement, not
  a blocker.
- **Blocked by:** npm-side Trusted Publishing configuration for all four
  packages, which needs an org owner to act.
- **Resolves when:** either the four trusted publishers are configured and the
  workflow drops `NODE_AUTH_TOKEN` (close as adopted), or a decision is taken
  that a scoped, expiring token is sufficient (close as declined, with the
  reason). A tag-triggered release that publishes successfully is the evidence
  either way.

---

## OPEN — existing-design-boundary — SQLite store omits the cache_lookup and weights_change event streams

- **Date:** 2026-09-18
- **Source:** MVP-1 review P2 follow-up; `packages/sdk/src/storage.ts:360-362`;
  documented at `docs/en/api-reference.md:140` and
  `docs/zh/api-reference.md:138`; tracked for contributors as
  `.github/ISSUE_DRAFTS/07-sqlite-compatibility.md`
- **Open item:** `createSQLiteBackedTraceStore` implements the queryable MVP-2
  surface — `writeEvalRun`, `getEvalRun`, `listEvalRuns`,
  `saveBaselinePointer`, `getBaselineRunId`, `writeCacheEntry`,
  `listCacheEntries` — but not the two event-stream members of
  `Mvp2StoreExtension`: `writeCacheLookup` / `listCacheLookups`
  (`packages/sdk/src/storage.ts:150-151`) and `writeWeightsChange` / `listWeightsChanges`
  (`packages/sdk/src/storage.ts:153-154`). The JSONL store implements all of them
  (`packages/sdk/src/storage.ts:238-242`). So the SQLite backend, which the docs recommend, is
  weaker than the fallback for these two streams.
- **Related constraints:** the members are optional in the type
  (`Mvp2StoreExtension` marks every method `?`), so their absence is legal and
  causes no type or test failure. The stated rationale is that the queryable
  tables are the source of truth and the JSONL store retains the full event log
  when durability of the streams is needed (`packages/sdk/src/storage.ts:360-362`). This is the
  same class of bug as the MVP-1 usage-column gap that `11e0a37` fixed — the
  recommended backend being weaker than the fallback — but here it is disclosed
  in the API reference rather than silent.
- **Current leaning:** accept for now. The gap is documented in both language
  versions of the API reference, and nothing in the dashboard or CLI currently
  depends on the two streams under SQLite.
- **Blocked by:** nothing external. Not blocked — deprioritised. Implementing
  it means two more tables (or one append-only event table, as the comment at
  `packages/sdk/src/storage.ts:277-279` contemplates) plus parity tests against the JSONL store.
- **Resolves when:** either a dashboard or CLI feature needs cache-lookup or
  weights-change history under SQLite, or a contributor picks up
  `.github/ISSUE_DRAFTS/07-sqlite-compatibility.md`, or a user reports the
  asymmetry. Any of those makes this a normal bug with a normal fix.

---

## OPEN — design-decision-to-evaluate — Whether to add Postgres row-level security beneath the structural isolation

- **Date:** 2026-09-18
- **Source:** ADR-006, alternatives considered
- **Open item:** Tenant isolation is currently enforced entirely in
  application code, by capturing `projectId` at data-source construction
  (`packages/control-plane/src/data/pg-data-source.ts:38`). Postgres RLS with a
  per-request session variable would enforce it in the database as well,
  independent of application correctness. Whether to add it is open.
- **Related constraints:** RLS needs `SET LOCAL` on the *same* connection that
  runs the query, which interacts with pooling — and the control plane already
  runs two pools (ADR-005), so the Better-Auth pool would need to participate
  too. It would complement the structural boundary, not replace it, so it adds
  defence in depth at the cost of a pooling constraint that is easy to get
  subtly wrong.
- **Current leaning:** not now. The structural boundary is proved end to end in
  CI (`packages/control-plane/integration/roundtrip.mjs:92-95`), and a
  half-correct RLS setup — policies present but the session variable not set on
  the right connection — would produce either broken queries or false
  confidence.
- **Blocked by:** nothing external. Needs a deliberate design pass on the
  pooling interaction before it is safe to attempt.
- **Resolves when:** the control plane has a deployment where structural
  isolation alone is judged insufficient — a compliance requirement, an
  untrusted-operator scenario, or a near-miss where a new query bypassed the
  data source — or a design pass concludes the pooling interaction is tractable.

---

## OPEN — design-decision-to-evaluate — Whether optional SDK capabilities should become separate packages

- **Date:** 2026-09-18
- **Source:** ADR-001, alternatives considered
- **Open item:** Local ONNX embeddings and the `node:sqlite` store currently
  live inside the core SDK and load through a `Function("return import(...)")`
  shim (`packages/sdk/src/embedding.ts:115`,
  `packages/sdk/src/storage.ts:251`). The alternative is to move them into
  separate `@adaptive-router/*` packages, where a normal `import` is fine
  because the dependency is that package's own.
- **Related constraints:** ADR-001's `dependencies: {}` invariant is
  non-negotiable and machine-enforced, so any restructuring must preserve it.
  Splitting multiplies the publish surface, and ADR-010's fixed versioning
  means each new package joins the lockstep release. The shim already delivers
  the guarantee, so this is about readability and maintainability, not
  correctness — ADR-001 names the shim's obscurity as a real cost.
- **Current leaning:** keep the shim while there are only two optional
  backends. Two shim call sites with explanatory comments are cheaper than two
  more published packages.
- **Blocked by:** nothing. Waiting on a threshold, not a dependency.
- **Resolves when:** a third optional backend appears — that is the point at
  which the shim becomes a pattern being copied rather than two documented
  exceptions — or a contributor "cleans up" a shim into a plain dynamic
  `import()` and demonstrates that the comment is not sufficient protection.

---

## OPEN — existing-design-boundary — Org membership grants access to every project in the org

- **Date:** 2026-09-18
- **Source:** ADR-007; `packages/control-plane/src/auth/scope.ts:50-52`
- **Open item:** `resolveScope` selects every project whose `org_id` is in the
  user's orgs, so there is no per-project membership. A user added to an
  organisation can read every project in it. The only way to restrict access to
  a subset of projects is to use separate organisations.
- **Related constraints:** Roles are per-org, not per-project
  (`Scope.roleByOrg`, `packages/control-plane/src/auth/scope.ts:19`), and `ownsProject` derives project
  ownership from org ownership (`packages/control-plane/src/auth/scope.ts:80-83`). Adding per-project
  membership means a new table, a change to `resolveScope`, and a change to
  the invitation flow — and it overlaps with the full RBAC matrix, which is an
  MVP-4 candidate. Deciding it independently risks doing the work twice.
- **Current leaning:** accept, and treat it as part of the RBAC question rather
  than a separate one. The documented workaround (one org per access boundary)
  is real and costs nothing but organisational overhead.
- **Blocked by:** MVP-4 scope (first entry in this register). Per-project
  membership should be designed together with `admin`/`viewer` activation, not
  before it.
- **Resolves when:** MVP-4 scope is locked and either includes the RBAC matrix
  — in which case this is decided as part of it — or explicitly excludes it, in
  which case this becomes a documented permanent limitation and the entry
  closes with that resolution.

---

## OPEN — existing-design-boundary — Two connection pools consume two connection budgets

- **Date:** 2026-09-18
- **Source:** ADR-005; `packages/control-plane/src/db/client.ts:31,44`
- **Open item:** The control plane opens up to 15 Postgres connections — 10 for
  `postgres.js` and 5 for the Better-Auth `pg.Pool` — where a single pool would
  need fewer. Whether this needs addressing, and how, is open.
- **Related constraints:** The two pools are required, not optional:
  Better-Auth's Kysely adapter needs a node-postgres `Pool` and crashes with
  `NOT_TAGGED_CALL` on a `postgres.js` client (ADR-005). So the pool *count*
  is fixed; only the `max` values are tunable. Managed Postgres offerings on
  small plans cap connections low, and the problem compounds with replicas.
- **Current leaning:** accept, and tune `max` if it bites. The values are
  already deliberately modest and are the correct adjustment point. The
  alternative — migrating everything to node-postgres — means rewriting every
  hand-written query, including the ones carrying the isolation guarantee
  (ADR-006), which is risk concentrated in the worst place.
- **Blocked by:** nothing external. Waiting on evidence that connection count
  is a real constraint for a real deployment.
- **Resolves when:** a deployment reports connection exhaustion — at which
  point the fix is to lower the two `max` values or add a pooler such as
  PgBouncer in front — or a Better-Auth release accepts a `postgres.js` client
  directly, which would remove the second pool and let ADR-005 be superseded.

---

## OPEN — existing-design-boundary — Hand-declared row types can drift from the SQL schema

- **Date:** 2026-09-18
- **Source:** ADR-004; `packages/control-plane/src/data/pg-data-source.ts:14`;
  `packages/control-plane/src/routes/ingest.ts:33`
- **Open item:** Row shapes are declared by hand at each query site — for
  example `type TraceRow = { trace_json: RouterTrace }` and
  `type TokenRow = { id: string; project_id: string; revoked_at: string | null }`.
  Nothing connects them to the migration files, so a schema change that does
  not update a hand-declared type produces a runtime failure, not a type error.
- **Related constraints:** This is the accepted cost of ADR-004 (no ORM, no
  query builder) and cannot be removed without reopening that decision. The
  only current safety net is the real-Postgres `control-plane-integration` CI
  job; `pnpm typecheck` and the DB-less `pnpm -r test` cannot catch it, so a
  fully green local run is not evidence the database path works.
- **Current leaning:** accept. The query surface is roughly a dozen statements
  across five files, and the integration job exercises the migration and ingest
  paths against a real `postgres:17`.
- **Blocked by:** nothing. Accepted with reservation, per ADR-004.
- **Resolves when:** the query surface grows to where the integration job no
  longer covers the paths that matter, or a schema-drift bug reaches `main`.
  Either justifies revisiting — most likely by extending integration coverage
  rather than by adopting an ORM, since the visibility of hand-written SQL is
  load-bearing for ADR-006.
