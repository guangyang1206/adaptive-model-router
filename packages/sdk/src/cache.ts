import { createHash } from "node:crypto"
import { cosineSimilarity, normalizeForEmbed } from "./embedding.js"
import type {
  CacheContext,
  CacheLookup,
  EmbeddingVector,
  ProviderResponse,
  RouteRequest,
  RouterTrace,
  SemanticCache,
  SemanticCacheEntry,
} from "./types.js"

/** Default cosine threshold for a semantic hit. Conservative to cut false positives. */
export const DEFAULT_CACHE_THRESHOLD = 0.95
/** Short normalized queries raise the bar to this to avoid over-eager matches. */
export const SHORT_QUERY_THRESHOLD = 0.98
/** A normalized query shorter than this many chars is treated as "short". */
export const SHORT_QUERY_MAX_LENGTH = 12
/** Default in-memory LRU capacity. */
export const DEFAULT_CACHE_CAPACITY = 1000

export type MemorySemanticCacheOptions = {
  /** Max number of live entries before LRU eviction. Default 1000. */
  capacity?: number
  /** Persist writes and lookup-quality events to a store (JSONL/SQLite). */
  store?: CachePersistence
  /** Injected clock for deterministic TTL tests. */
  now?: () => number
}

/**
 * Optional persistence hook the router's TraceStore can implement to durably
 * record cache entries and hit-quality events. The in-memory cache works fully
 * without it; when present, writes are best-effort and never block the hot
 * path.
 */
export type CachePersistence = {
  writeCacheEntry?(entry: SemanticCacheEntry, tenantScope: string): Promise<void> | void
  writeCacheLookup?(event: CacheLookupEvent): Promise<void> | void
}

/** One (query, match, similarity, hit/miss) row — the hit-quality log (§3.5). */
export type CacheLookupEvent = {
  key: string
  /** Normalized prompt text of the incoming query (dashboard §9.3 `query`). */
  query: string
  topMatchQuery: string | null
  similarity: number | null
  hit: boolean
  source: "exact" | "semantic" | null
  /** True when this lookup ran on a degraded (exact-only) embedding provider. */
  degraded: boolean
  embeddingProviderId: string
  createdAt: string
}

type LiveEntry = SemanticCacheEntry & { tenantScope: string; queryText: string }

/**
 * In-memory semantic cache with a durable write-through hook.
 *
 * Lookup is four steps (detailed-design §3.2): normalize+key → exact-layer
 * Map hit → optional brute-force cosine over same-scope/same-provider vectors →
 * threshold gate. Degrades to exact-only when no real embedding is available,
 * always recording why in `notes` (never silent, Spec ruling ②).
 */
export function createMemorySemanticCache(options: MemorySemanticCacheOptions = {}): SemanticCache {
  const capacity = options.capacity ?? DEFAULT_CACHE_CAPACITY
  const now = options.now ?? Date.now
  // Map preserves insertion order; we delete+set on hit to implement LRU.
  const entries = new Map<string, LiveEntry>()

  function evictIfNeeded(): void {
    while (entries.size > capacity) {
      const oldest = entries.keys().next().value as string | undefined
      if (oldest === undefined) break
      entries.delete(oldest)
    }
  }

  function touch(key: string, entry: LiveEntry): void {
    entries.delete(key)
    entries.set(key, entry)
  }

  function isExpired(entry: LiveEntry): boolean {
    if (entry.ttlMs === undefined) return false
    return now() - Date.parse(entry.createdAt) > entry.ttlMs
  }

  async function logLookup(event: CacheLookupEvent): Promise<void> {
    try {
      await options.store?.writeCacheLookup?.(event)
    } catch {
      // Hit-quality logging is best-effort; never break the model call path.
    }
  }

  return {
    async get(request: RouteRequest, ctx: CacheContext): Promise<CacheLookup> {
      const notes: string[] = []
      const threshold = resolveThreshold(request, ctx)
      const key = buildCacheKey(request, ctx)
      const queryText = queryTextOf(request)
      const scope = ctx.tenantScope ?? "default"
      // Degraded = provider offers no trustworthy embedding, so this lookup can
      // only serve exact matches (dashboard §9.3 degradedFallbacks segment).
      const degraded = ctx.degraded === true

      // Step 1: exact layer.
      const exact = entries.get(key)
      if (exact && !isExpired(exact)) {
        touch(key, exact)
        notes.push("cache: exact hit")
        await logLookup({ key, query: queryText, topMatchQuery: exact.queryText, similarity: null, hit: true, source: "exact", degraded, embeddingProviderId: ctx.embeddingProviderId, createdAt: new Date(now()).toISOString() })
        return { hit: true, source: "exact", entry: stripInternal(exact), notes }
      }
      if (exact && isExpired(exact)) entries.delete(key)

      // Step 2: can we do semantic at all?
      const canSemantic = Boolean(ctx.embed) && (!ctx.degraded || ctx.hashSemantic === true)
      if (!canSemantic) {
        notes.push(
          ctx.degraded && !ctx.hashSemantic
            ? "cache: semantic disabled (no embedding provider), exact-match only — hit rate reduced"
            : "cache: semantic disabled, exact-match only — hit rate reduced",
        )
        await logLookup({ key, query: queryText, topMatchQuery: null, similarity: null, hit: false, source: null, degraded, embeddingProviderId: ctx.embeddingProviderId, createdAt: new Date(now()).toISOString() })
        return { hit: false, notes }
      }
      if (ctx.degraded && ctx.hashSemantic) {
        notes.push("cache: semantic on hashing fallback (degraded), higher false-positive risk")
      }

      // Step 3: brute-force cosine over same scope + same embedding provider.
      const [queryVec] = await ctx.embed!([queryText])
      let best: { entry: LiveEntry; similarity: number } | undefined
      for (const entry of entries.values()) {
        if (entry.tenantScope !== scope) continue
        if (entry.embeddingProviderId !== ctx.embeddingProviderId) continue
        if (!entry.embedding) continue
        if (isExpired(entry)) continue
        const similarity = cosineSimilarity(queryVec, entry.embedding)
        if (!best || similarity > best.similarity) best = { entry, similarity }
      }

      if (best && best.similarity >= threshold) {
        // Negative-word / semantic guard: reject a numerically-close but
        // meaning-flipped match rather than serving a wrong cached answer.
        if (ctx.guard && !ctx.guard(queryText, best.entry.queryText)) {
          notes.push(`cache: semantic match rejected by guard sim=${best.similarity.toFixed(4)}`)
          await logLookup({ key, query: queryText, topMatchQuery: best.entry.queryText, similarity: best.similarity, hit: false, source: null, degraded, embeddingProviderId: ctx.embeddingProviderId, createdAt: new Date(now()).toISOString() })
          return { hit: false, notes }
        }
        touch(best.entry.key, best.entry)
        notes.push(`cache: semantic hit sim=${best.similarity.toFixed(4)}`)
        await logLookup({ key, query: queryText, topMatchQuery: best.entry.queryText, similarity: best.similarity, hit: true, source: "semantic", degraded, embeddingProviderId: ctx.embeddingProviderId, createdAt: new Date(now()).toISOString() })
        return { hit: true, source: "semantic", similarity: best.similarity, entry: stripInternal(best.entry), notes }
      }

      await logLookup({ key, query: queryText, topMatchQuery: best?.entry.queryText ?? null, similarity: best?.similarity ?? null, hit: false, source: null, degraded, embeddingProviderId: ctx.embeddingProviderId, createdAt: new Date(now()).toISOString() })
      return { hit: false, notes }
    },

    async set(request: RouteRequest, response: ProviderResponse, trace: RouterTrace, ctx: CacheContext): Promise<void> {
      const key = buildCacheKey(request, ctx)
      const canSemantic = Boolean(ctx.embed) && (!ctx.degraded || ctx.hashSemantic === true)
      let embedding: EmbeddingVector | undefined
      if (canSemantic && ctx.embed) {
        const [vec] = await ctx.embed([queryTextOf(request)])
        embedding = vec
      }
      const entry: LiveEntry = {
        key,
        embedding,
        embeddingProviderId: ctx.embeddingProviderId,
        request,
        response,
        routerTrace: trace,
        createdAt: new Date(now()).toISOString(),
        ttlMs: ctx.ttlMs,
        tenantScope: ctx.tenantScope ?? "default",
        queryText: queryTextOf(request),
      }
      touch(key, entry)
      evictIfNeeded()
      try {
        await options.store?.writeCacheEntry?.(stripInternal(entry), entry.tenantScope)
      } catch {
        // Durable write is best-effort; the in-memory layer already holds it.
      }
    },
  }
}

/** Default TTL buckets by content volatility (ms). */
export const CACHE_TTL_CLASSES = { default: 3_600_000, factual: 86_400_000, volatile: 300_000 } as const

function resolveThreshold(request: RouteRequest, ctx: CacheContext): number {
  const base = ctx.threshold ?? DEFAULT_CACHE_THRESHOLD
  const query = queryTextOf(request)
  return normalizeForEmbed(query).length < SHORT_QUERY_MAX_LENGTH ? Math.max(base, SHORT_QUERY_THRESHOLD) : base
}

/**
 * Deterministic cache key over every factor that can change the answer:
 * embedding version+provider prefix, model id, system prompt, user-visible
 * messages, key sampling params, and tenant scope. Different scope ⇒ different
 * key ⇒ guaranteed cross-tenant miss (AC-F4).
 */
export function buildCacheKey(request: RouteRequest, ctx: CacheContext): string {
  const systemPrompt = request.messages.filter((m) => m.role === "system").map((m) => m.content).join("\n")
  const userVisible = request.messages.filter((m) => m.role !== "system").map((m) => `${m.role}:${m.content}`).join("\n")
  const sampling = {
    stream: request.stream ?? false,
    hasTools: Boolean(request.tools?.length),
    quality: request.route?.quality,
    task: request.route?.task,
    maxCostUsd: request.route?.maxCostUsd,
  }
  const rawKey = [
    `emb:${ctx.embeddingProviderId}`,
    `model:${ctx.modelId}`,
    `sys:${sha1(normalizeForEmbed(systemPrompt))}`,
    `msg:${sha1(normalizeForEmbed(userVisible))}`,
    `samp:${stableStringify(sampling)}`,
    `scope:${ctx.tenantScope ?? "default"}`,
  ].join("|")
  return sha256(rawKey)
}

/** Concatenate all non-system message content — the text we embed. */
export function queryTextOf(request: RouteRequest): string {
  return request.messages.filter((m) => m.role !== "system").map((m) => m.content).join("\n")
}

function stripInternal(entry: LiveEntry): SemanticCacheEntry {
  const { tenantScope: _tenantScope, queryText: _queryText, ...rest } = entry
  return rest
}

function stableStringify(value: Record<string, unknown>): string {
  return JSON.stringify(value, Object.keys(value).sort())
}

export function sha256(input: string): string {
  return createHash("sha256").update(input).digest("hex")
}

function sha1(input: string): string {
  return createHash("sha1").update(input).digest("hex")
}
