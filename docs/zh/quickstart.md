# 快速开始

Adaptive Model Router 当前处于 MVP-0 脚手架阶段。本文展示预期的开发者接入流程。

## 1. 安装

```bash
pnpm add @adaptive-router/sdk
```

## 2. 初始化 Router

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

## 3. 发送一次路由请求

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

## 4. 打开本地 Dashboard

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

## 5. 使用 CLI

```bash
adaptive-router init
adaptive-router doctor
adaptive-router inspect
adaptive-router export --out .adaptive-router/diagnostic-export.json
```

CLI 用于初始化配置、检查 provider 环境变量、汇总 JSONL traces，并导出本地诊断包。

## MVP 限制

MVP-0 不实时判断回答质量。质量仅由能力匹配、模型档位、健康状态和历史成功信号表达。

Streaming 请求在第一个 token 输出后不支持中途 fallback。
