// Ingest-token lifecycle helpers (Spec §4.3, §5). The plaintext token is shown
// to the user exactly once at creation; only its sha256 hex hash is persisted.
//
// Uses node:crypto built-ins only — no dependency. Verification is done by
// hashing the presented token and comparing to the stored hash (a lookup on
// the UNIQUE idx_ingest_tokens_hash index); we never store or compare plaintext.

import { createHash, randomBytes } from "node:crypto"

/** A human-recognizable prefix so tokens are identifiable in transit/logs. */
export const TOKEN_PREFIX = "ark_live_"

/**
 * Generate a fresh ingest token. 32 random bytes → base64url gives ~43 chars
 * of entropy; the prefix is a non-secret label. Returned plaintext is shown
 * ONCE, never stored.
 */
export function generateToken(): string {
  return TOKEN_PREFIX + randomBytes(32).toString("base64url")
}

/** sha256 hex of the plaintext. This is what lands in ingest_tokens.token_hash. */
export function hashToken(plaintext: string): string {
  return createHash("sha256").update(plaintext).digest("hex")
}

/**
 * Constant-work verify: hash the candidate and compare to the stored hash.
 * (String compare of two sha256 hex digests; both are fixed length so this is
 * not a meaningful timing oracle, but we still avoid short-circuit on the
 * secret itself by comparing the derived hashes.)
 */
export function verifyToken(candidatePlaintext: string, storedHash: string): boolean {
  return hashToken(candidatePlaintext) === storedHash
}

/**
 * Non-secret display label for the token list. Since we only store the hash we
 * cannot reveal the secret's last-4; instead show the prefix + a short slice of
 * the (non-reversible) hash so operators can tell rows apart. Never leaks the
 * secret or the full hash.
 */
export function maskToken(tokenHash: string): string {
  const tail = tokenHash.slice(-6)
  return `${TOKEN_PREFIX}\u2022\u2022\u2022\u2022${tail}`
}

/**
 * Extract the bearer token from an Authorization header value.
 * Returns undefined when missing/malformed.
 */
export function parseBearer(headerValue: string | string[] | undefined): string | undefined {
  const raw = Array.isArray(headerValue) ? headerValue[0] : headerValue
  if (!raw) return undefined
  const match = /^Bearer\s+(.+)$/i.exec(raw.trim())
  return match?.[1]?.trim() || undefined
}
