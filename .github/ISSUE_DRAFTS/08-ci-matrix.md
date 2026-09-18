# Add a Node version CI matrix

Labels: `help wanted`, `ci`

## Summary

CI runs on a single Node version. `package.json` and the README advertise
Node 20+, so the supported floor is currently untested.

## Current CI

`.github/workflows/ci.yml` has two jobs:

- `build-test` — pins `node-version: 22` (line 44) and runs frozen-lockfile
  install, `pnpm check:deps` (dependency boundary), lint, typecheck,
  `pnpm -r build`, then `node --test` per package (sdk, dashboard, cli,
  control-plane DB-less), plus a CLI smoke test and a dashboard smoke test.
- `control-plane-integration` — also pins `node-version: 22` (line 153) and
  round-trips ingest against a `postgres:17` service container.

## Why this is now low-risk

The blocker that deferred this has already been cleared. The test invocation was
deliberately written as a bare `node --test` because that is the one form that
works on both Node 20 and Node 22 — see the comment at
`.github/workflows/ci.yml:78-82` (the directory-path form `node --test test/` is
rejected as a module on Node 22). The test step should already be portable; this
issue is about proving it rather than assuming it.

## Scope

- Add `strategy.matrix.node: [20, 22]` to `build-test`.
- Decide what `control-plane-integration` does. Keeping it on a single version
  is a fine answer — say so in a comment rather than leaving it implicit.
- If Node 20 fails on something real, report it. A documented `engines` bump is
  an acceptable outcome; quietly dropping 20 from the README is not.

## Acceptance criteria

- `build-test` runs on Node 20 and 22.
- CI stays reliable — no reintroduction of the earlier pnpm/Corepack failure
  path.
- Any version-specific skip is explicit and commented, not silent.

## Non-goals

- Do not add Windows or macOS runners. Reliability over matrix size.
- Do not add Node 24+ before it is in the supported range.
