import { createRouter, createStaticProvider } from "@adaptive-router/sdk"

const router = createRouter({
  providers: [
    createStaticProvider("local", [
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
    ]),
  ],
})

const result = await router.chat({
  messages: [{ role: "user", content: "Plan the next coding task." }],
  route: { task: "plan", quality: "balanced", explain: true },
})

console.log(JSON.stringify(result.routerTrace, null, 2))
