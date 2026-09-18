// Locks the bin entrypoint contract for @adaptive-router/control-plane.
//
// Regression guard for a P0 that shipped in 0.1.0: main-module detection compared
// the *basename* of process.argv[1] against import.meta.url. Under the installed
// bin argv[1] is `node_modules/.bin/adaptive-control-plane`, whose basename is the
// bin name and never matches "server.js" — so bootstrap() was skipped and the
// process exited 0 having printed nothing. Users saw "nothing happened, success".
//
// These tests execute the bin THROUGH AN npm-SHAPED SYMLINK. Importing the module
// and calling bootstrap() directly reports green against the broken code, which is
// precisely why the bug reached npm; do not "simplify" these into import tests.

import { test } from "node:test"
import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import { existsSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs"
import { dirname, join, resolve } from "node:path"
import { tmpdir } from "node:os"
import { fileURLToPath, pathToFileURL } from "node:url"

const pkgRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..")
const serverJs = join(pkgRoot, "dist", "server.js")
const BIN_NAME = "adaptive-control-plane"
const SPAWN_TIMEOUT_MS = 30_000

/**
 * Reproduce npm's install layout in a throwaway directory:
 *   node_modules/@adaptive-router/control-plane -> <pkgRoot>
 *   node_modules/.bin/adaptive-control-plane    -> ../@adaptive-router/control-plane/dist/server.js
 * The relative .bin link pointing through a linked package directory is what npm
 * and pnpm actually write, and it is what makes argv[1] differ from the module's
 * own path.
 */
function createBinLayout() {
  const root = mkdtempSync(join(tmpdir(), "adaptive-cp-bin-"))
  const scope = join(root, "node_modules", "@adaptive-router")
  mkdirSync(scope, { recursive: true })
  symlinkSync(pkgRoot, join(scope, "control-plane"), "dir")

  const binDir = join(root, "node_modules", ".bin")
  mkdirSync(binDir, { recursive: true })
  const binPath = join(binDir, BIN_NAME)
  symlinkSync(join("..", "@adaptive-router", "control-plane", "dist", "server.js"), binPath, "file")

  return { root, binPath }
}

/**
 * Env with every required var removed so loadEnv() must fail fast on DATABASE_URL
 * (its first gate). PATH is preserved on purpose: the bin is launched through its
 * own `#!/usr/bin/env node` shebang.
 */
function envWithoutRequiredVars() {
  const env = { ...process.env }
  delete env.DATABASE_URL
  delete env.BETTER_AUTH_SECRET
  delete env.BETTER_AUTH_URL
  return env
}

function run(command, args, cwd) {
  const result = spawnSync(command, args, {
    cwd,
    env: envWithoutRequiredVars(),
    encoding: "utf8",
    timeout: SPAWN_TIMEOUT_MS,
    killSignal: "SIGKILL",
  })
  if (result.error) assert.fail(`spawn failed: ${result.error.message}`)
  // A boot that binds a port instead of failing would only come back via the
  // timeout kill. This repo has had server tests wedge CI, so surface a hang as
  // a hang rather than as a confusing exit code.
  assert.equal(result.signal, null, `process did not self-terminate (killed by ${result.signal})`)
  return { status: result.status, output: `${result.stdout}${result.stderr}` }
}

test("dist/server.js exists (tests run against build output)", () => {
  assert.ok(
    existsSync(serverJs),
    `${serverJs} is missing — run \`pnpm --filter @adaptive-router/control-plane build\` first`,
  )
})

test("bin launched via the npm .bin symlink fails fast on missing DATABASE_URL", (t) => {
  const { root, binPath } = createBinLayout()
  t.after(() => rmSync(root, { recursive: true, force: true }))

  const { status, output } = run(binPath, [], root)

  // The two signatures of the shipped bug, asserted separately so a failure says
  // which half regressed.
  assert.notEqual(output.trim(), "", "bin produced no output at all (the 0.1.0 silent no-op)")
  assert.notEqual(status, 0, "bin exited 0 without booting — bootstrap() was never called")

  assert.equal(status, 1)
  assert.match(output, /\[control-plane\] failed to start:/)
  assert.match(output, /DATABASE_URL/)
})

test("the .bin path passed to an explicit `node` invocation also boots", (t) => {
  const { root, binPath } = createBinLayout()
  t.after(() => rmSync(root, { recursive: true, force: true }))

  // Same argv[1] shape as the shebang route, but independent of PATH and of the
  // build's `chmod +x`, so the guard stays meaningful where a shebang is not
  // honoured (e.g. Windows runners).
  const { status, output } = run(process.execPath, [binPath], root)

  assert.equal(status, 1)
  assert.match(output, /\[control-plane\] failed to start:/)
  assert.match(output, /DATABASE_URL/)
})

test("importing the module does not boot a server", (t) => {
  const root = mkdtempSync(join(tmpdir(), "adaptive-cp-import-"))
  t.after(() => rmSync(root, { recursive: true, force: true }))

  // Use a real file on disk as the entrypoint rather than `node --eval`: that is
  // the realistic import case (a test runner or host app owns argv[1]) and it
  // keeps realpathSync(argv[1]) resolvable, so the check is actually exercised
  // instead of short-circuiting on an absent argv[1].
  const importer = join(root, "importer.mjs")
  writeFileSync(
    importer,
    [
      `const mod = await import(${JSON.stringify(pathToFileURL(serverJs).href)})`,
      `console.log(typeof mod.bootstrap === "function" ? "IMPORT_OK" : "MISSING_BOOTSTRAP_EXPORT")`,
      "",
    ].join("\n"),
    "utf8",
  )

  const { status, output } = run(process.execPath, [importer], root)

  assert.equal(status, 0, `import should be side-effect free, got exit ${status}: ${output}`)
  assert.match(output, /IMPORT_OK/)
  assert.doesNotMatch(output, /failed to start/, "bootstrap() ran on import — the main-module guard is too loose")
  assert.doesNotMatch(output, /ready on/, "a server was started on import")
})
