// HTML page routes (Spec §6 pages). These render the frontend's pure view
// functions with backend-fetched data. Unauthenticated page requests are
// redirected to /login (A2). The App Shell pages (requests/models/members/
// api-keys) build a ShellContext + a page body, then wrap via renderAppShellHtml.
//
// Data for the Requests/Models tables is fetched client-side from the reused
// dashboard /api/* (project-scoped) — these handlers only choose the empty-state
// layer and provide the ingest URL for the "no-data" snippet.

import type { ServerResponse } from "node:http"
import type { Sql } from "../db/client.js"
import type { ControlPlaneConfig } from "../config.js"
import type { AuthContext } from "../auth/middleware.js"
import {
  renderLoginHtml,
  renderOnboardingHtml,
  renderAppShellHtml,
  renderRequestsPageBody,
  renderModelsPageBody,
  renderMembersPageBody,
  renderApiKeysPageBody,
  type ShellContext,
  type ViewOrg,
  type ViewProject,
  type MemberRow,
  type TokenRow,
} from "../views/index.js"
import { maskToken } from "../tokens.js"
import { isOrgOwner, ownsProject } from "../auth/scope.js"

type SendHtml = (res: ServerResponse, status: number, html: string) => void

/** Render GET /login (public). */
export function renderLoginPage(config: ControlPlaneConfig, error?: string): string {
  return renderLoginHtml({
    githubEnabled: config.github !== undefined,
    registrationOpen: config.registrationOpen,
    error,
    authBasePath: config.authBasePath,
  })
}

/** Load the user's orgs (id/name/role) from the resolved scope. */
async function loadOrgs(sql: Sql, ctx: AuthContext): Promise<ViewOrg[]> {
  if (ctx.scope.orgs.length === 0) return []
  const rows = await sql<{ id: string; name: string }[]>`
    SELECT id, name FROM "organization" WHERE id IN ${sql(ctx.scope.orgs)}
  `
  return rows.map((o) => ({ id: o.id, name: o.name, role: ctx.scope.roleByOrg[o.id] ?? "member" }))
}

/** Load projects in an org (only those the user can access). */
async function loadProjects(sql: Sql, ctx: AuthContext, orgId: string): Promise<ViewProject[]> {
  const rows = await sql<{ id: string; org_id: string; name: string; slug: string; accent: string | null }[]>`
    SELECT id, org_id, name, slug, accent FROM projects WHERE org_id = ${orgId} ORDER BY created_at ASC
  `
  return rows
    .filter((p) => ctx.scope.projects.includes(p.id))
    .map((p) => ({ id: p.id, orgId: p.org_id, name: p.name, slug: p.slug, accent: p.accent ?? undefined }))
}

/** Resolve the current org: query param, active org, or the first membership. */
function resolveCurrentOrg(ctx: AuthContext, requested?: string): string | undefined {
  if (requested && ctx.scope.orgs.includes(requested)) return requested
  if (ctx.activeOrganizationId && ctx.scope.orgs.includes(ctx.activeOrganizationId)) return ctx.activeOrganizationId
  return ctx.scope.orgs[0]
}

async function buildShell(
  sql: Sql,
  ctx: AuthContext,
  config: ControlPlaneConfig,
  activeNav: ShellContext["activeNav"],
  currentOrgId: string,
  currentProjectId: string | undefined,
): Promise<ShellContext> {
  const orgs = await loadOrgs(sql, ctx)
  const projects = await loadProjects(sql, ctx, currentOrgId)
  return {
    user: ctx.user,
    orgs,
    projects,
    currentOrgId,
    currentProjectId,
    activeNav,
    registrationOpen: config.registrationOpen,
  }
}

/** GET /onboarding — first-run 3-step flow. */
export async function renderOnboardingPage(sql: Sql, ctx: AuthContext, config: ControlPlaneConfig): Promise<string> {
  const orgs = await loadOrgs(sql, ctx)
  const currentOrgId = orgs[0]?.id
  const projects = currentOrgId ? await loadProjects(sql, ctx, currentOrgId) : []
  return renderOnboardingHtml({
    user: ctx.user,
    orgs,
    projects,
    ingestUrl: config.ingestUrl,
  })
}

/** GET /requests — App Shell + requests body. */
export async function renderRequestsPage(sql: Sql, ctx: AuthContext, config: ControlPlaneConfig, currentProjectId?: string, requestedOrg?: string): Promise<string> {
  const currentOrgId = resolveCurrentOrg(ctx, requestedOrg)
  if (!currentOrgId) return renderOnboardingPage(sql, ctx, config)
  const shell = await buildShell(sql, ctx, config, "requests", currentOrgId, currentProjectId)
  const emptyState = currentProjectId ? "has-data" : "no-project"
  const body = renderRequestsPageBody({ currentProjectId, emptyState, ingestUrl: config.ingestUrl })
  return renderAppShellHtml(shell, body)
}

/** GET /models — App Shell + models body. */
export async function renderModelsPage(sql: Sql, ctx: AuthContext, config: ControlPlaneConfig, currentProjectId?: string, requestedOrg?: string): Promise<string> {
  const currentOrgId = resolveCurrentOrg(ctx, requestedOrg)
  if (!currentOrgId) return renderOnboardingPage(sql, ctx, config)
  const shell = await buildShell(sql, ctx, config, "models", currentOrgId, currentProjectId)
  const emptyState = currentProjectId ? "has-data" : "no-project"
  const body = renderModelsPageBody({ currentProjectId, emptyState })
  return renderAppShellHtml(shell, body)
}

/** GET /settings/members — App Shell + members body. */
export async function renderMembersPage(sql: Sql, ctx: AuthContext, config: ControlPlaneConfig, requestedOrg?: string): Promise<string> {
  const currentOrgId = resolveCurrentOrg(ctx, requestedOrg)
  if (!currentOrgId) return renderOnboardingPage(sql, ctx, config)
  const shell = await buildShell(sql, ctx, config, "members", currentOrgId, undefined)
  const memberRows = await sql<{ userId: string; role: string; name: string | null; email: string }[]>`
    SELECT m."userId", m."role", u."name", u."email"
    FROM "member" m JOIN "user" u ON u.id = m."userId"
    WHERE m."organizationId" = ${currentOrgId}
    ORDER BY m."createdAt" ASC
  `
  const members: MemberRow[] = memberRows.map((r) => ({
    userId: r.userId,
    name: r.name ?? undefined,
    email: r.email,
    role: r.role === "owner" ? "owner" : "member",
    status: "active",
  }))
  const body = renderMembersPageBody({
    orgId: currentOrgId,
    members,
    viewerIsOwner: isOrgOwner(ctx.scope, currentOrgId),
    registrationOpen: config.registrationOpen,
  })
  return renderAppShellHtml(shell, body)
}

/** GET /settings/api-keys — App Shell + api-keys body. */
export async function renderApiKeysPage(sql: Sql, ctx: AuthContext, config: ControlPlaneConfig, currentProjectId?: string, requestedOrg?: string): Promise<string> {
  const currentOrgId = resolveCurrentOrg(ctx, requestedOrg)
  if (!currentOrgId) return renderOnboardingPage(sql, ctx, config)
  const shell = await buildShell(sql, ctx, config, "api-keys", currentOrgId, currentProjectId)
  let tokens: TokenRow[] = []
  if (currentProjectId && ctx.scope.projects.includes(currentProjectId)) {
    const rows = await sql<{ id: string; token_hash: string; created_at: string; last_used_at: string | null; revoked_at: string | null }[]>`
      SELECT id, token_hash, created_at, last_used_at, revoked_at
      FROM ingest_tokens WHERE project_id = ${currentProjectId}
      ORDER BY created_at DESC
    `
    tokens = rows.map((t) => ({
      id: t.id,
      masked: maskToken(t.token_hash),
      createdAt: t.created_at,
      lastUsedAt: t.last_used_at ?? undefined,
      revokedAt: t.revoked_at ?? undefined,
    }))
  }
  const body = renderApiKeysPageBody({
    projectId: currentProjectId,
    tokens,
    viewerIsOwner: currentProjectId ? ownsProject(ctx.scope, currentProjectId) : isOrgOwner(ctx.scope, currentOrgId),
    ingestUrl: config.ingestUrl,
  })
  return renderAppShellHtml(shell, body)
}

/** Issue a 302 redirect to a path. */
export function redirect(res: ServerResponse, location: string): void {
  res.statusCode = 302
  res.setHeader("location", location)
  res.end()
}

export type { SendHtml }
