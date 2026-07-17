// ===========================================================================
// VIEW CONTRACT — the seam between backend route handlers (贝洛奇) and the
// frontend page render layer (贾思敏).
//
// OWNERSHIP:
//   - Backend  owns THIS file (the contract) + all route handlers that CALL
//     these functions.
//   - Frontend owns the IMPLEMENTATION of every `render*Html` function below,
//     plus the design-token stylesheet, living in src/views/*.ts.
//
// RULES:
//   1. Every render function is PURE: (data) => string (full HTML document or
//      fragment as noted). No I/O, no DB, no async. The backend fetches all
//      data and passes it in.
//   2. Functions return a COMPLETE HTML document (`<!doctype html>...`) for
//      top-level pages (login, onboarding, app shell, health). The app-shell
//      pages (requests/models/members/api-keys) are rendered as the shell body
//      via `renderAppShellHtml`, which embeds a page-specific inner fragment.
//   3. All technical identifiers (request_id, model, cost, latency, tokens,
//      ingest tokens) must be monospace per Spec §7. Icons: Lucide inline SVG
//      only, no emoji. Dark theme primary (Spec §7 tokens).
//   4. Never trust user data — escape all interpolated strings. A shared
//      `escapeHtml` helper should live in the views package.
//   5. The frontend MUST implement `src/views/index.ts` re-exporting every
//      function below with these EXACT names and signatures. The backend
//      imports from "./views/index.js".
//
// If the frontend needs an additional data field, it requests a contract
// change through team-lead — do not silently widen these types on either side.
// ===========================================================================

// ---------------------------------------------------------------------------
// Shared value objects passed into multiple views.
// ---------------------------------------------------------------------------

/** The signed-in user (from Better-Auth session). */
export type ViewUser = {
  id: string
  email: string
  name?: string
  /** Optional avatar image URL; views fall back to an initials chip. */
  image?: string
}

/** One organization the user belongs to. */
export type ViewOrg = {
  id: string
  name: string
  /** The signed-in user's role in THIS org. Only owner/member are enforced. */
  role: "owner" | "member"
}

/** One project inside an org. `accent` is one of the fixed 8-color palette. */
export type ViewProject = {
  id: string
  orgId: string
  name: string
  slug: string
  accent?: string
}

/**
 * The App Shell chrome context. Passed to `renderAppShellHtml` alongside a
 * page-specific inner fragment. Drives the org switcher, project switcher, nav
 * highlight, breadcrumb, and avatar menu.
 */
export type ShellContext = {
  user: ViewUser
  orgs: ViewOrg[]
  /** Projects visible to the user within the currently-selected org. */
  projects: ViewProject[]
  currentOrgId: string
  /** undefined = the org-level "All projects" aggregate view. */
  currentProjectId?: string
  /** Which nav item is active — drives highlight + breadcrumb tail. */
  activeNav: "requests" | "models" | "members" | "api-keys" | "settings"
  /** True when registration is currently open (owner sees the toggle state). */
  registrationOpen?: boolean
}

// ---------------------------------------------------------------------------
// 1. Login / Auth page  —  route: GET /login
//     Backend calls this for unauthenticated page requests (A2 redirect target).
// ---------------------------------------------------------------------------

export type LoginViewData = {
  /** True when GitHub OAuth is configured (show the GitHub CTA). */
  githubEnabled: boolean
  /** True when new email/password registration is allowed (A1 close toggle). */
  registrationOpen: boolean
  /** Optional human-readable error (e.g. OAuth callback failure). */
  error?: string
  /** Where Better-Auth endpoints are mounted (default "/api/auth"). */
  authBasePath: string
}
export declare function renderLoginHtml(data: LoginViewData): string

// ---------------------------------------------------------------------------
// 2. Onboarding page  —  route: GET /onboarding
//     3-step checklist: name org -> create project -> get ingest token+snippet.
// ---------------------------------------------------------------------------

export type OnboardingViewData = {
  user: ViewUser
  /** Existing orgs (usually empty on first run; drives which step is active). */
  orgs: ViewOrg[]
  /** Projects in the just-created / selected org, if any. */
  projects: ViewProject[]
  /** The most-recently created ingest token PLAINTEXT, shown once, if present. */
  freshToken?: { id: string; token: string; projectId: string }
  /** The ingest URL to show in the copy-paste SDK snippet. */
  ingestUrl: string
}
export declare function renderOnboardingHtml(data: OnboardingViewData): string

// ---------------------------------------------------------------------------
// 3. App Shell  —  wraps requests/models/members/api-keys pages.
//     Backend renders the inner page fragment, then wraps it with the shell.
// ---------------------------------------------------------------------------

/**
 * Wrap a page-specific inner HTML fragment with the collapsible sidebar,
 * org/project switchers, breadcrumb, and avatar menu. `innerHtml` is the
 * fragment returned by one of the render*PageBody functions below.
 */
export declare function renderAppShellHtml(shell: ShellContext, innerHtml: string): string

// ---------------------------------------------------------------------------
// 4. Requests / Routing Decisions page body  —  route: GET /requests
//     Data is READ from the reused dashboard /api/* (client-fetched), so the
//     body is mostly a mount point + empty-state. The backend passes whether
//     the current project has any data so the correct empty-state layer shows.
// ---------------------------------------------------------------------------

export type RequestsPageData = {
  currentProjectId?: string
  /**
   * Empty-state layer selector (Spec §6 empty-state family, 3 layers):
   *  - "no-project": user has no project selected/created yet
   *  - "no-data":    project exists but no traces ingested yet (show snippet)
   *  - "has-data":   render the live table (client fetches /api/requests)
   */
  emptyState: "no-project" | "no-data" | "has-data"
  /** Ingest URL + a masked token hint for the "no-data" snippet, if available. */
  ingestUrl: string
}
export declare function renderRequestsPageBody(data: RequestsPageData): string

// ---------------------------------------------------------------------------
// 5. Models page body  —  route: GET /models
//     MVP-3 returns no per-project model registry (listModels() => []), so this
//     is primarily an empty-state page scoped to the current project.
// ---------------------------------------------------------------------------

export type ModelsPageData = {
  currentProjectId?: string
  emptyState: "no-project" | "no-data" | "has-data"
}
export declare function renderModelsPageBody(data: ModelsPageData): string

// ---------------------------------------------------------------------------
// 6. Settings > Members page body  —  route: GET /settings/members
// ---------------------------------------------------------------------------

export type MemberRow = {
  userId: string
  name?: string
  email: string
  role: "owner" | "member"
  /** "active" | "invited" (P1 invite flow). */
  status: "active" | "invited"
}
export type MembersPageData = {
  orgId: string
  members: MemberRow[]
  /** True when the viewer is an owner (show Invite popover + role controls). */
  viewerIsOwner: boolean
  /** Current registration-open toggle state (owner-only control). */
  registrationOpen: boolean
}
export declare function renderMembersPageBody(data: MembersPageData): string

// ---------------------------------------------------------------------------
// 7. Settings > API Keys (ingest tokens) page body  —  route: /settings/api-keys
// ---------------------------------------------------------------------------

export type TokenRow = {
  id: string
  /** Non-secret display label (e.g. id-based mask); NEVER the hash/plaintext. */
  masked: string
  createdAt: string
  lastUsedAt?: string
  revokedAt?: string
}
export type ApiKeysPageData = {
  projectId?: string
  tokens: TokenRow[]
  viewerIsOwner: boolean
  ingestUrl: string
  /** Plaintext of a just-created token, shown once (create-reveal), if present. */
  freshToken?: { id: string; token: string }
}
export declare function renderApiKeysPageBody(data: ApiKeysPageData): string

// ---------------------------------------------------------------------------
// 8. Health self-check page (P1)  —  route: GET /health  (Accept: text/html)
//     The JSON form of /health is served by the backend directly; this HTML
//     view is the human-readable readiness page.
// ---------------------------------------------------------------------------

export type HealthComponent = {
  name: string
  ok: boolean
  detail?: string
}
export type HealthViewData = {
  ok: boolean
  components: HealthComponent[]
}
export declare function renderHealthHtml(data: HealthViewData): string
