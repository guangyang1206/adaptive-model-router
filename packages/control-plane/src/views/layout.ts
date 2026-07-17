// ===========================================================================
// Shared layout primitives + HTML utilities for all control-plane pages.
// Mirrors the dashboard's server-rendered-HTML-string approach: pure functions
// returning strings, tokens as CSS custom properties, minimal inline client JS
// only where server-rendered state cannot cover the interaction (copy, drawer,
// theme toggle). No framework, no bundler.
// ===========================================================================

import { CONTROL_PLANE_CSS } from "./styles.js"
import { icon, type IconName } from "./icons.js"

/** HTML-escape text destined for element content. */
export function esc(value: unknown): string {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;")
}

/** Escape for use inside a double-quoted HTML attribute. */
export function escAttr(value: unknown): string {
  return esc(value)
}

export type Theme = "dark" | "light"

export type DocumentShellOptions = {
  title: string
  theme?: Theme
  /** Full-bleed body (no app shell) — used by /login and /onboarding. */
  bodyClass?: string
}

/**
 * The outer HTML document. Every page (with or without the app shell) is
 * wrapped by this so tokens/fonts/reduced-motion rules are always present.
 */
export function renderDocument(bodyHtml: string, options: DocumentShellOptions): string {
  const theme: Theme = options.theme ?? "dark"
  const bodyClass = options.bodyClass ? ` class="${escAttr(options.bodyClass)}"` : ""
  return `<!doctype html>
<html lang="en" data-theme="${theme}">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>${esc(options.title)} · Adaptive Model Router</title>
<style>${CONTROL_PLANE_CSS}</style>
</head>
<body${bodyClass}>
${bodyHtml}
${COMMON_CLIENT_SCRIPT}
</body>
</html>`
}

/**
 * Small, framework-free client helpers shared by all pages:
 *  - copy-to-clipboard (buttons with [data-copy])
 *  - a global toast for copy feedback
 *  - envelope-aware fetch helper `cpApi` (checks `code === "OK"` per ruling 1)
 *  - theme toggle persistence
 * Server-rendered state is always preferred; this only wires interactions the
 * server cannot express statically.
 */
const COMMON_CLIENT_SCRIPT = `<script>
(function(){
  var toastEl=null,toastT=null;
  function toast(msg){
    if(!toastEl){toastEl=document.createElement('div');toastEl.className='toast';document.body.appendChild(toastEl);}
    toastEl.textContent=msg;toastEl.classList.add('show');
    clearTimeout(toastT);toastT=setTimeout(function(){toastEl.classList.remove('show');},1800);
  }
  window.cpToast=toast;
  // Envelope-aware fetch: resolves data on code==="OK", throws message otherwise.
  window.cpApi=async function(path,init){
    var res=await fetch(path,init);
    var payload=null;
    try{payload=await res.json();}catch(_){/* non-JSON */}
    if(payload&&payload.code!=='OK'){throw new Error(payload.message||('Request failed ('+res.status+')'));}
    if(!res.ok){throw new Error((payload&&payload.message)||('Request failed ('+res.status+')'));}
    return payload?payload.data:null;
  };
  document.addEventListener('click',function(e){
    var btn=e.target.closest&&e.target.closest('[data-copy]');
    if(!btn)return;
    var val=btn.getAttribute('data-copy');
    var done=function(){btn.classList.add('copied');toast('Copied to clipboard');setTimeout(function(){btn.classList.remove('copied');},1400);};
    if(navigator.clipboard&&navigator.clipboard.writeText){navigator.clipboard.writeText(val).then(done,function(){toast('Copy failed — select and copy manually');});}
    else{try{var ta=document.createElement('textarea');ta.value=val;document.body.appendChild(ta);ta.select();document.execCommand('copy');ta.remove();done();}catch(_){toast('Copy failed');}}
  });
  // Theme toggle (persisted); progressive — page still renders server theme.
  window.cpToggleTheme=function(){
    var root=document.documentElement;
    var next=root.getAttribute('data-theme')==='light'?'dark':'light';
    root.setAttribute('data-theme',next);
    try{document.cookie='cp_theme='+next+';path=/;max-age=31536000;samesite=lax';}catch(_){}
  };
})();
</script>`

// --- Reusable UI atoms -----------------------------------------------------

export type BadgeTone = "success" | "warning" | "error" | "info" | "neutral" | "owner"

/** Semantic-color pill with a leading dot. */
export function badge(label: string, tone: BadgeTone): string {
  return `<span class="badge badge-${tone}"><span class="dot"></span>${esc(label)}</span>`
}

/** Map a routing status to its semantic badge (hit/green, fallback/amber, failure/red). */
export function statusBadge(status: string): string {
  const map: Record<string, { tone: BadgeTone; label: string }> = {
    success: { tone: "success", label: "success" },
    hit: { tone: "success", label: "hit" },
    fallback_success: { tone: "warning", label: "fallback" },
    fallback: { tone: "warning", label: "fallback" },
    degraded: { tone: "warning", label: "degraded" },
    failed: { tone: "error", label: "failed" },
    error: { tone: "error", label: "error" },
    timeout: { tone: "error", label: "timeout" },
  }
  const m = map[status] ?? { tone: "neutral" as BadgeTone, label: status || "unknown" }
  return badge(m.label, m.tone)
}

/** Initials avatar (deterministic; no external image dependency). */
export function avatar(name: string | undefined, email?: string, large = false): string {
  const src = (name || email || "?").trim()
  const initials = src
    .split(/[\s@._-]+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase() ?? "")
    .join("") || "?"
  return `<span class="avatar${large ? " avatar-lg" : ""}" aria-hidden="true">${esc(initials)}</span>`
}

/** Project accent index (1..8) → CSS var name. */
export function accentVar(accent: number | string | undefined): string {
  const n = typeof accent === "number" ? accent : Number(accent)
  const idx = Number.isFinite(n) && n >= 1 && n <= 8 ? n : 1
  return `var(--accent-${idx})`
}

export type StateKind = "empty" | "error" | "loading"

export type StateBlockOptions = {
  kind: StateKind
  glyph?: IconName
  title: string
  description?: string
  /** Raw HTML for the action row (buttons/links). */
  actions?: string
  /** Extra HTML placed below the description (e.g. an integration snippet). */
  extra?: string
}

/**
 * Honest empty / error / loading state — required on every data view
 * (anti-slop gate + acceptance A11). Uses a Lucide glyph, never emoji.
 */
export function stateBlock(opts: StateBlockOptions): string {
  if (opts.kind === "loading") {
    return (
      `<div class="table-wrap" role="status" aria-live="polite" aria-busy="true">` +
      Array.from({ length: 5 })
        .map(
          () =>
            `<div class="skeleton-row"><span class="skeleton"></span><span class="skeleton"></span><span class="skeleton"></span><span class="skeleton"></span></div>`,
        )
        .join("") +
      `<span class="dim text-xs" style="display:block;padding:12px 14px">${esc(opts.title || "Loading…")}</span></div>`
    )
  }
  const glyph = opts.glyph ?? (opts.kind === "error" ? "alertTriangle" : "inbox")
  return (
    `<div class="state${opts.kind === "error" ? " is-error" : ""}" role="${opts.kind === "error" ? "alert" : "status"}">` +
    `<span class="glyph">${icon(glyph, 24)}</span>` +
    `<h3>${esc(opts.title)}</h3>` +
    (opts.description ? `<p>${esc(opts.description)}</p>` : "") +
    (opts.extra ?? "") +
    (opts.actions ? `<div class="actions">${opts.actions}</div>` : "") +
    `</div>`
  )
}

/** A copy button carrying its payload in data-copy (wired by COMMON_CLIENT_SCRIPT). */
export function copyButton(value: string, label = "Copy"): string {
  return `<button type="button" class="copy-btn" data-copy="${escAttr(value)}">${icon("copy", 16)}${esc(label)}</button>`
}

/** Primary / outline / ghost button element. */
export function button(
  label: string,
  opts: { variant?: "primary" | "outline" | "ghost" | "danger"; iconName?: IconName; href?: string; type?: string; block?: boolean; attrs?: string } = {},
): string {
  const variant = opts.variant ?? "outline"
  const cls = `btn btn-${variant}${opts.block ? " btn-block" : ""}`
  const inner = `${opts.iconName ? icon(opts.iconName, 20) : ""}${esc(label)}`
  if (opts.href) return `<a class="${cls}" href="${escAttr(opts.href)}"${opts.attrs ? " " + opts.attrs : ""}>${inner}</a>`
  return `<button class="${cls}" type="${opts.type ?? "button"}"${opts.attrs ? " " + opts.attrs : ""}>${inner}</button>`
}

/**
 * The reusable minimal-integration snippet that closes the ingest loop
 * (onboarding step 3 + Requests empty state + API Keys page). `token` is the
 * plaintext ingest token when known, else an env-var placeholder.
 */
export function ingestSnippet(token?: string): string {
  const tokenExpr = token
    ? `<span class="tok-str">"${esc(token)}"</span>`
    : `process.<span class="tok-fn">env</span>.<span class="tok-kw">AMR_INGEST_TOKEN</span>`
  return (
    `<div class="snippet" aria-label="SDK integration snippet">` +
    `<header><span>SDK configuration</span>${copyButton(ingestSnippetPlain(token), "Copy snippet")}</header>` +
    `<pre><span class="tok-kw">import</span> { <span class="tok-fn">createRouter</span> } <span class="tok-kw">from</span> <span class="tok-str">"adaptive-model-router"</span>;

<span class="tok-kw">const</span> router = <span class="tok-fn">createRouter</span>({
  ingestToken: ${tokenExpr}, <span class="tok-com">// paste the token above</span>
  <span class="tok-com">// ...your routing config</span>
});
<span class="tok-com">// Every routing decision is now auto-reported to this project</span>
<span class="tok-com">// and appears under Requests here.</span></pre>` +
    `</div>`
  )
}

/** Plain-text form of the snippet (used for the copy button payload). */
export function ingestSnippetPlain(token?: string): string {
  const tokenExpr = token ? `"${token}"` : "process.env.AMR_INGEST_TOKEN"
  return [
    `import { createRouter } from "adaptive-model-router";`,
    ``,
    `const router = createRouter({`,
    `  ingestToken: ${tokenExpr}, // paste the token above`,
    `  // ...your routing config`,
    `});`,
    `// Every routing decision is now auto-reported to this project`,
    `// and appears under Requests here.`,
  ].join("\n")
}
