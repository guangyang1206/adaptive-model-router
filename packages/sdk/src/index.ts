export * from "./types.js"

import type {
  AdaptiveRouterError,
  AdaptiveRouterErrorCode,
  CandidateModel,
  ModelCapability,
  ModelProfile,
  OpenAICompatibleClient,
  ProviderAdapter,
  ProviderResponse,
  RouteAttempt,
  RoutePolicy,
  RouteRequest,
  RouteResult,
  RouterConfig,
  RouterTrace,
  TraceStore,
  Usage,
} from "./types.js"

export type EvaluationResult = {
  candidates: CandidateModel[]
  reason: string
}

export type AdaptiveRouter = {
  chat(request: RouteRequest): Promise<RouteResult>
  evaluate(request: RouteRequest): Promise<EvaluationResult>
  models(): Promise<ModelProfile[]>
  traces(): Promise<RouterTrace[]>
  wrapOpenAI(client: OpenAICompatibleClient): OpenAICompatibleClient
  dashboard(options?: { port?: number }): Promise<{ url: string }>
}

export function createRouter(config: RouterConfig): AdaptiveRouter {
  const providers = config.providers ?? []
  const configuredModels = config.models ?? []
  const policy = normalizePolicy(config.policy)
  const store = config.store ?? createMemoryTraceStore()

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
      const skippedReason = getSkippedReason(model, providerConfigured, missing, budgetExceeded)
      const skipped = skippedReason !== undefined

      return {
        modelId: model.id,
        provider: model.provider,
        score: skipped ? 0 : scoreModel(model, request, policy),
        reasons: buildReasons(model, request, policy),
        skipped,
        skippedReason,
      }
    })

    return {
      candidates: candidates.sort((a, b) => b.score - a.score),
      reason: "Capability hard filter, then quality tier, health/success signal, latency, and cost within acceptable tier.",
    }
  }

  async function chat(request: RouteRequest): Promise<RouteResult> {
    const decision = await evaluate(request)
    const selectable = decision.candidates.filter((candidate) => !candidate.skipped)

    if (selectable.length === 0) {
      const trace = createTrace(undefined, decision.candidates, "No candidate model satisfied routing constraints.", "failed")
      trace.attempts.push({ attemptNo: 1, modelId: "none", provider: "none", status: "skipped", errorCode: "AR_NO_CANDIDATE" })
      await safeWriteTrace(store, trace)
      return { response: { content: "", raw: { error: "AR_NO_CANDIDATE" } }, routerTrace: trace }
    }

    const allModels = await models()
    const maxFallbacks = request.stream ? 0 : policy.maxFallbacks
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

  async function dashboard(options?: { port?: number }): Promise<{ url: string }> {
    const port = options?.port ?? 4318
    return { url: `http://localhost:${port}` }
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

function getSkippedReason(model: ModelProfile, providerConfigured: boolean, missing: string[], budgetExceeded: boolean): string | undefined {
  if (!model.enabled) return "model disabled"
  if (!providerConfigured) return "provider not configured"
  if (missing.length > 0) return `missing capability: ${missing.join(", ")}`
  if (model.health?.status === "down") return "provider health down"
  if (budgetExceeded) return "cost limit exceeded"
  return undefined
}

function scoreModel(model: ModelProfile, request: RouteRequest, policy: Required<RoutePolicy>): number {
  const requestedQuality = request.route?.quality ?? policy.defaultQuality
  const tierScore = tierToScore(model.tier) >= tierToScore(requestedQuality) ? 40 : 10
  const healthScore = healthToScore(model.health?.status)
  const successScore = Math.round((model.health?.successRate ?? 0.5) * 15)
  const latencyScore = model.latencyClass === "low" ? 10 : model.latencyClass === "medium" ? 6 : 3
  const costScore = policy.costMode === "ignore" ? 0 : Math.max(0, 10 - estimateCost(model, request).costUsd * 100)
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

function healthToScore(status: string | undefined): number {
  return { ok: 30, degraded: 15, limited: 12, unknown: 8, down: 0 }[status ?? "unknown"] ?? 8
}

function estimateUsage(model: ModelProfile, request: RouteRequest): Usage {
  const inputTokens = Math.max(1, Math.ceil(request.messages.map((message) => message.content.length).join(" ").length / 4))
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

function estimateCost(model: ModelProfile, request: RouteRequest, outputTokens = 32): { costUsd: number } {
  const inputTokens = Math.max(1, Math.ceil(request.messages.map((message) => message.content.length).join(" ").length / 4))
  const inputRate = model.cost?.inputPer1M ?? 0
  const outputRate = model.cost?.outputPer1M ?? inputRate
  return { costUsd: (inputTokens / 1_000_000) * inputRate + (outputTokens / 1_000_000) * outputRate }
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
