# Releasing

How to publish `@adaptive-router/*` to npm. Publishing is **irreversible** — npm
forbids unpublishing after 24 hours, and a version number can never be reused.
Read the whole file before running anything.

## Current state

All four packages are published on npm. First release: 0.1.0 on 2026-09-18.

| Package | Version | On npm |
| --- | --- | --- |
| `@adaptive-router/sdk` | 0.1.0 | published |
| `@adaptive-router/dashboard` | 0.1.0 | published |
| `@adaptive-router/cli` | 0.1.0 | published |
| `@adaptive-router/control-plane` | 0.1.0 | published |

Versions are **fixed across the workspace** — all four move together. This keeps
compatibility trivial to reason about: `sdk@0.1.0` pairs with `cli@0.1.0`.

## Two paths, and which one to use

| | Automated (`.github/workflows/release.yml`) | Manual (the rest of this file) |
| --- | --- | --- |
| Trigger | push a `v*` tag | run commands locally |
| Credentials | `NPM_TOKEN` repo secret | a token on your own machine |
| Package order | enforced by the workflow | you have to remember it |
| Provenance | yes | no — impossible off a cloud runner |
| Use it when | every normal release | the workflow is broken, or you are debugging the release process itself |

**Default to the automated path.** The manual path was how 0.1.0 shipped, and it
has two failure modes that automation removes: it depends on a token living on
one person's laptop, and it depends on that person publishing the four packages
in the right order (`sdk` first — otherwise the other three reference an
`@adaptive-router/sdk` version the registry cannot resolve yet).

## Automated release via GitHub Actions (preferred)

### Releasing

```bash
# 1. bump all four (fixed versioning), commit on main, merge
pnpm -r exec npm version 0.2.0 --no-git-tag-version

# 2. tag main and push the tag — this is the whole release trigger
git tag -a v0.2.0 -m "v0.2.0"
git push origin v0.2.0
```

### What the workflow does

`.github/workflows/release.yml` runs on `push` of any `v*` tag and:

1. **Asserts the tag matches all four manifests.** `v0.2.0` must mean `0.2.0` in
   every package. A drifted manifest would otherwise publish a version nobody
   tagged — and that cannot be taken back.
2. **Asks the registry what already exists.** npm never allows overwriting a
   version; a second attempt returns
   `403 You cannot publish over the previously published versions`. Deciding
   this up front means: all four already published → fail with that stated
   plainly; *some* published → skip those and publish the rest, so a re-run
   after a mid-release failure resumes instead of dying on the first package.
   The check reads the **version document** (`/@adaptive-router%2fsdk/0.2.0`),
   not the package index, because the index lags a minute or two behind a
   publish — see the propagation note under *After publishing*.
3. **Re-runs the whole gate on the tagged tree**: `pnpm install
   --frozen-lockfile`, `check:deps`, `lint`, `typecheck`, `build`, `test`. CI
   being green on `main` is not proof the tag is green — the tag could point
   somewhere else. Nothing publishes unless all of it passes.
4. **Publishes in dependency order** — `sdk` → `dashboard` → `cli` →
   `control-plane` — with `pnpm publish --access public --provenance
   --no-git-checks`.
5. **Reads the release back from the registry** rather than trusting the publish
   exit code.

It deliberately uses only `actions/checkout`, `actions/setup-node` and
`pnpm/action-setup` — no third-party publishing action, so nothing in the
release path is outside npm's and pnpm's own tooling.

### Repository configuration you must do once

**Add the `NPM_TOKEN` secret.** GitHub repo → *Settings* → *Secrets and
variables* → *Actions* → *New repository secret*:

- **Name:** `NPM_TOKEN` (exactly — the workflow reads `secrets.NPM_TOKEN`)
- **Value:** a **granular access token** from npmjs.com → *Access Tokens* →
  *Generate New Token* → *Granular Access Token*, with **Packages and scopes →
  `@adaptive-router` → Read and write**.

It has to be a granular token. **Classic tokens can no longer publish** — see
*Authentication* below; a classic token fails with `EOTP` even when it is a
publish token on an org-owner account. Granular tokens also expire, so when a
release fails with `403`/`ENEEDAUTH` and nothing else changed, an expired token
is the first thing to check.

Nothing else needs configuring. `id-token: write` is declared in the workflow
itself, and `contents: read` is enough — the workflow does not push commits,
tags or releases.

### Provenance

The workflow publishes with `--provenance`, which makes npm exchange a GitHub
OIDC token for a Sigstore signing certificate and record the result in a public
transparency log. The published package then carries a verifiable link to the
exact commit and workflow run that built it, and npmjs.com shows it as verified.
Consumers can check it with `npm audit signatures`.

Four preconditions, all already satisfied here:

- `permissions: id-token: write` on the job — declared in the workflow.
- A **cloud-hosted** runner (`ubuntu-latest`). Provenance cannot be generated on
  a self-hosted runner, which is also why the manual path can never produce it.
- npm CLI `>= 9.5.0`. `pnpm publish` delegates to the `npm` on `PATH`; Node 22
  via `actions/setup-node` ships npm 10.x.
- A public `repository` field in each published manifest that matches the repo
  it is published from. All four declare
  `git+https://github.com/guangyang1206/adaptive-model-router.git`.

Reference: <https://docs.npmjs.com/generating-provenance-statements>.

### Why not Trusted Publishing (OIDC) yet

Trusted publishing is the better end state — no token in the repo at all, and
provenance becomes automatic. It is **not** used yet, for reasons that are about
current conditions rather than preference:

- It needs npm CLI **>= 11.5.1**. `pnpm publish` shells out to whatever `npm` is
  on `PATH`, which is npm 10.x with Node 22. Adopting OIDC means pinning a newer
  npm in the workflow and re-verifying that pnpm's publish path (it packs a
  tarball, then runs `npm publish <tarball>`) still performs the OIDC exchange.
  npm documents trusted publishing only for direct `npm publish`.
- It must be configured **per package** on npmjs.com (*Settings* → *Trusted
  publishing* → GitHub Actions, giving org, repo and the workflow filename), so
  four separate configurations. npm does not validate them on save, and a saved
  configuration **cannot be edited** — only deleted and recreated.

The migration order npm recommends is: configure trusted publishers → verify a
release works → then revoke the token. So `NPM_TOKEN` stays until that has been
done and proven, not before.

### When a release fails

The workflow fails loudly and tells you which case you are in. What matters:

- **Packages published before the failure stay published.** npm has no
  transaction across four publishes. Fix the cause and re-run the workflow (or
  re-push the tag) — the registry preflight skips what already landed and
  resumes at the first package that did not.
- **Never "fix" a failed release by reusing the version.** If bad code reached
  npm, publish a patch and deprecate the bad version; see *If something goes
  wrong* at the end of this file.

### Still a human job after the workflow is green

The workflow publishes; it does not write the narrative. After a release:
add the `CHANGELOG.md` entry, check off *Distribution* in `ROADMAP.md`, and
confirm the install snippets in `README.md` and `docs/{en,zh}/quickstart.md`
still match reality.

## One-time setup

Applies to both paths, except where it says "local".

**Done (2026-08-04):** the `@adaptive-router` org exists, created with npm's
default `Developers` team. Free orgs can only publish public packages — which is
exactly what we want here.

What still has to happen **on the machine doing the publish** (manual path
only): creating the org in a browser does not write local credentials. Confirm
with:

```bash
npm whoami     # ENEEDAUTH means this machine is not authenticated
```

Each package already declares `publishConfig.access: "public"`, so scoped
packages publish publicly without extra flags.

### Authentication: use a granular token, not a classic one

**Classic tokens can no longer publish directly.** Even a token created with the
"Publish" type fails on an account with 2FA enabled. Observed 2026-08-09 on
npm CLI 10.x:

```
npm error code EOTP
npm error This operation requires a one-time password from your authenticator.
```

npm states this plainly on any authenticated call:

> npm tokens that bypass 2FA are being restricted for account changes and
> **direct publishing** — <https://gh.io/npm-gat-bypass2fa-deprecation>

This is a platform policy change, not a misconfiguration — it happens even when
the account is an org owner and the token really is a publish token.

The **constraint** (use a granular token) is the durable part. The **symptom**
above is not: it is registry-side policy plus a CLI message, and both can
change. If you hit a different error while using a classic token, do not assume
this section is wrong — assume the surface moved, and verify against
<https://docs.npmjs.com/> before editing anything here. Three ways forward, in
order of preference:

1. **Granular Access Token** (recommended). npmjs.com → Access Tokens →
   Generate New Token → *Granular Access Token*; under **Packages and scopes**
   select `@adaptive-router` with **Read and write**. These publish without an
   OTP prompt, and they can be scoped and given an expiry. Then:

   ```bash
   printf '//registry.npmjs.org/:_authToken=%s\n' "$NPM_TOKEN" > ~/.npmrc
   chmod 600 ~/.npmrc
   npm whoami         # should print your username
   npm org ls adaptive-router    # should show you as owner
   ```

2. **One-time password per command**: `pnpm publish --access public --otp=<code>`.
   Codes rotate every 30s; use a freshly refreshed one, since four publishes run
   back to back.

3. **Trusted Publishing via GitHub Actions** (OIDC, no token at all). The most
   durable option. Not adopted yet — see *Why not Trusted Publishing (OIDC) yet*
   above for the two conditions that currently block it.

Never commit a token. For the manual path `~/.npmrc` is the only place it
belongs, and it is outside the repo; remove it once publishing is done if the
machine is shared. For the automated path the token lives only in the
`NPM_TOKEN` repository secret.

> An `EOTP` failure is clean — nothing is partially published. Verify with
> `curl -s -o /dev/null -w "%{http_code}" https://registry.npmjs.org/@adaptive-router%2fsdk`;
> a 404 means the name is still free and you can simply retry.

### Team / access (optional)

The default `Developers` team owns the scope. For a solo maintainer nothing more
is needed. To add a collaborator later:

```bash
npm team add adaptive-router:developers <username>
npm access list packages @adaptive-router   # verify who can publish
```

## Manual release (fallback)

Every section from here to the end is the hand-run path. Use it only when the
workflow cannot run
— broken Actions, an npm-side outage, or when you are changing the release
process itself and need to see each step. For a normal release, push a tag and
let `.github/workflows/release.yml` do this.

The automated path performs the same gate and the same publish order; the
difference is that here you are the one enforcing them.

## Publish from `main`, not from a feature branch

A published version is permanent, so the code behind `@adaptive-router/sdk@0.1.0`
must be reachable on `main` forever. Publishing from a branch that later gets
squashed or amended leaves a version on npm that corresponds to no commit
anyone can find.

So: **merge the release-prep PR first, then publish from `main`.**

```bash
git checkout main
git pull
git status --porcelain    # must be empty — your check, not pnpm's; see below
git status -sb            # must show no "ahead" count; pnpm does NOT check this
```

### What pnpm actually checks, and what is only procedure

This matters because the publish commands below pass `--no-git-checks`, which
disables **every** git assertion pnpm has. Measured on pnpm 9.15.0 (each row run
against a real clone in the stated state, with `--dry-run`):

| Repo state | Without `--no-git-checks` | With `--no-git-checks` |
| --- | --- | --- |
| Dirty tree | `ERR_PNPM_GIT_UNCLEAN`, exit 1 | publishes |
| Detached HEAD | `ERR_PNPM_GIT_UNKNOWN_BRANCH`, exit 1 | publishes |
| Behind `origin/main` | `ERR_PNPM_GIT_NOT_LATEST`, exit 1 | publishes |
| **Ahead of `origin/main`** (unpushed commit) | **publishes** | publishes |
| Wrong branch, non-interactive | no publish, but **exit 0** | publishes |

Two of these deserve attention:

- **An unpushed commit is not caught by anything.** pnpm verifies you are not
  *behind* the remote; it does not verify your commit has been pushed. So the
  exact failure this section warns about — a published version pointing at a
  commit nobody else can fetch — is **not** prevented by any tool, with or
  without the flag. `git pull` does not help; check `git status -sb` for an
  "ahead" count and push before publishing.
- **The wrong-branch check is a prompt, not an assertion**, and with stdin
  closed it exits **0 without publishing**. If you ever script the manual path,
  a zero exit does not mean a package was published — assert against the
  registry instead, the way the workflow's "Verify the release landed" step
  does.

Everything in this section is therefore **procedure you enforce**, not
enforcement you inherit. The automated path closes these differently: it runs
from a pristine tag checkout, so there is nothing to be dirty or unpushed.

## Pre-publish checks

Run these from the repo root. All must be green.

```bash
pnpm install --frozen-lockfile
pnpm lint
pnpm typecheck
pnpm check:deps                # asserts the dependency boundary
pnpm -r build
pnpm -r test
```

`check:deps` is the one that protects the core promise: `packages/sdk` must keep
`"dependencies": {}` forever. Cloud dependencies (better-auth, pg, postgres) are
allowed **only** in `control-plane`.

## Verify the tarballs before publishing

`pnpm pack` produces exactly what `pnpm publish` would upload. Inspect it — do
not trust `files` to be right just because it looks right.

```bash
rm -rf /tmp/tarballs && mkdir -p /tmp/tarballs
for p in sdk dashboard cli control-plane; do
  (cd "packages/$p" && pnpm pack --pack-destination /tmp/tarballs)
done
```

Then check each one:

```bash
tar tzf /tmp/tarballs/adaptive-router-sdk-0.1.0.tgz
```

What to confirm:

- **`workspace:*` is gone.** pnpm rewrites workspace ranges to the real version
  at pack/publish time. `cli`'s dependency must read `"@adaptive-router/sdk":
  "0.1.0"`, not `"workspace:*"` — otherwise every install breaks.
- **SDK dependencies are `{}`.** Non-negotiable.
- **`LICENSE` is present** in all four (npm includes it automatically).
- **`README.md` is present in the SDK** — it becomes the npm landing page. The
  other three intentionally have none; the repo keeps docs centralized.
- **`bin` targets start with `#!/usr/bin/env node`.** Without a shebang, `npx
  adaptive-control-plane` fails with a shell syntax error. Both `cli/dist/index.js`
  and `control-plane/dist/server.js` need it.
- **control-plane ships `dist/db/migrations/*.sql`** (copied post-`tsc`, required
  at boot) and `deploy/.env.example` (npm excludes dotfiles unless listed in
  `files` explicitly — it is).
- **No stale artifacts.** Each package's `build` runs `scripts/clean.mjs` first,
  which prunes emitted files whose source no longer exists. This was a real bug:
  a deleted test left `dist/index.test.js` behind and it shipped in the tarball.

### Install the tarball as a real user would

The strongest check. Do not skip it.

```bash
mkdir /tmp/verify && cd /tmp/verify
npm init -y >/dev/null
npm install /tmp/tarballs/adaptive-router-sdk-0.1.0.tgz
```

Expect `added 1 package` — proof the zero-dependency guarantee survives a real
install. Then run the README's own example and confirm the output matches what
the README claims.

```bash
node --input-type=module -e '
import { createRouter, createStaticProvider } from "@adaptive-router/sdk"
const models = [{ id:"local/demo", provider:"demo", model:"demo", type:"self-hosted",
  kind:"openai-compatible", tier:"balanced", contextWindow:8192,
  capabilities:["reasoning"], enabled:true,
  cost:{inputPer1M:0,outputPer1M:0,currency:"USD",estimated:true},
  health:{status:"ok",successRate:1} }]
const router = createRouter({ providers:[createStaticProvider("demo", models)], models })
const d = await router.evaluate({ messages:[{role:"user",content:"Plan a task."}], route:{task:"plan"} })
console.log(d.candidates[0].modelId, "scored", d.candidates[0].score)
'
```

For the CLI, confirm the bin resolves and runs:

```bash
npm install /tmp/tarballs/adaptive-router-cli-0.1.0.tgz /tmp/tarballs/adaptive-router-sdk-0.1.0.tgz
./node_modules/.bin/adaptive-router --help
```

## Publish

Order matters: dependencies first, so a consumer installing `cli@0.1.0` can
always resolve `sdk@0.1.0`.

```bash
cd packages/sdk           && pnpm publish --access public --no-git-checks
cd ../dashboard           && pnpm publish --access public --no-git-checks
cd ../cli                 && pnpm publish --access public --no-git-checks
cd ../control-plane       && pnpm publish --access public --no-git-checks
```

Run the first one with `--dry-run` appended to see npm's own view of what would
be uploaded — file list, unpacked size, resolved version. For the SDK at 0.1.0
that is 63 files / 76.2 kB.

`--no-git-checks` disables pnpm's git assertions — **all of them**, dirty tree
included. See the table under *Publish from `main`* for what each state does with
and without the flag. The short version: with this flag you have no tool-side
safety net at all, so the checks in that section are yours to run.

On the automated path the flag is needed for a different and unavoidable reason:
a tag build checks out a detached HEAD, and pnpm then aborts with
`ERR_PNPM_GIT_UNKNOWN_BRANCH` ("The Git HEAD may not attached to any branch")
regardless of how clean the tree is. There the tree's cleanliness is guaranteed
by construction — it is a fresh checkout of the tag — so nothing is lost.

Do not use `npm publish` here — it does not understand `workspace:*` and would
publish a broken manifest. `pnpm publish` rewrites those to real versions.

## After publishing

1. **Verify from the registry, not from cache.**

   ```bash
   npm view @adaptive-router/sdk version
   cd /tmp && rm -rf postcheck && mkdir postcheck && cd postcheck
   npm init -y >/dev/null && npm install @adaptive-router/sdk
   ```

   Expect `added 1 package` for the SDK — that is the zero-dependency claim
   measured rather than asserted. Then run the README example against the
   installed package, and check `node_modules/@adaptive-router/cli/package.json`
   resolved `workspace:*` to a real version.

   > **A 404 right after publishing does not mean the publish failed.** The
   > packument (the package index `install` uses to resolve `@*`) takes a minute
   > or two to propagate, while the version document is available immediately.
   > Observed on the 0.1.0 release: `/@adaptive-router%2fsdk` returned 404 while
   > `/@adaptive-router%2fsdk/0.1.0` returned 200 and `npm access list packages`
   > already listed the package.
   >
   > The decisive check is to **publish the same version again** — it costs
   > nothing and cannot overwrite:
   >
   > ```bash
   > pnpm publish --access public --no-git-checks
   > # 403 "You cannot publish over the previously published versions: 0.1.0."
   > #   -> the first publish succeeded, just wait for propagation
   > # succeeds -> the first one really had failed, and now it is done
   > ```
   >
   > Either outcome is the answer you need, which is why this beats guessing.

2. **Tag the release.**

   ```bash
   git tag -a v0.1.0 -m "v0.1.0 — first published release"
   git push origin v0.1.0
   ```

3. **Simplify the install docs.** Done for 0.1.0 — `docs/en/quickstart.md`,
   `docs/zh/quickstart.md`, and `README.md` now open with:

   ```bash
   pnpm add @adaptive-router/sdk
   ```

   The build-from-source path stays as a secondary option for contributors.
   For future releases, verify these still match reality.

4. **Update `ROADMAP.md`** — check off the items under *Distribution* and retitle
   the section to match its actual state.

5. **Add a `CHANGELOG.md` entry** for the release.

## Version policy

Fixed versioning across the workspace. Semantic versioning applies, with the
usual `0.x` caveat: **the public API may still change in minor releases** while
the project is pre-1.0. Say so in release notes rather than letting users assume
1.0-grade stability — RBAC is still partial (`owner`/`member` enforced,
`admin`/`viewer` reserved), so1.0 would be a premature promise.

To bump all four:

```bash
pnpm -r exec npm version 0.2.0 --no-git-tag-version
```

Then re-run the full pre-publish checklist. Workspace ranges resolve themselves.

## If something goes wrong

- **Published a broken version.** Do not count on unpublish (blocked after 24h).
  Publish a fixed patch version and deprecate the bad one:

  ```bash
  npm deprecate @adaptive-router/sdk@0.1.0 "Broken build, use 0.1.1"
  ```

- **`workspace:*` leaked into a published manifest.** Every install of that
  package is broken. Publish a patch immediately and deprecate.

- **`403Forbidden`.** The scope does not exist, or you are not a member. Run
  `npm org create adaptive-router`.

- **`402 Payment Required`.** npm thinks you are publishing a private scoped
  package. Confirm `publishConfig.access` is `"public"`.
