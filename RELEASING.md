# Releasing

How to publish `@adaptive-router/*` to npm. Publishing is **irreversible** — npm
forbids unpublishing after 24 hours, and a version number can never be reused.
Read the whole file before running anything.

## Current state

All four packages are published on npm. First release: 0.1.0 on 2026-09-18.

| Package | Version | On npm |
| --- | --- | --- |
| `@adaptive-router/sdk` | 0.1.0 | ✅ published |
| `@adaptive-router/dashboard` | 0.1.0 | ✅ published |
| `@adaptive-router/cli` | 0.1.0 | ✅ published |
| `@adaptive-router/control-plane` | 0.1.0 | ✅ published |

Versions are **fixed across the workspace** — all four move together. This keeps
compatibility trivial to reason about: `sdk@0.1.0` pairs with `cli@0.1.0`.

## One-time setup

**Done (2026-08-04):** the `@adaptive-router` org exists, created with npm's
default `Developers` team. Free orgs can only publish public packages — which is
exactly what we want here.

What still has to happen **on the machine doing the publish**: creating the org
in a browser does not write local credentials. Confirm with:

```bash
npm whoami     # ENEEDAUTH means this machine is not authenticated
```

Each package already declares `publishConfig.access: "public"`, so scoped
packages publish publicly without extra flags.

### Authentication: use a granular token, not a classic one

**Classic tokens can no longer publish directly.** Even a token created with the
"Publish" type fails on an account with 2FA enabled:

```
npm error code EOTP
npm error This operation requires a one-time password from your authenticator.
```

npm states this plainly on any authenticated call:

> npm tokens that bypass 2FA are being restricted for account changes and
> **direct publishing** — <https://gh.io/npm-gat-bypass2fa-deprecation>

This is a platform policy change, not a misconfiguration — it happens even when
the account is an org owner and the token really is a publish token. Three ways
forward, in order of preference:

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
   durable option, but it needs a workflow plus configuration on the npm side.

Never commit a token. `~/.npmrc` is the only place it belongs, and it is outside
the repo. Remove it once publishing is done if the machine is shared.

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

## Publish from `main`, not from a feature branch

A published version is permanent, so the code behind `@adaptive-router/sdk@0.1.0`
must be reachable on `main` forever. Publishing from a branch that later gets
squashed or amended leaves a version on npm that corresponds to no commit
anyone can find.

So: **merge the release-prep PR first, then publish from `main`.**

```bash
git checkout main
git pull
git status --porcelain    # must be empty; pnpm publish refuses a dirty tree
```

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

`--no-git-checks` skips pnpm's branch and upstream assertions. It does **not**
excuse a dirty tree — verify that yourself with `git status --porcelain` (the
pre-publish checklist covers it), and only ever publish from `main`.

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
