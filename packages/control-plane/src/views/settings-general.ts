// ===========================================================================
// Settings shared bits + General/Danger-zone body (UIUX §6, Spec §6).
//
// NOTE on contract: the authoritative ./contract.ts defines page-body functions
// for Members and API Keys but NOT for a standalone Settings › General page
// (its ShellContext.activeNav does include "settings"). Spec §6 lists a
// "Settings › General / danger zone". To avoid silently widening the contract,
// this file exports:
//   - settingsTabs()          — the shared segmented tab bar (used by members +
//                               api-keys bodies).
//   - renderSettingsGeneralBody(data) — an EXTRA body fragment matching the
//                               shell-body convention, ready for the backend to
//                               wire a GET /settings route through
//                               renderAppShellHtml. Flagged to team-lead as a
//                               proposed contract addition (renderSettings-
//                               GeneralPageBody) rather than an invented seam.
// ===========================================================================

import { esc, escAttr, button } from "./layout.js"
import { icon } from "./icons.js"

export type SettingsTab = "general" | "members" | "api-keys"

/** Segmented tab bar shared across the Settings pages. */
export function settingsTabs(active: SettingsTab): string {
  const tabs: [SettingsTab, string, string][] = [
    ["general", "General", "/settings"],
    ["members", "Members", "/settings/members"],
    ["api-keys", "API Keys", "/settings/api-keys"],
  ]
  return (
    `<nav class="seg" aria-label="Settings sections">` +
    tabs
      .map(([key, label, href]) => `<a href="${escAttr(href)}"${key === active ? ' aria-current="page"' : ""}>${esc(label)}</a>`)
      .join("") +
    `</nav>`
  )
}

/** Proposed extra contract shape for the General settings body. */
export type SettingsGeneralData = {
  orgName: string
  registrationOpen: boolean
  /** Only owners may change org settings / see the destructive danger zone. */
  viewerIsOwner: boolean
}

/**
 * Settings › General + Danger zone body fragment (wrapped by renderAppShellHtml).
 * EXTRA (not in the current contract) — see file header. Safe to leave unwired.
 */
export function renderSettingsGeneralBody(data: SettingsGeneralData): string {
  const readonlyAttr = data.viewerIsOwner ? "" : " disabled"

  const orgCard = `
<div class="card" style="margin-bottom:20px">
  <h3 style="margin-bottom:14px">Organization</h3>
  <form method="post" action="/api/orgs/current" novalidate>
    <div class="field" style="max-width:420px">
      <label for="org-name">Organization name</label>
      <input class="input" id="org-name" name="name" value="${escAttr(data.orgName)}" required minlength="2" maxlength="60"${readonlyAttr} />
      <span class="hint">Shown in the sidebar switcher and breadcrumb.</span>
    </div>
    ${data.viewerIsOwner ? button("Save changes", { variant: "primary", type: "submit", iconName: "check" }) : ""}
  </form>
</div>`

  const regCard = data.viewerIsOwner
    ? `
<div class="card" style="margin-bottom:20px">
  <h3 style="margin-bottom:6px">Registration</h3>
  <p class="muted text-sm" style="margin-bottom:14px">When closed, new people can only join via an invite. The first registrant is always the owner.</p>
  <form method="post" action="/api/orgs/current/settings/registration">
    <input type="hidden" name="open" value="${data.registrationOpen ? "false" : "true"}" />
    <div style="display:flex;align-items:center;gap:12px">
      <span class="badge ${data.registrationOpen ? "badge-success" : "badge-neutral"}"><span class="dot"></span>${data.registrationOpen ? "Open" : "Closed"}</span>
      ${button(data.registrationOpen ? "Close registration" : "Open registration", { variant: "outline", type: "submit", iconName: data.registrationOpen ? "lock" : "userPlus" })}
    </div>
  </form>
</div>`
    : ""

  const themeCard = `
<div class="card" style="margin-bottom:20px">
  <h3 style="margin-bottom:6px">Appearance</h3>
  <p class="muted text-sm" style="margin-bottom:14px">Dark is the default and recommended for late-night debugging. Your choice is remembered on this device.</p>
  <div style="display:flex;gap:10px">
    ${button("Dark", { variant: "outline", iconName: "moon", attrs: "onclick=\"document.documentElement.setAttribute('data-theme','dark');document.cookie='cp_theme=dark;path=/;max-age=31536000;samesite=lax'\"" })}
    ${button("Light", { variant: "outline", iconName: "sun", attrs: "onclick=\"document.documentElement.setAttribute('data-theme','light');document.cookie='cp_theme=light;path=/;max-age=31536000;samesite=lax'\"" })}
  </div>
</div>`

  const dangerZone = data.viewerIsOwner
    ? `
<div class="danger-zone">
  <div class="dz-head" style="display:flex;align-items:center;gap:6px">${icon("shieldAlert", 20)}Danger zone</div>
  <div class="dz-row">
    <div class="dz-text"><div class="t">Delete this project</div><div class="d">Permanently removes the project and all its routing decisions and ingest tokens. This cannot be undone.</div></div>
    <form method="post" action="/api/projects/current/delete" onsubmit="return confirm('Delete this project and all its data? This cannot be undone.');">
      ${button("Delete project", { variant: "danger", type: "submit", iconName: "trash2" })}
    </form>
  </div>
</div>`
    : `
<div class="danger-zone">
  <div class="dz-head" style="display:flex;align-items:center;gap:6px">${icon("shieldAlert", 20)}Danger zone</div>
  <div class="dz-row">
    <div class="dz-text"><div class="t">Leave organization</div><div class="d">You'll lose access to this organization's projects and routing decisions.</div></div>
    <form method="post" action="/api/orgs/current/leave" onsubmit="return confirm('Leave this organization? You will lose access to its data.');">
      ${button("Leave organization", { variant: "danger", type: "submit", iconName: "logOut" })}
    </form>
  </div>
</div>`

  return (
    `<div class="page-head"><div><h1>Settings</h1><p>Manage this organization, registration, and appearance.</p></div></div>` +
    settingsTabs("general") +
    orgCard +
    regCard +
    themeCard +
    dangerZone
  )
}
