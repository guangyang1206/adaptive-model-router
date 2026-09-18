# ADR-006 — Tenant isolation is structural, not a runtime check

- Status: Accepted (2026-07-17)
- Deciders: maintainers
- Source commit: `9f73d5f` (MVP-3 control plane)

## Context

The control plane is multi-tenant: an organisation owns projects, and each
project owns its traces and ingest tokens. A cross-project read is the worst
bug this codebase can have — it leaks one team's prompts and cost data to
another.

The conventional defence is a runtime check: resolve the caller's scope, then
verify the requested `projectId` is in it before querying. That works, and it
fails in a specific way — it is a check that must be *remembered*. Every new
endpoint, every new query, every refactor is another chance to omit it, and an
omitted check produces no error, no type failure, and no test failure. It
produces correct-looking data from the wrong tenant.

There was a second constraint. MVP-3 reuses the local dashboard's twelve
`/api/*` endpoints rather than reimplementing them. Those handlers were
written for a single-tenant local loop and know nothing about projects.
Threading a `projectId` parameter through all of them would mean twelve more
places where a check can be forgotten.

## Decision

Scope is captured at construction, so a query cannot be expressed without its
predicate.

`createPgDashboardDataSource(sql, projectId)`
(`packages/control-plane/src/data/pg-data-source.ts:38`) closes over
`projectId` and returns a `DashboardDataSource`. Every query inside hard-codes
the predicate:

```sql
SELECT trace_json FROM router_traces
WHERE project_id = ${projectId}
ORDER BY created_at DESC
```

(`packages/control-plane/src/data/pg-data-source.ts:41-47`)

There is no per-query `projectId` option and no unscoped read path. The header
comment states the intent: "The scope (`project_id`) is a constructor
argument, not a per-query option — the query can never be issued without the
predicate" (`packages/control-plane/src/data/pg-data-source.ts:3-5`).

The org-level aggregate follows the same shape.
`createPgDashboardDataSourceForProjects(sql, projectIds)`
(`packages/control-plane/src/data/pg-data-source.ts:60`) scopes to `project_id IN (...)` over the caller's
accessible set, and an empty list short-circuits to `[]` rather than
degenerating into a table scan (`packages/control-plane/src/data/pg-data-source.ts:63`).

On the write path, `project_id` is derived server-side from the ingest token
and is never read from the request body. `handleIngest`
(`packages/control-plane/src/routes/ingest.ts:39`) hashes the bearer token,
looks up `ingest_tokens` by `token_hash`, and takes `project_id` from that
row (`packages/control-plane/src/routes/ingest.ts:52-60`). An unknown token returns 401 and a revoked token 403,
with nothing inserted in either case. A token can only ever write to its own
project, which the file header states at `packages/control-plane/src/routes/ingest.ts:9-11`.

The accessible set itself comes from `resolveScope`
(`packages/control-plane/src/auth/scope.ts:34`), which returns empty sets for a
user with no memberships (`packages/control-plane/src/auth/scope.ts:46-48`) — so the degenerate case is "sees
nothing", not "sees everything".

The property is proved end to end, not argued.
`packages/control-plane/integration/roundtrip.mjs` runs in the
`control-plane-integration` CI job: it posts a trace with only a bearer token,
reads it back through the project-scoped data source and asserts one visible
trace (`:87-90`), then constructs a second data source for a different project
id and asserts zero rows (`:92-95`).

## Consequences

Positive:

- Omitting the tenant predicate is not a mistake a contributor can make in
  the data layer. There is no API surface that accepts an unscoped read.
- The twelve reused dashboard endpoints became project-scoped with zero
  dashboard changes, because the scope lives in the injected data source
  rather than in the handlers.
- A compromised or leaked ingest token is bounded to one project by
  construction, since the client never supplies the target project.
- The guarantee is asserted as a property — "zero rows for another project" —
  rather than as a per-endpoint checklist, and that assertion runs on every CI
  build of the `control-plane-integration` job against a real Postgres.

Negative:

- A data source instance is bound to one project for its lifetime. Any
  legitimate cross-project view needs a second construction path, which is why
  `createPgDashboardDataSourceForProjects` exists as a separate function
  rather than as an option. Every future aggregate needs the same treatment.
- Construction sites become the security boundary. The guarantee is only as
  good as the `projectId` passed in, so the request-scoped code that resolves
  the caller's scope and constructs the data source is now the place to audit.
  The decision narrows the audit surface; it does not remove it.
- A data source is allocated per request rather than shared, which is a small
  cost but a real one under load.
- `listModels()` returns `[]` (`packages/control-plane/src/data/pg-data-source.ts:49-51`) and `store` is left
  undefined, because there is no project-scoped models table. The Models,
  Evals, Cache and Learning pages therefore show empty states in the hosted
  view. That is a deliberate consequence of scoping rather than a gap to patch
  with unscoped data.
- The predicate is repeated in every query. Adding a table means remembering
  to include it — this decision removes the "forgot to check" failure for
  reads through the data source, not the "forgot the column" failure when
  authoring new SQL.

## Alternatives considered

- **Resolve scope, then check `projectId` at each endpoint.** Rejected: a
  check that must be remembered will eventually be forgotten, and the failure
  is silent data disclosure. Note this pattern is still used for *authorisation*
  decisions where it belongs — `canAccessProject` and `ownsProject`
  (`packages/control-plane/src/auth/scope.ts:65,80`) gate whether a request may proceed. The decision here is
  that data access must not depend on those checks having been made.
- **Postgres row-level security with a per-request session variable.**
  Genuinely stronger: the database enforces it regardless of application code.
  Rejected for MVP-3 because it requires `SET LOCAL` on the correct connection
  for every request, which interacts with pooling (ADR-005 already runs two
  pools) and would need the Better-Auth pool to participate too. Worth
  revisiting; it would complement this decision rather than replace it.
- **A database per tenant.** Rejected: unacceptable operational cost for a
  self-hosted starter control plane, and migrations would have to fan out.
- **Accept `project_id` from the ingest request body and validate it against
  the token.** Rejected: it makes a valid-looking request able to target
  another project, so correctness depends on the validation being present.
  Deriving it from the token removes the parameter entirely.

## Related ADRs

- ADR-004 — hand-written SQL is what makes the predicate visible at the call
  site
- ADR-007 — RBAC is partial, so this structural boundary carries more of the
  isolation weight than a full role matrix would
