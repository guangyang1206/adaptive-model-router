import { createDashboard, createReadOnlyDataAccess } from "@adaptive-router/dashboard"
import type { CandidateModel, QualityPreference } from "@adaptive-router/sdk"
import { createJsonlTraceStore, createRouter } from "@adaptive-router/sdk"
import { resolveProviders } from "./providers.js"

const { providers, mode, detected } = resolveProviders()

const store = createJsonlTraceStore({ path: ".adaptive-router/traces.jsonl" })
const router = createRouter({ providers, store })

const prompt = "Refactor the auth middleware so token parsing is testable."

function printBanner(): void {
  if (mode === "offline") {
    console.log("Mode: offline - no provider credentials found, using a local stub provider.")
    console.log("Set OPENAI_API_KEY, ANTHROPIC_API_KEY, DEEPSEEK_API_KEY or OLLAMA_BASE_URL to route for real.")
    return
  }
  console.log(`Mode: live - routing across real providers (${detected.join(", ")}).`)
}

function printCandidates(candidates: CandidateModel[]): void {
  for (const candidate of candidates) {
    const id = candidate.modelId.padEnd(24)
    if (candidate.skipped) {
      console.log(`  ${id} skipped   ${candidate.skippedReason ?? "no reason reported"}`)
      continue
    }
    console.log(`  ${id} ${candidate.score.toFixed(2).padStart(9)}   ${candidate.reasons.join(" ")}`)
  }
}

/**
 * Step 1 - ranking only. `evaluate()` scores the catalog and never calls a
 * provider, so this section produces identical output with or without API keys.
 */
async function showRanking(): Promise<void> {
  const qualities: QualityPreference[] = ["standard", "high"]
  for (const quality of qualities) {
    const evaluation = await router.evaluate({
      messages: [{ role: "user", content: prompt }],
      route: { task: "code", quality, explain: true },
    })
    console.log(`\nRanking for quality=${quality}`)
    printCandidates(evaluation.candidates)
  }
}

/**
 * Step 2 - capability hard filter. A model that cannot do JSON mode is removed
 * before scoring, with the reason recorded on the candidate.
 */
async function showCapabilityFilter(): Promise<void> {
  const evaluation = await router.evaluate({
    messages: [{ role: "user", content: "Extract the fields as strict JSON." }],
    route: { task: "extract", explain: true },
    requiredCapabilities: ["json-mode"],
  })
  console.log("\nRanking for requiredCapabilities=[json-mode]")
  printCandidates(evaluation.candidates)
}

/**
 * Step 3 - an actual call. In offline mode the stub provider answers locally;
 * in live mode this hits the winning provider and falls back on failure.
 */
async function runChat(): Promise<boolean> {
  try {
    const { response, routerTrace } = await router.chat({
      messages: [{ role: "user", content: prompt }],
      route: { task: "code", quality: "balanced", explain: true },
    })

    console.log("\nChat result")
    console.log(`  chosenModel   ${routerTrace.chosenModel ?? "none"}`)
    console.log(`  status        ${routerTrace.status}`)
    console.log(`  latencyMs     ${routerTrace.latencyMs ?? "n/a"}`)
    console.log(`  estCostUsd    ${routerTrace.estimatedCostUsd ?? "n/a"}`)
    console.log(`  reason        ${routerTrace.reason}`)
    console.log(`  content       ${response.content?.trim() || "(no plain-text content returned)"}`)

    if (routerTrace.status === "failed") {
      console.error("\nEvery candidate failed. Attempts:")
      for (const attempt of routerTrace.attempts) {
        console.error(`  #${attempt.attemptNo} ${attempt.modelId} ${attempt.status} ${attempt.errorCode ?? ""}`)
      }
      return false
    }
    return true
  } catch (error) {
    console.error("\nRouting could not start:", error instanceof Error ? error.message : error)
    return false
  }
}

/** Step 4 - opt-in dashboard. Off by default so `npm start` exits on its own. */
async function maybeServeDashboard(): Promise<void> {
  if (process.env.DASHBOARD !== "1") {
    console.log("\nSet DASHBOARD=1 to also serve the local trace dashboard.")
    return
  }

  const dashboard = await createDashboard({
    port: Number(process.env.DASHBOARD_PORT ?? 4318),
    data: createReadOnlyDataAccess({
      listTraces: () => router.traces(),
      listModels: () => router.models(),
    }),
  })
  console.log(`\nDashboard: ${dashboard.url}`)
  console.log("Press Ctrl+C to stop it.")

  process.on("SIGINT", () => {
    void dashboard.close().then(() => process.exit(0))
  })
}

printBanner()
await showRanking()
await showCapabilityFilter()
const routed = await runChat()
console.log(`\nTraces written to .adaptive-router/traces.jsonl (${(await router.traces()).length} so far).`)
await maybeServeDashboard()

if (!routed) {
  process.exitCode = 1
}
