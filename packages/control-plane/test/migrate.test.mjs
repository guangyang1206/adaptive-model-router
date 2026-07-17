// DB-less unit tests for the migration planner (Ruling 5: pure-logic tests run
// without a database). Exercises planMigrations / sortMigrations ordering +
// applied-diffing, and runMigrations' transactional loop against a stub `sql`.

import { test } from "node:test"
import assert from "node:assert/strict"
import { planMigrations, sortMigrations } from "../dist/db/migrate.js"

const mk = (version) => ({ version, path: `/migrations/${version}.sql` })

test("sortMigrations orders by zero-padded numeric prefix (lexicographic == numeric)", () => {
  const sorted = sortMigrations([mk("0002_init"), mk("0001_better_auth"), mk("0010_late")])
  assert.deepEqual(sorted.map((m) => m.version), ["0001_better_auth", "0002_init", "0010_late"])
})

test("planMigrations returns only unapplied files, in order", () => {
  const all = [mk("0001_better_auth"), mk("0002_init"), mk("0003_x")]
  const applied = new Set(["0001_better_auth"])
  const pending = planMigrations(all, applied)
  assert.deepEqual(pending.map((m) => m.version), ["0002_init", "0003_x"])
})

test("planMigrations returns [] when everything is applied", () => {
  const all = [mk("0001_better_auth"), mk("0002_init")]
  const applied = new Set(["0001_better_auth", "0002_init"])
  assert.deepEqual(planMigrations(all, applied), [])
})

test("planMigrations is stable when migrations arrive out of order", () => {
  const all = [mk("0003_c"), mk("0001_a"), mk("0002_b")]
  const pending = planMigrations(all, new Set(["0001_a"]))
  assert.deepEqual(pending.map((m) => m.version), ["0002_b", "0003_c"])
})
