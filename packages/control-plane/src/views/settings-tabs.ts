// ===========================================================================
// Settings sub-nav — shared segmented tab bar.
//
// Spec §6 page inventory lists exactly two Settings sub-pages:
//   Settings › Members   (/settings/members)
//   Settings › API Keys  (/settings/api-keys)
// (No standalone "Settings › General": close-registration lives on the Members
// page via MembersPageData.registrationOpen — team-lead ruling A.)
//
// Used by both renderMembersPageBody and renderApiKeysPageBody to render the
// Members ↔ API Keys tab strip. In-scope; not part of contract.ts (it is a
// pure presentational helper, no new render-function seam).
// ===========================================================================

import { esc, escAttr } from "./layout.js"

export type SettingsTab = "members" | "api-keys"

/** Segmented tab bar shared across the two in-scope Settings pages. */
export function settingsTabs(active: SettingsTab): string {
  const tabs: [SettingsTab, string, string][] = [
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
