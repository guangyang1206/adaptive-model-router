# ADR-005 — Better-Auth gets its own node-postgres Pool; the control plane runs two pools

- Status: Accepted (2026-07-17)
- Deciders: maintainers
- Source commit: `9f73d5f` (MVP-3 control plane)
- Type: corrective — this replaced a first attempt that crashed

## Context

ADR-004 chose `postgres.js` as the control plane's driver. The obvious next
step was to hand the same `Sql` client to Better-Auth as its database, which
is what the first implementation did. It crashed on the first authenticated
request with `NOT_TAGGED_CALL`, observed in the real-Postgres CI job at
MVP-3 time against `better-auth@^1.2.0`.

The cause is in Better-Auth's adapter selection, and it is measurable in the
installed library rather than inferred. From
`@better-auth/kysely-adapter@1.6.23`, `dist/index.mjs`:

```js
function getKyselyDatabaseType(db) {
  ...
  if ("getConnection" in db) return "mysql";
  if ("connect" in db) return "postgres";
  ...
  return null;
}

const createKyselyAdapter = async (config) => {
  ...
  if ("connect" in db) dialect = new PostgresDialect({ pool: db });
  ...
  return { kysely: dialect ? new Kysely({ dialect }) : null, databaseType, ... };
};
```

So Postgres is detected by the presence of a `.connect` method, and the value
is wrapped as `new PostgresDialect({ pool: db })` — an interface only a
node-postgres `Pool` satisfies.

A `postgres.js` `Sql` client does not satisfy it. Probed directly against the
installed `postgres@3.x` client, of every key Better-Auth's detection tests for
(`connect`, `dialect`, `db`, `createDriver`, `aggregate`, `getConnection`,
`fileControl`, `createSession`, `batch`, `exec`, `prepare`, `open`), the only
one present is `close` — and the SQLite branch that uses `close` also requires
`open` and `prepare`. `getKyselyDatabaseType` therefore returns `null`, no
dialect is assigned, and `kysely` comes back `null`.

This is not a configuration error and there is no option that fixes it. The
two drivers expose incompatible interfaces and Better-Auth requires one of
them specifically.

**The symptom is version-dependent; the incompatibility is not.** On
`better-auth@1.6.23` the null adapter is caught at initialisation —
`dist/db/adapter-kysely.mjs` does
`if (!kysely) throw new BetterAuthError("Failed to initialize database adapter")`
— so today the same mistake fails fast and legibly at startup rather than with
`NOT_TAGGED_CALL` on the first auth query. A reader reproducing this on a
current version should expect the `BetterAuthError`, not the original symptom.
What has not changed is the underlying constraint: `postgres.js` cannot be
Better-Auth's database.

The failure mode is worth recording separately from the fix: it surfaced only
in the real-Postgres CI job. `pnpm -r test` is DB-less by design (ADR-004), so
the full local suite was green while the auth path was broken. Any
configuration bug in this area will behave the same way.

## Decision

The control plane holds two connection pools against the same
`DATABASE_URL`, both owned by `packages/control-plane/src/db/client.ts`:

- `getSql(databaseUrl)` (`packages/control-plane/src/db/client.ts:26`) — the `postgres.js` client, `max: 10`.
  Used for every query the application issues: traces, projects, tokens,
  dashboard scoping.
- `getPgPool(databaseUrl)` (`packages/control-plane/src/db/client.ts:42`) — a node-postgres `Pool`,
  `max: 5`. Used *only* as Better-Auth's database driver.

`createAuth` passes `getPgPool(config.databaseUrl)` as Better-Auth's
`database` (`packages/control-plane/src/auth/better-auth.ts:44`). The `sql`
parameter is retained for signature stability but auth no longer reads it
(`packages/control-plane/src/auth/better-auth.ts:36`).

The application data layer never touches `pg` (`packages/control-plane/src/db/client.ts:11`).

`closeSql()` (`packages/control-plane/src/db/client.ts:50-59`) shuts down both pools and resets both
singletons, so tests and graceful shutdown cannot leave one pool open.

`pg` is added to the control-plane dependency allowlist with the reason
recorded inline at `scripts/check-dependency-boundary.mjs:8-11`, so the
exception is visible at the gate rather than only in this file.

## Consequences

Positive:

- Auth works, and the round-trip is proved against a real `postgres:17`
  service container in the `control-plane-integration` CI job, not asserted.
- The application keeps `postgres.js` — a driver with no transitive
  dependencies and built-in pooling — for all of its own queries, so ADR-004
  is unaffected.
- Both pools share one `DATABASE_URL`, so there is still a single
  configuration input and a single database. Nothing to keep in sync
  operationally.
- Failure is loud and early rather than partial: both pools are created from
  the same validated env var at boot.

Negative — this is the cost being accepted, and it is real:

- **Two pools mean two connection budgets against one Postgres.** The
  control plane consumes up to 15 connections (10 + 5) where one pool would
  need fewer. On a managed Postgres with a low connection cap, or when
  running several control-plane replicas, this is the number to look at
  first. The two `max` values are deliberately modest for that reason
  (`packages/control-plane/src/db/client.ts:31`, `packages/control-plane/src/db/client.ts:44`), and they are the correct tuning point —
  not the pool count.
- **Transactions cannot span auth and application data.** A flow that needs
  to write a Better-Auth row and an application row atomically cannot; they
  are different connections. No current flow requires it, and that is a
  constraint on future design, not a bug to fix.
- **Two drivers to keep current, with different failure signatures.** A
  connection problem surfaces differently depending on which pool hit it, so
  diagnosis starts with identifying the pool.
- **The reason is invisible at the call site.** `database: getPgPool(...)`
  looks like an arbitrary choice. Without the comment block at
  `packages/control-plane/src/auth/better-auth.ts:4-11`, a contributor consolidating "duplicate" pool code
  would reintroduce the exact crash this decision fixes — and the full local
  test suite would stay green while doing it.

The cost is accepted because the alternatives are worse. This is not an
elegant arrangement; it is the arrangement Better-Auth's adapter requires.

## Alternatives considered

- **Pass the `postgres.js` `Sql` client to Better-Auth.** This was the first
  implementation. It does not work — Better-Auth's detection cannot recognise
  it, so no dialect is built. On `^1.2.0` that surfaced as `NOT_TAGGED_CALL` on
  the first auth query; on `1.6.23` it is a `BetterAuthError` at
  initialisation. Not a trade-off — it fails either way.
- **Migrate the whole control plane to node-postgres and drop postgres.js.**
  Would leave one pool and one driver. Rejected: it means rewriting every
  hand-written tagged-template query in `scope.ts`, `pg-data-source.ts`,
  `pg-trace-store.ts`, `ingest.ts` and the migration runner into parameterised
  `pool.query(text, values)` calls — a large diff through the exact code that
  carries the tenant-isolation guarantee (ADR-006), in exchange for removing
  one dependency. The risk is concentrated in the worst possible place.
- **Write an adapter that gives the postgres.js client a `.connect` method.**
  Rejected: it means shimming Kysely's `PostgresDialect` contract —
  `connect()`, `release()`, transaction semantics — against a driver with a
  different model. That is a bug farm in the authentication path, maintained
  against Better-Auth's internals rather than its public API.
- **A separate database for auth.** Rejected: it adds an operational input
  and removes the ability to foreign-key application tables to Better-Auth
  ids, which `0002_init.sql` relies on (ADR-004).

## Related ADRs

- ADR-004 — postgres.js and hand-written migrations, which this decision
  preserves for application queries
- ADR-001 — the dependency allowlist that `pg` is an explicit exception to
