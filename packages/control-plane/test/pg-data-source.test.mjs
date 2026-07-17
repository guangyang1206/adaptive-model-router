// DB-less tests for the project-scoped dashboard data source (Ruling 5). Uses a
// stub `sql` that records the interpolated project id(s) and returns canned
// trace rows, asserting:
//   - listTraces maps trace_json → DashboardTrace faithfully,
//   - the project id is ALWAYS interpolated (scope is baked in, A4/A6),
//   - listModels returns [] and store is undefined (Ruling 3),
//   - the multi-project aggregate returns [] for an empty project set (never a
//     global scan).

import { test } from "node:test"
import assert from "node:assert/strict"
import {
  createPgDashboardDataSource,
  createPgDashboardDataSourceForProjects,
} from "../dist/data/pg-data-source.js"

const sampleTrace = {
  traceId: "tr_1",
  decisionId: "dec_1",
  chosenModel: "gpt-x",
  candidates: [{ modelId: "gpt-x", provider: "openai", score: 90, reasons: [] }],
  reason: "best tier match",
  attempts: [{ attemptNo: 1, modelId: "gpt-x", provider: "openai", status: "success", latencyMs: 42 }],
  usage: { inputTokens: 10, outputTokens: 5, totalTokens: 15, estimated: true },
  estimatedCostUsd: 0.0001,
  estimated: true,
  latencyMs: 42,
  status: "success",
}

/**
 * Stub sql tag. Records every interpolated value (so we can assert the project
 * id is present) and returns `rows` for any SELECT. Distinguishes the two call
 * shapes: a tagged-template call (first arg is the template strings array, which
 * carries a `.raw`) vs. the `sql(array)` IN-clause helper (a plain array).
 */
function stubSql(rows) {
  const interpolated = []
  const wrapped = (first, ...values) => {
    const isTemplate = Array.isArray(first) && "raw" in Object(first)
    if (!isTemplate && Array.isArray(first)) {
      // sql(projectIds) IN-clause helper: capture + return the array verbatim.
      interpolated.push(first)
      return first
    }
    // Tagged-template query: capture interpolated values, return rows.
    interpolated.push(...values)
    return Promise.resolve(rows)
  }
  wrapped._interpolated = interpolated
  return wrapped
}

test("createPgDashboardDataSource maps trace_json → DashboardTrace and scopes by project", async () => {
  const sql = stubSql([{ trace_json: sampleTrace }])
  const ds = createPgDashboardDataSource(sql, "proj_42")
  const traces = await ds.listTraces()

  assert.equal(traces.length, 1)
  const t = traces[0]
  assert.equal(t.traceId, "tr_1")
  assert.equal(t.decisionId, "dec_1")
  assert.equal(t.chosenModel, "gpt-x")
  assert.equal(t.status, "success")
  assert.equal(t.latencyMs, 42)
  assert.equal(t.estimatedCostUsd, 0.0001)
  // attempts are projected down to { status, latencyMs }
  assert.deepEqual(t.attempts, [{ status: "success", latencyMs: 42 }])
  // scope baked in: the project id was interpolated into the query.
  assert.ok(sql._interpolated.includes("proj_42"))
})

test("createPgDashboardDataSource: listModels is [] and store is undefined (Ruling 3)", () => {
  const sql = stubSql([])
  const ds = createPgDashboardDataSource(sql, "p")
  assert.deepEqual(ds.listModels(), [])
  assert.equal(ds.store, undefined)
})

test("multi-project aggregate returns [] for an empty project set (no global scan)", async () => {
  const sql = stubSql([{ trace_json: sampleTrace }])
  const ds = createPgDashboardDataSourceForProjects(sql, [])
  const traces = await ds.listTraces()
  assert.deepEqual(traces, [])
})

test("multi-project aggregate scopes over the provided project ids", async () => {
  const sql = stubSql([{ trace_json: sampleTrace }])
  const ds = createPgDashboardDataSourceForProjects(sql, ["p1", "p2"])
  const traces = await ds.listTraces()
  assert.equal(traces.length, 1)
  // the project-id array was interpolated (via sql(projectIds))
  assert.ok(sql._interpolated.some((v) => Array.isArray(v) && v.includes("p1")))
})
