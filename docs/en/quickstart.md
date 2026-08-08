# Quickstart

Adaptive Model Router has shipped MVP-1 (framework + provider expansion),
MVP-2 (evaluation + optimization), and MVP-3 (self-hosted team control plane).
This quickstart shows the core developer flow; see the
[API Reference](./api-reference.md) for the full surface. If you want the shared
team setup, jump to [Share it with a team](#share-it-with-a-team-mvp-3).

## 1. Install

> **Not on npm yet.** The packages are publish-ready at `0.1.0` but not yet
> published, so `pnpm add @adaptive-router/sdk` will fail with a 404. Until the
> first release, build from source — it takes about a minute.

```bash
git clone https://github.com/guangyang1206/adaptive-model-router.git
cd adaptive-model-router

pnpm install        # pnpm 9, Node 20+ (CI runs 22). npm will NOT work here:
                    # it skips the workspace links and cross-package imports break.
pnpm -r build       # builds sdk -> dashboard -> cli -> control-plane
```

Then use it from your own project by pointing at the built workspace — either
link it (run this in *your* project; `pnpm link <dir>` takes a path):

```bash
cd /path/to/your-project
pnpm link /path/to/adaptive-model-router/packages/sdk
```

…or add a `file:` dependency in your `package.json`:

```json
{
  "dependencies": {
    "@adaptive-router/sdk": "file:../adaptive-model-router/packages/sdk"
  }
}
```

The quickest way to try it without wiring anything is to run inside the cloned
repo, where the workspace links already exist:

```bash
node --input-type=module -e "
import { createRouter, createStaticProvider } from './packages/sdk/dist/index.js'
const models = [{ id: 'local/demo', provider: 'demo', model: 'demo', type: 'self-hosted',
  kind: 'openai-compatible', tier: 'balanced', contextWindow: 8192,
  capabilities: ['reasoning'], enabled: true,
  cost: { inputPer1M: 0, outputPer1M: 0, currency: 'USD', estimated: true },
  health: { status: 'ok', successRate: 1 } }]
const router = createRouter({ providers: [createStaticProvider('demo', models)], models })
const e = await router.evaluate({ messages: [{ role: 'user', content: 'Plan a task.' }], route: { task: 'plan' } })
console.log('ranked candidates:', e.candidates.length)
"
```

That needs no API key — `evaluate()` only makes the routing decision, it never
calls a provider.

Once the packages are published, this section collapses back to a single
`pnpm add @adaptive-router/sdk`.

## 2. Initialize a router

```ts
import { createDashboard, createReadOnlyDataAccess } from '@adaptive-router/dashboard'
import {
  createAnthropicProvider,
  createDeepSeekProvider,
  createOllamaProvider,
  createOpenAIProvider,
  createRouter,
  createSQLiteTraceStore,
} from '@adaptive-router/sdk'

const store = await createSQLiteTraceStore({
  path: '.adaptive-router/router.db',
  fallbackPath: '.adaptive-router/router.jsonl',
})

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
  store,
})
```

## 3. Send a routed request

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

## 4. Open the local dashboard

```ts
const dashboard = await createDashboard({
  port: 4318,
  data: createReadOnlyDataAccess({
    listTraces: () => router.traces(),
    listModels: () => router.models(),
  }),
})

console.log(dashboard.url)
```

## 5. Use the CLI

```bash
adaptive-router init
adaptive-router doctor
adaptive-router inspect
adaptive-router export --out .adaptive-router/diagnostic-export.json

# Evaluation (MVP-2)
adaptive-router eval ./evals/routing.json          # run an eval set
adaptive-router eval:baseline ./evals/routing.json ./evals/baseline.json  # write/refresh a baseline

adaptive-router --help       # or -h
adaptive-router --version    # or -v
```

The CLI initializes config, checks provider environment variables, summarizes
JSONL traces, exports local diagnostics, and runs offline evaluation sets against
an optional baseline.

## Share it with a team (MVP-3)

Everything above is local and needs no server. If your team wants one shared
view, deploy the optional control plane — it's a separate package and does not
change the SDK's zero-dependency guarantee.

### Start the control plane

It needs Postgres plus three environment variables:

| Variable | Required | Notes |
|---|---|---|
| `DATABASE_URL` | yes | `postgres://user:pass@host:5432/db` |
| `BETTER_AUTH_SECRET` | yes | long random string |
| `BETTER_AUTH_URL` | yes | public base URL (OAuth callback + cookie domain) |
| `PORT` | no | default `3000` |
| `HOST` | no | default `0.0.0.0` |
| `GITHUB_CLIENT_ID` / `GITHUB_CLIENT_SECRET` | no | enables GitHub login when **both** are set |
| `REGISTRATION_OPEN` | no | default `true`; set `false` to lock down signups |
| `POSTGRES_PASSWORD` | no | only used by the docker-compose `db` service (default `adaptive`) |

The fastest path is docker-compose (brings up Postgres too):

```bash
cd packages/control-plane
cp deploy/.env.example .env      # fill in the three required vars
docker compose -f deploy/docker-compose.yml up
```

Or run it directly — migrations apply automatically on boot:

```bash
pnpm --filter @adaptive-router/control-plane build
pnpm --filter @adaptive-router/control-plane start   # bin: adaptive-control-plane
```

A missing required variable fails the boot with an error naming that exact
variable, before the port is bound — it never starts half-configured.

### Create an org, a project, and a token

Open the control plane in a browser, sign up (the first user becomes the
organization owner), and follow onboarding to create your first project. Then go
to **Settings → API Keys** and generate an ingest token. Tokens are per-project.

### Point your app at it

This is the only SDK-side change:

```ts
import { createRouter, createIngestReporter } from "@adaptive-router/sdk"

const router = createRouter({
  providers,
  models,
  reporter: createIngestReporter({
    url: "https://router.example.com/ingest/traces",
    token: process.env.ADAPTIVE_INGEST_TOKEN!,
  }),
})
```

Traces now show up in the team dashboard, scoped to that project. Notes:

- **Opt-in and dependency-free.** The reporter uses the runtime's built-in
  `fetch`. Omit `reporter` and nothing is sent — no network call, behavior is
  identical to MVP-2.
- **It can never break your app.** Transport errors are swallowed by default
  (pass `onError` to observe them). A slow or down control plane does not affect
  routing or local trace storage.
- **The server decides which project a trace belongs to**, deriving `project_id`
  from the token. A client cannot write into another project by editing the body.

## Notes and limitations

The router does not judge answer quality in real time during routing. Quality is
represented by capability match, configured model tier, and health/success
signals. The MVP-2 eval harness scores quality **offline** against user-defined
case sets — it never issues real network calls.

Streaming requests do not support mid-stream fallback after the first token has
been emitted.

Optional features degrade honestly: the semantic cache works without an embedder
(it just downgrades and records why), and route-outcome learning never adopts new
weights on its own (`adopted: false` until a human opts in).
