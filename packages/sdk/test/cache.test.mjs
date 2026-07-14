import test from "node:test"
import assert from "node:assert/strict"
import {
  createMemorySemanticCache,
  createHashingEmbeddingProvider,
  buildCacheKey,
  queryTextOf,
  sha256,
  DEFAULT_CACHE_THRESHOLD,
  SHORT_QUERY_THRESHOLD,
} from "../dist/index.js"

function req(content, extra = {}) {
  return { messages: [{ role: "user", content }], ...extra }
}

function ctx(overrides = {}) {
  return {
    modelId: "local/cheap",
    embeddingProviderId: "test-emb",
    tenantScope: "default",
    ...overrides,
  }
}

const fakeResponse = { content: "cached answer", raw: {} }
function fakeTrace(model = "local/cheap") {
  return {
    traceId: "t1",
    decisionId: "d1",
    chosenModel: model,
    candidates: [],
    reason: "r",
    attempts: [],
    estimated: true,
    status: "success",
    usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2, costUsd: 0, estimated: true },
    estimatedCostUsd: 0,
  }
}

test("buildCacheKey is a stable sha256 hex and scope-sensitive", () => {
  const k1 = buildCacheKey(req("hello world"), ctx())
  const k2 = buildCacheKey(req("hello world"), ctx())
  const kScoped = buildCacheKey(req("hello world"), ctx({ tenantScope: "tenant-b" }))
  assert.match(k1, /^[0-9a-f]{64}$/)
  assert.equal(k1, k2)
  assert.notEqual(k1, kScoped) // AC-F4 cross-tenant miss
  // sha256 is exported and produces the same hex for the same input.
  assert.equal(sha256("abc"), sha256("abc"))
  assert.match(sha256("abc"), /^[0-9a-f]{64}$/)
})

test("queryTextOf concatenates non-system messages only", () => {
  const r = { messages: [{ role: "system", content: "sys" }, { role: "user", content: "hi" }, { role: "assistant", content: "yo" }] }
  assert.equal(queryTextOf(r), "hi\nyo")
})

test("exact hit: same request returns the cached response and source=exact", async () => {
  const cache = createMemorySemanticCache()
  const c = ctx({ embed: undefined })
  const miss = await cache.get(req("what is the capital of france"), c)
  assert.equal(miss.hit, false)

  await cache.set(req("what is the capital of france"), fakeResponse, fakeTrace(), c)
  const hit = await cache.get(req("what is the capital of france"), c)
  assert.equal(hit.hit, true)
  assert.equal(hit.source, "exact")
  assert.equal(hit.entry.response.content, "cached answer")
})

test("without an embed fn, semantic is disabled and a note explains why", async () => {
  const cache = createMemorySemanticCache()
  const lookup = await cache.get(req("some long query that is not short"), ctx({ embed: undefined, degraded: true }))
  assert.equal(lookup.hit, false)
  assert.ok(lookup.notes.some((n) => /semantic disabled/.test(n)))
})

test("semantic hit above threshold using a real (non-degraded) embed fn", async () => {
  const emb = createHashingEmbeddingProvider(256)
  // Force semantic on the hashing provider by marking it non-degraded here.
  const c = ctx({ embed: (t) => emb.embed(t), degraded: false, threshold: 0.5 })
  const cache = createMemorySemanticCache()

  await cache.set(req("summarize the quarterly revenue report"), fakeResponse, fakeTrace(), c)
  const near = await cache.get(req("summarize the quarterly revenue reports"), c)
  assert.equal(near.hit, true)
  assert.equal(near.source, "semantic")
  assert.ok(near.similarity >= 0.5)
})

test("degraded embed provider stays exact-only unless hashSemantic is set", async () => {
  const emb = createHashingEmbeddingProvider(256)
  const cache = createMemorySemanticCache()
  const degraded = ctx({ embed: (t) => emb.embed(t), degraded: true })

  await cache.set(req("alpha beta gamma delta"), fakeResponse, fakeTrace(), degraded)
  const near = await cache.get(req("alpha beta gamma delt"), degraded)
  assert.equal(near.hit, false)
  assert.ok(near.notes.some((n) => /exact-match only/.test(n)))

  // Opt in to hashing-based semantic → warns about false-positive risk.
  const opted = ctx({ embed: (t) => emb.embed(t), degraded: true, hashSemantic: true, threshold: 0.5 })
  await cache.set(req("alpha beta gamma delta"), fakeResponse, fakeTrace(), opted)
  const near2 = await cache.get(req("alpha beta gamma delta"), opted)
  assert.equal(near2.hit, true)
})

test("guard rejects a numerically-close but meaning-flipped match", async () => {
  const emb = createHashingEmbeddingProvider(256)
  const guardCtx = ctx({
    embed: (t) => emb.embed(t),
    degraded: false,
    threshold: 0.1,
    guard: (query, matched) => !(query.includes("not") ^ matched.includes("not")),
  })
  const cache = createMemorySemanticCache()
  await cache.set(req("is the service available"), fakeResponse, fakeTrace(), guardCtx)
  const flipped = await cache.get(req("is the service not available"), guardCtx)
  assert.equal(flipped.hit, false)
  assert.ok(flipped.notes.some((n) => /rejected by guard/.test(n)))
})

test("short queries raise the threshold to SHORT_QUERY_THRESHOLD", async () => {
  assert.ok(SHORT_QUERY_THRESHOLD > DEFAULT_CACHE_THRESHOLD)
  const emb = createHashingEmbeddingProvider(256)
  // "hi there" normalizes to <12 chars → threshold bumped to 0.98, so a fuzzy
  // hashing match cannot clear it and stays a miss.
  const c = ctx({ embed: (t) => emb.embed(t), degraded: false })
  const cache = createMemorySemanticCache()
  await cache.set(req("hi there"), fakeResponse, fakeTrace(), c)
  const near = await cache.get(req("hey there"), c)
  assert.equal(near.hit, false)
})

test("tenant scope isolates entries (cross-tenant miss)", async () => {
  const cache = createMemorySemanticCache()
  const a = ctx({ tenantScope: "tenant-a" })
  const b = ctx({ tenantScope: "tenant-b" })
  await cache.set(req("shared question"), fakeResponse, fakeTrace(), a)
  assert.equal((await cache.get(req("shared question"), a)).hit, true)
  assert.equal((await cache.get(req("shared question"), b)).hit, false)
})

test("TTL expiry evicts a stale entry (injected clock)", async () => {
  let clock = 1_000_000
  const cache = createMemorySemanticCache({ now: () => clock })
  const c = ctx({ ttlMs: 1000 })
  await cache.set(req("perishable answer"), fakeResponse, fakeTrace(), c)
  assert.equal((await cache.get(req("perishable answer"), c)).hit, true)
  clock += 2000
  const expired = await cache.get(req("perishable answer"), c)
  assert.equal(expired.hit, false)
})

test("LRU evicts the least-recently-used entry past capacity", async () => {
  const cache = createMemorySemanticCache({ capacity: 2 })
  const c = ctx()
  await cache.set(req("q1"), fakeResponse, fakeTrace(), c)
  await cache.set(req("q2"), fakeResponse, fakeTrace(), c)
  // Touch q1 so q2 becomes the LRU victim.
  await cache.get(req("q1"), c)
  await cache.set(req("q3"), fakeResponse, fakeTrace(), c)
  assert.equal((await cache.get(req("q1"), c)).hit, true)
  assert.equal((await cache.get(req("q2"), c)).hit, false)
  assert.equal((await cache.get(req("q3"), c)).hit, true)
})

test("persistence hook receives cache-set and lookup events (best-effort)", async () => {
  const entries = []
  const lookups = []
  const cache = createMemorySemanticCache({
    store: {
      writeCacheEntry: (e, scope) => entries.push({ key: e.key, scope }),
      writeCacheLookup: (ev) => lookups.push(ev),
    },
  })
  const c = ctx()
  await cache.set(req("persist me"), fakeResponse, fakeTrace(), c)
  await cache.get(req("persist me"), c)
  assert.equal(entries.length, 1)
  assert.equal(entries[0].scope, "default")
  assert.equal(lookups.length, 1)
  assert.equal(lookups[0].hit, true)
  assert.equal(lookups[0].source, "exact")
  // §9.3 persistence: real query text + degraded flag are recorded.
  assert.equal(lookups[0].query, queryTextOf(req("persist me")))
  assert.equal(lookups[0].degraded, false)
})

test("lookup event marks degraded=true on an exact-only degraded context", async () => {
  const lookups = []
  const cache = createMemorySemanticCache({ store: { writeCacheLookup: (ev) => lookups.push(ev) } })
  // degraded provider, no hashSemantic ⇒ exact-only path, miss on empty cache.
  await cache.get(req("anything"), ctx({ degraded: true }))
  assert.equal(lookups.length, 1)
  assert.equal(lookups[0].hit, false)
  assert.equal(lookups[0].degraded, true)
  assert.equal(lookups[0].query, queryTextOf(req("anything")))
})
