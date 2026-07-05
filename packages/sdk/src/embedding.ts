import type { EmbeddingProvider, EmbeddingResolveOptions, EmbeddingVector } from "./types.js"

/**
 * Normalize text for embedding + cache-key construction. Kept in one place so
 * the hashing embedder and the cache key derive from byte-identical input:
 * trim, collapse internal whitespace to a single space, lowercase.
 */
export function normalizeForEmbed(text: string): string {
  return text.trim().replace(/\s+/g, " ").toLowerCase()
}

/**
 * Resolve an embedding provider using a fixed fallback ladder:
 *   explicit provider > OpenAI (fetch-only) > local transformers ONNX > hashing.
 *
 * Never throws — every failure is downgraded, recorded in `notes`, and the
 * ladder continues. The hashing fallback always succeeds, so `resolve` always
 * returns a usable provider. Callers must surface `notes` into RouterTrace so a
 * degrade is never silent (Spec ruling ②).
 */
export async function resolveEmbeddingProvider(
  opts: EmbeddingResolveOptions = {},
): Promise<{ provider: EmbeddingProvider; notes: string[] }> {
  const notes: string[] = []
  const order = opts.prefer ?? ["provider", "openai", "local", "hashing"]

  for (const kind of order) {
    try {
      if (kind === "provider" && opts.provider) return { provider: opts.provider, notes }
      if (kind === "openai" && opts.openai?.apiKey) return { provider: createOpenAIEmbeddingProvider(opts.openai), notes }
      if (kind === "local") {
        const local = await createLocalEmbeddingProvider(opts.local)
        if (local) return { provider: local, notes }
        notes.push("embedding: @huggingface/transformers not installed, skipping local")
      }
      if (kind === "hashing") {
        const hashing = createHashingEmbeddingProvider(opts.hashing?.dimensions ?? 256)
        notes.push("embedding: using zero-dependency hashing fallback (degraded, semantic cache limited to exact match unless hashSemantic enabled)")
        return { provider: hashing, notes }
      }
    } catch (error) {
      notes.push(`embedding: ${kind} unavailable (${errMsg(error)}), falling back`)
    }
  }

  // Reached only when `prefer` omits "hashing"; still guarantee a provider.
  const hashing = createHashingEmbeddingProvider(opts.hashing?.dimensions ?? 256)
  notes.push("embedding: using zero-dependency hashing fallback (degraded, semantic cache limited to exact match unless hashSemantic enabled)")
  return { provider: hashing, notes }
}

/**
 * (A) Zero-dependency hashing embedder. char 3-gram + signed feature hashing
 * (FNV-1a) into a fixed-width vector, then L2-normalized. Deterministic and
 * never fails. `degraded: true` — semantically weak, so the cache only uses it
 * for exact matching unless `hashSemantic` is explicitly enabled.
 */
export function createHashingEmbeddingProvider(dimensions = 256): EmbeddingProvider {
  return {
    id: `hashing-ngram3-d${dimensions}`,
    dimensions,
    degraded: true,
    async embed(texts) {
      return texts.map((text) => {
        const vector = new Float32Array(dimensions)
        const s = normalizeForEmbed(text)
        for (let i = 0; i + 3 <= s.length; i++) {
          const gram = s.slice(i, i + 3)
          const h = fnv1a(gram)
          const idx = h % dimensions
          const sign = (h >>> 31) & 1 ? -1 : 1
          vector[idx] += sign
        }
        return l2normalize(vector)
      })
    },
  }
}

/**
 * (B) OpenAI embeddings via `fetch` only — no SDK, no dependency. Not degraded.
 */
export function createOpenAIEmbeddingProvider(o: NonNullable<EmbeddingResolveOptions["openai"]>): EmbeddingProvider {
  const model = o.model ?? "text-embedding-3-small"
  const dimensions = model === "text-embedding-3-large" ? 3072 : 1536
  const doFetch = o.fetch ?? fetch
  return {
    id: `openai:${model}`,
    dimensions,
    degraded: false,
    async embed(texts) {
      const response = await doFetch(`${o.baseURL ?? "https://api.openai.com/v1"}/embeddings`, {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${o.apiKey}` },
        body: JSON.stringify({ model, input: texts }),
      })
      if (!response.ok) throw new Error(`openai embeddings ${response.status}`)
      const json = (await response.json()) as { data: { index: number; embedding: number[] }[] }
      return json.data
        .slice()
        .sort((a, b) => a.index - b.index)
        .map((d) => Float32Array.from(d.embedding))
    },
  }
}

/**
 * (C) Local ONNX via `@huggingface/transformers`. Loaded through the same
 * dynamic-import shim used for `node:sqlite` (storage.ts) so a bundler cannot
 * statically pull the optional peer dependency into the zero-dependency core.
 * Returns null when the package is not installed, letting the ladder fall
 * through to hashing.
 */
export async function createLocalEmbeddingProvider(o?: { model?: string }): Promise<EmbeddingProvider | null> {
  const load = Function("return import('@huggingface/transformers')") as () => Promise<{
    pipeline: (task: string, model: string) => Promise<(texts: string[], opts: unknown) => Promise<{ tolist(): number[][] }>>
  }>
  let mod
  try {
    mod = await load()
  } catch {
    return null
  }
  const model = o?.model ?? "Xenova/all-MiniLM-L6-v2"
  const pipe = await mod.pipeline("feature-extraction", model)
  return {
    id: `transformers:${model}`,
    dimensions: 384,
    degraded: false,
    async embed(texts) {
      const out = await pipe(texts, { pooling: "mean", normalize: true })
      return out.tolist().map((a: number[]) => Float32Array.from(a))
    },
  }
}

/** 32-bit FNV-1a hash of a short string. */
export function fnv1a(s: string): number {
  let h = 0x811c9dc5
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 0x01000193)
  }
  return h >>> 0
}

/** L2-normalize in place; a zero vector is returned unchanged (no NaN). */
export function l2normalize(vector: Float32Array): Float32Array {
  let sum = 0
  for (let i = 0; i < vector.length; i++) sum += vector[i] * vector[i]
  const norm = Math.sqrt(sum)
  if (norm === 0) return vector
  for (let i = 0; i < vector.length; i++) vector[i] /= norm
  return vector
}

/** Cosine similarity of two equal-length embedding vectors. */
export function cosineSimilarity(a: EmbeddingVector, b: EmbeddingVector): number {
  const length = Math.min(a.length, b.length)
  let dot = 0
  let normA = 0
  let normB = 0
  for (let i = 0; i < length; i++) {
    dot += a[i] * b[i]
    normA += a[i] * a[i]
    normB += b[i] * b[i]
  }
  if (normA === 0 || normB === 0) return 0
  return dot / (Math.sqrt(normA) * Math.sqrt(normB))
}

function errMsg(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
