// Management API: per-project ingest tokens (Spec §4.3).
//   GET    /api/projects/:projectId/tokens             session + project member
//   POST   /api/projects/:projectId/tokens             session + OWNER  (plaintext once)
//   DELETE /api/projects/:projectId/tokens/:tokenId    session + OWNER  (soft delete)
//
// The token plaintext is generated + shown EXACTLY once (on create); only its
// sha256 hash is persisted. Revoke is a soft delete (set revoked_at) so the
// ingest path can 403 a known-but-revoked token distinctly from an unknown one.

import type { ServerResponse } from "node:http"
import type { Sql } from "../db/client.js"
import type { AuthContext } from "../auth/middleware.js"
import { canAccessProject, ownsProject } from "../auth/scope.js"
import { generateToken, hashToken, maskToken } from "../tokens.js"
import { ok, err } from "../envelope.js"

type SendJson = (res: ServerResponse, status: number, body: unknown) => void

type TokenRow = {
  id: string
  token_hash: string
  created_at: string
  last_used_at: string | null
  revoked_at: string | null
}

// --- GET /api/projects/:projectId/tokens (project member) ------------------
async function listTokens(sql: Sql, res: ServerResponse, ctx: AuthContext, projectId: string, sendJson: SendJson): Promise<void> {
  // Cross-project probe → 403, never a leak (A6).
  if (!canAccessProject(ctx.scope, projectId)) return sendJson(res, 403, err("forbidden"))
  const rows = await sql<TokenRow[]>`
    SELECT id, token_hash, created_at, last_used_at, revoked_at
    FROM ingest_tokens WHERE project_id = ${projectId}
    ORDER BY created_at DESC
  `
  const data = rows.map((t) => ({
    id: t.id,
    masked: maskToken(t.token_hash), // never the plaintext or full hash
    createdAt: t.created_at,
    lastUsedAt: t.last_used_at ?? undefined,
    revokedAt: t.revoked_at ?? undefined,
  }))
  return sendJson(res, 200, ok(data))
}

// --- POST /api/projects/:projectId/tokens (OWNER) --------------------------
async function createToken(sql: Sql, res: ServerResponse, ctx: AuthContext, projectId: string, sendJson: SendJson): Promise<void> {
  if (!canAccessProject(ctx.scope, projectId)) return sendJson(res, 403, err("forbidden"))
  if (!ownsProject(ctx.scope, projectId)) return sendJson(res, 403, err("owner role required"))
  const plaintext = generateToken()
  const tokenHash = hashToken(plaintext)
  const inserted = await sql<{ id: string }[]>`
    INSERT INTO ingest_tokens (project_id, token_hash)
    VALUES (${projectId}, ${tokenHash})
    RETURNING id
  `
  const id = inserted[0].id
  // Plaintext returned ONCE. The client must store it now; it is never
  // retrievable again (we only kept the hash).
  return sendJson(res, 201, ok({ id, token: plaintext }))
}

// --- DELETE /api/projects/:projectId/tokens/:tokenId (OWNER) ---------------
async function revokeToken(sql: Sql, res: ServerResponse, ctx: AuthContext, projectId: string, tokenId: string, sendJson: SendJson): Promise<void> {
  if (!canAccessProject(ctx.scope, projectId)) return sendJson(res, 403, err("forbidden"))
  if (!ownsProject(ctx.scope, projectId)) return sendJson(res, 403, err("owner role required"))
  // Scope the update to the project so a token id from another project can't be
  // revoked through this project's path.
  const updated = await sql<{ id: string }[]>`
    UPDATE ingest_tokens SET revoked_at = now()
    WHERE id = ${tokenId} AND project_id = ${projectId} AND revoked_at IS NULL
    RETURNING id
  `
  if (updated.length === 0) return sendJson(res, 404, err("token not found or already revoked"))
  return sendJson(res, 200, ok({ id: tokenId, revoked: true }))
}

/**
 * Dispatch /api/projects/:projectId/tokens[/:tokenId]. Returns true when
 * handled. Ownership/scope checks live in the sub-handlers.
 */
export async function handleProjectsApi(
  sql: Sql,
  ctx: AuthContext,
  method: string,
  pathname: string,
  res: ServerResponse,
  sendJson: SendJson,
): Promise<boolean> {
  const collection = /^\/api\/projects\/([^/]+)\/tokens$/.exec(pathname)
  if (collection) {
    const projectId = decodeURIComponent(collection[1])
    if (method === "GET") { await listTokens(sql, res, ctx, projectId, sendJson); return true }
    if (method === "POST") { await createToken(sql, res, ctx, projectId, sendJson); return true }
    sendJson(res, 405, err("method not allowed")); return true
  }

  const item = /^\/api\/projects\/([^/]+)\/tokens\/([^/]+)$/.exec(pathname)
  if (item) {
    const projectId = decodeURIComponent(item[1])
    const tokenId = decodeURIComponent(item[2])
    if (method === "DELETE") { await revokeToken(sql, res, ctx, projectId, tokenId, sendJson); return true }
    sendJson(res, 405, err("method not allowed")); return true
  }

  return false
}
