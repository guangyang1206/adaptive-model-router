# Add vLLM provider adapter

Labels: `help wanted`, `provider`, `open-source`

## Summary

Add support for a local/self-hosted vLLM OpenAI-compatible endpoint.

## Scope

Implement:

- `createVllmProvider()` factory or documented OpenAI-compatible configuration
- model profile defaults suitable for local models
- request mapping through OpenAI-compatible chat completions
- response/usage extraction
- normalized errors
- docs update

## Acceptance criteria

- Works with a configurable local base URL.
- Marks model type as `self-hosted` or `open-source` where appropriate.
- Cost is estimated or zero by default, clearly marked as estimated.
- TypeScript build passes.

## Non-goals

- Do not require a specific hosted vLLM deployment.
- Do not add GPU provisioning or deployment management.
