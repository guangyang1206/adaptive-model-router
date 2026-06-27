# Adaptive Model Router

> An adaptive model router for agent apps — automatically balancing quality, stability, latency, and token cost.

Adaptive Model Router is an SDK-first open-source developer tool for Agent applications. It embeds model routing into your agent runtime, chooses a model based on task context and capability constraints, records fallback attempts, and explains each routing decision in a local dashboard.

## Why this exists

Agent apps often need different models for different steps: planning, tool calling, coding, extraction, summarization, and final answers. Hard-coding one model is either expensive or unreliable. Existing gateways are useful, but they often sit outside the agent loop and cannot easily see agent step metadata.

This project focuses on an embeddable routing layer:

```text
Install SDK -> Initialize Router -> Send Agent Request -> Route by Quality/Stability -> Inspect Decision in Dashboard
```

## MVP-0 scope

The first milestone is intentionally small:

- TypeScript SDK-first, not proxy-first
- Quality-gated routing based on capability, tier, health, and success signals
- Fallback / retry / timeout for non-streaming requests
- No mid-stream fallback after streaming has started
- Local read-only dashboard with two pages:
  - Requests / Routing Decisions
  - Models
- SQLite storage with JSONL fallback
- First provider set: OpenAI, Anthropic, DeepSeek, Ollama
- English-first bilingual docs: README, Quickstart, API Reference

## Non-goals for MVP-0

- No hosted SaaS dashboard
- No RBAC, multi-tenant orgs, audit logs, or billing
- No model marketplace
- No real-time judgment of answer quality
- No learning router or eval-driven routing yet
- No full provider coverage
- No local proxy in MVP-0

## Package plan

```text
@adaptive-router/sdk        Runtime SDK, policy, providers, storage, telemetry
@adaptive-router/dashboard  Local read-only dashboard
@adaptive-router/cli        Optional developer helper commands
```

## Example API

```ts
import {
  createAnthropicProvider,
  createDeepSeekProvider,
  createOllamaProvider,
  createOpenAIProvider,
  createRouter,
} from '@adaptive-router/sdk'

const router = createRouter({
  providers: [
    createOpenAIProvider({ apiKey: process.env.OPENAI_API_KEY }),
    createAnthropicProvider({ apiKey: process.env.ANTHROPIC_API_KEY }),
    createDeepSeekProvider({ apiKey: process.env.DEEPSEEK_API_KEY }),
    createOllamaProvider({ baseURL: process.env.OLLAMA_BASE_URL }),
  ],
  policy: {
    defaultQuality: 'balanced',
    stability: 'high',
    costMode: 'optimize-within-quality-threshold',
  },
})

const result = await router.chat({
  messages: [{ role: 'user', content: 'Plan the next coding task.' }],
  route: {
    task: 'plan',
    quality: 'high',
    stability: 'high',
    latencyMs: 8000,
    maxCostUsd: 0.05,
    explain: true,
  },
})

console.log(result.routerTrace)
```

## Documentation

- [English Quickstart](docs/en/quickstart.md)
- [中文快速开始](docs/zh/quickstart.md)
- [English API Reference](docs/en/api-reference.md)
- [中文 API 参考](docs/zh/api-reference.md)
- [Roadmap](ROADMAP.md)

## Status

This repository is being initialized from the MVP specification. The current code is a scaffold for the first open-source milestone.

## License

Apache-2.0

---

## 中文简介

Adaptive Model Router 是一个面向 Agent 应用的 SDK-first 开源开发者工具。它嵌入 Agent runtime 内部，根据任务上下文、模型能力、质量档位、稳定性、延迟和成本进行可解释路由，并通过本地 Dashboard 展示每次请求为什么选择某个模型。

MVP-0 聚焦 TypeScript SDK、质量门控路由、fallback/retry/timeout、本地只读 Dashboard、SQLite/JSONL 记录，以及 OpenAI、Anthropic、DeepSeek、Ollama 四个首批 provider。项目文档采用英文优先、中英双语策略。
