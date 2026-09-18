// Locks the bin entrypoint contract for @adaptive-router/cli, matching the
// control-plane guard so the repo has one entry convention rather than two.
//
// The CLI shipped 0.1.0 with no main-module check at all: `main()` ran at module
// load. The bin therefore worked (unlike control-plane), but package.json also
// points "main" at this same file, so `import "@adaptive-router/cli"` executed the
// CLI and printed usage to stdout. Adding the guard closes that; these tests exist
// to prove the guard did not break the bin path in the process.

import { test } from "node:test"
import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import { existsSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs"
import { dirname, join, resolve } from "node:path"
import { tmpdir } from "node:os"
import { fileURLToPath, pathToFileURL } from "node:url"

const pkgRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..")
const indexJs = join(pkgRoot, "dist", "index.js")
const BIN_NAME = "adaptive-router"
const SPAWN_TIMEOUT_MS = 30_000

/**
 * npm's install layout in a throwaway directory:
 *   node_modules/@adaptive-router/cli     -> <pkgRoot>
 *   node_modules/.bin/adaptive-router     -> ../@adaptive-router/cli/dist/index.js
 * argv[1] is then the .bin link, whose basename is the bin name — the exact shape
 * that broke control-plane's detection.
 */
function createBinLayout() {
  const root = mkdtempSync(join(tmpdir(), "adaptive-cli-bin-"))
  const scope = join(root, "node_modules", "@adaptive-router")
  mkdirSync(scope, { recursive: true })
  symlinkSync(pkgRoot, join(scope, "cli"), "dir")

  const binDir = join(root, "node_modules", ".bin")
  mkdirSync(binDir, { recursive: true })
  const binPath = join(binDir, BIN_NAME)
  symlinkSync(join("..", "@adaptive-router", "cli", "dist", "index.js"), binPath, "file")

  return { root, binPath }
}

function run(command, args, cwd) {
  const result = spawnSync(command, args, {
    cwd,
    env: process.env,
    encoding: "utf8",
    timeout: SPAWN_TIMEOUT_MS,
    killSignal: "SIGKILL",
  })
  if (result.error) assert.fail(`spawn failed: ${result.error.message}`)
  assert.equal(result.signal, null, `process did not self-terminate (killed by ${result.signal})`)
  return { status: result.status, output: `${result.stdout}${result.stderr}` }
}

test("dist/index.js exists (tests run against build output)", () => {
  assert.ok(existsSync(indexJs), `${indexJs} is missing — run \`pnpm --filter @adaptive-router/cli build\` first`)
})

test("bin launched via the npm .bin symlink prints usage for --help", (t) => {
  const { root, binPath } = createBinLayout()
  t.after(() => rmSync(root, { recursive: true, force: true }))

  const { status, output } = run(binPath, ["--help"], root)

  assert.equal(status, 0, `--help should exit 0, got ${status}: ${output}`)
  assert.match(output, /Adaptive Model Router CLI/)
  assert.match(output, /adaptive-router init/)
})

test("bin reports unknown commands with a non-zero exit", (t) => {
  const { root, binPath } = createBinLayout()
  t.after(() => rmSync(root, { recursive: true, force: true }))

  // Confirms argv actually reaches the dispatcher through the bin, not just that
  // some output appeared.
  const { status, output } = run(binPath, ["no-such-command"], root)

  assert.equal(status, 1)
  assert.match(output, /Unknown command: no-such-command/)
})

test("importing the module does not run the CLI", (t) => {
  const root = mkdtempSync(join(tmpdir(), "adaptive-cli-import-"))
  t.after(() => rmSync(root, { recursive: true, force: true }))

  const importer = join(root, "importer.mjs")
  writeFileSync(
    importer,
    [`await import(${JSON.stringify(pathToFileURL(indexJs).href)})`, `console.log("IMPORT_OK")`, ""].join("\n"),
    "utf8",
  )

  const { status, output } = run(process.execPath, [importer], root)

  assert.equal(status, 0, `import should be side-effect free, got exit ${status}: ${output}`)
  assert.match(output, /IMPORT_OK/)
  assert.doesNotMatch(output, /Adaptive Model Router CLI/, "the CLI ran on import — the main-module guard is too loose")
})
