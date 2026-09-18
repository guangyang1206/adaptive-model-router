# Changelog

All notable changes to this project are documented here. This project follows
[Keep a Changelog](https://keepachangelog.com/) conventions.

## 0.1.0 — 2026-09-18

First published release. All four packages are on npm and installable the normal
way; before this, the documented `pnpm add @adaptive-router/sdk` returned a 404
and the only path was a source build.

Contents are the accumulated MVP-0 → MVP-3 work described below — this release
makes them distributable, it does not add features.

### Published

- `@adaptive-router/sdk` — routing core, zero runtime dependencies
- `@adaptive-router/cli` — `init` / `doctor` / `inspect` / `export` / `eval`
- `@adaptive-router/dashboard` — local read-only dashboard
- `@adaptive-router/control-plane` — self-hosted team control plane

Versions are **fixed across the workspace**: all four move together, so
`sdk@0.1.0` pairs with `cli@0.1.0`. Compatibility needs no lookup table.

### Fixed during release prep

Found by packing each tarball and installing it into a clean project — none of
these are visible from reading manifests:

- control-plane declared `bin: adaptive-control-plane` but `dist/server.js` had
  no shebang, so running it fell through to the shell:
  `syntax error near unexpected token '('`
- `deploy/.env.example` was missing from the tarball — npm excludes dotfiles
  unless listed explicitly in `files` — while both quickstarts tell users to
  `cp deploy/.env.example .env`
- `packages/sdk/dist/index.test.js` was a stale artifact from a test deleted in
  June. `tsc` only overwrites what it emits, so it survived every rebuild and
  shipped. It also ran under `node --test`, inflating the SDK test count
  (110 → 107 is that correction, not a regression). Each package now prunes
  emitted files whose source is gone before building.
- `LICENSE` was a 17-line notice rather than the full Apache-2.0 text

### Verified against the registry

Publish output is not proof. After publishing: `npm install` in a clean project
reports `added 1 package` for the SDK (the zero-dependency claim, measured), the
README example runs against the installed package, `workspace:*` resolved to
`0.1.0` in cli's manifest, and both `bin` entries execute.

## MVP-3 — Team Control Plane

Go from "one developer's local loop" to "a team sharing one routing view",
without compromising the local-first, zero-dependency core. The control plane is
a **separate, optional, self-hosted package** — if you don't deploy it, nothing
about the SDK changes and no extra network call is ever made.

### Added

- **`@adaptive-router/control-plane`** — new package (4th in the monorepo): a
  self-hostable multi-user team control plane. Ships a `adaptive-control-plane`
  bin plus `start` / `migrate` scripts.
- **Organization → Project tenancy** — two-level model. Each project owns its own
  routing traces and ingest tokens (one per customer, environment, or app).
- **Authentication** — Better-Auth with email + password, optional GitHub OAuth
  (enabled only when both client id and secret are present), and closeable
  registration via `REGISTRATION_OPEN` for private deployments.
- **Structural project isolation** — `createPgDashboardDataSource(sql, projectId)`
  captures the project id at construction, so every query is forced through
  `WHERE project_id = $1`. Cross-project reads aren't merely checked against —
  they're structurally impossible. Ingest derives `project_id` from the token
  hash server-side and never trusts the request body.
- **Multi-tenant dashboard for free** — wraps the existing `DashboardDataSource`
  abstraction, so all 12 `/api/*` endpoints become project-scoped with no
  dashboard code changes. Pages: login, onboarding, requests, models,
  settings › members, settings › API keys, health.
- **Postgres persistence** — `postgres.js` driver, no ORM, hand-written SQL
  migrations with a version table. Migrations apply on boot (or via `migrate`).
- **SDK trace ingest (opt-in)** — `createIngestReporter({ url, token })` exported
  from `@adaptive-router/sdk`, built on the runtime's global `fetch`. Adds **zero**
  dependencies, swallows errors by default, and is an honest no-op when
  unconfigured. `createRouter` accepts it via an optional `reporter` field.
- **Deployment templates** — docker-compose, Dockerfile, `.env.example`, and a
  Render blueprint under `packages/control-plane/deploy/`.
- **Fail-fast configuration** — a missing required env var (`DATABASE_URL`,
  `BETTER_AUTH_SECRET`, `BETTER_AUTH_URL`) throws before the port is bound, with
  an error naming the exact variable.
- **Real-Postgres CI** — new `control-plane-integration` job runs migrations and
  an ingest round-trip against a `postgres:17` service container, asserting the
  server-derived `project_id`, cross-project no-leak, and idempotent ingest.

### Changed

- **Dependency boundary allowlist** extended so the control plane may declare
  `better-auth`, `postgres`, and `pg`. The SDK's `dependencies: {}` assertion is
  untouched — `pnpm check:deps` still fails the build if any cloud dependency
  leaks into the SDK, dashboard, or CLI.
- **Dashboard** exports a logic-preserving `dispatchApiRequest` so the control
  plane can reuse the API surface without duplicating it.

### Notes

- `BUILTIN_WEIGHTS` unchanged (byte-for-byte MVP-1 routing compatibility holds
  across MVP-2 and MVP-3).
- **Better-Auth requires a node-postgres `Pool`, not a bare `postgres.js` client.**
  Its Kysely adapter detects Postgres via `"connect" in db` and wraps it as
  `PostgresDialect({ pool: db })`; a `postgres.js` `Sql` has no `.connect`, so it
  falls through detection and throws `NOT_TAGGED_CALL` on the first auth query.
  Better-Auth therefore gets a dedicated `pg.Pool` while every one of our own
  queries still runs through `postgres.js`. Both pools share `DATABASE_URL` and
  close together. This class of adapter-wiring bug is invisible to DB-less unit
  tests — only the real-Postgres CI job catches it.
- RBAC is partial by design: `owner` / `member` are enforced (non-owner writes
  get a 403); `admin` / `viewer` are reserved and render disabled. Audit logs,
  team budgets, and organization-level provider keys are deferred to MVP-4+.

## MVP-2 — Evaluation and Optimization

Move from "routes correctly" to "routes *well*", with feedback loops. All new
capabilities preserve the zero-dependency core and byte-for-byte MVP-1 routing
compatibility; every optional feature degrades honestly when its backend is absent.

### Added

- **Eval harness** — offline, cost-guarded runner that scores routing decisions
  against user-defined case sets. Never issues real network calls; unknown-cost
  cases surface a `notes` explanation instead of guessing.
- **User-defined eval sets** — JSON case files plus baseline snapshots for
  regression tracking; an absent baseline passes with an explanatory note rather
  than failing the run.
- **LLM judge / human feedback interface** — pluggable judge hook, human-in-the-loop
  by design.
- **Route outcome learning** — bounded weight *suggestions* from observed outcomes.
  `adopted: false` is hard-coded; weight bounds are clamped; a regression gate blocks
  proposals that would worsen the baseline. Weights are never adopted silently.
- **Semantic cache** — embedding-based lookup with a fallback ladder. When no
  embedder is wired the cache never throws — it downgrades and records why.
- **CLI** — `eval` and `eval:baseline` commands; `--help` / `-h` / `--version` / `-v`
  flags.
- **Dashboard** — eval results surfaced through the existing `{code, data, message}`
  API envelope.

### Notes

- `BUILTIN_WEIGHTS` unchanged from MVP-1 (byte-for-byte routing compatibility).
- SQLite store deliberately omits the `cache_lookup` / `weights_change` event
  streams (JSONL retains the full log) — tracked as a known P2 follow-up.

## MVP-1 — Framework and Provider Expansion

Make the router usable from the ecosystems contributors already live in, and
broaden provider coverage.

### Added

- **Provider adapters** — Gemini (native `generateContent`, header auth, tool
  mapping), Qwen (DashScope OpenAI-compatible mode), vLLM (self-hosted,
  OpenAI-compatible; optional auth, zero-cost profile).
- **Framework adapters** — dependency-free `createLangChainModel`
  (LangChain / LangGraph) and `createVercelModel` (Vercel AI SDK `LanguageModelV1`).
- **Dashboard** — server-side request filtering and model comparison
  (`/api/models/compare`).

### Changed

- Tool-calling capability aligned with implementation: Gemini maps tools to
  `functionDeclarations`; Anthropic no longer falsely advertises tool-calling
  (honest degradation until its tool schema is mapped).

### Quality hardening

- eslint flat config + CI lint step; `tsc --noEmit` typecheck gate.
- `router.dashboard()` returns an honest handle (no phantom server).
- Real CLI config secret redaction.
- Token/cost estimation measures content length (not stringified length).

## 0.0.0

Initial repository scaffold.

- Added SDK-first monorepo structure.
- Added README, roadmap, contributing, security, and code of conduct documents.
- Added TypeScript SDK scaffold with routing types and static provider helper.
- Added local dashboard package scaffold.
- Added bilingual Quickstart and API Reference documents.
- Added basic agent example.
