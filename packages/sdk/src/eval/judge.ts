import type { EvalCase, ProviderResponse } from "../types.js"

/**
 * Optional LLM-as-judge plugin (Spec ruling ①: P2, opt-in, NOT the default
 * path). The default eval pipeline is fully deterministic and makes zero LLM
 * calls / uses zero optional dependencies. A judge, when injected, scores text
 * quality; its output is reported as a `similarity`-class metric and is
 * explicitly excluded from the core CI gate to keep baselines reproducible.
 */
export type JudgePlugin = {
  id: string
  /** Score a produced response against a case in [0,1]. */
  score(input: { case: EvalCase; response: ProviderResponse }): Promise<number>
}
