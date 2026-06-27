# Add Gemini provider adapter

Labels: `help wanted`, `provider`

## Summary

Add a native Gemini provider adapter with clear capability mapping.

## Scope

Implement:

- `createGeminiProvider()` factory
- model profile defaults
- request mapping
- response mapping
- usage extraction where available
- normalized errors
- docs update

## Acceptance criteria

- Gemini-specific behavior is isolated behind the provider adapter interface.
- Capability mapping is explicit and conservative.
- No real API keys or secrets are committed.
- TypeScript build passes.

## Notes

If a capability is not reliably supported, mark it as unsupported instead of guessing.
