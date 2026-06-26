# Contributing

Thanks for your interest in Adaptive Model Router.

## Principles

- SDK-first, not gateway-first.
- Quality and stability before cost optimization.
- Open-source and self-hosted models are first-class citizens.
- Routing decisions must be explainable.
- MVP-0 must stay small: no hosted SaaS, no model marketplace, no real-time answer-quality judgment.

## Local development

```bash
pnpm install
pnpm build
pnpm typecheck
pnpm test
```

## Project structure

```text
packages/sdk        Core SDK, providers, policy, storage, telemetry
packages/dashboard  Local read-only dashboard scaffold
examples/basic-agent Minimal usage example
```

## Contribution areas

Good first contribution areas:

- Provider adapter mapping
- Capability registry entries
- Dashboard empty/loading/error states
- Documentation examples
- Tests for routing and fallback behavior

## Pull request expectations

- Keep API names and error codes in English.
- Add or update tests for behavior changes.
- Do not add new providers to P0 without a clear capability profile.
- Do not introduce hosted/cloud assumptions into the local dashboard.
- Clearly mark estimated token/cost values as estimated.
