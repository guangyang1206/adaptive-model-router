import test from "node:test"
import assert from "node:assert/strict"
import { mkdtemp, rm } from "node:fs/promises"
import { join } from "node:path"
import { tmpdir } from "node:os"
import {
  createJsonlTraceStore,
  listEvalRuns,
  getEvalsOverview,
  getLatestRegression,
  getEvalRun,
  getCacheStats,
  getLearningState,
  BUILTIN_WEIGHTS,
  WEIGHT_ORDER,
  flattenWeightsArray,
} from "../dist/index.js"

function evalRun(overrides = {}) {
  return {
    runId: "run_1",
    datasetId: "golden_ab12",
    weightsVersion: "builtin",
    metrics: { routingAccuracy: 0.9, top1ExpectMatch: 0.8, costCompliance: 0.95, fallbackRate: 0.1 },
    perCase: [
      { caseId: "c1", chosenModel: "cloud/strong", expectedSatisfied: { anyOf: true, maxCostUsd: true }, rankOfExpected: 0, skipped: false, fallbackTriggered: false },
      { caseId: "c2", chosenModel: "local/small", expectedSatisfied: { modelId: false }, rankOfExpected: 2, skipped: false, fallbackTriggered: true },
    ],
    createdAt: "2026-07-03T09:00:00.000Z",
    ...overrides,
  }
}

async function withStore(fn) {
  const dir = await mkdtemp(join(tmpdir(), "ar-dash-"))
  try {
    return await fn(createJsonlTraceStore({ path: join(dir, "router.jsonl") }))
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
}

// ---------------------------------------------------------------------------
// §9.1 listEvalRuns
// ---------------------------------------------------------------------------
test("listEvalRuns: empty store returns []", async () => {
  await withStore(async (store) => {
    assert.deepEqual(await listEvalRuns(store), [])
  })
})

test("listEvalRuns: newest-first with limit truncation", async () => {
  await withStore(async (store) => {
    await store.writeEvalRun(evalRun({ runId: "old", createdAt: "2026-07-01T00:00:00.000Z" }))
    await store.writeEvalRun(evalRun({ runId: "new", createdAt: "2026-07-05T00:00:00.000Z" }))
    await store.writeEvalRun(evalRun({ runId: "mid", createdAt: "2026-07-03T00:00:00.000Z" }))
    const all = await listEvalRuns(store)
    assert.deepEqual(all.map((r) => r.runId), ["new", "mid", "old"])
    const limited = await listEvalRuns(store, 2)
    assert.deepEqual(limited.map((r) => r.runId), ["new", "mid"])
    // Full metrics forwarded verbatim (canonical §9.0 keys present).
    assert.equal(all[0].metrics.routingAccuracy, 0.9)
    assert.equal(all[0].metrics.top1ExpectMatch, 0.8)
  })
})

// ---------------------------------------------------------------------------
// §9.1 getLatestRegression
// ---------------------------------------------------------------------------
test("getLatestRegression: null when no baseline", async () => {
  await withStore(async (store) => {
    await store.writeEvalRun(evalRun())
    assert.equal(await getLatestRegression(store), null)
  })
})

test("getLatestRegression: null when latest run IS the baseline", async () => {
  await withStore(async (store) => {
    await store.writeEvalRun(evalRun({ runId: "only" }))
    await store.saveBaselinePointer("golden_ab12", "only")
    assert.equal(await getLatestRegression(store), null)
  })
})

test("getLatestRegression: compares latest vs baseline", async () => {
  await withStore(async (store) => {
    await store.writeEvalRun(evalRun({ runId: "base", createdAt: "2026-07-01T00:00:00.000Z", metrics: { routingAccuracy: 0.9, top1ExpectMatch: 0.9, costCompliance: 0.9, capabilitySatisfaction: 0.9, rankQuality: 0.9 } }))
    await store.saveBaselinePointer("golden_ab12", "base")
    await store.writeEvalRun(evalRun({ runId: "cur", createdAt: "2026-07-05T00:00:00.000Z", metrics: { routingAccuracy: 0.7, top1ExpectMatch: 0.9, costCompliance: 0.9, capabilitySatisfaction: 0.9, rankQuality: 0.9 } }))
    const report = await getLatestRegression(store)
    assert.ok(report)
    assert.equal(report.baselineRunId, "base")
    assert.equal(report.currentRunId, "cur")
    assert.equal(report.deltas.routingAccuracy.regressed, true)
    assert.equal(report.passed, false)
  })
})

// ---------------------------------------------------------------------------
// §9.1 getEvalsOverview (composite)
// ---------------------------------------------------------------------------
test("getEvalsOverview: empty store returns complete empty composite", async () => {
  await withStore(async (store) => {
    const overview = await getEvalsOverview(store)
    assert.deepEqual(overview.runs, [])
    assert.deepEqual(overview.sparklines, {})
    assert.equal(overview.latestRegression, null)
    assert.deepEqual(overview.latestPerCase, [])
  })
})

test("getEvalsOverview: sparklines are createdAt-ASCENDING per canonical key", async () => {
  await withStore(async (store) => {
    // Write out of order; reader must sort runs desc but sparklines asc.
    await store.writeEvalRun(evalRun({ runId: "r2", createdAt: "2026-07-02T00:00:00.000Z", metrics: { routingAccuracy: 0.7, top1ExpectMatch: 0.6 } }))
    await store.writeEvalRun(evalRun({ runId: "r3", createdAt: "2026-07-03T00:00:00.000Z", metrics: { routingAccuracy: 0.8 } }))
    await store.writeEvalRun(evalRun({ runId: "r1", createdAt: "2026-07-01T00:00:00.000Z", metrics: { routingAccuracy: 0.5, top1ExpectMatch: 0.4 } }))
    const overview = await getEvalsOverview(store)
    // runs: newest first.
    assert.deepEqual(overview.runs.map((r) => r.runId), ["r3", "r2", "r1"])
    // sparkline: oldest→newest (r1,r2,r3) using canonical key.
    assert.deepEqual(overview.sparklines.routingAccuracy, [0.5, 0.7, 0.8])
    // r3 lacks top1ExpectMatch → skipped, NOT back-filled with 0.
    assert.deepEqual(overview.sparklines.top1ExpectMatch, [0.4, 0.6])
  })
})

test("getEvalsOverview: latestPerCase folds expectedSatisfied to pass/fail/na", async () => {
  await withStore(async (store) => {
    await store.writeEvalRun(evalRun({ runId: "old", createdAt: "2026-07-01T00:00:00.000Z" }))
    await store.writeEvalRun(evalRun({
      runId: "latest",
      createdAt: "2026-07-05T00:00:00.000Z",
      perCase: [
        { caseId: "pass1", chosenModel: "m", expectedSatisfied: { anyOf: true, maxCostUsd: true }, rankOfExpected: 0, skipped: false, fallbackTriggered: false },
        { caseId: "fail1", chosenModel: "m", expectedSatisfied: { anyOf: true, maxCostUsd: false }, rankOfExpected: 1, skipped: false, fallbackTriggered: false },
        { caseId: "na_empty", chosenModel: "m", expectedSatisfied: {}, rankOfExpected: undefined, skipped: false, fallbackTriggered: false },
        { caseId: "na_skip", chosenModel: undefined, expectedSatisfied: { anyOf: true }, rankOfExpected: undefined, skipped: true, fallbackTriggered: false },
      ],
    }))
    const overview = await getEvalsOverview(store)
    assert.deepEqual(overview.latestPerCase, [
      { id: "pass1", state: "pass" },
      { id: "fail1", state: "fail" },
      { id: "na_empty", state: "na" },
      { id: "na_skip", state: "na" },
    ])
  })
})

// ---------------------------------------------------------------------------
// §9.2 getEvalRun
// ---------------------------------------------------------------------------
test("getEvalRun: null for unknown run", async () => {
  await withStore(async (store) => {
    assert.equal(await getEvalRun(store, "nope"), null)
  })
})

test("getEvalRun: detail shape with flattened assertions + null regression", async () => {
  await withStore(async (store) => {
    await store.writeEvalRun(evalRun())
    const detail = await getEvalRun(store, "run_1")
    assert.ok(detail)
    assert.deepEqual(Object.keys(detail.run).sort(), ["createdAt", "datasetId", "metrics", "runId", "weightsVersion"])
    assert.equal(detail.cases.length, 2)
    const c1 = detail.cases[0]
    assert.equal(c1.id, "c1")
    assert.equal(c1.chosenModel, "cloud/strong")
    assert.equal(c1.rankOfExpected, 0)
    assert.equal(c1.skipped, false)
    assert.equal(c1.fallbackTriggered, false)
    assert.deepEqual(c1.assertions, [{ key: "anyOf", passed: true }, { key: "maxCostUsd", passed: true }])
    assert.deepEqual(detail.cases[1].assertions, [{ key: "modelId", passed: false }])
    assert.equal(detail.regression, null)
  })
})

test("getEvalRun: regression populated when baseline differs", async () => {
  await withStore(async (store) => {
    await store.writeEvalRun(evalRun({ runId: "base", metrics: { routingAccuracy: 0.9, top1ExpectMatch: 0.9, costCompliance: 0.9, capabilitySatisfaction: 0.9, rankQuality: 0.9 } }))
    await store.saveBaselinePointer("golden_ab12", "base")
    await store.writeEvalRun(evalRun({ runId: "cur", createdAt: "2026-07-05T00:00:00.000Z", metrics: { routingAccuracy: 0.95, top1ExpectMatch: 0.9, costCompliance: 0.9, capabilitySatisfaction: 0.9, rankQuality: 0.9 } }))
    const detail = await getEvalRun(store, "cur")
    assert.ok(detail.regression)
    assert.equal(detail.regression.baselineRunId, "base")
    assert.equal(detail.regression.currentRunId, "cur")
  })
})

// ---------------------------------------------------------------------------
// §9.3 getCacheStats
// ---------------------------------------------------------------------------
test("getCacheStats: empty store returns complete zero state", async () => {
  await withStore(async (store) => {
    const stats = await getCacheStats(store)
    assert.equal(stats.hits, 0)
    assert.equal(stats.misses, 0)
    assert.equal(stats.total, 0)
    assert.equal(stats.hitRate, 0)
    assert.equal(stats.mode, "exact")
    assert.deepEqual(stats.donut, { hits: 0, misses: 0, degradedFallbacks: 0 })
    assert.deepEqual(stats.hitQualityLog, [])
  })
})

test("getCacheStats: hits/misses/hitRate + semantic mode + log mapping", async () => {
  await withStore(async (store) => {
    await store.writeCacheLookup({ key: "k1", query: "how do I reset my password", topMatchQuery: "hello there", similarity: 0.97, hit: true, source: "semantic", degraded: false, embeddingProviderId: "openai:x", createdAt: "2026-07-03T09:01:00.000Z" })
    await store.writeCacheLookup({ key: "k2", query: "totally novel question", topMatchQuery: null, similarity: null, hit: false, source: null, degraded: false, embeddingProviderId: "openai:x", createdAt: "2026-07-03T09:02:00.000Z" })
    await store.writeCacheLookup({ key: "k3", query: "how do I reset my password", topMatchQuery: "how do I reset my password", similarity: null, hit: true, source: "exact", degraded: false, embeddingProviderId: "openai:x", createdAt: "2026-07-03T09:03:00.000Z" })
    const stats = await getCacheStats(store)
    assert.equal(stats.hits, 2)
    assert.equal(stats.misses, 1)
    assert.equal(stats.total, 3)
    assert.ok(Math.abs(stats.hitRate - 2 / 3) < 1e-9)
    assert.equal(stats.mode, "semantic@0.95")
    assert.deepEqual(stats.donut, { hits: 2, misses: 1, degradedFallbacks: 0 })
    // Newest-first (store reverses), shape per §9.3.
    const row = stats.hitQualityLog[0]
    assert.deepEqual(Object.keys(row).sort(), ["createdAt", "embeddingProviderId", "query", "result", "similarity", "source", "topMatchQuery", "ttlMs"])
    assert.equal(row.result, "hit")
    assert.equal(row.source, "exact")
    assert.equal(row.ttlMs, null)
    // Real query text is surfaced (NOT the internal cache key).
    assert.equal(row.query, "how do I reset my password")
    const missRow = stats.hitQualityLog.find((r) => r.query === "totally novel question")
    assert.equal(missRow.result, "miss")
    assert.equal(missRow.source, null)
  })
})

test("getCacheStats: degraded lookups drive degradedFallbacks + degraded:exact mode", async () => {
  await withStore(async (store) => {
    await store.writeCacheLookup({ key: "k1", query: "q one", topMatchQuery: "q one", similarity: null, hit: true, source: "exact", degraded: true, embeddingProviderId: "hash:fallback", createdAt: "2026-07-03T09:01:00.000Z" })
    await store.writeCacheLookup({ key: "k2", query: "q two", topMatchQuery: null, similarity: null, hit: false, source: null, degraded: true, embeddingProviderId: "hash:fallback", createdAt: "2026-07-03T09:02:00.000Z" })
    await store.writeCacheLookup({ key: "k3", query: "q three", topMatchQuery: "q three", similarity: null, hit: true, source: "exact", degraded: false, embeddingProviderId: "openai:x", createdAt: "2026-07-03T09:03:00.000Z" })
    const stats = await getCacheStats(store)
    assert.equal(stats.donut.degradedFallbacks, 2)
    // Any degraded lookup ⇒ degraded:exact mode takes precedence over exact.
    assert.equal(stats.mode, "degraded:exact")
    assert.equal(stats.hits, 2)
    assert.equal(stats.misses, 1)
  })
})

// ---------------------------------------------------------------------------
// §9.4 getLearningState
// ---------------------------------------------------------------------------
test("getLearningState: empty store returns builtin baseline, 12-dim order, none gate", async () => {
  await withStore(async (store) => {
    const state = await getLearningState(store)
    assert.equal(state.activeWeightsVersion, "builtin")
    assert.equal(state.proposedChangeCount, 0)
    assert.equal(state.evalDelta, null)
    assert.equal(state.gateStatus, "none")
    assert.equal(state.proposedWeights, null)
    // 12-dim fixed order, values = flattened BUILTIN_WEIGHTS.
    assert.equal(state.baselineWeights.length, 12)
    assert.deepEqual(state.baselineWeights, flattenWeightsArray(BUILTIN_WEIGHTS))
    assert.equal(state.weightDiff.length, 12)
    assert.deepEqual(state.weightDiff.map((d) => d.dimension), [...WEIGHT_ORDER])
    // Empty state: to === from, delta 0.
    for (const d of state.weightDiff) {
      assert.equal(d.to, d.from)
      assert.equal(d.delta, 0)
      assert.deepEqual(d.attribution, [])
    }
    // Dotted nested dims present in fixed order.
    assert.equal(state.weightDiff[3].dimension, "latency.low")
    assert.equal(state.weightDiff[7].dimension, "health.ok")
  })
})

test("getLearningState: proposed candidate yields diff, count, and gate status", async () => {
  await withStore(async (store) => {
    const proposed = {
      version: "learned_2026",
      tierMatch: 45,
      tierMismatch: 10,
      successRate: 15,
      latency: { low: 10, medium: 6, high: 3 },
      costCoefficient: 100,
      health: { ok: 30, degraded: 15, limited: 12, unknown: 8, down: 0 },
    }
    await store.writeWeightsChange({
      activeVersion: "builtin",
      baselineWeights: BUILTIN_WEIGHTS,
      proposedWeights: proposed,
      evalDelta: { baselineRunId: "b", currentRunId: "c", deltas: {}, passed: false },
    })
    const state = await getLearningState(store)
    assert.equal(state.activeWeightsVersion, "builtin")
    // Only tierMatch changed (40 -> 45).
    assert.equal(state.proposedChangeCount, 1)
    const changed = state.weightDiff.find((d) => d.dimension === "tierMatch")
    assert.equal(changed.from, 40)
    assert.equal(changed.to, 45)
    assert.equal(changed.delta, 5)
    assert.equal(state.gateStatus, "blocked")
    assert.ok(state.evalDelta)
    assert.deepEqual(state.proposedWeights, flattenWeightsArray(proposed))
    assert.equal(state.proposedWeights.length, 12)
  })
})

// ---------------------------------------------------------------------------
// Defensive: a store missing every optional primitive must not throw.
// ---------------------------------------------------------------------------
test("readers tolerate a store with no MVP-2 primitives", async () => {
  const bare = {}
  assert.deepEqual(await listEvalRuns(bare), [])
  assert.equal(await getLatestRegression(bare), null)
  assert.equal(await getEvalRun(bare, "x"), null)
  const overview = await getEvalsOverview(bare)
  assert.deepEqual(overview.runs, [])
  assert.deepEqual(overview.sparklines, {})
  assert.deepEqual(overview.latestPerCase, [])
  const cache = await getCacheStats(bare)
  assert.equal(cache.total, 0)
  const learning = await getLearningState(bare)
  assert.equal(learning.gateStatus, "none")
  assert.equal(learning.baselineWeights.length, 12)
})
