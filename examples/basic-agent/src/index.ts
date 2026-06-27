import { createDashboard, createReadOnlyDataAccess } from "@adaptive-router/dashboard"
import {
  createAnthropicProvider,
  createDeepSeekProvider,
  createOllamaProvider,
  createOpenAIProvider,
  createRouter,
  createSQLiteTraceStore,
  createStaticProvider,
} from "@adaptive-router/sdk"

const providers = [
  process.env.OPENAI_API_KEY ? createOpenAIProvider({ apiKey: process.env.OPENAI_API_KEY }) : undefined,
  process.env.ANTHROPIC_API_KEY ? createAnthropicProvider({ apiKey: process.env.ANTHROPIC_API_KEY }) : undefined,
  process.env.DEEPSEEK_API_KEY ? createDeepSeekProvider({ apiKey: process.env.DEEPSEEK_API_KEY }) : undefined,
  createOllamaProvider({ baseURL: process.env.OLLAMA_BASE_URL }),
].filter(Boolean)

const fallbackProvider = createStaticProvider("local", [
  {
    id: "local/scaffold-model",
    provider: "local",
    model: "scaffold-model",
    type: "self-hosted",
    kind: "self-hosted",
    capabilities: ["reasoning", "streaming"],
    tier: "balanced",
    contextWindow: 8192,
    enabled: true,
    health: { status: "ok", successRate: 1 },
  },
])

const store = await createSQLiteTraceStore({
  path: ".adaptive-router/router.db",
  fallbackPath: ".adaptive-router/router.jsonl",
})

const router = createRouter({
  providers: providers.length > 0 ? providers : [fallbackProvider],
  store,
})

const result = await router.chat({
  messages: [{ role: "user", content: "Plan the next coding task." }],
  route: { task: "plan", quality: "balanced", explain: true },
})

console.log(JSON.stringify(result.routerTrace, null, 2))

const dashboard = await createDashboard({
  port: 4318,
  data: createReadOnlyDataAccess({
    listTraces: () => router.traces(),
    listModels: () => router.models(),
  }),
})

console.log(`Dashboard: ${dashboard.url}`)
console.log("Press Ctrl+C to stop the local dashboard.")
