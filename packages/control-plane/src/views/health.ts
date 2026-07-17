// ===========================================================================
// Health self-check page (P1, UIUX §6/§7, Spec §4.5). Contract:
// renderHealthHtml(data). Returns a COMPLETE HTML document (human-readable
// readiness page; the JSON form of /health is served by the backend directly).
// Component readiness list with semantic status glyphs (Lucide, no emoji).
// ===========================================================================

import { renderDocument, esc } from "./layout.js"
import { icon } from "./icons.js"
import type { HealthViewData, HealthComponent } from "./contract.js"

function componentRow(c: HealthComponent): string {
  const glyph = c.ok
    ? `<span style="color:var(--color-success)">${icon("checkCircle", 20)}</span>`
    : `<span style="color:var(--color-error)">${icon("alertCircle", 20)}</span>`
  return (
    `<div style="display:flex;align-items:center;gap:12px;padding:14px 16px;border-bottom:1px solid var(--border-subtle)">` +
    glyph +
    `<div style="flex:1"><div style="font-weight:550">${esc(c.name)}</div>` +
    (c.detail ? `<div class="text-sm dim mono">${esc(c.detail)}</div>` : "") +
    `</div>` +
    `<span class="badge ${c.ok ? "badge-success" : "badge-error"}"><span class="dot"></span>${c.ok ? "ready" : "failing"}</span>` +
    `</div>`
  )
}

export function renderHealthHtml(data: HealthViewData): string {
  const body = `
<main class="wizard fade-up" style="margin-top:64px">
  <div class="brand" style="padding:0 0 20px;font-size:15px">
    <span class="logo">${icon("activity", 18)}</span><span>Adaptive Router</span>
  </div>
  <div class="card" style="padding:0;overflow:hidden">
    <div style="display:flex;align-items:center;justify-content:space-between;gap:12px;padding:18px 20px;border-bottom:1px solid var(--border-default)">
      <div>
        <h2>Readiness</h2>
        <p class="text-sm dim" style="margin-top:2px">Deployment self-check</p>
      </div>
      <span class="badge ${data.ok ? "badge-success" : "badge-error"}" style="font-size:13px;padding:5px 12px"><span class="dot"></span>${data.ok ? "All systems ready" : "Degraded"}</span>
    </div>
    ${data.components.map(componentRow).join("")}
  </div>
</main>`
  return renderDocument(body, { title: "Health", bodyClass: "health-body" })
}
