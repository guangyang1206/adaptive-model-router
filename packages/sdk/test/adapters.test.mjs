import test from "node:test"
import assert from "node:assert/strict"
import {
  createRouter,
  createStaticProvider,
  createLangChainModel,
  normalizeLangChainMessages,
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
