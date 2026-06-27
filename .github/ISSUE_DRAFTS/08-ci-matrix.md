# Add CI matrix

Labels: `help wanted`, `ci`

## Summary

Expand CI to test multiple Node versions once the package manager strategy is stable.

## Current CI

CI currently uses Node 22 and directly builds SDK, Dashboard, and CLI with TypeScript. It also runs SDK tests, CLI smoke test, and Dashboard smoke test.

## Scope

Add a matrix for stable Node versions, for example:

- Node 20
- Node 22

## Acceptance criteria

- CI remains reliable without reintroducing the previous pnpm/Corepack failure path.
- SDK/dashboard/cli builds run on each Node version.
- SDK tests and CLI/dashboard smoke tests run on each Node version or an explicitly documented subset.

## Notes

Keep the CI simple. Reliability is more important than a large matrix.
