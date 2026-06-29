#!/usr/bin/env node
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { dirname, join, resolve } from "node:path"
import process from "node:process"

type Config = {
  schemaVersion: "1.0"
  storage: {
    sqlitePath: string
    jsonlFallbackPath: string
  }
  providers: {
    openai?: { env: string }
    anthropic?: { env: string }
    deepseek?: { env: string; baseURL: string }
    ollama?: { baseURL: string }
  }
  dashboard: {
    port: number
  }
}

type JsonlEvent = {
  event_type?: string
  request_id?: string
  decision_id?: string
  timestamp?: string
  payload?: TracePayload
}

type TracePayload = {
  traceId?: string
  decisionId?: string
  status?: string
  chosenModel?: string
  reason?: string
  attempts?: { status?: string; provider?: string; modelId?: string; errorCode?: string }[]
  usage?: { totalTokens?: number; costUsd?: number; estimated?: boolean }
  estimatedCostUsd?: number
  latencyMs?: number
}

const defaultConfig: Config = {
  schemaVersion: "1.0",
  storage: {
    sqlitePath: ".adaptive-router/router.db",
    jsonlFallbackPath: ".adaptive-router/router.jsonl",
  },
  providers: {
    openai: { env: "OPENAI_API_KEY" },
    anthropic: { env: "ANTHROPIC_API_KEY" },
    deepseek: { env: "DEEPSEEK_API_KEY", baseURL: "https://api.deepseek.com/v1" },
    ollama: { baseURL: "http://localhost:11434" },
  },
  dashboard: {
    port: 4318,
  },
}

const SECRET_KEY_PATTERN = /(api[-_]?key|secret|token|password|passwd|credential|authorization|auth[-_]?token|access[-_]?key|private[-_]?key|bearer)/i
const SECRET_VALUE_PATTERN = /^(sk-|xoxb-|ghp_|gho_|github_pat_|AIza|AKIA|ya29\.)/

const command = process.argv[2] ?? "help"
const args = process.argv.slice(3)

try {
  if (command === "init") runInit(args)
  else if (command === "doctor") runDoctor(args)
  else if (command === "inspect") runInspect(args)
  else if (command === "export") runExport(args)
  else runHelp(command !== "help" ? `Unknown command: ${command}` : undefined)
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error))
  process.exitCode = 1
}

function runInit(args: string[]): void {
  const cwd = getCwd(args)
  const configPath = join(cwd, "adaptive-router.config.json")
  const envPath = join(cwd, ".env.example")
  mkdirSync(join(cwd, ".adaptive-router"), { recursive: true })

  if (!existsSync(configPath)) {
    writeJson(configPath, defaultConfig)
    console.log(`Created ${relative(cwd, configPath)}`)
  } else {
    console.log(`${relative(cwd, configPath)} already exists`)
  }

  if (!existsSync(envPath)) {
    writeFileSync(envPath, [
      "OPENAI_API_KEY=",
      "ANTHROPIC_API_KEY=",
      "DEEPSEEK_API_KEY=",
      "DEEPSEEK_BASE_URL=https://api.deepseek.com/v1",
      "OLLAMA_BASE_URL=http://localhost:11434",
      "ADAPTIVE_ROUTER_DB=.adaptive-router/router.db",
      "",
    ].join("\n"), { encoding: "utf8" })
    console.log(`Created ${relative(cwd, envPath)}`)
  }

  console.log("Next: configure provider keys, run adaptive-router doctor, then start your agent.")
}

function runDoctor(args: string[]): void {
  const cwd = getCwd(args)
  const config = readConfig(cwd)
  const checks = [
    check("config", existsSync(join(cwd, "adaptive-router.config.json")), "adaptive-router.config.json found", "Run adaptive-router init"),
    check("storage-dir", existsSync(dirname(resolve(cwd, config.storage.jsonlFallbackPath))), "storage directory found", "Run adaptive-router init"),
    check("openai-key", Boolean(process.env[config.providers.openai?.env ?? "OPENAI_API_KEY"]), "OPENAI_API_KEY set", "OPENAI_API_KEY not set"),
    check("anthropic-key", Boolean(process.env[config.providers.anthropic?.env ?? "ANTHROPIC_API_KEY"]), "ANTHROPIC_API_KEY set", "ANTHROPIC_API_KEY not set"),
    check("deepseek-key", Boolean(process.env[config.providers.deepseek?.env ?? "DEEPSEEK_API_KEY"]), "DEEPSEEK_API_KEY set", "DEEPSEEK_API_KEY not set"),
    check("ollama", true, `Ollama baseURL: ${config.providers.ollama?.baseURL ?? "http://localhost:11434"}`, "Ollama baseURL missing"),
  ]

  for (const item of checks) {
    console.log(`${item.ok ? "OK" : "WARN"} ${item.name}: ${item.message}`)
  }

  const warnings = checks.filter((item) => !item.ok).length
  console.log(warnings === 0 ? "Doctor passed." : `Doctor completed with ${warnings} warning(s).`)
}

function runInspect(args: string[]): void {
  const cwd = getCwd(args)
  const config = readConfig(cwd)
  const events = readJsonlEvents(resolve(cwd, config.storage.jsonlFallbackPath))
  const traces = events.map((event) => event.payload).filter((payload): payload is TracePayload => Boolean(payload))
  const total = traces.length
  const fallback = traces.filter((trace) => trace.status === "fallback_success" || trace.attempts?.some((attempt) => attempt.status === "failed")).length
  const failed = traces.filter((trace) => trace.status === "failed").length
  const cost = traces.reduce((sum, trace) => sum + (trace.estimatedCostUsd ?? trace.usage?.costUsd ?? 0), 0)

  console.log(`Requests: ${total}`)
  console.log(`Fallbacks: ${fallback}`)
  console.log(`Failed: ${failed}`)
  console.log(`Estimated cost: $${cost.toFixed(6)}`)

  for (const trace of traces.slice(-10).reverse()) {
    console.log(`- ${trace.traceId ?? "unknown"} ${trace.status ?? "unknown"} ${trace.chosenModel ?? "n/a"} ${trace.reason ?? ""}`)
  }
}

function runExport(args: string[]): void {
  const cwd = getCwd(args)
  const config = readConfig(cwd)
  const output = getArg(args, "--out") ?? join(cwd, ".adaptive-router", "diagnostic-export.json")
  const events = readJsonlEvents(resolve(cwd, config.storage.jsonlFallbackPath))
  const exportPayload = {
    exportedAt: new Date().toISOString(),
    config: redactConfig(config),
    events,
  }
  mkdirSync(dirname(output), { recursive: true })
  writeJson(output, exportPayload)
  console.log(`Exported diagnostics to ${relative(cwd, output)}`)
}

function runHelp(error?: string): void {
  if (error) console.error(error)
  console.log(`Adaptive Model Router CLI

Usage:
  adaptive-router init [--cwd <path>]
  adaptive-router doctor [--cwd <path>]
  adaptive-router inspect [--cwd <path>]
  adaptive-router export [--cwd <path>] [--out <path>]
`)
  if (error) process.exitCode = 1
}

function readConfig(cwd: string): Config {
  const configPath = join(cwd, "adaptive-router.config.json")
  if (!existsSync(configPath)) return defaultConfig
  return { ...defaultConfig, ...JSON.parse(readFileSync(configPath, "utf8")) }
}

function readJsonlEvents(path: string): JsonlEvent[] {
  if (!existsSync(path)) return []
  return readFileSync(path, "utf8")
    .split("\n")
    .filter(Boolean)
    .map((line) => safeParse(line))
    .filter((event): event is JsonlEvent => Boolean(event))
}

function safeParse(line: string): JsonlEvent | undefined {
  try {
    return JSON.parse(line) as JsonlEvent
  } catch {
    return undefined
  }
}

function getCwd(args: string[]): string {
  return resolve(getArg(args, "--cwd") ?? process.cwd())
}

function getArg(args: string[], name: string): string | undefined {
  const index = args.indexOf(name)
  return index >= 0 ? args[index + 1] : undefined
}

function writeJson(path: string, value: unknown): void {
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`, { encoding: "utf8" })
}

function redactValue(value: unknown): unknown {
  if (typeof value === "string") {
    return SECRET_VALUE_PATTERN.test(value) ? "[REDACTED]" : value
  }
  if (Array.isArray(value)) {
    return value.map(redactValue)
  }
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {}
    for (const [key, val] of Object.entries(value as Record<string, unknown>)) {
      out[key] = SECRET_KEY_PATTERN.test(key) ? "[REDACTED]" : redactValue(val)
    }
    return out
  }
  return value
}

// Removes any accidentally-embedded secrets before a diagnostic export leaves
// the machine. The config schema only stores env-var *names* (e.g. "OPENAI_API_KEY"),
// not values, but configs can be hand-edited; this guards against leaking a real
// key that someone inlined by mistake.
function redactConfig(config: Config): Config {
  return redactValue(config) as Config
}

function check(name: string, ok: boolean, okMessage: string, warnMessage: string) {
  return { name, ok, message: ok ? okMessage : warnMessage }
}

function relative(cwd: string, path: string): string {
  const absolute = resolve(path)
  return absolute.startsWith(cwd) ? absolute.slice(cwd.length + 1) : path
}
