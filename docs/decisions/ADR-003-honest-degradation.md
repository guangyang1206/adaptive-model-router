# ADR-003 — Optional capabilities degrade and record a note; they never throw

- Status: Accepted (2026-06-27); extended to embeddings 2026-07-14 and to trace ingest 2026-07-17
- Deciders: maintainers
- Source commits: `6cb1432` (SQLite → JSONL fallback), `185c710` (embedding ladder), `9f73d5f` (ingest reporter)

## Context

The router sits on the critical path of someone's model call. Several of its
capabilities are genuinely optional and genuinely absent in normal
environments:

- `node:sqlite` does not exist on Node 20 (it landed later, and CI runs
  both 20 and 22)
- `@huggingface/transformers` is an optional peer that
  `auto-install-peers=false` deliberately does not install (ADR-001)
- a self-hosted control plane can be down, slow, or simply not configured

The default behaviour of a missing backend is to throw. For a library on the
call path, that converts an observability or caching gap into a failed model
call — the router breaks the thing it exists to make more reliable.

The opposite failure is just as bad. Silent degradation means a user believes
they have semantic caching or durable traces when they have neither, and the
first evidence is a support conversation about missing data.

## Decision

Missing optional backends downgrade to a working path and record an
explanatory note that reaches the caller. Never throw, never degrade
silently.

Concretely:

- **Embeddings** — `resolveEmbeddingProvider`
  (`packages/sdk/src/embedding.ts:21`) walks a fixed ladder
  `provider > openai > local ONNX > hashing`. Each rung is wrapped in
  `try`/`catch` and pushes a note on failure
  (`packages/sdk/src/embedding.ts:34`), and the hashing rung always succeeds, so the function
  always returns a usable provider. The header comment states the contract
  explicitly (`packages/sdk/src/embedding.ts:16-19`).
- **SQLite store** — `createSQLiteTraceStore`
  (`packages/sdk/src/storage.ts:249`) falls back to the JSONL store when
  `node:sqlite` is unavailable *and* `fallbackPath` was supplied. With no
  `fallbackPath` it throws, and the message carries the underlying cause
  (`packages/sdk/src/storage.ts:257`). Degradation is opt-in, not imposed.
- **Trace ingest** — `createIngestReporter`
  (`packages/sdk/src/reporter.ts:36`) swallows transport errors by default
  and routes them to `onError` when supplied (`packages/sdk/src/reporter.ts:49-52`). A router
  constructed without a `reporter` never executes any of this code
  (`packages/sdk/src/reporter.ts:3-5`), so "unconfigured" is a true no-op rather than a
  failing request.
- **Provider capabilities** — an adapter advertises only what it actually
  implements. Anthropic stopped advertising tool-calling rather than
  advertising it and failing at call time (`e88922e`).
- **Cost integrity under degradation** — the Vercel adapter reports `NaN`
  ("unknown") rather than `0` on a failed route, so a failed call cannot be
  summed into a cost report as genuinely free (`11e0a37`, `toVercelUsage` at
  `packages/sdk/src/adapters.ts:293`).
- **Absent data stays absent** — `rowToUsage`
  (`packages/sdk/src/storage.ts:427`) returns `undefined` for legacy rows with
  no token columns instead of fabricating zeros.

The invariant is stated for readers in `docs/en/architecture.md:100-103`.

## Consequences

Positive:

- A missing optional backend cannot break a model call. That is the property
  that makes the SDK safe to embed.
- Degradation is diagnosable: notes surface into `RouterTrace`, so a user who
  wonders why the semantic cache is not hitting can see
  `embedding: @huggingface/transformers not installed, skipping local`
  instead of guessing.
- The SDK runs identically on Node 20 and Node 22 without version-gated code
  paths in user code.

Negative:

- A misconfiguration can look like a success. A user who intended to use
  ONNX embeddings but never installed the peer gets the hashing provider,
  which is a real embedder with much weaker semantics. The note is the only
  signal, and a caller who does not read `notes` will not notice.
- Every optional path needs a working fallback implementation. The FNV-1a
  hashing embedder (`createHashingEmbeddingProvider`,
  `packages/sdk/src/embedding.ts:58`, hash at `:138`) exists purely to make
  the ladder terminate, and it is code that must be maintained.
- "Never throw" makes failures asynchronous and deferred, which is harder to
  test than a thrown error. It requires tests that assert on note content —
  a weaker, stringier contract than an exception type.
- The discipline is a convention, not a machine-checked invariant. Unlike
  ADR-001 and ADR-002 there is no gate; a new optional backend that throws
  will pass CI.

## Alternatives considered

- **Throw on a missing optional backend.** Rejected: it puts a caller's model
  call at the mercy of their observability configuration.
- **Degrade silently with no note.** Rejected: indistinguishable from working
  correctly, which is the worse of the two failure modes.
- **Require explicit opt-in for every degradation (strict mode by default).**
  Partially adopted — that is exactly what `fallbackPath` does for the SQLite
  store. Not generalised, because for embeddings and ingest the safe default
  is the degraded one.

## Related ADRs

- ADR-001 — the dynamic-import shim that makes absence the normal case
- ADR-002 — degradation notes must be visible so a routing change is never
  silent
