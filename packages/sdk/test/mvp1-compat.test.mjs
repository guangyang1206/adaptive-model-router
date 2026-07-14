import test from "node:test"
import assert from "node:assert/strict"
import { createRouter, createStaticProvider, BUILTIN_WEIGHTS } from "../dist/index.js"

// ===========================================================================
// Risk ② guard: without cache/weights/embedding, MVP-2 must be byte-for-byte
// identical to MVP-1. If BUILTIN_WEIGHTS drifts by a single unit, or the
// scoreModel refactor changes a score, or a stray note/cacheHit leaks into a
// vanilla trace, these assertions fail. The frozen expectations below are the
// MVP-1 contract.
// ===========================================================================

const cheapModel = {
  id: "local/cheap",
  provider: "local",
  model: "cheap",
  type: "self-hosted",
  kind: "self-hosted",
  capabilities: ["reasoning", "streaming"],
  tier: "balanced",
  contextWindow: 8192,
  enabled: true,
  latencyClass: "low",
  cost: { inputPer1M: 0, outputPer1M: 0, estimated: true },
  health: { status: "ok", successRate: 0.95 },
}

const strongModel = {
  id: "cloud/strong",
  provider: "cloud",
  model: "strong",
  type: "commercial",
  kind: "native",
  capabilities: ["reasoning", "tool-calling", "streaming"],
  tier: "high",
  contextWindow: 128000,
  enabled: true,
  latencyClass: "medium",
  cost: { inputPer1M: 3, outputPer1M: 15, estimated: true },
  health: { status: "ok", successRate: 0.99 },
}

function vanillaRouter() {
  // No cache, no weights, no embedding — exactly an MVP-1 router.
  return createRouter({
    providers: [createStaticProvider("local", [cheapModel]), createStaticProvider("cloud", [strongModel])],
  })
}

test("BUILTIN_WEIGHTS holds the exact MVP-1 hard-coded values (detailed-design §0)", () => {
  assert.deepEqual(BUILTIN_WEIGHTS, {
    version: "builtin",
    tierMatch: 40,
    tierMismatch: 10,
    successRate: 15,
    latency: { low: 10, medium: 6, high: 3 },
    costCoefficient: 100,
    health: { ok: 30, degraded: 15, limited: 12, unknown: 8, down: 0 },
  })
})

test("scoreModel with BUILTIN_WEIGHTS reproduces the MVP-1 score arithmetic", async () => {
  const router = vanillaRouter()
  const result = await router.evaluate({
    messages: [{ role: "user", content: "hi" }],
    route: { quality: "balanced" },
  })

  // local/cheap: tierMatch(balanced>=balanced)=40 + health.ok=30 +
  // round(0.95*15)=14 + latency.low=10 + cost(free→max(0,10-0))=10 = 104.
  const cheap = result.candidates.find((c) => c.modelId === "local/cheap")
  assert.equal(cheap.score, 40 + 30 + 14 + 10 + 10)

  // cloud/strong: tierMatch(high>=balanced)=40 + health.ok=30 +
  // round(0.99*15)=15 + latency.medium=6 + cost. inputTokens=ceil(2/4)=1,
  // costUsd=(1/1e6)*3+(32/1e6)*15=0.000483 → 10-0.000483*100=9.9517.
  const strong = result.candidates.find((c) => c.modelId === "cloud/strong")
  const expectedCost = 10 - ((1 / 1_000_000) * 3 + (32 / 1_000_000) * 15) * 100
  assert.equal(strong.score, 40 + 30 + 15 + 6 + expectedCost)
})

test("vanilla evaluate output shape is unchanged from MVP-1", async () => {
  const router = vanillaRouter()
  const result = await router.evaluate({
    messages: [{ role: "user", content: "Summarize this." }],
    route: { task: "summarize" },
  })

  assert.equal(
    result.reason,
    "Capability hard filter, then quality tier, health/success signal, latency, and cost within acceptable tier.",
  )
  // Sorted by descending score; no MVP-2-only fields leak onto candidates.
  const keys = Object.keys(result.candidates[0]).sort()
  assert.deepEqual(keys, ["modelId", "provider", "reasons", "score", "skipped", "skippedReason", "skippedReasons"].sort())
})

test("vanilla chat trace carries NO cacheHit and NO weightsVersion", async () => {
  const router = vanillaRouter()
  const result = await router.chat({ messages: [{ role: "user", content: "No stream." }] })
  const t = result.routerTrace

  assert.equal(t.status, "success")
  // MVP-1 traces never had these fields; they must stay absent for builtin.
  assert.equal(t.cacheHit, undefined)
  assert.equal(t.weightsVersion, undefined)
  // MVP-1 contract: a note-free trace has notes === undefined (not []).
  assert.equal(t.notes, undefined)
})

test("explicitly passing BUILTIN_WEIGHTS is identical to passing nothing", async () => {
  const base = vanillaRouter()
  const withWeights = createRouter({
    providers: [createStaticProvider("local", [cheapModel]), createStaticProvider("cloud", [strongModel])],
    weights: BUILTIN_WEIGHTS,
  })

  const req = { messages: [{ role: "user", content: "compare weights paths" }], route: { quality: "balanced" } }
  const a = await base.evaluate(req)
  const b = await withWeights.evaluate(req)

  const scoresA = a.candidates.map((c) => [c.modelId, c.score])
  const scoresB = b.candidates.map((c) => [c.modelId, c.score])
  assert.deepEqual(scoresA, scoresB)

  // weightsVersion === "builtin" must NOT be stamped onto the trace.
  const chat = await withWeights.chat({ messages: [{ role: "user", content: "x" }] })
  assert.equal(chat.routerTrace.weightsVersion, undefined)
})
