import test from "node:test"
import assert from "node:assert/strict"
import {
  createRouter,
  createStaticProvider,
  loadDataset,
  validateCase,
  runEval,
  computeMetrics,
  evaluateCase,
  compareToBaseline,
  gateAgainstBaseline,
  formatRegressionReport,
} from "../dist/index.js"

const cheapModel = {
  id: "local/cheap", provider: "local", model: "cheap", type: "self-hosted", kind: "self-hosted",
  capabilities: ["reasoning", "streaming"], tier: "balanced", contextWindow: 8192, enabled: true,
  latencyClass: "low", cost: { inputPer1M: 0, outputPer1M: 0, estimated: true }, health: { status: "ok", successRate: 0.95 },
}
const strongModel = {
  id: "cloud/strong", provider: "cloud", model: "strong", type: "commercial", kind: "native",
  capabilities: ["reasoning", "tool-calling", "streaming"], tier: "high", contextWindow: 128000, enabled: true,
  latencyClass: "medium", cost: { inputPer1M: 3, outputPer1M: 15, estimated: true }, health: { status: "ok", successRate: 0.99 },
}

function router() {
  return createRouter({ providers: [createStaticProvider("local", [cheapModel]), createStaticProvider("cloud", [strongModel])] })
}

test("validateCase flags missing id, messages, and empty expect", () => {
  assert.ok(validateCase({}).some((e) => /missing a non-empty string id/.test(e)))
  assert.ok(validateCase({ id: "c1", expect: { modelId: "x" } }).some((e) => /messages must be a non-empty array/.test(e)))
  assert.ok(
    validateCase({ id: "c2", request: { messages: [{ role: "user", content: "hi" }] }, expect: {} }).some((e) =>
      /at least one assertion key/.test(e),
    ),
  )
  assert.deepEqual(
    validateCase({ id: "ok", request: { messages: [{ role: "user", content: "hi" }] }, expect: { anyOf: ["cloud/strong"] } }),
    [],
  )
})

test("loadDataset from an inline array produces a content-hashed id and rejects dupes", async () => {
  const cases = [
    { id: "c1", request: { messages: [{ role: "user", content: "use a tool" }], tools: [{}] }, expect: { anyOf: ["cloud/strong"] } },
    { id: "c2", request: { messages: [{ role: "user", content: "summarize" }] }, expect: { mustNotBeSkipped: true } },
  ]
  const ds = await loadDataset(cases)
  assert.match(ds.datasetId, /^inline_[0-9a-f]{8}$/)
  assert.equal(ds.cases.length, 2)

  await assert.rejects(
    () => loadDataset([cases[0], { ...cases[0] }]),
    (err) => err.code === "AR_INVALID_REQUEST" && /duplicate case id/.test(err.message),
  )
})

test("runEval defaults to evaluate-only (no provider chat calls)", async () => {
  const ds = await loadDataset([
    { id: "tool", request: { messages: [{ role: "user", content: "use a tool" }], tools: [{}] }, expect: { anyOf: ["cloud/strong"] } },
    { id: "cheap-ok", request: { messages: [{ role: "user", content: "hello" }] }, expect: { mustNotBeSkipped: true } },
  ])
  const run = await runEval(router(), ds, { runId: "run_fixed", now: () => 1720000000000 })
  assert.equal(run.runId, "run_fixed")
  assert.equal(run.weightsVersion, "builtin")
  assert.equal(run.perCase.length, 2)
  // tool case: cloud/strong is the only tool-capable model → anyOf satisfied.
  const tool = run.perCase.find((r) => r.caseId === "tool")
  assert.equal(tool.expectedSatisfied.anyOf, true)
  assert.equal(tool.chosenModel, "cloud/strong")
  // No fallback signal because chat was never invoked.
  assert.equal(tool.fallbackTriggered, false)
})

test("runEval useChat exercises the fallback loop against the mock provider", async () => {
  const failingRouter = createRouter({
    providers: [
      createStaticProvider("local", [{ ...cheapModel, health: { status: "ok", successRate: 1 } }], { failTimes: 1, errorCode: "AR_PROVIDER_TIMEOUT" }),
      createStaticProvider("cloud", [strongModel]),
    ],
    policy: { maxFallbacks: 1 },
  })
  const ds = await loadDataset([
    { id: "fb", request: { messages: [{ role: "user", content: "plan something" }], route: { task: "plan" } }, expect: { mustNotBeSkipped: true } },
  ])
  const run = await runEval(failingRouter, ds, { useChat: true })
  assert.equal(run.perCase[0].fallbackTriggered, true)
})

test("computeMetrics is deterministic and omits M=0 metrics", () => {
  const cases = [
    { id: "a", request: { messages: [{ role: "user", content: "x" }] }, expect: { anyOf: ["cloud/strong"] } },
    { id: "b", request: { messages: [{ role: "user", content: "y" }] }, expect: { mustNotBeSkipped: true } },
  ]
  const perCase = [
    { caseId: "a", chosenModel: "cloud/strong", expectedSatisfied: { anyOf: true }, rankOfExpected: 0, skipped: false, fallbackTriggered: false },
    { caseId: "b", chosenModel: "local/cheap", expectedSatisfied: { mustNotBeSkipped: true }, rankOfExpected: undefined, skipped: false, fallbackTriggered: false },
  ]
  const m = computeMetrics(perCase, cases)
  assert.equal(m.routingAccuracy, 0.5) // 1 correct / 2 cases
  assert.equal(m.notSkippedCompliance, 1)
  // No maxCostUsd assertions anywhere → costCompliance omitted, not zeroed.
  assert.equal("costCompliance" in m, false)
  // No fallbacks → fallbackRate omitted.
  assert.equal("fallbackRate" in m, false)
})

test("evaluateCase records rankOfExpected from the candidate ordering", () => {
  const c = { id: "r", request: { messages: [{ role: "user", content: "x" }] }, expect: { modelId: "cloud/strong" } }
  const candidates = [
    { modelId: "local/cheap", provider: "local", score: 100, reasons: [], skipped: false },
    { modelId: "cloud/strong", provider: "cloud", score: 90, reasons: [], skipped: false },
  ]
  const res = evaluateCase(c, candidates, [cheapModel, strongModel])
  assert.equal(res.chosenModel, "local/cheap")
  assert.equal(res.expectedSatisfied.modelId, false)
  assert.equal(res.rankOfExpected, 1)
})

test("compareToBaseline flags a regression only beyond threshold", () => {
  const base = { runId: "b", datasetId: "d", weightsVersion: "builtin", metrics: { routingAccuracy: 0.9, costCompliance: 0.9 }, perCase: [], createdAt: "" }
  const worse = { runId: "c", datasetId: "d", weightsVersion: "builtin", metrics: { routingAccuracy: 0.8, costCompliance: 0.9 }, perCase: [], createdAt: "" }
  const strict = compareToBaseline(base, worse)
  assert.equal(strict.deltas.routingAccuracy.regressed, true)
  assert.equal(strict.passed, false)

  const tolerant = compareToBaseline(base, worse, { thresholds: { routingAccuracy: 0.2 } })
  assert.equal(tolerant.deltas.routingAccuracy.regressed, false)
  assert.equal(tolerant.passed, true)
})

test("gateAgainstBaseline treats a missing baseline as pass + note", () => {
  const current = { runId: "c", datasetId: "golden", weightsVersion: "builtin", metrics: { routingAccuracy: 0.8 }, perCase: [], createdAt: "" }
  const gate = gateAgainstBaseline(undefined, current)
  assert.equal(gate.passed, true)
  assert.equal(gate.report, null)
  assert.ok(gate.notes.some((n) => /no baseline/.test(n)))
})

test("formatRegressionReport lists metric deltas and pass/fail", () => {
  const base = { runId: "b", datasetId: "d", weightsVersion: "builtin", metrics: { routingAccuracy: 0.9 }, perCase: [], createdAt: "" }
  const worse = { runId: "c", datasetId: "d", weightsVersion: "builtin", metrics: { routingAccuracy: 0.7 }, perCase: [], createdAt: "" }
  const report = compareToBaseline(base, worse)
  const text = formatRegressionReport(report, base, worse)
  assert.match(text, /Regression: FAIL/)
  assert.match(text, /REGRESSED routingAccuracy/)
})
