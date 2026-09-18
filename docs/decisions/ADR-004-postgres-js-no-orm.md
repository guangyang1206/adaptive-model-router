# ADR-004 — Control-plane persistence is postgres.js with hand-written SQL migrations, no ORM

- Status: Accepted (2026-07-17)
- Deciders: maintainers
- Source commit: `9f73d5f` (MVP-3 control plane)

## Context

MVP-3 added a self-hostable multi-tenant control plane. Up to that point all
persistence was local files — a JSONL log or a `node:sqlite` database. Neither
survives contact with multiple users: a single file has no useful concurrency
story, cannot be shared across instances, and a container restart on a
platform with ephemeral disk loses everything. The trade-off is scored in
`docs/en/mvp3-architecture.md:135-139`, where the "keep SQLite/JSONL" option
lands at 4/10.

Once Postgres is the store, the next question is how to talk to it. The
default modern answer is an ORM or a query builder — Prisma, Drizzle, Kysely.
That answer interacts badly with two existing constraints:

- Every dependency added to the control plane widens the cloud-dependency
  allowlist that ADR-001 keeps deliberately narrow.
- The control plane's isolation guarantee (ADR-006) depends on being able to
  read a query and see its `WHERE project_id = $1` predicate. A query builder
  puts a layer of indirection between the code and the SQL that actually
  runs.

Better-Auth also ships its own schema, which means migrations have to cope
with tables the application does not author.

## Decision

`postgres.js` is the driver for every query the application issues. It is a
0-transitive-dependency driver with built-in pooling, instantiated in exactly
one place (`packages/control-plane/src/db/client.ts:26-35`), and the
`DATABASE_URL` is passed straight through.

No ORM and no query builder. Application queries are tagged-template SQL
written by hand — for example `packages/control-plane/src/auth/scope.ts:35-37`
and `:50-52`, and `packages/control-plane/src/data/pg-data-source.ts:41-47`.

Schema changes are numbered `.sql` files plus a `schema_migrations` version
table, applied by a runner in `packages/control-plane/src/db/migrate.ts`:

- files live in `packages/control-plane/src/db/migrations/`, currently
  `0001_better_auth.sql` and `0002_init.sql`
- ordering is the zero-padded numeric prefix, sorted lexicographically, which
  the comment at `packages/control-plane/src/db/migrate.ts:36-38` notes is equivalent to numeric order
- each pending file runs inside a transaction, then inserts its version row;
  any error rolls back and aborts loudly (`packages/control-plane/src/db/migrate.ts:4-9`)
- migration files are append-only and never edited after merge
  (`packages/control-plane/src/db/migrate.ts:2`)
- the runner is idempotent and runs on every boot
  (`packages/control-plane/src/server.ts:159`)

`0001_better_auth.sql` precedes `0002_init.sql` because application tables
carry foreign keys to Better-Auth ids, so Better-Auth's schema must exist
first. Better-Auth's own runtime auto-migration is disabled; its emitted
schema is committed as `0001` and applied by this runner
(`packages/control-plane/src/auth/better-auth.ts:13-15`).

The ordering/diffing logic is factored into the pure functions
`planMigrations` (`packages/control-plane/src/db/migrate.ts:31`) and `sortMigrations` (`packages/control-plane/src/db/migrate.ts:40`) so
it is unit-testable with no database
(`packages/control-plane/test/migrate.test.mjs`).

## Consequences

Positive:

- The control plane's dependency allowlist stays at five entries
  (`scripts/check-dependency-boundary.mjs:47`). No ORM runtime, no generated
  client, no schema DSL.
- Every query is readable as SQL at the call site, which is what makes the
  isolation argument in ADR-006 auditable by reading rather than by trusting
  a builder.
- One migration runner owns the whole schema, including Better-Auth's. There
  is no second migration system with its own state and its own ordering.
- Migration planning is tested without a database, so the DB-less test suite
  covers the part most likely to be wrong (ordering and skip logic).

Negative:

- No compile-time checking of SQL. A typo in a column name is a runtime
  error, caught only by the real-Postgres integration job
  (`control-plane-integration` in `.github/workflows/ci.yml`) — not by
  `pnpm typecheck` and not by `pnpm -r test`, which is DB-less by design.
  A green local run is not proof the database path works.
- Row types are hand-declared and can drift from the schema. See
  `type TraceRow` (`packages/control-plane/src/data/pg-data-source.ts:14`) and `type TokenRow`
  (`packages/control-plane/src/routes/ingest.ts:33`) — nothing links them to
  the actual columns.
- No automatic down-migrations. Rollback means writing a new forward
  migration, which is a deliberate constraint but a real cost during
  development.
- Better-Auth's schema is now a committed artifact this repo owns. A
  Better-Auth upgrade that changes its schema requires regenerating and
  hand-reviewing a new migration rather than letting the library migrate
  itself.
- Repetition. Every query restates its predicates; there is no place to
  centralise a filter. ADR-006 turns this cost into the isolation guarantee,
  but it is still repetition.

## Alternatives considered

- **Keep SQLite/JSONL for the hosted case.** Rejected, scored 4/10 in
  `docs/en/mvp3-architecture.md:135`: single file, poor concurrency, no
  multi-instance sharing, data loss on restart.
- **Prisma or Drizzle.** Rejected: a large dependency and a code-generation
  step to maintain, in exchange for type safety over roughly a dozen
  hand-written queries. It also hides the `WHERE project_id` predicate behind
  an abstraction at the exact point where visibility matters most.
- **Use Better-Auth's own migration mechanism alongside a separate runner for
  application tables.** Rejected: two migration systems means two sources of
  ordering truth, and the application tables have foreign keys into
  Better-Auth's, so the ordering between them must be explicit.

## Related ADRs

- ADR-001 — the dependency boundary this choice is constrained by
- ADR-005 — why Better-Auth needs a second, different Postgres pool
- ADR-006 — structural tenant isolation, which relies on hand-written SQL
