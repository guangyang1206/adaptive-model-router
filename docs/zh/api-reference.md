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

## `router.dashboard(options)`

返回本地 Dashboard URL。

```ts
const dashboard = await router.dashboard({ port: 4318 })
```

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
