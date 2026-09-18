# Add examples for routing policies

Labels: `good first issue`, `docs`, `examples`

## Summary

Add small examples that show how to configure and use common routing policies.

`examples/` currently contains one example, `basic-agent`. The routing policy
knobs (`quality`, `stability`, `latencyMs`, `maxCostUsd`) are documented in the
Quickstart but there is nothing runnable that shows how changing one of them
changes the decision.

## What to add

Create examples for:

- quality-first routing
- latency-sensitive routing
- cost guard routing
- fallback behavior with `createStaticProvider()`

`createStaticProvider(id, models, { failTimes })` is exported from the SDK
(`packages/sdk/src/index.ts:295`) and needs no API key, so every example here
can be genuinely runnable rather than illustrative. `failTimes` makes the
fallback path reproducible without breaking a real provider.

## Suggested location

```text
examples/routing-policies/
```

## Acceptance criteria

- Each example runs with no API key and no network access.
- Each example prints the decision and its reasoning — read `routerTrace.reason`
  and the per-candidate `reasons`, so the output shows which models were
  rejected and why, not just the winner.
- No real API keys or secrets are committed.
- README or Quickstart links to the examples.

## Notes

Keep the examples small. The goal is to teach routing behavior, not build a full agent framework.
