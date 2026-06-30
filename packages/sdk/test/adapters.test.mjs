import test from "node:test"
import assert from "node:assert/strict"
import {
  createRouter,
  createStaticProvider,
  createLangChainModel,
  normalizeLangChainMessages,
  createVercelModel,
  normalizeVercelPrompt,
} from "../dist/index.js"

// A minimal model registry + static provider that always succeeds, so the
// adapter tests exercise the LangChain message mapping rather than provider IO.
function makeRouter() {
  const models = [
    {
      id: "local/demo",
      provider: "demo",
      model: "demo",
      type: "self-hosted",
      kind: "openai-compatible",
      tier: "balanced",
      contextWindow: 8192,
      capabilities: ["reasoning"],
      enabled: true,
      cost: { inputPer1M: 0, outputPer1M: 0, currency: "USD", estimated: true },
      health: { status: "ok", successRate: 1 },
    },
  ]
  return createRouter({ providers: [createStaticProvider("demo", models)], models })
}

test("createLangChainModel quacks like a LangChain chat model", () => {
  const model = createLangChainModel(makeRouter())
  assert.deepEqual(model.lc_namespace, ["adaptive_router", "chat_models"])
  assert.equal(model._llmType(), "adaptive-router")
  assert.equal(typeof model.invoke, "function")
  assert.equal(typeof model.batch, "function")
})

test("invoke returns an AIMessage-like value carrying the router trace", async () => {
  const model = createLangChainModel(makeRouter())
  const ai = await model.invoke([
    ["system", "Be concise."],
    ["human", "Say hi."],
  ])

  assert.equal(ai.role, "assistant")
  assert.equal(ai._getType(), "ai")
  assert.equal(typeof ai.content, "string")
  // Explainability survives the LangChain hop in both places.
  assert.equal(ai.routerTrace.chosenModel, "local/demo")
  assert.equal(ai.response_metadata.routerTrace.chosenModel, "local/demo")
  assert.equal(ai.routerTrace.status, "success")
})

test("normalizeLangChainMessages maps every accepted shape", () => {
  // Plain string -> a single user message.
  assert.deepEqual(normalizeLangChainMessages("hi"), [{ role: "user", content: "hi" }])

  // [role, content] tuples (ChatPromptTemplate style), with role aliasing.
  assert.deepEqual(
    normalizeLangChainMessages([
      ["system", "sys"],
      ["human", "hello"],
      ["ai", "earlier"],
    ]),
    [
      { role: "system", content: "sys" },
      { role: "user", content: "hello" },
      { role: "assistant", content: "earlier" },
    ],
  )

  // OpenAI-style objects and unknown roles fall back to "user".
  assert.deepEqual(
    normalizeLangChainMessages([
      { role: "user", content: "u" },
      { role: "weird", content: "w" },
    ]),
    [
      { role: "user", content: "u" },
      { role: "user", content: "w" },
    ],
  )
})

test("normalizeLangChainMessages reads BaseMessage._getType() and array content", () => {
  // A LangChain BaseMessage exposes _getType(); content may be an array of
  // content blocks ({ type, text }) which we flatten to a string.
  const baseMessage = {
    _getType: () => "ai",
    content: [
      { type: "text", text: "part-a" },
      { type: "text", text: "part-b" },
    ],
  }
  assert.deepEqual(normalizeLangChainMessages(baseMessage), [
    { role: "assistant", content: "part-apart-b" },
  ])
})

test("invoke forwards tools and merges route hints over defaults", async () => {
  const seen = []
  // Spy router: capture the RouteRequest the adapter builds.
  const spyRouter = {
    async chat(request) {
      seen.push(request)
      return {
        response: { content: "ok" },
        routerTrace: { traceId: "t", decisionId: "d", candidates: [], reason: "r", attempts: [], estimated: true, status: "success" },
      }
    },
  }

  const model = createLangChainModel(spyRouter, { route: { quality: "balanced", task: "plan" } })
  const tools = [{ type: "function", function: { name: "noop" } }]
  await model.invoke("hello", { route: { quality: "high" }, tools })

  assert.equal(seen.length, 1)
  // Per-call route hint overrides the default; default task is preserved.
  assert.equal(seen[0].route.quality, "high")
  assert.equal(seen[0].route.task, "plan")
  assert.deepEqual(seen[0].tools, tools)
  assert.deepEqual(seen[0].messages, [{ role: "user", content: "hello" }])
})

test("batch routes each input and preserves order", async () => {
  const model = createLangChainModel(makeRouter())
  const results = await model.batch(["one", "two", "three"])
  assert.equal(results.length, 3)
  for (const ai of results) {
    assert.equal(ai._getType(), "ai")
    assert.equal(ai.routerTrace.chosenModel, "local/demo")
  }
})

// ---------------------------------------------------------------------------
// Vercel AI SDK adapter
// ---------------------------------------------------------------------------

test("createVercelModel quacks like a LanguageModelV1", () => {
  const model = createVercelModel(makeRouter())
  assert.equal(model.specificationVersion, "v1")
  assert.equal(model.provider, "adaptive-router")
  assert.equal(model.modelId, "adaptive-router")
  assert.equal(typeof model.doGenerate, "function")
  assert.equal(typeof model.doStream, "function")
})

test("doGenerate returns text, usage, finishReason, and carries the trace", async () => {
  const model = createVercelModel(makeRouter())
  const result = await model.doGenerate({
    prompt: [
      { role: "system", content: "Be concise." },
      { role: "user", content: [{ type: "text", text: "Say hi." }] },
    ],
  })

  assert.equal(typeof result.text, "string")
  assert.equal(result.finishReason, "stop")
  assert.equal(typeof result.usage.promptTokens, "number")
  assert.equal(typeof result.usage.completionTokens, "number")
  // Explainability survives the Vercel hop in both surfaced places.
  assert.equal(result.providerMetadata.adaptiveRouter.routerTrace.chosenModel, "local/demo")
  assert.equal(result.rawResponse.routerTrace.chosenModel, "local/demo")
  assert.equal(result.rawResponse.routerTrace.status, "success")
})

test("doStream emits a text-delta then a finish event with the trace", async () => {
  const model = createVercelModel(makeRouter())
  const { stream } = await model.doStream({
    prompt: [{ role: "user", content: [{ type: "text", text: "stream please" }] }],
  })

  const events = []
  const reader = stream.getReader()
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    events.push(value)
  }

  const finish = events.find((event) => event.type === "finish")
  assert.ok(events.some((event) => event.type === "text-delta"))
  assert.ok(finish)
  assert.equal(finish.finishReason, "stop")
  assert.equal(finish.providerMetadata.adaptiveRouter.routerTrace.chosenModel, "local/demo")
})

test("normalizeVercelPrompt maps roles and flattens content parts", () => {
  // String content (system) is kept; part arrays are flattened; tool-call args
  // and tool-result payloads are stringified so nothing silently vanishes.
  assert.deepEqual(
    normalizeVercelPrompt([
      { role: "system", content: "sys" },
      { role: "user", content: [{ type: "text", text: "a" }, { type: "text", text: "b" }] },
      { role: "assistant", content: [{ type: "tool-call", toolName: "f", args: { x: 1 } }] },
      { role: "tool", content: [{ type: "tool-result", result: "done" }] },
    ]),
    [
      { role: "system", content: "sys" },
      { role: "user", content: "ab" },
      { role: "assistant", content: '{"x":1}' },
      { role: "tool", content: "done" },
    ],
  )
})

test("doGenerate forwards tools and merges route hints over defaults", async () => {
  const seen = []
  const spyRouter = {
    async chat(request) {
      seen.push(request)
      return {
        response: { content: "ok" },
        routerTrace: { traceId: "t", decisionId: "d", candidates: [], reason: "r", attempts: [], estimated: true, status: "success" },
      }
    },
  }

  const model = createVercelModel(spyRouter, { route: { quality: "balanced", task: "plan" } })
  const tools = [{ type: "function", function: { name: "noop" } }]
  await model.doGenerate({
    prompt: [{ role: "user", content: [{ type: "text", text: "hello" }] }],
    mode: { type: "regular", tools },
    providerMetadata: { adaptiveRouter: { route: { quality: "high" } } },
  })

  assert.equal(seen.length, 1)
  // Per-call route hint overrides the default; default task is preserved.
  assert.equal(seen[0].route.quality, "high")
  assert.equal(seen[0].route.task, "plan")
  assert.deepEqual(seen[0].tools, tools)
  assert.deepEqual(seen[0].messages, [{ role: "user", content: "hello" }])
})
