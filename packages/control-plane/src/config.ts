// Typed config object derived from the raw environment. Centralizes defaults
// (port/host, registration policy, base paths) so the rest of the code reads a
// clean, validated shape instead of poking process.env.

import { loadEnv, type RawEnv } from "./env.js"

export type GithubOAuthConfig = {
  clientId: string
  clientSecret: string
}

export type ControlPlaneConfig = {
  databaseUrl: string
  authSecret: string
  /** Public base URL of this deployment, e.g. https://cp.example.com */
  baseUrl: string
  port: number
  host: string
  /** Where Better-Auth routes are mounted. Fixed for MVP-3. */
  authBasePath: string
  /** Full public ingest endpoint URL shown in onboarding/api-keys snippets. */
  ingestUrl: string
  github?: GithubOAuthConfig
  /**
   * Whether NEW registrations are allowed at boot. The runtime toggle
   * (owner-only, persisted) can override this per-org; this is the default the
   * first-boot flow reads.
   */
  registrationOpen: boolean
}

export const AUTH_BASE_PATH = "/api/auth"

export function buildConfig(env: RawEnv = loadEnv()): ControlPlaneConfig {
  const port = env.PORT ? Number(env.PORT) : 3000
  const host = env.HOST ?? "0.0.0.0"
  const baseUrl = env.BETTER_AUTH_URL.replace(/\/+$/, "")
  const github =
    env.GITHUB_CLIENT_ID && env.GITHUB_CLIENT_SECRET
      ? { clientId: env.GITHUB_CLIENT_ID, clientSecret: env.GITHUB_CLIENT_SECRET }
      : undefined
  return {
    databaseUrl: env.DATABASE_URL,
    authSecret: env.BETTER_AUTH_SECRET,
    baseUrl,
    port: Number.isFinite(port) && port > 0 ? port : 3000,
    host,
    authBasePath: AUTH_BASE_PATH,
    ingestUrl: `${baseUrl}/ingest/traces`,
    github,
    // Default open (first registrant becomes owner, A1). Set REGISTRATION_OPEN=false
    // to lock a fresh instance down before the first user registers.
    registrationOpen: env.REGISTRATION_OPEN !== "false",
  }
}
