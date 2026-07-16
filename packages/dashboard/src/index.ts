import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http"
import {
  getEvalsOverview,
  getEvalRun,
  getCacheStats,
  getLearningState,
  type Mvp2StoreExtension,
  type EvalsOverviewData,
  type EvalRunDetailData,
  type CacheOverviewData,
  type LearningOverviewData,
} from "@adaptive-router/sdk"

export type {
  EvalsOverviewData,
  EvalRunDetailData,
  CacheOverviewData,
  LearningOverviewData,
} from "@adaptive-router/sdk"

export type DashboardOptions = {
  port?: number
  host?: string
  databasePath?: string
  readonly?: boolean
  data?: DashboardDataAccess
}

export type DashboardRoute = {
  path: "/requests" | "/models" | "/evals" | "/cache" | "/learning"
  title: string
  description: string
}

/** The five renderable pages. Drives `renderDashboardHtml`, `setPage`, and `pageMap`. */
export type Page = "requests" | "models" | "evals" | "cache" | "learning"

// ---------------------------------------------------------------------------
// MVP-2 read-only API response contracts (detailed-design §9).
// The four response `data` shapes (EvalsOverviewData / EvalRunDetailData /
// CacheOverviewData / LearningOverviewData) are now imported verbatim from
// @adaptive-router/sdk (see dashboard-readers.ts) and re-exported above, so the
// dashboard and the real SDK readers share one source of truth. Only the
// presentational fold order below stays local.
// ---------------------------------------------------------------------------

/**
 * Fixed 12-dimension flatten order (detailed-design §9.4). `baselineWeights` /
 * `proposedWeights` array indices align 1:1 with `weightDiff[i].dimension`.
 * The frontend MUST NOT re-order these. Mirrors the SDK's `WEIGHT_ORDER`.
 */
export const WEIGHT_DIMENSION_ORDER = [
  "tierMatch",
  "tierMismatch",
  "successRate",
  "latency.low",
  "latency.medium",
  "latency.high",
  "costCoefficient",
  "health.ok",
  "health.degraded",
  "health.limited",
  "health.unknown",
  "health.down",
] as const

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
  /**
   * Optional MVP-2 store. When present, the /evals /cache /learning data-access
   * methods aggregate REAL persisted events via the SDK dashboard-readers;
   * when absent, they fall back to the demo/empty-state mocks below.
   */
  store?: Mvp2StoreExtension
}

export type DashboardDataAccess = {
  getSummary(): Promise<DashboardMetric[]>
  listRequests(filter?: RequestFilter): Promise<RequestRow[]>
  getRequest(traceId: string): Promise<TraceDetail | undefined>
  listModels(): Promise<ModelRow[]>
  compareModels(modelIds: string[]): Promise<ModelComparison>
  getRoutingDecision?(decisionId: string): Promise<TraceDetail | undefined>
  /** §9.1 `/api/evals` — real SDK aggregate when a store is wired, else mock. */
  getEvalsOverview(): Promise<EvalsOverviewData>
  /** §9.2 `/api/evals/:runId` — real SDK aggregate when a store is wired, else mock. */
  getEvalRunDetail(runId: string): Promise<EvalRunDetailData | null>
  /** §9.3 `/api/cache` — real SDK aggregate when a store is wired, else mock. */
  getCacheOverview(): Promise<CacheOverviewData>
  /** §9.4 `/api/learning` — real SDK aggregate when a store is wired, else mock. */
  getLearningOverview(): Promise<LearningOverviewData>
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
  {
    path: "/evals",
    title: "Evaluations",
    description: "Golden-dataset routing correctness, per-case pass/fail and regression against baseline.",
  },
  {
    path: "/cache",
    title: "Semantic Cache",
    description: "Hit ratio, degradation mode, and hit-quality guardrails.",
  },
  {
    path: "/learning",
    title: "Learning",
    description: "Offline weight tuning with human-in-the-loop; changes require eval baseline pass before enabling.",
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
  "GET /api/evals",
  "GET /api/evals/:runId",
  "GET /api/cache",
  "GET /api/learning",
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
    // MVP-2 read-only aggregates. Real SDK reader over persisted events when a
    // store is wired (source.store); otherwise the mocks below act as the
    // no-store demo / empty-state so a bare `createDashboard()` still renders.
    async getEvalsOverview(): Promise<EvalsOverviewData> {
      return source.store ? getEvalsOverview(source.store) : readEvalsOverview()
    },
    async getEvalRunDetail(runId: string): Promise<EvalRunDetailData | null> {
      return source.store ? getEvalRun(source.store, runId) : (readEvalRunDetail(runId) ?? null)
    },
    async getCacheOverview(): Promise<CacheOverviewData> {
      return source.store ? getCacheStats(source.store) : readCacheOverview()
    },
    async getLearningOverview(): Promise<LearningOverviewData> {
      return source.store ? getLearningState(source.store) : readLearningOverview()
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

/**
 * Result of {@link dispatchApiRequest}: either a resolved API response with an
 * HTTP status + `data` payload (the caller wraps it in the envelope), or `null`
 * when the path is not one of the 12 read-only `/api/*` routes.
 *
 * Ruling 4: exported so the control-plane can reuse this exact dispatch table
 * for its per-project dashboard proxy WITHOUT re-implementing route matching or
 * drifting from the dashboard's behavior. This is a pure function of
 * (pathname, searchParams, data) — no I/O, no ServerResponse coupling — so both
 * the dashboard's own `handleRequest` (below) and the control-plane call it and
 * stay byte-for-byte consistent.
 */
export type DashboardApiResult = { status: number; data: unknown } | null

/**
 * Pure `/api/*` dispatcher (Ruling 4). Returns the resolved payload + status for
 * a read-only dashboard API path, or `null` for anything that is not one of the
 * 12 API routes (favicon, HTML pages, unknown paths). Logic-preserving extract
 * of the original inline route table so `handleRequest` and the control-plane
 * proxy share one source of truth.
 */
export async function dispatchApiRequest(
  pathname: string,
  searchParams: URLSearchParams,
  data: DashboardDataAccess,
): Promise<DashboardApiResult> {
  if (pathname === "/api/metrics/summary") return { status: 200, data: await data.getSummary() }
  if (pathname === "/api/requests") return { status: 200, data: await data.listRequests(parseRequestFilterFrom(searchParams)) }
  if (pathname.startsWith("/api/requests/")) {
    const detail = await data.getRequest(decodeURIComponent(pathname.replace("/api/requests/", "")))
    return detail ? { status: 200, data: detail } : { status: 404, data: { error: "not found" } }
  }
  if (pathname === "/api/models/compare") {
    const ids = (searchParams.get("ids") ?? "")
      .split(",")
      .map((id) => id.trim())
      .filter(Boolean)
    return { status: 200, data: await data.compareModels(ids) }
  }
  if (pathname === "/api/models") return { status: 200, data: await data.listModels() }
  if (pathname.startsWith("/api/models/") && pathname.endsWith("/health")) {
    const modelId = decodeURIComponent(pathname.replace("/api/models/", "").replace("/health", ""))
    const model = (await data.listModels()).find((entry) => entry.modelId === modelId)
    return model
      ? { status: 200, data: { modelId, health: model.health, latencyP50Ms: model.latencyP50Ms } }
      : { status: 404, data: { error: "not found" } }
  }
  if (pathname.startsWith("/api/routing-decisions/")) {
    const detail = await data.getRoutingDecision?.(decodeURIComponent(pathname.replace("/api/routing-decisions/", "")))
    return detail ? { status: 200, data: detail } : { status: 404, data: { error: "not found" } }
  }
  // MVP-2 read-only API (detailed-design §9). :runId branch must precede the
  // bare /api/evals branch so it isn't shadowed.
  if (pathname.startsWith("/api/evals/")) {
    const detail = await data.getEvalRunDetail(decodeURIComponent(pathname.replace("/api/evals/", "")))
    return detail ? { status: 200, data: detail } : { status: 404, data: { error: "not found" } }
  }
  if (pathname === "/api/evals") return { status: 200, data: await data.getEvalsOverview() }
  if (pathname === "/api/cache") return { status: 200, data: await data.getCacheOverview() }
  if (pathname === "/api/learning") return { status: 200, data: await data.getLearningOverview() }
  return null
}

async function handleRequest(request: IncomingMessage, response: ServerResponse, data: DashboardDataAccess): Promise<void> {
  const url = new URL(request.url ?? "/", "http://localhost")

  try {
    if (url.pathname === "/favicon.ico") {
      response.statusCode = 204
      response.end()
      return
    }
    const apiResult = await dispatchApiRequest(url.pathname, url.searchParams, data)
    if (apiResult) return sendJson(response, apiResult.data, apiResult.status)
    const pageMap: Record<string, Page> = {
      "/": "requests",
      "/requests": "requests",
      "/models": "models",
      "/evals": "evals",
      "/cache": "cache",
      "/learning": "learning",
    }
    if (url.pathname in pageMap) {
      const [evals, cache, learning] = await Promise.all([
        data.getEvalsOverview(),
        data.getCacheOverview(),
        data.getLearningOverview(),
      ])
      return sendHtml(response, renderDashboardHtml(pageMap[url.pathname], { evals, cache, learning }))
    }
    return sendJson(response, { error: "not found" }, 404)
  } catch (error) {
    return sendJson(response, { error: error instanceof Error ? error.message : "unknown error" }, 500)
  }
}

/**
 * Translate the `/api/requests` query string into a {@link RequestFilter}.
 * `status` is validated against the known set; anything else is ignored so a
 * stray value can never 500 the endpoint. Accepts `URLSearchParams` directly so
 * both `handleRequest` and the exported {@link dispatchApiRequest} share it.
 */
function parseRequestFilterFrom(searchParams: URLSearchParams): RequestFilter {
  const filter: RequestFilter = {}
  const status = searchParams.get("status")
  if (status === "success" || status === "failed" || status === "fallback_success") filter.status = status
  const model = searchParams.get("model")
  if (model) filter.model = model
  const search = searchParams.get("search") ?? searchParams.get("q")
  if (search) filter.search = search
  const limit = Number(searchParams.get("limit"))
  if (Number.isFinite(limit) && limit > 0) filter.limit = limit
  return filter
}

function renderDashboardHtml(
  initialPage: Page,
  data: { evals: EvalsOverviewData; cache: CacheOverviewData; learning: LearningOverviewData },
): string {
  // Charts + cards are rendered server-side into each new section (design-spec
  // §4.4); the client only wires data tables + drawer interactions. The three
  // MVP-2 datasets are pre-fetched through the data-access layer (real SDK
  // readers when a store is wired, mocks otherwise) and passed in.
  const { evals, cache, learning } = data
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>Adaptive Model Router Dashboard</title>
<style>
:root{color-scheme:dark;--bg:#0D1117;--surface:#161B22;--surface2:#21262D;--border:#30363D;--text:#F0F6FC;--muted:#8B949E;--blue:#3B82F6;--ok:#3FB950;--warn:#D29922;--err:#F85149;--hit:#3FB950;--miss:#484F58;--regress-up:#3FB950;--regress-down:#F85149;--series-a:#3B82F6;--series-b:#8B949E;--track:#21262D}*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--text);font:14px/1.5 Inter,"Noto Sans SC",system-ui,sans-serif}.app{display:grid;grid-template-columns:220px 1fr;min-height:100dvh}.side{border-right:1px solid var(--border);background:#0f141b;padding:20px}.brand{font-weight:700;margin-bottom:24px}.nav{display:grid;gap:8px}.nav button{background:transparent;border:1px solid transparent;color:var(--muted);padding:10px 12px;border-radius:8px;text-align:left;cursor:pointer}.nav button.active,.nav button:hover{background:var(--surface);border-color:var(--border);color:var(--text)}main{padding:28px;min-width:0}.header{display:flex;justify-content:space-between;gap:16px;align-items:flex-start;margin-bottom:20px}.header h1{font-size:24px;margin:0}.header p{margin:4px 0 0;color:var(--muted)}.cards{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:12px;margin:20px 0}.card{background:var(--surface);border:1px solid var(--border);border-radius:12px;padding:14px}.card span{color:var(--muted);font-size:12px}.card strong{display:block;font-size:20px;margin-top:6px}.toolbar{display:flex;gap:8px;margin:16px 0}.toolbar input,.toolbar select{background:var(--surface);border:1px solid var(--border);color:var(--text);border-radius:8px;padding:8px 10px}.toolbar button{background:var(--blue);border:1px solid var(--blue);color:#fff;border-radius:8px;padding:8px 12px;cursor:pointer;font-weight:600}.toolbar button.ghost{background:transparent;border-color:var(--border);color:var(--muted);font-weight:400}.toolbar button:hover{filter:brightness(1.08)}#compare{margin:0 0 18px}.cmp-table td:first-child,.cmp-table th:first-child{color:var(--muted)}input[type=checkbox]{accent-color:var(--blue);cursor:pointer}table{width:100%;border-collapse:collapse;background:var(--surface);border:1px solid var(--border);border-radius:12px;overflow:hidden}th,td{text-align:left;padding:11px 12px;border-bottom:1px solid var(--border);vertical-align:top}th{color:var(--muted);font-size:12px;font-weight:600}tr:hover td{background:var(--surface2)}.mono{font-family:"JetBrains Mono",ui-monospace,monospace}.badge{display:inline-flex;border:1px solid var(--border);border-radius:999px;padding:2px 8px;font-size:12px;color:var(--muted)}.ok{color:var(--ok)}.failed,.down{color:var(--err)}.fallback_success,.degraded,.limited{color:var(--warn)}.hidden{display:none}.drawer{position:fixed;inset:0 0 0 auto;width:min(720px,46vw);background:#0f141b;border-left:1px solid var(--border);padding:22px;overflow:auto;box-shadow:-20px 0 60px rgba(0,0,0,.35)}.drawer pre{background:var(--bg);border:1px solid var(--border);border-radius:10px;padding:12px;overflow:auto}.close{float:right;background:var(--surface);border:1px solid var(--border);color:var(--text);border-radius:8px;padding:8px 10px;cursor:pointer}.empty{padding:28px;color:var(--muted);background:var(--surface);border:1px dashed var(--border);border-radius:12px}.muted{color:var(--muted)}.dot{display:inline-block;width:8px;height:8px;border-radius:50%;margin-right:6px;vertical-align:middle}.chart{display:block;width:100%;height:auto}.chart-wrap{background:var(--surface);border:1px solid var(--border);border-radius:12px;padding:16px;margin:20px 0}.chart-wrap h3{margin:0 0 12px;font-size:14px;color:var(--muted);font-weight:600}.legend{display:flex;gap:16px;flex-wrap:wrap;margin-top:10px;font-size:12px;color:var(--muted)}.matrix{border-collapse:collapse}.matrix td{width:22px;height:22px;padding:0;border:1px solid var(--bg);border-radius:3px;cursor:pointer}.cell-pass{background:var(--ok)}.cell-fail{background:var(--err)}.cell-na{background:var(--track)}.diff{display:inline-flex;align-items:center;gap:4px;font:12px/1 "JetBrains Mono",ui-monospace,monospace;padding:2px 8px;border-radius:999px;border:1px solid var(--border)}.diff.up{color:var(--regress-up)}.diff.down{color:var(--regress-down)}.diff.flat{color:var(--muted)}.card .chart{margin-top:8px}.toolbar button:disabled{opacity:.5;cursor:not-allowed;filter:none}@media(max-width:900px){.app{grid-template-columns:1fr}.side{border-right:0;border-bottom:1px solid var(--border)}.cards{grid-template-columns:1fr 1fr}.drawer{width:100vw}}
</style>
</head>
<body>
<div class="app">
  <aside class="side"><div class="brand">Adaptive Router</div><nav class="nav"><button id="nav-requests">Routing Decisions</button><button id="nav-models">Models</button><button id="nav-evals">Evaluations</button><button id="nav-cache">Cache</button><button id="nav-learning">Learning</button><button onclick="window.open('./docs/en/quickstart.md','_blank')">Docs</button></nav></aside>
  <main>
    <section id="page-requests"><div class="header"><div><h1>Routing Decisions</h1><p>Inspect how each agent request was routed across quality, latency, and token cost.</p></div><button class="close" onclick="location.reload()">Refresh</button></div><div id="metrics" class="cards"></div><div class="toolbar"><input id="search" placeholder="Search request id/model" /><select id="status"><option value="">All status</option><option>success</option><option>fallback_success</option><option>failed</option></select></div><div id="requests"></div></section>
    <section id="page-models" class="hidden"><div class="header"><div><h1>Models</h1><p>Review configured models, provider health, and routing capabilities. Tick rows to compare them side by side.</p></div></div><div class="toolbar"><input id="model-search" placeholder="Filter by model id / provider" /><button id="compare-btn">Compare selected</button><button id="compare-clear" class="ghost">Clear</button></div><div id="compare"></div><div id="models"></div></section>
    <section id="page-evals" class="hidden">${renderEvalsSection(evals)}</section>
    <section id="page-cache" class="hidden">${renderCacheSection(cache)}</section>
    <section id="page-learning" class="hidden">${renderLearningSection(learning)}</section>
  </main>
</div>
<div id="drawer" class="drawer hidden"></div>
<script>
const state={page:${JSON.stringify(initialPage)},requests:[],models:[],compare:[],evals:null,cache:null,learning:null};
const PAGES=["requests","models","evals","cache","learning"];
const $=id=>document.getElementById(id);
async function api(path){const res=await fetch(path); if(!res.ok) throw new Error(await res.text()); const payload=await res.json(); return payload.data;}
function setPage(page){state.page=page; PAGES.forEach(p=>{const sec=$('page-'+p); const nav=$('nav-'+p); if(sec)sec.classList.toggle('hidden',p!==page); if(nav)nav.classList.toggle('active',p===page);}); history.replaceState(null,'','/'+page);}
function fmtCost(v){return v==null?'n/a':'$'+Number(v).toFixed(6)}
function badge(v){return '<span class="badge '+String(v)+'">'+String(v)+'</span>'}
function renderMetrics(items){$('metrics').innerHTML=items.map(m=>'<div class="card"><span>'+m.label+'</span><strong>'+m.value+'</strong></div>').join('')}
function renderRequests(){const q=$('search').value.toLowerCase(); const s=$('status').value; const rows=state.requests.filter(r=>(!s||r.status===s)&&(!q||String(r.requestId).toLowerCase().includes(q)||String(r.selectedModel||'').toLowerCase().includes(q))); $('requests').innerHTML=rows.length?'<table><thead><tr><th>timestamp</th><th>request id</th><th>status</th><th>selected model</th><th>latency</th><th>tokens</th><th>cost</th><th>fallbacks</th></tr></thead><tbody>'+rows.map(r=>'<tr tabindex="0" data-request-id="'+r.requestId+'"><td class="mono">'+r.timestamp+'</td><td class="mono">'+r.requestId+'</td><td>'+badge(r.status)+'</td><td class="mono">'+(r.selectedModel||'n/a')+'</td><td>'+(r.latencyMs??'n/a')+'ms</td><td>'+(r.estimatedTokens??'n/a')+'</td><td>'+fmtCost(r.estimatedCostUsd)+'</td><td>'+r.fallbacks+'</td></tr>').join('')+'</tbody></table>':'<div class="empty">No routed requests match this filter. Adjust the search or status, or run your agent to populate this view.</div>'; document.querySelectorAll('[data-request-id]').forEach(row=>row.addEventListener('click',()=>openTrace(row.getAttribute('data-request-id'))))}
async function reloadRequests(){const params=new URLSearchParams(); const s=$('status').value; const q=$('search').value.trim(); if(s)params.set('status',s); if(q)params.set('search',q); const qs=params.toString(); state.requests=await api('/api/requests'+(qs?'?'+qs:'')); renderRequests();}
function visibleModels(){const q=($('model-search').value||'').toLowerCase(); return state.models.filter(m=>!q||m.modelId.toLowerCase().includes(q)||m.provider.toLowerCase().includes(q));}
function renderModels(){const rows=visibleModels(); $('models').innerHTML=rows.length?'<table><thead><tr><th></th><th>model id</th><th>provider</th><th>type</th><th>capabilities</th><th>health</th><th>latency p50</th><th>cost profile</th><th>enabled</th></tr></thead><tbody>'+rows.map(m=>'<tr><td><input type="checkbox" class="cmp" value="'+m.modelId+'"'+(state.compare.includes(m.modelId)?' checked':'')+' /></td><td class="mono">'+m.modelId+'</td><td>'+m.provider+'</td><td>'+badge(m.type)+'</td><td>'+m.capabilities.map(badge).join(' ')+'</td><td>'+badge(m.health)+'</td><td>'+(m.latencyP50Ms??'n/a')+'</td><td>'+ (m.costProfile||'n/a') +'</td><td>'+m.enabled+'</td></tr>').join('')+'</tbody></table>':'<div class="empty">No models match this filter.</div>'; document.querySelectorAll('.cmp').forEach(cb=>cb.addEventListener('change',()=>{const id=cb.value; if(cb.checked){if(!state.compare.includes(id))state.compare.push(id);}else{state.compare=state.compare.filter(x=>x!==id);}}))}
async function runCompare(){if(state.compare.length<1){$('compare').innerHTML='<div class="empty">Tick at least one model row to compare.</div>';return;} const c=await api('/api/models/compare?ids='+encodeURIComponent(state.compare.join(','))); const head='<tr><th>field</th>'+c.models.map(m=>'<th class="mono">'+m.modelId+(m.found?'':' (not configured)')+'</th>').join('')+'</tr>'; const rowOf=(label,fn)=>'<tr><td>'+label+'</td>'+c.models.map(m=>'<td>'+fn(m)+'</td>').join('')+'</tr>'; const matrix=c.capabilityMatrix.map(r=>'<tr><td>'+r.capability+'</td>'+r.support.map(s=>'<td>'+(s?'✓':'·')+'</td>').join('')+'</tr>').join(''); $('compare').innerHTML='<table class="cmp-table"><thead>'+head+'</thead><tbody>'+rowOf('provider',m=>m.provider)+rowOf('type',m=>badge(m.type))+rowOf('health',m=>badge(m.health))+rowOf('latency p50',m=>(m.latencyP50Ms??'n/a'))+rowOf('cost profile',m=>(m.costProfile||'n/a'))+rowOf('enabled',m=>m.enabled)+'<tr><td colspan="'+(c.models.length+1)+'"><strong>Capabilities</strong></td></tr>'+matrix+'</tbody></table>';}
async function openTrace(id){const d=await api('/api/requests/'+encodeURIComponent(id)); const el=$('drawer'); el.classList.remove('hidden'); el.innerHTML='<button class="close" id="drawer-close">Close</button><h2 class="mono">'+id+'</h2><h3>Decision summary</h3><p>'+d.decisionSummary+'</p><h3>Candidate models</h3><pre>'+JSON.stringify(d.candidateModels,null,2)+'</pre><h3>Attempts timeline</h3><pre>'+JSON.stringify(d.attempts,null,2)+'</pre><h3>Estimated usage</h3><pre>'+JSON.stringify(d.estimatedUsage||{},null,2)+'</pre>'; $('drawer-close').onclick=()=>el.classList.add('hidden')}
function pct(v){return v==null?'—':(v*100).toFixed(1)+'%'}
function num(v){return v==null?'—':String(v)}
function renderEvalsTable(){const d=state.evals; if(!d)return; const rows=d.runs.slice().reverse(); $('evals-table').innerHTML='<div class="chart-wrap"><h3>Recent runs</h3>'+(rows.length?'<table><thead><tr><th>runId</th><th>datasetId</th><th>weightsVersion</th><th>routeAccuracy</th><th>costCompliance</th><th>fallbackRate</th><th>createdAt</th></tr></thead><tbody>'+rows.map(r=>'<tr tabindex="0" data-run-id="'+r.runId+'"><td class="mono">'+r.runId+'</td><td class="mono">'+r.datasetId+'</td><td>'+badge(r.weightsVersion)+'</td><td class="mono">'+pct(r.metrics.routingAccuracy)+'</td><td class="mono">'+pct(r.metrics.costCompliance)+'</td><td class="mono">'+pct(r.metrics.fallbackRate)+'</td><td class="mono">'+r.createdAt+'</td></tr>').join('')+'</tbody></table>':'<div class="empty">No eval runs yet.</div>')+'</div>'; document.querySelectorAll('[data-run-id]').forEach(row=>row.addEventListener('click',()=>openRun(row.getAttribute('data-run-id')))); document.querySelectorAll('#page-evals .matrix td[data-case-id]').forEach(c=>c.addEventListener('click',()=>openCase(c.getAttribute('data-case-id'))))}
async function openRun(runId){const d=await api('/api/evals/'+encodeURIComponent(runId)); const el=$('drawer'); el.classList.remove('hidden'); const reg=d.regression?Object.entries(d.regression.deltas).map(([k,v])=>k+': '+v.delta.toFixed(3)+(v.regressed?' (regressed)':'')).join('\\n'):'no baseline'; el.innerHTML='<button class="close" id="drawer-close">Close</button><h2 class="mono">'+d.run.runId+'</h2><h3>Run metrics</h3><pre>'+JSON.stringify(d.run.metrics,null,2)+'</pre><h3>Regression delta</h3><pre>'+reg+'</pre><h3>Cases</h3><pre>'+JSON.stringify(d.cases,null,2)+'</pre>'; $('drawer-close').onclick=()=>el.classList.add('hidden')}
async function openCase(caseId){const d=state.evals; const runId=d&&d.runs.length?d.runs[d.runs.length-1].runId:null; if(!runId)return; const detail=await api('/api/evals/'+encodeURIComponent(runId)); const c=detail.cases.find(x=>x.id===caseId); const el=$('drawer'); el.classList.remove('hidden'); el.innerHTML='<button class="close" id="drawer-close">Close</button><h2 class="mono">'+caseId+'</h2>'+(c?'<h3>Expected vs chosen</h3><pre>'+JSON.stringify({expectedModel:c.expectedModel,expectedAnyOf:c.expectedAnyOf,chosenModel:c.chosenModel,rankOfExpected:c.rankOfExpected,skipped:c.skipped,fallbackTriggered:c.fallbackTriggered},null,2)+'</pre><h3>Assertions</h3><pre>'+JSON.stringify(c.assertions,null,2)+'</pre>':'<div class="empty">Case not in latest run detail.</div>'); $('drawer-close').onclick=()=>el.classList.add('hidden')}
function heat(sim){return sim==null?'':' style="color:color-mix(in srgb,var(--ok) '+(sim*100).toFixed(0)+'%,var(--err))"'}
function renderCacheTable(){const d=state.cache; if(!d)return; const rows=d.hitQualityLog; $('cache-table').innerHTML='<div class="chart-wrap"><h3>Hit-quality log</h3>'+(rows.length?'<table><thead><tr><th>query</th><th>top match</th><th>similarity</th><th>result</th><th>provider</th><th>ttl</th><th>createdAt</th></tr></thead><tbody>'+rows.map(r=>'<tr><td>'+r.query+'</td><td class="mono">'+(r.topMatchQuery||'—')+'</td><td class="mono"'+heat(r.similarity)+'>'+(r.similarity==null?'—':r.similarity.toFixed(3))+'</td><td><span class="badge" style="color:var('+(r.result==='hit'?'--hit':'--miss')+')">'+r.result+(r.source?' · '+r.source:'')+'</span></td><td class="mono">'+r.embeddingProviderId+'</td><td class="mono">'+(r.ttlMs==null?'—':r.ttlMs+'ms')+'</td><td class="mono">'+r.createdAt+'</td></tr>').join('')+'</tbody></table>':'<div class="empty">No cache lookups logged yet.</div>')+'</div>'}
function renderLearningTable(){const d=state.learning; if(!d)return; const rows=d.weightDiff; $('learning-table').innerHTML='<div class="chart-wrap"><h3>Before / after weights</h3><table><thead><tr><th>dimension</th><th>before</th><th>after</th><th>delta</th><th>attribution</th></tr></thead><tbody>'+rows.map(r=>'<tr tabindex="0" data-dim="'+r.dimension+'"><td class="mono">'+r.dimension+'</td><td class="mono">'+r.from+'</td><td class="mono">'+r.to+'</td><td>'+diffBadgeClient(r.delta)+'</td><td class="mono">'+(r.attribution.length?r.attribution.join(', '):'—')+'</td></tr>').join('')+'</tbody></table></div>'; document.querySelectorAll('[data-dim]').forEach(row=>row.addEventListener('click',()=>openDim(row.getAttribute('data-dim'))))}
function diffBadgeClient(delta){const dir=delta===0?'flat':(delta>0?'up':'down'); const tri=dir==='flat'?'<span>–</span>':'<svg width="8" height="8" viewBox="0 0 8 8" aria-hidden="true"><path d="'+(dir==='up'?'M4 0 L8 8 L0 8 Z':'M0 0 L8 0 L4 8 Z')+'" fill="currentColor"/></svg>'; const sign=delta>0?'+':''; return '<span class="diff flat">'+tri+sign+delta.toFixed(3)+'</span>'}
function openDim(dim){const d=state.learning; const r=d.weightDiff.find(x=>x.dimension===dim); const el=$('drawer'); el.classList.remove('hidden'); el.innerHTML='<button class="close" id="drawer-close">Close</button><h2 class="mono">'+dim+'</h2><h3>Change</h3><pre>'+JSON.stringify({from:r.from,to:r.to,delta:r.delta},null,2)+'</pre><h3>Attribution (eval cases / traces)</h3><pre>'+JSON.stringify(r.attribution,null,2)+'</pre><h3>Rollback target</h3><p class="mono">'+d.activeWeightsVersion+'</p>'; $('drawer-close').onclick=()=>el.classList.add('hidden')}
async function load(){setPage(state.page); renderMetrics(await api('/api/metrics/summary')); state.requests=await api('/api/requests'); state.models=await api('/api/models'); renderRequests(); renderModels(); state.evals=await api('/api/evals'); state.cache=await api('/api/cache'); state.learning=await api('/api/learning'); renderEvalsTable(); renderCacheTable(); renderLearningTable();}
$('nav-requests').onclick=()=>setPage('requests'); $('nav-models').onclick=()=>setPage('models'); $('nav-evals').onclick=()=>setPage('evals'); $('nav-cache').onclick=()=>setPage('cache'); $('nav-learning').onclick=()=>setPage('learning'); $('search').oninput=reloadRequests; $('status').onchange=reloadRequests; $('model-search').oninput=renderModels; $('compare-btn').onclick=runCompare; $('compare-clear').onclick=()=>{state.compare=[]; $('compare').innerHTML=''; renderModels();}; load().catch(e=>{document.querySelector('main').innerHTML='<div class="empty">'+e.message+'</div>'});
</script>
</body>
</html>`
}

// ===========================================================================
// MVP-2 atomic chart components (design-spec §2). All zero-dependency,
// server-side string builders — coordinates computed here, never in the
// browser. 4 SVG (sparkline/stackedBar/donut/lineChart) + 2 HTML
// (passFailMatrix/diffBadge). No framework, no chart library.
// ===========================================================================

/** §2.1 Micro trend line. viewBox 0 0 120 32, 3px top/bottom padding. */
export function sparkline(values: number[]): string {
  const n = values.length
  if (n < 2) return '<span class="mono muted">n/a</span>'
  const min = Math.min(...values)
  const max = Math.max(...values)
  const range = max - min || 1
  const pts = values
    .map((v, i) => `${(i * (120 / (n - 1))).toFixed(2)},${(29 - ((v - min) / range) * 26).toFixed(2)}`)
    .join(" ")
  return (
    `<svg class="chart" viewBox="0 0 120 32" role="img" aria-label="trend">` +
    `<line x1="0" y1="29" x2="120" y2="29" stroke="var(--track)" stroke-width="1"/>` +
    `<polyline fill="none" stroke="var(--series-a)" stroke-width="1.5" points="${pts}"/></svg>`
  )
}

/** §2.2 Horizontal stacked bar / single-value progress. viewBox 0 0 240 14. */
export function stackedBar(segs: { value: number; token: string }[]): string {
  const total = segs.reduce((s, x) => s + x.value, 0) || 1
  let cx = 0
  const rects = segs
    .map((s) => {
      const w = (s.value / total) * 240
      const r = `<rect x="${cx.toFixed(2)}" y="0" width="${w.toFixed(2)}" height="14" fill="var(${s.token})"/>`
      cx += w
      return r
    })
    .join("")
  // Rounded corners via an overflow-hidden wrapper (SVG clip-path inset support is uneven).
  return (
    `<span style="display:block;border-radius:7px;overflow:hidden">` +
    `<svg class="chart" viewBox="0 0 240 14" role="img" aria-label="ratio">` +
    `<rect x="0" y="0" width="240" height="14" fill="var(--track)"/>${rects}</svg></span>`
  )
}

/** §2.3 Donut (ring proportion) via stroke-dasharray. viewBox 0 0 120 120. */
export function donut(parts: { value: number; token: string }[], centerLabel: string): string {
  const r = 48
  const C = 2 * Math.PI * r
  const total = parts.reduce((s, x) => s + x.value, 0) || 1
  let off = 0
  const arcs = parts
    .map((p) => {
      const dash = (p.value / total) * C
      const a =
        `<circle cx="60" cy="60" r="${r}" fill="none" stroke="var(${p.token})" stroke-width="16" ` +
        `stroke-dasharray="${dash.toFixed(2)} ${(C - dash).toFixed(2)}" stroke-dashoffset="${(-off).toFixed(2)}"/>`
      off += dash
      return a
    })
    .join("")
  return (
    `<svg class="chart" viewBox="0 0 120 120" role="img" aria-label="hit ratio" style="max-width:160px;margin:auto">` +
    `<circle cx="60" cy="60" r="${r}" fill="none" stroke="var(--track)" stroke-width="16"/>` +
    `<g transform="rotate(-90 60 60)">${arcs}</g>` +
    `<text x="60" y="58" text-anchor="middle" fill="var(--text)" font-size="20" font-family="JetBrains Mono,monospace">${centerLabel}</text>` +
    `<text x="60" y="74" text-anchor="middle" fill="var(--muted)" font-size="9">hit rate</text></svg>`
  )
}

/** §2.4 Multi-series line chart. viewBox 0 0 480 200; shared X index; global min/max. */
export function lineChart(series: { token: string; values: number[] }[]): string {
  const padL = 40
  const padT = 12
  const W = 428
  const H = 164
  const all = series.flatMap((s) => s.values)
  if (all.length === 0) return '<div class="empty">No data.</div>'
  const min = Math.min(...all)
  const max = Math.max(...all)
  const range = max - min || 1
  const n = Math.max(...series.map((s) => s.values.length))
  const grid = [0, 1, 2, 3]
    .map((k) => {
      const y = padT + (H * k) / 3
      return `<line x1="${padL}" y1="${y}" x2="480" y2="${y}" stroke="var(--track)" stroke-width="1"/>`
    })
    .join("")
  const lines = series
    .map((s) => {
      const pts = s.values
        .map((v, i) => `${(padL + i * (W / (n - 1 || 1))).toFixed(2)},${(padT + H - ((v - min) / range) * H).toFixed(2)}`)
        .join(" ")
      return `<polyline fill="none" stroke="var(${s.token})" stroke-width="2" points="${pts}"/>`
    })
    .join("")
  const yl = [max, (max + min) / 2, min]
    .map(
      (v, k) =>
        `<text x="34" y="${padT + (H * k) / 2 + 3}" text-anchor="end" fill="var(--muted)" font-size="9" font-family="JetBrains Mono,monospace">${v.toFixed(2)}</text>`,
    )
    .join("")
  return `<svg class="chart" viewBox="0 0 480 200" role="img" aria-label="trend">${grid}${yl}${lines}</svg>`
}

/** §2.5 Pass/Fail matrix — pure HTML table, 22×22 cells, wraps every 30 cells. */
export function passFailMatrix(cases: { id: string; state: "pass" | "fail" | "na" }[]): string {
  if (cases.length === 0) return '<div class="empty">No evaluated cases yet.</div>'
  const cls: Record<string, string> = { pass: "cell-pass", fail: "cell-fail", na: "cell-na" }
  const rows: string[] = []
  for (let i = 0; i < cases.length; i += 30) {
    const cells = cases
      .slice(i, i + 30)
      .map(
        (c) =>
          `<td class="${cls[c.state]}" data-case-id="${escapeAttr(c.id)}" title="${escapeAttr(c.id)}: ${c.state}"></td>`,
      )
      .join("")
    rows.push(`<tr>${cells}</tr>`)
  }
  return `<table class="matrix"><tbody>${rows.join("")}</tbody></table>`
}

/**
 * §2.6 Diff badge. `valence`:
 *  - "higher" (default): delta>0 = good = up green (routingAccuracy/top1ExpectMatch…)
 *  - "lower": delta<0 = good = up green (cost/latency/fallbackRate…)
 *  - "neutral": direction triangle only, always flat/muted (all /learning weights)
 */
export function diffBadge(delta: number, valence: "higher" | "lower" | "neutral" = "higher"): string {
  const dir =
    delta === 0
      ? "flat"
      : valence === "neutral"
        ? delta > 0
          ? "up"
          : "down"
        : (valence === "lower" ? delta < 0 : delta > 0)
          ? "up"
          : "down"
  const colorCls = valence === "neutral" ? "flat" : dir
  const tri =
    dir === "flat"
      ? `<span>–</span>`
      : `<svg width="8" height="8" viewBox="0 0 8 8" aria-hidden="true"><path d="${dir === "up" ? "M4 0 L8 8 L0 8 Z" : "M0 0 L8 0 L4 8 Z"}" fill="currentColor"/></svg>`
  const sign = delta > 0 ? "+" : ""
  return `<span class="diff ${colorCls}">${tri}${sign}${delta.toFixed(3)}</span>`
}

/** Minimal attribute escaper for server-rendered ids/titles. */
function escapeAttr(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;")
}

// ===========================================================================
// MVP-2 no-store fallback readers (detailed-design §9).
//
// These return §9-contract-shaped demo/empty-state data and are used ONLY when
// no Mvp2StoreExtension is wired into the DashboardDataSource (e.g. a bare
// `createDashboard()` for local demos / tests). When a store IS present, the
// data-access layer instead calls the real SDK readers
// (getEvalsOverview / getEvalRun / getCacheStats / getLearningState) from
// @adaptive-router/sdk. Return shapes are identical to the SDK types.
// ===========================================================================

// No-store fallback for §9.1 GET /api/evals (real path: SDK getEvalsOverview).
function readEvalsOverview(): EvalsOverviewData {
  const runs: EvalsOverviewData["runs"] = [
    { runId: "run_1720000001_a1", datasetId: "golden-routing@3f9c2a1b", weightsVersion: "builtin", createdAt: "2026-07-01T09:12:00.000Z", metrics: { routingAccuracy: 0.86, top1ExpectMatch: 0.71, costCompliance: 0.94, fallbackRate: 0.08 } },
    { runId: "run_1720086402_b2", datasetId: "golden-routing@3f9c2a1b", weightsVersion: "builtin", createdAt: "2026-07-02T09:15:00.000Z", metrics: { routingAccuracy: 0.88, top1ExpectMatch: 0.74, costCompliance: 0.93, fallbackRate: 0.07 } },
    { runId: "run_1720172803_c3", datasetId: "golden-routing@3f9c2a1b", weightsVersion: "learned_2026-07-03_ab12", createdAt: "2026-07-03T09:11:00.000Z", metrics: { routingAccuracy: 0.91, top1ExpectMatch: 0.78, costCompliance: 0.95, fallbackRate: 0.05 } },
  ]
  const state = (i: number): "pass" | "fail" | "na" => (i % 11 === 4 ? "na" : i % 7 === 3 ? "fail" : "pass")
  return {
    runs,
    sparklines: {
      routingAccuracy: [0.83, 0.85, 0.86, 0.88, 0.91],
      top1ExpectMatch: [0.68, 0.7, 0.71, 0.74, 0.78],
      costCompliance: [0.9, 0.92, 0.94, 0.93, 0.95],
      fallbackRate: [0.12, 0.1, 0.08, 0.07, 0.05],
    },
    latestRegression: {
      baselineRunId: "run_1720086402_b2",
      currentRunId: "run_1720172803_c3",
      deltas: {
        routingAccuracy: { baseline: 0.88, current: 0.91, delta: 0.03, regressed: false },
        top1ExpectMatch: { baseline: 0.74, current: 0.78, delta: 0.04, regressed: false },
        costCompliance: { baseline: 0.93, current: 0.95, delta: 0.02, regressed: false },
        fallbackRate: { baseline: 0.07, current: 0.05, delta: -0.02, regressed: false },
      },
      passed: true,
    },
    latestPerCase: Array.from({ length: 48 }, (_, i) => ({ id: `case_${String(i + 1).padStart(3, "0")}`, state: state(i) })),
  }
}

// No-store fallback for §9.2 GET /api/evals/:runId (real path: SDK getEvalRun).
function readEvalRunDetail(runId: string): EvalRunDetailData | undefined {
  const overview = readEvalsOverview()
  const run = overview.runs.find((r) => r.runId === runId)
  if (!run) return undefined
  return {
    run,
    cases: overview.latestPerCase.slice(0, 12).map((c) => ({
      id: c.id,
      expectedModel: "openai/gpt-4o",
      expectedAnyOf: ["openai/gpt-4o", "anthropic/claude-3.5-sonnet"],
      chosenModel: c.state === "fail" ? "openai/gpt-4o-mini" : "openai/gpt-4o",
      rankOfExpected: c.state === "fail" ? 2 : 0,
      skipped: false,
      fallbackTriggered: c.state === "fail",
      assertions: [
        { key: "anyOf", passed: c.state !== "fail" },
        { key: "maxCostUsd", passed: c.state !== "na" },
        { key: "mustHaveCapabilities", passed: true },
      ],
    })),
    regression: overview.latestRegression,
  }
}

// No-store fallback for §9.3 GET /api/cache (real path: SDK getCacheStats).
function readCacheOverview(): CacheOverviewData {
  const hits = 742
  const misses = 258
  const total = hits + misses
  const log: CacheOverviewData["hitQualityLog"] = [
    { query: "summarize the quarterly revenue report", topMatchQuery: "summarise the quarterly revenue report", similarity: 0.972, result: "hit", source: "semantic", embeddingProviderId: "openai:text-embedding-3-small", ttlMs: 3600000, createdAt: "2026-07-03T10:41:00.000Z" },
    { query: "list active kubernetes pods", topMatchQuery: "list active kubernetes pods", similarity: null, result: "hit", source: "exact", embeddingProviderId: "openai:text-embedding-3-small", ttlMs: 300000, createdAt: "2026-07-03T10:38:00.000Z" },
    { query: "explain the CAP theorem in one sentence", topMatchQuery: "what is the CAP theorem", similarity: 0.913, result: "miss", source: null, embeddingProviderId: "openai:text-embedding-3-small", ttlMs: null, createdAt: "2026-07-03T10:35:00.000Z" },
    { query: "draft a cold outreach email", topMatchQuery: null, similarity: null, result: "miss", source: null, embeddingProviderId: "openai:text-embedding-3-small", ttlMs: null, createdAt: "2026-07-03T10:31:00.000Z" },
  ]
  return {
    hits,
    misses,
    total,
    hitRate: hits / total,
    mode: "semantic@0.95",
    donut: { hits: 690, misses: 258, degradedFallbacks: 52 },
    hitQualityLog: log,
  }
}

// No-store fallback for §9.4 GET /api/learning (real path: SDK getLearningState).
function readLearningOverview(): LearningOverviewData {
  const baseline = [40, 10, 15, 10, 6, 3, 100, 30, 15, 12, 8, 0]
  const proposed = [43, 9, 16, 11, 6, 3, 96, 31, 15, 12, 8, 0]
  const attribution: Record<string, string[]> = {
    tierMatch: ["case_003", "case_017", "trace_9f2a"],
    successRate: ["case_021"],
    costCoefficient: ["case_008", "case_034"],
  }
  return {
    activeWeightsVersion: "builtin",
    proposedChangeCount: baseline.filter((b, i) => b !== proposed[i]).length,
    evalDelta: {
      baselineRunId: "run_1720086402_b2",
      currentRunId: "run_1720172803_c3",
      deltas: {
        routingAccuracy: { baseline: 0.88, current: 0.91, delta: 0.03, regressed: false },
        top1ExpectMatch: { baseline: 0.74, current: 0.78, delta: 0.04, regressed: false },
        costCompliance: { baseline: 0.93, current: 0.95, delta: 0.02, regressed: false },
      },
      passed: true,
    },
    gateStatus: "passed",
    baselineWeights: baseline,
    proposedWeights: proposed,
    weightDiff: WEIGHT_DIMENSION_ORDER.map((dimension, i) => ({
      dimension,
      from: baseline[i],
      to: proposed[i],
      delta: proposed[i] - baseline[i],
      attribution: attribution[dimension] ?? [],
    })),
  }
}

// ===========================================================================
// MVP-2 page section renderers (design-spec §3). Cards + charts are rendered
// server-side into the section HTML; the client script only wires the data
// tables + drawer interactions.
// ===========================================================================

const CANON_METRICS: { key: string; label: string; valence: "higher" | "lower" }[] = [
  { key: "routingAccuracy", label: "Route accuracy", valence: "higher" },
  { key: "top1ExpectMatch", label: "Top-1 hit", valence: "higher" },
  { key: "costCompliance", label: "Cost compliance", valence: "higher" },
  { key: "fallbackRate", label: "Fallback / fail rate", valence: "lower" },
]

function fmtMetric(v: number | undefined): string {
  return v === undefined ? "—" : v.toFixed(2)
}

/** §3.1 `/evals` — Evaluation & regression gate. */
function renderEvalsSection(d: EvalsOverviewData): string {
  const cards = CANON_METRICS.map((m) => {
    const v = d.runs.length ? d.runs[d.runs.length - 1].metrics[m.key] : undefined
    const spark = d.sparklines[m.key] ?? []
    return `<div class="card"><span>${m.label}</span><strong class="mono">${fmtMetric(v)}</strong>${sparkline(spark)}</div>`
  }).join("")

  const regression = d.latestRegression
  const regStrip = !regression
    ? '<div class="empty">尚无基线（no baseline yet）。</div>'
    : CANON_METRICS.map((m) => {
        const dd = regression.deltas[m.key]
        if (!dd) return ""
        return `<span title="${m.key}: ${dd.baseline.toFixed(3)} → ${dd.current.toFixed(3)}">${diffBadge(dd.delta, m.valence)}</span>`
      }).join(" ")

  const legend =
    '<span class="legend">' +
    '<span><i class="dot" style="background:var(--ok)"></i>pass</span>' +
    '<span><i class="dot" style="background:var(--err)"></i>fail (regressed)</span>' +
    '<span><i class="dot" style="background:var(--track)"></i>n/a</span></span>'

  return (
    `<div class="header"><div><h1>Evaluations</h1>` +
    `<p>Golden-dataset routing correctness, per-case pass/fail and regression against baseline.</p></div>` +
    `<button class="close" onclick="location.reload()">Refresh</button></div>` +
    `<div class="cards">${cards}</div>` +
    `<div class="chart-wrap"><h3>Regression vs baseline</h3><div class="legend">${regStrip}</div></div>` +
    `<div class="chart-wrap"><h3>Per-case pass/fail</h3>${passFailMatrix(d.latestPerCase)}${legend}</div>` +
    `<div id="evals-table"></div>`
  )
}

/** §3.2 `/cache` — Semantic cache. */
function renderCacheSection(d: CacheOverviewData): string {
  const modeDegraded = d.mode.startsWith("degraded")
  const cards =
    `<div class="card"><span>Hit rate</span><strong class="mono">${(d.hitRate * 100).toFixed(1)}%</strong></div>` +
    `<div class="card"><span>Hits</span><strong class="mono">${d.hits}</strong></div>` +
    `<div class="card"><span>Misses</span><strong class="mono">${d.misses}</strong></div>` +
    `<div class="card"><span>Mode</span><strong class="mono"${modeDegraded ? ' style="color:var(--warn)"' : ""}>${escapeAttr(d.mode)}</strong></div>`

  const donutParts = [
    { value: d.donut.hits, token: "--hit" },
    { value: d.donut.misses, token: "--miss" },
    { value: d.donut.degradedFallbacks, token: "--warn" },
  ]
  const barLegend =
    '<span class="legend">' +
    '<span><i class="dot" style="background:var(--hit)"></i>hits</span>' +
    '<span><i class="dot" style="background:var(--miss)"></i>misses</span></span>'
  const donutLegend =
    '<span class="legend">' +
    '<span><i class="dot" style="background:var(--hit)"></i>hits</span>' +
    '<span><i class="dot" style="background:var(--miss)"></i>misses</span>' +
    '<span><i class="dot" style="background:var(--warn)"></i>degraded fallbacks</span></span>'

  return (
    `<div class="header"><div><h1>Semantic Cache</h1>` +
    `<p>Hit ratio, degradation mode, and hit-quality guardrails.</p></div>` +
    `<button class="close" onclick="location.reload()">Refresh</button></div>` +
    `<div class="cards">${cards}</div>` +
    `<div class="chart-wrap"><h3>Hit ratio</h3>${donut(donutParts, `${(d.hitRate * 100).toFixed(0)}%`)}${donutLegend}</div>` +
    `<div class="chart-wrap"><h3>Hit / miss composition</h3>${stackedBar([{ value: d.donut.hits, token: "--hit" }, { value: d.donut.misses, token: "--miss" }])}${barLegend}</div>` +
    `<div id="cache-table"></div>`
  )
}

/** §3.3 `/learning` — Routing-result learning. */
function renderLearningSection(d: LearningOverviewData): string {
  const evalDeltaBadge = d.evalDelta?.deltas.routingAccuracy
    ? diffBadge(d.evalDelta.deltas.routingAccuracy.delta, "higher")
    : '<span class="mono muted">—</span>'
  const gateColor = d.gateStatus === "passed" ? "var(--ok)" : d.gateStatus === "blocked" ? "var(--warn)" : "var(--muted)"
  const activeStyle = d.activeWeightsVersion === "builtin" ? ' style="color:var(--muted)"' : ""
  const cards =
    `<div class="card"><span>Active weightsVersion</span><strong class="mono"${activeStyle}>${escapeAttr(d.activeWeightsVersion)}</strong></div>` +
    `<div class="card"><span>Proposed changes</span><strong class="mono">${d.proposedChangeCount}</strong></div>` +
    `<div class="card"><span>Eval delta (route accuracy)</span><strong>${evalDeltaBadge}</strong></div>` +
    `<div class="card"><span>Gate status</span><strong class="mono" style="color:${gateColor}">${d.gateStatus}</strong></div>`

  const series = [
    { token: "--series-b", values: d.baselineWeights },
    { token: "--series-a", values: d.proposedWeights ?? d.baselineWeights },
  ]
  const lineLegend =
    '<span class="legend">' +
    '<span><i class="dot" style="background:var(--series-b)"></i>before (baseline)</span>' +
    '<span><i class="dot" style="background:var(--series-a)"></i>after (proposed)</span></span>'

  const gateBlocked = d.gateStatus !== "passed"
  const adoptTitle = gateBlocked ? ' title="必须先通过 eval baseline"' : ""
  const toolbar =
    `<div class="toolbar">` +
    `<button id="learning-adopt"${gateBlocked ? " disabled" : ""}${adoptTitle}>Adopt</button>` +
    `<button id="learning-rollback" class="ghost">Rollback</button></div>`

  return (
    `<div class="header"><div><h1>Learning</h1>` +
    `<p>Offline weight tuning with human-in-the-loop; changes require eval baseline pass before enabling.</p></div>` +
    `<button class="close" onclick="location.reload()">Refresh</button></div>` +
    `<div class="cards">${cards}</div>` +
    `${toolbar}` +
    `<div class="chart-wrap"><h3>Weight evolution (before → after)</h3>${lineChart(series)}${lineLegend}</div>` +
    `<div id="learning-table"></div>`
  )
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
