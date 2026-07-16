// ===========================================================================
// Design-token stylesheet (Spec §7 / UIUX §2–§4) — a single CSS string served
// inline, mirroring the existing dashboard's "tokens as CSS custom properties"
// approach (NO framework, NO bundler). Dark-primary is the default theme; a
// light theme is provided as a settings option via the SAME semantic vars.
//
// Every color in the whole control-plane goes through a token defined here.
// Components in the page renderers reference `var(--token)` — no hard-coded hex
// lives outside this block (the anti-slop "all colors via tokens" gate).
// ===========================================================================

export const CONTROL_PLANE_CSS = `
/* ---- Tokens: dark-primary (default) ---- */
:root, :root[data-theme="dark"]{
  color-scheme: dark;
  --bg-primary:#0D1117; --bg-surface:#161B22; --bg-elevated:#21262D; --bg-overlay:rgba(0,0,0,0.6);
  --text-primary:#F0F6FC; --text-secondary:#8B949E; --text-muted:#484F58;
  --color-primary:#6366F1; --color-primary-hover:#818CF8; --color-primary-subtle:rgba(99,102,241,0.12);
  --color-primary-contrast:#FFFFFF;
  --color-success:#3FB950; --color-warning:#D29922; --color-error:#F85149; --color-info:#58A6FF;
  --color-success-subtle:rgba(63,185,80,0.14); --color-warning-subtle:rgba(210,153,34,0.14);
  --color-error-subtle:rgba(248,81,73,0.14); --color-info-subtle:rgba(88,166,255,0.14);
  --border-default:#30363D; --border-subtle:#22272E; --border-focus:#6366F1;
  --radius-sm:4px; --radius-md:8px; --radius-lg:12px;
  --shadow-elev:0 1px 2px rgba(0,0,0,0.24), 0 8px 24px rgba(0,0,0,0.28);
  --shadow-glow:0 0 40px rgba(99,102,241,0.10);
  --duration-fast:150ms; --duration-normal:250ms; --easing-smooth:cubic-bezier(0.4,0,0.2,1);
  /* project accent palette (8 fixed) — switcher dot + breadcrumb tag only */
  --accent-1:#6366F1; --accent-2:#3FB950; --accent-3:#D29922; --accent-4:#F85149;
  --accent-5:#58A6FF; --accent-6:#DB61A2; --accent-7:#39C5CF; --accent-8:#E3B341;
}
/* ---- Tokens: light theme (settings option; same semantic vars) ---- */
:root[data-theme="light"]{
  color-scheme: light;
  --bg-primary:#FBFCFE; --bg-surface:#FFFFFF; --bg-elevated:#F4F6FA; --bg-overlay:rgba(15,23,42,0.35);
  --text-primary:#1C2333; --text-secondary:#5B667A; --text-muted:#9AA4B6;
  --color-primary:#5457E5; --color-primary-hover:#4144C9; --color-primary-subtle:rgba(84,87,229,0.10);
  --color-primary-contrast:#FFFFFF;
  --color-success:#1A7F37; --color-warning:#9A6700; --color-error:#CF222E; --color-info:#0969DA;
  --color-success-subtle:rgba(26,127,55,0.10); --color-warning-subtle:rgba(154,103,0,0.10);
  --color-error-subtle:rgba(207,34,46,0.10); --color-info-subtle:rgba(9,105,218,0.10);
  --border-default:#D5DAE1; --border-subtle:#E7EAEF; --border-focus:#5457E5;
  --shadow-elev:0 1px 2px rgba(27,35,51,0.06), 0 8px 24px rgba(27,35,51,0.08);
  --shadow-glow:0 0 40px rgba(84,87,229,0.08);
}

/* ---- Base ---- */
*{box-sizing:border-box}
html,body{height:100%}
body{
  margin:0; background:var(--bg-primary); color:var(--text-primary);
  font:16px/1.55 "Inter","Noto Sans SC",-apple-system,BlinkMacSystemFont,sans-serif;
  -webkit-font-smoothing:antialiased; text-rendering:optimizeLegibility;
}
.mono{font-family:"JetBrains Mono","Fira Code",ui-monospace,monospace}
a{color:var(--color-primary);text-decoration:none}
a:hover{color:var(--color-primary-hover);text-decoration:underline}
h1{font-size:24px;line-height:1.25;margin:0;font-weight:650;letter-spacing:-0.01em}
h2{font-size:20px;line-height:1.3;margin:0;font-weight:600}
h3{font-size:16px;line-height:1.4;margin:0;font-weight:600}
p{margin:0}
.muted{color:var(--text-secondary)}
.dim{color:var(--text-muted)}
.text-sm{font-size:14px}
.text-xs{font-size:12px}

/* ---- Focus visibility (a11y gate): 2px ring on keyboard focus only ---- */
:focus{outline:none}
:focus-visible{
  outline:2px solid var(--border-focus);
  outline-offset:2px;
  border-radius:var(--radius-sm);
}

/* ---- Buttons: all interactive states (default/hover/active/focus/disabled) ---- */
.btn{
  display:inline-flex;align-items:center;justify-content:center;gap:8px;
  font:inherit;font-size:14px;font-weight:550;line-height:1;
  padding:9px 14px;border-radius:var(--radius-md);cursor:pointer;
  border:1px solid transparent;background:var(--bg-elevated);color:var(--text-primary);
  transition:background-color var(--duration-fast) var(--easing-smooth),
             border-color var(--duration-fast) var(--easing-smooth),
             transform var(--duration-fast) var(--easing-smooth),
             box-shadow var(--duration-fast) var(--easing-smooth);
  user-select:none;white-space:nowrap;
}
.btn:hover{background:var(--border-default)}
.btn:active{transform:translateY(1px)}
.btn:disabled,.btn[aria-disabled="true"]{opacity:.5;cursor:not-allowed;transform:none}
.btn svg{flex:none}
.btn-primary{background:var(--color-primary);color:var(--color-primary-contrast);border-color:var(--color-primary)}
.btn-primary:hover{background:var(--color-primary-hover);border-color:var(--color-primary-hover)}
.btn-primary:active{transform:translateY(1px)}
.btn-outline{background:transparent;border-color:var(--border-default);color:var(--text-primary)}
.btn-outline:hover{background:var(--bg-elevated);border-color:var(--border-focus)}
.btn-ghost{background:transparent;color:var(--text-secondary)}
.btn-ghost:hover{background:var(--bg-elevated);color:var(--text-primary)}
.btn-danger{background:transparent;border-color:var(--color-error);color:var(--color-error)}
.btn-danger:hover{background:var(--color-error-subtle)}
.btn-block{width:100%}
.btn-sm{padding:6px 10px;font-size:13px}
/* in-button spinner (Loading state) */
.btn .spin{animation:cp-spin 800ms linear infinite}
.btn.is-loading{pointer-events:none;opacity:.85}

/* ---- Inputs / forms (labeled controls a11y gate) ---- */
.field{display:grid;gap:6px;margin-bottom:16px}
.field label{font-size:13px;font-weight:550;color:var(--text-secondary)}
.field .hint{font-size:12px;color:var(--text-muted)}
.field .err-text{font-size:12px;color:var(--color-error);display:flex;align-items:center;gap:6px}
.input,.select{
  width:100%;font:inherit;font-size:14px;color:var(--text-primary);
  background:var(--bg-surface);border:1px solid var(--border-default);
  border-radius:var(--radius-md);padding:9px 12px;
  transition:border-color var(--duration-fast) var(--easing-smooth),
             box-shadow var(--duration-fast) var(--easing-smooth);
}
.input::placeholder{color:var(--text-muted)}
.input:hover,.select:hover{border-color:var(--text-muted)}
.input:focus-visible,.select:focus-visible{
  outline:none;border-color:var(--border-focus);
  box-shadow:0 0 0 3px var(--color-primary-subtle);
}
.input.has-error{border-color:var(--color-error)}
.input:disabled,.select:disabled{opacity:.55;cursor:not-allowed}

/* ---- Cards / surfaces ---- */
.card{
  background:var(--bg-surface);border:1px solid var(--border-default);
  border-radius:var(--radius-lg);padding:20px;
}
.surface{background:var(--bg-surface);border:1px solid var(--border-default);border-radius:var(--radius-md)}

/* ---- Badges (semantic routing colors) ---- */
.badge{
  display:inline-flex;align-items:center;gap:5px;font-size:12px;font-weight:550;
  padding:3px 8px;border-radius:999px;border:1px solid transparent;line-height:1.4;
}
.badge .dot{width:6px;height:6px;border-radius:50%;background:currentColor;flex:none}
.badge-success{color:var(--color-success);background:var(--color-success-subtle)}
.badge-warning{color:var(--color-warning);background:var(--color-warning-subtle)}
.badge-error{color:var(--color-error);background:var(--color-error-subtle)}
.badge-info{color:var(--color-info);background:var(--color-info-subtle)}
.badge-neutral{color:var(--text-secondary);background:var(--bg-elevated)}
.badge-owner{color:var(--color-primary);background:var(--color-primary-subtle)}

/* ---- Tables (monospace technical identifiers) ---- */
.table-wrap{border:1px solid var(--border-default);border-radius:var(--radius-lg);overflow:hidden}
table.data{width:100%;border-collapse:collapse;font-size:14px}
table.data thead th{
  text-align:left;font-size:12px;font-weight:600;color:var(--text-secondary);
  text-transform:none;letter-spacing:0.01em;padding:11px 14px;
  background:var(--bg-elevated);border-bottom:1px solid var(--border-default);white-space:nowrap;
}
table.data tbody td{padding:12px 14px;border-bottom:1px solid var(--border-subtle);vertical-align:middle}
table.data tbody tr:last-child td{border-bottom:none}
table.data tbody tr[data-row]{cursor:pointer;transition:background-color var(--duration-fast) var(--easing-smooth)}
table.data tbody tr[data-row]:hover{background:var(--bg-elevated)}
table.data tbody tr[data-row]:focus-visible{background:var(--bg-elevated);outline:2px solid var(--border-focus);outline-offset:-2px}

/* ---- Avatars ---- */
.avatar{
  width:28px;height:28px;border-radius:50%;flex:none;
  display:inline-flex;align-items:center;justify-content:center;
  font-size:12px;font-weight:600;color:var(--color-primary-contrast);
  background:var(--color-primary);border:1px solid var(--border-default);
}
.avatar-lg{width:36px;height:36px;font-size:14px}

/* ---- Empty / loading / error state blocks (present on every data view) ---- */
.state{
  display:flex;flex-direction:column;align-items:center;text-align:center;
  padding:56px 24px;gap:14px;color:var(--text-secondary);
}
.state .glyph{
  width:56px;height:56px;border-radius:var(--radius-lg);
  display:flex;align-items:center;justify-content:center;
  background:var(--color-primary-subtle);color:var(--color-primary);
}
.state.is-error .glyph{background:var(--color-error-subtle);color:var(--color-error)}
.state h3{color:var(--text-primary)}
.state p{max-width:460px;color:var(--text-secondary)}
.state .actions{display:flex;gap:10px;margin-top:6px;flex-wrap:wrap;justify-content:center}
.skeleton{
  background:linear-gradient(90deg,var(--bg-elevated) 25%,var(--border-subtle) 37%,var(--bg-elevated) 63%);
  background-size:400% 100%;border-radius:var(--radius-sm);animation:cp-shimmer 1.4s ease infinite;
  height:14px;
}
.skeleton-row{display:grid;grid-template-columns:1.4fr 1fr 1fr 1fr;gap:14px;padding:12px 14px;border-bottom:1px solid var(--border-subtle)}

/* ---- Code / snippet block (onboarding step 3, empty-state loop, api-keys) ---- */
.snippet{
  position:relative;background:var(--bg-primary);border:1px solid var(--border-default);
  border-radius:var(--radius-md);overflow:hidden;
}
.snippet header{
  display:flex;align-items:center;justify-content:space-between;
  padding:8px 12px;background:var(--bg-elevated);border-bottom:1px solid var(--border-default);
  font-size:12px;color:var(--text-secondary);
}
.snippet pre{
  margin:0;padding:14px 16px;overflow-x:auto;
  font-family:"JetBrains Mono","Fira Code",ui-monospace,monospace;font-size:13px;line-height:1.7;
  color:var(--text-primary);
}
.snippet .tok-kw{color:var(--color-info)}
.snippet .tok-str{color:var(--color-success)}
.snippet .tok-com{color:var(--text-muted)}
.snippet .tok-fn{color:var(--color-primary-hover)}

/* copy button used inline (tokens / snippet) */
.copy-btn{
  display:inline-flex;align-items:center;gap:6px;font:inherit;font-size:12px;
  background:var(--bg-surface);color:var(--text-secondary);cursor:pointer;
  border:1px solid var(--border-default);border-radius:var(--radius-sm);padding:5px 9px;
  transition:color var(--duration-fast) var(--easing-smooth),border-color var(--duration-fast) var(--easing-smooth);
}
.copy-btn:hover{color:var(--text-primary);border-color:var(--border-focus)}
.copy-btn.copied{color:var(--color-success);border-color:var(--color-success)}

/* token reveal row (plaintext-once) */
.token-reveal{
  display:flex;align-items:center;gap:10px;padding:12px 14px;
  background:var(--bg-primary);border:1px solid var(--color-primary);border-radius:var(--radius-md);
}
.token-reveal code{flex:1;font-size:14px;color:var(--text-primary);word-break:break-all}
.warn-strip{
  display:flex;align-items:flex-start;gap:8px;padding:10px 12px;margin-top:12px;
  background:var(--color-warning-subtle);border:1px solid var(--color-warning);
  border-radius:var(--radius-md);color:var(--color-warning);font-size:13px;line-height:1.5;
}
.warn-strip svg{flex:none;margin-top:1px}

/* ---- App shell layout ---- */
.shell{display:grid;grid-template-columns:248px 1fr;min-height:100dvh}
.sidebar{
  background:var(--bg-surface);border-right:1px solid var(--border-default);
  display:flex;flex-direction:column;padding:14px 12px;gap:6px;min-width:0;
}
.brand{display:flex;align-items:center;gap:9px;padding:6px 8px 12px;font-weight:650;font-size:15px}
.brand .logo{
  width:26px;height:26px;border-radius:7px;flex:none;display:flex;align-items:center;justify-content:center;
  background:var(--color-primary);color:var(--color-primary-contrast);
}
.switcher{
  display:flex;align-items:center;gap:9px;width:100%;padding:9px 10px;
  background:var(--bg-elevated);border:1px solid var(--border-default);border-radius:var(--radius-md);
  color:var(--text-primary);cursor:pointer;font:inherit;font-size:14px;text-align:left;
  transition:border-color var(--duration-fast) var(--easing-smooth);
}
.switcher:hover{border-color:var(--border-focus)}
.switcher .accent-dot{width:9px;height:9px;border-radius:50%;flex:none}
.switcher .sw-label{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.switcher .sw-sub{font-size:11px;color:var(--text-muted)}
.switcher.org{margin-bottom:2px}
.nav{display:flex;flex-direction:column;gap:2px;margin-top:8px}
.nav a{
  display:flex;align-items:center;gap:10px;padding:8px 10px;border-radius:var(--radius-md);
  color:var(--text-secondary);font-size:14px;font-weight:500;text-decoration:none;
  transition:background-color var(--duration-fast) var(--easing-smooth),color var(--duration-fast) var(--easing-smooth);
}
.nav a:hover{background:var(--bg-elevated);color:var(--text-primary);text-decoration:none}
.nav a[aria-current="page"]{background:var(--color-primary-subtle);color:var(--color-primary)}
.nav-sep{height:1px;background:var(--border-subtle);margin:8px 4px}
.sidebar-foot{margin-top:auto;display:flex;flex-direction:column;gap:6px;padding-top:10px}
.avatar-menu{
  display:flex;align-items:center;gap:10px;padding:8px;border-radius:var(--radius-md);
  cursor:pointer;transition:background-color var(--duration-fast) var(--easing-smooth);
}
.avatar-menu:hover{background:var(--bg-elevated)}
.avatar-menu .who{flex:1;min-width:0}
.avatar-menu .who .n{font-size:13px;font-weight:550;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.avatar-menu .who .e{font-size:11px;color:var(--text-muted);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}

.main{display:flex;flex-direction:column;min-width:0}
.topbar{
  display:flex;align-items:center;justify-content:space-between;gap:16px;
  padding:14px 28px;border-bottom:1px solid var(--border-default);background:var(--bg-primary);
}
.crumb{display:flex;align-items:center;gap:8px;font-size:14px;color:var(--text-secondary);min-width:0}
.crumb .accent-dot{width:9px;height:9px;border-radius:50%;flex:none}
.crumb .sep{color:var(--text-muted)}
.crumb .cur{color:var(--text-primary);font-weight:550}
.kbd{
  display:inline-flex;align-items:center;gap:6px;font-size:12px;color:var(--text-secondary);
  background:var(--bg-elevated);border:1px solid var(--border-default);border-radius:var(--radius-sm);
  padding:5px 9px;cursor:pointer;
}
.kbd kbd{font-family:"JetBrains Mono",monospace;font-size:11px;color:var(--text-primary)}
.content{padding:28px;min-width:0;flex:1}
.page-head{display:flex;align-items:flex-start;justify-content:space-between;gap:16px;margin-bottom:20px}
.page-head p{margin-top:5px;color:var(--text-secondary);font-size:14px}

/* toolbar / filters */
.toolbar{display:flex;gap:10px;margin-bottom:16px;flex-wrap:wrap;align-items:center}
.toolbar .grow{flex:1;min-width:180px}
.input-search{position:relative;display:flex;align-items:center}
.input-search svg{position:absolute;left:11px;color:var(--text-muted);pointer-events:none}
.input-search .input{padding-left:34px}

/* metric cards */
.metrics{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:12px;margin-bottom:20px}
.metric{background:var(--bg-surface);border:1px solid var(--border-default);border-radius:var(--radius-lg);padding:16px}
.metric .lbl{font-size:12px;color:var(--text-secondary)}
.metric .val{font-size:24px;font-weight:650;margin-top:6px}

/* by-avatar cell (collaboration layer) */
.by{display:inline-flex;align-items:center;gap:7px}
.by .avatar{width:22px;height:22px;font-size:10px}

/* decision drawer (right side) */
.drawer-backdrop{
  position:fixed;inset:0;background:var(--bg-overlay);z-index:40;
  opacity:0;pointer-events:none;transition:opacity var(--duration-normal) var(--easing-smooth);
}
.drawer-backdrop.open{opacity:1;pointer-events:auto}
.drawer{
  position:fixed;top:0;right:0;height:100dvh;width:min(520px,92vw);z-index:41;
  background:var(--bg-surface);border-left:1px solid var(--border-default);
  box-shadow:var(--shadow-elev);transform:translateX(100%);
  transition:transform var(--duration-normal) var(--easing-smooth);
  display:flex;flex-direction:column;overflow:hidden;
}
.drawer.open{transform:translateX(0)}
.drawer header{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:18px 20px;border-bottom:1px solid var(--border-default)}
.drawer .body{padding:20px;overflow-y:auto}
.drawer h4{font-size:12px;text-transform:uppercase;letter-spacing:0.04em;color:var(--text-muted);margin:18px 0 8px}
.drawer h4:first-child{margin-top:0}
.step-item{display:flex;gap:12px;padding:10px 0;border-bottom:1px solid var(--border-subtle)}
.step-item:last-child{border-bottom:none}
.step-item .idx{width:22px;height:22px;border-radius:50%;flex:none;display:flex;align-items:center;justify-content:center;font-size:11px;background:var(--bg-elevated);color:var(--text-secondary)}
.step-item .idx.win{background:var(--color-success-subtle);color:var(--color-success)}

/* onboarding stepper */
.wizard{max-width:640px;margin:48px auto;padding:0 24px}
.steps{display:flex;align-items:center;gap:0;margin-bottom:32px}
.steps .step{display:flex;align-items:center;gap:10px;flex:1}
.steps .step .num{
  width:28px;height:28px;border-radius:50%;flex:none;display:flex;align-items:center;justify-content:center;
  font-size:13px;font-weight:600;border:1px solid var(--border-default);color:var(--text-secondary);background:var(--bg-surface);
}
.steps .step.done .num{background:var(--color-success);border-color:var(--color-success);color:#fff}
.steps .step.active .num{background:var(--color-primary);border-color:var(--color-primary);color:#fff}
.steps .step .st-label{font-size:13px;color:var(--text-secondary)}
.steps .step.active .st-label,.steps .step.done .st-label{color:var(--text-primary)}
.steps .bar{height:1px;flex:1;background:var(--border-default);margin:0 6px}
.steps .bar.done{background:var(--color-success)}

/* login layout */
.auth-wrap{min-height:100dvh;display:flex;align-items:center;justify-content:center;padding:24px}
.auth-card{width:100%;max-width:400px;background:var(--bg-surface);border:1px solid var(--border-default);border-radius:var(--radius-lg);padding:32px;box-shadow:var(--shadow-glow)}
.auth-card .brand{justify-content:center;padding:0 0 6px}
.auth-tagline{text-align:center;color:var(--text-secondary);font-size:14px;margin-bottom:24px}
.divider{display:flex;align-items:center;gap:12px;margin:18px 0;color:var(--text-muted);font-size:12px}
.divider::before,.divider::after{content:"";flex:1;height:1px;background:var(--border-default)}
.sso-note{margin-top:18px;padding-top:16px;border-top:1px solid var(--border-subtle);text-align:center;font-size:12px;color:var(--text-muted)}

/* danger zone */
.danger-zone{border:1px solid var(--color-error);border-radius:var(--radius-lg);overflow:hidden;margin-top:24px}
.danger-zone .dz-head{padding:14px 20px;border-bottom:1px solid var(--color-error);background:var(--color-error-subtle);color:var(--color-error);font-weight:600}
.danger-zone .dz-row{display:flex;align-items:center;justify-content:space-between;gap:16px;padding:16px 20px}
.danger-zone .dz-row .dz-text .t{font-weight:550}
.danger-zone .dz-row .dz-text .d{font-size:13px;color:var(--text-secondary);margin-top:2px}

/* segmented settings tabs */
.seg{display:inline-flex;background:var(--bg-elevated);border:1px solid var(--border-default);border-radius:var(--radius-md);padding:3px;gap:2px;margin-bottom:24px}
.seg a{padding:6px 14px;border-radius:var(--radius-sm);font-size:13px;color:var(--text-secondary);text-decoration:none;transition:background-color var(--duration-fast) var(--easing-smooth),color var(--duration-fast) var(--easing-smooth)}
.seg a:hover{color:var(--text-primary);text-decoration:none}
.seg a[aria-current="page"]{background:var(--bg-surface);color:var(--text-primary)}

/* role select with reserved/disabled group */
.role-select optgroup[disabled],.role-select option[disabled]{color:var(--text-muted)}

/* toast (copy feedback) */
.toast{
  position:fixed;bottom:24px;left:50%;transform:translateX(-50%) translateY(12px);
  background:var(--bg-elevated);border:1px solid var(--border-default);color:var(--text-primary);
  padding:10px 16px;border-radius:var(--radius-md);box-shadow:var(--shadow-elev);
  font-size:13px;opacity:0;pointer-events:none;z-index:60;
  transition:opacity var(--duration-fast) var(--easing-smooth),transform var(--duration-fast) var(--easing-smooth);
}
.toast.show{opacity:1;transform:translateX(-50%) translateY(0)}

@keyframes cp-spin{to{transform:rotate(360deg)}}
@keyframes cp-shimmer{0%{background-position:100% 0}100%{background-position:-100% 0}}
@keyframes cp-fade-up{from{opacity:0;transform:translateY(8px)}to{opacity:1;transform:translateY(0)}}
.fade-up{animation:cp-fade-up var(--duration-normal) var(--easing-smooth) both}

/* Reduced-motion: disable all transitions/animations (a11y gate) */
@media (prefers-reduced-motion: reduce){
  *,*::before,*::after{
    animation-duration:0.001ms !important;animation-iteration-count:1 !important;
    transition-duration:0.001ms !important;scroll-behavior:auto !important;
  }
}

/* Responsive: desktop-first developer tool; usable at laptop widths */
@media (max-width:920px){
  .shell{grid-template-columns:1fr}
  .sidebar{display:none}
  .metrics{grid-template-columns:repeat(2,minmax(0,1fr))}
}
`
