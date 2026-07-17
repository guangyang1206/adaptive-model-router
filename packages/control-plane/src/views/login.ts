// ===========================================================================
// Login / Auth page (UIUX §6.2, Spec §6). Contract: renderLoginHtml(data).
// Returns a COMPLETE HTML document. Centered card — NOT a marketing hero.
// Real product positioning copy. GitHub (when enabled) + email/password.
// States: Default / Loading (in-button spinner) / Error (inline, --color-error).
// Backed by Better-Auth at data.authBasePath (e.g. "/api/auth").
// ===========================================================================

import { renderDocument, esc, escAttr } from "./layout.js"
import { icon } from "./icons.js"
import type { LoginViewData } from "./contract.js"

export function renderLoginHtml(data: LoginViewData): string {
  const base = data.authBasePath || "/api/auth"
  const errorBlock = data.error
    ? `<div class="err-text" role="alert" style="margin-bottom:16px;padding:10px 12px;background:var(--color-error-subtle);border:1px solid var(--color-error);border-radius:8px">${icon("alertCircle", 16)}<span>${esc(data.error)}</span></div>`
    : ""

  const github = data.githubEnabled
    ? `<a class="btn btn-outline btn-block" href="${escAttr(base)}/sign-in/social?provider=github" data-oauth>${icon("github", 20)}Continue with GitHub</a>`
    : ""

  const divider = data.githubEnabled ? `<div class="divider">or continue with email</div>` : ""

  const registrationLink = data.registrationOpen
    ? `<p class="text-sm muted" style="text-align:center;margin-top:16px">New to this instance? <a href="${escAttr(base)}/sign-up/email">Create the first account</a></p>`
    : `<p class="sso-note">Registration is closed for this instance. Ask an owner for an invite.</p>`

  const body = `
<main class="auth-wrap">
  <div class="auth-card fade-up">
    <div class="brand"><span class="logo">${icon("activity", 18)}</span><span>Adaptive Router</span></div>
    <p class="auth-tagline">Self-hosted LLM routing control plane for your team</p>
    ${errorBlock}
    ${github}
    ${divider}
    <form id="login-form" method="post" action="${escAttr(base)}/sign-in/email" novalidate>
      <div class="field">
        <label for="email">Email</label>
        <input class="input" id="email" name="email" type="email" autocomplete="email" required
               placeholder="you@company.com" />
      </div>
      <div class="field">
        <label for="password">Password</label>
        <input class="input" id="password" name="password" type="password" autocomplete="current-password"
               required minlength="8" placeholder="Your password" />
      </div>
      <button class="btn btn-primary btn-block" type="submit" id="login-submit">
        <span class="btn-label">Sign in</span>
      </button>
    </form>
    ${registrationLink}
    <div class="sso-note">${icon("lock", 16)} SSO / SAML — reserved for a future release</div>
  </div>
</main>
<template id="btn-spinner">${icon("loader", 20, "spin")}</template>
<script>
(function(){
  function setLoading(el,label){
    var sp=document.getElementById('btn-spinner');
    el.classList.add('is-loading');
    el.innerHTML=(sp?sp.innerHTML:'')+'<span class="btn-label">'+label+'</span>';
  }
  var form=document.getElementById('login-form');
  if(form){form.addEventListener('submit',function(){
    var btn=document.getElementById('login-submit');
    if(btn)setLoading(btn,'Signing in\\u2026');
  });}
  document.querySelectorAll('[data-oauth]').forEach(function(a){
    a.addEventListener('click',function(){setLoading(a,'Connecting\\u2026');});
  });
})();
</script>`

  return renderDocument(body, { title: "Sign in", bodyClass: "auth-body" })
}
