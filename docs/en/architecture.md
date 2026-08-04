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
- `@adaptive-router/control-plane`: optional, self-hosted team control plane
  (MVP-3) — organizations/projects, auth, Postgres persistence, and a
  project-scoped multi-tenant dashboard. **The only package permitted to declare
  cloud dependencies.**

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

## Team control plane (MVP-3, optional)

Everything above runs locally with no server. The control plane is an **opt-in
layer on top** — deploy it when a team needs one shared, project-scoped view.

```text
Agent app + SDK
-> createIngestReporter({ url, token })        [opt-in; omit it and nothing is sent]
-> POST /ingest/traces  (Authorization: Bearer <project token>)
-> control plane resolves project_id from the token hash   [never from the body]
-> INSERT into Postgres (router_traces, idempotent)
-> createPgDashboardDataSource(sql, projectId)
-> the same 12 /api/* dashboard endpoints, now project-scoped
```

Two design choices carry most of the weight:

- **Reuse over reimplementation.** The control plane wraps the dashboard's
  existing `DashboardDataSource` abstraction, so the dashboard's API surface
  becomes multi-tenant without a single change to dashboard logic.
- **Isolation by construction, not by check.** `createPgDashboardDataSource`
  closes over `projectId` at construction time, so every query it can issue is
  already parameterized with `WHERE project_id = $1`. There is no code path that
  could read another project's rows — the guarantee is structural, not a
  permission test someone could forget to write.

Tenancy is two-level: **Organization → Project**. A project is the unit of
isolation and owns its own traces and ingest tokens (one per customer,
environment, or app). Auth is Better-Auth (email + password, optional GitHub
OAuth, closeable registration).

Persistence is `postgres.js` with hand-written SQL migrations and a version
table — no ORM. One exception: Better-Auth is given its own node-postgres
`pg.Pool`, because its Kysely adapter detects Postgres via `"connect" in db` and
requires that interface. Every query the application itself issues still goes
through `postgres.js`.

## Quality boundary

The router does not judge answer quality in real time during routing. At routing
time, "quality" means capability fit, configured tier, and health/success
signals. Answer-quality judgment happens **offline** in the MVP-2 eval harness,
via configured metrics or a pluggable LLM/human judge.

## Design invariants

- **Zero-dependency core SDK** — the SDK ships only compiled output and declares
  no runtime dependencies.
- **Machine-enforced dependency boundary** — cloud building blocks (Postgres,
  OAuth) may exist *only* in `@adaptive-router/control-plane`. `pnpm check:deps`
  runs in CI and fails the build if such a dependency ever appears in the SDK,
  dashboard, or CLI.
- **Byte-for-byte routing compatibility** — `BUILTIN_WEIGHTS` is unchanged across
  MVP-1 → MVP-3, so routing decisions remain stable.
- **Honest degradation** — optional backends (embeddings, SQLite, exporters,
  trace ingest) never throw when absent; they downgrade and record an
  explanatory note. An unconfigured ingest reporter is a true no-op, not a
  silent failed request.
