# ADR-007 — RBAC ships with owner/member only; admin and viewer are reserved and visibly locked

- Status: Accepted (2026-07-17)
- Deciders: maintainers
- Source commits: `9f73d5f` (MVP-3), `1b4bccb` (re-scored to partial), `21749b3` (version consequence)

## Context

MVP-3's goal was a team control plane: several people share one routing view,
scoped per project. The minimum that satisfies it is a distinction between
someone who can administer a project and someone who can only use it. That is
two roles.

A full role matrix is more than two roles. `admin` and `viewer` each need a
defined permission set across every endpoint, tests for each combination, an
invitation flow that can assign them, and a UI that reflects them. It is a
multiple of the work, and MVP-3 had no user asking for it.

The tempting middle path is to define all four roles now and enforce only two,
so the schema and types are "ready". That produces the worst outcome
available: a role a user can select and assign, which silently grants
something other than what its name implies. A `viewer` who can write is a
security bug disguised as a feature.

## Decision

Two roles are real. `Role = "owner" | "member"`
(`packages/control-plane/src/auth/scope.ts:11`), and anything else read from
the database is coerced to `member` — `coerceRole` returns `owner` only on an
exact match (`packages/control-plane/src/auth/scope.ts:24-26`). A stray `admin` row therefore degrades to the
least-privileged real role rather than to an unenforced one.

Enforcement is at the route layer via two predicates, `canAccessProject`
(`packages/control-plane/src/auth/scope.ts:65`) and `ownsProject` (`packages/control-plane/src/auth/scope.ts:80`). Write endpoints check both
and return 403 with distinct messages:

- `POST /api/projects/:projectId/tokens` — `packages/control-plane/src/routes/projects.ts:48-49`
  (`"forbidden"` then `"owner role required"`)
- `DELETE /api/projects/:projectId/tokens/:tokenId` — `packages/control-plane/src/routes/projects.ts:65-66`

The two reserved roles are present in the UI, non-selectable, and labelled
with the reason. `packages/control-plane/src/views/members.ts:32-34` renders
them inside a disabled `optgroup`:

```html
<optgroup label="Reserved for MVP-4+, not active" disabled>
  <option value="admin" disabled>Admin (locked — reserved)</option>
  <option value="viewer" disabled>Viewer (locked — reserved)</option>
```

Disabled `<option>` elements are natively non-focusable and non-submittable,
so this is an enforced control rather than a styling hint
(`packages/control-plane/src/views/members.ts:9`), with muted styling in `packages/control-plane/src/views/styles.ts:371-372`.

The partial state is disclosed rather than smoothed over. `ROADMAP.md` marks
RBAC under MVP-3 as in-progress, not done, and `RELEASING.md "Version policy"` cites partial
RBAC as the reason the packages are `0.1.0` and not `1.0.0`: a 1.0 would be a
promise the code does not keep.

## Consequences

Positive:

- No role can be assigned that does not do what its name says. The failure
  mode of a half-built matrix — a `viewer` with write access — cannot occur.
- A user discovers the limitation in the UI, at the moment they look for the
  role, with the reason attached. They do not file an issue about a role that
  silently did nothing.
- `coerceRole` makes unexpected role data safe by default. A future migration
  that introduces `admin` rows before enforcement exists cannot accidentally
  grant privileges.
- The version number carries the same information as the UI and the roadmap,
  so a consumer evaluating the package gets one consistent answer.

Negative:

- Real permission granularity is missing. A team that wants a read-only
  member has to choose between `member` (which can read everything in the org's
  projects) and no access at all. There is no workaround inside the product.
- `member` is coarse. Project-level rather than per-project-role membership
  means every member of an org sees every project in it
  (`resolveScope` at `packages/control-plane/src/auth/scope.ts:50-52` selects all projects whose `org_id` is
  in the user's orgs). Teams needing per-project membership must use separate
  orgs.
- The reserved options are inert UI that must be maintained and will look like
  a bug to anyone who does not read the label. They also have to be removed or
  activated in one coordinated change with the enforcement work.
- `0.1.0` is partly a consequence of this decision rather than of API
  instability, which understates how settled the rest of the surface is.
- Two roles put more weight on the structural isolation boundary (ADR-006).
  Since role granularity cannot restrict what a member reads within their org,
  the project predicate is doing most of the containment.

## Alternatives considered

- **Define four roles, enforce two.** Rejected: this is the specific failure
  the decision exists to avoid. An assignable role that does not behave as
  named is worse than an absent one.
- **Ship the full matrix in MVP-3.** Rejected: it is a multiple of the work for
  a requirement no user had stated, and it would have delayed the milestone
  whose actual goal was shared visibility.
- **Hide the reserved roles entirely.** Rejected: a user who wants a viewer
  role then has no way to learn the state and will assume it is missing by
  oversight. A visible, labelled lock answers the question in place.
- **Call it 1.0.0 anyway and treat RBAC as an enhancement.** Rejected — see
  `RELEASING.md "Version policy"`. A 1.0 signals a stability promise; partial RBAC
  means the permission model is expected to change.

## Related ADRs

- ADR-006 — the structural isolation boundary that carries most of the
  containment while RBAC is coarse
- ADR-010 — the version policy that encodes this partial state as `0.x`
