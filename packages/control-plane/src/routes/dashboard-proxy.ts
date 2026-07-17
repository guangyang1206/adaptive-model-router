// Reused dashboard /api/* proxy (impl-design §5.4, Ruling 4). The 12 read-only
// dashboard API routes are reused UNCHANGED by delegating to the dashboard's
// exported pure dispatcher `dispatchApiRequest`, fed a PROJECT-SCOPED data
// source. The scope (project_id) is baked into the data source at construction
// (§3.2), so a query for another project's data can never even be issued.
//
// currentProjectId resolution (§3.1 step 5):
//   - `?project=<id>` query param (App Shell project switcher), OR
//   - the org-level "All projects" aggregate when `?org=<id>` (no project),
//     scoped to project_id IN (accessible projects of that org).
// Point B 403 (§3.3): a requested project not in the accessible set → 403, no
// data source is ever built for it.

import type { ServerResponse } from "node:http"
import { createReadOnlyDataAccess, dispatchApiRequest } from "@adaptive-router/dashboard"
import type { Sql } from "../db/client.js"
import type { AuthContext } from "../auth/middleware.js"
import { canAccessProject, isOrgMember } from "../auth/scope.js"
import { createPgDashboardDataSource, createPgDashboardDataSourceForProjects } from "../data/pg-data-source.js"
import { ok, err } from "../envelope.js"

type SendJson = (res: ServerResponse, status: number, body: unknown) => void

/**
 * Handle a reused dashboard /api/* path. Returns true when handled (including
 * the 403 case). Returns false when `pathname` is not one of the 12 dashboard
 * API routes (so the server can fall through to page rendering / 404).
 */
export async function handleDashboardApi(
  sql: Sql,
  ctx: AuthContext,
  pathname: string,
  searchParams: URLSearchParams,
  res: ServerResponse,
  sendJson: SendJson,
): Promise<boolean> {
  // Only claim /api/* paths that are NOT the auth or management families.
  if (!pathname.startsWith("/api/")) return false
  if (pathname.startsWith("/api/auth/")) return false
  if (pathname.startsWith("/api/orgs")) return false
  if (pathname.startsWith("/api/projects/")) return false

  const projectId = searchParams.get("project") ?? undefined
  const orgId = searchParams.get("org") ?? undefined

  // Build the project-scoped (or org-aggregate) data source with a validated
  // scope. Any failure to authorize returns BEFORE a data source exists.
  let dataAccess
  if (projectId) {
    // Point B: cross-project id → 403, no data source built (A6, no leak).
    if (!canAccessProject(ctx.scope, projectId)) {
      sendJson(res, 403, err("forbidden"))
      return true
    }
    dataAccess = createReadOnlyDataAccess(createPgDashboardDataSource(sql, projectId))
  } else if (orgId) {
    if (!isOrgMember(ctx.scope, orgId)) {
      sendJson(res, 403, err("forbidden"))
      return true
    }
    // Aggregate over exactly the accessible projects in that org — never wider.
    const projectIds = ctx.scope.projects.filter((id) => ctx.scope.orgByProject[id] === orgId)
    dataAccess = createReadOnlyDataAccess(createPgDashboardDataSourceForProjects(sql, projectIds))
  } else {
    // No scope selected: aggregate over ALL of the user's accessible projects.
    // Still bounded by membership (empty set ⇒ empty result), never a global scan.
    dataAccess = createReadOnlyDataAccess(createPgDashboardDataSourceForProjects(sql, ctx.scope.projects))
  }

  const result = await dispatchApiRequest(pathname, searchParams, dataAccess)
  if (!result) return false // not one of the 12 dashboard API routes

  // dispatchApiRequest returns { status, data }; wrap in our envelope. For 404
  // etc. the dashboard uses { error }, we surface it as an ERROR envelope so the
  // response shape stays uniform with the rest of the control plane (Ruling 1).
  if (result.status >= 400) {
    const message = typeof (result.data as { error?: unknown })?.error === "string" ? (result.data as { error: string }).error : "request failed"
    sendJson(res, result.status, err(message))
  } else {
    sendJson(res, result.status, ok(result.data))
  }
  return true
}
