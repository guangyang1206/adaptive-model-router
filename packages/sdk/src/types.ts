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
  latencyClass?: "low" | "medium" | "high" | "unknown"
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
  store?: TraceStore
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
  // First (highest-priority) skip reason, kept for backward compatibility and
  // compact display. Prefer `skippedReasons` when you need the full picture.
  skippedReason?: string
  // All reasons a candidate was skipped, in priority order. A model can be both
  // disabled AND missing a capability; collapsing that to one reason hurts
  // explainability (and route-result learning). Empty/undefined when not skipped.
  skippedReasons?: string[]
}

export type RouteAttempt = {
  attemptNo: number
  modelId: string
  provider: string
  status: "success" | "failed" | "skipped"
  errorCode?: AdaptiveRouterErrorCode
  errorType?: string
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
  // Free-form routing decisions worth surfacing for explainability that aren't
  // errors or attempts, e.g. "fallback disabled: stream mode". Optional so
  // existing traces/consumers are unaffected.
  notes?: string[]
}

export type RouteResult<TResponse = ProviderResponse> = {
  response: TResponse
  routerTrace: RouterTrace
}

export type OpenAICompatibleClient = {
  chat?: {
    completions?: {
      create(request: Record<string, unknown>): Promise<unknown>
    }
  }
}

export type ProviderResponse = {
  id?: string
  model?: string
  choices?: unknown[]
  content?: string
  usage?: Usage
  raw?: unknown
}

export type ProviderAdapter = {
  id: string
  kind: ProviderKind
  listModels(): Promise<ModelProfile[]>
  chat(request: RouteRequest, model: ModelProfile): Promise<ProviderResponse>
  normalizeError(error: unknown): AdaptiveRouterError
}

export type TraceStore = {
  writeTrace(trace: RouterTrace): Promise<void> | void
  listTraces?(): Promise<RouterTrace[]> | RouterTrace[]
}

export type TraceStoreSummary = {
  totalRequests: number
  successRate: number
  fallbackCount: number
  estimatedCostUsd: number
  medianLatencyMs?: number
}

export type StoredRequest = {
  traceId: string
  decisionId: string
  status: RouterTrace["status"]
  chosenModel?: string
  reason: string
  attempts: RouteAttempt[]
  usage?: Usage
  estimated: boolean
  latencyMs?: number
  createdAt?: string
}

export type TraceStoreReader = TraceStore & {
  getSummary?(): Promise<TraceStoreSummary> | TraceStoreSummary
  listRequests?(): Promise<StoredRequest[]> | StoredRequest[]
  getRequest?(traceId: string): Promise<StoredRequest | undefined> | StoredRequest | undefined
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
