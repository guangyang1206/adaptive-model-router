import test from "node:test"
import assert from "node:assert/strict"
import {
  createHashingEmbeddingProvider,
  createOpenAIEmbeddingProvider,
  createLocalEmbeddingProvider,
  resolveEmbeddingProvider,
  normalizeForEmbed,
  cosineSimilarity,
  fnv1a,
  l2normalize,
} from "../dist/index.js"

test("normalizeForEmbed trims, collapses whitespace, lowercases", () => {
  assert.equal(normalizeForEmbed("  Hello   WORLD\n\tfoo "), "hello world foo")
})

test("fnv1a is deterministic and unsigned 32-bit", () => {
  const a = fnv1a("abc")
  assert.equal(a, fnv1a("abc"))
  assert.ok(a >= 0 && a <= 0xffffffff)
  assert.notEqual(fnv1a("abc"), fnv1a("abd"))
})

test("l2normalize yields a unit vector and leaves the zero vector untouched", () => {
  const v = l2normalize(Float32Array.from([3, 4]))
  const norm = Math.sqrt(v[0] * v[0] + v[1] * v[1])
  assert.ok(Math.abs(norm - 1) < 1e-6)
  const zero = l2normalize(Float32Array.from([0, 0]))
  assert.deepEqual([...zero], [0, 0])
})

test("cosineSimilarity: identical→1, orthogonal→0, zero→0", () => {
  assert.ok(Math.abs(cosineSimilarity(Float32Array.from([1, 2, 3]), Float32Array.from([1, 2, 3])) - 1) < 1e-6)
  assert.equal(cosineSimilarity(Float32Array.from([1, 0]), Float32Array.from([0, 1])), 0)
  assert.equal(cosineSimilarity(Float32Array.from([0, 0]), Float32Array.from([1, 1])), 0)
})

test("hashing embedder is deterministic, normalized, degraded, correct dimension", async () => {
  const provider = createHashingEmbeddingProvider(256)
  assert.equal(provider.degraded, true)
  assert.equal(provider.dimensions, 256)
  assert.match(provider.id, /^hashing-ngram3-d256$/)

  const [a1] = await provider.embed(["summarize the quarterly report"])
  const [a2] = await provider.embed(["summarize the quarterly report"])
  assert.equal(a1.length, 256)
  assert.deepEqual([...a1], [...a2])
  const norm = Math.sqrt([...a1].reduce((s, x) => s + x * x, 0))
  assert.ok(norm === 0 || Math.abs(norm - 1) < 1e-5)

  // Near-identical text should be more similar than unrelated text.
  const [near] = await provider.embed(["summarize the quarterly reports"])
  const [far] = await provider.embed(["book a flight to tokyo"])
  assert.ok(cosineSimilarity(a1, near) > cosineSimilarity(a1, far))
})

test("resolveEmbeddingProvider defaults to the hashing fallback with a note", async () => {
  const { provider, notes } = await resolveEmbeddingProvider()
  assert.equal(provider.degraded, true)
  assert.match(provider.id, /^hashing/)
  assert.ok(notes.some((n) => /hashing fallback/.test(n)))
})

test("resolveEmbeddingProvider honors an explicit provider first", async () => {
  const custom = { id: "custom:test", dimensions: 4, degraded: false, embed: async (t) => t.map(() => Float32Array.from([1, 0, 0, 0])) }
  const { provider, notes } = await resolveEmbeddingProvider({ provider: custom })
  assert.equal(provider.id, "custom:test")
  assert.deepEqual(notes, [])
})

test("resolveEmbeddingProvider picks OpenAI when an apiKey is present, before local/hashing", async () => {
  const { provider } = await resolveEmbeddingProvider({ openai: { apiKey: "sk-test" } })
  assert.match(provider.id, /^openai:/)
  assert.equal(provider.degraded, false)
})

test("resolveEmbeddingProvider never throws even when 'prefer' omits hashing", async () => {
  const { provider, notes } = await resolveEmbeddingProvider({ prefer: ["local"] })
  // local peer is not installed → still returns a usable (hashing) provider.
  assert.ok(provider)
  assert.ok(notes.length > 0)
})

test("createLocalEmbeddingProvider returns null when the optional peer is absent", async () => {
  const local = await createLocalEmbeddingProvider()
  assert.equal(local, null)
})

test("OpenAI embedder posts to the embeddings endpoint and orders by index", async () => {
  const calls = []
  const fakeFetch = async (url, init) => {
    calls.push({ url, body: JSON.parse(init.body) })
    return {
      ok: true,
      json: async () => ({ data: [{ index: 1, embedding: [0, 1] }, { index: 0, embedding: [1, 0] }] }),
    }
  }
  const provider = createOpenAIEmbeddingProvider({ apiKey: "sk-x", fetch: fakeFetch })
  const out = await provider.embed(["a", "b"])
  assert.match(calls[0].url, /\/embeddings$/)
  assert.equal(calls[0].body.input.length, 2)
  // Sorted by index: index 0 first.
  assert.deepEqual([...out[0]], [1, 0])
  assert.deepEqual([...out[1]], [0, 1])
})

test("OpenAI embedder throws on a non-ok response", async () => {
  const provider = createOpenAIEmbeddingProvider({ apiKey: "sk-x", fetch: async () => ({ ok: false, status: 429 }) })
  await assert.rejects(() => provider.embed(["a"]), /openai embeddings 429/)
})
