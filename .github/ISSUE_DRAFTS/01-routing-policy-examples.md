# Add examples for routing policies

Labels: `good first issue`, `docs`, `examples`

## Summary

Add small examples that show how to configure and use common routing policies.

## What to add

Create examples for:

- quality-first routing
- latency-sensitive routing
- cost guard routing
- fallback behavior with `createStaticProvider()`

## Suggested location

```text
examples/routing-policies/
```

## Acceptance criteria

- Each example is runnable or clearly documented.
- Each example includes a short explanation of why a model was selected.
- No real API keys or secrets are committed.
- README or Quickstart links to the examples.

## Notes

Keep the examples small. The goal is to teach routing behavior, not build a full agent framework.
