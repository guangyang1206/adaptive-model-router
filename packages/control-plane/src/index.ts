// Public entry for @adaptive-router/control-plane. Exposes createControlPlane()
// (bootstrap + listen in one call) plus the types an embedder/operator needs.
// The `bin` (dist/server.js) boots directly; this module is the programmatic API.

import { bootstrap, createRequestHandler, type ControlPlaneServer } from "./server.js"
import { buildConfig, type ControlPlaneConfig } from "./config.js"

export type { ControlPlaneConfig, ControlPlaneServer }
export { buildConfig, bootstrap, createRequestHandler }
export { loadEnv, MissingEnvError, type RawEnv } from "./env.js"
export { getSql, getPgPool, closeSql, type Sql } from "./db/client.js"
export { runMigrations, migrationStatus } from "./db/migrate.js"
export { createAuth, type Auth } from "./auth/better-auth.js"
export { resolveScope, type Scope } from "./auth/scope.js"
export { createPostgresTraceStore } from "./data/pg-trace-store.js"
export { createPgDashboardDataSource, createPgDashboardDataSourceForProjects } from "./data/pg-data-source.js"
export { generateToken, hashToken, verifyToken, maskToken } from "./tokens.js"
export { ok, err, type Envelope } from "./envelope.js"

/**
 * Boot the control plane and start listening. One call for the common case:
 *   await createControlPlane()   // reads env, migrates, serves on PORT
 *
 * Returns the running handle ({ url, close }). Throws (fail-fast) on a missing
 * env var or a failed migration before any port is bound (A14/A8).
 */
export async function createControlPlane(config: ControlPlaneConfig = buildConfig()): Promise<{ url: string; close: () => Promise<void> }> {
  const server: ControlPlaneServer = await bootstrap(config)
  return server.listen()
}
