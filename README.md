# Adaptive Model Router

[![CI](https://github.com/guangyang1206/adaptive-model-router/actions/workflows/ci.yml/badge.svg)](https://github.com/guangyang1206/adaptive-model-router/actions/workflows/ci.yml)
[![License: Apache-2.0](https://img.shields.io/badge/License-Apache--2.0-blue.svg)](LICENSE)
[![Node.js >=20](https://img.shields.io/badge/Node.js-%3E%3D20-339933.svg)](package.json)
[![Status: MVP-3](https://img.shields.io/badge/status-MVP--3%20shipped-16A34A.svg)](ROADMAP.md)

> An adaptive model router for agent apps — automatically balancing quality, stability, latency, and token cost.

Adaptive Model Router is an SDK-first open-source developer tool for Agent applications. It embeds model routing into your agent runtime, chooses a model based on task context and capability constraints, records fallback attempts, and explains each routing decision in a local dashboard.

```text
Install SDK -> Initialize Router -> Send Agent Request -> Route by Quality/Stability -> Inspect Decision in Dashboard
```

## Why this exists

Agent apps often need different models for different steps: planning, tool calling, coding, extraction, summarization, and final answers. Hard-coding one model is either expensive or unreliable. Existing gateways are useful, but they often sit outside the agent loop and cannot easily see agent step metadata.

Adaptive Model Router focuses on an embeddable routing layer that can see agent context and make explainable routing decisions.

## What it can do today

**Core routing (MVP-0/1)**

- Route agent requests through a TypeScript SDK
- Score candidates by capability, model tier, health/success signal, latency, and cost
- Fall back on retryable non-streaming failures
- Normalize OpenAI, Anthropic, Gemini, DeepSeek, Qwen, vLLM, and Ollama provider calls
- Store traces with SQLite or JSONL fallback
- Open a local read-only dashboard (Requests, Models — with filtering + model comparison)
- Inspect/export traces from a small CLI
- Drop into LangChain / LangGraph and the Vercel AI SDK with zero framework dependency

**Evaluation & optimization (MVP-2)**

- **Eval harness** — run golden datasets through the router, compute deterministic
  routing metrics, and gate against a saved baseline (regression = CI fail)
- **Semantic cache** — exact + embedding cosine reuse, per-tenant isolation, TTL,
  and a negative-word guard; degrades to exact-match honestly when no real
  embedding provider is available (never silent)
- **Route-outcome learning** — offline, human-in-the-loop weight proposer with
  per-dimension bounds, an eval-gate, and one-click rollback. Learned weights are
  **never auto-adopted**; a human calls `adoptWeights` explicitly
- **Zero-dependency embeddings** — OpenAI (fetch-only) → local transformers ONNX
  → deterministic hashing fallback, resolved lazily so routers that never touch
  the cache pay nothing

**Team control plane (MVP-3, optional + self-hosted)**

- **Shared multi-tenant dashboard** — the same Requests/Models views a solo dev
  runs locally, served to a whole team and scoped per project
- **Organizations → Projects** — two-level tenancy; each project owns its own
  routing traces and ingest tokens (one per customer, environment, or app)
- **Auth** — Better-Auth with email + password, optional GitHub OAuth, and
  closeable registration for private deployments
- **Structural project isolation** — the data source captures `projectId` at
  construction, so every query is forced through `WHERE project_id = $1`.
  Cross-project reads aren't blocked by a check; they're structurally impossible
- **Opt-in trace ingest** — `createIngestReporter({ url, token })` in the SDK
  ships traces to the control plane. Adds **no** dependency (built-in `fetch`),
  and is an honest no-op when unconfigured. The server derives `project_id` from
  the token, never from the request body
- **Postgres persistence** — `postgres.js`, no ORM, hand-written SQL migrations
  with a version table
- **One-command deploy** — docker-compose, Dockerfile, and a Render blueprint

## Dashboard demo

![Adaptive Model Router dashboard showing routing decisions and fallback trace data](docs/assets/dashboard-demo.png)

[Watch the short dashboard recording](docs/assets/dashboard-demo.webm)

The screenshot above is captured from the real local dashboard with seeded route traces. You can regenerate the demo locally after building the dashboard package:

```bash
node scripts/preview-dashboard-demo.mjs
```

## Quick demo

> **Not published to npm yet** (publish-ready at `0.1.0`). Clone and
> `pnpm install && pnpm -r build` first — see the
> [Quickstart](docs/en/quickstart.md#1-install) for the three ways to consume the
> built workspace, including a copy-pasteable one-liner that needs no API key.

```ts
import { createDashboard, createReadOnlyDataAccess } from '@adaptive-router/dashboard'
import {
  createAnthropicProvider,
  createDeepSeekProvider,
  createGeminiProvider,
  createOllamaProvider,
  createOpenAIProvider,
  createQwenProvider,
  createVLLMProvider,
  createRouter,
  createSQLiteTraceStore,
} from '@adaptive-router/sdk'

const store = await createSQLiteTraceStore({
  path: '.adaptive-router/router.db',
  fallbackPath: '.adaptive-router/router.jsonl',
})

const router = createRouter({
  providers: [
    createOpenAIProvider({ apiKey: process.env.OPENAI_API_KEY }),
    createAnthropicProvider({ apiKey: process.env.ANTHROPIC_API_KEY }),
    createGeminiProvider({ apiKey: process.env.GEMINI_API_KEY }),
    createDeepSeekProvider({ apiKey: process.env.DEEPSEEK_API_KEY }),
    createQwenProvider({ apiKey: process.env.DASHSCOPE_API_KEY }),
    createOllamaProvider({ baseURL: process.env.OLLAMA_BASE_URL }),
    // Self-hosted vLLM: point at your OpenAI-compatible server and name the
    // served model. No apiKey needed unless you started vLLM with --api-key.
    createVLLMProvider({
      baseURL: process.env.VLLM_BASE_URL ?? 'http://localhost:8000/v1',
      model: 'meta-llama/Llama-3.1-8B-Instruct',
    }),
  ],
  policy: {
    defaultQuality: 'balanced',
    stability: 'high',
    costMode: 'optimize-within-quality-threshold',
  },
  store,
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

const dashboard = await createDashboard({
  data: createReadOnlyDataAccess({
    listTraces: () => router.traces(),
    listModels: () => router.models(),
  }),
})

console.log(dashboard.url)
```

## Use it inside LangChain / LangGraph

`createLangChainModel(router)` wraps the router as a LangChain-compatible chat
model — no `@langchain/core` dependency required. It accepts the message shapes
LangChain and LangGraph already produce (plain strings, `[role, content]`
tuples, OpenAI-style objects, or `BaseMessage`s) and returns an `AIMessage`-like
value that also carries the full `routerTrace`, so the router's explainability
survives the framework hop.

```ts
import { createLangChainModel, createRouter } from '@adaptive-router/sdk'

const model = createLangChainModel(router, { route: { quality: 'high' } })

const ai = await model.invoke([
  ['system', 'You are concise.'],
  ['human', 'Plan the next coding task.'],
])

console.log(ai.content)            // assistant text
console.log(ai.routerTrace.chosenModel) // which model the router picked, and why
```

Drop the same `model` into a LangGraph node — its `invoke`/`batch` methods and
`AIMessage`-shaped output work with the `add_messages` reducer out of the box.

## Use it inside the Vercel AI SDK

`createVercelModel(router)` wraps the router as a Vercel AI SDK `LanguageModelV1`
— no `ai` package dependency required. Pass it straight to `generateText` /
`streamText`; the router's `routerTrace` comes back through `providerMetadata`,
so explainability survives this framework hop too.

```ts
import { generateText } from 'ai'
import { createVercelModel, createRouter } from '@adaptive-router/sdk'

const model = createVercelModel(router, { route: { quality: 'high' } })

const { text, providerMetadata } = await generateText({
  model,
  prompt: 'Plan the next coding task.',
})

console.log(text)                                          // assistant text
console.log(providerMetadata.adaptiveRouter.routerTrace.chosenModel) // and why
```

`streamText` works as well — the MVP adapter emits the routed response as a
single text delta plus a finish event carrying usage and the trace.

## Architecture

```mermaid
flowchart LR
  A[Agent App] --> B[Adaptive Router SDK]
  B --> C[Policy Engine]
  C --> D[Provider Adapters]
  D --> D1[OpenAI]
  D --> D2[Anthropic]
  D --> D3[DeepSeek]
  D --> D4[Ollama]
  D --> D5[Qwen]
  D --> D6[Gemini]
  D --> D7[vLLM self-hosted]
  B --> E[Trace Store]
  E --> E1[SQLite]
  E --> E2[JSONL fallback]
  E --> F[Read-only Dashboard]
  F --> F1[Requests / Routing Decisions]
  F --> F2[Models]
  F --> F3[Evals / Baselines]
  F --> F4[Semantic Cache]
  F --> F5[Route Learning]
  B --> G[CLI]
  G --> G1[init]
  G --> G2[doctor]
  G --> G3[inspect]
  G --> G4[export]
  G --> G5[eval / eval:baseline]

  B -. "opt-in" .-> R[Ingest Reporter]
  R -- "POST /ingest/traces<br/>Bearer project token" --> CP[Control Plane<br/>MVP-3, self-hosted]
  CP --> CPA[Better-Auth<br/>Orgs / Projects / Members]
  CP --> PG[(Postgres)]
  PG --> CPD[Project-scoped Dashboard<br/>WHERE project_id = $1]
```

The dotted path is entirely optional. Without a configured reporter the SDK
makes zero extra network calls and the control plane simply isn't part of your
deployment — the local loop above is complete on its own.

## CLI

```bash
adaptive-router init
adaptive-router doctor
adaptive-router inspect
adaptive-router export --out .adaptive-router/diagnostic-export.json

# MVP-2: run a golden dataset and gate it against the saved baseline
adaptive-router eval datasets/routing.json --baseline
adaptive-router eval:baseline save datasets/routing.json

adaptive-router --help      # or -h
adaptive-router --version   # or -v
```

The CLI helps initialize local config, check provider environment variables,
inspect JSONL trace summaries (including cache hit-rate), export diagnostics,
and run the eval harness with regression gating.

## Run the team control plane (MVP-3)

The control plane is a separate, optional package. It needs a Postgres database
and three environment variables:

```bash
cd packages/control-plane

cp deploy/.env.example .env    # then fill in the three required vars:
#   DATABASE_URL         postgres://user:pass@host:5432/db
#   BETTER_AUTH_SECRET   long random string
#   BETTER_AUTH_URL      public base URL, e.g. https://router.example.com
# optional: PORT (3000), HOST (0.0.0.0), GITHUB_CLIENT_ID / _SECRET,
#           REGISTRATION_OPEN (true)

docker compose -f deploy/docker-compose.yml up   # Postgres + control plane
```

Or run it directly (migrations apply on boot):

```bash
pnpm --filter @adaptive-router/control-plane build
pnpm --filter @adaptive-router/control-plane migrate   # optional; boot also migrates
pnpm --filter @adaptive-router/control-plane start     # bin: adaptive-control-plane
```

Then point your app's SDK at it — this is the only SDK-side change, and it stays
dependency-free:

```ts
import { createRouter, createIngestReporter } from "@adaptive-router/sdk"

const router = createRouter({
  providers,
  models,
  // Traces go to the team control plane instead of only a local file.
  reporter: createIngestReporter({
    url: "https://router.example.com/ingest/traces",
    token: process.env.ADAPTIVE_INGEST_TOKEN!, // per-project, from Settings → API Keys
  }),
})
```

If `reporter` is omitted, nothing is sent and no network call is made. A missing
required env var fails the control plane at boot with a message naming the
variable, rather than starting up half-configured.

See [`deploy/render.yaml`](packages/control-plane/deploy/render.yaml) for a
one-click Render blueprint, and
[MVP-3 architecture](docs/en/mvp3-architecture.md) for the full design.

## Design principles (scope discipline)

The project ships in locked milestones. A few principles hold across all of them:

- TypeScript SDK-first, not proxy-first
- Quality-gated routing based on capability, tier, health, and success signals
- Fallback / retry / timeout for non-streaming requests; no mid-stream fallback
- SQLite storage with JSONL fallback
- **Zero-dependency core SDK** — optional peers (embeddings ONNX, `node:sqlite`)
  are loaded through a dynamic-import shim so a bundler can never pull them in.
  `@adaptive-router/sdk` ships `dependencies: {}` and always will. Cloud
  building blocks (Postgres, OAuth) live **only** in the optional MVP-3
  `@adaptive-router/control-plane` layer — never in the SDK. This boundary is
  machine-enforced: `pnpm check:deps` in CI fails the build if a cloud
  dependency ever leaks into the SDK, dashboard, or CLI
- **Honest degradation** — every downgrade (cache exact-only, hashing embeddings,
  storage error) is recorded in the trace `notes`; nothing degrades silently
- English-first bilingual docs: README, Quickstart, API Reference

## Not yet (deferred to MVP-4+)

- No managed/hosted SaaS offering — the MVP-3 control plane is **self-hosted**
  (you run it; there is no service to sign up for)
- Partial RBAC only: `owner` / `member` are enforced; `admin` / `viewer` are
  reserved and render disabled in the UI
- No audit log, team budgets, or billing
- No organization-level provider keys (keys still live with the app running the SDK)
- No multi-environment separation within a project (use one project per environment)
- No model marketplace
- No real-time LLM judgment of answer quality in the hot path (the eval harness
  runs offline; an LLM-judge plugin hook exists but is opt-in)
- No prompt / context compression yet
- No local proxy / HTTP bridge yet
- No full provider coverage

## Package plan

```text
@adaptive-router/sdk            Runtime SDK, policy, providers, storage, telemetry
@adaptive-router/dashboard      Local read-only dashboard
@adaptive-router/cli            Developer helper commands
@adaptive-router/control-plane  Self-hosted team control plane (optional, MVP-3)
```

The first three are the local developer loop and stay dependency-light. The
control plane is the only package allowed to pull cloud building blocks
(Postgres, OAuth) — see [Design principles](#design-principles-scope-discipline).

## Roadmap

| Stage | Focus | Status |
|---|---|---|
| MVP-0 | SDK routing, providers, durable storage, local dashboard, CLI | ✅ Complete |
| MVP-1 | Framework adapters (LangChain / Vercel AI SDK), more providers (Gemini / Qwen / vLLM), dashboard filtering + model comparison | ✅ Complete |
| MVP-2 | Eval harness + baseline gating, semantic cache, route-outcome learning (human-in-the-loop) | ✅ Complete |
| MVP-3 | Self-hosted team control plane: orgs/projects, auth, Postgres persistence, project-scoped dashboard, deploy templates | ✅ Complete |

MVP-3 ships the team control plane core. Audit logs, team budgets, full RBAC
(`admin` / `viewer`), and organization-level provider keys are deferred to MVP-4+.

See [ROADMAP.md](ROADMAP.md) for the detailed, status-tracked breakdown of every item.

## Contributing

Start here:

- [Contributor Tasks](CONTRIBUTOR_TASKS.md)
- [Good first issue drafts](.github/ISSUE_DRAFTS/README.md)
- [Contributing Guide](CONTRIBUTING.md)

Useful starter areas:

- routing policy examples
- dashboard empty states
- CLI help snapshots
- LangChain ✅ / Vercel AI SDK ✅ framework adapters
- SQLite compatibility
- CI matrix expansion

## Documentation

- [English Quickstart](docs/en/quickstart.md)
- [中文快速开始](docs/zh/quickstart.md)
- [English API Reference](docs/en/api-reference.md)
- [中文 API 参考](docs/zh/api-reference.md)
- [Roadmap](ROADMAP.md)

Control plane (MVP-3):

- [MVP-3 architecture](docs/en/mvp3-architecture.md) · [中文架构说明](docs/zh/mvp3-architecture.md)
- [MVP-3 PRD](docs/en/mvp3-prd.md)
- [MVP-3 UI/UX spec](docs/en/mvp3-uiux.md)
- [MVP-3 implementation design](docs/en/mvp3-impl-design.md)
- [MVP-3 engineering spec (locked contract)](docs/spec-mvp3.md)

## Status

The core developer loop is proven end to end, and MVP-3 has landed:

```text
init config -> route agent request -> store traces -> inspect dashboard -> export diagnostics
                     ↓
            run eval harness -> gate against baseline -> propose weights (human adopts)
                     ↓
     opt-in ingest reporter -> self-hosted control plane -> project-scoped team dashboard
```

**MVP-0 through MVP-3 are all complete and on `main`.** The router does
quality-gated routing across seven providers, plugs into LangChain/LangGraph and
the Vercel AI SDK, adds an eval harness with baseline regression gating, a
degradation-honest semantic cache, and human-in-the-loop route-outcome learning
— and now ships an optional self-hosted control plane so a team can share one
multi-tenant dashboard. Through all of it the core SDK stays zero-dependency and
byte-for-byte compatible with the original MVP-1 scoring.

Development runs through a quality-gated workflow — every change passes
lint → typecheck → build → test → smoke and lands on `main` via a reviewed,
squash-merged PR. The control plane additionally has a CI job that applies
migrations and round-trips ingest against a real Postgres 17 service container.
See [WORKFLOW.md](WORKFLOW.md) and [ROADMAP.md](ROADMAP.md).

**Release status: not on npm yet.** The packages are publish-ready at `0.1.0`
but not yet published, so `pnpm add @adaptive-router/sdk` will 404. Everything
works from a source build (`pnpm install && pnpm -r build`) — the
[Quickstart](docs/en/quickstart.md#1-install) covers linking it into your own
project. See [RELEASING.md](RELEASING.md) for the publish flow and
[ROADMAP.md](ROADMAP.md) for status.

## License

Apache-2.0

---

## 中文简介

Adaptive Model Router 是一个面向 Agent 应用的 SDK-first 开源开发者工具。它嵌入 Agent runtime 内部，根据任务上下文、模型能力、质量档位、稳定性、延迟和成本进行可解释路由，并通过本地 Dashboard 展示每次请求为什么选择某个模型。

目前 MVP-0 / MVP-1 / MVP-2 / MVP-3 均已完成并合入 `main`：

- **MVP-0/1**：TypeScript SDK、质量门控路由、fallback/retry/timeout、本地只读 Dashboard（含请求筛选与模型对比）、SQLite/JSONL 记录、七个 provider（OpenAI、Anthropic、DeepSeek、Ollama、Gemini、Qwen、自托管 vLLM），以及零依赖的 LangChain/LangGraph 与 Vercel AI SDK 适配器。
- **MVP-2**：评估工具链（golden 数据集 + 确定性指标 + 基线回归门禁）、语义缓存（精确匹配 + 向量余弦复用、多租户隔离、TTL、否定词防护，无可信 embedding 时诚实降级为精确匹配、绝不静默）、路由结果学习（离线、人在环、带上下界与评估门禁的权重提议器，学到的权重永不自动采用，需人工显式 `adoptWeights`）。
- **MVP-3**：可选的自托管团队控制面 `@adaptive-router/control-plane` —— Better-Auth 认证（邮箱密码 + 可选 GitHub OAuth）、Organization → Project 两层模型、Postgres 持久化（postgres.js，无 ORM，手写 SQL migrations）、结构化的项目级数据隔离（数据源在构造时闭包捕获 `projectId`，每条查询强制带 `WHERE project_id = $1`，跨项目读取在结构上不可能）、SDK 侧可选的 `createIngestReporter` 上报（未配置时是诚实 no-op，不引入任何新依赖），以及 docker-compose / Dockerfile / Render 部署模板。

两条工程底线贯穿始终：**核心 SDK 零运行时依赖**（可选的 embeddings ONNX、`node:sqlite` 通过动态 import shim 加载，打包器无法静态引入），以及**诚实降级**（任何降级都会写入 trace `notes`）。云构件（Postgres、OAuth）只允许存在于 control-plane 这一层，由 CI 的 `pnpm check:deps` 机器强制，一旦泄漏进 SDK / Dashboard / CLI 就直接构建失败。项目文档采用英文优先、中英双语策略。

MVP-3 交付的是团队控制面的核心；审计日志、团队预算、完整 RBAC（`admin` / `viewer`，目前仅 `owner` / `member` 生效）与组织级 provider key 留待 MVP-4+。
