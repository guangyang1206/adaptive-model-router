import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import process from "node:process"
import {
  createRouter,
  createStaticProvider,
  formatRegressionReport,
  gateAgainstBaseline,
  loadDataset,
  runEval,
  saveBaseline,
  createJsonlTraceStore,
  createSQLiteTraceStore,
  type EvalCase,
  type EvalRunResult,
  type ModelProfile,
  type RoutePolicy,
} from "@adaptive-router/sdk"

/**
 * A CLI eval dataset file is either a bare array of EvalCase, or an object that
 * also carries the model catalog + policy the router should score against. The
 * runner never calls a real provider (mock providers only), so eval is free.
 */
type DatasetFile = EvalCase[] | { models?: ModelProfile[]; policy?: RoutePolicy; cases: EvalCase[] }

type EvalStoreLike = {
  writeEvalRun(run: EvalRunResult): Promise<void> | void
  getEvalRun(runId: string): Promise<EvalRunResult | undefined> | (EvalRunResult | undefined)
  saveBaselinePointer(datasetId: string, runId: string): Promise<void> | void
  getBaselineRunId(datasetId: string): Promise<string | undefined> | (string | undefined)
  listEvalRuns?(datasetId?: string): Promise<EvalRunResult[]> | EvalRunResult[]
}

export type EvalCliDeps = {
  cwd: string
  sqlitePath: string
  jsonlFallbackPath: string
  getArg(name: string): string | undefined
  hasFlag(name: string): boolean
}

/** `adaptive-router eval <dataset> [--baseline] [--out <path>]` */
export async function runEvalCommand(datasetPath: string | undefined, deps: EvalCliDeps): Promise<void> {
  if (!datasetPath) throw new Error("usage: adaptive-router eval <dataset.json> [--baseline]")
  const { cases, models, policy } = readDatasetFile(resolve(deps.cwd, datasetPath))
  const dataset = await loadDataset(cases)
  const router = createRouter({ providers: buildMockProviders(models), models, policy })
  const run = await runEval(router, dataset)

  const store = await openStore(deps)
  await store.writeEvalRun(run)

  printRun(run)

  if (deps.hasFlag("--baseline")) {
    const baseline = await loadBaselineRun(store, run.datasetId)
    const gate = gateAgainstBaseline(baseline, run, { thresholds: parseThresholds(deps.getArg("--threshold")) })
    for (const note of gate.notes) console.log(note)
    if (baseline && gate.report) {
      console.log(formatRegressionReport(gate.report, baseline, run))
    }
    if (!gate.passed) {
      console.error("Eval regression gate FAILED: a core metric dropped below baseline.")
      process.exitCode = 1
    } else {
      console.log("Eval regression gate passed.")
    }
  }
}

/** `adaptive-router eval:baseline save <dataset>` */
export async function runEvalBaselineCommand(sub: string | undefined, datasetPath: string | undefined, deps: EvalCliDeps): Promise<void> {
  if (sub !== "save") throw new Error("usage: adaptive-router eval:baseline save <dataset.json>")
  if (!datasetPath) throw new Error("usage: adaptive-router eval:baseline save <dataset.json>")
  const { cases, models, policy } = readDatasetFile(resolve(deps.cwd, datasetPath))
  const dataset = await loadDataset(cases)
  const router = createRouter({ providers: buildMockProviders(models), models, policy })
  const run = await runEval(router, dataset)

  const store = await openStore(deps)
  await saveBaseline(store as never, run)
  printRun(run)
  console.log(`Saved baseline ${run.runId} for dataset ${run.datasetId}.`)
}

function readDatasetFile(path: string): { cases: EvalCase[]; models: ModelProfile[]; policy?: RoutePolicy } {
  const parsed = JSON.parse(readFileSync(path, "utf8")) as DatasetFile
  if (Array.isArray(parsed)) {
    return { cases: parsed, models: inferModelsFromCases(parsed) }
  }
  const models = parsed.models ?? inferModelsFromCases(parsed.cases)
  return { cases: parsed.cases, models, policy: parsed.policy }
}

/**
 * When a dataset omits an explicit model catalog, synthesize minimal balanced
 * profiles from every model id referenced in expectations so routing has
 * candidates. Real catalogs should be provided for meaningful cost/latency
 * assertions; this keeps a bare case list runnable.
 */
function inferModelsFromCases(cases: EvalCase[]): ModelProfile[] {
  const ids = new Set<string>()
  for (const c of cases) {
    if (c.expect.modelId) ids.add(c.expect.modelId)
    for (const id of c.expect.anyOf ?? []) ids.add(id)
  }
  return [...ids].map((id) => ({
    id,
    provider: id.split("/")[0] || "mock",
    model: id.split("/")[1] || id,
    type: "open-source",
    kind: "openai-compatible",
    capabilities: ["reasoning", "tool-calling", "json-mode", "streaming"],
    tier: "balanced",
    contextWindow: 128000,
    enabled: true,
    latencyClass: "medium",
    cost: { inputPer1M: 0, outputPer1M: 0, estimated: true },
    health: { status: "ok", successRate: 1 },
  }))
}

function buildMockProviders(models: ModelProfile[]) {
  const byProvider = new Map<string, ModelProfile[]>()
  for (const model of models) {
    const list = byProvider.get(model.provider) ?? []
    list.push(model)
    byProvider.set(model.provider, list)
  }
  return [...byProvider.entries()].map(([id, list]) => createStaticProvider(id, list))
}

async function openStore(deps: EvalCliDeps): Promise<EvalStoreLike> {
  const store = await createSQLiteTraceStore({
    path: resolve(deps.cwd, deps.sqlitePath),
    fallbackPath: resolve(deps.cwd, deps.jsonlFallbackPath),
  }).catch(() => createJsonlTraceStore({ path: resolve(deps.cwd, deps.jsonlFallbackPath) }))
  return store as unknown as EvalStoreLike
}

async function loadBaselineRun(store: EvalStoreLike, datasetId: string): Promise<EvalRunResult | undefined> {
  const runId = await store.getBaselineRunId(datasetId)
  if (!runId) return undefined
  return store.getEvalRun(runId)
}

function parseThresholds(raw: string | undefined): Record<string, number> | undefined {
  if (!raw) return undefined
  const out: Record<string, number> = {}
  for (const pair of raw.split(",")) {
    const [key, value] = pair.split("=")
    if (key && value && Number.isFinite(Number(value))) out[key.trim()] = Number(value)
  }
  return out
}

function printRun(run: EvalRunResult): void {
  console.log(`Run ${run.runId} — dataset ${run.datasetId} — weights ${run.weightsVersion} — ${run.perCase.length} cases`)
  const keys = Object.keys(run.metrics).sort()
  for (const key of keys) console.log(`  ${key}: ${run.metrics[key].toFixed(4)}`)
  if (keys.length === 0) console.log("  (no metrics — dataset had no scorable assertions)")
}
