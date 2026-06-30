import test from "node:test"
import assert from "node:assert/strict"
import { createQwenProvider, createGeminiProvider, createAnthropicProvider, createVLLMProvider } from "../dist/index.js"

test("qwen provider exposes OpenAI-compatible default models", async () => {
  const provider = createQwenProvider({ apiKey: "test-key" })
  assert.equal(provider.id, "qwen")
  assert.equal(provider.kind, "openai-compatible")

  const models = await provider.listModels()
  const ids = models.map((model) => model.id)
  assert.ok(ids.includes("qwen/qwen-plus"))
  assert.ok(ids.includes("qwen/qwen-max"))
  assert.ok(models.every((model) => model.provider === "qwen"))
  assert.ok(models.every((model) => model.type === "open-source"))
})

test("qwen provider posts to the DashScope compatible-mode endpoint and parses usage", async () => {
  const calls = []
  const mockFetch = async (url, init) => {
    calls.push({ url: String(url), init })
    return new Response(
      JSON.stringify({
        id: "chatcmpl-qwen-1",
        choices: [{ message: { role: "assistant", content: "你好" } }],
        usage: { prompt_tokens: 10, completion_tokens: 5 },
      }),
      { status: 200, headers: { "content-type": "application/json" } },
    )
  }

  const provider = createQwenProvider({ apiKey: "secret-token", fetch: mockFetch })
  const [model] = await provider.listModels()

  const response = await provider.chat(
    { messages: [{ role: "user", content: "hi" }] },
    model,
  )

  assert.equal(calls.length, 1)
  assert.equal(
    calls[0].url,
    "https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions",
  )
  assert.equal(calls[0].init.headers.authorization, "Bearer secret-token")
  assert.equal(response.content, "你好")
  assert.equal(response.usage?.inputTokens, 10)
  assert.equal(response.usage?.outputTokens, 5)
  assert.equal(response.usage?.totalTokens, 15)
  assert.equal(response.usage?.estimated, false)
})

test("qwen provider honors a custom baseURL override", async () => {
  const calls = []
  const mockFetch = async (url) => {
    calls.push(String(url))
    return new Response(
      JSON.stringify({ id: "x", choices: [{ message: { content: "ok" } }] }),
      { status: 200, headers: { "content-type": "application/json" } },
    )
  }

  const provider = createQwenProvider({
    apiKey: "k",
    baseURL: "http://localhost:8000/v1",
    fetch: mockFetch,
  })
  const [model] = await provider.listModels()
  await provider.chat({ messages: [{ role: "user", content: "hi" }] }, model)

  assert.equal(calls[0], "http://localhost:8000/v1/chat/completions")
})

test("qwen provider surfaces an auth error when apiKey is missing", async () => {
  const provider = createQwenProvider({})
  const [model] = await provider.listModels()

  await assert.rejects(
    () => provider.chat({ messages: [{ role: "user", content: "hi" }] }, model),
    (error) => {
      const normalized = provider.normalizeError(error)
      assert.equal(normalized.code, "AR_PROVIDER_AUTH_FAILED")
      assert.equal(normalized.retryable, false)
      return true
    },
  )
})

test("gemini provider exposes native default models", async () => {
  const provider = createGeminiProvider({ apiKey: "test-key" })
  assert.equal(provider.id, "gemini")
  assert.equal(provider.kind, "native")

  const models = await provider.listModels()
  const ids = models.map((model) => model.id)
  assert.ok(ids.includes("gemini/gemini-2.5-flash"))
  assert.ok(ids.includes("gemini/gemini-2.5-pro"))
  assert.ok(models.every((model) => model.provider === "gemini"))
  assert.ok(models.every((model) => model.type === "commercial"))
})

test("gemini provider posts generateContent, maps roles, and parses usageMetadata", async () => {
  const calls = []
  const mockFetch = async (url, init) => {
    calls.push({ url: String(url), init })
    return new Response(
      JSON.stringify({
        responseId: "resp-gemini-1",
        candidates: [{ content: { parts: [{ text: "Hello" }, { text: " world" }] } }],
        usageMetadata: { promptTokenCount: 12, candidatesTokenCount: 4, totalTokenCount: 16 },
      }),
      { status: 200, headers: { "content-type": "application/json" } },
    )
  }

  const provider = createGeminiProvider({ apiKey: "secret-token", fetch: mockFetch })
  const [model] = await provider.listModels()

  const response = await provider.chat(
    {
      messages: [
        { role: "system", content: "be terse" },
        { role: "user", content: "hi" },
        { role: "assistant", content: "earlier" },
      ],
    },
    model,
  )

  assert.equal(calls.length, 1)
  assert.equal(
    calls[0].url,
    "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent",
  )
  // Key travels in the header, never in the URL.
  assert.equal(calls[0].init.headers["x-goog-api-key"], "secret-token")
  assert.ok(!calls[0].url.includes("secret-token"))

  const body = JSON.parse(calls[0].init.body)
  assert.equal(body.systemInstruction.parts[0].text, "be terse")
  assert.equal(body.contents.length, 2)
  assert.equal(body.contents[0].role, "user")
  assert.equal(body.contents[1].role, "model")

  assert.equal(response.content, "Hello world")
  assert.equal(response.usage?.inputTokens, 12)
  assert.equal(response.usage?.outputTokens, 4)
  assert.equal(response.usage?.totalTokens, 16)
  assert.equal(response.usage?.estimated, false)
})

test("anthropic provider does not advertise tool-calling until the schema is mapped", async () => {
  // Guard against silently re-adding tool-calling: the adapter still sends
  // OpenAI-shaped tools, which Anthropic rejects. Advertising the capability
  // would make the router pick Anthropic for tool requests and drop the tools.
  const provider = createAnthropicProvider({ apiKey: "test-key" })
  const models = await provider.listModels()
  assert.ok(models.length > 0)
  for (const model of models) {
    assert.ok(
      !model.capabilities.includes("tool-calling"),
      `${model.id} must not advertise tool-calling yet`,
    )
  }
})

test("anthropic provider omits tools from the request body", async () => {
  const calls = []
  const mockFetch = async (url, init) => {
    calls.push({ url: String(url), init })
    return new Response(
      JSON.stringify({ id: "msg-1", content: [{ type: "text", text: "ok" }] }),
      { status: 200, headers: { "content-type": "application/json" } },
    )
  }

  const provider = createAnthropicProvider({ apiKey: "k", fetch: mockFetch })
  const [model] = await provider.listModels()
  await provider.chat(
    {
      messages: [{ role: "user", content: "hi" }],
      tools: [{ type: "function", function: { name: "noop" } }],
    },
    model,
  )

  const body = JSON.parse(calls[0].init.body)
  assert.equal(body.tools, undefined)
})

test("gemini provider maps OpenAI-style tools to functionDeclarations", async () => {
  const calls = []
  const mockFetch = async (url, init) => {
    calls.push({ url: String(url), init })
    return new Response(
      JSON.stringify({ candidates: [{ content: { parts: [{ text: "ok" }] } }] }),
      { status: 200, headers: { "content-type": "application/json" } },
    )
  }

  const provider = createGeminiProvider({ apiKey: "k", fetch: mockFetch })
  const [model] = await provider.listModels()

  await provider.chat(
    {
      messages: [{ role: "user", content: "what's the weather?" }],
      tools: [
        {
          type: "function",
          function: {
            name: "get_weather",
            description: "Get weather for a city",
            parameters: { type: "object", properties: { city: { type: "string" } } },
          },
        },
      ],
    },
    model,
  )

  const body = JSON.parse(calls[0].init.body)
  // Tools must arrive wrapped as Gemini functionDeclarations, NOT the flat OpenAI shape.
  assert.ok(Array.isArray(body.tools))
  assert.equal(body.tools.length, 1)
  const decls = body.tools[0].functionDeclarations
  assert.equal(decls.length, 1)
  assert.equal(decls[0].name, "get_weather")
  assert.equal(decls[0].description, "Get weather for a city")
  assert.deepEqual(decls[0].parameters, {
    type: "object",
    properties: { city: { type: "string" } },
  })
})

test("gemini provider omits the tools field when no tools are given", async () => {
  const calls = []
  const mockFetch = async (url, init) => {
    calls.push({ url: String(url), init })
    return new Response(
      JSON.stringify({ candidates: [{ content: { parts: [{ text: "ok" }] } }] }),
      { status: 200, headers: { "content-type": "application/json" } },
    )
  }

  const provider = createGeminiProvider({ apiKey: "k", fetch: mockFetch })
  const [model] = await provider.listModels()
  await provider.chat({ messages: [{ role: "user", content: "hi" }] }, model)

  const body = JSON.parse(calls[0].init.body)
  assert.equal(body.tools, undefined)
})

test("gemini provider honors a custom baseURL override", async () => {
  const calls = []
  const mockFetch = async (url) => {
    calls.push(String(url))
    return new Response(
      JSON.stringify({ candidates: [{ content: { parts: [{ text: "ok" }] } }] }),
      { status: 200, headers: { "content-type": "application/json" } },
    )
  }

  const provider = createGeminiProvider({
    apiKey: "k",
    baseURL: "http://localhost:9000/v1beta",
    fetch: mockFetch,
  })
  const [model] = await provider.listModels()
  await provider.chat({ messages: [{ role: "user", content: "hi" }] }, model)

  assert.equal(calls[0], "http://localhost:9000/v1beta/models/gemini-2.5-flash:generateContent")
})

test("gemini provider surfaces an auth error when apiKey is missing", async () => {
  const provider = createGeminiProvider({})
  const [model] = await provider.listModels()

  await assert.rejects(
    () => provider.chat({ messages: [{ role: "user", content: "hi" }] }, model),
    (error) => {
      const normalized = provider.normalizeError(error)
      assert.equal(normalized.code, "AR_PROVIDER_AUTH_FAILED")
      assert.equal(normalized.retryable, false)
      return true
    },
  )
})

test("vllm provider exposes a self-hosted, zero-cost model profile", async () => {
  const provider = createVLLMProvider({
    baseURL: "http://localhost:8000/v1",
    model: "meta-llama/Llama-3.1-8B-Instruct",
  })
  assert.equal(provider.id, "vllm")
  assert.equal(provider.kind, "self-hosted")

  const models = await provider.listModels()
  assert.equal(models.length, 1)
  const [model] = models
  assert.equal(model.id, "vllm/meta-llama/Llama-3.1-8B-Instruct")
  assert.equal(model.model, "meta-llama/Llama-3.1-8B-Instruct")
  assert.equal(model.type, "self-hosted")
  assert.equal(model.kind, "self-hosted")
  assert.equal(model.cost?.inputPer1M, 0)
  assert.equal(model.cost?.outputPer1M, 0)
  // tool-calling must not be advertised unless the caller opts in.
  assert.ok(!model.capabilities.includes("tool-calling"))
})

test("vllm provider calls a key-less server without an Authorization header", async () => {
  const calls = []
  const mockFetch = async (url, init) => {
    calls.push({ url: String(url), init })
    return new Response(
      JSON.stringify({ id: "cmpl-1", choices: [{ message: { content: "ok" } }] }),
      { status: 200, headers: { "content-type": "application/json" } },
    )
  }

  const provider = createVLLMProvider({
    baseURL: "http://localhost:8000/v1",
    model: "llama-3.1-8b",
    fetch: mockFetch,
  })
  const [model] = await provider.listModels()
  const response = await provider.chat({ messages: [{ role: "user", content: "hi" }] }, model)

  assert.equal(calls[0].url, "http://localhost:8000/v1/chat/completions")
  // No --api-key on the server => no Authorization header (avoids "Bearer undefined").
  assert.equal(calls[0].init.headers.authorization, undefined)
  assert.equal(response.content, "ok")
})

test("vllm provider attaches Authorization only when an apiKey is supplied", async () => {
  const calls = []
  const mockFetch = async (url, init) => {
    calls.push({ url: String(url), init })
    return new Response(
      JSON.stringify({ id: "cmpl-2", choices: [{ message: { content: "ok" } }] }),
      { status: 200, headers: { "content-type": "application/json" } },
    )
  }

  const provider = createVLLMProvider({
    baseURL: "http://gpu-box:8000/v1",
    model: "qwen2.5-7b",
    apiKey: "vllm-secret",
    fetch: mockFetch,
  })
  const [model] = await provider.listModels()
  await provider.chat({ messages: [{ role: "user", content: "hi" }] }, model)

  assert.equal(calls[0].init.headers.authorization, "Bearer vllm-secret")
})

test("vllm provider honors custom models and capabilities opt-in", async () => {
  const provider = createVLLMProvider({
    baseURL: "http://localhost:8000/v1",
    model: "tool-capable-model",
    capabilities: ["reasoning", "tool-calling", "streaming"],
    contextWindow: 32768,
    tier: "high",
  })
  const [model] = await provider.listModels()
  assert.ok(model.capabilities.includes("tool-calling"))
  assert.equal(model.contextWindow, 32768)
  assert.equal(model.tier, "high")
})

test("vllm provider throws an invalid-request error when baseURL is missing", () => {
  assert.throws(
    () => createVLLMProvider({ model: "llama-3.1-8b" }),
    (error) => {
      assert.equal(error.code, "AR_INVALID_REQUEST")
      assert.equal(error.retryable, false)
      return true
    },
  )
})

