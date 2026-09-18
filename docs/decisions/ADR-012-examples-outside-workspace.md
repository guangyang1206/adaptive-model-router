# ADR-012 — Examples live outside the pnpm workspace and consume published packages

- Status: Accepted (2026-09-18); implemented 2026-09-18
- Deciders: team-lead (ruling), architect (record), devops (implementation)
- Trigger: `examples/basic-agent` switched from `workspace:*` to `^0.1.0`, which invalidated the lockfile

## Context

`pnpm-workspace.yaml` globs `examples/*` alongside `packages/*`, so example
projects have been workspace members since the initial scaffold. That was
harmless while the packages were unpublished and examples had to resolve
against local source.

Publication changed what an example is *for*. Its only real job now is to prove
that someone can copy the directory, `npm install` from the public registry, and
have it run. That is the check that catches what the 0.1.0 release taught us to
look for — a missing file in `files`, a missing shebang on a `bin`, a
`workspace:*` range that was not rewritten at pack time. All three of those
were real defects in `21749b3`, and all three were found by packing and
installing, not by reading manifests.

A workspace member cannot perform that check. Measured on this repo with
pnpm 9.15.0:

```
$ pnpm --version
9.15.0
$ pnpm config get link-workspace-packages
undefined                      # unset, so pnpm 9's default (true) applies

$ ls -la packages/cli/node_modules/@adaptive-router/
sdk -> ../../../sdk            # symlink to local source, not a registry tarball
```

`link-workspace-packages` defaults to true, so an in-repo install links a
workspace member to local source **even when the manifest asks for a registry
range**. The example then exercises `packages/sdk/src`, not the published
tarball, and reports success regardless of whether the published artifact is
usable.

Team-lead measured the same thing directly on the example before its
`node_modules` was cleared —
`examples/basic-agent/node_modules/@adaptive-router/sdk -> ../../../../packages/sdk`.
I could not independently reproduce that exact path because
`examples/basic-agent/node_modules` does not exist in the current working tree;
the `packages/cli` and `packages/dashboard` symlinks above are the same
mechanism observed on siblings that do still have one.

The immediate trigger was narrower: changing `examples/basic-agent`'s
dependencies from `workspace:*` to `^0.1.0` left the committed lockfile stale,
and `pnpm install --frozen-lockfile` fails closed on that by design (ADR-009).
That breaks three CI steps — two in `ci.yml`, one in `release.yml`.

So there were two candidate fixes: regenerate the lockfile and keep examples in
the workspace, or remove them from it.

## Decision

Remove `examples/*` from `pnpm-workspace.yaml`. Examples are consumers of the
published packages, not members of the workspace that produces them.

Consequences of that, all intended:

- Example manifests declare registry ranges (`^0.1.0`), and those ranges mean
  what they say — an install in an example directory resolves from npm.
- Examples are not covered by `pnpm -r` (`build`, `test`, `typecheck`) and are
  not in the lockfile's `importers`.
- Changing an example's dependencies can no longer invalidate the root
  lockfile, so the CI failure class that triggered this cannot recur.

Coverage is replaced rather than dropped. The compensating control is the
**post-publish smoke test** in `.github/workflows/release.yml`, step "Smoke test
the published SDK as an outside user would": after the packages are live, it
installs `@adaptive-router/sdk@$RELEASE_VERSION` with npm into a clean temporary
directory and runs `examples/minimal/index.mjs` against it. That converts
examples from a pre-merge gate which could not detect packaging defects into a
post-publish gate which can.

Two properties of that step are load-bearing and must not be "simplified" away:

- **The example file is copied out of the repository before it runs.** Node
  resolves a bare import starting from the *importing file's* directory and
  walking upward — not from the working directory. Running `node index.mjs` in
  place under `examples/minimal/` therefore walks up and finds the repository's
  own `node_modules`, silently testing local source again. That is the exact
  failure this ADR exists to prevent, reappearing inside the control meant to
  catch it. The `cp examples/minimal/index.mjs "$SMOKE_DIR/"` line looks like an
  unnecessary step and is the reason the check is real.
- **The install is retried against index propagation.** `npm install` resolves
  through the package index, which lags the version document by a minute or two
  after a publish (observed on the 0.1.0 release). A single attempt would fail
  good releases, so the step retries before believing a failure.

The step asserts the routing *result* — that `demo/large` ranks first for a
`quality: "high"` request — rather than just a non-empty output, so a published
artifact that installs but misroutes fails the release.

### As implemented

Verified in the working tree after devops applied the change:

- `pnpm-workspace.yaml` lists only `packages/*`, and carries the full rationale
  as a comment at the head of the file — which is where a contributor tempted to
  "restore" the missing glob will actually encounter it.
- `pnpm-lock.yaml` contains zero occurrences of `examples/`; `importers` is
  `.`, `packages/cli`, `packages/control-plane`, `packages/dashboard`,
  `packages/sdk`. The `examples/basic-agent` importer is gone.
- `examples/basic-agent/package.json` declares `^0.1.0` for both
  `@adaptive-router/sdk` and `@adaptive-router/dashboard`.
- `.github/workflows/release.yml` contains the smoke step, positioned after
  "Verify the release landed".

Historical note on why this section exists: when first written, this ADR
recorded the opposite state — `examples/*` still present, no smoke step — because
the ruling had been taken but not yet applied. Worth keeping in mind that the
lockfile was stale on **two** independent counts at that moment: the changed
dependency spec on `basic-agent`, and `examples/minimal`, which matched the
`examples/*` glob but had no importer entry. Removing the glob resolved both;
regenerating the lockfile would have had to absorb both, and the second cause
would have recurred on every new example directory.

## Consequences

Positive:

- Examples become capable of catching packaging defects, which is the one thing
  they are uniquely positioned to catch and previously could not. The defect
  classes are not hypothetical — three shipped in `21749b3` and were caught
  only by packing and installing.
- A registry range in an example manifest is now honest. Previously
  `"@adaptive-router/sdk": "^0.1.0"` was resolved to local source, so the
  manifest described something that never happened.
- The lockfile stops coupling example changes to CI. Editing an example is no
  longer able to fail the build for the packages.
- Semantically correct: `examples/*` are `private: true` consumer projects and
  were never publishable workspace members.

Negative:

- **Examples lose `pnpm -r` coverage.** No build, test, or typecheck runs
  against them in the pre-merge gate, so an example can be broken on `main`
  and CI stays green until a release runs the smoke test.
- This is *not* a new loss for type-checking, and the ADR is explicit so nobody
  mistakes it for one: `tsconfig.typecheck.json:20` includes only
  `["packages/*/src/**/*.ts"]`, so examples were never type-checked. The
  workspace membership provided dependency linking, not verification.
- **`examples/basic-agent` has a `typecheck` script that nothing now runs.**
  `examples/basic-agent/package.json` declares `"typecheck": "tsc --noEmit"`,
  and with the package out of the workspace no automation invokes it. Accepted:
  a real run in a clean directory against the published tarball is stronger
  evidence than one `tsc --noEmit` in CI. But the script is now a manual
  affordance that looks automated, which is worth knowing before trusting it.
- **Example dev dependencies are no longer version-locked.**
  `examples/basic-agent` declares `tsx`, `typescript` and `@types/node` as
  devDependencies, and now that it is outside the root lockfile it has **no
  lockfile of its own** (verified: no lock file in either example directory). Its
  reproducibility therefore depends on whatever npm resolves from the registry
  at install time, so an upstream `tsx` or `typescript` release can break the
  example without any change in this repository. Accepted deliberately: an
  example exists to demonstrate usage, not to be a reproducible build, and
  maintaining a separate lockfile per example costs more than it returns. The
  failure is also loud and local — the example fails to start for the person
  running it, and nothing in the packages is affected.
- **Coverage moves later in the pipeline.** A broken example is now discovered
  after publishing rather than before merging. Acceptable because an example
  defect does not affect the published packages, and because the check it
  replaces was incapable of finding the defects that actually occur.
- **The compensating smoke test is a hard dependency, not a nice-to-have.** It
  now exists, so there is no gap today. But if it is ever removed or disabled,
  examples fall back to having *no* automated coverage whatsoever — this ADR's
  trade-off stops balancing at that moment. Two of its details are specifically
  delete-prone: the copy-out-of-repo step and the install retry, both explained
  in the Decision section above.
- Contributors must run examples manually, from the example directory, with a
  registry install. There is no root-level command that does it.
- **The change looks like an omission and is easy to revert by accident.** A
  `pnpm-workspace.yaml` missing an `examples/*` line reads as incomplete, and
  "helpfully" adding it back silently restores linking to local source. CI does
  not fail; the examples keep passing; they simply stop testing the published
  artifact. This is the same shape as the two-pool arrangement in ADR-005 —
  a deliberate structure that presents as duplication or oversight — and it has
  the same mitigation: the reason is written as a comment at the head of
  `pnpm-workspace.yaml`, where someone about to restore the glob will read it,
  rather than only here.

## Alternatives considered

- **Regenerate the lockfile, keep examples in the workspace.** The minimal fix
  for the immediate CI failure, and rejected because it preserves the actual
  problem: the example would still resolve `^0.1.0` to local source and still
  be unable to detect a packaging defect. It also leaves the coupling in place,
  so the next example dependency change breaks CI again.
- **Keep examples in the workspace but set `link-workspace-packages=false`.**
  Would make registry ranges resolve from the registry. Rejected: the setting
  is workspace-wide, so it would also stop `packages/*` from linking to each
  other, which is exactly the linking ADR-009 depends on to make cross-package
  imports resolve.
- **Revert the example to `workspace:*`.** Restores a green lockfile and is
  the most honest version of "examples test local source". Rejected because it
  gives up the post-publish check entirely and makes the example unrunnable by
  a reader who copies it out of the repo — which is the only way examples are
  actually used.
- **Add examples to `tsconfig.typecheck.json` before removing them.** Would
  give real pre-merge coverage. Not taken: it type-checks example source
  against local SDK source, which reintroduces the fake-validation problem in
  a different place. The post-publish smoke test verifies what matters.

## Related ADRs

- ADR-009 — `--frozen-lockfile` failing closed is what surfaced this; the
  `link-workspace-packages` behaviour is the same workspace-linking mechanism
- ADR-010 — examples consume the lockstep-versioned published set, so a
  registry range in an example is a range over all four packages
- ADR-005 — the same "looks like an oversight, is load-bearing" hazard
- ADR-001 — the post-publish smoke test also re-measures the
  zero-dependency claim, since `npm install` reports the true dependency count
