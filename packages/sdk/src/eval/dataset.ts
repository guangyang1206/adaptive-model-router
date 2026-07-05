import { readFile } from "node:fs/promises"
import { createHash } from "node:crypto"
import type { EvalCase } from "../types.js"

export type LoadedDataset = {
  datasetId: string
  cases: EvalCase[]
  notes: string[]
}

/**
 * Load a golden dataset from a path (JSON array or JSONL) or an in-memory
 * array. `datasetId` = file stem + first 8 hex of the content sha1, so a
 * dataset edit changes the id and never silently reuses a stale baseline.
 * Validation failures throw with the offending case id + field — never a
 * silent skip.
 */
export async function loadDataset(input: string | EvalCase[]): Promise<LoadedDataset> {
  const notes: string[] = []
  let cases: EvalCase[]
  let stem: string
  let content: string

  if (typeof input === "string") {
    content = await readFile(input, { encoding: "utf8" })
    stem = fileStem(input)
    cases = input.endsWith(".jsonl") ? parseJsonl(content) : parseJsonArray(content)
  } else {
    cases = input
    content = JSON.stringify(input)
    stem = "inline"
  }

  const errors: string[] = []
  const seen = new Set<string>()
  for (const c of cases) {
    for (const err of validateCase(c)) errors.push(err)
    if (c.id) {
      if (seen.has(c.id)) errors.push(`duplicate case id "${c.id}"`)
      seen.add(c.id)
    }
  }
  if (errors.length > 0) {
    throw invalidRequest(`dataset validation failed:\n- ${errors.join("\n- ")}`)
  }

  const datasetId = `${stem}_${sha1(content).slice(0, 8)}`
  return { datasetId, cases, notes }
}

/** Return the list of validation errors for a case; empty ⇒ valid. */
export function validateCase(c: EvalCase): string[] {
  const errors: string[] = []
  const id = c?.id
  if (!id || typeof id !== "string") {
    errors.push("case is missing a non-empty string id")
    return errors
  }
  if (!c.request || !Array.isArray(c.request.messages) || c.request.messages.length === 0) {
    errors.push(`case "${id}": request.messages must be a non-empty array`)
  }
  if (!c.expect || typeof c.expect !== "object") {
    errors.push(`case "${id}": expect is required`)
    return errors
  }
  const assertionKeys = ["modelId", "anyOf", "maxCostUsd", "maxLatencyMs", "mustHaveCapabilities", "mustNotBeSkipped"]
  if (!assertionKeys.some((k) => c.expect[k as keyof EvalCase["expect"]] !== undefined)) {
    errors.push(`case "${id}": expect must contain at least one assertion key`)
  }
  if (c.expect.modelId !== undefined && typeof c.expect.modelId !== "string") {
    errors.push(`case "${id}": expect.modelId must be a string`)
  }
  if (c.expect.anyOf !== undefined && (!Array.isArray(c.expect.anyOf) || c.expect.anyOf.some((x) => typeof x !== "string"))) {
    errors.push(`case "${id}": expect.anyOf must be a string array`)
  }
  return errors
}

function parseJsonArray(content: string): EvalCase[] {
  const parsed = JSON.parse(content)
  if (!Array.isArray(parsed)) throw invalidRequest("dataset JSON must be an array of cases")
  return parsed as EvalCase[]
}

function parseJsonl(content: string): EvalCase[] {
  return content
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line, index) => {
      try {
        return JSON.parse(line) as EvalCase
      } catch {
        throw invalidRequest(`dataset JSONL parse error on line ${index + 1}`)
      }
    })
}

function fileStem(path: string): string {
  const base = path.split(/[/\\]/).pop() ?? path
  return base.replace(/\.(jsonl?|JSONL?)$/, "")
}

function sha1(input: string): string {
  return createHash("sha1").update(input).digest("hex")
}

function invalidRequest(message: string): Error {
  const error = new Error(message) as Error & { code: string }
  error.code = "AR_INVALID_REQUEST"
  return error
}
