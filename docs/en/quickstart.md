# Quickstart

Adaptive Model Router has shipped MVP-1 (framework + provider expansion) and
MVP-2 (evaluation + optimization). This quickstart shows the core developer flow;
see the [API Reference](./api-reference.md) for the full surface.

## 1. Install

```bash
pnpm add @adaptive-router/sdk
```

## 2. Initialize a router

```ts
import { createDashboard, createReadOnlyDataAccess } from '@adaptive-router/dashboard'
import {
  createAnthropicProvider,
  createDeepSeekProvider,
  createOllamaProvider,
  createOpenAIProvider,
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
    createDeepSeekProvider({ apiKey: process.env.DEEPSEEK_API_KEY }),
    createOllamaProvider({ baseURL: process.env.OLLAMA_BASE_URL }),
  ],
  policy: {
    defaultQuality: 'balanced',
    stability: 'high',
    costMode: 'optimize-within-quality-threshold',
  },
  store,
})
```

## 3. Send a routed request

```ts
const result = await router.chat({
  messages: [{ role: 'user', content: 'Plan the next coding task.' }],
  route: {
    task: 'plan',
    quality: 'high',
    stability: 'high',
    explain: true,
  },
})

console.log(result.routerTrace)
```

## 4. Open the local dashboard

```ts
const dashboard = await createDashboard({
  port: 4318,
  data: createReadOnlyDataAccess({
    listTraces: () => router.traces(),
    listModels: () => router.models(),
  }),
})

console.log(dashboard.url)
```

## 5. Use the CLI

```bash
adaptive-router init
adaptive-router doctor
adaptive-router inspect
adaptive-router export --out .adaptive-router/diagnostic-export.json

# Evaluation (MVP-2)
adaptive-router eval ./evals/routing.json          # run an eval set
adaptive-router eval:baseline ./evals/routing.json ./evals/baseline.json  # write/refresh a baseline

adaptive-router --help       # or -h
adaptive-router --version    # or -v
```

The CLI initializes config, checks provider environment variables, summarizes
JSONL traces, exports local diagnostics, and runs offline evaluation sets against
an optional baseline.

## Notes and limitations

The router does not judge answer quality in real time during routing. Quality is
represented by capability match, configured model tier, and health/success
signals. The MVP-2 eval harness scores quality **offline** against user-defined
case sets — it never issues real network calls.

Streaming requests do not support mid-stream fallback after the first token has
been emitted.

Optional features degrade honestly: the semantic cache works without an embedder
(it just downgrades and records why), and route-outcome learning never adopts new
weights on its own (`adopted: false` until a human opts in).
