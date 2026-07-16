// DB-less tests for the ingest path (Ruling 5). Two layers:
//   1. Pure token helpers (generate/hash/verify/mask/parseBearer).
//   2. handleIngest against a stubbed `sql`, a fake IncomingMessage (an event
//      emitter yielding a JSON body), and a capturing ServerResponse — asserting
//      the 401 (unknown), 403 (revoked), 400 (bad body), and 200 (ok) branches
//      and that a revoked/unknown token inserts NOTHING (A12).

import { test } from "node:test"
import assert from "node:assert/strict"
import { EventEmitter } from "node:events"
import {
  generateToken,
  hashToken,
  verifyToken,
  maskToken,
  parseBearer,
  TOKEN_PREFIX,
} from "../dist/tokens.js"
import { handleIngest } from "../dist/routes/ingest.js"

// ---------------------------------------------------------------------------
// 1. Pure token helpers
// ---------------------------------------------------------------------------

test("generateToken is prefixed and unique", () => {
  const a = generateToken()
  const b = generateToken()
  assert.ok(a.startsWith(TOKEN_PREFIX))
  assert.notEqual(a, b)
})

test("hashToken is deterministic sha256 hex; verifyToken round-trips", () => {
  const t = generateToken()
  const h = hashToken(t)
  assert.equal(h.length, 64)
  assert.match(h, /^[0-9a-f]{64}$/)
  assert.equal(hashToken(t), h)
  assert.equal(verifyToken(t, h), true)
  assert.equal(verifyToken("wrong", h), false)
})

test("maskToken never leaks the plaintext or the full hash", () => {
  const t = generateToken()
  const h = hashToken(t)
  const masked = maskToken(h)
  assert.ok(!masked.includes(t))
  assert.ok(!masked.includes(h))
  assert.ok(masked.startsWith(TOKEN_PREFIX))
})

test("parseBearer extracts the token or returns undefined", () => {
  assert.equal(parseBearer("Bearer abc123"), "abc123")
  assert.equal(parseBearer("bearer abc123"), "abc123")
  assert.equal(parseBearer(["Bearer xyz"]), "xyz")
  assert.equal(parseBearer("Basic abc"), undefined)
  assert.equal(parseBearer(undefined), undefined)
  assert.equal(parseBearer(""), undefined)
})

// ---------------------------------------------------------------------------
// 2. handleIngest branch coverage with stubs
// ---------------------------------------------------------------------------

/**
 * A fake IncomingMessage: method + headers + a body that is replayed only once
 * the handler attaches its `data`/`end` listeners (via readBody). Emitting on
 * `newListener` guarantees the body arrives AFTER subscription regardless of how
 * many awaits precede readBody in the handler.
 */
function fakeReq({ method = "POST", headers = {}, body = "" }) {
  const req = new EventEmitter()
  req.method = method
  req.headers = headers
  let flushed = false
  req.on("newListener", (event) => {
    if (event !== "end" || flushed) return
    flushed = true
    // Defer to the next tick so the 'end' listener is fully registered.
    setImmediate(() => {
      if (body) req.emit("data", Buffer.from(body))
      req.emit("end")
    })
  })
  return req
}

/** Capture the (status, body) passed to sendJson. */
function makeSend() {
  const calls = []
  const sendJson = (_res, status, body) => calls.push({ status, body })
  return { sendJson, calls }
}

/**
 * Stub sql that: (a) answers the token lookup with `tokenRow` (or none), and
 * (b) records any INSERT/UPDATE so we can assert "nothing inserted" (A12).
 * The trace-store INSERT and the last_used_at UPDATE both go through this tag.
 */
function stubSql({ tokenRow }) {
  const writes = []
  const tag = (strings, ...values) => {
    const text = Array.isArray(strings) ? strings.join("?") : String(strings)
    if (/FROM ingest_tokens WHERE token_hash/i.test(text)) {
      return Promise.resolve(tokenRow ? [tokenRow] : [])
    }
    // Any INSERT/UPDATE — record it.
    writes.push(text.replace(/\s+/g, " ").trim().slice(0, 40))
    return Promise.resolve([])
  }
  tag.json = (v) => v // sql.json passthrough for the trace INSERT
  return { tag, writes }
}

const validTrace = JSON.stringify({
  traceId: "tr_1",
  decisionId: "dec_1",
  status: "success",
  candidates: [],
  reason: "test",
  attempts: [],
  estimated: true,
})

test("401 on unknown token, and NOTHING inserted (A12)", async () => {
  const { tag, writes } = stubSql({ tokenRow: null })
  const { sendJson, calls } = makeSend()
  const req = fakeReq({ headers: { authorization: "Bearer nope" }, body: validTrace })
  await handleIngest(tag, req, {}, sendJson)
  assert.equal(calls[0].status, 401)
  assert.equal(calls[0].body.code, "ERROR")
  assert.deepEqual(writes, [])
})

test("403 on revoked token, and NOTHING inserted (A12)", async () => {
  const { tag, writes } = stubSql({ tokenRow: { id: "t1", project_id: "p1", revoked_at: "2026-01-01T00:00:00Z" } })
  const { sendJson, calls } = makeSend()
  const req = fakeReq({ headers: { authorization: "Bearer revoked" }, body: validTrace })
  await handleIngest(tag, req, {}, sendJson)
  assert.equal(calls[0].status, 403)
  assert.equal(calls[0].body.code, "ERROR")
  assert.deepEqual(writes, [])
})

test("401 when the Authorization header is missing", async () => {
  const { tag } = stubSql({ tokenRow: null })
  const { sendJson, calls } = makeSend()
  const req = fakeReq({ headers: {}, body: validTrace })
  await handleIngest(tag, req, {}, sendJson)
  assert.equal(calls[0].status, 401)
})

test("400 on a valid token but non-RouterTrace body", async () => {
  const { tag } = stubSql({ tokenRow: { id: "t1", project_id: "p1", revoked_at: null } })
  const { sendJson, calls } = makeSend()
  const req = fakeReq({ headers: { authorization: "Bearer ok" }, body: JSON.stringify({ nope: true }) })
  await handleIngest(tag, req, {}, sendJson)
  assert.equal(calls[0].status, 400)
})

test("200 on a valid token + trace; server-derives project_id and inserts", async () => {
  const { tag, writes } = stubSql({ tokenRow: { id: "t1", project_id: "p1", revoked_at: null } })
  const { sendJson, calls } = makeSend()
  const req = fakeReq({ headers: { authorization: "Bearer good" }, body: validTrace })
  await handleIngest(tag, req, {}, sendJson)
  assert.equal(calls[0].status, 200)
  assert.equal(calls[0].body.code, "OK")
  assert.equal(calls[0].body.data.traceId, "tr_1")
  // Exactly one INSERT (trace) + one UPDATE (last_used_at) recorded.
  assert.equal(writes.length, 2)
})
