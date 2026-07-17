// ===========================================================================
// Dependency-boundary assertion (Spec §3, acceptance A13). Machine-enforced.
//
// Guarantees, on every commit / in CI:
//   1. @adaptive-router/sdk        -> dependencies === {} (zero-dep, forever)
//   2. @adaptive-router/dashboard  -> deps ⊆ { @adaptive-router/sdk }
//   3. @adaptive-router/cli        -> deps ⊆ { @adaptive-router/sdk }
//   4. @adaptive-router/control-plane -> deps ⊆
//        { @adaptive-router/sdk, @adaptive-router/dashboard, better-auth, postgres, pg }
//        (pg backs the Better-Auth Kysely PostgresDialect, which needs a
//         node-postgres Pool; postgres.js still backs every one of OUR queries.)
//   5. All workspace deps pinned to "workspace:*".
//
// Exit non-zero (red build) on any violation. No dependencies of its own.
// ===========================================================================

import { readFileSync } from "node:fs"

const read = (p) => JSON.parse(readFileSync(new URL(p, import.meta.url)))
const deps = (pkg) => Object.keys(pkg.dependencies || {})
const fail = (m) => {
  console.error("\u2717 dependency boundary VIOLATED:", m)
  process.exit(1)
}

// 1. SDK: zero runtime dependencies, forever.
const sdk = read("../packages/sdk/package.json")
if (deps(sdk).length) fail(`sdk must have zero deps, found: ${deps(sdk).join(", ")}`)

// 2 + 3. dashboard / cli: workspace-only allowlist.
const wsOnly = {
  dashboard: ["@adaptive-router/sdk"],
  cli: ["@adaptive-router/sdk"],
}
for (const [name, allow] of Object.entries(wsOnly)) {
  const pkg = read(`../packages/${name}/package.json`)
  const extra = deps(pkg).filter((d) => !allow.includes(d))
  if (extra.length) fail(`${name} may only depend on ${allow.join(", ")}; found extra: ${extra.join(", ")}`)
  for (const d of allow) {
    if (pkg.dependencies?.[d] && pkg.dependencies[d] !== "workspace:*") {
      fail(`${name}.${d} must be "workspace:*", found "${pkg.dependencies[d]}"`)
    }
  }
}

// 4. control-plane: the ONLY package allowed cloud deps, from a fixed allowlist.
const cpAllow = ["@adaptive-router/sdk", "@adaptive-router/dashboard", "better-auth", "postgres", "pg"]
const cp = read("../packages/control-plane/package.json")
const cpExtra = deps(cp).filter((d) => !cpAllow.includes(d))
if (cpExtra.length) fail(`control-plane deps not in allowlist: ${cpExtra.join(", ")}`)
for (const d of ["@adaptive-router/sdk", "@adaptive-router/dashboard"]) {
  if (cp.dependencies?.[d] && cp.dependencies[d] !== "workspace:*") {
    fail(`control-plane.${d} must be "workspace:*", found "${cp.dependencies[d]}"`)
  }
}

console.log("\u2713 dependency boundary OK")
