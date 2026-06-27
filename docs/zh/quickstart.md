# 快速开始

Adaptive Model Router 当前处于 MVP-0 脚手架阶段。本文展示预期的开发者接入流程。

## 1. 安装

```bash
pnpm add @adaptive-router/sdk
```

## 2. 初始化 Router

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
const dashboard = await router.dashboard({ port: 4318 })
console.log(dashboard.url)
```

## MVP 限制

MVP-0 不实时判断回答质量。质量仅由能力匹配、模型档位、健康状态和历史成功信号表达。

Streaming 请求在第一个 token 输出后不支持中途 fallback。
