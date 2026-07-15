# 快速开始

Adaptive Model Router 已交付 MVP-1（框架与 provider 扩展）和 MVP-2（评测与优化）。
本文展示核心接入流程，完整 API 见 [API 参考](./api-reference.md)。

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

# 评测（MVP-2）
adaptive-router eval ./evals/routing.json          # 运行评测集
adaptive-router eval:baseline ./evals/routing.json ./evals/baseline.json  # 写入/刷新基线

adaptive-router --help       # 或 -h
adaptive-router --version    # 或 -v
```

CLI 用于初始化配置、检查 provider 环境变量、汇总 JSONL traces、导出本地诊断包，
并针对可选基线运行离线评测集。

## 说明与限制

路由过程中不实时判断回答质量。路由时的"质量"仅由能力匹配、模型档位、健康状态和
历史成功信号表达。MVP-2 评测框架在**离线**阶段针对用户自定义用例集打分——它绝不
发起真实网络调用。

Streaming 请求在第一个 token 输出后不支持中途 fallback。

可选能力均遵循"诚实降级"：语义缓存在没有 embedder 时也能工作（只是降级并记录原因），
路由结果学习绝不会自行采纳新权重（在人工确认前始终 `adopted: false`）。
