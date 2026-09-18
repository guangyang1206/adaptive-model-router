# basic-agent example

A copy-and-run example for [`@adaptive-router/sdk`](https://www.npmjs.com/package/@adaptive-router/sdk)
and [`@adaptive-router/dashboard`](https://www.npmjs.com/package/@adaptive-router/dashboard).

This directory is standalone. Copy it anywhere outside the repository and it
still installs from the public npm registry — it does not depend on the
monorepo.

## What it demonstrates

1. **Scoring without calling a provider** — `router.evaluate()` ranks the model
   catalog and returns per-candidate scores and reasons. No network call, so the
   output is identical with or without API keys.
2. **How preferences change the winner** — the same prompt at
   `quality: "standard"` and `quality: "high"` picks different models.
3. **Capability hard filters** — requesting `json-mode` removes models that
   cannot do it, and records `missing capability: json-mode` on the candidate.
4. **A real routed call** — `router.chat()` returns `{ response, routerTrace }`,
   including the chosen model, latency, estimated cost and the fallback
   attempts.
5. **Trace persistence** — every decision is appended to
   `.adaptive-router/traces.jsonl`.
6. **The local dashboard** — opt-in, reads the same traces over HTTP.

## Requirements

- Node.js >= 20 (verified on 22.x)
- npm, pnpm or yarn
- **No API key.** See below.

## Run it

```bash
npm install
npm start
```

Expected output on a machine with no credentials configured:

```
Mode: offline - no provider credentials found, using a local stub provider.
Set OPENAI_API_KEY, ANTHROPIC_API_KEY, DEEPSEEK_API_KEY or OLLAMA_BASE_URL to route for real.

Ranking for quality=standard
  offline/fast-draft          105.00   tier=standard provider=offline quality-threshold=standard health=ok type=self-hosted
  offline/deep-reasoner       100.95   tier=high provider=offline quality-threshold=standard health=ok type=self-hosted

Ranking for quality=high
  offline/deep-reasoner       100.95   tier=high provider=offline quality-threshold=high health=ok type=self-hosted
  offline/fast-draft           75.00   tier=standard provider=offline quality-threshold=high health=ok type=self-hosted

Ranking for requiredCapabilities=[json-mode]
  offline/deep-reasoner       100.95   tier=high provider=offline quality-threshold=balanced health=ok type=self-hosted
  offline/fast-draft       skipped   missing capability: json-mode

Chat result
  chosenModel   offline/deep-reasoner
  status        success
  latencyMs     0
  estCostUsd    0.000525
  reason        tier=high; provider=offline; quality-threshold=balanced; health=ok; type=self-hosted
  content       This is a scaffold response.

Traces written to .adaptive-router/traces.jsonl (1 so far).
```

The process exits on its own. Exit code is `0` when a model answered and `1`
when every candidate failed.

## No API key required

The example has two modes and picks one automatically:

| Mode | When | Provider used | Network calls |
| --- | --- | --- | --- |
| `offline` | no provider env var is set | `createStaticProvider("offline", ...)` | none |
| `live` | at least one provider env var is set | the matching real provider | yes |

In `offline` mode the routing engine is the real one — only the provider at the
end of the chain is a local stub that returns a fixed string. Scoring, tier
gating, capability filtering, cost estimation, fallback and tracing all run for
real. That is the point: you can evaluate the router's decisions before you
spend a cent or paste a key anywhere.

`router.evaluate()` never calls a provider in either mode, so if you only want
to see routing decisions you never need a key at all.

## Going live

Set any of these and re-run:

```bash
OPENAI_API_KEY=sk-...        npm start
ANTHROPIC_API_KEY=sk-ant-... npm start
DEEPSEEK_API_KEY=...         npm start
OLLAMA_BASE_URL=http://localhost:11434 npm start
```

Ollama is only registered when `OLLAMA_BASE_URL` is set explicitly, rather than
always. Registering it unconditionally would shadow the offline provider, and a
first run without a local Ollama daemon would end in `status: failed` instead of
a working demo.

## Dashboard

```bash
DASHBOARD=1 npm start
```

Serves the read-only dashboard on `http://127.0.0.1:4318` (override with
`DASHBOARD_PORT`). It stays up until you press Ctrl+C. Off by default so that
`npm start` terminates and can be used in a script or CI step.

## Type checking

```bash
npm run typecheck
```

This compiles against the published `.d.ts` files, so it fails if the example
ever drifts from the installed SDK version.

## Files

| Path | Role |
| --- | --- |
| `src/index.ts` | The five demo steps and console output |
| `src/providers.ts` | Chooses live providers from env, falls back to offline |
| `src/models.ts` | The offline `ModelProfile` catalog |

## Swapping the trace store

The example uses the JSONL store because it has no native dependency and no
runtime warnings. For SQLite, change one call in `src/index.ts`:

```ts
const store = await createSQLiteTraceStore({
  path: ".adaptive-router/router.db",
  fallbackPath: ".adaptive-router/router.jsonl",
})
```

`createSQLiteTraceStore` is async and uses Node's built-in `node:sqlite`, which
still prints an `ExperimentalWarning` on Node 22. It falls back to
`fallbackPath` automatically when `node:sqlite` is unavailable.

## Versions

Dependencies are pinned to `^0.1.0`, which resolves to `>=0.1.0 <0.2.0`. You get
patch fixes automatically but never an unannounced breaking change, since this
project is pre-1.0 and treats the minor slot as its breaking-change slot.
