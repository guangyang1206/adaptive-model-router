// Project-scoped DashboardDataSource (impl-design §5.2). Fed into the dashboard's
// createReadOnlyDataAccess() so the reused 12 /api/* endpoints become
// multi-tenant with ZERO changes to the dashboard. The scope (project_id) is a
// constructor argument, not a per-query option — the query can never be issued
// without the predicate (structural A4/A5/A6 guarantee).
//
// Mapping targets the DASHBOARD types (DashboardTrace/DashboardModel), which are
// close-but-not-identical to the SDK RouterTrace (impl-design ground-truth §3).

import type { DashboardDataSource, DashboardTrace } from "@adaptive-router/dashboard"
import type { RouterTrace } from "@adaptive-router/sdk"
import type { Sql } from "../db/client.js"

type TraceRow = { trace_json: RouterTrace }

/** Map a stored RouterTrace (trace_json) to the dashboard's DashboardTrace. */
function toDashboardTrace(t: RouterTrace): DashboardTrace {
  return {
    traceId: t.traceId,
    decisionId: t.decisionId,
    chosenModel: t.chosenModel,
    candidates: t.candidates,
    reason: t.reason,
    attempts: t.attempts.map((a) => ({ status: a.status, latencyMs: a.latencyMs })),
    usage: t.usage,
    estimatedCostUsd: t.estimatedCostUsd,
    estimated: t.estimated,
    latencyMs: t.latencyMs,
    status: t.status,
  }
}

/**
 * Single-project data source. `store` is left UNDEFINED (Ruling 3): /evals
 * /cache /learning fall back to the dashboard's honest empty/demo readers.
 * listModels returns [] (Spec §5 has no models table — Models page shows the
 * empty state).
 */
export function createPgDashboardDataSource(sql: Sql, projectId: string): DashboardDataSource {
  return {
    async listTraces(): Promise<DashboardTrace[]> {
      const rows = await sql<TraceRow[]>`
        SELECT trace_json FROM router_traces
        WHERE project_id = ${projectId}
        ORDER BY created_at DESC
      `
      return rows.map((r) => toDashboardTrace(r.trace_json))
    },
    listModels() {
      return []
    },
    // store: undefined — Ruling 3.
  }
}

/**
 * Org-level "All projects" aggregate data source (impl-design §3.3). Scopes over
 * project_id IN (accessibleProjects) so the aggregate can NEVER exceed the
 * membership set. An empty list yields an empty result (no rows), never a table
 * scan across all projects.
 */
export function createPgDashboardDataSourceForProjects(sql: Sql, projectIds: string[]): DashboardDataSource {
  return {
    async listTraces(): Promise<DashboardTrace[]> {
      if (projectIds.length === 0) return []
      const rows = await sql<TraceRow[]>`
        SELECT trace_json FROM router_traces
        WHERE project_id IN ${sql(projectIds)}
        ORDER BY created_at DESC
      `
      return rows.map((r) => toDashboardTrace(r.trace_json))
    },
    listModels() {
      return []
    },
  }
}
