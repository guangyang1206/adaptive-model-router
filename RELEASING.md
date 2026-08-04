# Releasing

How to publish `@adaptive-router/*` to npm. Publishing is **irreversible** — npm
forbids unpublishing after 24 hours, and a version number can never be reused.
Read the whole file before running anything.

## Current state

| Package | Version | On npm |
| --- | --- | --- |
| `@adaptive-router/sdk` | 0.1.0 | not yet |
| `@adaptive-router/dashboard` | 0.1.0 | not yet |
| `@adaptive-router/cli` | 0.1.0 | not yet |
| `@adaptive-router/control-plane` | 0.1.0 | not yet |

Versions are **fixed across the workspace** — all four move together. This keeps
compatibility trivial to reason about: `sdk@0.1.0` pairs with `cli@0.1.0`.

## One-time setup

The `@adaptive-router` scope must exist before the first publish.

```bash
npm login                      # authenticate
npm org create adaptive-router # free org; only allows public packages, which is what we want
npm whoami                     # confirm
```

Each package already declares `publishConfig.access: "public"`, so scoped
packages publish publicly without extra flags.

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
cd packages/sdk           && pnpm publish --access public
cd ../dashboard           && pnpm publish --access public
cd ../cli                 && pnpm publish --access public
cd ../control-plane       && pnpm publish --access public
```

Add `--dry-run` first if you want npm's own view of what would be uploaded.

`pnpm publish` refuses to run on a dirty working tree and rewrites `workspace:*`
automatically. Do not use `npm publish` here — it does not understand
`workspace:*` and would publish a broken manifest.

## After publishing

1. **Verify from the registry, not from cache.**

   ```bash
   npm view @adaptive-router/sdk version
   cd /tmp && rm -rf postcheck && mkdir postcheck && cd postcheck
   npm init -y >/dev/null && npm install @adaptive-router/sdk
   ```

2. **Tag the release.**

   ```bash
   git tag -a v0.1.0 -m "v0.1.0 — first published release"
   git push origin v0.1.0
   ```

3. **Simplify the install docs.** `docs/en/quickstart.md`, `docs/zh/quickstart.md`,
   and `README.md` currently carry an honest "not on npm yet, build from source"
   callout. Once the packages resolve, collapse that section back to one line:

   ```bash
   pnpm add @adaptive-router/sdk
   ```

   Keep the build-from-source path as a secondary option for contributors.

4. **Update `ROADMAP.md`** — check off the items under
   *Distribution — not shipped* and retitle the section.

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
