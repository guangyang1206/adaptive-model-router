# @adaptive-router/sdk

Zero-dependency adaptive model router for agent apps. Picks the right model per
request, falls back when a provider fails, and records why each decision was made.

```bash
pnpm add @adaptive-router/sdk
```

Node.js 20+. No runtime dependencies — the package ships only compiled output and
declares `"dependencies": {}`.

## Why

Agent apps rarely need one model. Cheap requests shouldn't burn a frontier model,
and a frontier request shouldn't silently land on a weak one. Hard-coding a model
per call site means every cost or availability change is a code change.

This SDK makes that a routing decision: score the candidates against the task,
pick the best one, fall back on failure, and write down what happened.

## 30-second demo (no API key needed)

`router.evaluate()` makes a routing decision without calling any provider — the
fastest way to see the scoring in action.

```ts
import { createRouter, createStaticProvider } from "@adaptive-router/sdk"

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

const router = createRouter({
  providers: [createStaticProvider("demo", models)],
  models,
})

const decision = await router.evaluate({
  messages: [{ role: "user", content: "Plan a task." }],
  route: { task: "plan" },
})

console.log(decision.candidates.length, "candidates ranked")
console.log(decision.candidates[0].modelId, "scored", decision.candidates[0].score)
console.log(decision.reason)
```

Output:

```text
1 candidates ranked
local/demo scored 98
Capability hard filter, then quality tier, health/success signal, latency, and cost within acceptable tier.
```

Each candidate carries `modelId`, `provider`, `score`, `reasons[]`, and — when it
was ruled out — `skipped` plus `skippedReasons[]`. For the model above,
`reasons` is `["tier=balanced", "provider=demo", "quality-threshold=balanced",
"health=ok", "type=self-hosted"]`. Nothing is a black box.

## Actually routing a request

```ts
const result = await router.chat({
  messages: [{ role: "user", content: "Summarize this changelog." }],
  route: { task: "summarize", tier: "cheap" },
})

console.log(result.response.content)
console.log(result.routerTrace.chosenModel, result.routerTrace.reason)
console.log(result.routerTrace.latencyMs, result.routerTrace.estimatedCostUsd)
```

`chat()` returns `{ response, routerTrace }`. The trace explains the choice:
`chosenModel`, all `candidates` with scores, per-attempt `attempts[]` (so a
fallback is visible), `latencyMs`, `usage`, `estimatedCostUsd`, and `notes[]`
recording any degradation.

## What you get

- **Quality-gated routing** across OpenAI, Anthropic, DeepSeek, Gemini, Qwen,
  Ollama, and self-hosted vLLM — plus `createStaticProvider` for tests
- **Fallback, retry, and timeout** with per-attempt tracing
- **Trace storage** via SQLite (`node:sqlite`) or JSONL, chosen at runtime
- **Semantic cache** with exact-match and vector reuse, tenant isolation, TTL,
  and negation guards
- **Eval harness** with golden datasets and baseline regression gating
- **Framework adapters** for LangChain / LangGraph and the Vercel AI SDK
- **Optional ingest reporter** (`createIngestReporter`) to forward traces to a
  self-hosted control plane

## Two invariants worth knowing

**Zero runtime dependencies.** Optional peers (localONNX embeddings,
`node:sqlite`) load through a dynamic-import shim, so a bundler can never pull
them in and installing the SDK never drags native packages along.

**Honest degradation.** When an optional backend is missing, the SDK downgrades
and writes an explanatory note into the trace — it does not throw, and it does
not silently pretend. If there is no trustworthy embedding backend, the semantic
cache falls back to exact match and says so.

## Documentation

- [Quickstart](https://github.com/guangyang1206/adaptive-model-router/blob/main/docs/en/quickstart.md)
  · [中文快速开始](https://github.com/guangyang1206/adaptive-model-router/blob/main/docs/zh/quickstart.md)
- [API Reference](https://github.com/guangyang1206/adaptive-model-router/blob/main/docs/en/api-reference.md)
  · [中文 API 参考](https://github.com/guangyang1206/adaptive-model-router/blob/main/docs/zh/api-reference.md)
- [Architecture](https://github.com/guangyang1206/adaptive-model-router/blob/main/docs/en/architecture.md)
- [Repository](https://github.com/guangyang1206/adaptive-model-router)

## Related packages

| Package | What it does |
| --- | --- |
| `@adaptive-router/cli` | `init` / `doctor` / `inspect` / `export` / `eval` |
| `@adaptive-router/dashboard` | Local read-only dashboard for traces and evals |
| `@adaptive-router/control-plane` | Self-hosted multi-tenant team control plane |

## License

Apache-2.0. See [LICENSE](./LICENSE).
