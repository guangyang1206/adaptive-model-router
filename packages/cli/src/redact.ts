// Secret redaction for diagnostic exports.
//
// A diagnostic export can leave the developer's machine (attached to a bug
// report, pasted into an issue, etc.). The config schema only stores env-var
// *names* (e.g. "OPENAI_API_KEY"), never values — but configs are hand-editable,
// so someone may accidentally inline a real key. We defend on two axes:
//   1. key name looks secret-ish  → redact the value regardless of content
//   2. value looks like a known credential prefix → redact even under an innocent key
export const SECRET_KEY_PATTERN =
  /(api[-_]?key|secret|token|password|passwd|credential|authorization|auth[-_]?token|access[-_]?key|private[-_]?key|bearer)/i

export const SECRET_VALUE_PATTERN = /^(sk-|xoxb-|ghp_|gho_|github_pat_|AIza|AKIA|ya29\.)/

export function redactValue(value: unknown): unknown {
  if (typeof value === "string") {
    return SECRET_VALUE_PATTERN.test(value) ? "[REDACTED]" : value
  }
  if (Array.isArray(value)) {
    return value.map(redactValue)
  }
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {}
    for (const [key, val] of Object.entries(value as Record<string, unknown>)) {
      out[key] = SECRET_KEY_PATTERN.test(key) ? "[REDACTED]" : redactValue(val)
    }
    return out
  }
  return value
}
