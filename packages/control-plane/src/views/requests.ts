// ===========================================================================
// Requests / Routing Decisions page BODY fragment (UIUX §6.4, Spec §6).
// Returns a FRAGMENT (wrapped by renderAppShellHtml). Project-scoped.
//
// Data comes from the reused dashboard /api/* (CLIENT-fetched), so the body is
// a mount point + toolbar + an inline script that fetches /api/requests via the
// envelope-aware cpApi and renders the monospace table with the explainable
// decision drawer. `emptyState` (Spec §6 three-layer family) selects which of
// no-project / no-data(snippet) / has-data(live table) is shown. Loading &
// Error states are handled client-side inside the mount.
// ===========================================================================

import { stateBlock, ingestSnippet, button } from "./layout.js"
import type { RequestsPageData } from "./contract.js"

function pageHead(): string {
  return `<div class="page-head"><div><h1>Requests</h1><p>Every routing decision in this project — how each request was routed across quality, latency, and token cost.</p></div></div>`
}

function noProjectState(): string {
  return stateBlock({
    kind: "empty",
    glyph: "folderGit2",
    title: "No project selected",
    description: "Create or pick a project to view its routing decisions.",
    actions: button("Create a project", { variant: "primary", href: "/onboarding", iconName: "plus" }),
  })
}

function noDataState(ingestUrl: string): string {
  return stateBlock({
    kind: "empty",
    glyph: "inbox",
    title: "No routing decisions yet",
    description:
      "Once your SDK reports a decision with this project's ingest token, it appears here. Wire up the token to close the loop.",
    extra:
      `<div style="max-width:520px;width:100%;margin-top:6px">${ingestSnippet()}</div>` +
      `<p class="text-xs dim mono" style="margin-top:10px">POST ${escText(ingestUrl)}</p>`,
    actions:
      button("View deploy guide", { variant: "outline", href: "/docs/deploy", iconName: "bookOpen" }) +
      button("Refresh", { variant: "ghost", iconName: "refreshCw", attrs: 'onclick="location.reload()"' }),
  })
}

function escText(s: string): string {
  return String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
}

/** Toolbar + live-table mount + drawer, hydrated by the client script. */
function liveMount(): string {
  return `
<div id="req-metrics" class="metrics" aria-live="polite"></div>
<form class="toolbar" id="req-toolbar" onsubmit="return false">
  <div class="grow input-search">
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/></svg>
    <input class="input" type="search" id="req-search" placeholder="Search request id or model" aria-label="Search requests" />
  </div>
  <select class="select" id="req-status" aria-label="Filter by status" style="max-width:180px">
    <option value="">All statuses</option>
    <option value="success">success</option>
    <option value="fallback_success">fallback</option>
    <option value="failed">failed</option>
  </select>
</form>
<div id="req-table" role="region" aria-label="Routing decisions"></div>

<div class="drawer-backdrop" id="req-drawer-backdrop" tabindex="-1"></div>
<aside class="drawer" id="req-drawer" role="dialog" aria-modal="true" aria-labelledby="req-drawer-title" aria-hidden="true">
  <header>
    <h2 id="req-drawer-title" class="mono text-sm">Decision detail</h2>
    <button class="btn btn-ghost btn-sm" type="button" id="req-drawer-close" aria-label="Close">Close</button>
  </header>
  <div class="body" id="req-drawer-body"></div>
</aside>

<script>${REQUESTS_CLIENT}</script>`
}

const REQUESTS_CLIENT = `
(function(){
  var $=function(id){return document.getElementById(id);};
  function esc(s){return String(s==null?'':s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');}
  function fmtCost(v){return v==null?'n/a':'$'+Number(v).toFixed(6);}
  function badge(status){
    var map={success:['success','success'],hit:['success','hit'],fallback_success:['warning','fallback'],fallback:['warning','fallback'],failed:['error','failed'],error:['error','error'],timeout:['error','timeout']};
    var m=map[status]||['neutral',status||'unknown'];
    return '<span class="badge badge-'+m[0]+'"><span class="dot"></span>'+esc(m[1])+'</span>';
  }
  function initials(s){s=(s||'?').trim();var p=s.split(/[\\s@._-]+/).filter(Boolean).slice(0,2).map(function(x){return (x[0]||'').toUpperCase();}).join('');return p||'?';}
  function skeleton(){var r='';for(var i=0;i<5;i++){r+='<div class="skeleton-row"><span class="skeleton"></span><span class="skeleton"></span><span class="skeleton"></span><span class="skeleton"></span></div>';}return '<div class="table-wrap" aria-busy="true">'+r+'</div>';}
  function renderTable(rows){
    if(!rows.length){$('req-table').innerHTML='<div class="state"><h3>No requests match this filter</h3><p>Adjust the search or status filter.</p></div>';return;}
    var body=rows.map(function(r){
      var by=(r.byName||r.byEmail)?'<span class="by"><span class="avatar" style="width:22px;height:22px;font-size:10px" aria-hidden="true">'+esc(initials(r.byName||r.byEmail))+'</span><span class="text-sm">'+esc(r.byName||r.byEmail)+'</span></span>':'<span class="dim text-sm">—</span>';
      var id=esc(r.requestId);
      return '<tr data-row tabindex="0" data-request-id="'+id+'" aria-label="Open decision detail for '+id+'">'+
        '<td class="mono text-sm dim">'+esc(r.timestamp)+'</td>'+
        '<td class="mono text-sm">'+id+'</td>'+
        '<td class="mono text-sm">'+esc(r.selectedModel||'n/a')+'</td>'+
        '<td>'+badge(r.status)+'</td>'+
        '<td class="mono text-sm">'+(r.latencyMs==null?'n/a':esc(r.latencyMs)+'ms')+'</td>'+
        '<td class="mono text-sm">'+esc(fmtCost(r.estimatedCostUsd))+'</td>'+
        '<td>'+by+'</td></tr>';
    }).join('');
    $('req-table').innerHTML='<div class="table-wrap"><table class="data"><thead><tr><th>time</th><th>request id</th><th>model</th><th>decision</th><th>latency</th><th>cost</th><th>by</th></tr></thead><tbody>'+body+'</tbody></table></div>';
    wireRows();
  }
  function renderMetrics(items){$('req-metrics').innerHTML=(items||[]).map(function(m){return '<div class="metric"><div class="lbl">'+esc(m.label)+'</div><div class="val mono">'+esc(m.value)+'</div></div>';}).join('');}
  var lastFocus=null;
  function openDrawer(){$('req-drawer').classList.add('open');$('req-drawer-backdrop').classList.add('open');$('req-drawer').setAttribute('aria-hidden','false');}
  function closeDrawer(){$('req-drawer').classList.remove('open');$('req-drawer-backdrop').classList.remove('open');$('req-drawer').setAttribute('aria-hidden','true');if(lastFocus)lastFocus.focus();}
  function pre(o){return '<pre class="mono text-xs" style="white-space:pre-wrap;background:var(--bg-primary);border:1px solid var(--border-default);border-radius:8px;padding:12px;overflow:auto">'+esc(JSON.stringify(o,null,2))+'</pre>';}
  async function loadDetail(id){
    $('req-drawer-title').textContent=id;
    $('req-drawer-body').innerHTML='<div class="skeleton" style="height:120px"></div>';
    try{
      var d=await window.cpApi('/api/requests/'+encodeURIComponent(id));
      var steps='';
      if(d.candidateModels&&d.candidateModels.length){
        steps=d.candidateModels.map(function(c,i){
          var sel=d.request&&d.request.selectedModel;
          var name=(c&&(c.modelId||c.id))||('candidate '+(i+1));
          var win=sel&&(name===sel);
          return '<div class="step-item"><span class="idx'+(win?' win':'')+'">'+(win?'\\u2713':(i+1))+'</span><div><div class="mono text-sm">'+esc(name)+'</div>'+(c&&c.score!=null?'<div class="dim text-xs">score '+esc(c.score)+'</div>':'')+'</div></div>';
        }).join('');
      }else{steps='<p class="dim text-sm">No candidate breakdown recorded for this decision.</p>';}
      $('req-drawer-body').innerHTML=
        '<h4>Why it routed this way</h4><p class="text-sm">'+esc(d.decisionSummary||'—')+'</p>'+
        '<h4>Candidate models</h4>'+steps+
        '<h4>Attempts timeline</h4>'+pre(d.attempts||[])+
        '<h4>Estimated usage</h4>'+pre(d.estimatedUsage||{});
    }catch(err){$('req-drawer-body').innerHTML='<div class="err-text" role="alert">'+esc(err.message||'Failed to load decision')+'</div>';}
  }
  function wireRows(){
    document.querySelectorAll('#req-table [data-request-id]').forEach(function(row){
      function go(){lastFocus=row;openDrawer();loadDetail(row.getAttribute('data-request-id'));}
      row.addEventListener('click',go);
      row.addEventListener('keydown',function(e){if(e.key==='Enter'||e.key===' '){e.preventDefault();go();}});
    });
  }
  async function reload(){
    var params=new URLSearchParams();
    var s=$('req-status').value,q=$('req-search').value.trim();
    if(s)params.set('status',s);if(q)params.set('search',q);
    var qs=params.toString();
    $('req-table').innerHTML=skeleton();
    try{
      var rows=await window.cpApi('/api/requests'+(qs?'?'+qs:''));
      renderTable(rows||[]);
    }catch(err){
      $('req-table').innerHTML='<div class="state is-error" role="alert"><h3>Couldn\\'t load routing decisions</h3><p>'+esc(err.message||'The data source was unreachable.')+'</p><div class="actions"><button class="btn btn-primary" onclick="location.reload()">Retry</button></div></div>';
    }
  }
  var t;
  $('req-search').addEventListener('input',function(){clearTimeout(t);t=setTimeout(reload,220);});
  $('req-status').addEventListener('change',reload);
  $('req-drawer-close').addEventListener('click',closeDrawer);
  $('req-drawer-backdrop').addEventListener('click',closeDrawer);
  document.addEventListener('keydown',function(e){if(e.key==='Escape'&&$('req-drawer').classList.contains('open'))closeDrawer();});
  (async function(){
    try{renderMetrics(await window.cpApi('/api/metrics/summary'));}catch(_){/* metrics optional */}
    reload();
  })();
})();
`

export function renderRequestsPageBody(data: RequestsPageData): string {
  let inner: string
  if (data.emptyState === "no-project") inner = noProjectState()
  else if (data.emptyState === "no-data") inner = noDataState(data.ingestUrl)
  else inner = liveMount()
  return pageHead() + inner
}
