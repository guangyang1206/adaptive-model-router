# Changelog

All notable changes to this project are documented here. This project follows
[Keep a Changelog](https://keepachangelog.com/) conventions.

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
