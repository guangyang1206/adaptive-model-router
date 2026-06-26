export type RouteTask = "plan" | "code" | "tool" | "final" | "extract" | "summarize"

export type QualityPreference = "standard" | "balanced" | "high" | "critical"
export type StabilityPreference = "normal" | "high"

export type ModelCapability =
  | "reasoning"
  | "tool-calling"
  | "json-mode"
  | "vision"
  | "streaming"
  | "embeddings"

export type ModelType = "commercial" | "open-source" | "self-hosted"

export type ProviderKind = "native" | "openai-compatible" | "self-hosted"

export type ChatMessage = {
  role: "system" | "user" | "assistant" | "tool"
  content: string
}

export type ModelProfile = {
  id: string
  provider: string
  model: string
  type: ModelType
  kind: ProviderKind
  capabilities: ModelCapability[]
  tier: QualityPreference
  contextWindow: number
  enabled: boolean
  cost?: {
    inputPer1M?: number
    outputPer1M?: number
    currency?: "USD"
    estimated?: boolean
  }
  health?: ProviderHealth
}

export type ProviderHealth = {
  status: "ok" | "degraded" | "limited" | "down" | "unknown"
  successRate?: number
  consecutiveFailures?: number
  latencyP50Ms?: number
  latencyP95Ms?: number
  lastError?: string
}

export type RoutePolicy = {
  defaultQuality?: QualityPreference
  stability?: StabilityPreference
  costMode?: "ignore" | "optimize-within-quality-threshold"
  maxFallbacks?: number
}

export type RouterConfig = {
  providers: ProviderAdapter[]
  models?: ModelProfile[]
  policy?: RoutePolicy
  store?: {
    type: "sqlite" | "jsonl" | "memory"
    path?: string
  }
}

export type RouteRequest = {
  messages: ChatMessage[]
  tools?: unknown[]
  stream?: boolean
  requiredCapabilities?: ModelCapability[]
  route?: {
    task?: RouteTask
    quality?: QualityPreference
    stability?: StabilityPreference
    latencyMs?: number
    maxCostUsd?: number
    explain?: boolean
  }
  metadata?: Record<string, unknown>
}

export type CandidateModel = {
  modelId: string
  provider: string
  score: number
  reasons: string[]
  skipped?: boolean
  skippedReason?: string
}

export type RouteAttempt = {
  attemptNo: number
  modelId: string
  provider: string
  status: "success" | "failed" | "skipped"
  errorCode?: AdaptiveRouterErrorCode
  latencyMs?: number
}

export type Usage = {
  inputTokens?: number
  outputTokens?: number
  totalTokens?: number
  costUsd?: number
  estimated: boolean
}

export type RouterTrace = {
  traceId: string
  decisionId: string
  chosenModel?: string
  candidates: CandidateModel[]
  reason: string
  attempts: RouteAttempt[]
  usage?: Usage
  estimatedCostUsd?: number
  estimated: boolean
  latencyMs?: number
  status: "success" | "failed" | "fallback_success"
}

export type RouteResult<TResponse = unknown> = {
  response: TResponse
  routerTrace: RouterTrace
}

export type ProviderAdapter = {
  id: string
  kind: ProviderKind
  listModels(): Promise<ModelProfile[]>
  chat(request: RouteRequest, model: ModelProfile): Promise<unknown>
  normalizeError(error: unknown): AdaptiveRouterError
}

export type AdaptiveRouterErrorCode =
  | "AR_NO_CANDIDATE"
  | "AR_PROVIDER_AUTH_FAILED"
  | "AR_PROVIDER_RATE_LIMITED"
  | "AR_PROVIDER_TIMEOUT"
  | "AR_PROVIDER_5XX"
  | "AR_NETWORK_ERROR"
  | "AR_CONTEXT_EXCEEDED"
  | "AR_INVALID_REQUEST"
  | "AR_STREAM_INTERRUPTED"
  | "AR_STORAGE_UNAVAILABLE"

export type AdaptiveRouterError = {
  code: AdaptiveRouterErrorCode
  message: string
  provider?: string
  modelId?: string
  retryable: boolean
  decisionId?: string
}
