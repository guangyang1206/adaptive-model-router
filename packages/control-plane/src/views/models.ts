// ===========================================================================
// Models page BODY fragment (UIUX §6.5, Spec §6, impl-design ruling 3).
// Returns a FRAGMENT (wrapped by renderAppShellHtml). Project-scoped.
//
// MVP-3 has NO per-project model registry table (listModels() => []), so the
// honest default is an EMPTY state — we do NOT fabricate model rows. When the
// backend later reports `has-data`, we mount a client-fetched comparison table.
// ===========================================================================

import { stateBlock, button } from "./layout.js"
import type { ModelsPageData } from "./contract.js"

function pageHead(): string {
  return `<div class="page-head"><div><h1>Models</h1><p>How the models this project routes to compare on latency, cost, and hit rate.</p></div></div>`
}

function noProjectState(): string {
  return stateBlock({
    kind: "empty",
    glyph: "folderGit2",
    title: "No project selected",
    description: "Create or pick a project to compare the models it routes to.",
    actions: button("Create a project", { variant: "primary", href: "/onboarding", iconName: "plus" }),
  })
}

function noDataState(): string {
  return stateBlock({
    kind: "empty",
    glyph: "boxes",
    title: "Not enough routing data yet",
    description:
      "Model comparison is derived from this project's routing decisions. Send a few requests through the router and the latency, cost, and hit-rate breakdown will appear here.",
    actions:
      button("Go to Requests", { variant: "primary", href: "/requests", iconName: "inbox" }) +
      button("View deploy guide", { variant: "outline", href: "/docs/deploy", iconName: "bookOpen" }),
  })
}

/** Live comparison mount, hydrated from the reused dashboard /api/models. */
function liveMount(): string {
  return `
<p class="muted text-sm" style="margin-bottom:14px">Comparison is based on this project's routing decisions.</p>
<div id="models-table" role="region" aria-label="Model comparison"></div>
<script>${MODELS_CLIENT}</script>`
}

const MODELS_CLIENT = `
(function(){
  var el=document.getElementById('models-table');
  function esc(s){return String(s==null?'':s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');}
  function badge(status){var map={ok:['success','ok'],degraded:['warning','degraded'],limited:['warning','limited'],down:['error','down']};var m=map[status]||['neutral',status||'unknown'];return '<span class="badge badge-'+m[0]+'"><span class="dot"></span>'+esc(m[1])+'</span>';}
  function skeleton(){var r='';for(var i=0;i<4;i++){r+='<div class="skeleton-row"><span class="skeleton"></span><span class="skeleton"></span><span class="skeleton"></span><span class="skeleton"></span></div>';}return '<div class="table-wrap" aria-busy="true">'+r+'</div>';}
  el.innerHTML=skeleton();
  (async function(){
    try{
      var rows=await window.cpApi('/api/models');
      if(!rows||!rows.length){el.innerHTML='<div class="state"><h3>Not enough routing data yet</h3><p>Send a few requests through the router to compare models.</p></div>';return;}
      var body=rows.map(function(m){
        return '<tr><td class="mono text-sm">'+esc(m.modelId)+'</td><td class="text-sm">'+esc(m.provider||'—')+'</td><td>'+badge(m.health)+'</td><td class="mono text-sm">'+(m.latencyP50Ms==null?'n/a':esc(m.latencyP50Ms)+'ms')+'</td><td class="mono text-sm">'+esc(m.costProfile||'n/a')+'</td></tr>';
      }).join('');
      el.innerHTML='<div class="table-wrap"><table class="data"><thead><tr><th>model id</th><th>provider</th><th>health</th><th>latency p50</th><th>cost</th></tr></thead><tbody>'+body+'</tbody></table></div>';
    }catch(err){
      el.innerHTML='<div class="state is-error" role="alert"><h3>Couldn\\'t load model data</h3><p>'+esc(err.message||'The data source was unreachable.')+'</p><div class="actions"><button class="btn btn-primary" onclick="location.reload()">Retry</button></div></div>';
    }
  })();
})();
`

export function renderModelsPageBody(data: ModelsPageData): string {
  let inner: string
  if (data.emptyState === "no-project") inner = noProjectState()
  else if (data.emptyState === "no-data") inner = noDataState()
  else inner = liveMount()
  return pageHead() + inner
}
