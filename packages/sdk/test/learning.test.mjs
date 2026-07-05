import test from "node:test"
import assert from "node:assert/strict"
import {
  createRouter,
  createStaticProvider,
  loadDataset,
  runEval,
  BUILTIN_WEIGHTS,
  WEIGHT_ORDER,
  WEIGHT_BOUNDS,
  computeReward,
  proposeWeights,
  diffWeights,
  flattenWeights,
  flattenWeightsArray,
  unflattenWeights,
  createWeightsRegistry,
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

test("flatten/unflatten round-trips and array order matches WEIGHT_ORDER", () => {
  const flat = flattenWeights(BUILTIN_WEIGHTS)
  assert.equal(flat.tierMatch, 40)
  assert.equal(flat["latency.medium"], 6)
  assert.equal(flat["health.down"], 0)

  const arr = flattenWeightsArray(BUILTIN_WEIGHTS)
  assert.deepEqual(arr, [40, 10, 15, 10, 6, 3, 100, 30, 15, 12, 8, 0])
  assert.equal(arr.length, WEIGHT_ORDER.length)

  const back = unflattenWeights(flat, "builtin")
  assert.deepEqual(back, BUILTIN_WEIGHTS)
})

test("computeReward: correctness dominates, fallback subtracts", () => {
  const correct = { case: { id: "a", expect: {} }, result: { expectedSatisfied: { anyOf: true }, fallbackTriggered: false } }
  const wrong = { case: { id: "b", expect: {} }, result: { expectedSatisfied: { anyOf: false }, fallbackTriggered: false } }
  const withFallback = { case: { id: "c", expect: {} }, result: { expectedSatisfied: { anyOf: true }, fallbackTriggered: true } }
  assert.ok(computeReward(correct) > computeReward(wrong))
  assert.ok(computeReward(correct) > computeReward(withFallback))
})

test("diffWeights produces one entry per dimension with deltas", () => {
  const candidate = { ...BUILTIN_WEIGHTS, version: "cand", tierMatch: 43 }
  const diff = diffWeights(BUILTIN_WEIGHTS, candidate)
  assert.equal(diff.length, WEIGHT_ORDER.length)
  const tm = diff.find((d) => d.dimension === "tierMatch")
  assert.equal(tm.from, 40)
  assert.equal(tm.to, 43)
  assert.equal(tm.delta, 3)
})

test("proposeWeights keeps builtin below minSamples and never auto-adopts", async () => {
  const factory = (weights) => createRouter({ providers: [createStaticProvider("local", [cheapModel]), createStaticProvider("cloud", [strongModel])], weights })
  const ds = await loadDataset([
    { id: "t", request: { messages: [{ role: "user", content: "use a tool" }], tools: [{}] }, expect: { anyOf: ["cloud/strong"] } },
  ])
  const baseline = await runEval(factory(BUILTIN_WEIGHTS), ds, { runId: "base", now: () => 1 })

  const proposal = await proposeWeights({
    current: BUILTIN_WEIGHTS,
    samples: [{ case: ds.cases[0], result: { expectedSatisfied: { anyOf: true }, fallbackTriggered: false } }],
    routerFactory: factory,
    dataset: ds,
    baseline,
    options: { minSamples: 50, now: () => 2 },
  })

  assert.equal(proposal.adopted, false)
  // Below minSamples → candidate stays equal to builtin values (only version differs).
  assert.deepEqual(flattenWeightsArray(proposal.candidate), flattenWeightsArray(BUILTIN_WEIGHTS))
  assert.ok(proposal.notes.some((n) => /insufficient samples/.test(n)))
})

test("proposeWeights runs the eval gate and reports pass without adopting", async () => {
  const factory = (weights) => createRouter({ providers: [createStaticProvider("local", [cheapModel]), createStaticProvider("cloud", [strongModel])], weights })
  const ds = await loadDataset([
    { id: "t", request: { messages: [{ role: "user", content: "use a tool" }], tools: [{}] }, expect: { anyOf: ["cloud/strong"] } },
  ])
  const baseline = await runEval(factory(BUILTIN_WEIGHTS), ds, { runId: "base", now: () => 1 })
  const samples = Array.from({ length: 60 }, () => ({ case: ds.cases[0], result: { expectedSatisfied: { anyOf: true }, fallbackTriggered: false } }))

  const proposal = await proposeWeights({
    current: BUILTIN_WEIGHTS,
    samples,
    routerFactory: factory,
    dataset: ds,
    baseline,
    options: { minSamples: 50, version: "learned_test", now: () => 2 },
  })
  assert.equal(proposal.adopted, false)
  assert.ok(proposal.report) // gate actually ran
  assert.equal(proposal.candidate.version, "learned_test")
  assert.ok(proposal.notes.some((n) => /NOT auto-adopted|rejected/.test(n)))

  // Every candidate dimension stays within its clamp bounds.
  const flat = flattenWeights(proposal.candidate)
  for (const dim of WEIGHT_ORDER) {
    const [lo, hi] = WEIGHT_BOUNDS[dim]
    assert.ok(flat[dim] >= lo && flat[dim] <= hi, `${dim}=${flat[dim]} out of [${lo},${hi}]`)
  }
})

test("weights registry adopts and rolls back with an audit note", () => {
  const registry = createWeightsRegistry(BUILTIN_WEIGHTS)
  assert.equal(registry.activeVersion(), "builtin")
  const cand = { ...BUILTIN_WEIGHTS, version: "learned_x", tierMatch: 42 }
  registry.register(cand)
  assert.equal(registry.adopt("learned_x").tierMatch, 42)
  assert.equal(registry.activeVersion(), "learned_x")
  const { weights, note } = registry.rollback("builtin")
  assert.equal(weights.version, "builtin")
  assert.match(note, /rolled back from learned_x to builtin/)
  assert.equal(registry.activeVersion(), "builtin")
  assert.throws(() => registry.adopt("nope"), /unknown weights version/)
})
