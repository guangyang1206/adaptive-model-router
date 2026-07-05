import { compareToBaseline } from "./eval/baseline.js"
import { BUILTIN_WEIGHTS } from "./index.js"
import { WEIGHT_ORDER, diffWeights, flattenWeights, flattenWeightsArray } from "./learning.js"
import { DEFAULT_CACHE_THRESHOLD } from "./cache.js"
import type { CacheLookupRecord, Mvp2StoreExtension } from "./storage.js"
import type { EvalCaseResult, EvalRegressionReport, EvalRunResult, RouteWeights } from "./types.js"
import type { WeightDiffEntry } from "./learning.js"

/**
 * Read-only dashboard aggregators (detailed-design §9). These compose the
 * `Mvp2StoreExtension` primitives (already shipped in storage.ts) into the
 * exact response shapes the `/api/evals`, `/api/evals/:runId`, `/api/cache`,
 * and `/api/learning` endpoints render, so the dashboard can drop its mocks.
 *
 * Every reader is defensive: a store that omits an optional primitive, or a
 * brand-new store with no rows, yields a structurally-complete empty state
 * (never `undefined`, never a throw). Nothing here mutates state or touches the
 * routing/scoring hot path — it is purely a view layer over persisted events.
 */

/** All readers accept any store; each primitive is optional and guarded. */
export type DashboardStore = Mvp2StoreExtension

/** §9.2 per-case row for the run-detail drawer. */
export type EvalRunDetailCase = {
  id: string
  expectedModel?: string
  expectedAnyOf?: string[]
  chosenModel?: string
  rankOfExpected?: number
  skipped: boolean
  fallbackTriggered: boolean
  assertions: Array<{ key: string; passed: boolean }>
}

/** §9.2 `GET /api/evals/:runId` response `data`. */
export type EvalRunDetailData = {
  run: Pick<EvalRunResult, "runId" | "datasetId" | "weightsVersion" | "createdAt" | "metrics">
  cases: EvalRunDetailCase[]
  regression: EvalRegressionReport | null
}

/** §9.3 `GET /api/cache` response `data`. */
export type CacheOverviewData = {
  hits: number
  misses: number
  total: number
  hitRate: number
  mode: string
  donut: { hits: number; misses: number; degradedFallbacks: number }
  hitQualityLog: Array<{
    query: string
    topMatchQuery: string | null
    similarity: number | null
    result: "hit" | "miss"
    source: "exact" | "semantic" | null
    embeddingProviderId: string
    ttlMs: number | null
    createdAt: string
  }>
}

/** §9.4 `GET /api/learning` response `data`. */
export type LearningOverviewData = {
  activeWeightsVersion: string
  proposedChangeCount: number
  evalDelta: EvalRegressionReport | null
  gateStatus: "passed" | "blocked" | "none"
  baselineWeights: number[]
  proposedWeights: number[] | null
  weightDiff: Array<{ dimension: string; from: number; to: number; delta: number; attribution: string[] }>
}

/** Invoke an optional store primitive, falling back on absence or throw. */
async function safeCall<T>(fn: (() => Promise<T> | T) | undefined, fallback: T): Promise<T> {
  if (typeof fn !== "function") return fallback
  try {
    return await fn()
  } catch {
    return fallback
  }
}

/** Newest-first by createdAt (ISO strings sort lexicographically). */
function byCreatedAtDesc(a: EvalRunResult, b: EvalRunResult): number {
  return a.createdAt < b.createdAt ? 1 : a.createdAt > b.createdAt ? -1 : 0
}

/**
 * §9.1 runs list — the stored `EvalRunResult`s, newest first, optionally
 * truncated. The full `metrics` object is forwarded verbatim (canonical §9.0
 * keys); the front end reads the four it renders.
 */
export async function listEvalRuns(store: DashboardStore, limit?: number): Promise<EvalRunResult[]> {
  const runs = (await safeCall(store.listEvalRuns?.bind(store), [] as EvalRunResult[])).slice().sort(byCreatedAtDesc)
  return typeof limit === "number" ? runs.slice(0, Math.max(0, limit)) : runs
}

/**
 * §9.1 `latestRegression` — the newest run compared to its dataset baseline.
 * Returns null when there is no baseline, the baseline run can't be loaded, or
 * the newest run *is* the baseline (self-comparison is meaningless).
 */
export async function getLatestRegression(store: DashboardStore): Promise<EvalRegressionReport | null> {
  const [latest] = await listEvalRuns(store, 1)
  if (!latest) return null
  const baselineRunId = await safeCall<string | undefined>(
    store.getBaselineRunId ? () => store.getBaselineRunId!(latest.datasetId) : undefined,
    undefined,
  )
  if (!baselineRunId || baselineRunId === latest.runId) return null
  const baseline = await safeCall<EvalRunResult | undefined>(
    store.getEvalRun ? () => store.getEvalRun!(baselineRunId) : undefined,
    undefined,
  )
  if (!baseline) return null
  return compareToBaseline(baseline, latest)
}

/**
 * §9.2 single-run detail. Assertions are the flattened `expectedSatisfied`
 * map. `expectedModel`/`expectedAnyOf` come from the dataset's `expect`, which
 * is NOT persisted in `EvalRunResult`; they are left undefined (both optional
 * in the contract). `regression` compares the run to its dataset baseline when
 * one exists and differs from the run itself.
 */
export async function getEvalRun(store: DashboardStore, runId: string): Promise<EvalRunDetailData | null> {
  const run = await safeCall<EvalRunResult | undefined>(
    store.getEvalRun ? () => store.getEvalRun!(runId) : undefined,
    undefined,
  )
  if (!run) return null

  const cases: EvalRunDetailCase[] = run.perCase.map((result: EvalCaseResult) => ({
    id: result.caseId,
    chosenModel: result.chosenModel,
    rankOfExpected: result.rankOfExpected,
    skipped: result.skipped,
    fallbackTriggered: result.fallbackTriggered,
    assertions: Object.entries(result.expectedSatisfied).map(([key, passed]) => ({ key, passed })),
  }))

  let regression: EvalRegressionReport | null = null
  const baselineRunId = await safeCall<string | undefined>(
    store.getBaselineRunId ? () => store.getBaselineRunId!(run.datasetId) : undefined,
    undefined,
  )
  if (baselineRunId && baselineRunId !== run.runId) {
    const baseline = await safeCall<EvalRunResult | undefined>(
      store.getEvalRun ? () => store.getEvalRun!(baselineRunId) : undefined,
      undefined,
    )
    if (baseline) regression = compareToBaseline(baseline, run)
  }

  return {
    run: {
      runId: run.runId,
      datasetId: run.datasetId,
      weightsVersion: run.weightsVersion,
      createdAt: run.createdAt,
      metrics: run.metrics,
    },
    cases,
    regression,
  }
}

/**
 * §9.3 cache overview. Aggregates the hit-quality log into hits/misses/hitRate
 * and the three-segment donut. `mode` is inferred from the persisted lookups:
 * any `semantic`-sourced hit ⇒ `semantic@<threshold>`, else `exact`. The stored
 * `CacheLookupRecord` carries neither the raw query text, the entry TTL, nor a
 * degraded flag, so `query` falls back to the lookup key, `ttlMs` is null, and
 * `degradedFallbacks` is 0 (see the note sent to team-lead).
 */
export async function getCacheStats(store: DashboardStore): Promise<CacheOverviewData> {
  const lookups = await safeCall(
    store.listCacheLookups ? () => store.listCacheLookups!(50) : undefined,
    [] as CacheLookupRecord[],
  )
  const hits = lookups.filter((l) => l.hit).length
  const total = lookups.length
  const misses = total - hits
  const hitRate = total === 0 ? 0 : hits / total
  const usedSemantic = lookups.some((l) => l.source === "semantic")
  const mode = usedSemantic ? `semantic@${DEFAULT_CACHE_THRESHOLD}` : "exact"

  return {
    hits,
    misses,
    total,
    hitRate,
    mode,
    donut: { hits, misses, degradedFallbacks: 0 },
    hitQualityLog: lookups.map((l) => ({
      query: l.key,
      topMatchQuery: l.topMatchQuery,
      similarity: l.similarity,
      result: l.hit ? "hit" : "miss",
      source: l.source,
      embeddingProviderId: l.embeddingProviderId,
      ttlMs: null,
      createdAt: l.createdAt,
    })),
  }
}

/** Recover a RouteWeights from a loosely-typed weights_change payload field. */
function asRouteWeights(value: unknown): RouteWeights | undefined {
  if (!value || typeof value !== "object") return undefined
  const w = value as Partial<RouteWeights>
  if (typeof w.tierMatch !== "number" || !w.latency || !w.health) return undefined
  return value as RouteWeights
}

/**
 * §9.4 learning overview. Reads the newest `weights_change` event as the
 * current learning state and folds both weight vectors into the fixed 12-dim
 * `WEIGHT_ORDER` (nested keys dotted). With no events, returns a complete empty
 * state: active `builtin`, baseline = flattened `BUILTIN_WEIGHTS`, no proposal,
 * `gateStatus: "none"`, and a zero-delta `weightDiff` (to = from).
 *
 * The payload schema is intentionally permissive (§ storage writes it as an
 * opaque `Record<string, unknown>`); we look for `proposedWeights`/`candidate`,
 * `baselineWeights`/`current`, `evalDelta`/`report`, and `diff`, and degrade
 * gracefully to builtin when any are absent.
 */
export async function getLearningState(store: DashboardStore): Promise<LearningOverviewData> {
  const changes = await safeCall(store.listWeightsChanges?.bind(store), [] as Record<string, unknown>[])
  const latest = changes.at(-1)

  const baseline = latest ? (asRouteWeights(latest.baselineWeights) ?? asRouteWeights(latest.current) ?? BUILTIN_WEIGHTS) : BUILTIN_WEIGHTS
  const proposed = latest ? (asRouteWeights(latest.proposedWeights) ?? asRouteWeights(latest.candidate)) : undefined

  const activeWeightsVersion =
    (typeof latest?.activeVersion === "string" && latest.activeVersion) ||
    (typeof latest?.to === "string" && latest.to) ||
    baseline.version

  const baselineWeights = flattenWeightsArray(baseline)

  if (!proposed) {
    const from = flattenWeights(baseline)
    return {
      activeWeightsVersion,
      proposedChangeCount: 0,
      evalDelta: null,
      gateStatus: "none",
      baselineWeights,
      proposedWeights: null,
      weightDiff: WEIGHT_ORDER.map((dimension) => ({ dimension, from: from[dimension], to: from[dimension], delta: 0, attribution: [] })),
    }
  }

  const suppliedDiff = Array.isArray(latest?.diff) ? (latest!.diff as WeightDiffEntry[]) : undefined
  const attributionByDim = new Map<string, string[]>(
    (suppliedDiff ?? []).map((d) => [d.dimension, Array.isArray(d.attribution) ? d.attribution : []]),
  )
  const weightDiff = diffWeights(baseline, proposed).map((entry) => ({
    ...entry,
    attribution: attributionByDim.get(entry.dimension) ?? [],
  }))
  const proposedChangeCount = weightDiff.filter((d) => d.delta !== 0).length

  const evalDelta =
    (latest && (latest.evalDelta as EvalRegressionReport | null | undefined)) ??
    (latest && (latest.report as EvalRegressionReport | null | undefined)) ??
    null
  const gateStatus: LearningOverviewData["gateStatus"] = evalDelta ? (evalDelta.passed ? "passed" : "blocked") : "none"

  return {
    activeWeightsVersion,
    proposedChangeCount,
    evalDelta,
    gateStatus,
    baselineWeights,
    proposedWeights: flattenWeightsArray(proposed),
    weightDiff,
  }
}
