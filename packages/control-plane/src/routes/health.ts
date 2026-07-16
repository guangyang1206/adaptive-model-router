// GET /health (Spec §4.5, P1). Public readiness probe:
//   - DB reachable?         (SELECT 1)
//   - migrations applied?    (latest expected version present in schema_migrations)
//   - auth configured?       (secret + baseURL present — checked at config build)
//
// Content negotiation: `Accept: text/html` → the human-readable health page
// (frontend's renderHealthHtml); otherwise a JSON envelope. Always 200 when the
// process is up enough to answer; the `ok` flag + components carry the real
// signal so a load balancer can page on `ok:false` without a hard 5xx crash.

import type { IncomingMessage, ServerResponse } from "node:http"
import type { Sql } from "../db/client.js"
import { migrationStatus } from "../db/migrate.js"
import { renderHealthHtml, type HealthComponent } from "../views/index.js"
import { ok } from "../envelope.js"

type SendJson = (res: ServerResponse, status: number, body: unknown) => void
type SendHtml = (res: ServerResponse, status: number, html: string) => void

function wantsHtml(req: IncomingMessage): boolean {
  const accept = req.headers["accept"]
  const value = Array.isArray(accept) ? accept.join(",") : accept ?? ""
  return value.includes("text/html")
}

/** Build the component list. Never throws — DB errors become ok:false rows. */
async function buildComponents(sql: Sql, authConfigured: boolean): Promise<HealthComponent[]> {
  const components: HealthComponent[] = []

  // 1. DB reachable
  let dbOk = false
  try {
    await sql`SELECT 1`
    dbOk = true
  } catch (error) {
    components.push({ name: "database", ok: false, detail: error instanceof Error ? error.message : "unreachable" })
  }
  if (dbOk) components.push({ name: "database", ok: true })

  // 2. Migrations applied (only meaningful if DB is reachable)
  if (dbOk) {
    try {
      const status = await migrationStatus(sql)
      components.push({
        name: "migrations",
        ok: status.upToDate,
        detail: status.upToDate ? `${status.applied.length} applied` : `pending: expected ${status.expected.length}, applied ${status.applied.length}`,
      })
    } catch (error) {
      components.push({ name: "migrations", ok: false, detail: error instanceof Error ? error.message : "unknown" })
    }
  } else {
    components.push({ name: "migrations", ok: false, detail: "skipped (database unreachable)" })
  }

  // 3. Auth configured (secret/baseURL validated at config build time)
  components.push({ name: "auth", ok: authConfigured, detail: authConfigured ? "configured" : "missing secret/baseURL" })

  return components
}

export async function handleHealth(
  sql: Sql,
  authConfigured: boolean,
  req: IncomingMessage,
  res: ServerResponse,
  sendJson: SendJson,
  sendHtml: SendHtml,
): Promise<void> {
  const components = await buildComponents(sql, authConfigured)
  const healthy = components.every((c) => c.ok)

  if (wantsHtml(req)) {
    return sendHtml(res, 200, renderHealthHtml({ ok: healthy, components }))
  }
  return sendJson(res, 200, ok({ ok: healthy, components }))
}
