// node:http server + flat route table + bootstrap (impl-design §2.3, §3.1).
// One server, no router lib. Request pipeline:
//   /api/auth/*        → Better-Auth handler (session, sign-in/up, OAuth)
//   /ingest/traces     → ingest-token auth (NOT session)
//   /health            → public readiness
//   /login             → public login page
//   everything else    → require session → resolve scope → dispatch:
//                          /api/orgs*            (management)
//                          /api/projects/*       (tokens)
//                          /api/*                (reused dashboard, project-scoped)
//                          /onboarding, /requests, /models, /settings/*  (pages)
//
// Unauthenticated: HTML request → 302 /login; API request → 401 envelope.

import { createServer, type IncomingMessage, type ServerResponse } from "node:http"
import type { ControlPlaneConfig } from "./config.js"
import { buildConfig } from "./config.js"
import { getSql, closeSql, type Sql } from "./db/client.js"
import { runMigrations } from "./db/migrate.js"
import { createAuth, type Auth } from "./auth/better-auth.js"
import { handleAuth } from "./auth/handler.js"
import { resolveAuthContext, prefersHtml } from "./auth/middleware.js"
import { handleIngest } from "./routes/ingest.js"
import { handleHealth } from "./routes/health.js"
import { handleOrgsApi } from "./routes/orgs.js"
import { handleProjectsApi } from "./routes/projects.js"
import { handleDashboardApi } from "./routes/dashboard-proxy.js"
import {
  renderLoginPage,
  renderOnboardingPage,
  renderRequestsPage,
  renderModelsPage,
  renderMembersPage,
  renderApiKeysPage,
  redirect,
} from "./routes/pages.js"
import { ok, err } from "./envelope.js"

// --- Envelope-aware send helpers (Ruling 1: { code:"OK"|"ERROR", data, message }).
function sendJson(res: ServerResponse, status: number, body: unknown): void {
  res.statusCode = status
  res.setHeader("content-type", "application/json; charset=utf-8")
  res.end(JSON.stringify(body))
}
function sendHtml(res: ServerResponse, status: number, html: string): void {
  res.statusCode = status
  res.setHeader("content-type", "text/html; charset=utf-8")
  res.end(html)
}

export type ControlPlaneServer = {
  /** The node http server (already listening after start()). */
  listen(): Promise<{ url: string; close: () => Promise<void> }>
  /** The bare request handler (exposed for tests / embedding). */
  handle(req: IncomingMessage, res: ServerResponse): Promise<void>
}

/**
 * Build the request handler + a listen() that starts the server. Assumes the DB
 * is connected and migrations are already applied (see bootstrap()).
 */
export function createRequestHandler(sql: Sql, auth: Auth, config: ControlPlaneConfig) {
  const authConfigured = config.authSecret.length > 0 && config.baseUrl.length > 0

  return async function handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const url = new URL(req.url ?? "/", config.baseUrl)
    const pathname = url.pathname
    const method = req.method ?? "GET"

    try {
      // 1. Better-Auth owns its whole subtree.
      if (pathname.startsWith(config.authBasePath + "/") || pathname === config.authBasePath) {
        return await handleAuth(auth, req, res, config.baseUrl)
      }

      // 2. Ingest — token auth, not session.
      if (pathname === "/ingest/traces") {
        return await handleIngest(sql, req, res, sendJson)
      }

      // 3. Health — public.
      if (pathname === "/health") {
        return await handleHealth(sql, authConfigured, req, res, sendJson, sendHtml)
      }

      // 4. Login page — public.
      if (pathname === "/login" && method === "GET") {
        const error = url.searchParams.get("error") ?? undefined
        return sendHtml(res, 200, renderLoginPage(config, error))
      }

      // 5. Everything else requires a session.
      const ctx = await resolveAuthContext(auth, sql, req)
      if (!ctx) {
        if (prefersHtml(req)) return redirect(res, "/login")
        return sendJson(res, 401, err("unauthenticated"))
      }

      // 5a. Management API: orgs family.
      if (pathname === "/api/orgs" || pathname.startsWith("/api/orgs/")) {
        const handled = await handleOrgsApi(sql, auth, ctx, method, pathname, req, res, sendJson)
        if (handled) return
      }

      // 5b. Management API: project tokens.
      if (pathname.startsWith("/api/projects/")) {
        const handled = await handleProjectsApi(sql, ctx, method, pathname, res, sendJson)
        if (handled) return
      }

      // 5c. Reused dashboard /api/* (project-scoped).
      if (pathname.startsWith("/api/")) {
        const handled = await handleDashboardApi(sql, ctx, pathname, url.searchParams, res, sendJson)
        if (handled) return
      }

      // 5d. HTML pages.
      const project = url.searchParams.get("project") ?? undefined
      const org = url.searchParams.get("org") ?? undefined
      if (method === "GET") {
        switch (pathname) {
          case "/":
          case "/requests":
            return sendHtml(res, 200, await renderRequestsPage(sql, ctx, config, project, org))
          case "/onboarding":
            return sendHtml(res, 200, await renderOnboardingPage(sql, ctx, config))
          case "/models":
            return sendHtml(res, 200, await renderModelsPage(sql, ctx, config, project, org))
          case "/settings/members":
            return sendHtml(res, 200, await renderMembersPage(sql, ctx, config, org))
          case "/settings/api-keys":
            return sendHtml(res, 200, await renderApiKeysPage(sql, ctx, config, project, org))
          default:
            break
        }
      }

      // 6. Fall through.
      if (prefersHtml(req)) return sendHtml(res, 404, "<!doctype html><title>Not found</title><h1>404</h1>")
      return sendJson(res, 404, err("not found"))
    } catch (error) {
      // Global catch — never leak internals (§ error handling layer 3).
      console.error("[control-plane] request failed", { pathname, method, error })
      if (prefersHtml(req)) return sendHtml(res, 500, "<!doctype html><title>Error</title><h1>500</h1>")
      return sendJson(res, 500, err("internal server error"))
    }
  }
}

/**
 * Full bootstrap (impl-design §2.3): loadEnv (via buildConfig) → connect pg →
 * runMigrations → build Better-Auth → return a listen()-able server. Fail-fast:
 * a missing env var or a failed migration throws BEFORE binding a port (A14/A8).
 */
export async function bootstrap(config: ControlPlaneConfig = buildConfig()): Promise<ControlPlaneServer> {
  const sql = getSql(config.databaseUrl)
  // Idempotent; applies only unseen files (safe on every boot / cold start).
  await runMigrations(sql)
  const auth = createAuth(sql, config)
  const handle = createRequestHandler(sql, auth, config)

  return {
    handle,
    async listen() {
      const server = createServer((req, res) => {
        void handle(req, res)
      })
      await new Promise<void>((resolve) => server.listen(config.port, config.host, resolve))
      const url = `http://${config.host}:${config.port}`
      console.log(`[control-plane] ready on ${url}`)
      return {
        url,
        async close() {
          await new Promise<void>((resolve, reject) => server.close((e) => (e ? reject(e) : resolve())))
          await closeSql()
        },
      }
    },
  }
}

// When executed directly (bin entry), boot and listen. Errors exit non-zero with
// a clear message (A14).
const isMain = typeof process !== "undefined" && process.argv[1] && import.meta.url.endsWith(process.argv[1].split("/").pop() ?? "")
if (isMain) {
  bootstrap()
    .then((server) => server.listen())
    .catch((error) => {
      console.error(`[control-plane] failed to start: ${error instanceof Error ? error.message : String(error)}`)
      process.exit(1)
    })
}

export { ok, err }
