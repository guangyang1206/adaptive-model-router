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
