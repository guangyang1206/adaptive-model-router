# Roadmap

> Status legend: ✅ done · 🔵 in progress · ⬜ planned
> Last updated: 2026-07-14 · Current focus: **MVP-3 — team / enterprise / SaaS control plane** (MVP-2 shipped)

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
- ⬜ Policy dry-run UI — *deferred to MVP-3+*
- ⬜ Local Proxy / HTTP Bridge — *deferred to MVP-3+*

---

## MVP-2 — Evaluation and Optimization ✅

Goal: move from "routes correctly" to "routes *well*", with feedback loops.
**Shipped** (except the two items noted below, deferred to MVP-3+).

- ✅ Eval harness (offline, cost-guarded — never issues real network calls)
- ✅ User-defined eval sets (JSON case files + baseline snapshots)
- ✅ LLM judge / human feedback interface (pluggable judge hook, human-in-the-loop)
- ✅ Route outcome learning (bounded weight suggestions, `adopted: false` by default, regression-gated)
- ✅ Semantic cache (embedding-based, honest degradation when no embedder wired)
- ⬜ Prompt / context compression — *deferred to MVP-3+*
- ⬜ Helicone / Langfuse exporter — *deferred to MVP-3+*

---

## MVP-3 — Team / Enterprise / SaaS ⬜ (Next)

Goal: multi-user, multi-project control plane for teams.

- ⬜ Hosted dashboard
- ⬜ Multi-project and multi-environment support
- ⬜ RBAC
- ⬜ Audit log
- ⬜ Team budget
- ⬜ Organization-level provider keys
- ⬜ Enterprise deployment templates

---

## How priorities are decided

The scope is **locked per milestone** — anything outside the current milestone's
list requires a spec change first (see WORKFLOW.md §5). The automated 6-hour dev
loop only picks the single highest-value *in-scope* item each cycle, behind a
5-stage quality gate (lint → typecheck → build → test → smoke), and opens a PR
for human review. It never expands scope on its own and never merges to `main`.
