// Remove stale build artifacts from dist/ before a build.
//
// Why this exists: `tsc` only overwrites the files it emits. When a source file
// is deleted, its compiled output stays behind in dist/ forever — and then
// ships in the published tarball. This was a real bug: a removed test left
// `dist/index.test.js` behind, which then got published inside the SDK package.
//
// Why it prunes files instead of removing the whole directory: deleting a
// directory tree is the kind of operation sandboxes and safe-delete shims
// block, and it is genuinely riskier. Walking dist/ and dropping only the
// artifacts whose source no longer exists is both safer and more precise.
import { existsSync, readdirSync, rmSync, statSync } from "node:fs"
import { join, relative } from "node:path"

const DIST = "dist"
const SRC = "src"

/** Every file under `dir`, as paths relative to `dir`. */
function walk(dir, base = dir) {
  if (!existsSync(dir)) return []
  const out = []
  for (const name of readdirSync(dir)) {
    const full = join(dir, name)
    if (statSync(full).isDirectory()) out.push(...walk(full, base))
    else out.push(relative(base, full))
  }
  return out
}

/**
 * Map an emitted artifact back to the source file that would produce it.
 * dist/foo/bar.js | .d.ts | .js.map | .d.ts.map->  src/foo/bar.ts
 * Returns null for non-emitted assets (e.g. copied .sql migrations), which are
 * left alone — they are placed there deliberately by a build step.
 */
function sourceFor(rel) {
  const stem = rel.replace(/\.(d\.ts\.map|d\.ts|js\.map|js)$/, "")
  if (stem === rel) return null
  return join(SRC, `${stem}.ts`)
}

let pruned = 0
for (const rel of walk(DIST)) {
  const src = sourceFor(rel)
  if (!src || existsSync(src)) continue
  rmSync(join(DIST, rel), { force: true })
  pruned++
}

if (pruned > 0) {
  // eslint-disable-next-line no-console
  console.log(`[clean] pruned ${pruned} stale artifact(s) from ${DIST}/`)
}
