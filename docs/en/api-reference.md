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

## Provider factories

MVP-0 includes four provider adapter factories:

```ts
createOpenAIProvider({ apiKey, baseURL?, models?, timeoutMs? })
createAnthropicProvider({ apiKey, baseURL?, models?, timeoutMs? })
createDeepSeekProvider({ apiKey, baseURL?, models?, timeoutMs? })
createOllamaProvider({ baseURL?, models?, timeoutMs? })
```

Default base URLs:

- OpenAI: `https://api.openai.com/v1`
- Anthropic: `https://api.anthropic.com/v1`
- DeepSeek: `https://api.deepseek.com/v1`
- Ollama: `http://localhost:11434`

## `router.dashboard(options)`

Computes the URL the local dashboard would be served at. **It does not start an HTTP server** — the SDK does not depend on the dashboard package. The returned handle has `started: false` and a `hint` explaining how to launch the real server.

```ts
const handle = await router.dashboard({ port: 4318 })
// handle.url => "http://localhost:4318"
// handle.started => false
```

To actually run the dashboard, install `@adaptive-router/dashboard` and start it with the router's traces:

```ts
import { createDashboard, createReadOnlyDataAccess } from '@adaptive-router/dashboard'

const traces = await router.traces()
const running = await createDashboard({
  port: 4318,
  data: createReadOnlyDataAccess({ listTraces: () => traces, listModels: () => [] }),
})
// running.url is now a live server
```

## Storage

MVP durable storage includes a JSONL store and an async SQLite store with JSONL fallback.

```ts
const jsonlStore = createJsonlTraceStore({ path: '.adaptive-router/router.jsonl' })

const sqliteStore = await createSQLiteTraceStore({
  path: '.adaptive-router/router.db',
  fallbackPath: '.adaptive-router/router.jsonl',
})
```

`createSQLiteTraceStore()` uses Node's built-in `node:sqlite` when available. If SQLite is unavailable and `fallbackPath` is provided, it falls back to JSONL.

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
