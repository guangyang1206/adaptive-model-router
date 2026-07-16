// ===========================================================================
// packages/control-plane/src/views — public barrel (REAL implementations).
//
// Replaces the backend's temporary placeholder. Every export matches
// ./contract.ts EXACTLY (names + signatures); the backend imports these via
// "./views/index.js". Each page is a PURE render function returning an HTML
// string (mirroring the dashboard's server-rendered pattern) — tokens as CSS
// custom properties, Lucide-only icons, no framework/bundler.
//
// Contract functions:
//   renderLoginHtml, renderOnboardingHtml, renderAppShellHtml,
//   renderRequestsPageBody, renderModelsPageBody, renderMembersPageBody,
//   renderApiKeysPageBody, renderHealthHtml
// ===========================================================================

// --- The eight authoritative contract render functions ---------------------
export { renderLoginHtml } from "./login.js"
export { renderOnboardingHtml } from "./onboarding.js"
export { renderAppShellHtml } from "./shell.js"
export { renderRequestsPageBody } from "./requests.js"
export { renderModelsPageBody } from "./models.js"
export { renderMembersPageBody } from "./members.js"
export { renderApiKeysPageBody } from "./api-keys.js"
export { renderHealthHtml } from "./health.js"

// --- Re-export the contract types for the backend's convenience ------------
export type {
  ViewUser,
  ViewOrg,
  ViewProject,
  ShellContext,
  LoginViewData,
  OnboardingViewData,
  RequestsPageData,
  ModelsPageData,
  MembersPageData,
  MemberRow,
  ApiKeysPageData,
  TokenRow,
  HealthViewData,
  HealthComponent,
} from "./contract.js"

// --- Shared primitives (available if the backend needs them directly) ------
export { CONTROL_PLANE_CSS } from "./styles.js"
export { esc as escapeHtml, escAttr } from "./layout.js"
export { icon } from "./icons.js"

// --- EXTRA (proposed contract addition, not yet in contract.ts) ------------
// A Settings › General / danger-zone body fragment matching the shell-body
// convention. Left available for the backend to wire GET /settings through
// renderAppShellHtml. See settings-general.ts header + team-lead note.
export { renderSettingsGeneralBody, settingsTabs, type SettingsGeneralData, type SettingsTab } from "./settings-general.js"
