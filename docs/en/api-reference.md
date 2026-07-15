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

The SDK ships seven provider adapter factories:

```ts
// OpenAI-compatible family
createOpenAIProvider({ apiKey, baseURL?, models?, timeoutMs? })
createDeepSeekProvider({ apiKey, baseURL?, models?, timeoutMs? })
createQwenProvider({ apiKey, baseURL?, models?, timeoutMs? })   // DashScope OpenAI-compatible mode
createVLLMProvider({ baseURL, apiKey?, models?, timeoutMs? })   // self-hosted; optional auth, zero-cost profile

// Native-protocol adapters
createAnthropicProvider({ apiKey, baseURL?, models?, timeoutMs? })
createGeminiProvider({ apiKey, baseURL?, models?, timeoutMs? }) // native generateContent, header auth, tool mapping
createOllamaProvider({ baseURL?, models?, timeoutMs? })         // local, zero-cost
```

Default base URLs:

- OpenAI: `https://api.openai.com/v1`
- Anthropic: `https://api.anthropic.com/v1`
- DeepSeek: `https://api.deepseek.com/v1`
- Qwen (DashScope): `https://dashscope.aliyun.com/compatible-mode/v1`
- Gemini: `https://generativelanguage.googleapis.com/v1beta`
- vLLM: none (you must pass `baseURL`)
- Ollama: `http://localhost:11434`

Tool-calling is advertised only where it is actually implemented: Gemini maps
tools to `functionDeclarations`; Anthropic does not advertise tool-calling until
its tool schema is mapped (honest degradation).

## Framework adapters

Dependency-free adapters that let existing ecosystems route through the router:

```ts
// LangChain / LangGraph — returns a chat-model-shaped object
const model = createLangChainModel(router, { route: { task: 'plan', quality: 'high' } })

// Vercel AI SDK — returns a LanguageModelV1 implementation
const vercel = createVercelModel(router, { route: { task: 'code' } })
```

Both are pure shims — they add **no runtime dependencies** to your project or to
the SDK. Message normalization helpers (`normalizeLangChainMessages`,
`normalizeVercelPrompt`) are exported for advanced use.

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

> Note: the SQLite store currently omits the `cache_lookup` and `weights_change`
> event streams; the JSONL store retains the full log. Tracked as a known
> follow-up.

## Evaluation harness (MVP-2)

Offline, cost-guarded evaluation. The runner **never issues real network calls** —
cases with unknown cost surface an explanatory note rather than guessing.

```ts
import { loadDataset, runEval, compareToBaseline, gateAgainstBaseline } from '@adaptive-router/sdk'

const dataset = await loadDataset('./evals/routing.json') // path or EvalCase[]
const result = await runEval(dataset, { router /* , judge? */ })

// Regression gating against a stored baseline
const report = compareToBaseline(result, baseline)
const gate = gateAgainstBaseline(result, baseline) // pass/fail + reasons
```

- `loadDataset(input)` — load from a JSON file path or an in-memory `EvalCase[]`.
- `validateCase(c)` — returns a list of validation problems (empty = valid).
- `runEval(dataset, options)` — runs each case through routing/scoring.
- `compareToBaseline` / `gateAgainstBaseline` / `formatRegressionReport` — an absent
  baseline passes with a note rather than failing the run.
- Judge plugins implement the `JudgePlugin` type (LLM judge or human feedback).

## Semantic cache (MVP-2)

Embedding-based lookup with honest degradation — if no embedder is wired, the
cache downgrades and records why instead of throwing.

```ts
import { createMemorySemanticCache, DEFAULT_CACHE_THRESHOLD } from '@adaptive-router/sdk'

const cache = createMemorySemanticCache({
  embedder,                          // optional; without it the cache degrades honestly
  threshold: DEFAULT_CACHE_THRESHOLD, // 0.95 (0.98 for very short queries)
  capacity: 1000,
})
```

Helpers: `buildCacheKey`, `queryTextOf`, `sha256`, and the `CACHE_TTL_CLASSES`
constants (`default` / `factual` / `volatile`).

## Embeddings (MVP-2)

```ts
import { createHashingEmbeddingProvider, createOpenAIEmbeddingProvider, cosineSimilarity } from '@adaptive-router/sdk'

const local = createHashingEmbeddingProvider(256)          // deterministic, offline
const remote = createOpenAIEmbeddingProvider({ apiKey })   // when a real embedder is desired
```

Also exported: `normalizeForEmbed`, `l2normalize`, `fnv1a`.

## Route outcome learning (MVP-2)

Learning is **human-in-the-loop**. `proposeWeights()` returns a *candidate* with
`adopted: false` hard-coded — a human must call the registry's `adopt()` to enable
new weights. Weight values are clamped to `WEIGHT_BOUNDS`, and a regression gate
blocks proposals that would worsen the baseline.

```ts
import { proposeWeights, createWeightsRegistry, BUILTIN_WEIGHTS } from '@adaptive-router/sdk'

const registry = createWeightsRegistry(BUILTIN_WEIGHTS)
const { candidate, report, adopted, notes } = await proposeWeights({ /* samples, baseline, ... */ })
// adopted === false always — nothing changes until you opt in:
if (looksGood) registry.adopt(candidate.version)
// registry.rollback(version) / registry.activeVersion() / registry.get(version)
```

Helpers: `computeReward`, `diffWeights`, `flattenWeights`, `unflattenWeights`,
`WEIGHT_ORDER`, `WEIGHT_BOUNDS`, `DEFAULT_REWARD_WEIGHTS`.

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
