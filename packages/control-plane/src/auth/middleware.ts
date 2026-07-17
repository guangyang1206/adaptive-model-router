// Auth + project-scope middleware (impl-design §3). Runs for every request that
// is NOT /api/auth/*, /ingest/traces, or /health. Resolves:
//   session → user → { orgs, projects, roleByOrg, orgByProject }
// and attaches it as a request-scoped `AuthContext`. The specific 403 points
// (path-scoped :orgId/:projectId, and the reused dashboard currentProjectId) are
// enforced by the individual route handlers using the helpers in scope.ts —
// this module only produces the honest scope; it never widens it.

import type { IncomingMessage } from "node:http"
import type { Sql } from "../db/client.js"
import type { Auth } from "./better-auth.js"
import { getSession } from "./handler.js"
import { resolveScope, type Scope } from "./scope.js"

export type AuthUser = { id: string; email: string; name?: string; image?: string }

/** Request-scoped context handed to authenticated route handlers. */
export type AuthContext = {
  user: AuthUser
  scope: Scope
  /** Better-Auth's active org for the session, if any (drives default view). */
  activeOrganizationId?: string
}

/**
 * Resolve the auth context for a request, or null when unauthenticated.
 * Pure of routing — the caller decides 302 (HTML) vs 401 (API) on null.
 */
export async function resolveAuthContext(auth: Auth, sql: Sql, req: IncomingMessage): Promise<AuthContext | null> {
  const session = await getSession(auth, req)
  if (!session) return null
  const scope = await resolveScope(sql, session.user.id)
  return {
    user: session.user,
    scope,
    activeOrganizationId: session.session.activeOrganizationId ?? undefined,
  }
}

/** True when the request prefers an HTML response (page navigation). */
export function prefersHtml(req: IncomingMessage): boolean {
  const accept = req.headers["accept"]
  const value = Array.isArray(accept) ? accept.join(",") : accept ?? ""
  return value.includes("text/html")
}
