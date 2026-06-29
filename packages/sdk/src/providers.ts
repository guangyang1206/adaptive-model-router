import type {
  AdaptiveRouterError,
  AdaptiveRouterErrorCode,
  ModelProfile,
  ProviderAdapter,
  ProviderKind,
  RouteRequest,
  Usage,
} from "./types.js"

type FetchLike = (input: string | URL, init?: RequestInit) => Promise<Response>

export type ProviderFactoryOptions = {
  apiKey?: string
  baseURL?: string
  fetch?: FetchLike
  models?: ModelProfile[]
  timeoutMs?: number
}

export type OllamaProviderOptions = Omit<ProviderFactoryOptions, "apiKey"> & {
  baseURL?: string
}

const defaultFetch: FetchLike = async (input, init) => fetch(input, init)

export function createOpenAIProvider(options: ProviderFactoryOptions): ProviderAdapter {
  return createOpenAICompatibleProvider({
    ...options,
    id: "openai",
    baseURL: options.baseURL ?? "https://api.openai.com/v1",
    kind: "native",
    defaultModels: [
      createModelProfile({
        id: "openai/gpt-4.1-mini",
        provider: "openai",
        model: "gpt-4.1-mini",
        type: "commercial",
        kind: "native",
        tier: "balanced",
        contextWindow: 128000,
        capabilities: ["reasoning", "tool-calling", "json-mode", "streaming"],
        inputPer1M: 0.4,
        outputPer1M: 1.6,
      }),
      createModelProfile({
        id: "openai/gpt-4.1",
        provider: "openai",
        model: "gpt-4.1",
        type: "commercial",
        kind: "native",
        tier: "high",
        contextWindow: 128000,
        capabilities: ["reasoning", "tool-calling", "json-mode", "vision", "streaming"],
        inputPer1M: 2,
        outputPer1M: 8,
      }),
    ],
  })
}

export function createDeepSeekProvider(options: ProviderFactoryOptions): ProviderAdapter {
  return createOpenAICompatibleProvider({
    ...options,
    id: "deepseek",
    baseURL: options.baseURL ?? "https://api.deepseek.com/v1",
    kind: "openai-compatible",
    defaultModels: [
      createModelProfile({
        id: "deepseek/deepseek-chat",
        provider: "deepseek",
        model: "deepseek-chat",
        type: "open-source",
        kind: "openai-compatible",
        tier: "balanced",
        contextWindow: 64000,
        capabilities: ["reasoning", "json-mode", "streaming"],
        inputPer1M: 0.27,
        outputPer1M: 1.1,
      }),
      createModelProfile({
        id: "deepseek/deepseek-reasoner",
        provider: "deepseek",
        model: "deepseek-reasoner",
        type: "open-source",
        kind: "openai-compatible",
        tier: "high",
        contextWindow: 64000,
        capabilities: ["reasoning", "json-mode", "streaming"],
        inputPer1M: 0.55,
        outputPer1M: 2.19,
      }),
    ],
  })
}

export function createQwenProvider(options: ProviderFactoryOptions): ProviderAdapter {
  return createOpenAICompatibleProvider({
    ...options,
    id: "qwen",
    // DashScope OpenAI-compatible mode. Override `baseURL` for self-hosted /
    // alternative gateways (e.g. an OpenAI-compatible vLLM serving Qwen).
    baseURL: options.baseURL ?? "https://dashscope.aliyuncs.com/compatible-mode/v1",
    kind: "openai-compatible",
    defaultModels: [
      createModelProfile({
        id: "qwen/qwen-plus",
        provider: "qwen",
        model: "qwen-plus",
        type: "open-source",
        kind: "openai-compatible",
        tier: "balanced",
        contextWindow: 131072,
        capabilities: ["reasoning", "tool-calling", "json-mode", "streaming"],
        inputPer1M: 0.4,
        outputPer1M: 1.2,
      }),
      createModelProfile({
        id: "qwen/qwen-max",
        provider: "qwen",
        model: "qwen-max",
        type: "open-source",
        kind: "openai-compatible",
        tier: "high",
        contextWindow: 32768,
        capabilities: ["reasoning", "tool-calling", "json-mode", "streaming"],
        inputPer1M: 1.6,
        outputPer1M: 6.4,
      }),
    ],
  })
}

export function createAnthropicProvider(options: ProviderFactoryOptions): ProviderAdapter {
  const fetchImpl = options.fetch ?? defaultFetch
  const baseURL = trimTrailingSlash(options.baseURL ?? "https://api.anthropic.com/v1")
  const models = options.models ?? [
    createModelProfile({
      id: "anthropic/claude-3-5-haiku-latest",
      provider: "anthropic",
      model: "claude-3-5-haiku-latest",
      type: "commercial",
      kind: "native",
      tier: "balanced",
      contextWindow: 200000,
      capabilities: ["reasoning", "tool-calling", "json-mode", "vision", "streaming"],
      inputPer1M: 0.8,
      outputPer1M: 4,
    }),
    createModelProfile({
      id: "anthropic/claude-sonnet-4-0",
      provider: "anthropic",
      model: "claude-sonnet-4-0",
      type: "commercial",
      kind: "native",
      tier: "high",
      contextWindow: 200000,
      capabilities: ["reasoning", "tool-calling", "json-mode", "vision", "streaming"],
      inputPer1M: 3,
      outputPer1M: 15,
    }),
  ]

  return {
    id: "anthropic",
    kind: "native",
    async listModels() {
      return models
    },
    async chat(request, model) {
      assertApiKey(options.apiKey, "anthropic")
      const response = await fetchImpl(`${baseURL}/messages`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-api-key": options.apiKey ?? "",
          "anthropic-version": "2023-06-01",
        },
        body: JSON.stringify(toAnthropicRequest(request, model)),
        signal: createTimeoutSignal(options.timeoutMs),
      })

      if (!response.ok) throw await createHttpError(response, "anthropic", model.id)
      const raw = await response.json() as AnthropicResponse
      const content = raw.content?.map((part) => part.text ?? "").join("") ?? ""
      return {
        id: raw.id,
        model: model.id,
        content,
        choices: [{ message: { role: "assistant", content } }],
        usage: raw.usage ? normalizeUsage(raw.usage.input_tokens, raw.usage.output_tokens, model, false) : undefined,
        raw,
      }
    },
    normalizeError(error) {
      return normalizeProviderError(error, "anthropic")
    },
  }
}

export function createOllamaProvider(options: OllamaProviderOptions = {}): ProviderAdapter {
  const fetchImpl = options.fetch ?? defaultFetch
  const baseURL = trimTrailingSlash(options.baseURL ?? "http://localhost:11434")
  const models = options.models ?? [
    createModelProfile({
      id: "ollama/llama3.1",
      provider: "ollama",
      model: "llama3.1",
      type: "self-hosted",
      kind: "self-hosted",
      tier: "balanced",
      contextWindow: 8192,
      capabilities: ["reasoning", "streaming"],
      inputPer1M: 0,
      outputPer1M: 0,
      estimated: true,
    }),
  ]

  return {
    id: "ollama",
    kind: "self-hosted",
    async listModels() {
      return models
    },
    async chat(request, model) {
      const response = await fetchImpl(`${baseURL}/api/chat`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(toOllamaRequest(request, model)),
        signal: createTimeoutSignal(options.timeoutMs),
      })

      if (!response.ok) throw await createHttpError(response, "ollama", model.id)
      const raw = await response.json() as OllamaResponse
      const content = raw.message?.content ?? ""
      const promptTokens = raw.prompt_eval_count
      const outputTokens = raw.eval_count
      return {
        id: raw.created_at,
        model: model.id,
        content,
        choices: [{ message: { role: "assistant", content } }],
        usage: promptTokens !== undefined || outputTokens !== undefined
          ? normalizeUsage(promptTokens ?? 0, outputTokens ?? 0, model, true)
          : undefined,
        raw,
      }
    },
    normalizeError(error) {
      return normalizeProviderError(error, "ollama")
    },
  }
}

type OpenAICompatibleOptions = ProviderFactoryOptions & {
  id: string
  kind: ProviderKind
  defaultModels: ModelProfile[]
}

function createOpenAICompatibleProvider(options: OpenAICompatibleOptions): ProviderAdapter {
  const fetchImpl = options.fetch ?? defaultFetch
  const baseURL = trimTrailingSlash(options.baseURL ?? "")
  const models = options.models ?? options.defaultModels

  return {
    id: options.id,
    kind: options.kind,
    async listModels() {
      return models
    },
    async chat(request, model) {
      assertApiKey(options.apiKey, options.id)
      const response = await fetchImpl(`${baseURL}/chat/completions`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${options.apiKey}`,
        },
        body: JSON.stringify(toOpenAICompatibleRequest(request, model)),
        signal: createTimeoutSignal(options.timeoutMs),
      })

      if (!response.ok) throw await createHttpError(response, options.id, model.id)
      const raw = await response.json() as OpenAICompatibleResponse
      const content = raw.choices?.[0]?.message?.content ?? ""
      return {
        id: raw.id,
        model: model.id,
        content,
        choices: raw.choices,
        usage: raw.usage ? normalizeUsage(raw.usage.prompt_tokens, raw.usage.completion_tokens, model, false) : undefined,
        raw,
      }
    },
    normalizeError(error) {
      return normalizeProviderError(error, options.id)
    },
  }
}

type CreateModelProfileInput = Pick<ModelProfile, "id" | "provider" | "model" | "type" | "kind" | "tier" | "contextWindow" | "capabilities"> & {
  inputPer1M: number
  outputPer1M: number
  estimated?: boolean
}

function createModelProfile(input: CreateModelProfileInput): ModelProfile {
  return {
    ...input,
    enabled: true,
    latencyClass: "medium",
    cost: {
      inputPer1M: input.inputPer1M,
      outputPer1M: input.outputPer1M,
      currency: "USD",
      estimated: input.estimated ?? true,
    },
    health: { status: "unknown", successRate: 0.5 },
  }
}

function toOpenAICompatibleRequest(request: RouteRequest, model: ModelProfile) {
  return {
    model: model.model,
    messages: request.messages,
    tools: request.tools,
    stream: request.stream ?? false,
  }
}

function toAnthropicRequest(request: RouteRequest, model: ModelProfile) {
  const system = request.messages.filter((message) => message.role === "system").map((message) => message.content).join("\n\n")
  const messages = request.messages
    .filter((message) => message.role !== "system")
    .map((message) => ({ role: message.role === "assistant" ? "assistant" : "user", content: message.content }))

  return {
    model: model.model,
    max_tokens: 1024,
    system: system || undefined,
    messages,
    tools: request.tools,
    stream: request.stream ?? false,
  }
}

function toOllamaRequest(request: RouteRequest, model: ModelProfile) {
  return {
    model: model.model,
    messages: request.messages.map((message) => ({ role: message.role === "tool" ? "user" : message.role, content: message.content })),
    stream: false,
  }
}

type OpenAICompatibleResponse = {
  id?: string
  choices?: { message?: { content?: string } }[]
  usage?: { prompt_tokens?: number; completion_tokens?: number }
}

type AnthropicResponse = {
  id?: string
  content?: { type?: string; text?: string }[]
  usage?: { input_tokens?: number; output_tokens?: number }
}

type OllamaResponse = {
  created_at?: string
  message?: { content?: string }
  prompt_eval_count?: number
  eval_count?: number
}

function normalizeUsage(inputTokens = 0, outputTokens = 0, model: ModelProfile, estimated: boolean): Usage {
  const inputRate = model.cost?.inputPer1M ?? 0
  const outputRate = model.cost?.outputPer1M ?? inputRate
  return {
    inputTokens,
    outputTokens,
    totalTokens: inputTokens + outputTokens,
    costUsd: (inputTokens / 1_000_000) * inputRate + (outputTokens / 1_000_000) * outputRate,
    estimated,
  }
}

async function createHttpError(response: Response, provider: string, modelId: string): Promise<AdaptiveRouterError> {
  const body = await safeReadText(response)
  const code = statusToErrorCode(response.status)
  return {
    code,
    message: body || `${provider} request failed with status ${response.status}`,
    provider,
    modelId,
    retryable: isRetryable(code),
  }
}

function statusToErrorCode(status: number): AdaptiveRouterErrorCode {
  if (status === 401 || status === 403) return "AR_PROVIDER_AUTH_FAILED"
  if (status === 408) return "AR_PROVIDER_TIMEOUT"
  if (status === 429) return "AR_PROVIDER_RATE_LIMITED"
  if (status >= 500) return "AR_PROVIDER_5XX"
  if (status === 400) return "AR_INVALID_REQUEST"
  return "AR_NETWORK_ERROR"
}

function normalizeProviderError(error: unknown, provider: string): AdaptiveRouterError {
  if (isAdaptiveRouterError(error)) return error
  if (error instanceof DOMException && error.name === "AbortError") {
    return { code: "AR_PROVIDER_TIMEOUT", message: "Provider request timed out", provider, retryable: true }
  }
  return {
    code: "AR_NETWORK_ERROR",
    message: error instanceof Error ? error.message : "Unknown provider error",
    provider,
    retryable: true,
  }
}

function assertApiKey(apiKey: string | undefined, provider: string): void {
  if (!apiKey) {
    throw {
      code: "AR_PROVIDER_AUTH_FAILED",
      message: `${provider} apiKey is required`,
      provider,
      retryable: false,
    } satisfies AdaptiveRouterError
  }
}

function createTimeoutSignal(timeoutMs: number | undefined): AbortSignal | undefined {
  if (!timeoutMs) return undefined
  return AbortSignal.timeout(timeoutMs)
}

async function safeReadText(response: Response): Promise<string> {
  try {
    return await response.text()
  } catch {
    return ""
  }
}

function trimTrailingSlash(value: string): string {
  return value.endsWith("/") ? value.slice(0, -1) : value
}

function isAdaptiveRouterError(error: unknown): error is AdaptiveRouterError {
  return typeof error === "object" && error !== null && "code" in error && "retryable" in error
}

function isRetryable(code: AdaptiveRouterErrorCode): boolean {
  return ["AR_PROVIDER_RATE_LIMITED", "AR_PROVIDER_TIMEOUT", "AR_PROVIDER_5XX", "AR_NETWORK_ERROR"].includes(code)
}
