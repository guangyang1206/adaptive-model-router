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

### 4. Add Qwen provider adapter

**Labels**: `help wanted`, `provider`

Implement a Qwen adapter. Prefer an OpenAI-compatible path if possible. Include:

- model profile defaults
- request mapping
- response mapping
- usage extraction
- normalized errors
- docs update

### 5. Add Gemini provider adapter

**Labels**: `help wanted`, `provider`

Implement a native Gemini adapter with clear capability mapping. Keep provider-specific details isolated behind the adapter interface.

### 6. Add vLLM provider adapter

**Labels**: `help wanted`, `provider`, `open-source`

Add support for a local/self-hosted vLLM OpenAI-compatible endpoint.

### 7. Improve SQLite support beyond fallback mode

**Labels**: `help wanted`, `storage`

The current SQLite store uses Node's built-in `node:sqlite` when available and falls back to JSONL. Improve compatibility and tests across Node versions.

### 8. Add CI matrix

**Labels**: `help wanted`, `ci`

Expand CI to test multiple Node versions once the package manager strategy is stable.

## Contribution principles

- Keep MVP-0 scoped.
- Do not add SaaS, RBAC, billing, or model marketplace features yet.
- Do not claim real-time answer quality judgment.
- Keep provider quirks inside provider adapters.
- Never commit secrets or real API keys.
