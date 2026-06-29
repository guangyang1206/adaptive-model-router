# Development Workflow — Adaptive Model Router

> Status: active
> Owner: maintainer (`guangyang1206`) + automated dev loop
> Last reviewed: 2026-06-29
> Cadence: every 6 hours until 2026-06-30, then re-evaluate

This document defines how the project is developed, reviewed, and synced to GitHub.
It is tuned to industry best practices for small open-source projects: a protected
`main`, automation that only proposes changes via branches, hard quality gates before
every commit, and human review at milestones.

---

## 1. Principles (non-negotiable)

1. **`main` is sacred.** Automation never pushes directly to `main`. All automated work
   lands on the `auto/dev` branch and is merged only after human review.
2. **Quality gate before every commit.** `build → test → smoke` must all pass. If any
   step fails, the loop writes a diagnostic note and pushes nothing.
3. **Small, reviewable increments.** Each 6-hour cycle advances at most one roadmap
   item. No large unreviewed batches.
4. **Spec/PRD is the source of truth.** Every cycle starts by re-aligning against the
   spec and roadmap, not by inventing scope.
5. **Traceable decisions.** Each cycle appends a short log entry to
   `.workbuddy/memory/YYYY-MM-DD.md` (decisions, what shipped, what's blocked).

---

## 2. Branch & sync model

```
main            ← protected; only human-reviewed merges
  └── auto/dev  ← automation commits here, then pushes
        └── PR  ← opened at milestones for human review → merge to main
```

- Automation works on `auto/dev`, rebasing on `main` at the start of each cycle.
- Automation **pushes `auto/dev`** every successful cycle.
- Automation **may open or update a PR** `auto/dev → main` via the GitHub API
  (fine-grained PAT stored at `~/.workbuddy/secrets/github_token_adaptive-model-router.env`,
  Pull Requests: write). **It must never merge.** Merging `main` stays a **human action** —
  that is the gate.

---

## 3. The 6-hour cycle (what the automation does each run)

| Step | Action | Gate |
|---|---|---|
| 1. Align | Read `adaptive-model-router-spec-v0.1.md` + `ROADMAP.md`; compare against current code. Identify the single highest-value next item. | — |
| 2. Sync | `git checkout auto/dev` (create if missing), rebase onto latest `main`. | clean rebase |
| 3. Develop | Implement that one item. Keep diffs focused. | — |
| 4. Build | `tsc` build for sdk → dashboard → cli. | must pass |
| 5. Test | `node --test packages/sdk/test/*.mjs`. | must pass |
| 6. Smoke | CLI smoke (init/doctor/inspect/export) + dashboard smoke (boot + `/api/metrics/summary` + `/requests`). | must pass |
| 7. Commit | Conventional commit on `auto/dev`. | only if 4–6 green |
| 8. Push | `git push origin auto/dev`. | — |
| 9. Log | Append cycle summary to `.workbuddy/memory/YYYY-MM-DD.md`. | always |

**If any gate fails:** stop, write the failure + root cause to the daily log, push
nothing. Never commit red code.

### Build / test / smoke commands

```bash
TSC=/Users/yangguang/.workbuddy/binaries/node/workspace/node_modules/.bin/tsc
NODE=/Users/yangguang/.workbuddy/binaries/node/versions/20.18.0/bin/node

$TSC -p packages/sdk/tsconfig.json
$TSC -p packages/dashboard/tsconfig.json
$TSC -p packages/cli/tsconfig.json
$NODE --test packages/sdk/test/index.test.mjs packages/sdk/test/storage.test.mjs
```

(Managed `tsc` + Node's built-in test runner are used instead of `pnpm`, which fails
in this environment due to Corepack signature issues — see `.learnings/ERRORS.md`.)

---

## 4. Milestone review (human gate)

At each roadmap milestone (or when `auto/dev` has accumulated a meaningful feature):

1. The loop (or maintainer) opens/updates a PR `auto/dev → main` via the GitHub API.
2. Maintainer reviews the `auto/dev` diff.
3. Runs a code review pass: correctness, scope-vs-spec, test coverage, security
   (no secrets, no unsafe `Function`/eval beyond the documented `node:sqlite` loader).
4. Merge or request changes.
5. Tag a release if it's a roadmap milestone boundary.

---

## 5. Current target scope (as of 2026-06-29)

MVP-0 is **functionally complete** (SDK, quality-gated routing, 4 providers, fallback,
SQLite+JSONL storage, 2-page dashboard, bilingual docs). The dev loop's near-term
objectives are therefore **MVP-1 + quality hardening**, in priority order:

1. **Quality gate completion** — add an eslint config + a `lint` step the CI actually runs.
2. **Fix known correctness/clarity debts**
   - ~~`router.dashboard()` returns a URL without starting a server~~ — ✅ fixed (3df0f47): now returns an honest `DashboardHandle { url, started:false, hint }`.
   - ~~`redactConfig()` in CLI is a no-op~~ — ✅ fixed (3df0f47): real recursive secret redaction.
   - ~~token/cost estimation measured stringified-length, not content length~~ — ✅ fixed (dbc078a).
3. **Provider expansion (MVP-1)** — Gemini adapter, Qwen adapter, vLLM support.
4. **Framework adapters** — LangChain/LangGraph, Vercel AI SDK.
5. **Dashboard filtering + model comparison.**

Anything outside the spec's locked scope requires a spec change first — do not let the
loop silently expand scope.

---

## 6. Definition of Done (per item)

- [ ] Implemented per spec, no scope creep
- [ ] Build passes (3 packages)
- [ ] Tests pass; new behavior has at least one test
- [ ] Smoke passes
- [ ] Docs/README updated if public API changed
- [ ] Committed to `auto/dev` and pushed
- [ ] Cycle logged to daily memory
