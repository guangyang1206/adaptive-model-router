export * from "./types.js"

import type {
  CandidateModel,
  ModelProfile,
  ProviderAdapter,
  RouteRequest,
  RouteResult,
  RouterConfig,
  RouterTrace,
} from "./types.js"

export type AdaptiveRouter = {
  chat(request: RouteRequest): Promise<RouteResult>
  evaluate(request: RouteRequest): Promise<{ candidates: CandidateModel[]; reason: string }>
  models(): Promise<ModelProfile[]>
  dashboard(options?: { port?: number }): Promise<{ url: string }>
}

export function createRouter(config: RouterConfig): AdaptiveRouter {
  const providers = config.providers ?? []
  const configuredModels = config.models ?? []

  async function models(): Promise<ModelProfile[]> {
    if (configuredModels.length > 0) return configuredModels
    const discovered = await Promise.all(providers.map((provider) => provider.listModels()))
    return discovered.flat()
  }

  async function evaluate(request: RouteRequest): Promise<{ candidates: CandidateModel[]; reason: string }> {
    const allModels = await models()
    const required = new Set(request.requiredCapabilities ?? [])
    if (request.tools?.length) required.add("tool-calling")
    if (request.stream) required.add("streaming")

    const candidates = allModels.map((model) => {
      const missing = [...required].filter((capability) => !model.capabilities.includes(capability))
      const skipped = !model.enabled || missing.length > 0
      return {
        modelId: model.id,
        provider: model.provider,
        score: skipped ? 0 : scoreModel(model, request),
        reasons: buildReasons(model, request),
        skipped,
        skippedReason: !model.enabled
          ? "model disabled"
          : missing.length > 0
            ? `missing capability: ${missing.join(", ")}`
            : undefined,
      }
    })

    return {
      candidates: candidates.sort((a, b) => b.score - a.score),
      reason: "Capability hard filter, then quality tier, health, latency, and cost within acceptable tier.",
    }
  }

  async function chat(request: RouteRequest): Promise<RouteResult> {
    const decision = await evaluate(request)
    const selected = decision.candidates.find((candidate) => !candidate.skipped)

    if (!selected) {
      const trace = createTrace(undefined, decision.candidates, "No candidate model satisfied required capabilities.", "failed")
      return { response: { error: "AR_NO_CANDIDATE" }, routerTrace: trace }
    }

    const allModels = await models()
    const model = allModels.find((entry) => entry.id === selected.modelId)
    const provider = providers.find((entry) => entry.id === selected.provider)

    if (!model || !provider) {
      const trace = createTrace(undefined, decision.candidates, "Selected model provider is not configured.", "failed")
      return { response: { error: "AR_NO_CANDIDATE" }, routerTrace: trace }
    }

    const started = Date.now()
    try {
      const response = await provider.chat(request, model)
      const trace = createTrace(model.id, decision.candidates, selected.reasons.join("; "), "success", Date.now() - started)
      return { response, routerTrace: trace }
    } catch (error) {
      const normalized = provider.normalizeError(error)
      const trace = createTrace(model.id, decision.candidates, normalized.message, "failed", Date.now() - started)
      trace.attempts.push({
        attemptNo: 1,
        modelId: model.id,
        provider: provider.id,
        status: "failed",
        errorCode: normalized.code,
        latencyMs: trace.latencyMs,
      })
      return { response: { error: normalized }, routerTrace: trace }
    }
  }

  async function dashboard(options?: { port?: number }): Promise<{ url: string }> {
    const port = options?.port ?? 4318
    return { url: `http://localhost:${port}` }
  }

  return { chat, evaluate, models, dashboard }
}

function scoreModel(model: ModelProfile, request: RouteRequest): number {
  const quality = request.route?.quality ?? "balanced"
  const tierScore = tierToScore(model.tier) >= tierToScore(quality) ? 40 : 10
  const healthScore = model.health?.status === "ok" ? 30 : model.health?.status === "degraded" ? 15 : 5
  const costScore = model.cost?.estimated ? 5 : 10
  return tierScore + healthScore + costScore
}

function buildReasons(model: ModelProfile, request: RouteRequest): string[] {
  const reasons = [`tier=${model.tier}`, `provider=${model.provider}`]
  if (request.route?.quality) reasons.push(`requested quality=${request.route.quality}`)
  if (model.health?.status) reasons.push(`health=${model.health.status}`)
  if (model.type) reasons.push(`type=${model.type}`)
  return reasons
}

function tierToScore(tier: string): number {
  return { standard: 1, balanced: 2, high: 3, critical: 4 }[tier] ?? 2
}

function createTrace(
  chosenModel: string | undefined,
  candidates: CandidateModel[],
  reason: string,
  status: RouterTrace["status"],
  latencyMs?: number,
): RouterTrace {
  return {
    traceId: `trace_${Date.now()}`,
    decisionId: `decision_${Date.now()}`,
    chosenModel,
    candidates,
    reason,
    attempts: [],
    estimated: true,
    latencyMs,
    status,
  }
}

export function createStaticProvider(id: string, models: ModelProfile[]): ProviderAdapter {
  return {
    id,
    kind: "openai-compatible",
    async listModels() {
      return models
    },
    async chat(_request, model) {
      return {
        id: `mock_${Date.now()}`,
        model: model.id,
        choices: [{ message: { role: "assistant", content: "This is a scaffold response." } }],
      }
    },
    normalizeError(error) {
      return {
        code: "AR_NETWORK_ERROR",
        message: error instanceof Error ? error.message : "Unknown provider error",
        provider: id,
        retryable: true,
      }
    },
  }
}
