// ===========================================================================
// Settings › API Keys = ingest tokens page BODY fragment (UIUX §6.7, Spec §6,
// Spec-critical). Returns a FRAGMENT (wrapped by renderAppShellHtml).
//
// - Tokens are MASKED in the list (TokenRow.masked, e.g. amr_live_••••••4f2a),
//   with created / last-used timestamps + a revoke action (owner-only).
// - On creation the plaintext (data.freshToken) is shown ONCE with a copy
//   button + warning ("shown only once, cannot be retrieved") — never in full
//   again. Same ingest loop as onboarding (snippet + View deploy guide).
// ===========================================================================

import { esc, escAttr, badge, stateBlock, button, copyButton, ingestSnippet } from "./layout.js"
import { icon } from "./icons.js"
import { settingsTabs } from "./settings-general.js"
import type { ApiKeysPageData, TokenRow } from "./contract.js"

/** One-time plaintext reveal banner (create-once). */
function reveal(token: string): string {
  return `
<div class="card fade-up" style="border-color:var(--color-primary);margin-bottom:24px">
  <h3 style="display:flex;align-items:center;gap:8px">${icon("keyRound", 20)}Your new ingest token</h3>
  <p class="muted text-sm" style="margin:6px 0 12px">Copy it now and store it securely.</p>
  <div class="token-reveal">
    ${icon("keyRound", 20, "dim")}
    <code class="mono">${esc(token)}</code>
    ${copyButton(token, "Copy token")}
  </div>
  <div class="warn-strip">${icon("alertTriangle", 16)}<span>For security this token is shown <strong>only once</strong> and cannot be retrieved later. If you lose it, revoke it and create a new one.</span></div>
  <h4 class="text-xs dim" style="text-transform:uppercase;letter-spacing:0.04em;margin:18px 0 8px">Wire it into your SDK</h4>
  ${ingestSnippet(token)}
</div>`
}

function createForm(viewerIsOwner: boolean): string {
  if (!viewerIsOwner) return ""
  return `
<form method="post" action="/api/projects/current/tokens" style="margin-bottom:20px">
  ${button("Create ingest token", { variant: "primary", type: "submit", iconName: "plus" })}
</form>`
}

function tokenTable(tokens: TokenRow[], viewerIsOwner: boolean): string {
  const head = `<thead><tr><th>token</th><th>created</th><th>last used</th><th>status</th>${viewerIsOwner ? "<th></th>" : ""}</tr></thead>`
  const body = tokens
    .map((t) => {
      const revoked = Boolean(t.revokedAt)
      const status = revoked ? badge("revoked", "error") : badge("active", "success")
      let action = ""
      if (viewerIsOwner) {
        action = revoked
          ? `<td></td>`
          : `<td style="text-align:right"><form method="post" action="/api/projects/current/tokens/${escAttr(t.id)}/revoke" onsubmit="return confirm('Revoke this token? SDKs using it will stop reporting immediately.');">${button("Revoke", { variant: "danger", type: "submit", iconName: "trash2" })}</form></td>`
      }
      return (
        `<tr${revoked ? ' style="opacity:.6"' : ""}>` +
        `<td class="mono text-sm">${esc(t.masked)}</td>` +
        `<td class="mono text-sm dim">${esc(t.createdAt)}</td>` +
        `<td class="mono text-sm dim">${esc(t.lastUsedAt ?? "never")}</td>` +
        `<td>${status}</td>` +
        action +
        `</tr>`
      )
    })
    .join("")
  return `<div class="table-wrap"><table class="data">${head}<tbody>${body}</tbody></table></div>`
}

export function renderApiKeysPageBody(data: ApiKeysPageData): string {
  const head =
    `<div class="page-head"><div><h1>API Keys</h1><p>Ingest tokens the SDK uses to report this project's routing decisions to the control plane.</p></div></div>` +
    settingsTabs("api-keys")

  const revealBlock = data.freshToken ? reveal(data.freshToken.token) : ""

  let inner: string
  if (!data.tokens || data.tokens.length === 0) {
    inner =
      revealBlock +
      createForm(data.viewerIsOwner) +
      stateBlock({
        kind: "empty",
        glyph: "keyRound",
        title: "No ingest tokens yet",
        description: data.viewerIsOwner
          ? "Create a token, paste it into your SDK config, and this project's routing decisions start flowing into Requests."
          : "Ask an owner to create an ingest token for this project.",
        extra:
          `<div style="max-width:520px;width:100%;margin-top:6px">${ingestSnippet()}</div>` +
          (data.ingestUrl ? `<p class="text-xs dim mono" style="margin-top:10px">POST ${esc(data.ingestUrl)}</p>` : ""),
        actions: button("View deploy guide", { variant: "outline", href: "/docs/deploy", iconName: "bookOpen" }),
      })
  } else {
    inner = revealBlock + createForm(data.viewerIsOwner) + tokenTable(data.tokens, data.viewerIsOwner)
  }

  return head + inner
}
