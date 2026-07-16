// Copy the hand-written SQL migration files into dist/ after tsc emit. `tsc`
// only compiles .ts, so the *.sql files that migrate.ts reads at runtime
// (via migrationsDir()) must be copied alongside the emitted JS. Portable
// (no shell cp), runs on every build.

import { mkdirSync, readdirSync, copyFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"

const here = dirname(fileURLToPath(import.meta.url))
const srcDir = join(here, "..", "src", "db", "migrations")
const outDir = join(here, "..", "dist", "db", "migrations")

mkdirSync(outDir, { recursive: true })
let copied = 0
for (const name of readdirSync(srcDir)) {
  if (!name.endsWith(".sql")) continue
  copyFileSync(join(srcDir, name), join(outDir, name))
  copied++
}
// eslint-disable-next-line no-console
console.log(`[control-plane] copied ${copied} migration file(s) to dist/db/migrations`)
