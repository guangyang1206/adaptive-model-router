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

export async function createDashboard(options: DashboardOptions = {}) {
  const port = options.port ?? 4318
  return {
    url: `http://localhost:${port}`,
    routes: dashboardRoutes,
    readonly: options.readonly ?? true,
    api: readonlyApiRoutes,
  }
}
