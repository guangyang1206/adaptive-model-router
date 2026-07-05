import type { AdaptiveRouter } from "../index.js"
import type { EvalRunResult, ModelProfile, RouterTrace } from "../types.js"
import type { LoadedDataset } from "./dataset.js"
import type { JudgePlugin } from "./judge.js"
import { computeMetrics, evaluateCase } from "./metrics.js"

export type RunEvalOptions = {
  /** Weights version recorded on the run (does not itself change routing). */
  weightsVersion?: string
  /**
   * When true, also call router.chat() to observe fallback/attempts. The router
   * MUST be backed by a mock provider (createStaticProvider) — the runner never
   * makes real network calls (Spec §5.2 cost防护). Default false = evaluate-only.
   */
  useChat?: boolean
  /** P2 opt-in judge. Absent ⇒ similarity metrics skipped, not fabricated. */
  judge?: JudgePlugin
  /** Injected id/clock for deterministic run ids in tests. */
  runId?: string
  now?: () => number
}

/**
 * Run a dataset through a router, collecting the actual routing decision per
 * case. Default path calls only `router.evaluate` (pure scoring, zero cost).
 * `useChat` additionally exercises the fallback loop against a mock provider.
 */
export async function runEval(
  router: AdaptiveRouter,
  dataset: LoadedDataset,
  opts: RunEvalOptions = {},
): Promise<EvalRunResult> {
  const models = await router.models()
  const perCase = []
  for (const c of dataset.cases) {
    const decision = await router.evaluate(c.request)
    let trace: RouterTrace | undefined
    if (opts.useChat) {
      trace = (await router.chat(c.request)).routerTrace
    }
    perCase.push(evaluateCase(c, decision.candidates, models as ModelProfile[], trace))
  }

  const metrics = computeMetrics(perCase, dataset.cases)
  const now = opts.now ?? Date.now
  return {
    runId: opts.runId ?? `run_${now()}_${Math.random().toString(36).slice(2, 8)}`,
    datasetId: dataset.datasetId,
    weightsVersion: opts.weightsVersion ?? "builtin",
    metrics,
    perCase,
    createdAt: new Date(now()).toISOString(),
  }
}
