// Project-scoped Postgres trace store implementing the SDK's ExtendedTraceStore
// (impl-design §5.3). The project_id is baked in at construction — every query
// hard-codes WHERE project_id = $1, so there is NO code path that reads across
// projects (structural guarantee behind A4/A5/A6).
//
// Only the trace-reading half is implemented. The Mvp2StoreExtension methods
// (evals/cache/learning) are left UNIMPLEMENTED per Ruling 3 (honest empty
// state; do not stub fake data). The SDK dashboard-readers guard each optional
// method with safeCall(), so an ExtendedTraceStore with only trace methods is
// 100% valid and /evals /cache /learning degrade to empty gracefully.

import type { ExtendedTraceStore, RouterTrace, StoredRequest } from "@adaptive-router/sdk"
import type { JSONValue } from "postgres"
import type { Sql } from "../db/client.js"

/** A router_traces row shape (the columns we read back). */
type TraceRow = {
  trace_json: RouterTrace
  created_at: string
}

/** Map a stored RouterTrace (from trace_json) to a StoredRequest. */
function traceToStoredRequest(trace: RouterTrace, createdAt?: string): StoredRequest {
  return {
    traceId: trace.traceId,
    decisionId: trace.decisionId,
    status: trace.status,
    chosenModel: trace.chosenModel,
    reason: trace.reason,
    attempts: trace.attempts,
    usage: trace.usage,
    estimated: trace.estimated,
    latencyMs: trace.latencyMs,
    createdAt,
  }
}

/**
 * Build a project-scoped trace store. Used both by the ingest path (writeTrace)
 * and, indirectly, as the DashboardDataSource.store (left undefined per Ruling
 * 3, but the reader half here powers the Requests page via pg-data-source).
 */
export function createPostgresTraceStore(sql: Sql, projectId: string): ExtendedTraceStore {
  return {
    async writeTrace(trace: RouterTrace): Promise<void> {
      const usage = trace.usage
      await sql`
        INSERT INTO router_traces (
          trace_id, project_id, decision_id, status, chosen_model, reason,
          latency_ms, estimated, estimated_cost_usd,
          input_tokens, output_tokens, total_tokens, trace_json
        ) VALUES (
          ${trace.traceId}, ${projectId}, ${trace.decisionId}, ${trace.status},
          ${trace.chosenModel ?? null}, ${trace.reason}, ${trace.latencyMs ?? null},
          ${trace.estimated}, ${trace.estimatedCostUsd ?? usage?.costUsd ?? null},
          ${usage?.inputTokens ?? null}, ${usage?.outputTokens ?? null},
          ${usage?.totalTokens ?? null}, ${sql.json(trace as unknown as JSONValue)}
        )
        ON CONFLICT (trace_id) DO NOTHING
      `
    },

    async listTraces(): Promise<RouterTrace[]> {
      const rows = await sql<TraceRow[]>`
        SELECT trace_json, created_at FROM router_traces
        WHERE project_id = ${projectId}
        ORDER BY created_at DESC
      `
      return rows.map((r) => r.trace_json)
    },

    async listRequests(): Promise<StoredRequest[]> {
      const rows = await sql<TraceRow[]>`
        SELECT trace_json, created_at FROM router_traces
        WHERE project_id = ${projectId}
        ORDER BY created_at DESC
      `
      return rows.map((r) => traceToStoredRequest(r.trace_json, r.created_at))
    },

    async getRequest(traceId: string): Promise<StoredRequest | undefined> {
      // Scope + id: a cross-project id probe returns undefined, never another
      // project's row (A6 — no leak).
      const rows = await sql<TraceRow[]>`
        SELECT trace_json, created_at FROM router_traces
        WHERE project_id = ${projectId} AND trace_id = ${traceId}
        LIMIT 1
      `
      const row = rows[0]
      return row ? traceToStoredRequest(row.trace_json, row.created_at) : undefined
    },

    // Mvp2StoreExtension.* intentionally omitted (Ruling 3): /evals /cache
    // /learning render honest empty state via the SDK readers' safeCall guards.
  }
}
