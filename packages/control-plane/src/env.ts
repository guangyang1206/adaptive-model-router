// Environment loading with fail-fast, human-readable errors (acceptance A14:
// "Required env var missing at deploy → clear error naming the missing var").
//
// No dependency; reads process.env directly. `loadEnv()` throws a MissingEnvError
// that the server bootstrap surfaces before binding a port.

export class MissingEnvError extends Error {
  constructor(public readonly variable: string) {
    super(
      `Missing required environment variable: ${variable}. ` +
        `Set it (see deploy/.env.example) and restart. The control plane will not boot without it.`,
    )
    this.name = "MissingEnvError"
  }
}

export type RawEnv = {
  DATABASE_URL: string
  BETTER_AUTH_SECRET: string
  BETTER_AUTH_URL: string
  PORT?: string
  HOST?: string
  GITHUB_CLIENT_ID?: string
  GITHUB_CLIENT_SECRET?: string
  REGISTRATION_OPEN?: string
}

function required(name: keyof RawEnv): string {
  const value = process.env[name]
  if (value === undefined || value === "") throw new MissingEnvError(name)
  return value
}

function optional(name: keyof RawEnv): string | undefined {
  const value = process.env[name]
  return value === undefined || value === "" ? undefined : value
}

/**
 * Read + validate env. Throws MissingEnvError (naming the variable) on the
 * first required var that is absent. Order matters only for which name is
 * reported first — DATABASE_URL then BETTER_AUTH_SECRET are the two hard gates.
 */
export function loadEnv(): RawEnv {
  const DATABASE_URL = required("DATABASE_URL")
  const BETTER_AUTH_SECRET = required("BETTER_AUTH_SECRET")
  // BETTER_AUTH_URL is required for OAuth callback + cookie domain correctness.
  const BETTER_AUTH_URL = required("BETTER_AUTH_URL")
  return {
    DATABASE_URL,
    BETTER_AUTH_SECRET,
    BETTER_AUTH_URL,
    PORT: optional("PORT"),
    HOST: optional("HOST"),
    GITHUB_CLIENT_ID: optional("GITHUB_CLIENT_ID"),
    GITHUB_CLIENT_SECRET: optional("GITHUB_CLIENT_SECRET"),
    REGISTRATION_OPEN: optional("REGISTRATION_OPEN"),
  }
}
