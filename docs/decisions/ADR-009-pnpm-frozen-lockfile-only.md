# ADR-009 — pnpm with a frozen lockfile is the only supported install; npm does not work

- Status: Accepted (2026-07-14); contradictory contributor docs corrected 2026-08-04
- Deciders: maintainers
- Source commits: `185c710` (CI switched to `pnpm install --frozen-lockfile`), `1b4bccb` (CONTRIBUTING corrected)

## Context

This is a pnpm workspace (`pnpm-workspace.yaml`) with four packages. Three of
them depend on `@adaptive-router/sdk` via `workspace:*`, and the TypeScript
build resolves those imports through the symlinks pnpm creates at
`packages/*/node_modules/@adaptive-router/sdk`.

npm does not create those links for a pnpm workspace. Installing with npm
therefore produces a checkout where `import ... from "@adaptive-router/sdk"`
fails to resolve and `tsc` reports TS2307 — a confusing error that looks like
a broken repository rather than a wrong install command.

The repository actively created this trap. Before `185c710`, CI installed the
toolchain with `npm install --no-save typescript@^5.6.0`, and `CONTRIBUTING.md`
told contributors the repo "uses npm, **not** pnpm". Following those
instructions verbatim produced a broken local checkout. Commit `1b4bccb`
identifies this as the most damaging of the documentation errors it fixed.

A second, independent problem: a non-frozen install can silently repair or
mutate the lockfile, which hides the class of bug where a dependency is
resolved differently in CI than in the committed lockfile. MVP-2 hit a
lockfile-pollution instance of this.

## Decision

`pnpm install --frozen-lockfile` is the only supported install, in CI and
locally.

- both CI jobs run it — `build-test` and `control-plane-integration` in
  `.github/workflows/ci.yml`
- `CONTRIBUTING.md:58` states it as `pnpm install --frozen-lockfile   # NOT npm install`
- the root manifest pins `"packageManager": "pnpm@9.15.0"` and CI pins
  `pnpm/action-setup@v4` to the same `9.15.0`

No ad-hoc `npm install` steps in CI. The lint and type toolchain
(`typescript`, `eslint`, `typescript-eslint`, `@eslint/js`) is declared in root
`devDependencies`, so the single frozen install provides everything CI needs.
The reasoning is recorded inline in `ci.yml` at the install step rather than
only here.

`.npmrc` sets `auto-install-peers=false`, which is a pnpm setting and part of
the same contract — see ADR-001 for why.

Build order is `pnpm -r build`, which resolves the topological order so the
SDK builds before the packages importing it.

## Consequences

Positive:

- `--frozen-lockfile` makes the committed lockfile a verified artifact. An
  incomplete or out-of-date lockfile fails the build instead of being silently
  fixed, which is what catches the dependency-resolution drift class of bug.
- One install command covers workspace linking and the entire toolchain, so CI
  has no second package manager and no ad-hoc install step whose version can
  drift.
- The workspace symlinks the build depends on are created as a side effect of
  the required command, so the TS2307 failure mode does not occur for anyone
  following the documented path.
- Pinning pnpm to `9.15.0` in both the manifest and CI means local and CI
  resolution match.

Negative:

- pnpm is a hard prerequisite for contributing. A drive-by contributor with
  only npm installed cannot build the repo, and the error they get if they try
  anyway (TS2307) does not name the cause. `CONTRIBUTING.md:53-55` is the only
  place that explains it.
- `--frozen-lockfile` fails rather than adapts, so any dependency change
  requires a matching lockfile commit. That is the point, and it is still an
  extra step that will occasionally block a PR for a reason unrelated to its
  content.
- Pinning `pnpm@9.15.0` in two places means two places to update, and they can
  drift.
- `auto-install-peers=false` is workspace-wide, so a future genuine peer
  dependency in any package needs explicit installation.

## Alternatives considered

- **Support npm as well.** Rejected: it would mean abandoning `workspace:*`
  protocol dependencies, or committing a second lockfile and a second CI
  install path. Two package managers means two dependency-resolution
  behaviours to reason about for no gain.
- **`pnpm install` without `--frozen-lockfile`.** This was effectively the
  starting state (`--frozen-lockfile=false` in the scaffold's CI). Rejected: it
  lets CI repair the lockfile, so the committed one stops being the source of
  truth and drift becomes invisible.
- **Commit the workspace symlinks or vendor the SDK build output.** Rejected as
  a workaround for a problem that has a correct solution — use the package
  manager the workspace is built for.

## Related ADRs

- ADR-001 — the dependency boundary check that requires a working workspace
  install to run
- ADR-010 — fixed versioning, which relies on `workspace:*` resolving at pack
  time
