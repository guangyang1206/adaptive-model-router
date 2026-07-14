import test from "node:test"
import assert from "node:assert/strict"
import { mkdtemp, rm } from "node:fs/promises"
import { join } from "node:path"
import { tmpdir } from "node:os"
import { createJsonlTraceStore, createSQLiteTraceStore } from "../dist/index.js"

let sqliteAvailable = false
try {
  await import("node:sqlite")
  sqliteAvailable = true
} catch {
  sqliteAvailable = false
}

function evalRun(overrides = {}) {
  return {
    runId: "run_1",
    datasetId: "golden_ab12cd34",
    weightsVersion: "builtin",
    metrics: { routingAccuracy: 0.9, costCompliance: 0.95 },
    perCase: [{ caseId: "c1", chosenModel: "cloud/strong", expectedSatisfied: { anyOf: true }, rankOfExpected: 0, skipped: false, fallbackTriggered: false }],
    createdAt: "2026-07-03T09:00:00.000Z",
    ...overrides,
  }
}

function cacheEntry(overrides = {}) {
  return {
    key: "abc123",
    embedding: [0.1, 0.2, 0.3],
    embeddingProviderId: "openai:text-embedding-3-small",
    request: { messages: [{ role: "user", content: "hi" }] },
    response: { content: "cached", raw: {} },
    routerTrace: { traceId: "t", decisionId: "d", chosenModel: "cloud/strong", candidates: [], reason: "r", attempts: [], estimated: true, status: "success" },
    createdAt: "2026-07-03T09:00:00.000Z",
    ttlMs: 3600000,
    ...overrides,
  }
}

test("jsonl store persists and reads eval runs + baseline pointer", async () => {
  const dir = await mkdtemp(join(tmpdir(), "ar-mvp2-jsonl-"))
  try {
    const store = createJsonlTraceStore({ path: join(dir, "router.jsonl") })
    await store.writeEvalRun(evalRun())
    await store.writeEvalRun(evalRun({ runId: "run_2", datasetId: "other_ff00" }))

    const all = await store.listEvalRuns()
    assert.equal(all.length, 2)
    const filtered = await store.listEvalRuns("golden_ab12cd34")
    assert.equal(filtered.length, 1)
    assert.equal(filtered[0].runId, "run_1")

    const fetched = await store.getEvalRun("run_1")
    assert.equal(fetched.metrics.routingAccuracy, 0.9)

    await store.saveBaselinePointer("golden_ab12cd34", "run_1")
    assert.equal(await store.getBaselineRunId("golden_ab12cd34"), "run_1")
    // Latest pointer wins.
    await store.saveBaselinePointer("golden_ab12cd34", "run_2")
    assert.equal(await store.getBaselineRunId("golden_ab12cd34"), "run_2")
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test("jsonl store logs cache entries, lookups, and weights changes", async () => {
  const dir = await mkdtemp(join(tmpdir(), "ar-mvp2-jsonl-cache-"))
  try {
    const store = createJsonlTraceStore({ path: join(dir, "router.jsonl") })
    await store.writeCacheEntry(cacheEntry(), "tenant-a")
    const entries = await store.listCacheEntries()
    assert.equal(entries.length, 1)
    assert.equal(entries[0].key, "abc123")

    await store.writeCacheLookup({ key: "k1", topMatchQuery: "hi", similarity: 0.97, hit: true, source: "semantic", embeddingProviderId: "openai:x", createdAt: "2026-07-03T09:01:00.000Z" })
    await store.writeCacheLookup({ key: "k2", topMatchQuery: null, similarity: null, hit: false, source: null, embeddingProviderId: "openai:x", createdAt: "2026-07-03T09:02:00.000Z" })
    const lookups = await store.listCacheLookups()
    assert.equal(lookups.length, 2)
    // Most recent first.
    assert.equal(lookups[0].key, "k2")
    assert.equal((await store.listCacheLookups(1)).length, 1)

    await store.writeWeightsChange({ from: "builtin", to: "learned_x", action: "adopt" })
    const changes = await store.listWeightsChanges()
    assert.equal(changes.length, 1)
    assert.equal(changes[0].action, "adopt")
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test("sqlite store round-trips eval runs, baseline pointer, and cache entries", { skip: !sqliteAvailable }, async () => {
  const dir = await mkdtemp(join(tmpdir(), "ar-mvp2-sqlite-"))
  try {
    const store = await createSQLiteTraceStore({ path: join(dir, "router.db") })
    await store.writeEvalRun(evalRun())
    const fetched = await store.getEvalRun("run_1")
    assert.equal(fetched.datasetId, "golden_ab12cd34")
    assert.deepEqual(fetched.metrics, { routingAccuracy: 0.9, costCompliance: 0.95 })
    assert.equal(fetched.perCase[0].caseId, "c1")

    await store.saveBaselinePointer("golden_ab12cd34", "run_1")
    assert.equal(await store.getBaselineRunId("golden_ab12cd34"), "run_1")

    await store.writeCacheEntry(cacheEntry(), "tenant-a")
    const entries = await store.listCacheEntries()
    assert.equal(entries.length, 1)
    assert.equal(entries[0].embeddingProviderId, "openai:text-embedding-3-small")
    assert.deepEqual(entries[0].embedding, [0.1, 0.2, 0.3])
    assert.equal(entries[0].ttlMs, 3600000)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test("sqlite store keeps a null embedding null (no fabricated zeros)", { skip: !sqliteAvailable }, async () => {
  const dir = await mkdtemp(join(tmpdir(), "ar-mvp2-sqlite-null-"))
  try {
    const store = await createSQLiteTraceStore({ path: join(dir, "router.db") })
    await store.writeCacheEntry(cacheEntry({ key: "no-emb", embedding: undefined, ttlMs: undefined }), "default")
    const entries = await store.listCacheEntries()
    const row = entries.find((e) => e.key === "no-emb")
    assert.equal(row.embedding, undefined)
    assert.equal(row.ttlMs, undefined)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})
