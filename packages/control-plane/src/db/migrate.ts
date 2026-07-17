// Migration runner: hand-written SQL files + a schema_migrations version table.
// No ORM. Append-only: migration files are never edited after merge.
//
// Algorithm (Spec §5 / impl-design §2.1):
//   1. CREATE TABLE IF NOT EXISTS schema_migrations (bootstrap).
//   2. List db/migrations/*.sql sorted ascending (numeric prefix = order).
//   3. SELECT applied versions.
//   4. For each not-yet-applied file, INSIDE A TRANSACTION: run the file SQL,
//      then INSERT the version row. Commit. Any error -> rollback + abort loud.
//
// The pure ordering/diffing logic is factored into `planMigrations` so it can be
// unit-tested WITHOUT a database (Ruling 5, DB-less test).

import { readdirSync, readFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import type { Sql } from "./client.js"

export type MigrationFile = {
  /** Version = filename without extension, e.g. "0001_better_auth". */
  version: string
  /** Absolute path to the .sql file. */
  path: string
}

/**
 * Pure planner: given the full ordered migration list and the set of already
 * applied versions, return the migrations that still need to run, in order.
 * No I/O — unit-testable.
 */
export function planMigrations(all: MigrationFile[], applied: Set<string>): MigrationFile[] {
  return sortMigrations(all).filter((m) => !applied.has(m.version))
}

/**
 * Deterministic ascending sort by version string. The zero-padded numeric
 * prefix (0001_, 0002_) guarantees correct lexicographic == numeric order.
 * Pure — unit-testable.
 */
export function sortMigrations(all: MigrationFile[]): MigrationFile[] {
  return [...all].sort((a, b) => (a.version < b.version ? -1 : a.version > b.version ? 1 : 0))
}

/** Resolve the migrations directory relative to this module (works from dist/). */
export function migrationsDir(): string {
  return join(dirname(fileURLToPath(import.meta.url)), "migrations")
}

/** Read the on-disk migration files (version + path), unsorted. */
export function readMigrationFiles(dir: string = migrationsDir()): MigrationFile[] {
  return readdirSync(dir)
    .filter((name) => name.endsWith(".sql"))
    .map((name) => ({ version: name.replace(/\.sql$/, ""), path: join(dir, name) }))
}

/**
 * Run all pending migrations transactionally. Idempotent: safe on every boot
 * and on restart (A8) — only unseen files apply. Returns the versions applied
 * in this run.
 */
export async function runMigrations(sql: Sql, dir: string = migrationsDir()): Promise<string[]> {
  await sql`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version    text PRIMARY KEY,
      applied_at timestamptz NOT NULL DEFAULT now()
    )
  `

  const appliedRows = await sql<{ version: string }[]>`SELECT version FROM schema_migrations`
  const applied = new Set(appliedRows.map((r) => r.version))
  const pending = planMigrations(readMigrationFiles(dir), applied)

  const ranNow: string[] = []
  for (const migration of pending) {
    const rawSql = readFileSync(migration.path, "utf8")
    // Per-file transaction: run the file, record the version, commit atomically.
    await sql.begin(async (tx) => {
      await tx.unsafe(rawSql)
      await tx`INSERT INTO schema_migrations (version) VALUES (${migration.version})`
    })
    ranNow.push(migration.version)
  }
  return ranNow
}

/**
 * Report which versions are applied and whether the on-disk latest is present.
 * Used by /health (P1) to answer "migrations applied?".
 */
export async function migrationStatus(
  sql: Sql,
  dir: string = migrationsDir(),
): Promise<{ applied: string[]; expected: string[]; upToDate: boolean }> {
  const expected = sortMigrations(readMigrationFiles(dir)).map((m) => m.version)
  let applied: string[] = []
  try {
    const rows = await sql<{ version: string }[]>`SELECT version FROM schema_migrations ORDER BY version ASC`
    applied = rows.map((r) => r.version)
  } catch {
    applied = []
  }
  const appliedSet = new Set(applied)
  const upToDate = expected.every((v) => appliedSet.has(v))
  return { applied, expected, upToDate }
}
