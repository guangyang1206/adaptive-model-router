# ADR-008 — The HTTP response envelope uses a string `code`, not a numeric one

- Status: Accepted (2026-06-27); made authoritative across packages 2026-07-17
- Deciders: maintainers
- Source commits: `a62cad0` (dashboard `sendJson`), `9f73d5f` (control-plane `envelope.ts`)

## Context

Both the dashboard and the control plane serve JSON APIs, and MVP-3 reuses the
dashboard's twelve `/api/*` handlers inside the control plane. The two packages
must agree on a response shape or every consumer needs to branch on which
server answered.

There are two common conventions. The numeric form — `{ code: 0, data, msg }`
where `0` means success — is widespread, and the string form —
`{ code: "OK" | "ERROR", data, message }`. The dashboard shipped the string
form first. When MVP-3 introduced a second server, the choice was to keep it
or normalise to numeric.

The numeric convention has a specific problem here: `0` is falsy. Every
consumer check written as `if (!res.code)` or `if (res.code)` means the
opposite of what it looks like, in both JavaScript and in every templating
layer the dashboard renders through.

## Decision

The string form is authoritative in both packages:

```ts
type Envelope = {
  code: "OK" | "ERROR"
  data: unknown
  message: string
}
```

- control plane: `packages/control-plane/src/envelope.ts:6-18`, with `ok()` and
  `err()` as the only constructors
- dashboard: `packages/dashboard/src/index.ts:954-957`, where `sendJson`
  derives `code` from the HTTP status (`statusCode >= 400 ? "ERROR" : "OK"`)

The HTTP status carries the real signal — 200, 400, 401, 403, 500 — and `code`
is a redundant, human-readable restatement of it, not an independent error
taxonomy (`packages/control-plane/src/envelope.ts:3-4`).

The contract is asserted in CI. The dashboard smoke test in
`.github/workflows/ci.yml` fetches `/api/metrics/summary` and fails on
`summary.code !== 'OK'`, and the control-plane integration round-trip asserts
`parsed.code === "OK"`
(`packages/control-plane/integration/roundtrip.mjs:82`).

## Consequences

Positive:

- No falsy-success hazard. `code === "OK"` is unambiguous, and there is no
  correct-looking check that inverts its meaning.
- One envelope across two servers, so the control plane could adopt the
  dashboard's handlers without touching their response construction.
- `sendJson` deriving `code` from the status means the envelope cannot
  disagree with the HTTP status — there is no code path that sends 500 with
  `code: "OK"`.

Negative:

- It is not the dominant convention in the ecosystem the project's likely
  users come from, so an integrator may expect `code: 0` and need to adjust.
- Two values means no room for error classification. There is no
  `code: "RATE_LIMITED"` to branch on; a client that needs to distinguish
  failures must read the HTTP status or parse `message`, which is prose and not
  a stable contract.
- `code` is redundant with the HTTP status, so it is a field that must be kept
  consistent for no additional information. The dashboard removes that risk by
  deriving it; the control plane's `ok()`/`err()` do not, so a handler there can
  in principle send `err()` with a 200.
- The two packages construct the envelope differently — derived from status in
  the dashboard, chosen explicitly in the control plane. Same shape, two
  mechanisms.

## Alternatives considered

- **Numeric `{ code: 0, data, msg }`.** Rejected primarily because `0` is
  falsy, which makes the most natural consumer check silently wrong. It also
  would have required rewriting the dashboard's already-shipped `sendJson` and
  every test asserting on it.
- **No envelope; return the payload directly with HTTP status as the only
  signal.** Cleaner, and rejected for consistency: the dashboard had already
  shipped an envelope and its client-side rendering reads `data`. Changing it
  was churn without a user-visible gain.
- **A richer error taxonomy in `code`.** Rejected as premature. No consumer
  has needed to branch on failure kind, and `AdaptiveRouterErrorCode` in the
  SDK already covers the routing-level error classification where it matters.

## Related ADRs

- ADR-006 — the dashboard handler reuse this shared envelope made possible
