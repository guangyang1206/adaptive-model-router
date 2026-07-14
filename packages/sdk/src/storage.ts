import { appendFile, mkdir, readFile } from "node:fs/promises"
import { dirname } from "node:path"
import type {
  EvalRunResult,
  RouterTrace,
  SemanticCacheEntry,
  StoredRequest,
  TraceStoreReader,
  TraceStoreSummary,
} from "./types.js"

export const storageSchemaVersion = "1.0"

export const sqliteSchema = [
  `CREATE TABLE IF NOT EXISTS requests (
    trace_id TEXT PRIMARY KEY,
    decision_id TEXT NOT NULL,
    status TEXT NOT NULL,
    chosen_model TEXT,
    reason TEXT NOT NULL,
    latency_ms INTEGER,
    estimated INTEGER NOT NULL,
    estimated_cost_usd REAL,
    input_tokens INTEGER,
    output_tokens INTEGER,
    total_tokens INTEGER,
    created_at TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS routing_decisions (
    decision_id TEXT PRIMARY KEY,
    trace_id TEXT NOT NULL,
    candidates_json TEXT NOT NULL,
    reason TEXT NOT NULL,
    FOREIGN KEY(trace_id) REFERENCES requests(trace_id)
  )`,
  `CREATE TABLE IF NOT EXISTS provider_calls (
    id TEXT PRIMARY KEY,
    trace_id TEXT NOT NULL,
    attempt_no INTEGER NOT NULL,
    provider TEXT NOT NULL,
    model_id TEXT NOT NULL,
    status TEXT NOT NULL,
    error_code TEXT,
    latency_ms INTEGER,
    FOREIGN KEY(trace_id) REFERENCES requests(trace_id)
  )`,
  `CREATE TABLE IF NOT EXISTS model_profiles (
    id TEXT PRIMARY KEY,
    provider TEXT NOT NULL,
    profile_json TEXT NOT NULL,
    updated_at TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS provider_health_snapshots (
    id TEXT PRIMARY KEY,
    model_id TEXT NOT NULL,
    status TEXT NOT NULL,
    payload_json TEXT NOT NULL,
    created_at TEXT NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS idx_requests_created_at ON requests(created_at)`,
  `CREATE INDEX IF NOT EXISTS idx_requests_status ON requests(status)`,
  `CREATE INDEX IF NOT EXISTS idx_provider_calls_trace_id ON provider_calls(trace_id)`,
  `CREATE INDEX IF NOT EXISTS idx_provider_calls_provider ON provider_calls(provider)`,
  `CREATE INDEX IF NOT EXISTS idx_provider_calls_model_id ON provider_calls(model_id)`,
  // --- MVP-2 tables (append-only schema evolution; no new dependency) -------
  `CREATE TABLE IF NOT EXISTS semantic_cache (
    key TEXT PRIMARY KEY,
    embedding TEXT,
    embedding_provider_id TEXT NOT NULL,
    tenant_scope TEXT NOT NULL DEFAULT 'default',
    request_json TEXT NOT NULL,
    response_json TEXT NOT NULL,
    router_trace_json TEXT NOT NULL,
    created_at TEXT NOT NULL,
    ttl_ms INTEGER
  )`,
  `CREATE INDEX IF NOT EXISTS idx_semantic_cache_scope_provider ON semantic_cache(tenant_scope, embedding_provider_id)`,
  `CREATE INDEX IF NOT EXISTS idx_semantic_cache_created_at ON semantic_cache(created_at)`,
  `CREATE TABLE IF NOT EXISTS eval_runs (
    run_id TEXT PRIMARY KEY,
    dataset_id TEXT NOT NULL,
    weights_version TEXT NOT NULL,
    metrics_json TEXT NOT NULL,
    per_case_json TEXT NOT NULL,
    created_at TEXT NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS idx_eval_runs_dataset ON eval_runs(dataset_id)`,
  `CREATE TABLE IF NOT EXISTS eval_baselines (
    dataset_id TEXT PRIMARY KEY,
    baseline_run_id TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    FOREIGN KEY(baseline_run_id) REFERENCES eval_runs(run_id)
  )`,
] as const

export type JsonlTraceStoreOptions = {
  path: string
}

export type SQLiteTraceStoreOptions = {
  path: string
  fallbackPath?: string
}

type JsonlEvent = {
  event_type: "request_finished"
  schema_version: string
  request_id: string
  decision_id: string
  timestamp: string
  payload: RouterTrace
}

/**
 * MVP-2 hit-quality log row (mirrors cache.ts CacheLookupEvent, redeclared here
 * to keep storage free of a runtime import cycle with cache.ts).
 */
export type CacheLookupRecord = {
  key: string
  query: string
  topMatchQuery: string | null
  similarity: number | null
  hit: boolean
  source: "exact" | "semantic" | null
  degraded: boolean
  embeddingProviderId: string
  createdAt: string
}

/** MVP-2 JSONL events appended alongside request_finished (§5 detailed design). */
type Mvp2JsonlEvent =
  | { event_type: "semantic_cache_set"; schema_version: string; timestamp: string; tenant_scope: string; payload: SemanticCacheEntry }
  | { event_type: "cache_lookup"; schema_version: string; timestamp: string; payload: CacheLookupRecord }
  | { event_type: "eval_run_finished"; schema_version: string; timestamp: string; payload: EvalRunResult }
  | { event_type: "eval_baseline_saved"; schema_version: string; timestamp: string; payload: { datasetId: string; baselineRunId: string } }
  | { event_type: "weights_change"; schema_version: string; timestamp: string; payload: Record<string, unknown> }

/**
 * Read-only accessors for MVP-2 data used by the dashboard /api/* endpoints and
 * the CLI eval commands. Optional so existing stores stay valid; the JSONL and
 * SQLite stores below implement them.
 */
export type Mvp2StoreExtension = {
  writeEvalRun?(run: EvalRunResult): Promise<void> | void
  getEvalRun?(runId: string): Promise<EvalRunResult | undefined> | (EvalRunResult | undefined)
  listEvalRuns?(datasetId?: string): Promise<EvalRunResult[]> | EvalRunResult[]
  saveBaselinePointer?(datasetId: string, runId: string): Promise<void> | void
  getBaselineRunId?(datasetId: string): Promise<string | undefined> | (string | undefined)
  writeCacheEntry?(entry: SemanticCacheEntry, tenantScope: string): Promise<void> | void
  writeCacheLookup?(event: CacheLookupRecord): Promise<void> | void
  listCacheLookups?(limit?: number): Promise<CacheLookupRecord[]> | CacheLookupRecord[]
  listCacheEntries?(): Promise<SemanticCacheEntry[]> | SemanticCacheEntry[]
  writeWeightsChange?(payload: Record<string, unknown>): Promise<void> | void
  listWeightsChanges?(): Promise<Record<string, unknown>[]> | Record<string, unknown>[]
}

export type ExtendedTraceStore = TraceStoreReader & Mvp2StoreExtension

export function createJsonlTraceStore(options: JsonlTraceStoreOptions): ExtendedTraceStore {
  async function appendEvent(event: Mvp2JsonlEvent): Promise<void> {
    await ensureParentDir(options.path)
    await appendFile(options.path, `${JSON.stringify(event)}\n`, { encoding: "utf8" })
  }
  async function readRawEvents(): Promise<Record<string, unknown>[]> {
    try {
      const content = await readFile(options.path, { encoding: "utf8" })
      return content.split("\n").filter(Boolean).map((line) => JSON.parse(line) as Record<string, unknown>)
    } catch {
      return []
    }
  }
  return {
    async writeTrace(trace) {
      await ensureParentDir(options.path)
      const event: JsonlEvent = {
        event_type: "request_finished",
        schema_version: storageSchemaVersion,
        request_id: trace.traceId,
        decision_id: trace.decisionId,
        timestamp: new Date().toISOString(),
        payload: trace,
      }
      await appendFile(options.path, `${JSON.stringify(event)}\n`, { encoding: "utf8" })
    },
    async listTraces() {
      return readJsonlTraces(options.path)
    },
    async getSummary() {
      return summarizeTraces(await readJsonlTraces(options.path))
    },
    async listRequests() {
      return tracesToRequests(await readJsonlTraces(options.path))
    },
    async getRequest(traceId) {
      return tracesToRequests(await readJsonlTraces(options.path)).find((request) => request.traceId === traceId)
    },
    // --- MVP-2 append-only events -----------------------------------------
    async writeEvalRun(run) {
      await appendEvent({ event_type: "eval_run_finished", schema_version: storageSchemaVersion, timestamp: new Date().toISOString(), payload: run })
    },
    async getEvalRun(runId) {
      return (await this.listEvalRuns!()).find((run) => run.runId === runId)
    },
    async listEvalRuns(datasetId) {
      const runs = (await readRawEvents())
        .filter((e) => e.event_type === "eval_run_finished")
        .map((e) => e.payload as EvalRunResult)
      return datasetId ? runs.filter((run) => run.datasetId === datasetId) : runs
    },
    async saveBaselinePointer(datasetId, runId) {
      await appendEvent({ event_type: "eval_baseline_saved", schema_version: storageSchemaVersion, timestamp: new Date().toISOString(), payload: { datasetId, baselineRunId: runId } })
    },
    async getBaselineRunId(datasetId) {
      const pointers = (await readRawEvents())
        .filter((e) => e.event_type === "eval_baseline_saved")
        .map((e) => e.payload as { datasetId: string; baselineRunId: string })
        .filter((p) => p.datasetId === datasetId)
      return pointers.at(-1)?.baselineRunId
    },
    async writeCacheEntry(entry, tenantScope) {
      await appendEvent({ event_type: "semantic_cache_set", schema_version: storageSchemaVersion, timestamp: new Date().toISOString(), tenant_scope: tenantScope, payload: entry })
    },
    async writeCacheLookup(event) {
      await appendEvent({ event_type: "cache_lookup", schema_version: storageSchemaVersion, timestamp: new Date().toISOString(), payload: event })
    },
    async listCacheLookups(limit) {
      const rows = (await readRawEvents())
        .filter((e) => e.event_type === "cache_lookup")
        .map((e) => e.payload as CacheLookupRecord)
        .reverse()
      return limit ? rows.slice(0, limit) : rows
    },
    async listCacheEntries() {
      return (await readRawEvents())
        .filter((e) => e.event_type === "semantic_cache_set")
        .map((e) => e.payload as SemanticCacheEntry)
    },
    async writeWeightsChange(payload) {
      await appendEvent({ event_type: "weights_change", schema_version: storageSchemaVersion, timestamp: new Date().toISOString(), payload })
    },
    async listWeightsChanges() {
      return (await readRawEvents())
        .filter((e) => e.event_type === "weights_change")
        .map((e) => e.payload as Record<string, unknown>)
    },
  }
}

export async function createSQLiteTraceStore(options: SQLiteTraceStoreOptions): Promise<ExtendedTraceStore> {
  try {
    const moduleLoader = Function("return import('node:sqlite')") as () => Promise<{ DatabaseSync: new (path: string) => SQLiteDatabase }>
    const sqlite = await moduleLoader()
    await ensureParentDir(options.path)
    const database = new sqlite.DatabaseSync(options.path)
    for (const statement of sqliteSchema) database.exec(statement)
    return createSQLiteBackedTraceStore(database)
  } catch (error) {
    if (!options.fallbackPath) {
      throw new Error(`SQLite store unavailable and no fallbackPath was provided: ${error instanceof Error ? error.message : String(error)}`)
    }
    return createJsonlTraceStore({ path: options.fallbackPath })
  }
}

type SQLiteDatabase = {
  exec(sql: string): void
  prepare(sql: string): SQLiteStatement
}

type SQLiteStatement = {
  run(...params: unknown[]): unknown
  all(...params: unknown[]): unknown[]
  get(...params: unknown[]): unknown
}

function createSQLiteBackedTraceStore(database: SQLiteDatabase): ExtendedTraceStore {
  // A single append-only table for MVP-2 JSONL-parity events keeps parity with
  // the JSONL store's semantics and avoids overfitting columns; the dedicated
  // eval_runs/eval_baselines/semantic_cache tables hold the queryable rows.
  return {
    writeTrace(trace) {
      const createdAt = new Date().toISOString()
      database.prepare(
        `INSERT OR REPLACE INTO requests (trace_id, decision_id, status, chosen_model, reason, latency_ms, estimated, estimated_cost_usd, input_tokens, output_tokens, total_tokens, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).run(trace.traceId, trace.decisionId, trace.status, trace.chosenModel ?? null, trace.reason, trace.latencyMs ?? null, trace.estimated ? 1 : 0, trace.estimatedCostUsd ?? null, trace.usage?.inputTokens ?? null, trace.usage?.outputTokens ?? null, trace.usage?.totalTokens ?? null, createdAt)

      database.prepare(
        `INSERT OR REPLACE INTO routing_decisions (decision_id, trace_id, candidates_json, reason)
         VALUES (?, ?, ?, ?)`,
      ).run(trace.decisionId, trace.traceId, JSON.stringify(trace.candidates), trace.reason)

      for (const attempt of trace.attempts) {
        database.prepare(
          `INSERT OR REPLACE INTO provider_calls (id, trace_id, attempt_no, provider, model_id, status, error_code, latency_ms)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        ).run(`${trace.traceId}_${attempt.attemptNo}`, trace.traceId, attempt.attemptNo, attempt.provider, attempt.modelId, attempt.status, attempt.errorCode ?? null, attempt.latencyMs ?? null)
      }
    },
    listTraces() {
      return rowsToTraces(database.prepare(`SELECT * FROM requests ORDER BY created_at DESC`).all(), database)
    },
    getSummary() {
      return summarizeTraces(rowsToTraces(database.prepare(`SELECT * FROM requests`).all(), database))
    },
    listRequests() {
      return tracesToRequests(rowsToTraces(database.prepare(`SELECT * FROM requests ORDER BY created_at DESC`).all(), database))
    },
    getRequest(traceId) {
      const row = database.prepare(`SELECT * FROM requests WHERE trace_id = ?`).get(traceId)
      const traces = row ? rowsToTraces([row], database) : []
      return tracesToRequests(traces)[0]
    },
    // --- MVP-2 -------------------------------------------------------------
    writeEvalRun(run) {
      database.prepare(
        `INSERT OR REPLACE INTO eval_runs (run_id, dataset_id, weights_version, metrics_json, per_case_json, created_at)
         VALUES (?, ?, ?, ?, ?, ?)`,
      ).run(run.runId, run.datasetId, run.weightsVersion, JSON.stringify(run.metrics), JSON.stringify(run.perCase), run.createdAt)
    },
    getEvalRun(runId) {
      const row = database.prepare(`SELECT * FROM eval_runs WHERE run_id = ?`).get(runId)
      return row ? rowToEvalRun(row as Record<string, unknown>) : undefined
    },
    listEvalRuns(datasetId) {
      const rows = datasetId
        ? database.prepare(`SELECT * FROM eval_runs WHERE dataset_id = ? ORDER BY created_at DESC`).all(datasetId)
        : database.prepare(`SELECT * FROM eval_runs ORDER BY created_at DESC`).all()
      return rows.map((row) => rowToEvalRun(row as Record<string, unknown>))
    },
    saveBaselinePointer(datasetId, runId) {
      database.prepare(
        `INSERT OR REPLACE INTO eval_baselines (dataset_id, baseline_run_id, updated_at) VALUES (?, ?, ?)`,
      ).run(datasetId, runId, new Date().toISOString())
    },
    getBaselineRunId(datasetId) {
      const row = database.prepare(`SELECT baseline_run_id FROM eval_baselines WHERE dataset_id = ?`).get(datasetId) as { baseline_run_id?: string } | undefined
      return row?.baseline_run_id
    },
    writeCacheEntry(entry, tenantScope) {
      database.prepare(
        `INSERT OR REPLACE INTO semantic_cache (key, embedding, embedding_provider_id, tenant_scope, request_json, response_json, router_trace_json, created_at, ttl_ms)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).run(
        entry.key,
        entry.embedding ? JSON.stringify(Array.from(entry.embedding)) : null,
        entry.embeddingProviderId,
        tenantScope,
        JSON.stringify(entry.request),
        JSON.stringify(entry.response),
        JSON.stringify(entry.routerTrace),
        entry.createdAt,
        entry.ttlMs ?? null,
      )
    },
    listCacheEntries() {
      const rows = database.prepare(`SELECT * FROM semantic_cache ORDER BY created_at DESC`).all()
      return rows.map((row) => rowToCacheEntry(row as Record<string, unknown>))
    },
    // cache_lookup + weights_change are event streams; SQLite path keeps them in
    // memory-free no-ops so the queryable tables above stay the source of truth.
    // The JSONL store retains the full event log when durability is needed.
  }
}

function rowToEvalRun(row: Record<string, unknown>): EvalRunResult {
  return {
    runId: String(row.run_id),
    datasetId: String(row.dataset_id),
    weightsVersion: String(row.weights_version),
    metrics: JSON.parse(String(row.metrics_json)),
    perCase: JSON.parse(String(row.per_case_json)),
    createdAt: String(row.created_at),
  }
}

function rowToCacheEntry(row: Record<string, unknown>): SemanticCacheEntry {
  return {
    key: String(row.key),
    embedding: row.embedding ? JSON.parse(String(row.embedding)) : undefined,
    embeddingProviderId: String(row.embedding_provider_id),
    request: JSON.parse(String(row.request_json)),
    response: JSON.parse(String(row.response_json)),
    routerTrace: JSON.parse(String(row.router_trace_json)),
    createdAt: String(row.created_at),
    ttlMs: row.ttl_ms === null || row.ttl_ms === undefined ? undefined : Number(row.ttl_ms),
  }
}

function rowsToTraces(rows: unknown[], database: SQLiteDatabase): RouterTrace[] {
  return rows.map((row) => {
    const request = row as Record<string, unknown>
    const decision = database.prepare(`SELECT * FROM routing_decisions WHERE trace_id = ?`).get(request.trace_id)
    const attempts = database.prepare(`SELECT * FROM provider_calls WHERE trace_id = ? ORDER BY attempt_no ASC`).all(request.trace_id)
    const decisionRow = decision as Record<string, unknown> | undefined
    return {
      traceId: String(request.trace_id),
      decisionId: String(request.decision_id),
      chosenModel: request.chosen_model ? String(request.chosen_model) : undefined,
      candidates: decisionRow?.candidates_json ? JSON.parse(String(decisionRow.candidates_json)) : [],
      reason: String(request.reason),
      attempts: attempts.map((attempt) => {
        const call = attempt as Record<string, unknown>
        return {
          attemptNo: Number(call.attempt_no),
          modelId: String(call.model_id),
          provider: String(call.provider),
          status: call.status as "success" | "failed" | "skipped",
          errorCode: call.error_code ? String(call.error_code) as never : undefined,
          latencyMs: call.latency_ms === null || call.latency_ms === undefined ? undefined : Number(call.latency_ms),
        }
      }),
      estimated: Boolean(request.estimated),
      estimatedCostUsd: request.estimated_cost_usd === null || request.estimated_cost_usd === undefined ? undefined : Number(request.estimated_cost_usd),
      usage: rowToUsage(request),
      latencyMs: request.latency_ms === null || request.latency_ms === undefined ? undefined : Number(request.latency_ms),
      status: request.status as RouterTrace["status"],
    }
  })
}

// Rebuilds the Usage object from the requests row. Returns undefined when the
// row carries no token or cost data (e.g. legacy rows written before the token
// columns existed), so SQLite matches JSONL's "usage absent" semantics rather
// than fabricating zeros. costUsd is recovered from estimated_cost_usd, which
// mirrors trace.usage.costUsd at write time.
function rowToUsage(request: Record<string, unknown>): RouterTrace["usage"] {
  const num = (value: unknown): number | undefined =>
    value === null || value === undefined ? undefined : Number(value)
  const inputTokens = num(request.input_tokens)
  const outputTokens = num(request.output_tokens)
  const totalTokens = num(request.total_tokens)
  const costUsd = num(request.estimated_cost_usd)
  if (inputTokens === undefined && outputTokens === undefined && totalTokens === undefined && costUsd === undefined) {
    return undefined
  }
  return { inputTokens, outputTokens, totalTokens, costUsd, estimated: Boolean(request.estimated) }
}

async function readJsonlTraces(path: string): Promise<RouterTrace[]> {
  try {
    const content = await readFile(path, { encoding: "utf8" })
    return content
      .split("\n")
      .filter(Boolean)
      .map((line) => JSON.parse(line) as JsonlEvent)
      .filter((event) => event.event_type === "request_finished")
      .map((event) => event.payload)
  } catch {
    return []
  }
}

function tracesToRequests(traces: RouterTrace[]): StoredRequest[] {
  return traces.map((trace) => ({
    traceId: trace.traceId,
    decisionId: trace.decisionId,
    status: trace.status,
    chosenModel: trace.chosenModel,
    reason: trace.reason,
    attempts: trace.attempts,
    usage: trace.usage,
    estimated: trace.estimated,
    latencyMs: trace.latencyMs,
  }))
}

function summarizeTraces(traces: RouterTrace[]): TraceStoreSummary {
  const totalRequests = traces.length
  const successCount = traces.filter((trace) => trace.status === "success" || trace.status === "fallback_success").length
  const fallbackCount = traces.filter((trace) => trace.status === "fallback_success" || trace.attempts.some((attempt) => attempt.status === "failed")).length
  const estimatedCostUsd = traces.reduce((sum, trace) => sum + (trace.estimatedCostUsd ?? trace.usage?.costUsd ?? 0), 0)
  const latencies = traces.map((trace) => trace.latencyMs).filter((value): value is number => value !== undefined).sort((a, b) => a - b)
  return {
    totalRequests,
    successRate: totalRequests === 0 ? 0 : successCount / totalRequests,
    fallbackCount,
    estimatedCostUsd,
    medianLatencyMs: latencies.length ? latencies[Math.floor(latencies.length / 2)] : undefined,
  }
}

async function ensureParentDir(path: string): Promise<void> {
  await mkdir(dirname(path), { recursive: true })
}
