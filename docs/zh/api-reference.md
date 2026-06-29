# API 参考

## `createRouter(config)`

创建自适应模型路由器。

```ts
const router = createRouter({ providers, models, policy, store })
```

## `router.chat(request)`

路由并执行一次 chat 请求。

```ts
const result = await router.chat({ messages, tools, route })
```

返回 provider 响应和 `routerTrace`。

## `router.evaluate(request)`

只做路由 dry-run，不调用模型。

```ts
const evaluation = await router.evaluate({ messages, route })
```

返回排序后的候选模型、跳过原因和可读解释。

## `router.traces()`

返回当前 store 记录的 trace。MVP 默认 store 为内存存储。

```ts
const traces = await router.traces()
```

## `router.wrapOpenAI(client)`

包装 OpenAI-compatible client，并将 `chat.completions.create()` 调用路由到 Adaptive Model Router。

```ts
const wrapped = router.wrapOpenAI(openaiLikeClient)
await wrapped.chat?.completions?.create({
  messages,
  metadata: { route: { task: 'plan', quality: 'high' } },
})
```

## Provider factories

MVP-0 包含四个 provider adapter 工厂函数：

```ts
createOpenAIProvider({ apiKey, baseURL?, models?, timeoutMs? })
createAnthropicProvider({ apiKey, baseURL?, models?, timeoutMs? })
createDeepSeekProvider({ apiKey, baseURL?, models?, timeoutMs? })
createOllamaProvider({ baseURL?, models?, timeoutMs? })
```

默认 base URL：

- OpenAI: `https://api.openai.com/v1`
- Anthropic: `https://api.anthropic.com/v1`
- DeepSeek: `https://api.deepseek.com/v1`
- Ollama: `http://localhost:11434`

## `router.dashboard(options)`

计算本地 Dashboard 将要服务的 URL。**它不会启动 HTTP 服务**——SDK 不依赖 dashboard 包。返回的 handle 中 `started` 为 `false`，并带有提示如何真正启动服务。

```ts
const handle = await router.dashboard({ port: 4318 })
// handle.url => "http://localhost:4318"
// handle.started => false
```

如需真正运行 Dashboard，请安装 `@adaptive-router/dashboard` 并用 router 的 traces 启动：

```ts
import { createDashboard, createReadOnlyDataAccess } from '@adaptive-router/dashboard'

const traces = await router.traces()
const running = await createDashboard({
  port: 4318,
  data: createReadOnlyDataAccess({ listTraces: () => traces, listModels: () => [] }),
})
// running.url 现在是一个真实运行的服务
```

## Storage

MVP durable storage 包含 JSONL store，以及带 JSONL fallback 的异步 SQLite store。

```ts
const jsonlStore = createJsonlTraceStore({ path: '.adaptive-router/router.jsonl' })

const sqliteStore = await createSQLiteTraceStore({
  path: '.adaptive-router/router.db',
  fallbackPath: '.adaptive-router/router.jsonl',
})
```

`createSQLiteTraceStore()` 会在可用时使用 Node 内置 `node:sqlite`。如果 SQLite 不可用且提供了 `fallbackPath`，会降级到 JSONL。

## 错误码

- `AR_NO_CANDIDATE`
- `AR_PROVIDER_AUTH_FAILED`
- `AR_PROVIDER_RATE_LIMITED`
- `AR_PROVIDER_TIMEOUT`
- `AR_PROVIDER_5XX`
- `AR_NETWORK_ERROR`
- `AR_CONTEXT_EXCEEDED`
- `AR_INVALID_REQUEST`
- `AR_STREAM_INTERRUPTED`
- `AR_STORAGE_UNAVAILABLE`
