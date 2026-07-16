// ===========================================================================
// TEMPORARY placeholder view implementations.
//
// OWNED BY FRONTEND (贾思敏): this file will be REPLACED with the real
// design-token-driven page renderers. It exists now only so the backend route
// handlers + server compile and run end-to-end before the frontend lands.
//
// Every export here matches the signature in ./contract.ts EXACTLY. When the
// frontend implements the real views, keep these names/signatures identical.
// The backend imports these via "./views/index.js".
// ===========================================================================

import type {
  ApiKeysPageData,
  HealthViewData,
  LoginViewData,
  MembersPageData,
  ModelsPageData,
  OnboardingViewData,
  RequestsPageData,
  ShellContext,
} from "./contract.js"

function esc(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
}

function doc(title: string, body: string): string {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8" /><meta name="viewport" content="width=device-width, initial-scale=1" /><title>${esc(title)}</title></head><body data-theme="dark">${body}</body></html>`
}

export function renderLoginHtml(data: LoginViewData): string {
  return doc(
    "Sign in — Adaptive Router",
    `<main><h1>Sign in</h1>${data.error ? `<p class="error">${esc(data.error)}</p>` : ""}<form method="post" action="${esc(data.authBasePath)}/sign-in/email"><input name="email" type="email" /><input name="password" type="password" /><button>Sign in</button></form>${data.githubEnabled ? `<a href="${esc(data.authBasePath)}/sign-in/social?provider=github">GitHub</a>` : ""}</main>`,
  )
}

export function renderOnboardingHtml(data: OnboardingViewData): string {
  return doc(
    "Get started — Adaptive Router",
    `<main><h1>Welcome, ${esc(data.user.name ?? data.user.email)}</h1><p>Ingest URL: <code>${esc(data.ingestUrl)}</code></p>${data.freshToken ? `<pre>${esc(data.freshToken.token)}</pre>` : ""}</main>`,
  )
}

export function renderAppShellHtml(shell: ShellContext, innerHtml: string): string {
  return doc(
    `Adaptive Router — ${esc(shell.activeNav)}`,
    `<div class="app"><aside>${shell.orgs.map((o) => esc(o.name)).join(" · ")}</aside><main>${innerHtml}</main></div>`,
  )
}

export function renderRequestsPageBody(data: RequestsPageData): string {
  if (data.emptyState !== "has-data") {
    return `<section><h1>Routing Decisions</h1><p class="empty">No data yet. Ingest URL: <code>${esc(data.ingestUrl)}</code></p></section>`
  }
  return `<section><h1>Routing Decisions</h1><div id="metrics" class="cards"></div><div id="requests"></div></section>`
}

export function renderModelsPageBody(data: ModelsPageData): string {
  return `<section><h1>Models</h1><div id="models"><p class="empty">No models for this project.</p></div>${data.currentProjectId ? "" : ""}</section>`
}

export function renderMembersPageBody(data: MembersPageData): string {
  return `<section><h1>Members</h1><table><tbody>${data.members
    .map((m) => `<tr><td>${esc(m.name ?? "")}</td><td>${esc(m.email)}</td><td>${esc(m.role)}</td><td>${esc(m.status)}</td></tr>`)
    .join("")}</tbody></table></section>`
}

export function renderApiKeysPageBody(data: ApiKeysPageData): string {
  return `<section><h1>API Keys</h1>${data.freshToken ? `<pre>${esc(data.freshToken.token)}</pre>` : ""}<table><tbody>${data.tokens
    .map((t) => `<tr><td class="mono">${esc(t.masked)}</td><td>${esc(t.createdAt)}</td><td>${esc(t.lastUsedAt ?? "—")}</td><td>${t.revokedAt ? "revoked" : "active"}</td></tr>`)
    .join("")}</tbody></table></section>`
}

export function renderHealthHtml(data: HealthViewData): string {
  return doc(
    "Health — Adaptive Router",
    `<main><h1>Health: ${data.ok ? "OK" : "DEGRADED"}</h1><ul>${data.components
      .map((c) => `<li>${esc(c.name)}: ${c.ok ? "ok" : "fail"}${c.detail ? ` (${esc(c.detail)})` : ""}</li>`)
      .join("")}</ul></main>`,
  )
}
