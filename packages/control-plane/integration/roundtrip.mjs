// DB-backed integration round-trip (Ruling 5, runs only in the
// `control-plane-integration` CI job against a postgres:17 service). Proves the
// real pipeline end to end WITHOUT a browser/session:
//   1. runMigrations applies 0001_better_auth + 0002_init on a fresh DB.
//   2. Seed an organization + user + member + project + ingest token (the rows a
//      normal onboarding flow would create via Better-Auth + the mgmt API).
//   3. POST a RouterTrace to /ingest/traces with the token (server derives the
//      project_id from the token — the client never sends it).
//   4. Read it back through the project-scoped data source and assert isolation:
//      the trace is visible for its project and NOT for a different project id.
//
// Requires env: DATABASE_URL, BETTER_AUTH_SECRET, BETTER_AUTH_URL.

import assert from "node:assert/strict"
import { getSql, closeSql } from "../dist/db/client.js"
import { runMigrations } from "../dist/db/migrate.js"
import { createPostgresTraceStore } from "../dist/data/pg-trace-store.js"
import { createPgDashboardDataSource } from "../dist/data/pg-data-source.js"
import { generateToken, hashToken } from "../dist/tokens.js"
import { buildConfig } from "../dist/config.js"
import { createAuth } from "../dist/auth/better-auth.js"
import { createRequestHandler } from "../dist/server.js"
import { EventEmitter } from "node:events"

const config = buildConfig()
const sql = getSql(config.databaseUrl)

async function main() {
  // 1. Migrations
  const applied = await runMigrations(sql)
  console.log("migrations applied this run:", applied)
  const versions = await sql`SELECT version FROM schema_migrations ORDER BY version`
  const names = versions.map((v) => v.version)
  assert.ok(names.includes("0001_better_auth"), "0001_better_auth applied")
  assert.ok(names.includes("0002_init"), "0002_init applied")

  // 2. Seed org + user + member + project + token (idempotent-ish for reruns).
  const orgId = "org_ci"
  const userId = "user_ci"
  const projectId = "11111111-1111-1111-1111-111111111111"
  const otherProjectId = "22222222-2222-2222-2222-222222222222"

  await sql`DELETE FROM router_traces WHERE project_id IN (${projectId}, ${otherProjectId})`
  await sql`DELETE FROM ingest_tokens WHERE project_id IN (${projectId}, ${otherProjectId})`
  await sql`DELETE FROM projects WHERE id IN (${projectId}, ${otherProjectId})`
  await sql`DELETE FROM "member" WHERE "organizationId" = ${orgId}`
  await sql`DELETE FROM "user" WHERE id = ${userId}`
  await sql`DELETE FROM "organization" WHERE id = ${orgId}`

  await sql`INSERT INTO "organization" (id, name, slug, "createdAt") VALUES (${orgId}, 'CI Org', 'ci-org', now())`
  await sql`INSERT INTO "user" (id, name, email, "emailVerified", "createdAt", "updatedAt") VALUES (${userId}, 'CI User', 'ci@example.com', true, now(), now())`
  await sql`INSERT INTO "member" (id, "organizationId", "userId", role, "createdAt") VALUES ('mem_ci', ${orgId}, ${userId}, 'owner', now())`
  await sql`INSERT INTO projects (id, org_id, name, slug, accent) VALUES (${projectId}, ${orgId}, 'CI Project', 'ci-project', '#3B82F6')`
  await sql`INSERT INTO projects (id, org_id, name, slug, accent) VALUES (${otherProjectId}, ${orgId}, 'Other', 'other', '#EF4444')`

  const token = generateToken()
  await sql`INSERT INTO ingest_tokens (project_id, token_hash) VALUES (${projectId}, ${hashToken(token)})`

  // 3. POST a trace through the real server request handler + ingest route.
  const auth = createAuth(sql, config)
  const handle = createRequestHandler(sql, auth, config)

  const trace = {
    traceId: "trace_ci_1",
    decisionId: "dec_ci_1",
    chosenModel: "local/demo",
    candidates: [],
    reason: "ci round-trip",
    attempts: [{ attemptNo: 1, modelId: "local/demo", provider: "local", status: "success", latencyMs: 5 }],
    usage: { inputTokens: 3, outputTokens: 2, totalTokens: 5, estimated: true },
    estimatedCostUsd: 0,
    estimated: true,
    latencyMs: 5,
    status: "success",
  }

  const { req, res, done } = fakeHttp("POST", "/ingest/traces", { authorization: `Bearer ${token}` }, JSON.stringify(trace))
  await handle(req, res)
  const result = await done
  assert.equal(result.status, 200, `ingest should 200, got ${result.status}: ${result.body}`)
  const parsed = JSON.parse(result.body)
  assert.equal(parsed.code, "OK")
  assert.equal(parsed.data.traceId, "trace_ci_1")
  console.log("ingest round-trip: 200 OK")

  // 4a. Visible for its own project.
  const ds = createPgDashboardDataSource(sql, projectId)
  const traces = await ds.listTraces()
  assert.equal(traces.length, 1, "one trace visible for its project")
  assert.equal(traces[0].traceId, "trace_ci_1")

  // 4b. NOT visible for a different project (A6 isolation).
  const otherDs = createPgDashboardDataSource(sql, otherProjectId)
  const otherTraces = await otherDs.listTraces()
  assert.equal(otherTraces.length, 0, "trace must NOT leak to another project")

  // 4c. Idempotent ingest: re-POST the same trace → still exactly one row.
  const store = createPostgresTraceStore(sql, projectId)
  await store.writeTrace(trace)
  const afterDup = await ds.listTraces()
  assert.equal(afterDup.length, 1, "ON CONFLICT DO NOTHING keeps ingest idempotent")

  console.log("✓ control-plane integration round-trip passed")
}

/** Minimal fake node http req/res that capture the response. */
function fakeHttp(method, url, headers, body) {
  const req = new EventEmitter()
  req.method = method
  req.url = url
  req.headers = headers
  let flushed = false
  req.on("newListener", (event) => {
    if (event !== "end" || flushed) return
    flushed = true
    setImmediate(() => {
      if (body) req.emit("data", Buffer.from(body))
      req.emit("end")
    })
  })

  let resolveDone
  const done = new Promise((r) => (resolveDone = r))
  const res = {
    statusCode: 200,
    _headers: {},
    setHeader(k, v) { this._headers[k.toLowerCase()] = v },
    getHeader(k) { return this._headers[k.toLowerCase()] },
    writeHead(status) { this.statusCode = status },
    end(chunk) { resolveDone({ status: this.statusCode, body: chunk ?? "" }) },
  }
  return { req, res, done }
}

main()
  .then(() => closeSql())
  .then(() => process.exit(0))
  .catch(async (error) => {
    console.error("integration round-trip FAILED:", error)
    await closeSql().catch(() => {})
    process.exit(1)
  })
