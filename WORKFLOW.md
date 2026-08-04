# Development Workflow — Adaptive Model Router

> Status: active
> Owner: maintainer (`guangyang1206`) + automated dev loop
> Last reviewed: 2026-08-03
> Cadence: on-demand (milestone-driven)

This document defines how the project is developed, reviewed, and synced to GitHub.
It is tuned to industry best practices for small open-source projects: a protected
`main`, automation that only proposes changes via branches, hard quality gates before
every commit, and human review at milestones.

---

## 1. Principles (non-negotiable)

1. **`main` is sacred.** Automation never pushes directly to `main`. All automated work
   lands on the `develop` branch and is merged only after human review.
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
main            ← protected; only human-reviewed SQUASH merges (1 commit / PR)
  └── develop  ← automation commits here incrementally, then pushes
        └── PR  ← opened at milestones for human review → squash-merge to main
```

- Automation works on `develop`, rebasing on `main` at the start of each cycle.
- Automation **pushes `develop`** every successful cycle (incremental commits are fine —
  they get squashed at merge time; see §3.5).
- Automation **may open or update a PR** `develop → main` via the GitHub API
  (fine-grained PAT stored at `~/.workbuddy/secrets/github_token_adaptive-model-router.env`,
  Pull Requests: write). **It must never merge.** Merging `main` stays a **human action** —
  that is the gate.

**Branch protection on `main` (enforced via API, 2026-06-30):**
- Required status checks (must pass before merge): `pr-title`, `build-test` — `strict=true`
  (PR branch must be up to date with `main`).
- `required_linear_history=true`, `allow_force_pushes=false`, `allow_deletions=false`,
  `required_conversation_resolution=true`.
- `enforce_admins=false` and **no** required reviews — deliberate for a solo-maintainer +
  automation repo: the maintainer can still merge/hotfix, but every **external** PR is hard-gated
  by green CI. (When more maintainers join, flip on required reviews + `enforce_admins`.)

---

## 3. The 6-hour cycle (what the automation does each run)

| Step | Action | Gate |
|---|---|---|
| 1. Align | Read `adaptive-model-router-spec-v0.1.md` + `ROADMAP.md`; compare against current code. Identify the single highest-value next item. | — |
| 2. Sync | `git checkout develop` (create if missing), rebase onto latest `main`. | clean rebase |
| 3. Develop | Implement that one item. Keep diffs focused. | — |
| 4. Lint | `pnpm lint`. | must pass |
| 5. Typecheck | `pnpm typecheck` (noEmit, all package src). | must pass |
| 6. Deps | `pnpm check:deps` — dependency-boundary assertion. | must pass |
| 7. Build | `pnpm -r build` (sdk → dashboard → cli → control-plane). | must pass |
| 8. Test | `pnpm -r test` (sdk, dashboard, cli, control-plane DB-less). | must pass |
| 9. Smoke | CLI smoke (init/doctor/inspect/export) + dashboard smoke (boot + `/api/metrics/summary` + `/requests`). | must pass |
| 10. Commit | Conventional commit on `develop`. | only if 4–9 green |
| 11. Push | `git push origin develop`. | — |
| 12. Log | Append cycle summary to `.workbuddy/memory/YYYY-MM-DD.md`. | always |

**If any gate fails:** stop, write the failure + root cause to the daily log, push
nothing. Never commit red code.

### Lint / typecheck / build / test / smoke commands

```bash
pnpm install --frozen-lockfile   # NOT npm install — workspace links matter
pnpm lint
pnpm typecheck
pnpm check:deps
pnpm -r build
pnpm -r test
```

### The one gate that only CI can run

`pnpm -r test` covers the control plane's **DB-less** unit tests only. The
real-Postgres proof lives in the `control-plane-integration` CI job, which brings
up a `postgres:17` service container, applies the migrations, and round-trips
ingest → project-scoped read (`packages/control-plane/integration/roundtrip.mjs`).

Treat a fully green local run as **necessary but not sufficient**. Adapter-wiring
bugs are invisible without a live connection — MVP-3 shipped exactly such a bug
(Better-Auth needs a node-postgres `Pool`, not a bare `postgres.js` client) past
a completely green local gate, and only the real-Postgres job caught it. If you
have Docker locally, run that round-trip before opening the PR; if not, say so
plainly rather than implying the DB path was verified.

---

## 3.5 Commit & merge policy (locked)

We optimize for a **clean, linear `main` where every commit is one reviewable change** —
without forcing the automation to rewrite history.

**Rules:**

1. **One PR = one logical change.** Not "one commit" — one *purpose*. Unrelated changes
   go in separate PRs.
2. **Squash-merge only.** `main` receives exactly **one commit per PR**. Merge-commits and
   rebase-merges are disabled at the repo level; the source branch is auto-deleted on merge.
   → Working branches (`develop`, feature branches) may contain many small commits; GitHub
   collapses them into one on merge. The automation therefore **never** rewrites history.
3. **PR title = Conventional Commit.** The PR title becomes the squash commit message on
   `main`, so it must follow:

   ```
   <type>(<scope>): <subject>
   type ∈ feat | fix | docs | refactor | test | chore | ci | perf
   scope ∈ sdk | dashboard | cli | control-plane | storage | docs | ci | repo   (optional)
   ```

   Examples: `feat(sdk): add Gemini provider adapter`, `fix(cli): redact secrets in inspect`.
   This keeps `main` semver/changelog-ready for later automated releases.

**Why squash-merge instead of "rebase the branch to one commit":** the 6-hour loop commits
incrementally and pushes every green cycle. Rebasing `develop` down to a single commit each
time means rewriting pushed history on an unattended branch — fragile and easy to corrupt.
Squash-merge gives the same clean `main` while letting the loop append commits safely.

Repo merge settings (enforced via API, 2026-06-29):
`allow_squash_merge=true`, `allow_merge_commit=false`, `allow_rebase_merge=false`,
`delete_branch_on_merge=true`, `squash_merge_commit_title=PR_TITLE`,
`squash_merge_commit_message=PR_BODY`.

**Enforcement (not just docs):** the `pr-title` CI job in `.github/workflows/ci.yml`
validates the PR title against the Conventional Commit format on every PR (open/edit/
reopen/sync) — a malformed title fails CI rather than relying on reviewer discipline. We
lint the **title only**, not individual commits, so contributors can use messy WIP commits
freely. Contributor-facing guidance lives in `CONTRIBUTING.md`.

---

## 4. Milestone review (human gate)

At each roadmap milestone (or when `develop` has accumulated a meaningful feature):

1. The loop (or maintainer) opens/updates a PR `develop → main` via the GitHub API.
2. Maintainer reviews the `develop` diff.
3. Runs a code review pass: correctness, scope-vs-spec, test coverage, security
   (no secrets, no unsafe `Function`/eval beyond the documented `node:sqlite` loader).
4. Merge or request changes.
5. Tag a release if it's a roadmap milestone boundary.

---

## 5. Current target scope (as of 2026-08-03)

MVP-0 through MVP-3 are **complete and on `main`**: the SDK with quality-gated
routing across seven providers, framework adapters, SQLite+JSONL storage, the
local dashboard, the CLI, the MVP-2 eval/cache/learning loop, and the optional
self-hosted control plane (orgs/projects, Better-Auth, Postgres, project-scoped
multi-tenant dashboard, deploy templates).

Next milestone is **MVP-4 — governance and scale**, whose scope is **not yet
locked**. Candidates (see [ROADMAP.md](ROADMAP.md)): full RBAC matrix
(`admin` / `viewer`), audit log, team budgets, organization-level provider keys,
plus items carried over from earlier milestones (policy dry-run UI, local
proxy / HTTP bridge, prompt compression, Helicone/Langfuse exporter).

Standing constraints that outlive any milestone:

- **Never add a runtime dependency to `@adaptive-router/sdk`** — it ships
  `dependencies: {}`. Cloud building blocks belong only in the control plane, and
  `pnpm check:deps` enforces this in CI.
- **`BUILTIN_WEIGHTS` is frozen** — byte-for-byte MVP-1 routing compatibility.
- **Honest degradation** — no silent fallbacks; record the downgrade.

Anything outside the spec's locked scope requires a spec change first — do not let the
loop silently expand scope.

---

## 6. Definition of Done (per item)

- [ ] Implemented per spec, no scope creep
- [ ] Build passes (4 packages)
- [ ] Tests pass; new behavior has at least one test
- [ ] Smoke passes
- [ ] Docs/README updated if public API changed
- [ ] Committed to `develop` and pushed
- [ ] Cycle logged to daily memory
