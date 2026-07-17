// ===========================================================================
// Onboarding wizard (UIUX §6.3, Spec §6, Spec-critical ruling ③).
// Contract: renderOnboardingHtml(data). Returns a COMPLETE HTML document.
//
// 3-step checklist derived from the data:
//   step 1 (name org)      when no orgs exist yet
//   step 2 (first project) when an org exists but no project
//   step 3 (ingest token)  when a fresh plaintext token is present
// Step 3 closes the loop: show the token (once) + a copyable monospace SDK
// snippet — configure token → SDK auto-reports → decisions appear in Requests.
// Backed by /api/orgs, /api/orgs/:id/projects, /api/projects/:id/tokens.
// ===========================================================================

import { renderDocument, esc, escAttr, button, ingestSnippet, copyButton } from "./layout.js"
import { icon } from "./icons.js"
import type { OnboardingViewData } from "./contract.js"

type Step = 1 | 2 | 3

function resolveStep(data: OnboardingViewData): Step {
  if (data.freshToken) return 3
  if (data.orgs.length === 0) return 1
  if (data.projects.length === 0) return 2
  // Org + project exist but no token yet → still the token step (create it).
  return 3
}

function stepper(current: Step): string {
  const labels: [Step, string][] = [
    [1, "Organization"],
    [2, "First project"],
    [3, "Ingest token"],
  ]
  const parts: string[] = []
  labels.forEach(([n, label], i) => {
    const state = n < current ? "done" : n === current ? "active" : ""
    const inner = n < current ? icon("check", 16) : String(n)
    parts.push(`<div class="step ${state}"><span class="num">${inner}</span><span class="st-label">${esc(label)}</span></div>`)
    if (i < labels.length - 1) parts.push(`<span class="bar${n < current ? " done" : ""}"></span>`)
  })
  return `<div class="steps" aria-label="Onboarding progress, step ${current} of 3">${parts.join("")}</div>`
}

function step1(): string {
  return `
<h1>Name your organization</h1>
<p class="muted" style="margin:6px 0 22px">An organization groups your projects and teammates. You can rename it later in Settings.</p>
<form method="post" action="/api/orgs" novalidate>
  <div class="field">
    <label for="org-name">Organization name</label>
    <input class="input" id="org-name" name="name" required minlength="2" maxlength="60" placeholder="Acme Platform" autofocus />
    <span class="hint">2–60 characters. Shown in the sidebar switcher.</span>
  </div>
  ${button("Continue", { variant: "primary", type: "submit", iconName: "arrowRight", block: true })}
</form>`
}

function step2(data: OnboardingViewData): string {
  const orgId = data.orgs[0]?.id ?? "current"
  return `
<h1>Create your first project</h1>
<p class="muted" style="margin:6px 0 22px">A project owns its own routing decisions and ingest tokens — one per customer, environment, or app. We'll assign it an accent color automatically.</p>
<form method="post" action="/api/orgs/${escAttr(orgId)}/projects" novalidate>
  <div class="field">
    <label for="proj-name">Project name</label>
    <input class="input" id="proj-name" name="name" required minlength="2" maxlength="60" placeholder="production" autofocus />
    <span class="hint">e.g. "production", "staging", or a customer name.</span>
  </div>
  ${button("Create project", { variant: "primary", type: "submit", iconName: "arrowRight", block: true })}
</form>`
}

function step3(data: OnboardingViewData): string {
  const token = data.freshToken?.token
  const projectId = data.freshToken?.projectId ?? data.projects[0]?.id ?? "current"

  // If no token yet, offer to create one; otherwise reveal it once.
  if (!token) {
    return `
<h1>Get your ingest token</h1>
<p class="muted" style="margin:6px 0 20px">One last step. Create an ingest token for this project — the SDK uses it to report routing decisions here.</p>
<form method="post" action="/api/projects/${escAttr(projectId)}/tokens">
  ${button("Create ingest token", { variant: "primary", type: "submit", iconName: "keyRound", block: true })}
</form>
<p class="text-xs dim" style="margin-top:14px">The token will be shown once, right after it's created.</p>`
  }

  return `
<h1>Get your ingest token</h1>
<p class="muted" style="margin:6px 0 20px">This is the last step. Configure this token in your SDK and every routing decision is auto-reported here.</p>

<div class="token-reveal" style="margin-bottom:6px">
  ${icon("keyRound", 20, "dim")}
  <code class="mono">${esc(token)}</code>
  ${copyButton(token, "Copy token")}
</div>
<div class="warn-strip">${icon("alertTriangle", 16)}<span>Copy this token now — for security it is shown only once and cannot be retrieved later. You can always create a new one under Settings › API Keys.</span></div>

<h3 style="margin:24px 0 10px">Wire it into your SDK</h3>
${ingestSnippet(token)}
${data.ingestUrl ? `<p class="text-xs dim mono" style="margin-top:10px">Ingest endpoint: POST ${esc(data.ingestUrl)}</p>` : ""}

<p class="text-sm muted" style="margin-top:18px">Configure this ingest token → the SDK auto-reports routing decisions → they appear under <strong>Requests</strong> for this project. That's the whole loop.</p>

<div style="display:flex;gap:10px;margin-top:18px;flex-wrap:wrap">
  ${button("Go to Requests", { variant: "primary", href: "/requests", iconName: "arrowRight" })}
  ${button("View deploy guide", { variant: "outline", href: "/docs/deploy", iconName: "bookOpen" })}
</div>`
}

export function renderOnboardingHtml(data: OnboardingViewData): string {
  const step = resolveStep(data)
  const inner = step === 1 ? step1() : step === 2 ? step2(data) : step3(data)
  const body = `
<main class="wizard fade-up">
  <div class="brand" style="padding:0 0 20px;font-size:15px">
    <span class="logo">${icon("activity", 18)}</span><span>Adaptive Router</span>
  </div>
  ${stepper(step)}
  <div class="card">${inner}</div>
</main>`
  return renderDocument(body, { title: "Get started", bodyClass: "onboarding-body" })
}
