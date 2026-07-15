# Architecture

Adaptive Model Router is SDK-first: the routing brain is a zero-dependency
TypeScript SDK, and the dashboard and CLI are optional consumers of it.

## Packages

- `@adaptive-router/sdk`: runtime SDK — provider adapters, framework adapters,
  policy, fallback, storage, telemetry, and the MVP-2 evaluation / cache /
  learning modules. **Zero runtime dependencies.**
- `@adaptive-router/dashboard`: local read-only dashboard (Requests + Models,
  filtering, model comparison)
- `@adaptive-router/cli`: optional developer helper commands
  (`init` / `doctor` / `inspect` / `export` / `eval` / `eval:baseline`)

## Routing flow

```text
Normalize request
-> Filter by capability
-> Apply quality threshold
-> Rank by health, latency, and cost
-> (optional) Semantic cache lookup — honest degrade if no embedder
-> Invoke selected provider
-> Fallback on retryable non-streaming failures
-> Record router trace
```

## Evaluation & optimization loop (MVP-2)

```text
Eval set (user-defined cases)
-> runEval (offline, cost-guarded — no real network calls)
-> compare / gate against baseline
-> proposeWeights (bounded, regression-gated)
-> adopted: false  ── human reviews ──> registry.adopt(version)  [opt-in only]
```

Learning is human-in-the-loop by design: the router never adopts new weights on
its own, and the `builtin` weights version is an immutable registry root.

## Quality boundary

The router does not judge answer quality in real time during routing. At routing
time, "quality" means capability fit, configured tier, and health/success
signals. Answer-quality judgment happens **offline** in the MVP-2 eval harness,
via configured metrics or a pluggable LLM/human judge.

## Design invariants

- **Zero-dependency core SDK** — the SDK ships only compiled output and declares
  no runtime dependencies.
- **Byte-for-byte routing compatibility** — `BUILTIN_WEIGHTS` is unchanged across
  MVP-1 → MVP-2, so routing decisions remain stable.
- **Honest degradation** — optional backends (embeddings, SQLite, exporters)
  never throw when absent; they downgrade and record an explanatory note.
