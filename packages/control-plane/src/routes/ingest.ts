// POST /ingest/traces (Spec §4.1, impl-design §4). The ONLY unauthenticated-by-
// session endpoint: it authenticates via a per-project ingest token (Bearer),
// NOT a login session. Flow:
//   1. Parse `Authorization: Bearer <token>` → sha256 hash.
//   2. Look up the hash in ingest_tokens (UNIQUE idx, O(1)).
//      - unknown  → 401 (nothing inserted, A12).
//      - revoked  → 403 (nothing inserted, A12).
//   3. SERVER-DERIVE project_id from the token row (the client never sends it —
//      a token can only ever write to its own project, A4/A5).
//   4. Validate the body is a RouterTrace-shaped object (traceId required).
//   5. INSERT via the project-scoped trace store (ON CONFLICT DO NOTHING → the
//      SDK's fire-and-forget retries are idempotent).
//   6. Best-effort UPDATE ingest_tokens.last_used_at.
//   7. 200 { code:"OK", data:{ traceId } }.

import type { IncomingMessage, ServerResponse } from "node:http"
import type { RouterTrace } from "@adaptive-router/sdk"
import type { Sql } from "../db/client.js"
import { createPostgresTraceStore } from "../data/pg-trace-store.js"
import { hashToken, parseBearer } from "../tokens.js"
import { ok, err } from "../envelope.js"
import { readBody } from "../auth/handler.js"

/** Minimal structural validation: a RouterTrace MUST have a string traceId. */
function isRouterTraceLike(value: unknown): value is RouterTrace {
  if (typeof value !== "object" || value === null) return false
  const v = value as Record<string, unknown>
  return typeof v.traceId === "string" && v.traceId.length > 0 && typeof v.decisionId === "string"
}

type SendJson = (res: ServerResponse, status: number, body: unknown) => void

type TokenRow = { id: string; project_id: string; revoked_at: string | null }

/**
 * Handle POST /ingest/traces. `sendJson` is injected by the server so the
 * envelope wrapping stays in one place.
 */
export async function handleIngest(sql: Sql, req: IncomingMessage, res: ServerResponse, sendJson: SendJson): Promise<void> {
  if (req.method !== "POST") {
    return sendJson(res, 405, err("method not allowed"))
  }

  const token = parseBearer(req.headers["authorization"])
  if (!token) {
    return sendJson(res, 401, err("missing or malformed ingest token"))
  }

  const tokenHash = hashToken(token)
  const rows = await sql<TokenRow[]>`
    SELECT id, project_id, revoked_at FROM ingest_tokens WHERE token_hash = ${tokenHash} LIMIT 1
  `
  const row = rows[0]
  if (!row) {
    // Unknown token — nothing inserted (A12).
    return sendJson(res, 401, err("unknown ingest token"))
  }
  if (row.revoked_at !== null) {
    // Revoked token — nothing inserted (A12).
    return sendJson(res, 403, err("ingest token revoked"))
  }

  // Parse + validate body AFTER auth so we never reveal parse detail to an
  // unauthenticated caller.
  let parsed: unknown
  try {
    const raw = await readBody(req)
    parsed = raw ? JSON.parse(raw) : undefined
  } catch {
    return sendJson(res, 400, err("invalid JSON body"))
  }
  if (!isRouterTraceLike(parsed)) {
    return sendJson(res, 400, err("body is not a RouterTrace (missing traceId/decisionId)"))
  }

  // project_id is SERVER-DERIVED from the token — the client cannot target
  // another project (structural A4/A5). Scoped store bakes the predicate in.
  const store = createPostgresTraceStore(sql, row.project_id)
  await store.writeTrace(parsed)

  // Best-effort touch; a failure here must not fail the ingest.
  try {
    await sql`UPDATE ingest_tokens SET last_used_at = now() WHERE id = ${row.id}`
  } catch {
    // ignore
  }

  return sendJson(res, 200, ok({ traceId: parsed.traceId }))
}
