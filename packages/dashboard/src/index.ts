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

export async function createDashboard(options: DashboardOptions = {}) {
  const port = options.port ?? 4318
  return {
    url: `http://localhost:${port}`,
    routes: dashboardRoutes,
    readonly: options.readonly ?? true,
  }
}
