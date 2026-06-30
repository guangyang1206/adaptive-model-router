import type {
  AdaptiveRouterError,
  AdaptiveRouterErrorCode,
  ModelCapability,
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

export type VLLMProviderOptions = ProviderFactoryOptions & {
  /**
   * Base URL of the self-hosted vLLM OpenAI-compatible server, e.g.
   * "http://localhost:8000/v1". Required — there is no sensible public default
   * for a self-hosted endpoint.
   */
  baseURL: string
  /**
   * The served model name as passed to `vllm serve <model>`, e.g.
   * "meta-llama/Llama-3.1-8B-Instruct". Used to synthesize a default model
   * profile when `models` is not supplied.
   */
  model?: string
  /**
   * Capabilities to advertise for the synthesized profile. Defaults to
   * ["reasoning", "streaming"]. Add "tool-calling" only if the served model
   * and your vLLM build actually support it, otherwise the router may route
   * tool requests here and have them dropped.
   */
  capabilities?: ModelCapability[]
  /** Context window of the served model. Defaults to 8192. */
  contextWindow?: number
  /** Quality tier used for routing. Defaults to "balanced". */
  tier?: ModelProfile["tier"]
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

export function createVLLMProvider(options: VLLMProviderOptions): ProviderAdapter {
  if (!options.baseURL) {
    throw {
      code: "AR_INVALID_REQUEST",
      message: "vLLM baseURL is required (e.g. http://localhost:8000/v1)",
      provider: "vllm",
      retryable: false,
    } satisfies AdaptiveRouterError
  }

  const servedModel = options.model ?? "vllm-model"
  const defaultModels: ModelProfile[] = [
    createModelProfile({
      // Namespace the served model under the provider id so multiple
      // self-hosted backends do not collide in the router's model table.
      id: `vllm/${servedModel}`,
      provider: "vllm",
      model: servedModel,
      type: "self-hosted",
      kind: "self-hosted",
      tier: options.tier ?? "balanced",
      contextWindow: options.contextWindow ?? 8192,
      // tool-calling is intentionally NOT advertised by default: the served
      // model is unknown and the OpenAI-shaped tools we forward may not be
      // honored. Opt in via `capabilities` when the backend supports it.
      capabilities: options.capabilities ?? ["reasoning", "streaming"],
      // Self-hosted inference has no per-token vendor price. Cost is the user's
      // own compute, so we report 0 and mark it estimated.
      inputPer1M: 0,
      outputPer1M: 0,
      estimated: true,
    }),
  ]

  return createOpenAICompatibleProvider({
    ...options,
    id: "vllm",
    baseURL: options.baseURL,
    kind: "self-hosted",
    // vLLM only enforces a key when started with --api-key. Treat it as
    // optional and forward the header only when one was provided.
    requireApiKey: false,
    defaultModels,
  })
}

export function createAnthropicProvider(options: ProviderFactoryOptions): ProviderAdapter {
  const fetchImpl = options.fetch ?? defaultFetch
  const baseURL = trimTrailingSlash(options.baseURL ?? "https://api.anthropic.com/v1")
  const models = options.models ?? [
    // NOTE: tool-calling is intentionally NOT advertised yet. The Anthropic
    // adapter still passes OpenAI-shaped tools, which Anthropic's API does not
    // accept. Advertising the capability would make the router select Anthropic
    // for tool-calling requests and then silently drop the tools. Re-add
    // "tool-calling" only once toAnthropicRequest maps to Anthropic's tool schema.
    createModelProfile({
      id: "anthropic/claude-3-5-haiku-latest",
      provider: "anthropic",
      model: "claude-3-5-haiku-latest",
      type: "commercial",
      kind: "native",
      tier: "balanced",
      contextWindow: 200000,
      capabilities: ["reasoning", "json-mode", "vision", "streaming"],
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
      capabilities: ["reasoning", "json-mode", "vision", "streaming"],
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

export function createGeminiProvider(options: ProviderFactoryOptions): ProviderAdapter {
  const fetchImpl = options.fetch ?? defaultFetch
  // Google Generative Language API (Gemini). Override `baseURL` for a proxy or
  // a Vertex-compatible gateway exposing the same generateContent shape.
  const baseURL = trimTrailingSlash(options.baseURL ?? "https://generativelanguage.googleapis.com/v1beta")
  const models = options.models ?? [
    createModelProfile({
      id: "gemini/gemini-2.5-flash",
      provider: "gemini",
      model: "gemini-2.5-flash",
      type: "commercial",
      kind: "native",
      tier: "balanced",
      contextWindow: 1048576,
      capabilities: ["reasoning", "tool-calling", "json-mode", "vision", "streaming"],
      inputPer1M: 0.3,
      outputPer1M: 2.5,
    }),
    createModelProfile({
      id: "gemini/gemini-2.5-pro",
      provider: "gemini",
      model: "gemini-2.5-pro",
      type: "commercial",
      kind: "native",
      tier: "high",
      contextWindow: 1048576,
      capabilities: ["reasoning", "tool-calling", "json-mode", "vision", "streaming"],
      inputPer1M: 1.25,
      outputPer1M: 10,
    }),
  ]

  return {
    id: "gemini",
    kind: "native",
    async listModels() {
      return models
    },
    async chat(request, model) {
      assertApiKey(options.apiKey, "gemini")
      const response = await fetchImpl(`${baseURL}/models/${model.model}:generateContent`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          // Header-based auth keeps the key out of the request URL / access logs.
          "x-goog-api-key": options.apiKey ?? "",
        },
        body: JSON.stringify(toGeminiRequest(request)),
        signal: createTimeoutSignal(options.timeoutMs),
      })

      if (!response.ok) throw await createHttpError(response, "gemini", model.id)
      const raw = await response.json() as GeminiResponse
      const content = raw.candidates?.[0]?.content?.parts?.map((part) => part.text ?? "").join("") ?? ""
      const usage = raw.usageMetadata
      return {
        id: raw.responseId,
        model: model.id,
        content,
        choices: [{ message: { role: "assistant", content } }],
        usage: usage
          ? normalizeUsage(usage.promptTokenCount ?? 0, usage.candidatesTokenCount ?? 0, model, false)
          : undefined,
        raw,
      }
    },
    normalizeError(error) {
      return normalizeProviderError(error, "gemini")
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
  /**
   * Whether an API key is mandatory. Commercial OpenAI-compatible gateways
   * (OpenAI, DeepSeek, Qwen) require one. Self-hosted servers such as vLLM
   * usually run open, so they set this to false and only attach the
   * Authorization header when a key is actually provided.
   */
  requireApiKey?: boolean
}

function createOpenAICompatibleProvider(options: OpenAICompatibleOptions): ProviderAdapter {
  const fetchImpl = options.fetch ?? defaultFetch
  const baseURL = trimTrailingSlash(options.baseURL ?? "")
  const models = options.models ?? options.defaultModels
  const requireApiKey = options.requireApiKey ?? true

  return {
    id: options.id,
    kind: options.kind,
    async listModels() {
      return models
    },
    async chat(request, model) {
      if (requireApiKey) assertApiKey(options.apiKey, options.id)
      const headers: Record<string, string> = { "content-type": "application/json" }
      // Only send Authorization when a key exists. vLLM rejects requests with a
      // bogus "Bearer undefined" header when --api-key was not configured.
      if (options.apiKey) headers.authorization = `Bearer ${options.apiKey}`
      const response = await fetchImpl(`${baseURL}/chat/completions`, {
        method: "POST",
        headers,
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
    // tools intentionally omitted: see capability note in createAnthropicProvider.
    // OpenAI-shaped tools are not valid Anthropic input and would be rejected.
    stream: request.stream ?? false,
  }
}

function toGeminiRequest(request: RouteRequest) {
  // Gemini separates the system prompt (systemInstruction) from the turn list
  // and uses role "model" for assistant turns. Tool messages fold into the user
  // turn for MVP parity with the other adapters.
  const system = request.messages
    .filter((message) => message.role === "system")
    .map((message) => message.content)
    .join("\n\n")
  const contents = request.messages
    .filter((message) => message.role !== "system")
    .map((message) => ({
      role: message.role === "assistant" ? "model" : "user",
      parts: [{ text: message.content }],
    }))

  return {
    contents,
    systemInstruction: system ? { parts: [{ text: system }] } : undefined,
    // Gemini expects function tools wrapped as `tools: [{ functionDeclarations }]`,
    // not the flat OpenAI `{ type: "function", function: {...} }` array. Translate
    // so a tool-calling request that routes here actually carries its tools.
    tools: toGeminiTools(request.tools),
  }
}

type OpenAIToolShape = {
  type?: string
  function?: { name?: string; description?: string; parameters?: unknown }
}

type GeminiFunctionDeclaration = { name: string; description?: string; parameters?: unknown }

/**
 * Map OpenAI-style tool definitions to Gemini's `functionDeclarations` shape.
 * Returns `undefined` when there are no usable function tools, so the request
 * body omits the `tools` field entirely rather than sending an empty array.
 */
function toGeminiTools(tools: unknown[] | undefined) {
  if (!tools?.length) return undefined
  const functionDeclarations = tools
    .map((tool): GeminiFunctionDeclaration | undefined => {
      const fn = (tool as OpenAIToolShape)?.function
      if (!fn?.name) return undefined
      return {
        name: fn.name,
        description: fn.description,
        parameters: fn.parameters,
      }
    })
    .filter((declaration): declaration is GeminiFunctionDeclaration => declaration !== undefined)

  if (functionDeclarations.length === 0) return undefined
  return [{ functionDeclarations }]
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

type GeminiResponse = {
  responseId?: string
  candidates?: { content?: { parts?: { text?: string }[] } }[]
  usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number; totalTokenCount?: number }
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
