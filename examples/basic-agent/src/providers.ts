import type { ProviderAdapter } from "@adaptive-router/sdk"
import {
  createAnthropicProvider,
  createDeepSeekProvider,
  createOllamaProvider,
  createOpenAIProvider,
  createStaticProvider,
} from "@adaptive-router/sdk"
import { offlineModels } from "./models.js"

export type ProviderSetup = {
  providers: ProviderAdapter[]
  mode: "live" | "offline"
  /** Which env vars were detected, for printing back to the user. */
  detected: string[]
}

/**
 * Build the provider list from the environment.
 *
 * Ollama is only registered when OLLAMA_BASE_URL is set explicitly. Registering
 * it unconditionally would mean the offline provider never gets used, and a
 * first-time run with no local Ollama daemon would end in a failed route
 * instead of a working demo.
 */
export function resolveProviders(env: NodeJS.ProcessEnv = process.env): ProviderSetup {
  const providers: ProviderAdapter[] = []
  const detected: string[] = []

  if (env.OPENAI_API_KEY) {
    providers.push(createOpenAIProvider({ apiKey: env.OPENAI_API_KEY }))
    detected.push("OPENAI_API_KEY")
  }
  if (env.ANTHROPIC_API_KEY) {
    providers.push(createAnthropicProvider({ apiKey: env.ANTHROPIC_API_KEY }))
    detected.push("ANTHROPIC_API_KEY")
  }
  if (env.DEEPSEEK_API_KEY) {
    providers.push(createDeepSeekProvider({ apiKey: env.DEEPSEEK_API_KEY }))
    detected.push("DEEPSEEK_API_KEY")
  }
  if (env.OLLAMA_BASE_URL) {
    providers.push(createOllamaProvider({ baseURL: env.OLLAMA_BASE_URL }))
    detected.push("OLLAMA_BASE_URL")
  }

  if (providers.length > 0) {
    return { providers, mode: "live", detected }
  }

  return {
    providers: [createStaticProvider("offline", offlineModels)],
    mode: "offline",
    detected,
  }
}
