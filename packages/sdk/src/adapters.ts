import type { ChatMessage, RouteRequest, RouterTrace } from "./types.js"
import type { AdaptiveRouter } from "./index.js"

// ---------------------------------------------------------------------------
// LangChain / LangGraph adapter
//
// Design: a dependency-free *structural* bridge, mirroring `wrapOpenAI`. We do
// NOT import `@langchain/core` — that would force a heavy peer dependency on an
// MVP SDK and couple us to a fast-moving package. Instead we duck-type the
// small surface LangChain and LangGraph actually rely on:
//   - input: a string, a `[role, content]` tuple, an OpenAI `{role, content}`
//     object, or a LangChain `BaseMessage` (which exposes `_getType()` and a
//     `content` that is either a string or an array of `{type, text}` blocks).
//   - output: an `AIMessage`-like object that LangGraph's `add_messages`
//     reducer and LangChain chains can consume (`content`, `_getType()`,
//     `response_metadata`). We additionally surface the full `routerTrace` so
//     callers keep the router's explainability inside a LangChain pipeline.
//
// The returned object also advertises `lc_namespace` / `_llmType` so it quacks
// like a LangChain Runnable when introspected.
// ---------------------------------------------------------------------------

/** A single LangChain/LangGraph message in any of the shapes we accept. */
export type LangChainMessageLike =
  | string
  | [string, string]
  | { role?: string; type?: string; content?: LangChainContent; _getType?: () => string }

/** LangChain message content: a plain string or an array of content blocks. */
export type LangChainContent = string | Array<{ type?: string; text?: string } | string>

/** Input accepted by the adapter's `invoke`: one message or a list of them. */
export type LangChainInput = LangChainMessageLike | LangChainMessageLike[]

/** Per-call options understood by the adapter. */
export type LangChainInvokeOptions = {
  /** Routing hints forwarded to `router.chat`. Merged over the model defaults. */
  route?: RouteRequest["route"]
  /** Tool definitions (OpenAI shape) forwarded to the router. */
  tools?: RouteRequest["tools"]
  /** Arbitrary metadata persisted on the trace. */
  metadata?: Record<string, unknown>
}

/** The `AIMessage`-like value returned by `invoke`. */
export type LangChainAIMessage = {
  role: "assistant"
  content: string
  /** LangChain message-type discriminator. */
  _getType: () => "ai"
  additional_kwargs: Record<string, unknown>
  /** Carries the router decision so explainability survives the LangChain hop. */
  response_metadata: { routerTrace: RouterTrace }
  /** Convenience top-level handle to the same trace. */
  routerTrace: RouterTrace
}

/** A LangChain-compatible chat model backed by the adaptive router. */
export type LangChainModel = {
  lc_namespace: string[]
  _llmType: () => string
  invoke(input: LangChainInput, options?: LangChainInvokeOptions): Promise<LangChainAIMessage>
  batch(inputs: LangChainInput[], options?: LangChainInvokeOptions): Promise<LangChainAIMessage[]>
}

/**
 * Wrap an {@link AdaptiveRouter} as a LangChain/LangGraph-compatible chat model.
 *
 * @example
 * ```ts
 * const model = createLangChainModel(router, { route: { quality: "high" } })
 * const ai = await model.invoke([
 *   ["system", "You are concise."],
 *   ["human", "Say hi."],
 * ])
 * console.log(ai.content, ai.routerTrace.chosenModel)
 * ```
 */
export function createLangChainModel(
  router: Pick<AdaptiveRouter, "chat">,
  defaults: LangChainInvokeOptions = {},
): LangChainModel {
  async function invoke(input: LangChainInput, options: LangChainInvokeOptions = {}): Promise<LangChainAIMessage> {
    const messages = normalizeLangChainMessages(input)
    const result = await router.chat({
      messages,
      tools: options.tools ?? defaults.tools,
      route: { ...defaults.route, ...options.route },
      metadata: { ...defaults.metadata, ...options.metadata },
    })
    return toLangChainAIMessage(result.response.content ?? "", result.routerTrace)
  }

  async function batch(inputs: LangChainInput[], options: LangChainInvokeOptions = {}): Promise<LangChainAIMessage[]> {
    return Promise.all(inputs.map((input) => invoke(input, options)))
  }

  return {
    lc_namespace: ["adaptive_router", "chat_models"],
    _llmType: () => "adaptive-router",
    invoke,
    batch,
  }
}

/**
 * Normalize any accepted LangChain input into the router's `ChatMessage[]`.
 * Exported so callers (and tests) can reuse the exact mapping the adapter uses.
 */
export function normalizeLangChainMessages(input: LangChainInput): ChatMessage[] {
  const list = Array.isArray(input) && !isTuple(input) ? input : [input as LangChainMessageLike]
  return list.map(normalizeLangChainMessage)
}

function normalizeLangChainMessage(message: LangChainMessageLike): ChatMessage {
  if (typeof message === "string") {
    return { role: "user", content: message }
  }

  if (isTuple(message)) {
    return { role: mapRole(message[0]), content: extractContent(message[1]) }
  }

  // Object form: a LangChain BaseMessage (`_getType()`), or an OpenAI-style
  // `{ role, content }`, or a `{ type, content }` object.
  const rawRole = typeof message._getType === "function" ? message._getType() : message.role ?? message.type
  return { role: mapRole(rawRole), content: extractContent(message.content) }
}

/** A `[role, content]` tuple as used by LangChain's `ChatPromptTemplate`. */
function isTuple(value: unknown): value is [string, string] {
  return Array.isArray(value) && value.length === 2 && typeof value[0] === "string" && typeof value[1] === "string"
}

/**
 * Map LangChain/OpenAI role labels onto the router's `ChatMessage` roles.
 * Unknown roles default to "user" so an unexpected label never drops content.
 */
function mapRole(role: string | undefined): ChatMessage["role"] {
  switch (role) {
    case "system":
      return "system"
    case "ai":
    case "assistant":
    case "model":
      return "assistant"
    case "tool":
    case "function":
      return "tool"
    case "human":
    case "user":
    default:
      return "user"
  }
}

/**
 * Flatten LangChain message content into a plain string. Content may be a
 * string or an array of content blocks (`{ type: "text", text }` or strings);
 * non-text blocks are ignored for MVP parity with the other adapters.
 */
function extractContent(content: LangChainContent | undefined): string {
  if (content === undefined || content === null) return ""
  if (typeof content === "string") return content
  return content
    .map((block) => (typeof block === "string" ? block : block.text ?? ""))
    .join("")
}

function toLangChainAIMessage(content: string, routerTrace: RouterTrace): LangChainAIMessage {
  return {
    role: "assistant",
    content,
    _getType: () => "ai",
    additional_kwargs: {},
    response_metadata: { routerTrace },
    routerTrace,
  }
}

// ---------------------------------------------------------------------------
// Vercel AI SDK adapter
//
// Design: the same dependency-free *structural* bridge as the LangChain adapter.
// We do NOT import the `ai` package — pinning a peer dependency on a fast-moving
// SDK is exactly the coupling this router exists to avoid. Instead we implement
// the `LanguageModelV1` contract the Vercel AI SDK calls into:
//   - `specificationVersion: "v1"`, `provider`, `modelId`, `defaultObjectGenerationMode`
//   - `doGenerate(options)` -> `{ text, finishReason, usage, rawCall, rawResponse,
//     providerMetadata }`. The SDK's `generateText()` awaits exactly this shape.
//   - `doStream(options)` returns a single-chunk ReadableStream so `streamText()`
//     resolves; true token streaming is a post-MVP follow-up (the router itself
//     disables fallbacks under `stream`, so a one-shot text-delta + finish is
//     the honest MVP behavior).
//
// Vercel's prompt is a `LanguageModelV1Prompt`: an array of messages whose
// `content` is either a string (system) or an array of typed parts
// (`{ type: "text", text }`, plus tool-call/-result parts we flatten for MVP
// parity with the other adapters). We map that onto the router's ChatMessage[]
// and surface the full routerTrace through `providerMetadata.adaptiveRouter`
// and `rawResponse`, so explainability survives the Vercel hop.
// ---------------------------------------------------------------------------

/** A Vercel AI SDK content part (the subset we read). */
export type VercelContentPart =
  | { type: "text"; text: string }
  | { type: "tool-call"; toolName?: string; args?: unknown }
  | { type: "tool-result"; result?: unknown }
  | { type: string; [key: string]: unknown }

/** A single message in a Vercel `LanguageModelV1Prompt`. */
export type VercelPromptMessage = {
  role: "system" | "user" | "assistant" | "tool"
  content: string | VercelContentPart[]
}

/** Options the Vercel AI SDK passes into `doGenerate` / `doStream`. */
export type VercelCallOptions = {
  prompt: VercelPromptMessage[]
  mode?: { type?: string; tools?: RouteRequest["tools"] }
  /** Routing hints forwarded to `router.chat`. Merged over the model defaults. */
  providerMetadata?: { adaptiveRouter?: { route?: RouteRequest["route"]; metadata?: Record<string, unknown> } }
}

/** The result `doGenerate` resolves with — the shape `generateText()` expects. */
export type VercelGenerateResult = {
  text: string
  finishReason: "stop" | "error"
  usage: { promptTokens: number; completionTokens: number }
  rawCall: { rawPrompt: unknown; rawSettings: Record<string, unknown> }
  rawResponse: { routerTrace: RouterTrace }
  providerMetadata: { adaptiveRouter: { routerTrace: RouterTrace } }
}

/** A Vercel AI SDK `LanguageModelV1`-compatible model backed by the router. */
export type VercelLanguageModel = {
  specificationVersion: "v1"
  provider: string
  modelId: string
  defaultObjectGenerationMode: undefined
  doGenerate(options: VercelCallOptions): Promise<VercelGenerateResult>
  doStream(options: VercelCallOptions): Promise<{
    stream: ReadableStream<unknown>
    rawCall: { rawPrompt: unknown; rawSettings: Record<string, unknown> }
  }>
}

/** Defaults applied to every call made through a {@link VercelLanguageModel}. */
export type VercelModelOptions = {
  route?: RouteRequest["route"]
  metadata?: Record<string, unknown>
}

/**
 * Wrap an {@link AdaptiveRouter} as a Vercel AI SDK `LanguageModelV1`.
 *
 * @example
 * ```ts
 * import { generateText } from "ai"
 * const model = createVercelModel(router, { route: { quality: "high" } })
 * const { text, providerMetadata } = await generateText({
 *   model,
 *   prompt: "Say hi.",
 * })
 * console.log(text, providerMetadata.adaptiveRouter.routerTrace.chosenModel)
 * ```
 */
export function createVercelModel(
  router: Pick<AdaptiveRouter, "chat">,
  defaults: VercelModelOptions = {},
): VercelLanguageModel {
  async function run(options: VercelCallOptions): Promise<{ content: string; routerTrace: RouterTrace }> {
    const messages = normalizeVercelPrompt(options.prompt)
    const callMeta = options.providerMetadata?.adaptiveRouter
    const result = await router.chat({
      messages,
      tools: options.mode?.tools,
      route: { ...defaults.route, ...callMeta?.route },
      metadata: { ...defaults.metadata, ...callMeta?.metadata },
    })
    return { content: result.response.content ?? "", routerTrace: result.routerTrace }
  }

  const rawCall = { rawPrompt: null, rawSettings: {} as Record<string, unknown> }

  return {
    specificationVersion: "v1",
    provider: "adaptive-router",
    modelId: "adaptive-router",
    defaultObjectGenerationMode: undefined,
    async doGenerate(options: VercelCallOptions): Promise<VercelGenerateResult> {
      const { content, routerTrace } = await run(options)
      const failed = routerTrace.status === "failed"
      return {
        text: content,
        finishReason: failed ? "error" : "stop",
        usage: {
          promptTokens: routerTrace.usage?.inputTokens ?? 0,
          completionTokens: routerTrace.usage?.outputTokens ?? 0,
        },
        rawCall,
        rawResponse: { routerTrace },
        providerMetadata: { adaptiveRouter: { routerTrace } },
      }
    },
    async doStream(options: VercelCallOptions) {
      const { content, routerTrace } = await run(options)
      // MVP streaming: emit the resolved text as a single delta, then a finish
      // event carrying usage + the trace. The router disables fallbacks under
      // stream mode, so a one-shot emission is the honest behavior here.
      const stream = new ReadableStream({
        start(controller) {
          if (content) controller.enqueue({ type: "text-delta", textDelta: content })
          controller.enqueue({
            type: "finish",
            finishReason: routerTrace.status === "failed" ? "error" : "stop",
            usage: {
              promptTokens: routerTrace.usage?.inputTokens ?? 0,
              completionTokens: routerTrace.usage?.outputTokens ?? 0,
            },
            providerMetadata: { adaptiveRouter: { routerTrace } },
          })
          controller.close()
        },
      })
      return { stream, rawCall }
    },
  }
}

/**
 * Normalize a Vercel `LanguageModelV1Prompt` into the router's `ChatMessage[]`.
 * Exported so callers (and tests) can reuse the exact mapping the adapter uses.
 */
export function normalizeVercelPrompt(prompt: VercelPromptMessage[]): ChatMessage[] {
  return prompt.map((message) => ({
    role: mapRole(message.role),
    content: extractVercelContent(message.content),
  }))
}

/**
 * Flatten Vercel content into a plain string. `content` is a string (system
 * messages) or an array of parts; we keep `text` parts and stringify tool-call
 * args / tool-result payloads so nothing silently vanishes in MVP.
 */
function extractVercelContent(content: string | VercelContentPart[]): string {
  if (typeof content === "string") return content
  return content
    .map((part) => {
      if (part.type === "text") return typeof part.text === "string" ? part.text : ""
      if (part.type === "tool-call") return stringifyPart((part as { args?: unknown }).args)
      if (part.type === "tool-result") return stringifyPart((part as { result?: unknown }).result)
      return ""
    })
    .join("")
}

function stringifyPart(value: unknown): string {
  if (value === undefined || value === null) return ""
  return typeof value === "string" ? value : JSON.stringify(value)
}
