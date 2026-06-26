# Architecture

Adaptive Model Router MVP-0 is SDK-first.

## Packages

- `@adaptive-router/sdk`: runtime SDK, provider adapters, policy, fallback, storage, telemetry
- `@adaptive-router/dashboard`: local read-only dashboard
- `@adaptive-router/cli`: optional developer helper commands

## Routing flow

```text
Normalize request
-> Filter by capability
-> Apply quality threshold
-> Rank by health, latency, and cost
-> Invoke selected provider
-> Fallback on retryable non-streaming failures
-> Record router trace
```

## Quality boundary

MVP-0 does not judge answer quality in real time. Quality means capability fit, configured tier, and health/success signals.
