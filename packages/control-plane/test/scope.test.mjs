// DB-less unit tests for the project-scope resolver (Ruling 5). Uses a stub
// tagged-template `sql` that returns queued result sets in call order, so we can
// assert resolveScope's membership + project fan-out and the derived helpers
// without any Postgres. Covers the core isolation guarantees (A4/A6).

import { test } from "node:test"
import assert from "node:assert/strict"
import {
  resolveScope,
  canAccessProject,
  isOrgMember,
  isOrgOwner,
  ownsProject,
} from "../dist/auth/scope.js"

/**
 * Build a stub `sql` tag. `results` is an array of result sets returned in the
 * order the QUERIES are issued. `sql(arr)` (the IN-clause helper) must NOT
 * consume a result slot — resolveScope calls `sql(orgs)` inside the second
 * query's template, so we detect the array-arg form and return it verbatim.
 */
function stubSql(results) {
  let call = 0
  const tag = (first, ..._rest) => {
    // IN-clause helper: sql(arrayOfIds) — return the array, don't consume a slot.
    if (Array.isArray(first) && !("raw" in Object(first))) return first
    return Promise.resolve(results[call++] ?? [])
  }
  return tag
}

test("resolveScope maps memberships + projects and coerces role", async () => {
  const sql = stubSql([
    // member rows
    [
      { organizationId: "org_a", role: "owner" },
      { organizationId: "org_b", role: "member" },
    ],
    // project rows
    [
      { id: "proj_1", org_id: "org_a" },
      { id: "proj_2", org_id: "org_b" },
    ],
  ])
  const scope = await resolveScope(sql, "user_1")
  assert.deepEqual(scope.orgs.sort(), ["org_a", "org_b"])
  assert.deepEqual(scope.projects.sort(), ["proj_1", "proj_2"])
  assert.equal(scope.roleByOrg.org_a, "owner")
  assert.equal(scope.roleByOrg.org_b, "member")
  assert.equal(scope.orgByProject.proj_1, "org_a")
  assert.equal(scope.orgByProject.proj_2, "org_b")
})

test("resolveScope returns empty sets for a user with no memberships (A4/A6 no access)", async () => {
  const sql = stubSql([[]]) // no member rows → projects query is skipped
  const scope = await resolveScope(sql, "orphan")
  assert.deepEqual(scope.orgs, [])
  assert.deepEqual(scope.projects, [])
  assert.deepEqual(scope.roleByOrg, {})
  assert.deepEqual(scope.orgByProject, {})
})

test("unknown roles coerce to member (only owner/member enforced)", async () => {
  const sql = stubSql([[{ organizationId: "org_a", role: "admin" }], []])
  const scope = await resolveScope(sql, "u")
  assert.equal(scope.roleByOrg.org_a, "member")
})

test("scope helpers gate access correctly", async () => {
  const sql = stubSql([
    [
      { organizationId: "org_a", role: "owner" },
      { organizationId: "org_b", role: "member" },
    ],
    [
      { id: "proj_1", org_id: "org_a" },
      { id: "proj_2", org_id: "org_b" },
    ],
  ])
  const scope = await resolveScope(sql, "u")

  // membership
  assert.equal(isOrgMember(scope, "org_a"), true)
  assert.equal(isOrgMember(scope, "org_x"), false)

  // ownership by org
  assert.equal(isOrgOwner(scope, "org_a"), true)
  assert.equal(isOrgOwner(scope, "org_b"), false)

  // project access
  assert.equal(canAccessProject(scope, "proj_1"), true)
  assert.equal(canAccessProject(scope, "proj_unknown"), false)

  // ownership by project (owner of proj_1's org, not proj_2's)
  assert.equal(ownsProject(scope, "proj_1"), true)
  assert.equal(ownsProject(scope, "proj_2"), false)
  assert.equal(ownsProject(scope, "proj_unknown"), false)
})
