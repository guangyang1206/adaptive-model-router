export type DashboardOptions = {
  port?: number
  databasePath?: string
  readonly?: boolean
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

export function createReadOnlyDataAccess(source: DashboardDataSource) {
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
      return {
        request: traceToRequestRow(trace),
        decisionSummary: trace.reason,
        candidateModels: trace.candidates,
        attempts: trace.attempts,
        estimatedUsage: trace.usage,
      }
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
  }
}

export async function createDashboard(options: DashboardOptions = {}) {
  const port = options.port ?? 4318
  return {
    url: `http://localhost:${port}`,
    routes: dashboardRoutes,
    readonly: options.readonly ?? true,
    api: readonlyApiRoutes,
  }
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

function formatCostProfile(cost: DashboardModel["cost"]): string | undefined {
  if (!cost) return undefined
  const input = cost.inputPer1M ?? 0
  const output = cost.outputPer1M ?? input
  return `$${input}/$${output} per 1M tokens${cost.estimated ? " estimated" : ""}`
}
