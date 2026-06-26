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

## `router.wrapOpenAI(client)`

计划中的 OpenAI-like client 兼容包装器。

## `router.dashboard(options)`

启动或返回本地 Dashboard URL。

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
