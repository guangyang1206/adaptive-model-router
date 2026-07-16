// Node http <-> Web Fetch adapter for the Better-Auth handler and for reading
// the current session. Better-Auth is framework-agnostic and speaks the Web
// Fetch API (`auth.handler(request: Request): Promise<Response>` and
// `auth.api.getSession({ headers: Headers })`). Node's http server speaks
// IncomingMessage/ServerResponse, so we bridge them here.
//
// `fetch`, `Request`, `Response`, `Headers`, `URL` are Node built-in globals
// (Node >=18) — no import, no dependency (matches the SDK reporter rationale).

import type { IncomingMessage, ServerResponse } from "node:http"
import type { Auth } from "./better-auth.js"

/** Collect a request body as a string (empty for GET/HEAD). */
export function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let data = ""
    req.on("data", (chunk) => {
      data += String(chunk)
    })
    req.on("end", () => resolve(data))
    req.on("error", (e) => reject(e))
  })
}

/** Build a Web `Headers` object from a node IncomingMessage. */
export function toWebHeaders(req: IncomingMessage): Headers {
  const headers = new Headers()
  for (const [key, value] of Object.entries(req.headers)) {
    if (value === undefined) continue
    if (Array.isArray(value)) for (const v of value) headers.append(key, v)
    else headers.set(key, value)
  }
  return headers
}

/** Convert a node request (+ base url) into a Web `Request`. */
export async function toWebRequest(req: IncomingMessage, baseUrl: string): Promise<Request> {
  const method = req.method ?? "GET"
  const url = new URL(req.url ?? "/", baseUrl)
  const hasBody = method !== "GET" && method !== "HEAD"
  const body = hasBody ? await readBody(req) : undefined
  return new Request(url.toString(), {
    method,
    headers: toWebHeaders(req),
    body: body && body.length ? body : undefined,
  })
}

/** Pipe a Web `Response` back onto a node ServerResponse. */
export async function sendWebResponse(res: ServerResponse, webRes: Response): Promise<void> {
  res.statusCode = webRes.status
  webRes.headers.forEach((value, key) => {
    // set-cookie may repeat; Headers.forEach coalesces, but Better-Auth uses a
    // single combined value which node accepts.
    res.setHeader(key, value)
  })
  const text = await webRes.text()
  res.end(text)
}

/**
 * Mount point for /api/auth/*: convert, delegate to Better-Auth, pipe back.
 * Returns true when handled (always, for the auth base path).
 */
export async function handleAuth(auth: Auth, req: IncomingMessage, res: ServerResponse, baseUrl: string): Promise<void> {
  const webReq = await toWebRequest(req, baseUrl)
  const webRes = await auth.handler(webReq)
  await sendWebResponse(res, webRes)
}

/** Current session (or null) for a node request, via Better-Auth. */
export async function getSession(auth: Auth, req: IncomingMessage): Promise<SessionResult | null> {
  const result = await auth.api.getSession({ headers: toWebHeaders(req) })
  return (result as SessionResult | null) ?? null
}

/** The subset of Better-Auth's session shape the control plane relies on. */
export type SessionResult = {
  user: { id: string; email: string; name?: string; image?: string }
  session: { id: string; activeOrganizationId?: string | null }
}
