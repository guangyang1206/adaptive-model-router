# Architecture Decision Records

This directory holds the decisions that shaped this project, written down so
that a contributor who was not present can tell an intentional constraint from
an accident.

These records were reconstructed after the fact, in September 2026, from git
history, the MVP-3 spec, and the source itself. The project shipped MVP-0
through MVP-3 and a first npm release before any ADR existed; the decisions
were real, they were just only recorded in commit messages. Every technical
claim in these files was verified against the code and carries a
`file:line` reference so you can check it rather than trust it.

## Index

| ADR | Title | Status |
| --- | --- | --- |
| [001](./ADR-001-zero-dependency-core-sdk.md) | The core SDK has zero runtime dependencies, and a script enforces it | Accepted 2026-06-26 |
| [002](./ADR-002-frozen-builtin-weights.md) | `BUILTIN_WEIGHTS` is frozen byte-for-byte at its MVP-1 values | Accepted 2026-07-14 |
| [003](./ADR-003-honest-degradation.md) | Optional capabilities degrade and record a note; they never throw | Accepted 2026-06-27 |
| [004](./ADR-004-postgres-js-no-orm.md) | Control-plane persistence is postgres.js with hand-written SQL migrations, no ORM | Accepted 2026-07-17 |
| [005](./ADR-005-better-auth-dedicated-pg-pool.md) | Better-Auth gets its own node-postgres Pool; the control plane runs two pools | Accepted 2026-07-17 |
| [006](./ADR-006-structural-tenant-isolation.md) | Tenant isolation is structural, not a runtime check | Accepted 2026-07-17 |
| [007](./ADR-007-partial-rbac-owner-member.md) | RBAC ships with owner/member only; admin and viewer are reserved and visibly locked | Accepted 2026-07-17 |
| [008](./ADR-008-string-code-response-envelope.md) | The HTTP response envelope uses a string `code`, not a numeric one | Accepted 2026-06-27 |
| [009](./ADR-009-pnpm-frozen-lockfile-only.md) | pnpm with a frozen lockfile is the only supported install; npm does not work | Accepted 2026-07-14 |
| [010](./ADR-010-fixed-workspace-versioning.md) | All four packages share one version number and release together | Accepted 2026-08-04 |
| [011](./ADR-011-granular-npm-access-token.md) | Publishing requires a granular access token; classic tokens are rejected | Accepted 2026-08-09 |
| [012](./ADR-012-examples-outside-workspace.md) | Examples live outside the pnpm workspace and consume published packages | Accepted 2026-09-18 |

Decisions that have **not** been made yet live in
[OPEN-DECISIONS.md](./OPEN-DECISIONS.md).

## Read these first if you are about to change

- **anything in `packages/sdk`** — ADR-001 (the `dependencies: {}` invariant
  and the dynamic-import shim), ADR-003 (never throw on a missing optional
  backend)
- **routing scores or weights** — ADR-002. A one-unit change fails CI, on
  purpose.
- **anything in `packages/control-plane/src/db` or `src/auth`** — ADR-004,
  ADR-005. The two-pool arrangement looks like duplication and is not.
- **any query that reads tenant data** — ADR-006
- **the install or CI setup** — ADR-009
- **`pnpm-workspace.yaml`, or anything under `examples/`** — ADR-012. The
  absence of `examples/*` from the workspace globs is deliberate; restoring it
  silently breaks what examples are for, and CI will not tell you.
- **the release process** — ADR-010, ADR-011

## What belongs here

An ADR, not a changelog entry and not documentation. The test is:

> If a new contributor does not know this, will they make a change that looks
> correct and is wrong?

Yes means write one. No means put it in `docs/` or the commit message.

Things that pass the test: an invariant with a non-obvious reason; a choice
made against the conventional option; a corrective decision taken after
something broke (ADR-005 and ADR-011 are both of these); a deliberate
incompleteness that will look like an oversight (ADR-007).

Things that do not: how a feature works, what a function returns, a naming
convention, anything already enforced by a type.

## Format

[MADR](https://adr.github.io/madr/), with these local rules:

- **File name** — `ADR-NNN-short-slug.md`, `NNN` zero-padded, allocated
  sequentially. Never renumber.
- **Sections** — Status, Context, Decision, Consequences, Alternatives
  considered, Related ADRs.
- **Status** — `Accepted (YYYY-MM-DD)` with the real date from git history, or
  `Superseded by ADR-NNN (YYYY-MM-DD)`. Records are never deleted or rewritten;
  a reversed decision gets a new ADR and the old one is marked superseded.
- **Consequences must include the negative ones.** An ADR listing only benefits
  is not an ADR. The cost being accepted is the part a future reader needs, and
  it is the part that tells them whether the trade-off still holds.
- **Every technical claim carries a reference.** For source files, cite
  `file:line` — source is stable enough for line numbers to survive. For prose
  files (`README.md`, `ROADMAP.md`, `RELEASING.md`, `CONTRIBUTING.md`) cite the
  **section heading**, and for GitHub workflows cite the **step name**; those
  files get rewritten often and line numbers go stale within days. A claim that
  cannot be pointed at does not go in. An ADR is treated as authoritative, so a
  wrong one is worse than a missing one.
- **A claim about external tool behaviour needs the literal output.** If you
  write that a tool refuses, rejects, validates, or waives something, quote the
  error code or the observed result next to it — `ERR_PNPM_GIT_UNCLEAN`,
  `EOTP`, `403 "You cannot publish over the previously published versions"`.
  With no observed output, write it as "unverified" or leave it out.

  This rule exists because it was broken. `RELEASING.md` accumulated three
  false enforcement claims — that `--no-git-checks` spares the dirty-tree
  check, that `pnpm publish` refuses a dirty tree, and that the git checks
  cover publishing from an unpushed commit. All three described what the tool
  *ought* to do. All three are wrong, and ADR-011 inherited one of them by
  citing the doc instead of running the command. The tell is identical in
  every case: a specific behavioural claim with no error code beside it.
- **Prose files are references, not evidence.** Citing `RELEASING.md` shows a
  reader where a procedure is written down. It does not establish that the
  procedure is accurate. Verify against code or a run, then cite the doc for
  navigation.
- **A checker must be exactly as strict as the rule it claims to enforce, and
  must be tested against a known bad case.** A validator looser than its rule
  issues green lights forever and nobody suspects it, because the only signal
  it produces is the one you wanted.

  This rule also exists because it was broken. The citation checker used here
  resolved each reference by trying a list of likely directories
  (`packages/sdk/src/`, `packages/control-plane/src/db/`, …), so it accepted
  references that do not resolve from the repository root — while the rule above
  requires repo-root paths. It reported "all resolve" four times running with
  47 non-conforming references present. An independent checker written to the
  strict rule found them immediately.

  The lesson generalises past citations: before trusting a gate, feed it
  something you know it should reject. A checker that has never failed has
  never been tested.
- **A gate existing is not the same as a gate catching.** When an ADR claims an
  invariant is machine-enforced, say which kind of evidence backs it:

  - *verified by injection* — the invariant was deliberately violated and the
    gate failed, with the output quoted. ADR-001 and ADR-002 are at this level.
  - *verified by inspection* — the assertion was read at a cited location and
    is wired into CI, but has not been watched reject anything. ADR-006 is at
    this level, because its assertion needs a live Postgres.

  Both are legitimate; they are not equally strong, and an ADR that blurs them
  overstates its own coverage. Upgrade inspection to injection when it is
  cheap — for ADR-002 it cost one mutated constant in a throwaway copy of the
  package.

  **The label has to stay on.** Inspection-grade entries have no natural
  forcing function: ADR-006 will remain inspection-grade indefinitely, because
  upgrading it means deliberately breaking tenant scoping against a live
  Postgres, and nobody will do that spontaneously. That is fine. What is not
  fine is an inspection-grade claim being cited later as though it were
  injection-grade — that is this same bug one level up, and it is how a
  hedged claim becomes an authoritative one without anyone deciding to promote
  it. When quoting an ADR's enforcement claim elsewhere, carry its grade with
  it.
- **Distinguish the constraint from the symptom.** A constraint imposed by an
  external tool tends to be durable; the error message it produces does not.
  Pin the symptom to what it was observed against — the version, and the date.

  ADR-005 is the worked example. The constraint (Better-Auth cannot use a
  `postgres.js` client) is permanent and was re-measured against the installed
  library. The symptom (`NOT_TAGGED_CALL` on the first auth query) was real on
  `better-auth@^1.2.0` but is now a `BetterAuthError` at initialisation on
  `1.6.23`, because the library added a guard. Unpinned, that reads as simply
  wrong to anyone reproducing it today — and a reader who concludes the symptom
  is wrong will discount the constraint with it.
- **Alternatives need a reason, not a list.** "Rejected" alone is not useful;
  say what it would have cost.

## Adding one

1. Pick the next free number.
2. Copy the section order from an existing ADR. ADR-005 is a good model for a
   corrective decision, ADR-006 for an invariant.
3. Verify every claim in the source before writing it, and cite the location.
   For anything an external tool does, run it and quote the output — do not
   describe what the flag or command is supposed to do.
4. Write the negative consequences honestly. If you cannot name a cost, you
   have probably written documentation rather than a decision.
5. Add a row to the index above.
6. If the decision closes an item in `OPEN-DECISIONS.md`, flip that entry to
   `RESOLVED` in place with a `Resolution:` line — do not delete it.
