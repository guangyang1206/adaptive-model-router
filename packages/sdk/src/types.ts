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
  // MVP-2 (append-only, all opt-in). Unset ⇒ MVP-1 behavior byte-for-byte.
  cache?: SemanticCache
  weights?: RouteWeights
  embedding?: EmbeddingResolveOptions
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
  // MVP-2 (append-only, set only when the relevant feature is enabled):
  // true when this response was served from the semantic cache.
  cacheHit?: boolean
  // The RouteWeights.version used to score this decision. Only meaningful when
  // non-"builtin" weights were supplied; absent on the default MVP-1 path.
  weightsVersion?: string
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

// ---------------------------------------------------------------------------
// MVP-2 additions (append-only). Every field below is optional or lives on a
// brand-new type; no existing field is renamed, retyped, or made
// required. Not passing cache/weights/embedding keeps routing byte-for-byte
// identical to MVP-1 (see BUILTIN_WEIGHTS in index.ts).
// ---------------------------------------------------------------------------

/** An embedding is either a typed Float32Array or a plain number[]. */
export type EmbeddingVector = Float32Array | number[]

/**
 * Pluggable embedding backend. `degraded: true` marks the zero-dependency
 * hashing fallback whose vectors are only trustworthy for exact-match reuse
 * unless the caller explicitly opts into `hashSemantic`.
 */
export type EmbeddingProvider = {
  id: string
  dimensions: number
  degraded: boolean
  embed(texts: string[]): Promise<EmbeddingVector[]>
}

/**
 * Resolution options for {@link resolveEmbeddingProvider}. Fixed default
 * priority: explicit provider > OpenAI (fetch-only) > local transformers ONNX
 * > hashing fallback. `prefer` overrides the order.
 */
export type EmbeddingResolveOptions = {
  provider?: EmbeddingProvider
  openai?: { apiKey: string; model?: string; baseURL?: string; fetch?: typeof fetch }
  local?: { model?: string }
  hashing?: { dimensions?: number }
  prefer?: ("provider" | "openai" | "local" | "hashing")[]
}

/**
 * Externally-tunable routing weights. The default `BUILTIN_WEIGHTS`
 * (version "builtin") reproduces MVP-1's hard-coded scores exactly. Learned
 * candidates carry a distinct version and only take effect after a human
 * adopts them (Spec ruling ③).
 */
export type RouteWeights = {
  version: string
  tierMatch: number
  tierMismatch: number
  successRate: number
  latency: { low: number; medium: number; high: number }
  costCoefficient: number
  health: Record<NonNullable<ProviderHealth["status"]>, number>
}

/** A persisted semantic-cache entry. Stores the embedding to avoid re-embedding. */
export type SemanticCacheEntry = {
  key: string
  embedding?: EmbeddingVector
  embeddingProviderId: string
  request: RouteRequest
  response: ProviderResponse
  routerTrace: RouterTrace
  createdAt: string
  ttlMs?: number
}

/** Per-lookup context threaded into {@link SemanticCache}. */
export type CacheContext = {
  modelId: string
  embeddingProviderId: string
  embed?: (texts: string[]) => Promise<EmbeddingVector[]>
  degraded: boolean
  tenantScope?: string
  threshold?: number
  hashSemantic?: boolean
  ttlMs?: number
  /** Optional negative-word guard: return false to reject a semantic hit. */
  guard?: (query: string, matchQuery: string) => boolean
}

/** Result of a cache lookup. Notes are lifted verbatim into RouterTrace.notes. */
export type CacheLookup =
  | { hit: true; source: "exact" | "semantic"; similarity?: number; entry: SemanticCacheEntry; notes: string[] }
  | { hit: false; notes: string[] }

/** The semantic-cache contract used by createRouter's chat path. */
export type SemanticCache = {
  get(req: RouteRequest, ctx: CacheContext): Promise<CacheLookup>
  set(req: RouteRequest, res: ProviderResponse, trace: RouterTrace, ctx: CacheContext): Promise<void>
}

/** A single golden-dataset routing assertion. */
export type EvalCase = {
  id: string
  request: RouteRequest
  expect: {
    modelId?: string
    anyOf?: string[]
    maxCostUsd?: number
    maxLatencyMs?: number
    mustHaveCapabilities?: ModelCapability[]
    mustNotBeSkipped?: boolean
  }
}

/** Per-case evaluation outcome (input to metrics + dashboard Pass/Fail matrix). */
export type EvalCaseResult = {
  caseId: string
  chosenModel?: string
  expectedSatisfied: Record<string, boolean>
  rankOfExpected?: number
  skipped: boolean
  fallbackTriggered: boolean
}

/** One evaluation run over a dataset with a given weights version. */
export type EvalRunResult = {
  runId: string
  datasetId: string
  weightsVersion: string
  metrics: Record<string, number>
  perCase: EvalCaseResult[]
  createdAt: string
}

/** Regression comparison of a run against a saved baseline (CI gate). */
export type EvalRegressionReport = {
  baselineRunId: string
  currentRunId: string
  deltas: Record<string, { baseline: number; current: number; delta: number; regressed: boolean }>
  passed: boolean
}
