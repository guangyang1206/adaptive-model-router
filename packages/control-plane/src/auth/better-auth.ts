// Better-Auth instance (Spec §3): email + password, GitHub OAuth (optional),
// and the `organization` plugin (owns organization/member/invitation tables).
//
// The database is wired via postgres.js — Better-Auth accepts a `postgres`
// (Sql) instance through its Kysely/dialect-free adapter option. We pass our
// existing pooled client so there is ONE connection pool for the whole service.
//
// This is the ONLY place better-auth is constructed. The emitted SQL schema is
// committed as 0001_better_auth.sql and applied by OUR migration runner, so we
// disable Better-Auth's own runtime auto-migration.

import { betterAuth } from "better-auth"
import { organization } from "better-auth/plugins"
import type { Sql } from "../db/client.js"
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
 * Build the Better-Auth instance from config + the shared postgres.js client.
 * GitHub social login is enabled only when both client id + secret are present
 * (Spec: GitHub OAuth optional; email/password is the always-on baseline).
 */
export function createAuth(sql: Sql, config: ControlPlaneConfig) {
  return betterAuth({
    // Pass the pooled postgres.js instance directly; Better-Auth's built-in
    // adapter understands a `postgres` Sql client.
    database: sql,
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
