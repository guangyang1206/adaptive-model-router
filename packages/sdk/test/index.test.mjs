import test from "node:test"
import assert from "node:assert/strict"
import { createRouter, createStaticProvider } from "../dist/index.js"

const cheapModel = {
  id: "local/cheap",
  provider: "local",
  model: "cheap",
  type: "self-hosted",
  kind: "self-hosted",
  capabilities: ["reasoning", "streaming"],
  tier: "balanced",
  contextWindow: 8192,
  enabled: true,
  latencyClass: "low",
  cost: { inputPer1M: 0, outputPer1M: 0, estimated: true },
  health: { status: "ok", successRate: 0.95 },
}

const strongModel = {
  id: "cloud/strong",
  provider: "cloud",
  model: "strong",
  type: "commercial",
  kind: "native",
  capabilities: ["reasoning", "tool-calling", "streaming"],
  tier: "high",
  contextWindow: 128000,
  enabled: true,
  latencyClass: "medium",
  cost: { inputPer1M: 3, outputPer1M: 15, estimated: true },
  health: { status: "ok", successRate: 0.99 },
}

test("evaluate filters models by required capabilities", async () => {
  const router = createRouter({
    providers: [createStaticProvider("local", [cheapModel]), createStaticProvider("cloud", [strongModel])],
  })

  const result = await router.evaluate({
    messages: [{ role: "user", content: "Use a tool." }],
    tools: [{}],
    route: { quality: "balanced" },
  })

  const skipped = result.candidates.find((candidate) => candidate.modelId === "local/cheap")
  assert.equal(skipped?.skipped, true)
  assert.match(skipped?.skippedReason ?? "", /tool-calling/)
})

test("chat falls back to the next candidate after retryable failure", async () => {
  const router = createRouter({
    providers: [
      createStaticProvider("local", [{ ...cheapModel, health: { status: "ok", successRate: 1 } }], { failTimes: 1, errorCode: "AR_PROVIDER_TIMEOUT" }),
      createStaticProvider("cloud", [strongModel]),
    ],
    policy: { maxFallbacks: 1 },
  })

  const result = await router.chat({
    messages: [{ role: "user", content: "Plan a robust implementation." }],
    route: { task: "plan", quality: "balanced", explain: true },
  })

  assert.equal(result.routerTrace.status, "fallback_success")
  assert.equal(result.routerTrace.attempts.length, 2)
  assert.equal(result.routerTrace.attempts[0]?.status, "failed")
  assert.equal(result.routerTrace.attempts[1]?.status, "success")
})

test("router records traces in memory store", async () => {
  const router = createRouter({ providers: [createStaticProvider("local", [cheapModel])] })

  await router.chat({
    messages: [{ role: "user", content: "Summarize this." }],
    route: { task: "summarize" },
  })

  const traces = await router.traces()
  assert.equal(traces.length, 1)
  assert.equal(traces[0]?.status, "success")
})

test("dashboard() returns an honest non-started handle", async () => {
  const router = createRouter({ providers: [createStaticProvider("local", [cheapModel])] })

  const handle = await router.dashboard({ port: 4321 })
  assert.equal(handle.url, "http://localhost:4321")
  assert.equal(handle.started, false)
  assert.match(handle.hint, /createDashboard/)
})

test("usage estimate scales with total message content length", async () => {
  const router = createRouter({ providers: [createStaticProvider("local", [cheapModel])] })

  const short = await router.chat({ messages: [{ role: "user", content: "hi" }] })
  const long = await router.chat({
    messages: [{ role: "user", content: "x".repeat(4000) }],
  })

  const shortInput = short.routerTrace.usage?.inputTokens ?? 0
  const longInput = long.routerTrace.usage?.inputTokens ?? 0
  assert.ok(longInput > shortInput * 10, `expected long input (${longInput}) to dwarf short input (${shortInput})`)
})

test("evaluate collects ALL skip reasons, not just the first", async () => {
  // A model that is both disabled AND missing the required tool-calling capability.
  const disabledNoTools = { ...cheapModel, id: "local/disabled", enabled: false, capabilities: ["reasoning"] }
  const router = createRouter({
    providers: [createStaticProvider("local", [disabledNoTools]), createStaticProvider("cloud", [strongModel])],
  })

  const result = await router.evaluate({
    messages: [{ role: "user", content: "Use a tool." }],
    tools: [{}],
    route: { quality: "balanced" },
  })

  const candidate = result.candidates.find((entry) => entry.modelId === "local/disabled")
  assert.equal(candidate?.skipped, true)
  // Backward-compatible single reason still points at the highest-priority one.
  assert.equal(candidate?.skippedReason, "model disabled")
  // Full list now surfaces both reasons for explainability.
  assert.ok(Array.isArray(candidate?.skippedReasons))
  assert.ok(candidate?.skippedReasons?.includes("model disabled"))
  assert.ok(candidate?.skippedReasons?.some((reason) => /tool-calling/.test(reason)))
  assert.equal(candidate?.skippedReasons?.length, 2)
})

test("stream mode records a trace note that fallback was disabled", async () => {
  const router = createRouter({
    providers: [createStaticProvider("local", [cheapModel]), createStaticProvider("cloud", [strongModel])],
    policy: { maxFallbacks: 3 },
  })

  const result = await router.chat({
    messages: [{ role: "user", content: "Stream this." }],
    stream: true,
  })

  assert.ok(result.routerTrace.notes?.includes("fallback disabled: stream mode"))
})

test("non-stream mode leaves trace notes unset", async () => {
  const router = createRouter({
    providers: [createStaticProvider("local", [cheapModel])],
    policy: { maxFallbacks: 3 },
  })

  const result = await router.chat({ messages: [{ role: "user", content: "No stream." }] })
  assert.equal(result.routerTrace.notes, undefined)
})
