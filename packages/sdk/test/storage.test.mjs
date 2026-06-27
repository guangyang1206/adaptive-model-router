import test from "node:test"
import assert from "node:assert/strict"
import { mkdtemp, rm } from "node:fs/promises"
import { join } from "node:path"
import { tmpdir } from "node:os"
import { createJsonlTraceStore } from "../dist/index.js"

function trace(overrides = {}) {
  return {
    traceId: `trace_${Math.random().toString(36).slice(2)}`,
    decisionId: `decision_${Math.random().toString(36).slice(2)}`,
    chosenModel: "local/model",
    candidates: [],
    reason: "test trace",
    attempts: [{ attemptNo: 1, modelId: "local/model", provider: "local", status: "success", latencyMs: 10 }],
    usage: { inputTokens: 4, outputTokens: 8, totalTokens: 12, costUsd: 0, estimated: true },
    estimatedCostUsd: 0,
    estimated: true,
    latencyMs: 10,
    status: "success",
    ...overrides,
  }
}

test("jsonl trace store writes and reads traces", async () => {
  const dir = await mkdtemp(join(tmpdir(), "adaptive-router-"))
  try {
    const store = createJsonlTraceStore({ path: join(dir, "router.jsonl") })
    const first = trace()
    await store.writeTrace(first)

    const traces = await store.listTraces?.()
    assert.equal(traces?.length, 1)
    assert.equal(traces?.[0]?.traceId, first.traceId)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test("jsonl trace store summarizes traces", async () => {
  const dir = await mkdtemp(join(tmpdir(), "adaptive-router-"))
  try {
    const store = createJsonlTraceStore({ path: join(dir, "router.jsonl") })
    await store.writeTrace(trace({ status: "success", latencyMs: 10 }))
    await store.writeTrace(trace({ status: "fallback_success", attempts: [{ attemptNo: 1, modelId: "a", provider: "a", status: "failed" }, { attemptNo: 2, modelId: "b", provider: "b", status: "success" }], latencyMs: 30 }))

    const summary = await store.getSummary?.()
    assert.equal(summary?.totalRequests, 2)
    assert.equal(summary?.successRate, 1)
    assert.equal(summary?.fallbackCount, 1)
    assert.equal(summary?.medianLatencyMs, 30)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})
