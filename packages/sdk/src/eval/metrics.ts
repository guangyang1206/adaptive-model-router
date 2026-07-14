import type { CandidateModel, EvalCase, EvalCaseResult, ModelCapability, ModelProfile, RouteRequest, RouterTrace } from "../types.js"

/**
 * Representative latency (ms) for each latency class, used to check a case's
 * `maxLatencyMs` assertion against a model's coarse `latencyClass`. Deterministic
 * by construction (Spec §5.4).
 */
export const LATENCY_CLASS_MS: Record<"low" | "medium" | "high", number> = { low: 500, medium: 1500, high: 4000 }

/** Metrics the CI regression gate watches by default (Spec §2.3). */
export const CORE_METRIC_KEYS = ["routingAccuracy", "top1ExpectMatch", "capabilitySatisfaction", "costCompliance", "rankQuality"] as const

/**
 * Build the per-case result from a routing decision. Pure and deterministic:
 * same case + same candidates ⇒ same result. `trace` is only present in the
 * useChat path and feeds fallback/skip signals.
 */
export function evaluateCase(
  c: EvalCase,
  candidates: CandidateModel[],
  models: ModelProfile[],
  trace?: RouterTrace,
): EvalCaseResult {
  const chosen = candidates.find((candidate) => !candidate.skipped)
  const chosenModel = chosen?.modelId
  const profile = chosenModel ? models.find((m) => m.id === chosenModel) : undefined
  const expectedSatisfied: Record<string, boolean> = {}
  const expect = c.expect

  if (expect.anyOf !== undefined) {
    expectedSatisfied.anyOf = chosenModel !== undefined && expect.anyOf.includes(chosenModel)
  }
  if (expect.modelId !== undefined) {
    expectedSatisfied.modelId = chosenModel === expect.modelId
  }
  if (expect.maxCostUsd !== undefined) {
    expectedSatisfied.maxCostUsd = profile !== undefined && estimateCaseCost(profile, c.request) <= expect.maxCostUsd
  }
  if (expect.maxLatencyMs !== undefined) {
    const ms = profile ? LATENCY_CLASS_MS[normalizeLatencyClass(profile.latencyClass)] : Infinity
    expectedSatisfied.maxLatencyMs = ms <= expect.maxLatencyMs
  }
  if (expect.mustHaveCapabilities !== undefined) {
    expectedSatisfied.mustHaveCapabilities = profile !== undefined && expect.mustHaveCapabilities.every((cap: ModelCapability) => profile.capabilities.includes(cap))
  }
  if (expect.mustNotBeSkipped !== undefined) {
    expectedSatisfied.mustNotBeSkipped = expect.mustNotBeSkipped ? chosenModel !== undefined : true
  }

  const rankOfExpected = computeRankOfExpected(c, candidates)
  const fallbackTriggered = trace ? trace.status === "fallback_success" || trace.attempts.some((a) => a.status === "failed") : false

  return {
    caseId: c.id,
    chosenModel,
    expectedSatisfied,
    rankOfExpected,
    skipped: chosenModel === undefined,
    fallbackTriggered,
  }
}

/**
 * Aggregate per-case results into deterministic metrics. Ratios are in [0,1].
 * A metric whose denominator M is 0 is omitted (never written as 0) so it can't
 * pollute a baseline.
 */
export function computeMetrics(perCase: EvalCaseResult[], cases: EvalCase[]): Record<string, number> {
  const metrics: Record<string, number> = {}
  const byId = new Map(cases.map((c) => [c.id, c]))
  const N = perCase.length
  if (N === 0) return metrics

  // routingAccuracy: anyOf if present, else modelId. Denominator = all cases.
  let routingCorrect = 0
  let hasTargetCount = 0
  let rankSum = 0
  for (const result of perCase) {
    const expect = byId.get(result.caseId)?.expect
    if (!expect) continue
    const hasTarget = expect.anyOf !== undefined || expect.modelId !== undefined
    if (hasTarget) {
      hasTargetCount += 1
      const correct = expect.anyOf !== undefined ? result.expectedSatisfied.anyOf : result.expectedSatisfied.modelId
      if (correct) routingCorrect += 1
      rankSum += result.rankOfExpected === undefined ? 0 : 1 / (1 + result.rankOfExpected)
    }
  }
  metrics.routingAccuracy = routingCorrect / N

  ratioMetric(metrics, "top1ExpectMatch", perCase, "modelId")
  ratioMetric(metrics, "costCompliance", perCase, "maxCostUsd")
  ratioMetric(metrics, "latencyCompliance", perCase, "maxLatencyMs")
  ratioMetric(metrics, "capabilitySatisfaction", perCase, "mustHaveCapabilities")
  ratioMetric(metrics, "notSkippedCompliance", perCase, "mustNotBeSkipped")

  if (hasTargetCount > 0) metrics.rankQuality = rankSum / hasTargetCount

  // fallback/failure only meaningful in useChat mode (traces present).
  const withTrace = perCase.length
  const fallbackCount = perCase.filter((r) => r.fallbackTriggered).length
  if (fallbackCount > 0) metrics.fallbackRate = fallbackCount / withTrace

  return metrics
}

/** Count cases whose `expectedSatisfied` carries `key`, and how many passed. */
function ratioMetric(target: Record<string, number>, metricKey: string, perCase: EvalCaseResult[], assertionKey: string): void {
  let pass = 0
  let total = 0
  for (const result of perCase) {
    if (assertionKey in result.expectedSatisfied) {
      total += 1
      if (result.expectedSatisfied[assertionKey]) pass += 1
    }
  }
  if (total > 0) target[metricKey] = pass / total
}

function computeRankOfExpected(c: EvalCase, candidates: CandidateModel[]): number | undefined {
  const expectedId = c.expect.modelId ?? c.expect.anyOf?.[0]
  if (!expectedId) return undefined
  const index = candidates.findIndex((candidate) => candidate.modelId === expectedId)
  if (index < 0) return undefined
  if (candidates[index].skipped) return undefined
  return index
}

function normalizeLatencyClass(latencyClass: ModelProfile["latencyClass"]): "low" | "medium" | "high" {
  return latencyClass === "low" ? "low" : latencyClass === "medium" ? "medium" : "high"
}

/**
 * Cost estimate mirroring the SDK's runtime estimateCost (index.ts). Inlined
 * here rather than imported to avoid an index ↔ eval module cycle; the formula
 * is intentionally identical (4-char/token heuristic, +32 output tokens).
 */
export function estimateCaseCost(model: ModelProfile, request: RouteRequest, outputTokens = 32): number {
  const chars = request.messages.reduce((sum, m) => sum + m.content.length, 0)
  const inputTokens = Math.max(1, Math.ceil(chars / 4))
  const inputRate = model.cost?.inputPer1M ?? 0
  const outputRate = model.cost?.outputPer1M ?? inputRate
  return (inputTokens / 1_000_000) * inputRate + (outputTokens / 1_000_000) * outputRate
}
