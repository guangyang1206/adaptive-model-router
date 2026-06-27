# API Reference

## `createRouter(config)`

Creates an adaptive model router.

```ts
const router = createRouter({ providers, models, policy, store })
```

## `router.chat(request)`

Routes and executes a chat request.

```ts
const result = await router.chat({ messages, tools, route })
```

Returns a provider response plus `routerTrace`.

## `router.evaluate(request)`

Dry-runs routing without calling a model.

```ts
const evaluation = await router.evaluate({ messages, route })
```

The evaluation result includes sorted candidates, skipped candidates, and human-readable reasons.

## `router.traces()`

Returns traces recorded by the configured store. The default MVP store is in-memory.

```ts
const traces = await router.traces()
```

## `router.wrapOpenAI(client)`

Wraps an OpenAI-compatible client shape and routes `chat.completions.create()` calls through Adaptive Model Router.

```ts
const wrapped = router.wrapOpenAI(openaiLikeClient)
await wrapped.chat?.completions?.create({
  messages,
  metadata: { route: { task: 'plan', quality: 'high' } },
})
```

## `router.dashboard(options)`

Returns the local dashboard URL.

```ts
const dashboard = await router.dashboard({ port: 4318 })
```

## Error codes

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
