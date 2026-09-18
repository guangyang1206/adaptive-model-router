import { createRouter, createStaticProvider } from "@adaptive-router/sdk"

const models = [
  {
    id: "demo/small", provider: "demo", model: "small",
    type: "open-source", kind: "openai-compatible",
    tier: "standard", contextWindow: 32768, capabilities: ["reasoning"],
    latencyClass: "low", enabled: true, health: { status: "ok", successRate: 1 },
  },
  {
    id: "demo/large", provider: "demo", model: "large",
    type: "open-source", kind: "openai-compatible",
    tier: "high", contextWindow: 32768, capabilities: ["reasoning", "json-mode"],
    latencyClass: "medium", enabled: true, health: { status: "ok", successRate: 1 },
  },
]

const router = createRouter({ providers: [createStaticProvider("demo", models)] })

const { candidates } = await router.evaluate({
  messages: [{ role: "user", content: "Summarize this changelog." }],
  route: { task: "summarize", quality: "high" },
})

for (const candidate of candidates) {
  console.log(`${candidate.modelId} score=${candidate.score.toFixed(2)}`)
}
