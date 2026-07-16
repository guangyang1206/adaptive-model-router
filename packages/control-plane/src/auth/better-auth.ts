// Better-Auth instance (Spec §3): email + password, GitHub OAuth (optional),
// and the `organization` plugin (owns organization/member/invitation tables).
//
// DB wiring: Better-Auth 1.6's Kysely adapter detects Postgres via
// `"connect" in db` and wraps the value as `new PostgresDialect({ pool: db })`,
// i.e. it requires a node-postgres `pg.Pool`. A bare postgres.js `Sql` client
// has no `.connect`, so passing it makes Better-Auth fall through its driver
// detection and crash with `NOT_TAGGED_CALL` on the first auth query (caught by
// the real-Postgres CI round-trip). So we give Better-Auth a dedicated pg.Pool
// (via getPgPool) — while EVERY one of our own queries still runs through
// postgres.js. Both pools share the same DATABASE_URL.
//
// This is the ONLY place better-auth is constructed. The emitted SQL schema is
// committed as 0001_better_auth.sql and applied by OUR migration runner, so we
// disable Better-Auth's own runtime auto-migration.

import { betterAuth } from "better-auth"
import { organization } from "better-auth/plugins"
import type { Sql } from "../db/client.js"
import { getPgPool } from "../db/client.js"
import type { ControlPlaneConfig } from "../config.js"

/**
 * The concrete Better-Auth instance type for this app. Derived from
 * `createAuth`'s own return so it carries the exact plugin/option generics the
 * call infers — annotating with the wide `ReturnType<typeof betterAuth>`
 * (i.e. `Auth<BetterAuthOptions>`) is REJECTED by the compiler because the
 * literal option object narrows `database` to required. Deriving from the
 * factory keeps handler.ts/scope.ts consumers on the real shape.
 */
export type Auth = ReturnType<typeof createAuth>

/**
 * Build the Better-Auth instance from config. Better-Auth is backed by a
 * node-postgres Pool (see file header for why postgres.js can't be used here);
 * the `sql` param is retained for signature stability / future use but auth
 * itself no longer reads it. GitHub social login is enabled only when both
 * client id + secret are present (Spec: GitHub OAuth optional; email/password
 * is the always-on baseline).
 */
export function createAuth(_sql: Sql, config: ControlPlaneConfig) {
  return betterAuth({
    // node-postgres Pool — Better-Auth wraps it as PostgresDialect({ pool }).
    database: getPgPool(config.databaseUrl),
    secret: config.authSecret,
    baseURL: config.baseUrl,
    basePath: config.authBasePath,
    emailAndPassword: {
      enabled: true,
      // Registration open/close is enforced in our sign-up guard (A1); Better-Auth
      // itself allows sign-up, we gate it at the route layer.
    },
    socialProviders: config.github
      ? {
          github: {
            clientId: config.github.clientId,
            clientSecret: config.github.clientSecret,
          },
        }
      : {},
    plugins: [
      organization({
        // First registrant becomes owner of a bootstrap org (A1) — handled in
        // the onboarding/org-create flow, not here. Defaults: creator = owner.
        allowUserToCreateOrganization: true,
      }),
    ],
  })
}
