# Contributor Tasks

This list is designed to help new contributors find useful starter work.

## Good first issues

### 1. Add examples for routing policies

**Labels**: `good first issue`, `docs`, `examples`

Create small examples showing:

- quality-first routing
- latency-sensitive routing
- cost guard routing
- fallback behavior with `createStaticProvider()`

### 2. Improve dashboard empty states

**Labels**: `good first issue`, `dashboard`

Polish the local dashboard empty states for:

- no requests yet
- no models configured
- failed API read

Keep the design language dark, minimal, and developer-tool oriented.

### 3. Add CLI help snapshots

**Labels**: `good first issue`, `cli`, `tests`

Add smoke tests that capture output for:

- `adaptive-router help`
- `adaptive-router init`
- `adaptive-router doctor`

## Help wanted

> Note: the Qwen, Gemini, and vLLM provider adapters that used to be listed here
> shipped in MVP-1. Use them as reference implementations when adding a new
> provider — they all live in `packages/sdk/src/providers.ts`
> (`createQwenProvider`, `createGeminiProvider`, `createVLLMProvider`).

### 4. Add a new provider adapter

**Labels**: `help wanted`, `provider`

Pick a provider we don't cover yet (Mistral, Cohere, Bedrock, Azure OpenAI, …)
and follow the shape of the existing adapters. Include:

- model profile defaults
- request mapping
- response mapping
- usage extraction
- normalized errors
- docs update

Keep provider-specific quirks entirely inside the adapter, and add no runtime
dependency to the SDK.

### 5. Broaden control-plane test coverage

**Labels**: `help wanted`, `control-plane`, `tests`

The control plane has DB-less unit tests plus one real-Postgres round-trip
(`packages/control-plane/integration/roundtrip.mjs`, run by the
`control-plane-integration` CI job). Good additions: member invite/removal flows,
ingest token rotation, and negative auth cases (expired session, wrong project
token). Assert the project-scoping guarantee rather than assuming it.

### 6. Bring the SQLite store to event-stream parity with JSONL

**Labels**: `help wanted`, `storage`

The SQLite store deliberately omits the `cache_lookup` / `weights_change` event
streams that JSONL retains — see the comment at
`packages/sdk/src/storage.ts:360-362` (a known P2 follow-up from MVP-2). Pick
SQLite and those two streams are silently absent, so dashboard views fed by them
render empty with no explanation. Bring SQLite to parity, keeping `node:sqlite`
optional and the JSONL fallback intact.

Note that the *other* SQLite concerns once listed here have already shipped:
runtime detection via a guarded dynamic import (`storage.ts:251`) and a named
error when SQLite is unavailable and no `fallbackPath` is set
(`storage.ts:257-262`). Parity is the part still open.

### 7. Add a Node version CI matrix

**Labels**: `help wanted`, `ci`

CI pins Node 22 in both jobs while the project advertises Node 20+, so the
supported floor is untested. The test steps were already written as a bare
`node --test` specifically so they work on both versions
(`.github/workflows/ci.yml:78-82`), so this is mostly a matter of adding the
matrix and confirming it.

## Contribution principles

- **Stay inside the current milestone's scope.** MVP-0 through MVP-3 have shipped;
  see [ROADMAP.md](ROADMAP.md) for what is locked and what is deferred. Anything
  outside the current milestone needs a spec change first.
- **Never add a runtime dependency to `@adaptive-router/sdk`.** It ships
  `dependencies: {}` and always will. Cloud building blocks (Postgres, OAuth)
  belong only in `@adaptive-router/control-plane`; `pnpm check:deps` enforces this
  and will fail your build.
- Do not add billing or model marketplace features. Team collaboration landed in
  MVP-3, but full RBAC (`admin` / `viewer`), audit logs, team budgets, and
  organization-level provider keys are deferred to MVP-4+ — don't start them
  without a scope decision.
- Do not claim real-time answer quality judgment.
- Keep provider quirks inside provider adapters.
- Never commit secrets or real API keys.
