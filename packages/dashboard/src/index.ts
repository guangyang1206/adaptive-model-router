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
  listRequests(): Promise<RequestRow[]>
  getRequest(traceId: string): Promise<TraceDetail | undefined>
  listModels(): Promise<ModelRow[]>
  getRoutingDecision?(decisionId: string): Promise<TraceDetail | undefined>
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
  "GET /api/routing-decisions/:id",
] as const

export function createReadOnlyDataAccess(source: DashboardDataSource): DashboardDataAccess {
  async function getTraces() {
    return await source.listTraces()
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
    async listRequests(): Promise<RequestRow[]> {
      return (await getTraces()).map(traceToRequestRow)
    },
    async getRequest(traceId: string): Promise<TraceDetail | undefined> {
      const trace = (await getTraces()).find((entry) => entry.traceId === traceId)
      if (!trace) return undefined
      return traceToDetail(trace)
    },
    async listModels(): Promise<ModelRow[]> {
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
    if (url.pathname === "/api/metrics/summary") return sendJson(response, await data.getSummary())
    if (url.pathname === "/api/requests") return sendJson(response, await data.listRequests())
    if (url.pathname.startsWith("/api/requests/")) {
      const detail = await data.getRequest(decodeURIComponent(url.pathname.replace("/api/requests/", "")))
      return detail ? sendJson(response, detail) : sendJson(response, { error: "not found" }, 404)
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

function renderDashboardHtml(initialPage: "requests" | "models"): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>Adaptive Model Router Dashboard</title>
<style>
:root{color-scheme:dark;--bg:#0D1117;--surface:#161B22;--surface2:#21262D;--border:#30363D;--text:#F0F6FC;--muted:#8B949E;--blue:#3B82F6;--ok:#3FB950;--warn:#D29922;--err:#F85149}*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--text);font:14px/1.5 Inter,"Noto Sans SC",system-ui,sans-serif}.app{display:grid;grid-template-columns:220px 1fr;min-height:100dvh}.side{border-right:1px solid var(--border);background:#0f141b;padding:20px}.brand{font-weight:700;margin-bottom:24px}.nav{display:grid;gap:8px}.nav button{background:transparent;border:1px solid transparent;color:var(--muted);padding:10px 12px;border-radius:8px;text-align:left;cursor:pointer}.nav button.active,.nav button:hover{background:var(--surface);border-color:var(--border);color:var(--text)}main{padding:28px;min-width:0}.header{display:flex;justify-content:space-between;gap:16px;align-items:flex-start;margin-bottom:20px}.header h1{font-size:24px;margin:0}.header p{margin:4px 0 0;color:var(--muted)}.cards{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:12px;margin:20px 0}.card{background:var(--surface);border:1px solid var(--border);border-radius:12px;padding:14px}.card span{color:var(--muted);font-size:12px}.card strong{display:block;font-size:20px;margin-top:6px}.toolbar{display:flex;gap:8px;margin:16px 0}.toolbar input,.toolbar select{background:var(--surface);border:1px solid var(--border);color:var(--text);border-radius:8px;padding:8px 10px}table{width:100%;border-collapse:collapse;background:var(--surface);border:1px solid var(--border);border-radius:12px;overflow:hidden}th,td{text-align:left;padding:11px 12px;border-bottom:1px solid var(--border);vertical-align:top}th{color:var(--muted);font-size:12px;font-weight:600}tr:hover td{background:var(--surface2)}.mono{font-family:"JetBrains Mono",ui-monospace,monospace}.badge{display:inline-flex;border:1px solid var(--border);border-radius:999px;padding:2px 8px;font-size:12px;color:var(--muted)}.ok{color:var(--ok)}.failed,.down{color:var(--err)}.fallback_success,.degraded,.limited{color:var(--warn)}.hidden{display:none}.drawer{position:fixed;inset:0 0 0 auto;width:min(720px,46vw);background:#0f141b;border-left:1px solid var(--border);padding:22px;overflow:auto;box-shadow:-20px 0 60px rgba(0,0,0,.35)}.drawer pre{background:var(--bg);border:1px solid var(--border);border-radius:10px;padding:12px;overflow:auto}.close{float:right;background:var(--surface);border:1px solid var(--border);color:var(--text);border-radius:8px;padding:8px 10px;cursor:pointer}.empty{padding:28px;color:var(--muted);background:var(--surface);border:1px dashed var(--border);border-radius:12px}@media(max-width:900px){.app{grid-template-columns:1fr}.side{border-right:0;border-bottom:1px solid var(--border)}.cards{grid-template-columns:1fr 1fr}.drawer{width:100vw}}
</style>
</head>
<body>
<div class="app">
  <aside class="side"><div class="brand">Adaptive Router</div><nav class="nav"><button id="nav-requests">Routing Decisions</button><button id="nav-models">Models</button><button onclick="window.open('./docs/en/quickstart.md','_blank')">Docs</button></nav></aside>
  <main>
    <section id="page-requests"><div class="header"><div><h1>Routing Decisions</h1><p>Inspect how each agent request was routed across quality, latency, and token cost.</p></div><button class="close" onclick="location.reload()">Refresh</button></div><div id="metrics" class="cards"></div><div class="toolbar"><input id="search" placeholder="Search request id/model" /><select id="status"><option value="">All status</option><option>success</option><option>fallback_success</option><option>failed</option></select></div><div id="requests"></div></section>
    <section id="page-models" class="hidden"><div class="header"><div><h1>Models</h1><p>Review configured models, provider health, and routing capabilities.</p></div></div><div id="models"></div></section>
  </main>
</div>
<div id="drawer" class="drawer hidden"></div>
<script>
const state={page:${JSON.stringify(initialPage)},requests:[],models:[]};
const $=id=>document.getElementById(id);
async function api(path){const res=await fetch(path); if(!res.ok) throw new Error(await res.text()); return res.json();}
function setPage(page){state.page=page; $('page-requests').classList.toggle('hidden',page!=='requests'); $('page-models').classList.toggle('hidden',page!=='models'); $('nav-requests').classList.toggle('active',page==='requests'); $('nav-models').classList.toggle('active',page==='models'); history.replaceState(null,'',page==='models'?'/models':'/requests');}
function fmtCost(v){return v==null?'n/a':'$'+Number(v).toFixed(6)}
function badge(v){return '<span class="badge '+String(v)+'">'+String(v)+'</span>'}
function renderMetrics(items){$('metrics').innerHTML=items.map(m=>'<div class="card"><span>'+m.label+'</span><strong>'+m.value+'</strong></div>').join('')}
function renderRequests(){const q=$('search').value.toLowerCase(); const s=$('status').value; const rows=state.requests.filter(r=>(!s||r.status===s)&&(!q||String(r.requestId).toLowerCase().includes(q)||String(r.selectedModel||'').toLowerCase().includes(q))); $('requests').innerHTML=rows.length?'<table><thead><tr><th>timestamp</th><th>request id</th><th>status</th><th>selected model</th><th>latency</th><th>tokens</th><th>cost</th><th>fallbacks</th></tr></thead><tbody>'+rows.map(r=>'<tr tabindex="0" onclick="openTrace(\''+r.requestId+'\')"><td class="mono">'+r.timestamp+'</td><td class="mono">'+r.requestId+'</td><td>'+badge(r.status)+'</td><td class="mono">'+(r.selectedModel||'n/a')+'</td><td>'+(r.latencyMs??'n/a')+'ms</td><td>'+(r.estimatedTokens??'n/a')+'</td><td>'+fmtCost(r.estimatedCostUsd)+'</td><td>'+r.fallbacks+'</td></tr>').join('')+'</tbody></table>':'<div class="empty">No routed requests yet. Run your agent locally and send the first request to populate this view.</div>'}
function renderModels(){$('models').innerHTML=state.models.length?'<table><thead><tr><th>model id</th><th>provider</th><th>type</th><th>capabilities</th><th>health</th><th>latency p50</th><th>cost profile</th><th>enabled</th></tr></thead><tbody>'+state.models.map(m=>'<tr><td class="mono">'+m.modelId+'</td><td>'+m.provider+'</td><td>'+badge(m.type)+'</td><td>'+m.capabilities.map(badge).join(' ')+'</td><td>'+badge(m.health)+'</td><td>'+(m.latencyP50Ms??'n/a')+'</td><td>'+ (m.costProfile||'n/a') +'</td><td>'+m.enabled+'</td></tr>').join('')+'</tbody></table>':'<div class="empty">No models configured. Add models in your router config, then restart the local dashboard.</div>'}
async function openTrace(id){const d=await api('/api/requests/'+encodeURIComponent(id)); const el=$('drawer'); el.classList.remove('hidden'); el.innerHTML='<button class="close" onclick="document.getElementById(\'drawer\').classList.add(\'hidden\')">Close</button><h2 class="mono">'+id+'</h2><h3>Decision summary</h3><p>'+d.decisionSummary+'</p><h3>Candidate models</h3><pre>'+JSON.stringify(d.candidateModels,null,2)+'</pre><h3>Attempts timeline</h3><pre>'+JSON.stringify(d.attempts,null,2)+'</pre><h3>Estimated usage</h3><pre>'+JSON.stringify(d.estimatedUsage||{},null,2)+'</pre>'}
async function load(){setPage(state.page); renderMetrics(await api('/api/metrics/summary')); state.requests=await api('/api/requests'); state.models=await api('/api/models'); renderRequests(); renderModels();}
$('nav-requests').onclick=()=>setPage('requests'); $('nav-models').onclick=()=>setPage('models'); $('search').oninput=renderRequests; $('status').onchange=renderRequests; load().catch(e=>{document.querySelector('main').innerHTML='<div class="empty">'+e.message+'</div>'});
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
