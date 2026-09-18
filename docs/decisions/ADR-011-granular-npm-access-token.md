# ADR-011 — Publishing requires a granular access token; classic tokens are rejected

- Status: Accepted (2026-08-09); confirmed by the successful release 2026-09-18
- Deciders: maintainers
- Source commits: `981574e` (documented after a real failure), `06f9148` (release confirmed)
- Type: corrective — this replaced instructions that did not work

## Context

`RELEASING.md` originally said `npm login` and stopped there. The first publish
attempt failed:

```
npm error code EOTP
npm error This operation requires a one-time password from your authenticator.
```

The obvious diagnoses were both wrong. The token really was created as a
**Publish** token, and the account really is an owner of the
`@adaptive-router` org. `npm profile get` returned 403 for the same underlying
reason. npm states the cause on any authenticated call:

> npm tokens that bypass 2FA are being restricted for account changes and
> **direct publishing** — <https://gh.io/npm-gat-bypass2fa-deprecation>

This is a platform policy change, not a misconfiguration. Classic tokens can no
longer publish directly on an account with 2FA enabled, regardless of the
token's declared type or the account's org role.

The distinction matters for a second reason: after an `EOTP` failure the
instinct is to assume the version number is burned and to bump it. It is not.
A version only becomes permanent once it actually lands.

## Decision

Publishing uses a **granular access token** scoped to `@adaptive-router` with
read and write. Recorded at `RELEASING.md "Authentication: use a granular token, not a classic one"` with three options in order of
preference:

1. Granular Access Token scoped to `@adaptive-router`, read/write — publishes
   without an OTP prompt, supports scoping and expiry
2. `--otp=<code>` per command — workable but codes rotate every 30 seconds and
   four publishes run back to back
3. Trusted Publishing via GitHub Actions (OIDC, no long-lived token) — the most
   durable option, requires setup on both npm and GitHub. Still open; see
   `OPEN-DECISIONS.md`.

Two operational facts are recorded alongside it because both cost a real
diagnosis:

- **An `EOTP` failure publishes nothing.** Confirm with a registry query
  (`404` means the name is still free and it is safe to retry) rather than
  bumping the version.
- **A 404 immediately after a successful publish does not mean failure.** The
  packument that `install` resolves through takes a minute or two to propagate
  while the version document is live immediately. Observed at release:
  `/@adaptive-router%2fsdk` returned 404 while
  `/@adaptive-router%2fsdk/0.1.0` returned 200. The decisive test is to publish
  the same version again — it cannot overwrite, so `403 "You cannot publish
  over the previously published versions"` proves the first publish landed
  (`06f9148`).

`--no-git-checks` accompanies the publish commands. What pnpm 9.15.0 actually
checks was measured rather than reasoned about (devops, 2026-09-18, one real
clone per row, `--dry-run`):

| Repo state | Without the flag | With the flag |
| --- | --- | --- |
| Dirty tree | `ERR_PNPM_GIT_UNCLEAN`, exit 1 | publishes |
| Detached HEAD | `ERR_PNPM_GIT_UNKNOWN_BRANCH`, exit 1 | publishes |
| Behind `origin/main` | `ERR_PNPM_GIT_NOT_LATEST`, exit 1 | publishes |
| Ahead of `origin/main` (unpushed commit) | **publishes** | publishes |
| Wrong branch, non-interactive | no publish, but **exit 0** | publishes |

Three things follow, and each corrected a false claim that had been standing
in `RELEASING.md`:

- **The flag disables every one of these checks, dirty tree included.** pnpm
  gates the whole block on a single `opts.gitChecks !== false`. The doc had
  said the flag "does not excuse a dirty tree"; it does.
- **An unpushed commit is caught by nothing.** pnpm checks whether you are
  *behind* the remote, never whether your commit was pushed. This is the exact
  failure the release procedure exists to prevent — a version on npm
  corresponding to no commit anyone can fetch — and `git pull` does not
  address it. The check is `git status -sb` for an "ahead" count.
- **The wrong-branch check is an interactive confirm, not an assertion.** With
  stdin closed it declines to publish and exits **0**. A zero exit from the
  manual path therefore does not mean anything was published.

The consequence differs by path:

- **Automated** (`.github/workflows/release.yml`, step "Publish to npm
  (dependency order)") — the flag is unavoidable, because a tag build is a
  detached HEAD. None of the waived checks matter: the runner is a pristine
  checkout of a pushed tag, so cleanliness and reachability hold by
  construction. The workflow does not trust the publish exit code either; the
  step "Verify the release landed" reads back from the registry.
- **Manual** — the flag removes real safety nets, and the ones it removes were
  never the complete set. "Publish only from `main`, clean, pushed" is
  procedure the operator enforces, not enforcement pnpm provides. See
  `RELEASING.md` "What pnpm actually checks, and what is only procedure".

## Consequences

Positive:

- Publishing is non-interactive, which is the prerequisite for automating it.
  `.github/workflows/release.yml` consumes the same token type as the
  `NPM_TOKEN` repository secret and publishes with `--provenance` (step
  "Publish to npm (dependency order)"), neither of which an OTP-gated flow
  could do.
- The token is scoped to one npm scope and can carry an expiry, so its blast
  radius is bounded — better than a classic token that can act on the whole
  account.
- The two diagnostic facts are written down, so the next release does not
  re-run either investigation. A 404 after publishing has a documented
  resolution procedure instead of a guess.

Negative:

- A long-lived credential still exists. Granular scoping bounds its blast
  radius to one npm scope and gives it an expiry; it does not remove it.
  Trusted Publishing is the only option that does — tracked in
  `OPEN-DECISIONS.md`.
- Granular tokens expire. A release attempted after expiry fails with an auth
  error that looks like a permissions problem, which is the same misleading
  signal that made the original `EOTP` failure hard to diagnose. The release
  workflow names this cause explicitly in its failure output
  (`.github/workflows/release.yml`, step "Publish to npm (dependency order)")
  rather than leaving the operator to
  rediscover it.
- `--no-git-checks` reads like a shortcut, and on the manual path it genuinely
  is one — it waives every git assertion, not just the branch one (see the
  table above). A contributor copying the command out of context loses both
  the reason it is required on a tag build and the fact that it removes real
  checks everywhere else.
- The manual path's git safety was weaker than it looked even before the flag.
  An unpushed commit passes every pnpm check, and the wrong-branch confirm
  exits 0 when it declines. The mitigation is procedural — `git status -sb`,
  and asserting against the registry rather than the exit code — which means
  it depends on the operator following it. This is a standing argument for
  using the automated path, where the same properties hold by construction.

## Alternatives considered

- **Classic "Publish" token.** Does not work. Rejected by npm with `EOTP` on a
  2FA account — this was established by a real failed run, not by reading a
  changelog.
- **`--otp=<code>` on each publish.** Works, and rejected as the primary path:
  codes rotate every 30 seconds and four sequential publishes make the window
  tight. Retained as the documented fallback.
- **Disable 2FA on the publishing account.** Rejected. Trading account security
  for release convenience on a package other people install is the wrong
  direction.
- **Trusted Publishing (OIDC) immediately.** Preferred destination, not
  adopted yet: it requires configuration on the npm side that had not been
  done at release time. Tracked as an open decision rather than silently
  dropped.

## Related ADRs

- ADR-010 — the four-package publish set this credential has to cover
