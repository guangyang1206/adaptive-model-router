# Roadmap

> Status legend: ✅ done · 🔵 in progress · ⬜ planned
> Last updated: 2026-08-03 · Current focus: **MVP-4 — governance and scale** (MVP-3 shipped)

This roadmap reflects *actual* progress, not just intent. For the day-to-day
development workflow and quality gates behind each shipped item, see
[WORKFLOW.md](WORKFLOW.md).

---

## MVP-0 — Core Proof ✅

Goal: prove that an embedded TypeScript SDK can route agent requests, record
decisions, and explain them in a local dashboard. **Functionally complete.**

- ✅ TypeScript SDK (SDK-first, not proxy-first)
- ✅ Quality-gated routing (capability → tier → health/success → latency → cost)
- ✅ Provider set: OpenAI, Anthropic, DeepSeek, Ollama
- ✅ Fallback / retry / timeout for non-streaming calls (no mid-stream fallback)
- ✅ SQLite store with JSONL fallback
- ✅ Local read-only dashboard (Requests + Models pages)
- ✅ Bilingual README, Quickstart, API Reference
- ✅ CLI: `init` / `doctor` / `inspect` / `export`

### Quality hardening (post-MVP-0, shipped)

- ✅ eslint flat config + CI lint step
- ✅ `tsc --noEmit` typecheck gate
- ✅ `router.dashboard()` honest handle (no phantom server)
- ✅ Real CLI config secret redaction
- ✅ Token/cost estimation measures content length (not stringified length)
- ✅ **Tool-calling capability aligned with implementation** — Gemini maps tools
  to `functionDeclarations`; Anthropic no longer falsely advertises tool-calling
  (honest degradation until its tool schema is mapped)

---

## MVP-1 — Framework and Provider Expansion ✅

Goal: make the router usable from the ecosystems contributors already live in,
and broaden provider coverage. **Shipped.**

- ✅ Gemini adapter (native `generateContent`, header auth, tool mapping)
- ✅ Qwen adapter (DashScope OpenAI-compatible mode)
- ✅ vLLM support (self-hosted, OpenAI-compatible; optional auth, zero-cost profile)
- ✅ LangChain / LangGraph adapter (dependency-free `createLangChainModel`)
- ✅ Vercel AI SDK adapter (dependency-free `createVercelModel`, `LanguageModelV1`)
- ✅ Dashboard filtering and model comparison (server-side request filter + `/api/models/compare`)
- ⬜ Policy dry-run UI — *deferred to MVP-4+*
- ⬜ Local Proxy / HTTP Bridge — *deferred to MVP-4+*

---

## MVP-2 — Evaluation and Optimization ✅

Goal: move from "routes correctly" to "routes *well*", with feedback loops.
**Shipped** (except the two items noted below, deferred to MVP-4+).

- ✅ Eval harness (offline, cost-guarded — never issues real network calls)
- ✅ User-defined eval sets (JSON case files + baseline snapshots)
- ✅ LLM judge / human feedback interface (pluggable judge hook, human-in-the-loop)
- ✅ Route outcome learning (bounded weight suggestions, `adopted: false` by default, regression-gated)
- ✅ Semantic cache (embedding-based, honest degradation when no embedder wired)
- ⬜ Prompt / context compression — *deferred to MVP-4+*
- ⬜ Helicone / Langfuse exporter — *deferred to MVP-4+*

---

## MVP-3 — Team Control Plane ✅

Goal: a multi-user, multi-project control plane so a team can share one routing
view. **Shipped** as the optional, self-hosted `@adaptive-router/control-plane`
package (the core SDK stays zero-dependency). Enterprise-grade governance items
(audit, budgets, full RBAC, org-level keys) are deferred to MVP-4+.

- ✅ Hosted dashboard — self-hosted, multi-user; reuses the existing
  `DashboardDataSource` abstraction so all 12 `/api/*` endpoints become
  multi-tenant with no dashboard changes
- ✅ Multi-project support — Organization → Project two-level tenancy; each
  project owns its traces and ingest tokens
- ✅ Authentication — Better-Auth: email + password, optional GitHub OAuth,
  closeable registration (`REGISTRATION_OPEN`)
- ✅ Structural project isolation — the PG data source captures `projectId` at
  construction, forcing `WHERE project_id = $1` on every query; ingest derives
  `project_id` from the token hash, never from the request body
- ✅ Postgres persistence — `postgres.js`, no ORM, hand-written SQL migrations
  with a version table (Better-Auth gets its own `pg.Pool`)
- ✅ SDK trace ingest — opt-in `createIngestReporter` using built-in `fetch`;
  zero new SDK dependencies, honest no-op when unconfigured
- ✅ Enterprise deployment templates — docker-compose, Dockerfile, Render blueprint
- ✅ Real-Postgres CI — `control-plane-integration` job applies migrations and
  round-trips ingest against a `postgres:17` service container
- 🔵 RBAC — `owner` / `member` enforced (403 on non-owner writes); `admin` /
  `viewer` reserved and rendered disabled — *full matrix deferred to MVP-4+*
- ⬜ Audit log — *deferred to MVP-4+*
- ⬜ Team budget — *deferred to MVP-4+*
- ⬜ Organization-level provider keys — *deferred to MVP-4+*
- ⬜ Multi-environment separation within a project — *deferred to MVP-4+; today,
  use one project per environment*

---

## MVP-4 — Governance and Scale ⬜ (Next)

Goal: turn the shipped control plane into something an organization can govern.
Scope is **not yet locked** — the items below are candidates carried over from
earlier milestones, not commitments.

- ⬜ Full RBAC matrix (`admin` / `viewer` activation)
- ⬜ Audit log
- ⬜ Team budgets and cost attribution
- ⬜ Organization-level provider keys
- ⬜ Policy dry-run UI — *carried from MVP-1*
- ⬜ Local Proxy / HTTP Bridge — *carried from MVP-1*
- ⬜ Prompt / context compression — *carried from MVP-2*
- ⬜ Helicone / Langfuse exporter — *carried from MVP-2*

---

## Distribution — shipped ✅

All four packages are live on npm at `0.1.0`, so `pnpm add @adaptive-router/sdk`
now works. This was the single biggest barrier to adoption.

- ✅ Publish metadata on all four packages — version `0.1.0` **fixed across the
  workspace**, repository/homepage/bugs, keywords, engines,
  `publishConfig.access: public`
- ✅ Verify each tarball ships what's needed and nothing more — checked by packing
  and installing into a clean project, not by reading manifests. Caught three real
  defects: a missing shebang on control-plane's `bin`, `deploy/.env.example`
  excluded by npm's dotfile rule, and a stale `dist/index.test.js` orphan that was
  both shipping and inflating the test count
- ✅ `RELEASING.md` — scope setup, auth, pre-publish gates, tarball verification,
  publish order, version policy, bad-release recovery
- ✅ npm scope `@adaptive-router` created
- ✅ Authenticate the publishing machine — a **granular access token** scoped to
  `@adaptive-router` with read/write. Classic tokens are no longer accepted for
  direct publishing on a 2FA account (`EOTP`), which is why the first attempt
  failed
- ✅ Publish `sdk` → `dashboard` → `cli` → `control-plane` from `main`
- ✅ Verify from the registry, not from publish output — `npm install` in a clean
  project reports `added 1 package` for the SDK (zero-dependency proof), the
  README example runs, `workspace:*` resolved to `0.1.0` in cli's manifest, and
  both `bin` entries execute
- ✅ Collapse the Quickstart install section back to one line
- ⬜ Tag `v0.1.0` + CHANGELOG entry
- ⬜ Add a CI release workflow (tag → build → publish with provenance)

Until the packages actually resolve, every install instruction must say plainly
that they are unreleased. Docs that imply otherwise are worse than no docs.

---

## How priorities are decided

The scope is **locked per milestone** — anything outside the current milestone's
list requires a spec change first (see WORKFLOW.md §5). The automated 6-hour dev
loop only picks the single highest-value *in-scope* item each cycle, behind a
5-stage quality gate (lint → typecheck → build → test → smoke), and opens a PR
for human review. It never expands scope on its own and never merges to `main`.
