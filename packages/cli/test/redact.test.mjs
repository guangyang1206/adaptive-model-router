import test from "node:test"
import assert from "node:assert/strict"
import { redactValue, SECRET_KEY_PATTERN, SECRET_VALUE_PATTERN } from "../dist/redact.js"

test("redacts values under secret-looking keys regardless of content", () => {
  const input = { apiKey: "plain-text", api_key: "x", token: "y", authToken: "z", normal: "keep" }
  const out = redactValue(input)
  assert.equal(out.apiKey, "[REDACTED]")
  assert.equal(out.api_key, "[REDACTED]")
  assert.equal(out.token, "[REDACTED]")
  assert.equal(out.authToken, "[REDACTED]")
  assert.equal(out.normal, "keep")
})

test("redacts values that look like known credential prefixes under innocent keys", () => {
  const input = {
    note: "sk-abc123",
    ghToken: "ghp_deadbeef",
    google: "AIzaSyExample",
    aws: "AKIAIOSFODNN7EXAMPLE",
    harmless: "hello world",
  }
  const out = redactValue(input)
  assert.equal(out.note, "[REDACTED]")
  assert.equal(out.ghToken, "[REDACTED]")
  assert.equal(out.google, "[REDACTED]")
  assert.equal(out.aws, "[REDACTED]")
  assert.equal(out.harmless, "hello world")
})

test("recurses into nested objects and arrays", () => {
  const input = { providers: { openai: { apiKey: "sk-nested" } }, list: [{ secret: "v" }, "sk-inarray"] }
  const out = redactValue(input)
  assert.equal(out.providers.openai.apiKey, "[REDACTED]")
  assert.equal(out.list[0].secret, "[REDACTED]")
  assert.equal(out.list[1], "[REDACTED]")
})

test("leaves non-secret primitives untouched", () => {
  assert.equal(redactValue("just a string"), "just a string")
  assert.equal(redactValue(42), 42)
  assert.equal(redactValue(true), true)
  assert.equal(redactValue(null), null)
})

test("patterns are exported and match expected shapes", () => {
  assert.ok(SECRET_KEY_PATTERN.test("ANTHROPIC_API_KEY"))
  assert.ok(SECRET_VALUE_PATTERN.test("github_pat_11ABC"))
  assert.ok(!SECRET_VALUE_PATTERN.test("not-a-secret"))
})
