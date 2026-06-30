import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http"

export type DashboardOptions = {
  port?: number
  host?: string
  databasePath?: string
  readonly?: boolean
  data?: DashboardDataAccess
}

export type DashboardRoute = {
  path: "/requests" | "/models"
  title: string
  description: string
}

export type DashboardMetric = {
  label: "Total requests" | "Median latency" | "Estimated token cost" | "Fallback rate"
  value: string
  trend?: "up" | "down" | "flat"
}

export type RequestRow = {
  timestamp: string
  requestId: string
  status: "success" | "failed" | "fallback_success"
  selectedModel?: string
  policy?: string
  latencyMs?: number
  estimatedTokens?: number
  estimatedCostUsd?: number
  fallbacks: number
}

export type TraceDrawerSection = "decision-summary" | "candidate-models" | "attempts-timeline" | "estimated-usage"

export type TraceDetail = {
  request: RequestRow
  decisionSummary: string
  candidateModels: unknown[]
  attempts: unknown[]
  estimatedUsage?: {
    inputTokens?: number
    outputTokens?: number
    totalTokens?: number
    costUsd?: number
    estimated: boolean
  }
}

export type ModelRow = {
  modelId: string
  provider: string
  type: "commercial" | "open-source" | "self-hosted"
  capabilities: ("reasoning" | "tool-calling" | "json-mode" | "vision" | "streaming" | "embeddings")[]
  health: "ok" | "degraded" | "limited" | "down" | "unknown"
  latencyP50Ms?: number
  costProfile?: string
  lastChecked?: string
  enabled: boolean
}

export type DashboardTrace = {
  traceId: string
  decisionId: string
  chosenModel?: string
  candidates: unknown[]
  reason: string
  attempts: { status?: string; latencyMs?: number }[]
  usage?: TraceDetail["estimatedUsage"]
  estimatedCostUsd?: number
  estimated: boolean
  latencyMs?: number
  status: RequestRow["status"]
}

export type DashboardModel = {
  id: string
  provider: string
  type: ModelRow["type"]
  capabilities: ModelRow["capabilities"]
  health?: { status?: ModelRow["health"]; latencyP50Ms?: number }
  cost?: { inputPer1M?: number; outputPer1M?: number; estimated?: boolean }
  enabled: boolean
}

export type DashboardDataSource = {
  listTraces(): Promise<DashboardTrace[]> | DashboardTrace[]
  listModels?(): Promise<DashboardModel[]> | DashboardModel[]
}

export type DashboardDataAccess = {
  getSummary(): Promise<DashboardMetric[]>
  listRequests(filter?: RequestFilter): Promise<RequestRow[]>
  getRequest(traceId: string): Promise<TraceDetail | undefined>
  listModels(): Promise<ModelRow[]>
  compareModels(modelIds: string[]): Promise<ModelComparison>
  getRoutingDecision?(decisionId: string): Promise<TraceDetail | undefined>
}

/**
 * Server-side filter for {@link DashboardDataAccess.listRequests}. Filtering
 * lives in the data layer (not just the browser) so the API itself scales and
 * stays the single source of truth — the client query string maps 1:1 to this.
 */
export type RequestFilter = {
  /** Restrict to a single routing status. */
  status?: RequestRow["status"]
  /** Substring match against the selected model id (case-insensitive). */
  model?: string
  /** Substring match against request id OR selected model (case-insensitive). */
  search?: string
  /** Cap the number of rows returned (most recent first ordering is preserved). */
  limit?: number
}

/** One model rendered as a column in a side-by-side comparison. */
export type ModelComparisonColumn = ModelRow & { found: boolean }

/**
 * A side-by-side model comparison: the union of capabilities across the
 * selected models becomes the matrix rows, each column marking support. Built
 * for the dashboard's "compare models" view but returned as plain data so it is
 * trivially testable and reusable.
 */
export type ModelComparison = {
  models: ModelComparisonColumn[]
  /** Every capability any selected model advertises, sorted and de-duplicated. */
  capabilityMatrix: { capability: ModelRow["capabilities"][number]; support: boolean[] }[]
}

export type RunningDashboard = {
  url: string
  routes: DashboardRoute[]
  readonly: boolean
  api: typeof readonlyApiRoutes
  close(): Promise<void>
}

export const dashboardRoutes: DashboardRoute[] = [
  {
    path: "/requests",
    title: "Routing Decisions",
    description: "Inspect how each agent request was routed across quality, latency, and token cost.",
  },
  {
    path: "/models",
    title: "Models",
    description: "Review configured models, provider health, and routing capabilities.",
  },
]

export const traceDrawerSections: TraceDrawerSection[] = [
  "decision-summary",
  "candidate-models",
  "attempts-timeline",
  "estimated-usage",
]

export const designTokens = {
  colors: {
    primaryBlue600: "#2563EB",
    primaryBlue500: "#3B82F6",
    bg950: "#0D1117",
    surface900: "#161B22",
    surface800: "#21262D",
    border700: "#30363D",
    text50: "#F0F6FC",
    text400: "#8B949E",
    text600: "#484F58",
    success500: "#3FB950",
    warning500: "#D29922",
    error500: "#F85149",
  },
  business: {
    modelOpenSource: "model-open-source",
    modelCommercial: "model-commercial",
    providerSelfHosted: "provider-self-hosted",
    healthOk: "health-ok",
    healthDegraded: "health-degraded",
    healthLimited: "health-limited",
    healthDown: "health-down",
    costEstimated: "cost-estimated",
  },
} as const

export const readonlyApiRoutes = [
  "GET /api/metrics/summary",
  "GET /api/requests",
  "GET /api/requests/:id",
  "GET /api/models",
  "GET /api/models/:id/health",
  "GET /api/models/compare",
  "GET /api/routing-decisions/:id",
] as const

export function createReadOnlyDataAccess(source: DashboardDataSource): DashboardDataAccess {
  async function getTraces() {
    return await source.listTraces()
  }

  async function listModelRows(): Promise<ModelRow[]> {
    const models = (await source.listModels?.()) ?? []
    return models.map((model) => ({
      modelId: model.id,
      provider: model.provider,
      type: model.type,
      capabilities: model.capabilities,
      health: model.health?.status ?? "unknown",
      latencyP50Ms: model.health?.latencyP50Ms,
      costProfile: formatCostProfile(model.cost),
      enabled: model.enabled,
    }))
  }

  return {
    async getSummary(): Promise<DashboardMetric[]> {
      const traces = await getTraces()
      const total = traces.length
      const fallbackCount = traces.filter((trace) => trace.status === "fallback_success" || trace.attempts.some((attempt) => attempt.status === "failed")).length
      const costs = traces.reduce((sum, trace) => sum + (trace.estimatedCostUsd ?? trace.usage?.costUsd ?? 0), 0)
      const latencies = traces.map((trace) => trace.latencyMs).filter((value): value is number => value !== undefined).sort((a, b) => a - b)
      const median = latencies.length ? latencies[Math.floor(latencies.length / 2)] : undefined
      return [
        { label: "Total requests", value: String(total) },
        { label: "Median latency", value: median === undefined ? "n/a" : `${median}ms` },
        { label: "Estimated token cost", value: `$${costs.toFixed(6)}` },
        { label: "Fallback rate", value: total === 0 ? "0%" : `${Math.round((fallbackCount / total) * 100)}%` },
      ]
    },
    async listRequests(filter?: RequestFilter): Promise<RequestRow[]> {
      const rows = (await getTraces()).map(traceToRequestRow)
      return applyRequestFilter(rows, filter)
    },
    async getRequest(traceId: string): Promise<TraceDetail | undefined> {
      const trace = (await getTraces()).find((entry) => entry.traceId === traceId)
      if (!trace) return undefined
      return traceToDetail(trace)
    },
    async listModels(): Promise<ModelRow[]> {
      return listModelRows()
    },
    async compareModels(modelIds: string[]): Promise<ModelComparison> {
      return buildModelComparison(await listModelRows(), modelIds)
    },
    async getRoutingDecision(decisionId: string): Promise<TraceDetail | undefined> {
      const trace = (await getTraces()).find((entry) => entry.decisionId === decisionId)
      if (!trace) return undefined
      return traceToDetail(trace)
    },
  }
}

export async function createDashboard(options: DashboardOptions = {}): Promise<RunningDashboard> {
  const port = options.port ?? 4318
  const host = options.host ?? "127.0.0.1"
  const data = options.data ?? createReadOnlyDataAccess({ listTraces: () => [], listModels: () => [] })
  const server = createServer((request, response) => handleRequest(request, response, data))
  await listen(server, port, host)
  return {
    url: `http://${host}:${port}`,
    routes: dashboardRoutes,
    readonly: options.readonly ?? true,
    api: readonlyApiRoutes,
    close: () => close(server),
  }
}

async function handleRequest(request: IncomingMessage, response: ServerResponse, data: DashboardDataAccess): Promise<void> {
  const url = new URL(request.url ?? "/", "http://localhost")

  try {
    if (url.pathname === "/favicon.ico") {
      response.statusCode = 204
      response.end()
      return
    }
    if (url.pathname === "/api/metrics/summary") return sendJson(response, await data.getSummary())
    if (url.pathname === "/api/requests") return sendJson(response, await data.listRequests(parseRequestFilter(url)))
    if (url.pathname.startsWith("/api/requests/")) {
      const detail = await data.getRequest(decodeURIComponent(url.pathname.replace("/api/requests/", "")))
      return detail ? sendJson(response, detail) : sendJson(response, { error: "not found" }, 404)
    }
    if (url.pathname === "/api/models/compare") {
      const ids = (url.searchParams.get("ids") ?? "")
        .split(",")
        .map((id) => id.trim())
        .filter(Boolean)
      return sendJson(response, await data.compareModels(ids))
    }
    if (url.pathname === "/api/models") return sendJson(response, await data.listModels())
    if (url.pathname.startsWith("/api/models/") && url.pathname.endsWith("/health")) {
      const modelId = decodeURIComponent(url.pathname.replace("/api/models/", "").replace("/health", ""))
      const model = (await data.listModels()).find((entry) => entry.modelId === modelId)
      return model ? sendJson(response, { modelId, health: model.health, latencyP50Ms: model.latencyP50Ms }) : sendJson(response, { error: "not found" }, 404)
    }
    if (url.pathname.startsWith("/api/routing-decisions/")) {
      const detail = await data.getRoutingDecision?.(decodeURIComponent(url.pathname.replace("/api/routing-decisions/", "")))
      return detail ? sendJson(response, detail) : sendJson(response, { error: "not found" }, 404)
    }
    if (url.pathname === "/" || url.pathname === "/requests" || url.pathname === "/models") {
      return sendHtml(response, renderDashboardHtml(url.pathname === "/models" ? "models" : "requests"))
    }
    return sendJson(response, { error: "not found" }, 404)
  } catch (error) {
    return sendJson(response, { error: error instanceof Error ? error.message : "unknown error" }, 500)
  }
}

/**
 * Translate the `/api/requests` query string into a {@link RequestFilter}.
 * `status` is validated against the known set; anything else is ignored so a
 * stray value can never 500 the endpoint.
 */
function parseRequestFilter(url: URL): RequestFilter {
  const filter: RequestFilter = {}
  const status = url.searchParams.get("status")
  if (status === "success" || status === "failed" || status === "fallback_success") filter.status = status
  const model = url.searchParams.get("model")
  if (model) filter.model = model
  const search = url.searchParams.get("search") ?? url.searchParams.get("q")
  if (search) filter.search = search
  const limit = Number(url.searchParams.get("limit"))
  if (Number.isFinite(limit) && limit > 0) filter.limit = limit
  return filter
}

function renderDashboardHtml(initialPage: "requests" | "models"): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>Adaptive Model Router Dashboard</title>
<style>
:root{color-scheme:dark;--bg:#0D1117;--surface:#161B22;--surface2:#21262D;--border:#30363D;--text:#F0F6FC;--muted:#8B949E;--blue:#3B82F6;--ok:#3FB950;--warn:#D29922;--err:#F85149}*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--text);font:14px/1.5 Inter,"Noto Sans SC",system-ui,sans-serif}.app{display:grid;grid-template-columns:220px 1fr;min-height:100dvh}.side{border-right:1px solid var(--border);background:#0f141b;padding:20px}.brand{font-weight:700;margin-bottom:24px}.nav{display:grid;gap:8px}.nav button{background:transparent;border:1px solid transparent;color:var(--muted);padding:10px 12px;border-radius:8px;text-align:left;cursor:pointer}.nav button.active,.nav button:hover{background:var(--surface);border-color:var(--border);color:var(--text)}main{padding:28px;min-width:0}.header{display:flex;justify-content:space-between;gap:16px;align-items:flex-start;margin-bottom:20px}.header h1{font-size:24px;margin:0}.header p{margin:4px 0 0;color:var(--muted)}.cards{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:12px;margin:20px 0}.card{background:var(--surface);border:1px solid var(--border);border-radius:12px;padding:14px}.card span{color:var(--muted);font-size:12px}.card strong{display:block;font-size:20px;margin-top:6px}.toolbar{display:flex;gap:8px;margin:16px 0}.toolbar input,.toolbar select{background:var(--surface);border:1px solid var(--border);color:var(--text);border-radius:8px;padding:8px 10px}.toolbar button{background:var(--blue);border:1px solid var(--blue);color:#fff;border-radius:8px;padding:8px 12px;cursor:pointer;font-weight:600}.toolbar button.ghost{background:transparent;border-color:var(--border);color:var(--muted);font-weight:400}.toolbar button:hover{filter:brightness(1.08)}#compare{margin:0 0 18px}.cmp-table td:first-child,.cmp-table th:first-child{color:var(--muted)}input[type=checkbox]{accent-color:var(--blue);cursor:pointer}table{width:100%;border-collapse:collapse;background:var(--surface);border:1px solid var(--border);border-radius:12px;overflow:hidden}th,td{text-align:left;padding:11px 12px;border-bottom:1px solid var(--border);vertical-align:top}th{color:var(--muted);font-size:12px;font-weight:600}tr:hover td{background:var(--surface2)}.mono{font-family:"JetBrains Mono",ui-monospace,monospace}.badge{display:inline-flex;border:1px solid var(--border);border-radius:999px;padding:2px 8px;font-size:12px;color:var(--muted)}.ok{color:var(--ok)}.failed,.down{color:var(--err)}.fallback_success,.degraded,.limited{color:var(--warn)}.hidden{display:none}.drawer{position:fixed;inset:0 0 0 auto;width:min(720px,46vw);background:#0f141b;border-left:1px solid var(--border);padding:22px;overflow:auto;box-shadow:-20px 0 60px rgba(0,0,0,.35)}.drawer pre{background:var(--bg);border:1px solid var(--border);border-radius:10px;padding:12px;overflow:auto}.close{float:right;background:var(--surface);border:1px solid var(--border);color:var(--text);border-radius:8px;padding:8px 10px;cursor:pointer}.empty{padding:28px;color:var(--muted);background:var(--surface);border:1px dashed var(--border);border-radius:12px}@media(max-width:900px){.app{grid-template-columns:1fr}.side{border-right:0;border-bottom:1px solid var(--border)}.cards{grid-template-columns:1fr 1fr}.drawer{width:100vw}}
</style>
</head>
<body>
<div class="app">
  <aside class="side"><div class="brand">Adaptive Router</div><nav class="nav"><button id="nav-requests">Routing Decisions</button><button id="nav-models">Models</button><button onclick="window.open('./docs/en/quickstart.md','_blank')">Docs</button></nav></aside>
  <main>
    <section id="page-requests"><div class="header"><div><h1>Routing Decisions</h1><p>Inspect how each agent request was routed across quality, latency, and token cost.</p></div><button class="close" onclick="location.reload()">Refresh</button></div><div id="metrics" class="cards"></div><div class="toolbar"><input id="search" placeholder="Search request id/model" /><select id="status"><option value="">All status</option><option>success</option><option>fallback_success</option><option>failed</option></select></div><div id="requests"></div></section>
    <section id="page-models" class="hidden"><div class="header"><div><h1>Models</h1><p>Review configured models, provider health, and routing capabilities. Tick rows to compare them side by side.</p></div></div><div class="toolbar"><input id="model-search" placeholder="Filter by model id / provider" /><button id="compare-btn">Compare selected</button><button id="compare-clear" class="ghost">Clear</button></div><div id="compare"></div><div id="models"></div></section>
  </main>
</div>
<div id="drawer" class="drawer hidden"></div>
<script>
const state={page:${JSON.stringify(initialPage)},requests:[],models:[],compare:[]};
const $=id=>document.getElementById(id);
async function api(path){const res=await fetch(path); if(!res.ok) throw new Error(await res.text()); const payload=await res.json(); return payload.data;}
function setPage(page){state.page=page; $('page-requests').classList.toggle('hidden',page!=='requests'); $('page-models').classList.toggle('hidden',page!=='models'); $('nav-requests').classList.toggle('active',page==='requests'); $('nav-models').classList.toggle('active',page==='models'); history.replaceState(null,'',page==='models'?'/models':'/requests');}
function fmtCost(v){return v==null?'n/a':'$'+Number(v).toFixed(6)}
function badge(v){return '<span class="badge '+String(v)+'">'+String(v)+'</span>'}
function renderMetrics(items){$('metrics').innerHTML=items.map(m=>'<div class="card"><span>'+m.label+'</span><strong>'+m.value+'</strong></div>').join('')}
function renderRequests(){const q=$('search').value.toLowerCase(); const s=$('status').value; const rows=state.requests.filter(r=>(!s||r.status===s)&&(!q||String(r.requestId).toLowerCase().includes(q)||String(r.selectedModel||'').toLowerCase().includes(q))); $('requests').innerHTML=rows.length?'<table><thead><tr><th>timestamp</th><th>request id</th><th>status</th><th>selected model</th><th>latency</th><th>tokens</th><th>cost</th><th>fallbacks</th></tr></thead><tbody>'+rows.map(r=>'<tr tabindex="0" data-request-id="'+r.requestId+'"><td class="mono">'+r.timestamp+'</td><td class="mono">'+r.requestId+'</td><td>'+badge(r.status)+'</td><td class="mono">'+(r.selectedModel||'n/a')+'</td><td>'+(r.latencyMs??'n/a')+'ms</td><td>'+(r.estimatedTokens??'n/a')+'</td><td>'+fmtCost(r.estimatedCostUsd)+'</td><td>'+r.fallbacks+'</td></tr>').join('')+'</tbody></table>':'<div class="empty">No routed requests match this filter. Adjust the search or status, or run your agent to populate this view.</div>'; document.querySelectorAll('[data-request-id]').forEach(row=>row.addEventListener('click',()=>openTrace(row.getAttribute('data-request-id'))))}
async function reloadRequests(){const params=new URLSearchParams(); const s=$('status').value; const q=$('search').value.trim(); if(s)params.set('status',s); if(q)params.set('search',q); const qs=params.toString(); state.requests=await api('/api/requests'+(qs?'?'+qs:'')); renderRequests();}
function visibleModels(){const q=($('model-search').value||'').toLowerCase(); return state.models.filter(m=>!q||m.modelId.toLowerCase().includes(q)||m.provider.toLowerCase().includes(q));}
function renderModels(){const rows=visibleModels(); $('models').innerHTML=rows.length?'<table><thead><tr><th></th><th>model id</th><th>provider</th><th>type</th><th>capabilities</th><th>health</th><th>latency p50</th><th>cost profile</th><th>enabled</th></tr></thead><tbody>'+rows.map(m=>'<tr><td><input type="checkbox" class="cmp" value="'+m.modelId+'"'+(state.compare.includes(m.modelId)?' checked':'')+' /></td><td class="mono">'+m.modelId+'</td><td>'+m.provider+'</td><td>'+badge(m.type)+'</td><td>'+m.capabilities.map(badge).join(' ')+'</td><td>'+badge(m.health)+'</td><td>'+(m.latencyP50Ms??'n/a')+'</td><td>'+ (m.costProfile||'n/a') +'</td><td>'+m.enabled+'</td></tr>').join('')+'</tbody></table>':'<div class="empty">No models match this filter.</div>'; document.querySelectorAll('.cmp').forEach(cb=>cb.addEventListener('change',()=>{const id=cb.value; if(cb.checked){if(!state.compare.includes(id))state.compare.push(id);}else{state.compare=state.compare.filter(x=>x!==id);}}))}
async function runCompare(){if(state.compare.length<1){$('compare').innerHTML='<div class="empty">Tick at least one model row to compare.</div>';return;} const c=await api('/api/models/compare?ids='+encodeURIComponent(state.compare.join(','))); const head='<tr><th>field</th>'+c.models.map(m=>'<th class="mono">'+m.modelId+(m.found?'':' (not configured)')+'</th>').join('')+'</tr>'; const rowOf=(label,fn)=>'<tr><td>'+label+'</td>'+c.models.map(m=>'<td>'+fn(m)+'</td>').join('')+'</tr>'; const matrix=c.capabilityMatrix.map(r=>'<tr><td>'+r.capability+'</td>'+r.support.map(s=>'<td>'+(s?'✓':'·')+'</td>').join('')+'</tr>').join(''); $('compare').innerHTML='<table class="cmp-table"><thead>'+head+'</thead><tbody>'+rowOf('provider',m=>m.provider)+rowOf('type',m=>badge(m.type))+rowOf('health',m=>badge(m.health))+rowOf('latency p50',m=>(m.latencyP50Ms??'n/a'))+rowOf('cost profile',m=>(m.costProfile||'n/a'))+rowOf('enabled',m=>m.enabled)+'<tr><td colspan="'+(c.models.length+1)+'"><strong>Capabilities</strong></td></tr>'+matrix+'</tbody></table>';}
async function openTrace(id){const d=await api('/api/requests/'+encodeURIComponent(id)); const el=$('drawer'); el.classList.remove('hidden'); el.innerHTML='<button class="close" id="drawer-close">Close</button><h2 class="mono">'+id+'</h2><h3>Decision summary</h3><p>'+d.decisionSummary+'</p><h3>Candidate models</h3><pre>'+JSON.stringify(d.candidateModels,null,2)+'</pre><h3>Attempts timeline</h3><pre>'+JSON.stringify(d.attempts,null,2)+'</pre><h3>Estimated usage</h3><pre>'+JSON.stringify(d.estimatedUsage||{},null,2)+'</pre>'; $('drawer-close').onclick=()=>el.classList.add('hidden')}
async function load(){setPage(state.page); renderMetrics(await api('/api/metrics/summary')); state.requests=await api('/api/requests'); state.models=await api('/api/models'); renderRequests(); renderModels();}
$('nav-requests').onclick=()=>setPage('requests'); $('nav-models').onclick=()=>setPage('models'); $('search').oninput=reloadRequests; $('status').onchange=reloadRequests; $('model-search').oninput=renderModels; $('compare-btn').onclick=runCompare; $('compare-clear').onclick=()=>{state.compare=[]; $('compare').innerHTML=''; renderModels();}; load().catch(e=>{document.querySelector('main').innerHTML='<div class="empty">'+e.message+'</div>'});
</script>
</body>
</html>`
}

function sendHtml(response: ServerResponse, html: string): void {
  response.statusCode = 200
  response.setHeader("content-type", "text/html; charset=utf8")
  response.end(html)
}

function sendJson(response: ServerResponse, data: unknown, statusCode = 200): void {
  response.statusCode = statusCode
  response.setHeader("content-type", "application/json; charset=utf8")
  response.end(JSON.stringify({ code: statusCode >= 400 ? "ERROR" : "OK", data, message: statusCode >= 400 ? "Request failed" : "" }))
}

function listen(server: Server & { listen(port: number, host: string, callback?: () => void): void }, port: number, host: string): Promise<void> {
  return new Promise((resolve) => server.listen(port, host, resolve))
}

function close(server: Server): Promise<void> {
  return new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()))
}

function traceToRequestRow(trace: DashboardTrace): RequestRow {
  return {
    timestamp: trace.traceId,
    requestId: trace.traceId,
    status: trace.status,
    selectedModel: trace.chosenModel,
    policy: trace.reason,
    latencyMs: trace.latencyMs,
    estimatedTokens: trace.usage?.totalTokens,
    estimatedCostUsd: trace.estimatedCostUsd ?? trace.usage?.costUsd,
    fallbacks: trace.attempts.filter((attempt) => attempt.status === "failed").length,
  }
}

function traceToDetail(trace: DashboardTrace): TraceDetail {
  return {
    request: traceToRequestRow(trace),
    decisionSummary: trace.reason,
    candidateModels: trace.candidates,
    attempts: trace.attempts,
    estimatedUsage: trace.usage,
  }
}

function formatCostProfile(cost: DashboardModel["cost"]): string | undefined {
  if (!cost) return undefined
  const input = cost.inputPer1M ?? 0
  const output = cost.outputPer1M ?? input
  return `$${input}/$${output} per 1M tokens${cost.estimated ? " estimated" : ""}`
}

/**
 * Apply a {@link RequestFilter} to already-mapped request rows. Kept as a pure
 * function so both the data-access layer and tests exercise identical logic.
 */
export function applyRequestFilter(rows: RequestRow[], filter?: RequestFilter): RequestRow[] {
  if (!filter) return rows
  const search = filter.search?.toLowerCase()
  const model = filter.model?.toLowerCase()
  const filtered = rows.filter((row) => {
    if (filter.status && row.status !== filter.status) return false
    if (model && !(row.selectedModel ?? "").toLowerCase().includes(model)) return false
    if (search) {
      const haystack = `${row.requestId} ${row.selectedModel ?? ""}`.toLowerCase()
      if (!haystack.includes(search)) return false
    }
    return true
  })
  return filter.limit !== undefined && filter.limit >= 0 ? filtered.slice(0, filter.limit) : filtered
}

/**
 * Build a side-by-side {@link ModelComparison} from the full model list and a
 * set of requested ids. Unknown ids still get a column (`found: false`) so the
 * UI can show "not configured" rather than silently dropping a selection. The
 * capability matrix is the sorted union of every selected model's capabilities.
 */
export function buildModelComparison(allModels: ModelRow[], modelIds: string[]): ModelComparison {
  const columns: ModelComparisonColumn[] = modelIds.map((id) => {
    const match = allModels.find((model) => model.modelId === id)
    if (match) return { ...match, found: true }
    return {
      modelId: id,
      provider: "—",
      type: "open-source",
      capabilities: [],
      health: "unknown",
      enabled: false,
      found: false,
    }
  })

  const capabilities = [...new Set(columns.flatMap((column) => column.capabilities))].sort()
  const capabilityMatrix = capabilities.map((capability) => ({
    capability,
    support: columns.map((column) => column.capabilities.includes(capability)),
  }))

  return { models: columns, capabilityMatrix }
}
