# Add Qwen provider adapter

Labels: `help wanted`, `provider`

## Summary

Add a Qwen provider adapter. Prefer an OpenAI-compatible path if possible.

## Scope

Implement:

- model profile defaults
- request mapping
- response mapping
- usage extraction
- normalized errors
- docs update

## Suggested files

```text
packages/sdk/src/providers.ts
README.md
docs/en/api-reference.md
docs/zh/api-reference.md
```

## Acceptance criteria

- Adapter exposes a `createQwenProvider()` factory.
- Provider quirks stay isolated inside the adapter.
- No real API keys or secrets are committed.
- TypeScript build passes.
- At least one mock or non-network test covers request/response mapping if practical.

## Non-goals

- Do not add model marketplace behavior.
- Do not claim real-time answer quality judgment.
