# ADR-010 — All four packages share one version number and release together

- Status: Accepted (2026-08-04)
- Deciders: maintainers
- Source commit: `21749b3` (release preparation)

## Context

Before `21749b3` every package sat at `0.0.0` with no publish metadata, so
nothing could be published and the documented first step,
`pnpm add @adaptive-router/sdk`, returned 404. Making them publishable forced a
versioning decision.

The four packages are not independent. `dashboard`, `cli` and `control-plane`
all depend on `@adaptive-router/sdk` via `workspace:*`, which pnpm rewrites to
a concrete version at pack time. The control plane additionally depends on the
dashboard's exported `DashboardDataSource` and `dispatchApiRequest` — a
contract that ADR-006 relies on and that changes when the dashboard changes.

With independent versions, a user asking "which dashboard works with
sdk@0.3.1?" has to consult a compatibility matrix that someone must maintain
and that nothing verifies.

## Decision

Fixed versioning across the workspace. All four packages carry the same
version and move together on every release.

All four `package.json` files read `"version": "0.1.0"` — `packages/sdk`,
`packages/dashboard`, `packages/cli`, `packages/control-plane`. The policy is
stated for readers at `RELEASING.md "Current state"` ("Versions are **fixed across the
workspace** — all four move together") and as policy at `RELEASING.md "Version policy"`.

Internal dependencies stay `workspace:*` and are resolved at pack time; the
boundary check enforces the protocol
(`scripts/check-dependency-boundary.mjs:39-43, 51-55`). This was verified
against the real tarball rather than assumed: `cli`'s shipped manifest resolved
to `"@adaptive-router/sdk": "0.1.0"` (`06f9148`).

The lockstep rule itself is now machine-enforced at release time.
`.github/workflows/release.yml`, step "Assert tag matches every package
version", compares the pushed tag against all four manifests and fails the
release on any mismatch. Until that step existed the rule was prose only, and
a drifted manifest would have published a version nobody tagged — unfixable
once it is on npm.

The line starts at `0.1.0` rather than `1.0.0` deliberately. `0.x` signals
that the public API may still change in a minor release, and the stated reason
is partial RBAC (`RELEASING.md "Version policy"`) — a 1.0 would be a promise the code
does not keep. See ADR-007.

Publish order is `sdk` → `dashboard` → `cli` → `control-plane`, so a consumer
can always resolve what a newly published package depends on
(`RELEASING.md`).

## Consequences

Positive:

- Compatibility is trivially answerable: `sdk@0.1.0` pairs with `cli@0.1.0`.
  No matrix, nothing to maintain, nothing that can be wrong.
- One version bump per release instead of four independent decisions, and one
  CHANGELOG entry that describes a coherent state of the whole project.
- The dashboard/control-plane contract cannot skew across versions, which
  matters because the control plane reuses dashboard internals.
- `workspace:*` means no internal version numbers are hand-maintained in
  manifests, so the version-drift class of bug is limited to prose — which is
  exactly where it occurred (`9c6d6b6` fixed four documents still claiming
  `0.0.0` after the bump).

Negative:

- Version numbers carry no per-package information. A release that only
  touches the CLI still bumps the SDK, so a user sees a new SDK version with
  no SDK changes and cannot tell from the number whether an upgrade matters.
- Consumers of just the SDK are pulled along by control-plane churn. Since the
  control plane is the largest and fastest-moving package, this will be the
  common case.
- The release is all-or-nothing across four packages. A single failing publish
  leaves the set partially released at different versions — which is precisely
  why `RELEASING.md` specifies a publish order and a recovery procedure.
- The reason for a version number is not local to any package. Nothing in
  `packages/sdk/package.json` explains why it is at `0.1.0`.

## Alternatives considered

- **Independent versioning per package.** Rejected: it requires a maintained
  compatibility matrix, and the dashboard/control-plane coupling makes an
  incompatible pair possible in a way nothing would catch.
- **Start at `1.0.0`.** Rejected explicitly at `RELEASING.md "Version policy"`. The
  permission model is still expected to change; 1.0 would signal otherwise.
- **Publish only the SDK and keep the rest source-only.** Rejected: the CLI and
  control plane both declare `bin` entries and are meant to be run with `npx`,
  which requires publication.

## Related ADRs

- ADR-007 — partial RBAC, the stated reason the line starts at `0.x`
- ADR-009 — the `workspace:*` protocol this depends on
- ADR-011 — the token type required to publish the set
