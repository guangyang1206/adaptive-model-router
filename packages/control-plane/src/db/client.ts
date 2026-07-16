// postgres.js client singleton. The ONLY place the driver is instantiated.
// postgres.js is a genuinely 0-transitive-dependency driver with built-in
// pooling; we pass the DATABASE_URL straight through.

import postgres from "postgres"

export type Sql = ReturnType<typeof postgres>

let client: Sql | undefined

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

/** Close the pool (tests / graceful shutdown). Resets the singleton. */
export async function closeSql(): Promise<void> {
  if (client) {
    await client.end({ timeout: 5 })
    client = undefined
  }
}
