// Management API: organizations, projects-in-org, members, registration toggle
// (Spec §4.3). Ownership rules:
//   GET  /api/orgs                              session
//   POST /api/orgs                              session               (creator = owner)
//   GET  /api/orgs/:orgId/projects             session + org member
//   POST /api/orgs/:orgId/projects             session + OWNER        (auto accent)
//   GET  /api/orgs/:orgId/members              session + org member
//   POST /api/orgs/:orgId/settings/registration session + OWNER
//
// Reads go straight to SQL (project-scoped through the resolved AuthContext);
// org + member CREATION is delegated to Better-Auth's organization plugin so its
// invariants (creator=owner, member rows, slug uniqueness) stay authoritative.

import type { IncomingMessage, ServerResponse } from "node:http"
import type { Sql } from "../db/client.js"
import type { Auth } from "../auth/better-auth.js"
import type { AuthContext } from "../auth/middleware.js"
import { isOrgMember, isOrgOwner } from "../auth/scope.js"
import { toWebHeaders, readBody } from "../auth/handler.js"
import { ok, err } from "../envelope.js"

type SendJson = (res: ServerResponse, status: number, body: unknown) => void

/** Fixed 8-color accent palette (Spec §7). Assigned round-robin per project. */
const ACCENT_PALETTE = ["#3B82F6", "#8B5CF6", "#EC4899", "#F59E0B", "#10B981", "#06B6D4", "#EF4444", "#84CC16"]

function pickAccent(existingCount: number): string {
  return ACCENT_PALETTE[existingCount % ACCENT_PALETTE.length]
}

async function parseJsonBody(req: IncomingMessage): Promise<Record<string, unknown> | null> {
  try {
    const raw = await readBody(req)
    if (!raw) return {}
    const parsed = JSON.parse(raw)
    return typeof parsed === "object" && parsed !== null ? (parsed as Record<string, unknown>) : null
  } catch {
    return null
  }
}

// --- GET /api/orgs ----------------------------------------------------------
// Orgs the user belongs to, with their role. Read from the resolved scope +
// organization names.
async function listOrgs(sql: Sql, res: ServerResponse, ctx: AuthContext, sendJson: SendJson): Promise<void> {
  if (ctx.scope.orgs.length === 0) return sendJson(res, 200, ok([]))
  const rows = await sql<{ id: string; name: string }[]>`
    SELECT id, name FROM "organization" WHERE id IN ${sql(ctx.scope.orgs)}
  `
  const data = rows.map((o) => ({ id: o.id, name: o.name, role: ctx.scope.roleByOrg[o.id] ?? "member" }))
  return sendJson(res, 200, ok(data))
}

// --- POST /api/orgs ---------------------------------------------------------
// Delegate to Better-Auth so the creator becomes owner + a member row is made.
async function createOrg(auth: Auth, req: IncomingMessage, res: ServerResponse, sendJson: SendJson): Promise<void> {
  const body = await parseJsonBody(req)
  if (!body || typeof body.name !== "string" || body.name.trim() === "") {
    return sendJson(res, 400, err("name is required"))
  }
  const name = body.name.trim()
  const slug = typeof body.slug === "string" && body.slug.trim() ? body.slug.trim() : slugify(name)
  try {
    const created = await auth.api.createOrganization({
      body: { name, slug },
      headers: toWebHeaders(req),
    })
    return sendJson(res, 201, ok(created))
  } catch (error) {
    return sendJson(res, 400, err(error instanceof Error ? error.message : "could not create organization"))
  }
}

// --- GET /api/orgs/:orgId/projects -----------------------------------------
async function listProjects(sql: Sql, res: ServerResponse, ctx: AuthContext, orgId: string, sendJson: SendJson): Promise<void> {
  if (!isOrgMember(ctx.scope, orgId)) return sendJson(res, 403, err("forbidden"))
  const rows = await sql<{ id: string; org_id: string; name: string; slug: string; accent: string | null }[]>`
    SELECT id, org_id, name, slug, accent FROM projects WHERE org_id = ${orgId} ORDER BY created_at ASC
  `
  return sendJson(res, 200, ok(rows.map((p) => ({ id: p.id, orgId: p.org_id, name: p.name, slug: p.slug, accent: p.accent ?? undefined }))))
}

// --- POST /api/orgs/:orgId/projects (OWNER only) ---------------------------
async function createProject(sql: Sql, req: IncomingMessage, res: ServerResponse, ctx: AuthContext, orgId: string, sendJson: SendJson): Promise<void> {
  if (!isOrgMember(ctx.scope, orgId)) return sendJson(res, 403, err("forbidden"))
  if (!isOrgOwner(ctx.scope, orgId)) return sendJson(res, 403, err("owner role required"))
  const body = await parseJsonBody(req)
  if (!body || typeof body.name !== "string" || body.name.trim() === "") {
    return sendJson(res, 400, err("name is required"))
  }
  const name = body.name.trim()
  const slug = typeof body.slug === "string" && body.slug.trim() ? body.slug.trim() : slugify(name)
  const countRows = await sql<{ n: string }[]>`SELECT count(*)::text AS n FROM projects WHERE org_id = ${orgId}`
  const accent = pickAccent(Number(countRows[0]?.n ?? "0"))
  try {
    const inserted = await sql<{ id: string; org_id: string; name: string; slug: string; accent: string | null }[]>`
      INSERT INTO projects (org_id, name, slug, accent)
      VALUES (${orgId}, ${name}, ${slug}, ${accent})
      RETURNING id, org_id, name, slug, accent
    `
    const p = inserted[0]
    return sendJson(res, 201, ok({ id: p.id, orgId: p.org_id, name: p.name, slug: p.slug, accent: p.accent ?? undefined }))
  } catch (error) {
    // UNIQUE(org_id, slug) violation → 409.
    const message = error instanceof Error ? error.message : "could not create project"
    const status = /duplicate|unique/i.test(message) ? 409 : 400
    return sendJson(res, status, err(status === 409 ? "a project with this slug already exists" : message))
  }
}

// --- GET /api/orgs/:orgId/members ------------------------------------------
async function listMembers(sql: Sql, res: ServerResponse, ctx: AuthContext, orgId: string, sendJson: SendJson): Promise<void> {
  if (!isOrgMember(ctx.scope, orgId)) return sendJson(res, 403, err("forbidden"))
  const rows = await sql<{ userId: string; role: string; name: string | null; email: string }[]>`
    SELECT m."userId", m."role", u."name", u."email"
    FROM "member" m JOIN "user" u ON u.id = m."userId"
    WHERE m."organizationId" = ${orgId}
    ORDER BY m."createdAt" ASC
  `
  const data = rows.map((r) => ({
    userId: r.userId,
    name: r.name ?? undefined,
    email: r.email,
    role: r.role === "owner" ? "owner" : "member",
    status: "active" as const,
  }))
  return sendJson(res, 200, ok(data))
}

// --- POST /api/orgs/:orgId/settings/registration (OWNER only) --------------
// Registration open/close is a per-org owner control (A1). Persisted on the
// organization row via a metadata json column Better-Auth provides; we store a
// boolean under `registration_open`. Kept minimal: update + echo.
async function setRegistration(sql: Sql, req: IncomingMessage, res: ServerResponse, ctx: AuthContext, orgId: string, sendJson: SendJson): Promise<void> {
  if (!isOrgOwner(ctx.scope, orgId)) return sendJson(res, 403, err("owner role required"))
  const body = await parseJsonBody(req)
  if (!body || typeof body.open !== "boolean") return sendJson(res, 400, err("open (boolean) is required"))
  await sql`
    UPDATE "organization"
    SET metadata = jsonb_set(COALESCE(metadata, '{}')::jsonb, '{registration_open}', ${sql.json(body.open)}::jsonb)
    WHERE id = ${orgId}
  `
  return sendJson(res, 200, ok({ orgId, registrationOpen: body.open }))
}

function slugify(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 48) || "org"
}

/**
 * Dispatch the /api/orgs* family. Returns true when handled (so the server
 * doesn't fall through). All auth/ownership checks live in the sub-handlers.
 */
export async function handleOrgsApi(
  sql: Sql,
  auth: Auth,
  ctx: AuthContext,
  method: string,
  pathname: string,
  req: IncomingMessage,
  res: ServerResponse,
  sendJson: SendJson,
): Promise<boolean> {
  if (pathname === "/api/orgs") {
    if (method === "GET") { await listOrgs(sql, res, ctx, sendJson); return true }
    if (method === "POST") { await createOrg(auth, req, res, sendJson); return true }
    sendJson(res, 405, err("method not allowed")); return true
  }

  // /api/orgs/:orgId/...
  const m = /^\/api\/orgs\/([^/]+)\/(projects|members|settings\/registration)$/.exec(pathname)
  if (!m) return false
  const orgId = decodeURIComponent(m[1])
  const sub = m[2]

  if (sub === "projects") {
    if (method === "GET") { await listProjects(sql, res, ctx, orgId, sendJson); return true }
    if (method === "POST") { await createProject(sql, req, res, ctx, orgId, sendJson); return true }
    sendJson(res, 405, err("method not allowed")); return true
  }
  if (sub === "members") {
    if (method === "GET") { await listMembers(sql, res, ctx, orgId, sendJson); return true }
    sendJson(res, 405, err("method not allowed")); return true
  }
  if (sub === "settings/registration") {
    if (method === "POST") { await setRegistration(sql, req, res, ctx, orgId, sendJson); return true }
    sendJson(res, 405, err("method not allowed")); return true
  }
  return false
}
