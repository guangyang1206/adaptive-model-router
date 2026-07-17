// postgres.js client singleton. The ONLY place the postgres.js driver is
// instantiated. postgres.js is a genuinely 0-transitive-dependency driver with
// built-in pooling; we pass the DATABASE_URL straight through and use it for
// EVERY one of our own queries (traces, projects, tokens, dashboard scoping).
//
// Separately, a node-postgres `pg.Pool` singleton backs Better-Auth ONLY.
// Better-Auth 1.6's Kysely adapter detects Postgres via `"connect" in db` and
// wraps it as `new PostgresDialect({ pool: db })`, which requires the
// node-postgres Pool interface. A bare postgres.js `Sql` has no `.connect`, so
// it falls through and crashes with NOT_TAGGED_CALL on the first auth query.
// The two pools point at the same DATABASE_URL; our data layer never touches pg.

import postgres from "postgres"
import { Pool } from "pg"

export type Sql = ReturnType<typeof postgres>

let client: Sql | undefined
let pgPool: Pool | undefined

/**
 * Create (or return the existing) postgres.js client. Pooling is handled by the
 * driver. `onnotice` is silenced so benign NOTICE spam (e.g. IF NOT EXISTS)
 * doesn't flood logs.
 */
export function getSql(databaseUrl: string): Sql {
  if (!client) {
    client = postgres(databaseUrl, {
      onnotice: () => {},
      // Keep the pool modest; a starter team control plane is not high-QPS.
      max: 10,
    })
  }
  return client
}

/**
 * Create (or return the existing) node-postgres Pool used SOLELY as the
 * Better-Auth database driver. Kept modest — auth traffic is low-QPS and our
 * own queries go through postgres.js, not this pool.
 */
export function getPgPool(databaseUrl: string): Pool {
  if (!pgPool) {
    pgPool = new Pool({ connectionString: databaseUrl, max: 5 })
  }
  return pgPool
}

/** Close both pools (tests / graceful shutdown). Resets the singletons. */
export async function closeSql(): Promise<void> {
  if (client) {
    await client.end({ timeout: 5 })
    client = undefined
  }
  if (pgPool) {
    await pgPool.end()
    pgPool = undefined
  }
}
