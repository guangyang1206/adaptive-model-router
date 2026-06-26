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

## `router.wrapOpenAI(client)`

Planned compatibility wrapper for OpenAI-like clients.

## `router.dashboard(options)`

Starts or returns the local dashboard URL.

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
