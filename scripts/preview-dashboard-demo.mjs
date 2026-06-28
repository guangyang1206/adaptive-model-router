#!/usr/bin/env node
import { createDashboard, createReadOnlyDataAccess } from '../packages/dashboard/dist/index.js'

const traces = [
  {
    traceId: 'trace_plan_001',
    decisionId: 'decision_plan_001',
    chosenModel: 'anthropic/claude-sonnet-4-0',
    candidates: [
      { modelId: 'anthropic/claude-sonnet-4-0', provider: 'anthropic', score: 96, reasons: ['tier=high', 'health=ok', 'task=plan'] },
      { modelId: 'openai/gpt-4.1-mini', provider: 'openai', score: 84, reasons: ['tier=balanced', 'health=ok'] },
      { modelId: 'ollama/llama3.1', provider: 'ollama', score: 62, reasons: ['self-hosted', 'zero-cost'] },
    ],
    reason: 'Selected high-tier reasoning model for planning with stable health and acceptable cost.',
    attempts: [{ attemptNo: 1, modelId: 'anthropic/claude-sonnet-4-0', provider: 'anthropic', status: 'success', latencyMs: 1180 }],
    usage: { inputTokens: 824, outputTokens: 412, totalTokens: 1236, costUsd: 0.008652, estimated: false },
    estimatedCostUsd: 0.008652,
    estimated: false,
    latencyMs: 1180,
    status: 'success',
  },
  {
    traceId: 'trace_tool_002',
    decisionId: 'decision_tool_002',
    chosenModel: 'openai/gpt-4.1-mini',
    candidates: [
      { modelId: 'openai/gpt-4.1-mini', provider: 'openai', score: 91, reasons: ['tool-calling', 'low-latency'] },
      { modelId: 'deepseek/deepseek-chat', provider: 'deepseek', score: 76, reasons: ['json-mode', 'low-cost'] },
    ],
    reason: 'Selected OpenAI-compatible model because this request requires tool calling and low latency.',
    attempts: [{ attemptNo: 1, modelId: 'openai/gpt-4.1-mini', provider: 'openai', status: 'success', latencyMs: 640 }],
    usage: { inputTokens: 540, outputTokens: 168, totalTokens: 708, costUsd: 0.000485, estimated: false },
    estimatedCostUsd: 0.000485,
    estimated: false,
    latencyMs: 640,
    status: 'success',
  },
  {
    traceId: 'trace_fallback_003',
    decisionId: 'decision_fallback_003',
    chosenModel: 'deepseek/deepseek-chat',
    candidates: [
      { modelId: 'ollama/llama3.1', provider: 'ollama', score: 88, reasons: ['self-hosted', 'zero-cost'] },
      { modelId: 'deepseek/deepseek-chat', provider: 'deepseek', score: 82, reasons: ['fallback-candidate', 'low-cost'] },
    ],
    reason: 'Ollama timed out on a non-streaming request, then fallback succeeded with DeepSeek.',
    attempts: [
      { attemptNo: 1, modelId: 'ollama/llama3.1', provider: 'ollama', status: 'failed', errorCode: 'AR_PROVIDER_TIMEOUT', latencyMs: 3000 },
      { attemptNo: 2, modelId: 'deepseek/deepseek-chat', provider: 'deepseek', status: 'success', latencyMs: 980 },
    ],
    usage: { inputTokens: 610, outputTokens: 254, totalTokens: 864, costUsd: 0.000444, estimated: false },
    estimatedCostUsd: 0.000444,
    estimated: false,
    latencyMs: 3980,
    status: 'fallback_success',
  },
]

const models = [
  { id: 'openai/gpt-4.1-mini', provider: 'openai', type: 'commercial', capabilities: ['reasoning', 'tool-calling', 'json-mode', 'streaming'], health: { status: 'ok', latencyP50Ms: 640 }, cost: { inputPer1M: 0.4, outputPer1M: 1.6 }, enabled: true },
  { id: 'anthropic/claude-sonnet-4-0', provider: 'anthropic', type: 'commercial', capabilities: ['reasoning', 'tool-calling', 'json-mode', 'vision', 'streaming'], health: { status: 'ok', latencyP50Ms: 1180 }, cost: { inputPer1M: 3, outputPer1M: 15 }, enabled: true },
  { id: 'deepseek/deepseek-chat', provider: 'deepseek', type: 'open-source', capabilities: ['reasoning', 'json-mode', 'streaming'], health: { status: 'ok', latencyP50Ms: 980 }, cost: { inputPer1M: 0.27, outputPer1M: 1.1 }, enabled: true },
  { id: 'ollama/llama3.1', provider: 'ollama', type: 'self-hosted', capabilities: ['reasoning', 'streaming'], health: { status: 'degraded', latencyP50Ms: 3000 }, cost: { inputPer1M: 0, outputPer1M: 0, estimated: true }, enabled: true },
]

const port = Number(process.env.ADAPTIVE_ROUTER_DEMO_PORT ?? 4318)
const dashboard = await createDashboard({
  port,
  data: createReadOnlyDataAccess({
    listTraces: () => traces,
    listModels: () => models,
  }),
})

console.log(`Adaptive Model Router demo dashboard running at ${dashboard.url}`)
console.log('Press Ctrl+C to stop.')
