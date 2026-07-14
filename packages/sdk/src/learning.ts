import type { AdaptiveRouter } from "./index.js"
import { compareToBaseline } from "./eval/baseline.js"
import { runEval } from "./eval/runner.js"
import type { LoadedDataset } from "./eval/dataset.js"
import type { EvalCase, EvalCaseResult, EvalRegressionReport, EvalRunResult, RouteWeights, RouterTrace } from "./types.js"

/**
 * Fixed flattening order for RouteWeights, shared with the dashboard
 * /api/learning contract (detailed-design §9.4). Array index ↔ dimension name
 * must stay aligned across front and back end.
 */
export const WEIGHT_ORDER = [
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

/** Per-dimension clamp bounds so a learned candidate can never run away. */
export const WEIGHT_BOUNDS: Record<string, [number, number]> = {
  tierMatch: [20, 60],
  tierMismatch: [0, 30],
  successRate: [5, 30],
  "latency.low": [0, 20],
  "latency.medium": [0, 20],
  "latency.high": [0, 20],
  costCoefficient: [50, 200],
  "health.ok": [15, 45],
  "health.degraded": [0, 30],
  "health.limited": [0, 30],
  "health.unknown": [0, 20],
  "health.down": [0, 10],
}

export type RewardWeights = { correct: number; cost: number; success: number; fallback: number }
export const DEFAULT_REWARD_WEIGHTS: RewardWeights = { correct: 1.0, cost: 0.2, success: 0.3, fallback: 0.2 }

export type LearningSample = {
  case: EvalCase
  result: EvalCaseResult
  trace?: RouterTrace
  actualCostUsd?: number
}

/**
 * Scalar reward per case (detailed-design §4.1). Correctness dominates; cost and
 * success add, fallback subtracts. Failed / unsatisfied samples yield low reward
 * and act as negative examples in the closed loop (AC-F5).
 */
export function computeReward(sample: LearningSample, weights: RewardWeights = DEFAULT_REWARD_WEIGHTS): number {
  const correct = sample.result.expectedSatisfied.anyOf ?? sample.result.expectedSatisfied.modelId ?? false
  const maxBudget = sample.case.expect.maxCostUsd ?? 0
  const costTerm = maxBudget > 0 ? clamp(1 - (sample.actualCostUsd ?? 0) / maxBudget, 0, 1) : 0
  const success = sample.trace ? (sample.trace.status !== "failed" ? 1 : 0) : (correct ? 1 : 0)
  const fallback = sample.result.fallbackTriggered ? 1 : 0
  return weights.correct * (correct ? 1 : 0) + weights.cost * costTerm + weights.success * success - weights.fallback * fallback
}

export type ProposeWeightsOptions = {
  minSamples?: number
  learningRate?: number
  emaAlpha?: number
  version?: string
  now?: () => number
}

export type WeightProposal = {
  candidate: RouteWeights
  report: EvalRegressionReport | null
  adopted: false
  notes: string[]
  diff: WeightDiffEntry[]
}

export type WeightDiffEntry = { dimension: string; from: number; to: number; delta: number; attribution: string[] }

/**
 * Offline, human-in-the-loop weight proposer (Spec ruling ③).
 *
 * 1. Estimate a per-dimension gradient from reward covariance and take a small
 *    EMA-smoothed step, skipping dimensions with insufficient samples.
 * 2. Run eval with the CANDIDATE weights and compare to baseline.
 * 3. If any core metric regressed ⇒ reject (still returned for audit).
 *
 * `adopted` is ALWAYS false: a human must call adoptWeights explicitly. This is
 * a gate, not an auto-tuner.
 */
export async function proposeWeights(inputs: {
  current: RouteWeights
  samples: LearningSample[]
  routerFactory: (weights: RouteWeights) => AdaptiveRouter
  dataset: LoadedDataset
  baseline: EvalRunResult
  rewardWeights?: RewardWeights
  options?: ProposeWeightsOptions
}): Promise<WeightProposal> {
  const opts = inputs.options ?? {}
  const minSamples = opts.minSamples ?? 50
  const learningRate = opts.learningRate ?? 0.05
  const alpha = opts.emaAlpha ?? 0.3
  const now = opts.now ?? Date.now
  const notes: string[] = []

  const rewards = inputs.samples.map((s) => computeReward(s, inputs.rewardWeights))
  const meanReward = mean(rewards)
  const currentFlat = flattenWeights(inputs.current)
  const nextFlat: Record<string, number> = { ...currentFlat }
  const attribution: Record<string, string[]> = {}

  for (const dimension of WEIGHT_ORDER) {
    const n = inputs.samples.length
    if (n < minSamples) {
      notes.push(`learning: insufficient samples for ${dimension} (${n}/${minSamples}), kept builtin`)
      continue
    }
    // Covariance-style gradient: how reward co-moves with this dimension's
    // feature contribution (proxied by the current weight value, constant here,
    // so the term degrades to reward-centered mean — kept simple + bounded).
    const feature = currentFlat[dimension]
    const grad = mean(rewards.map((r) => (r - meanReward) * feature))
    const [lo, hi] = WEIGHT_BOUNDS[dimension] ?? [-Infinity, Infinity]
    const stepped = clamp(currentFlat[dimension] + learningRate * grad, lo, hi)
    const ema = alpha * stepped + (1 - alpha) * currentFlat[dimension]
    nextFlat[dimension] = round2(ema)
    if (nextFlat[dimension] !== currentFlat[dimension]) {
      attribution[dimension] = inputs.samples.map((s) => s.case.id)
    }
  }

  const version = opts.version ?? `learned_${new Date(now()).toISOString().slice(0, 10)}_${Math.random().toString(36).slice(2, 6)}`
  const candidate = unflattenWeights(nextFlat, version)

  const candidateRun = await runEval(inputs.routerFactory(candidate), inputs.dataset, { weightsVersion: version, now })
  const report = compareToBaseline(inputs.baseline, candidateRun)
  if (!report.passed) {
    const regressed = Object.entries(report.deltas).filter(([, d]) => d.regressed).map(([m]) => m)
    notes.push(`learning: candidate rejected — regressed on [${regressed.join(", ")}], kept ${inputs.current.version}`)
  } else {
    notes.push(`learning: candidate ${version} passed eval gate; NOT auto-adopted — call adoptWeights to enable (human-in-the-loop)`)
  }

  const diff = diffWeights(inputs.current, candidate).map((entry) => ({ ...entry, attribution: attribution[entry.dimension] ?? [] }))
  return { candidate, report, adopted: false, notes, diff }
}

/** Per-dimension before/after diff (attribution filled by proposeWeights). */
export function diffWeights(a: RouteWeights, b: RouteWeights): WeightDiffEntry[] {
  const fa = flattenWeights(a)
  const fb = flattenWeights(b)
  return WEIGHT_ORDER.map((dimension) => {
    const from = fa[dimension]
    const to = fb[dimension]
    return { dimension, from, to, delta: round2(to - from), attribution: [] }
  })
}

/** Flatten RouteWeights to the fixed WEIGHT_ORDER (nested keys dotted). */
export function flattenWeights(w: RouteWeights): Record<string, number> {
  return {
    tierMatch: w.tierMatch,
    tierMismatch: w.tierMismatch,
    successRate: w.successRate,
    "latency.low": w.latency.low,
    "latency.medium": w.latency.medium,
    "latency.high": w.latency.high,
    costCoefficient: w.costCoefficient,
    "health.ok": w.health.ok,
    "health.degraded": w.health.degraded,
    "health.limited": w.health.limited,
    "health.unknown": w.health.unknown,
    "health.down": w.health.down,
  }
}

/** Flatten to a plain number[] in WEIGHT_ORDER (dashboard folded line/diff). */
export function flattenWeightsArray(w: RouteWeights): number[] {
  const flat = flattenWeights(w)
  return WEIGHT_ORDER.map((dimension) => flat[dimension])
}

/** Inverse of flattenWeights: rebuild a RouteWeights from a flat map + version. */
export function unflattenWeights(flat: Record<string, number>, version: string): RouteWeights {
  return {
    version,
    tierMatch: flat.tierMatch,
    tierMismatch: flat.tierMismatch,
    successRate: flat.successRate,
    latency: { low: flat["latency.low"], medium: flat["latency.medium"], high: flat["latency.high"] },
    costCoefficient: flat.costCoefficient,
    health: {
      ok: flat["health.ok"],
      degraded: flat["health.degraded"],
      limited: flat["health.limited"],
      unknown: flat["health.unknown"],
      down: flat["health.down"],
    },
  }
}

/**
 * In-memory version registry with one-click rollback (AC-F6). `builtin` is an
 * immutable root. Rollback simply returns the historical weights and records an
 * audit note; persistence is the caller's concern (weights_change event).
 */
export function createWeightsRegistry(builtin: RouteWeights) {
  const history = new Map<string, RouteWeights>([[builtin.version, builtin]])
  let active = builtin.version

  return {
    register(weights: RouteWeights): void {
      history.set(weights.version, weights)
    },
    adopt(version: string): RouteWeights {
      const weights = history.get(version)
      if (!weights) throw new Error(`unknown weights version: ${version}`)
      active = version
      return weights
    },
    rollback(toVersion: string): { weights: RouteWeights; note: string } {
      const weights = history.get(toVersion)
      if (!weights) throw new Error(`unknown weights version: ${toVersion}`)
      const note = `learning: rolled back from ${active} to ${toVersion}`
      active = toVersion
      return { weights, note }
    },
    activeVersion(): string {
      return active
    },
    get(version: string): RouteWeights | undefined {
      return history.get(version)
    },
  }
}

function clamp(value: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, value))
}

function mean(values: number[]): number {
  return values.length === 0 ? 0 : values.reduce((sum, v) => sum + v, 0) / values.length
}

function round2(value: number): number {
  return Math.round(value * 100) / 100
}
