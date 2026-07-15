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

SDK 提供七个 provider adapter 工厂函数：

```ts
// OpenAI-compatible 家族
createOpenAIProvider({ apiKey, baseURL?, models?, timeoutMs? })
createDeepSeekProvider({ apiKey, baseURL?, models?, timeoutMs? })
createQwenProvider({ apiKey, baseURL?, models?, timeoutMs? })   // DashScope OpenAI 兼容模式
createVLLMProvider({ baseURL, apiKey?, models?, timeoutMs? })   // 自托管；可选鉴权，零成本档

// 原生协议 adapter
createAnthropicProvider({ apiKey, baseURL?, models?, timeoutMs? })
createGeminiProvider({ apiKey, baseURL?, models?, timeoutMs? }) // 原生 generateContent，header 鉴权，tool 映射
createOllamaProvider({ baseURL?, models?, timeoutMs? })         // 本地，零成本
```

默认 base URL：

- OpenAI: `https://api.openai.com/v1`
- Anthropic: `https://api.anthropic.com/v1`
- DeepSeek: `https://api.deepseek.com/v1`
- Qwen (DashScope): `https://dashscope.aliyun.com/compatible-mode/v1`
- Gemini: `https://generativelanguage.googleapis.com/v1beta`
- vLLM: 无（必须传入 `baseURL`）
- Ollama: `http://localhost:11434`

Tool-calling 只在真正实现的地方对外声明：Gemini 将 tools 映射为
`functionDeclarations`；Anthropic 在其 tool schema 映射完成前不声明 tool-calling
（诚实降级）。

## 框架 adapter

零依赖 adapter，让已有生态可以直接经由 router 路由：

```ts
// LangChain / LangGraph —— 返回 chat-model 形状对象
const model = createLangChainModel(router, { route: { task: 'plan', quality: 'high' } })

// Vercel AI SDK —— 返回 LanguageModelV1 实现
const vercel = createVercelModel(router, { route: { task: 'code' } })
```

两者都是纯 shim —— 不给你的项目或 SDK 引入**任何运行时依赖**。消息标准化辅助函数
（`normalizeLangChainMessages`、`normalizeVercelPrompt`）也已导出，供进阶使用。

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

> 注意：SQLite store 目前不记录 `cache_lookup` 和 `weights_change` 两类事件流；
> JSONL store 保留完整日志。已作为已知的后续项跟踪。

## 评测框架（MVP-2）

离线、带成本护栏的评测。runner **绝不发起真实网络调用**——成本未知的用例会给出一条
解释性 note，而不是瞎猜。

```ts
import { loadDataset, runEval, compareToBaseline, gateAgainstBaseline } from '@adaptive-router/sdk'

const dataset = await loadDataset('./evals/routing.json') // 路径或 EvalCase[]
const result = await runEval(dataset, { router /* , judge? */ })

// 针对已存基线做回归门禁
const report = compareToBaseline(result, baseline)
const gate = gateAgainstBaseline(result, baseline) // pass/fail + 原因
```

- `loadDataset(input)` —— 从 JSON 文件路径或内存中的 `EvalCase[]` 加载。
- `validateCase(c)` —— 返回校验问题列表（为空即合法）。
- `runEval(dataset, options)` —— 逐用例执行路由/打分。
- `compareToBaseline` / `gateAgainstBaseline` / `formatRegressionReport` —— 基线缺失时
  以 note 形式通过，而非让整轮失败。
- Judge 插件实现 `JudgePlugin` 类型（LLM 评审或人工反馈）。

## 语义缓存（MVP-2）

基于 embedding 的查找，诚实降级——没有 embedder 时缓存会降级并记录原因，而不是抛错。

```ts
import { createMemorySemanticCache, DEFAULT_CACHE_THRESHOLD } from '@adaptive-router/sdk'

const cache = createMemorySemanticCache({
  embedder,                          // 可选；缺失时缓存诚实降级
  threshold: DEFAULT_CACHE_THRESHOLD, // 0.95（极短查询为 0.98）
  capacity: 1000,
})
```

辅助函数：`buildCacheKey`、`queryTextOf`、`sha256`，以及 `CACHE_TTL_CLASSES` 常量
（`default` / `factual` / `volatile`）。

## Embeddings（MVP-2）

```ts
import { createHashingEmbeddingProvider, createOpenAIEmbeddingProvider, cosineSimilarity } from '@adaptive-router/sdk'

const local = createHashingEmbeddingProvider(256)          // 确定性、离线
const remote = createOpenAIEmbeddingProvider({ apiKey })   // 需要真实 embedder 时
```

同时导出：`normalizeForEmbed`、`l2normalize`、`fnv1a`。

## 路由结果学习（MVP-2）

学习是 **human-in-the-loop**。`proposeWeights()` 返回一个*候选*，其中 `adopted: false`
是硬编码的——必须由人工调用注册表的 `adopt()` 才能启用新权重。权重值会被 clamp 到
`WEIGHT_BOUNDS`，并有回归门禁拦截会让基线变差的候选。

```ts
import { proposeWeights, createWeightsRegistry, BUILTIN_WEIGHTS } from '@adaptive-router/sdk'

const registry = createWeightsRegistry(BUILTIN_WEIGHTS)
const { candidate, report, adopted, notes } = await proposeWeights({ /* samples, baseline, ... */ })
// adopted 恒为 false —— 在你主动开启前不改变任何东西：
if (looksGood) registry.adopt(candidate.version)
// registry.rollback(version) / registry.activeVersion() / registry.get(version)
```

辅助函数：`computeReward`、`diffWeights`、`flattenWeights`、`unflattenWeights`、
`WEIGHT_ORDER`、`WEIGHT_BOUNDS`、`DEFAULT_REWARD_WEIGHTS`。

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
