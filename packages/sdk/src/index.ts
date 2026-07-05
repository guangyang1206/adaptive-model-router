export * from "./types.js"
export * from "./providers.js"
export * from "./storage.js"
export * from "./adapters.js"
export * from "./embedding.js"
export * from "./cache.js"
export * from "./learning.js"
export * from "./eval/dataset.js"
export * from "./eval/runner.js"
export * from "./eval/metrics.js"
export * from "./eval/baseline.js"
export * from "./eval/judge.js"

import { resolveEmbeddingProvider } from "./embedding.js"

import type {
  AdaptiveRouterError,
  AdaptiveRouterErrorCode,
  CacheContext,
  CandidateModel,
  EmbeddingProvider,
  ModelCapability,
  ModelProfile,
  OpenAICompatibleClient,
  ProviderAdapter,
  RouteAttempt,
  RoutePolicy,
  RouteRequest,
  RouteResult,
  RouteWeights,
  RouterConfig,
  RouterTrace,
  TraceStore,
  Usage,
} from "./types.js"

/**
 * Default routing weights. Every value is read verbatim from MVP-1's
 * hard-coded scoreModel (see detailed-design §0), so scoring with
 * BUILTIN_WEIGHTS is byte-for-byte identical to MVP-1. Changing a single value
 * here breaks the zero-byte compatibility guarantee — there is a snapshot test
 * that asserts exactly this.
 */
export const BUILTIN_WEIGHTS: RouteWeights = {
  version: "builtin",
  tierMatch: 40,
  tierMismatch: 10,
  successRate: 15,
  latency: { low: 10, medium: 6, high: 3 },
  costCoefficient: 100,
  health: { ok: 30, degraded: 15, limited: 12, unknown: 8, down: 0 },
}

export type EvaluationResult = {
  candidates: CandidateModel[]
  reason: string
}

export type DashboardHandle = {
  /** The URL the dashboard would be served at. */
  url: string
  /** Always false: the SDK does not start an HTTP server itself. */
  started: boolean
  /** Guidance on how to actually launch the dashboard server. */
  hint: string
}

export type AdaptiveRouter = {
  chat(request: RouteRequest): Promise<RouteResult>
  evaluate(request: RouteRequest): Promise<EvaluationResult>
  models(): Promise<ModelProfile[]>
  traces(): Promise<RouterTrace[]>
  wrapOpenAI(client: OpenAICompatibleClient): OpenAICompatibleClient
  dashboard(options?: { port?: number }): Promise<DashboardHandle>
}

export function createRouter(config: RouterConfig): AdaptiveRouter {
  const providers = config.providers ?? []
  const configuredModels = config.models ?? []
  const policy = normalizePolicy(config.policy)
  const store = config.store ?? createMemoryTraceStore()
  const weights = config.weights ?? BUILTIN_WEIGHTS
  const cache = config.cache

  // Embedding provider is resolved lazily on first cache use and memoized, so
  // routers that never touch the cache pay nothing (and the dynamic import of
  // an optional peer dependency never runs). resolve() never throws.
  let embeddingPromise: Promise<{ provider: EmbeddingProvider; notes: string[] }> | undefined
  function getEmbedding(): Promise<{ provider: EmbeddingProvider; notes: string[] }> {
    if (!embeddingPromise) embeddingPromise = resolveEmbeddingProvider(config.embedding ?? {})
    return embeddingPromise
  }

  async function models(): Promise<ModelProfile[]> {
    if (configuredModels.length > 0) return configuredModels
    const discovered = await Promise.all(providers.map((provider) => provider.listModels()))
    return discovered.flat()
  }

  async function evaluate(request: RouteRequest): Promise<EvaluationResult> {
    const allModels = await models()
    const required = inferRequiredCapabilities(request)
    const budget = request.route?.maxCostUsd

    const candidates = allModels.map((model) => {
      const missing = [...required].filter((capability) => !model.capabilities.includes(capability))
      const providerConfigured = providers.some((provider) => provider.id === model.provider)
      const budgetExceeded = budget !== undefined && estimateCost(model, request).costUsd > budget
      const skippedReasons = getSkippedReasons(model, providerConfigured, missing, budgetExceeded)
      const skipped = skippedReasons.length > 0

      return {
        modelId: model.id,
        provider: model.provider,
        score: skipped ? 0 : scoreModel(model, request, policy, weights),
        reasons: buildReasons(model, request, policy),
        skipped,
        skippedReason: skippedReasons[0],
        skippedReasons: skipped ? skippedReasons : undefined,
      }
    })

    return {
      candidates: candidates.sort((a, b) => b.score - a.score),
      reason: "Capability hard filter, then quality tier, health/success signal, latency, and cost within acceptable tier.",
    }
  }

  async function chat(request: RouteRequest): Promise<RouteResult> {
    // --- MVP-2: front cache lookup (only when a cache is configured) ---------
    let cacheNotes: string[] | undefined
    let cacheCtx: CacheContext | undefined
    if (cache) {
      const { provider: embProvider, notes: embNotes } = await getEmbedding()
      const decisionForKey = await evaluate(request)
      const chosenForKey = decisionForKey.candidates.find((candidate) => !candidate.skipped)
      cacheCtx = {
        modelId: chosenForKey?.modelId ?? "none",
        embeddingProviderId: embProvider.id,
        embed: (texts) => embProvider.embed(texts),
        degraded: embProvider.degraded,
        tenantScope: typeof request.metadata?.tenantScope === "string" ? request.metadata.tenantScope : undefined,
      }
      const lookup = await cache.get(request, cacheCtx)
      cacheNotes = [...embNotes, ...lookup.notes]
      if (lookup.hit) {
        const trace = createTrace(lookup.entry.routerTrace.chosenModel, lookup.entry.routerTrace.candidates, lookup.entry.routerTrace.reason, "success", 0)
        trace.usage = lookup.entry.routerTrace.usage
        trace.estimated = lookup.entry.routerTrace.estimated
        trace.estimatedCostUsd = lookup.entry.routerTrace.estimatedCostUsd
        trace.cacheHit = true
        if (weights.version !== "builtin") trace.weightsVersion = weights.version
        trace.notes = cacheNotes
        await safeWriteTrace(store, trace)
        return { response: lookup.entry.response, routerTrace: trace }
      }
    }

    const decision = await evaluate(request)
    const selectable = decision.candidates.filter((candidate) => !candidate.skipped)

    if (selectable.length === 0) {
      const trace = createTrace(undefined, decision.candidates, "No candidate model satisfied routing constraints.", "failed")
      trace.attempts.push({ attemptNo: 1, modelId: "none", provider: "none", status: "skipped", errorCode: "AR_NO_CANDIDATE" })
      if (cacheNotes?.length) trace.notes = cacheNotes
      await safeWriteTrace(store, trace)
      return { response: { content: "", raw: { error: "AR_NO_CANDIDATE" } }, routerTrace: trace }
    }

    const allModels = await models()
    const maxFallbacks = request.stream ? 0 : policy.maxFallbacks
    // Streaming disables fallback on purpose: retrying mid-stream would tear a
    // partially-emitted response. Record it so explainability stays honest —
    // otherwise a caller who set maxFallbacks:3 + stream:true silently gets 0.
    const streamNote = request.stream && policy.maxFallbacks > 0 ? ["fallback disabled: stream mode"] : undefined
    const notes = mergeNotes(cacheNotes, streamNote)
    const attempts: RouteAttempt[] = []
    const started = Date.now()
    let lastError: AdaptiveRouterError | undefined

    for (const candidate of selectable.slice(0, maxFallbacks + 1)) {
      const model = allModels.find((entry) => entry.id === candidate.modelId)
      const provider = providers.find((entry) => entry.id === candidate.provider)
      const attemptStarted = Date.now()

      if (!model || !provider) {
        attempts.push({ attemptNo: attempts.length + 1, modelId: candidate.modelId, provider: candidate.provider, status: "skipped", errorCode: "AR_NO_CANDIDATE" })
        continue
      }

      try {
        const response = await provider.chat(request, model)
        const latencyMs = Date.now() - attemptStarted
        const usage = response.usage ?? estimateUsage(model, request)
        const status = attempts.some((attempt) => attempt.status === "failed") ? "fallback_success" : "success"
        const trace = createTrace(model.id, decision.candidates, candidate.reasons.join("; "), status, Date.now() - started)
        trace.attempts = [...attempts, { attemptNo: attempts.length + 1, modelId: model.id, provider: provider.id, status: "success", latencyMs }]
        trace.usage = usage
        trace.estimated = usage.estimated
        trace.estimatedCostUsd = usage.costUsd
        trace.notes = notes
        // --- MVP-2: backfill cache on success (only when configured) ---------
        if (cache && cacheCtx) {
          trace.cacheHit = false
          if (weights.version !== "builtin") trace.weightsVersion = weights.version
          await cache.set(request, response, trace, cacheCtx)
        }
        await safeWriteTrace(store, trace)
        return { response, routerTrace: trace }
      } catch (error) {
        const normalized = provider.normalizeError(error)
        lastError = normalized
        attempts.push({
          attemptNo: attempts.length + 1,
          modelId: model.id,
          provider: provider.id,
          status: "failed",
          errorCode: normalized.code,
          errorType: normalized.retryable ? "retryable" : "final",
          latencyMs: Date.now() - attemptStarted,
        })

        if (!normalized.retryable) break
      }
    }

    const trace = createTrace(undefined, decision.candidates, lastError?.message ?? "All route attempts failed.", "failed", Date.now() - started)
    trace.attempts = attempts
    trace.notes = notes
    await safeWriteTrace(store, trace)
    return { response: { content: "", raw: { error: lastError } }, routerTrace: trace }
  }

  async function traces(): Promise<RouterTrace[]> {
    return (await store.listTraces?.()) ?? []
  }

  function wrapOpenAI(client: OpenAICompatibleClient): OpenAICompatibleClient {
    return {
      ...client,
      chat: {
        ...client.chat,
        completions: {
          ...client.chat?.completions,
          create: async (request: Record<string, unknown>) => {
            const result = await chat({
              messages: (request.messages as RouteRequest["messages"] | undefined) ?? [],
              tools: request.tools as RouteRequest["tools"],
              stream: request.stream as boolean | undefined,
              route: (request.metadata as { route?: RouteRequest["route"] } | undefined)?.route,
              metadata: request.metadata as Record<string, unknown> | undefined,
            })
            return result.response
          },
        },
      },
    }
  }

  async function dashboard(options?: { port?: number }): Promise<DashboardHandle> {
    const port = options?.port ?? 4318
    // NOTE: The SDK intentionally does not depend on the dashboard server package,
    // so this method does NOT start an HTTP server. It only computes the URL the
    // dashboard *would* be served at. To actually launch the dashboard, install
    // `@adaptive-router/dashboard` and call its `createDashboard({ port, data })`,
    // feeding it the router's traces via `createReadOnlyDataAccess`.
    return {
      url: `http://localhost:${port}`,
      started: false,
      hint: "createRouter().dashboard() does not start a server. Use @adaptive-router/dashboard's createDashboard({ port, data }) to launch it.",
    }
  }

  return { chat, evaluate, models, traces, wrapOpenAI, dashboard }
}

export function createMemoryTraceStore(): TraceStore {
  const traces: RouterTrace[] = []
  return {
    writeTrace(trace) {
      traces.push(trace)
    },
    listTraces() {
      return [...traces]
    },
  }
}

export function createStaticProvider(id: string, models: ModelProfile[], options: { failTimes?: number; errorCode?: AdaptiveRouterErrorCode } = {}): ProviderAdapter {
  let calls = 0

  return {
    id,
    kind: models[0]?.kind ?? "openai-compatible",
    async listModels() {
      return models
    },
    async chat(_request, model) {
      calls += 1
      if (options.failTimes && calls <= options.failTimes) {
        throw createProviderFailure(options.errorCode ?? "AR_PROVIDER_TIMEOUT", id, model.id)
      }

      const usage = estimateUsage(model, _request)
      return {
        id: `mock_${Date.now()}`,
        model: model.id,
        content: "This is a scaffold response.",
        choices: [{ message: { role: "assistant", content: "This is a scaffold response." } }],
        usage,
      }
    },
    normalizeError(error) {
      return normalizeProviderError(error, id)
    },
  }
}

function normalizePolicy(policy?: RoutePolicy): Required<RoutePolicy> {
  return {
    defaultQuality: policy?.defaultQuality ?? "balanced",
    stability: policy?.stability ?? "high",
    costMode: policy?.costMode ?? "optimize-within-quality-threshold",
    maxFallbacks: policy?.maxFallbacks ?? 1,
  }
}

function inferRequiredCapabilities(request: RouteRequest): Set<ModelCapability> {
  const required = new Set(request.requiredCapabilities ?? [])
  if (request.tools?.length) required.add("tool-calling")
  if (request.stream) required.add("streaming")
  if (request.route?.task === "code" || request.route?.task === "plan") required.add("reasoning")
  return required
}

function getSkippedReasons(model: ModelProfile, providerConfigured: boolean, missing: string[], budgetExceeded: boolean): string[] {
  const reasons: string[] = []
  if (!model.enabled) reasons.push("model disabled")
  if (!providerConfigured) reasons.push("provider not configured")
  if (missing.length > 0) reasons.push(`missing capability: ${missing.join(", ")}`)
  if (model.health?.status === "down") reasons.push("provider health down")
  if (budgetExceeded) reasons.push("cost limit exceeded")
  return reasons
}

function scoreModel(model: ModelProfile, request: RouteRequest, policy: Required<RoutePolicy>, weights: RouteWeights = BUILTIN_WEIGHTS): number {
  const requestedQuality = request.route?.quality ?? policy.defaultQuality
  const tierScore = tierToScore(model.tier) >= tierToScore(requestedQuality) ? weights.tierMatch : weights.tierMismatch
  const healthScore = weights.health[model.health?.status ?? "unknown"] ?? weights.health.unknown
  const successScore = Math.round((model.health?.successRate ?? 0.5) * weights.successRate)
  const latencyScore = weights.latency[model.latencyClass === "low" ? "low" : model.latencyClass === "medium" ? "medium" : "high"]
  const costScore = policy.costMode === "ignore" ? 0 : Math.max(0, 10 - estimateCost(model, request).costUsd * weights.costCoefficient)
  return tierScore + healthScore + successScore + latencyScore + costScore
}

function buildReasons(model: ModelProfile, request: RouteRequest, policy: Required<RoutePolicy>): string[] {
  const reasons = [`tier=${model.tier}`, `provider=${model.provider}`]
  reasons.push(`quality-threshold=${request.route?.quality ?? policy.defaultQuality}`)
  if (model.health?.status) reasons.push(`health=${model.health.status}`)
  if (model.type) reasons.push(`type=${model.type}`)
  if (request.route?.maxCostUsd !== undefined) reasons.push(`max-cost=${request.route.maxCostUsd}`)
  return reasons
}

function tierToScore(tier: string): number {
  return { standard: 1, balanced: 2, high: 3, critical: 4 }[tier] ?? 2
}

function estimateUsage(model: ModelProfile, request: RouteRequest): Usage {
  const inputTokens = Math.max(1, Math.ceil(totalMessageChars(request) / 4))
  const outputTokens = 32
  const cost = estimateCost(model, request, outputTokens)
  return {
    inputTokens,
    outputTokens,
    totalTokens: inputTokens + outputTokens,
    costUsd: cost.costUsd,
    estimated: true,
  }
}

export function estimateCost(model: ModelProfile, request: RouteRequest, outputTokens = 32): { costUsd: number } {
  const inputTokens = Math.max(1, Math.ceil(totalMessageChars(request) / 4))
  const inputRate = model.cost?.inputPer1M ?? 0
  const outputRate = model.cost?.outputPer1M ?? inputRate
  return { costUsd: (inputTokens / 1_000_000) * inputRate + (outputTokens / 1_000_000) * outputRate }
}

function totalMessageChars(request: RouteRequest): number {
  return request.messages.reduce((sum, message) => sum + message.content.length, 0)
}

function createTrace(
  chosenModel: string | undefined,
  candidates: CandidateModel[],
  reason: string,
  status: RouterTrace["status"],
  latencyMs?: number,
): RouterTrace {
  const id = `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
  return {
    traceId: `trace_${id}`,
    decisionId: `decision_${id}`,
    chosenModel,
    candidates,
    reason,
    attempts: [],
    estimated: true,
    latencyMs,
    status,
  }
}

function createProviderFailure(code: AdaptiveRouterErrorCode, provider: string, modelId: string): AdaptiveRouterError {
  return {
    code,
    message: code,
    provider,
    modelId,
    retryable: isRetryable(code),
  }
}

function normalizeProviderError(error: unknown, provider: string): AdaptiveRouterError {
  if (isAdaptiveRouterError(error)) return error
  return {
    code: "AR_NETWORK_ERROR",
    message: error instanceof Error ? error.message : "Unknown provider error",
    provider,
    retryable: true,
  }
}

function isAdaptiveRouterError(error: unknown): error is AdaptiveRouterError {
  return typeof error === "object" && error !== null && "code" in error && "retryable" in error
}

function isRetryable(code: AdaptiveRouterErrorCode): boolean {
  return ["AR_PROVIDER_RATE_LIMITED", "AR_PROVIDER_TIMEOUT", "AR_PROVIDER_5XX", "AR_NETWORK_ERROR"].includes(code)
}

async function safeWriteTrace(store: TraceStore, trace: RouterTrace): Promise<void> {
  try {
    await store.writeTrace(trace)
  } catch {
    // Storage errors must not break the model call path in MVP-0.
  }
}

/**
 * Merge optional note arrays into a single array, or undefined when both are
 * empty. Keeps the MVP-1 contract that traces without notes have `notes:
 * undefined` (not `[]`) so existing snapshot expectations stay intact.
 */
function mergeNotes(a: string[] | undefined, b: string[] | undefined): string[] | undefined {
  const merged = [...(a ?? []), ...(b ?? [])]
  return merged.length ? merged : undefined
}
