// ===========================================================================
// App Shell (UIUX §6.1) — collapsible sidebar (Org switcher · Project switcher/
// filter · nav · invite · avatar menu) + top bar (breadcrumb + ⌘K + refresh).
// Wraps every inner page (Requests / Models / Members / API Keys / Settings).
//
// Consumes the AUTHORITATIVE `ShellContext` from ./contract.ts. Returns a
// COMPLETE HTML document (contract rule 2) embedding the page-specific inner
// fragment.
// ===========================================================================

import { renderDocument, esc, escAttr, avatar, accentVar } from "./layout.js"
import { icon } from "./icons.js"
import type { ShellContext, ViewOrg, ViewProject } from "./contract.js"

/** Resolve the currently-selected project (or undefined for "All projects"). */
function currentProject(shell: ShellContext): ViewProject | undefined {
  return shell.currentProjectId ? shell.projects.find((p) => p.id === shell.currentProjectId) : undefined
}

function currentOrg(shell: ShellContext): ViewOrg | undefined {
  return shell.orgs.find((o) => o.id === shell.currentOrgId) ?? shell.orgs[0]
}

/** Map contract's string accent to the accent CSS var. */
function projectAccent(project?: ViewProject): string {
  return accentVar(project?.accent)
}

function orgSwitcher(org?: ViewOrg): string {
  return (
    `<button class="switcher org" type="button" aria-haspopup="listbox" aria-label="Switch organization">` +
    `<span class="logo" style="width:20px;height:20px;border-radius:5px">${icon("building2", 16)}</span>` +
    `<span class="sw-label"><span style="display:block;overflow:hidden;text-overflow:ellipsis">${esc(org?.name ?? "Organization")}</span>` +
    `<span class="sw-sub">Organization</span></span>` +
    icon("chevronDown", 16, "dim") +
    `</button>`
  )
}

function projectSwitcher(project?: ViewProject): string {
  const label = project ? esc(project.name) : "All projects"
  const dot = `<span class="accent-dot" style="background:${project ? projectAccent(project) : "var(--text-muted)"}"></span>`
  return (
    `<button class="switcher" type="button" aria-haspopup="listbox" aria-label="Switch or filter project">` +
    dot +
    `<span class="sw-label"><span style="display:block;overflow:hidden;text-overflow:ellipsis">${label}</span>` +
    `<span class="sw-sub">Project</span></span>` +
    icon("chevronDown", 16, "dim") +
    `</button>`
  )
}

function navItem(href: string, label: string, iconName: Parameters<typeof icon>[0], active: boolean): string {
  return `<a href="${escAttr(href)}"${active ? ' aria-current="page"' : ""}>${icon(iconName, 20)}<span>${esc(label)}</span></a>`
}

/** Human page title for the <title> tag + breadcrumb tail. */
function navTitle(activeNav: ShellContext["activeNav"]): string {
  switch (activeNav) {
    case "requests":
      return "Requests"
    case "models":
      return "Models"
    case "members":
      return "Members"
    case "api-keys":
      return "API Keys"
    case "settings":
      return "Settings"
  }
}

/**
 * Wrap a page-specific inner fragment with the shell chrome and the outer
 * document. Matches `renderAppShellHtml(shell, innerHtml)` in the contract.
 */
export function renderAppShellHtml(shell: ShellContext, innerHtml: string): string {
  const org = currentOrg(shell)
  const project = currentProject(shell)
  const settingsActive = shell.activeNav === "members" || shell.activeNav === "api-keys" || shell.activeNav === "settings"
  const isOwner = org?.role === "owner"
  const projLabel = project ? esc(project.name) : "All projects"
  const projDot = `<span class="accent-dot" style="background:${project ? projectAccent(project) : "var(--text-muted)"}"></span>`
  const crumbCurrent = navTitle(shell.activeNav)

  const sidebar =
    `<aside class="sidebar">` +
    `<div class="brand"><span class="logo">${icon("activity", 18)}</span><span>Adaptive Router</span></div>` +
    orgSwitcher(org) +
    projectSwitcher(project) +
    `<nav class="nav" aria-label="Primary">` +
    navItem("/requests", "Requests", "inbox", shell.activeNav === "requests") +
    navItem("/models", "Models", "boxes", shell.activeNav === "models") +
    `<div class="nav-sep"></div>` +
    navItem("/settings/members", "Settings", "settings", settingsActive) +
    `</nav>` +
    `<div class="sidebar-foot">` +
    (isOwner ? `<a class="btn btn-outline btn-sm btn-block" href="/settings/members">${icon("userPlus", 20)}Invite people</a>` : "") +
    `<div class="nav-sep"></div>` +
    `<div class="avatar-menu" role="button" tabindex="0" aria-haspopup="menu" aria-label="Account menu">` +
    avatar(shell.user.name, shell.user.email) +
    `<span class="who"><span class="n">${esc(shell.user.name || shell.user.email)}</span>` +
    `<span class="e">${esc(shell.user.email)}</span></span>` +
    `<button class="btn btn-ghost btn-sm" type="button" onclick="cpToggleTheme()" aria-label="Toggle theme" title="Toggle theme">${icon("moon", 16)}</button>` +
    `</div>` +
    `<a class="nav" style="color:var(--text-secondary);padding:8px 10px;font-size:14px;display:flex;align-items:center;gap:10px" href="/api/auth/sign-out">${icon("logOut", 20)}<span>Sign out</span></a>` +
    `</div>` +
    `</aside>`

  const topbar =
    `<div class="topbar">` +
    `<nav class="crumb" aria-label="Breadcrumb">` +
    `<span>${esc(org?.name ?? "")}</span>` +
    `<span class="sep">${icon("chevronRight", 16)}</span>` +
    projDot +
    `<span>${projLabel}</span>` +
    `<span class="sep">${icon("chevronRight", 16)}</span><span class="cur">${esc(crumbCurrent)}</span>` +
    `</nav>` +
    `<div style="display:flex;align-items:center;gap:10px">` +
    `<button class="kbd" type="button" aria-label="Open command palette">${icon("search", 16)}<span>Search</span><kbd>⌘K</kbd></button>` +
    `<button class="btn btn-ghost btn-sm" type="button" onclick="location.reload()" aria-label="Refresh">${icon("refreshCw", 16)}Refresh</button>` +
    `</div>` +
    `</div>`

  const shellBody =
    `<div class="shell">` +
    sidebar +
    `<div class="main">${topbar}<main class="content">${innerHtml}</main></div>` +
    `</div>`

  return renderDocument(shellBody, { title: crumbCurrent })
}
