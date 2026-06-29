import test from "node:test"
import assert from "node:assert/strict"
import { createQwenProvider } from "../dist/index.js"

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
