// Project-scope resolver (impl-design §3.1). Pure data function: given a userId,
// resolve which orgs the user belongs to, which projects they can access, and
// their role per org. No HTTP — unit-testable (test/scope.test.mjs) with a
// stubbed sql tag.
//
// Reads from Better-Auth's "member" table (organization plugin owns it) joined
// with our projects table. Only owner/member roles are enforced (Spec ruling ②).

import type { Sql } from "../db/client.js"

export type Role = "owner" | "member"

export type Scope = {
  /** Org ids the user is a member of. */
  orgs: string[]
  /** Project ids the user can access (all projects in their orgs). */
  projects: string[]
  /** Role per org id. Values other than owner/member are coerced to "member". */
  roleByOrg: Record<string, Role>
  /** Which org each accessible project belongs to (for owner-gating by org). */
  orgByProject: Record<string, string>
}

function coerceRole(raw: string): Role {
  return raw === "owner" ? "owner" : "member"
}

/**
 * Resolve the full access scope for a user. Two small queries:
 *   1. memberships:   member rows for the user → orgs + role
 *   2. projects:      projects whose org_id ∈ the user's orgs
 * Returns empty sets for a user with no memberships (they see nothing — A4/A6).
 */
export async function resolveScope(sql: Sql, userId: string): Promise<Scope> {
  const memberRows = await sql<{ organizationId: string; role: string }[]>`
    SELECT "organizationId", "role" FROM "member" WHERE "userId" = ${userId}
  `

  const orgs: string[] = []
  const roleByOrg: Record<string, Role> = {}
  for (const row of memberRows) {
    orgs.push(row.organizationId)
    roleByOrg[row.organizationId] = coerceRole(row.role)
  }

  if (orgs.length === 0) {
    return { orgs: [], projects: [], roleByOrg: {}, orgByProject: {} }
  }

  const projectRows = await sql<{ id: string; org_id: string }[]>`
    SELECT id, org_id FROM projects WHERE org_id IN ${sql(orgs)}
  `

  const projects: string[] = []
  const orgByProject: Record<string, string> = {}
  for (const row of projectRows) {
    projects.push(row.id)
    orgByProject[row.id] = row.org_id
  }

  return { orgs, projects, roleByOrg, orgByProject }
}

/** True when the user can access the given project id. */
export function canAccessProject(scope: Scope, projectId: string): boolean {
  return scope.projects.includes(projectId)
}

/** True when the user is a member of the given org id. */
export function isOrgMember(scope: Scope, orgId: string): boolean {
  return scope.orgs.includes(orgId)
}

/** True when the user is an OWNER of the given org id. */
export function isOrgOwner(scope: Scope, orgId: string): boolean {
  return scope.roleByOrg[orgId] === "owner"
}

/** True when the user owns the org that the given project belongs to. */
export function ownsProject(scope: Scope, projectId: string): boolean {
  const orgId = scope.orgByProject[projectId]
  return orgId !== undefined && scope.roleByOrg[orgId] === "owner"
}
