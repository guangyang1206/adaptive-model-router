# ADR-001 — The core SDK has zero runtime dependencies, and a script enforces it

- Status: Accepted (2026-06-26); machine enforcement added 2026-07-17
- Deciders: maintainers
- Source commits: `1f65433` (initial `dependencies: {}`), `185c710` (`.npmrc` peer policy), `9f73d5f` (`check:deps` in CI)

## Context

The SDK is embedded directly into someone else's agent application. Every
runtime dependency it declares becomes a transitive dependency of that
application: more install weight, more version-conflict surface, more supply
chain to audit. For a routing library whose whole job is a handful of `fetch`
calls plus scoring arithmetic, that cost buys nothing.

Two capabilities pull against this. Local ONNX embeddings need
`@huggingface/transformers` (which drags in `onnxruntime` and `sharp`), and
the SQLite trace store needs `node:sqlite`. A plain top-level
`import` of either would either add a real dependency or make bundlers fail
to resolve a module that may legitimately be absent.

MVP-3 then added Postgres and Better-Auth to the workspace. Once cloud
building blocks exist in the repo at all, "the SDK is zero-dependency" stops
being self-evident and becomes something a single careless `pnpm add` can
silently revoke.

## Decision

`packages/sdk/package.json` declares `"dependencies": {}` permanently. The
only additive change allowed is to `peerDependencies` with
`peerDependenciesMeta.<name>.optional: true`.

Optional capabilities load through a dynamic-import shim built on the
`Function` constructor, so the specifier is opaque to static analysis and no
bundler can hoist it into the core:

- `packages/sdk/src/embedding.ts:115` —
  `Function("return import('@huggingface/transformers')")`
- `packages/sdk/src/storage.ts:251` —
  `Function("return import('node:sqlite')")`

`.npmrc` sets `auto-install-peers=false`, so the optional peer is never
resolved into the lockfile as an SDK dependency.

The boundary is asserted by a script, not by review discipline.
`scripts/check-dependency-boundary.mjs` runs as `pnpm check:deps` and exits
non-zero on any violation:

- line 27-28 — SDK `dependencies` must be the empty set
- line 31-44 — `dashboard` and `cli` may depend only on
  `@adaptive-router/sdk`, pinned to `workspace:*`
- line 47-55 — `control-plane` is the only package allowed cloud
  dependencies, from the fixed allowlist
  `@adaptive-router/sdk, @adaptive-router/dashboard, better-auth, postgres, pg`

`.github/workflows/ci.yml` runs `pnpm check:deps` before build, so a breach
fails fast rather than after a full matrix.

## Consequences

Positive:

- `npm install @adaptive-router/sdk` reports `added 1 package`. This was
  measured against the published tarball, not asserted (commit `06f9148`).
- The zero-dependency claim in `README.md` and `docs/en/architecture.md` is
  backed by a gate that runs on every PR, so it cannot quietly decay.
- Cloud building blocks are quarantined in one package, which keeps the local
  single-developer loop installable without Postgres or an auth provider.

Negative:

- The `Function("return import(...)")` shim is genuinely obscure. It reads
  like a hack, and a contributor who "cleans it up" into a normal dynamic
  `import()` will reintroduce static resolvability without any test failing.
  The comments at both call sites exist for exactly this reason.
- Types for the optional peers must be hand-declared or inlined at the call
  site, because the packages are not installed. See the inline structural
  types in `packages/sdk/src/embedding.ts:115-117` and `packages/sdk/src/storage.ts:251`.
- Anything the SDK needs must be either a Node built-in or written by hand.
  `createIngestReporter` uses the global `fetch` rather than an HTTP client
  (`packages/sdk/src/reporter.ts:1-6`), and the semantic cache ships an FNV-1a
  hashing fallback instead of using a hashing library.
- `auto-install-peers=false` applies to the whole workspace, so any future
  genuine peer dependency in any package will also need explicit installation.

## Alternatives considered

- **Declare the embeddings and SQLite packages as normal dependencies.**
  Rejected: it makes every consumer pay for `onnxruntime` and `sharp`,
  including the majority who never enable the semantic cache.
- **Rely on code review to keep the SDK clean.** Rejected. The boundary is an
  invariant that must survive contributors who have not read this file; a
  human gate fails silently and a script does not.
- **Move optional capabilities into separate `@adaptive-router/*` packages.**
  Reasonable, and still open. Rejected for now because it multiplies the
  publish surface for two capabilities, and the shim already delivers the
  guarantee. Revisit if a third optional backend appears.

## Related ADRs

- ADR-003 — optional capabilities degrade instead of throwing
- ADR-004 — why Postgres lives only in the control plane
- ADR-009 — why the boundary check requires a pnpm workspace install
