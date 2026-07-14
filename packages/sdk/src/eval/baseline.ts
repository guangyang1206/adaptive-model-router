import type { EvalRegressionReport, EvalRunResult } from "../types.js"
import { CORE_METRIC_KEYS } from "./metrics.js"

/**
 * Minimal store surface baseline needs. The SDK's TraceStore can implement
 * these; kept structural so tests can pass a plain object.
 */
export type EvalStore = {
  writeEvalRun(run: EvalRunResult): Promise<void> | void
  getEvalRun(runId: string): Promise<EvalRunResult | undefined> | (EvalRunResult | undefined)
  saveBaselinePointer(datasetId: string, runId: string): Promise<void> | void
  getBaselineRunId(datasetId: string): Promise<string | undefined> | (string | undefined)
}

export type CompareOptions = {
  /** Per-metric regression tolerance (allowed drop). */
  thresholds?: Record<string, number>
  /** Default allowed drop for metrics without an explicit threshold. 0 = any drop regresses. */
  defaultThreshold?: number
}

/** Persist a run and point the dataset's baseline at it. */
export async function saveBaseline(store: EvalStore, run: EvalRunResult): Promise<void> {
  await store.writeEvalRun(run)
  await store.saveBaselinePointer(run.datasetId, run.runId)
}

/** Load the current baseline run for a dataset, if any. */
export async function loadBaseline(store: EvalStore, datasetId: string): Promise<EvalRunResult | undefined> {
  const runId = await store.getBaselineRunId(datasetId)
  if (!runId) return undefined
  return store.getEvalRun(runId)
}

/**
 * Compare a current run to a baseline over the intersection of core metrics.
 * A metric regresses when its drop exceeds the (per-metric or default)
 * threshold. `passed` is true iff nothing regressed.
 */
export function compareToBaseline(
  baseline: EvalRunResult,
  current: EvalRunResult,
  opts: CompareOptions = {},
): EvalRegressionReport {
  const defaultThreshold = opts.defaultThreshold ?? 0
  const deltas: EvalRegressionReport["deltas"] = {}
  for (const metric of CORE_METRIC_KEYS) {
    const baseValue = baseline.metrics[metric]
    const currentValue = current.metrics[metric]
    if (baseValue === undefined || currentValue === undefined) continue
    const delta = currentValue - baseValue
    const threshold = opts.thresholds?.[metric] ?? defaultThreshold
    deltas[metric] = { baseline: baseValue, current: currentValue, delta, regressed: delta < -threshold }
  }
  const passed = Object.values(deltas).every((d) => !d.regressed)
  return { baselineRunId: baseline.runId, currentRunId: current.runId, deltas, passed }
}

/**
 * Regression gate against a possibly-absent baseline. First run for a dataset
 * ⇒ pass + explicit note (never silent, never fail). Returns the report (or
 * null when no baseline) plus notes.
 */
export function gateAgainstBaseline(
  baseline: EvalRunResult | undefined,
  current: EvalRunResult,
  opts: CompareOptions = {},
): { report: EvalRegressionReport | null; passed: boolean; notes: string[] } {
  if (!baseline) {
    return {
      report: null,
      passed: true,
      notes: [`no baseline for dataset ${current.datasetId}, treating as pass; run eval:baseline save to establish`],
    }
  }
  const report = compareToBaseline(baseline, current, opts)
  return { report, passed: report.passed, notes: [] }
}

/**
 * Human-readable regression diff for PRs: per-metric deltas plus the set of
 * cases that flipped from pass→fail between the two runs.
 */
export function formatRegressionReport(report: EvalRegressionReport, baseline: EvalRunResult, current: EvalRunResult): string {
  const lines: string[] = []
  lines.push(`Regression: ${report.passed ? "PASS" : "FAIL"} (baseline ${report.baselineRunId} → current ${report.currentRunId})`)
  for (const [metric, d] of Object.entries(report.deltas)) {
    const arrow = d.delta > 0 ? "▲" : d.delta < 0 ? "▼" : "="
    lines.push(`  ${d.regressed ? "REGRESSED" : "ok"} ${metric}: ${d.baseline.toFixed(4)} → ${d.current.toFixed(4)} (${arrow}${d.delta.toFixed(4)})`)
  }
  const flipped = casesFlippedToFail(baseline, current)
  if (flipped.length > 0) lines.push(`  cases now failing (were passing): ${flipped.join(", ")}`)
  return lines.join("\n")
}

function caseAllSatisfied(satisfied: Record<string, boolean>): boolean {
  const values = Object.values(satisfied)
  return values.length > 0 && values.every(Boolean)
}

function casesFlippedToFail(baseline: EvalRunResult, current: EvalRunResult): string[] {
  const basePass = new Map(baseline.perCase.map((r) => [r.caseId, caseAllSatisfied(r.expectedSatisfied)]))
  const flipped: string[] = []
  for (const result of current.perCase) {
    const wasPass = basePass.get(result.caseId)
    if (wasPass === true && !caseAllSatisfied(result.expectedSatisfied)) flipped.push(result.caseId)
  }
  return flipped
}
