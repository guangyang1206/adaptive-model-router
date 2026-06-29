# Contributing

Thanks for your interest in Adaptive Model Router! This guide is intentionally short. The
goal is a clean, reviewable history and a friendly process — not bureaucracy.

## TL;DR

1. One PR = **one logical change**. Split unrelated work into separate PRs.
2. Your **PR title must be a [Conventional Commit](https://www.conventionalcommits.org/)** —
   it becomes the commit message on `main` (we squash-merge). CI checks this.
3. Run the local checks before pushing: **lint → typecheck → build → test**.
4. Open a PR against `main`. A maintainer reviews and squash-merges.

You do **not** need to keep your branch tidy. Commit as messily as you like (`wip`, `oops`,
`fix typo`) — every PR is **squash-merged**, so only the **PR title** lands on `main`.

## Principles

- SDK-first, not gateway-first.
- Quality and stability before cost optimization.
- Open-source and self-hosted models are first-class citizens.
- Routing decisions must be explainable.
- MVP-0 stays small: no hosted SaaS, no model marketplace, no real-time answer-quality judgment.

## PR title format

```
<type>(<scope>): <subject>
```

| Part | Values |
|---|---|
| `type` | `feat` `fix` `docs` `refactor` `test` `chore` `ci` `perf` |
| `scope` *(optional)* | `sdk` `dashboard` `cli` `storage` `docs` `ci` `repo` |
| `subject` | imperative, lower-case, no trailing period, ≤ ~72 chars |

Examples:

```
feat(sdk): add Gemini provider adapter
fix(cli): redact secrets in `inspect` output
docs: clarify dashboard() stub behavior
```

A `!` after the type/scope marks a breaking change: `feat(sdk)!: change route() return shape`.

## Local checks

Use a recent Node (the project targets Node 20+; CI runs on 22). From the repo root:

```bash
npm install --no-save typescript@^5.6.0 eslint@^9.13.0 typescript-eslint@^8.10.0 @eslint/js@^9.13.0

npx eslint "packages/**/*.ts"                  # lint
npx tsc -p tsconfig.typecheck.json             # typecheck (no emit)
npx tsc -p packages/sdk/tsconfig.json \
  && npx tsc -p packages/dashboard/tsconfig.json \
  && npx tsc -p packages/cli/tsconfig.json     # build
node --test packages/sdk/test/*.mjs            # tests
```

> Note: this repo uses npm + the TypeScript compiler directly, **not** `pnpm` (Corepack
> signature issues in CI). CI runs the same sequence plus CLI/dashboard smoke tests on
> every PR. Green CI is required.

## Project structure

```text
packages/sdk        Core SDK, providers, policy, storage, telemetry
packages/dashboard  Local read-only dashboard
packages/cli        CLI (init / doctor / inspect / export)
examples/basic-agent Minimal usage example
```

## Good first contribution areas

- Provider adapter mapping
- Capability registry entries
- Dashboard empty/loading/error states
- Documentation examples
- Tests for routing and fallback behavior

## Scope & roadmap

The project follows a locked spec. Before building a new feature, check `ROADMAP.md` and
`WORKFLOW.md` (§5 "Current target scope"). If your idea isn't in scope yet, **open an issue
first** so we can agree on it before you write code — it saves everyone effort.

## Pull request expectations

- Keep API names and error codes in English.
- Add or update tests for behavior changes.
- Do not add new providers to P0 without a clear capability profile.
- Do not introduce hosted/cloud assumptions into the local dashboard.
- Clearly mark estimated token/cost values as estimated.

## What happens after you open a PR

- CI validates your PR title and runs the full quality gate.
- A maintainer reviews for correctness, scope-vs-spec, tests, and security (no secrets).
- On approval it's **squash-merged** into `main` as a single Conventional Commit, and your
  branch is auto-deleted. That's it. 🎉

## Code of Conduct

This project follows our [Code of Conduct](./CODE_OF_CONDUCT.md). By participating you agree
to uphold it.
