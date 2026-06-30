import test from "node:test"
import assert from "node:assert/strict"
import {
  createReadOnlyDataAccess,
  applyRequestFilter,
  buildModelComparison,
} from "../dist/index.js"

// A small fixture of traces + models covering the filter/compare surface.
function makeSource() {
  const traces = [
    { traceId: "trace_a", decisionId: "d_a", chosenModel: "openai/gpt-4o", candidates: [], reason: "r", attempts: [{ status: "success", latencyMs: 10 }], usage: { totalTokens: 12, costUsd: 0 }, estimated: true, latencyMs: 10, status: "success" },
    { traceId: "trace_b", decisionId: "d_b", chosenModel: "anthropic/claude", candidates: [], reason: "r", attempts: [{ status: "failed" }, { status: "success", latencyMs: 20 }], usage: { totalTokens: 30, costUsd: 0 }, estimated: true, latencyMs: 20, status: "fallback_success" },
    { traceId: "trace_c", decisionId: "d_c", chosenModel: "openai/gpt-4o-mini", candidates: [], reason: "r", attempts: [{ status: "failed" }], usage: { totalTokens: 5, costUsd: 0 }, estimated: true, latencyMs: 5, status: "failed" },
  ]
  const models = [
    { id: "openai/gpt-4o", provider: "openai", type: "commercial", capabilities: ["reasoning", "tool-calling", "vision"], health: { status: "ok", latencyP50Ms: 300 }, cost: { inputPer1M: 5, outputPer1M: 15, estimated: false }, enabled: true },
    { id: "local/llama", provider: "vllm", type: "self-hosted", capabilities: ["reasoning"], health: { status: "unknown" }, cost: { inputPer1M: 0, outputPer1M: 0, estimated: true }, enabled: true },
  ]
  return { listTraces: () => traces, listModels: () => models }
}

test("applyRequestFilter is a pure no-op without a filter", () => {
  const rows = [{ requestId: "x", status: "success", fallbacks: 0 }]
  assert.deepEqual(applyRequestFilter(rows), rows)
  assert.deepEqual(applyRequestFilter(rows, {}), rows)
})

test("applyRequestFilter filters by status, model, search, and limit", () => {
  const rows = [
    { requestId: "trace_a", status: "success", selectedModel: "openai/gpt-4o", fallbacks: 0 },
    { requestId: "trace_b", status: "failed", selectedModel: "anthropic/claude", fallbacks: 1 },
    { requestId: "trace_c", status: "success", selectedModel: "openai/gpt-4o-mini", fallbacks: 0 },
  ]
  assert.deepEqual(applyRequestFilter(rows, { status: "failed" }).map((r) => r.requestId), ["trace_b"])
  assert.deepEqual(applyRequestFilter(rows, { model: "openai" }).map((r) => r.requestId), ["trace_a", "trace_c"])
  assert.deepEqual(applyRequestFilter(rows, { search: "claude" }).map((r) => r.requestId), ["trace_b"])
  assert.equal(applyRequestFilter(rows, { limit: 2 }).length, 2)
  // Combined filters intersect.
  assert.deepEqual(applyRequestFilter(rows, { status: "success", model: "mini" }).map((r) => r.requestId), ["trace_c"])
})

test("listRequests applies the filter end to end through the data access layer", async () => {
  const data = createReadOnlyDataAccess(makeSource())
  const all = await data.listRequests()
  assert.equal(all.length, 3)
  const failed = await data.listRequests({ status: "failed" })
  assert.deepEqual(failed.map((r) => r.requestId), ["trace_c"])
  const openai = await data.listRequests({ model: "openai" })
  assert.equal(openai.length, 2)
})

test("buildModelComparison unions capabilities and marks per-model support", () => {
  const models = [
    { modelId: "a", provider: "p", type: "commercial", capabilities: ["reasoning", "vision"], health: "ok", enabled: true },
    { modelId: "b", provider: "p", type: "open-source", capabilities: ["reasoning", "tool-calling"], health: "ok", enabled: true },
  ]
  const cmp = buildModelComparison(models, ["a", "b"])
  // Capability rows are the sorted union.
  assert.deepEqual(cmp.capabilityMatrix.map((row) => row.capability), ["reasoning", "tool-calling", "vision"])
  const byCap = Object.fromEntries(cmp.capabilityMatrix.map((row) => [row.capability, row.support]))
  assert.deepEqual(byCap.reasoning, [true, true])
  assert.deepEqual(byCap["tool-calling"], [false, true])
  assert.deepEqual(byCap.vision, [true, false])
  assert.equal(cmp.models.length, 2)
  assert.ok(cmp.models.every((m) => m.found))
})

test("buildModelComparison keeps a column for unknown ids (found: false)", () => {
  const cmp = buildModelComparison([], ["ghost/model"])
  assert.equal(cmp.models.length, 1)
  assert.equal(cmp.models[0].found, false)
  assert.equal(cmp.models[0].modelId, "ghost/model")
  assert.deepEqual(cmp.capabilityMatrix, [])
})

test("compareModels resolves real models through the data access layer", async () => {
  const data = createReadOnlyDataAccess(makeSource())
  const cmp = await data.compareModels(["openai/gpt-4o", "local/llama", "missing/one"])
  assert.equal(cmp.models.length, 3)
  assert.equal(cmp.models[0].found, true)
  assert.equal(cmp.models[0].provider, "openai")
  assert.equal(cmp.models[2].found, false)
  // gpt-4o advertises tool-calling, llama does not, missing has nothing.
  const toolRow = cmp.capabilityMatrix.find((row) => row.capability === "tool-calling")
  assert.deepEqual(toolRow.support, [true, false, false])
})
