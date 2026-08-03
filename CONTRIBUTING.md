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
- Scope stays locked per milestone: no model marketplace, no real-time
  answer-quality judgment, no billing. Team collaboration shipped in MVP-3, but
  full RBAC, audit logs, and budgets are deferred — see [ROADMAP.md](ROADMAP.md).
- The core SDK is zero-dependency, permanently. Cloud building blocks live only
  in `@adaptive-router/control-plane`; `pnpm check:deps` enforces it.

## PR title format

```
<type>(<scope>): <subject>
```

| Part | Values |
|---|---|
| `type` | `feat` `fix` `docs` `refactor` `test` `chore` `ci` `perf` |
| `scope` *(optional)* | `sdk` `dashboard` `cli` `control-plane` `storage` `docs` `ci` `repo` |
| `subject` | imperative, lower-case, no trailing period, ≤ ~72 chars |

Examples:

```
feat(sdk): add Gemini provider adapter
fix(cli): redact secrets in `inspect` output
docs: clarify dashboard() stub behavior
```

A `!` after the type/scope marks a breaking change: `feat(sdk)!: change route() return shape`.

## Local checks

Use a recent Node (the project targets Node 20+; CI runs on 22) and **pnpm 9** —
this is a pnpm workspace, so `npm install` will not create the cross-package
links and workspace imports will fail to resolve. From the repo root:

```bash
pnpm install --frozen-lockfile   # NOT npm install

pnpm lint                        # eslint
pnpm typecheck                   # tsc --noEmit, all package src
pnpm check:deps                  # dependency-boundary assertion
pnpm -r build                    # sdk -> dashboard -> cli -> control-plane
pnpm -r test                     # all package tests
```

> CI runs this same sequence plus CLI/dashboard smoke tests on every PR, and a
> separate `control-plane-integration` job that applies migrations and
> round-trips trace ingest against a real `postgres:17` service container. Green
> CI is required.
>
> Note that `pnpm -r test` only covers the control plane's **DB-less** unit
> tests. If you touch the control plane's data or auth layer, a fully green local
> run is *not* proof the database path works — that's what the CI Postgres job is
> for. Run it locally with Docker if you can; otherwise say plainly that the DB
> path is unverified.

## Project structure

```text
packages/sdk            Core SDK, providers, policy, storage, telemetry
packages/dashboard      Local read-only dashboard
packages/cli            CLI (init / doctor / inspect / export)
packages/control-plane  Optional self-hosted team control plane (MVP-3)
examples/basic-agent    Minimal usage example
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
