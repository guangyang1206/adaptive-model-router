import type { ModelProfile } from "@adaptive-router/sdk"

/**
 * Model catalog used when no provider credentials are present.
 *
 * Two profiles with deliberately different tiers, capabilities and costs, so
 * `router.evaluate()` produces a ranking you can actually reason about instead
 * of a single-candidate list that tells you nothing.
 */
export const offlineModels: ModelProfile[] = [
  {
    id: "offline/fast-draft",
    provider: "offline",
    model: "fast-draft",
    type: "self-hosted",
    kind: "self-hosted",
    tier: "standard",
    contextWindow: 8192,
    capabilities: ["reasoning", "streaming"],
    latencyClass: "low",
    enabled: true,
    cost: { inputPer1M: 0.1, outputPer1M: 0.3, currency: "USD", estimated: true },
    health: { status: "ok", successRate: 1 },
  },
  {
    id: "offline/deep-reasoner",
    provider: "offline",
    model: "deep-reasoner",
    type: "self-hosted",
    kind: "self-hosted",
    tier: "high",
    contextWindow: 131072,
    capabilities: ["reasoning", "tool-calling", "json-mode", "streaming"],
    latencyClass: "medium",
    enabled: true,
    cost: { inputPer1M: 3, outputPer1M: 15, currency: "USD", estimated: true },
    health: { status: "ok", successRate: 1 },
  },
]
