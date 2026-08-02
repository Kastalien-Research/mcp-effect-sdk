import { existsSync, readFileSync, renameSync, writeFileSync } from "node:fs"
import { join } from "node:path"

export interface CaseKey {
  exercise: string
  format: string
  model: string
  attempt_budget: number
}

export interface CaseResult {
  key: CaseKey
  tests_outcomes: boolean[]
  parse_error: boolean
  apply_error: boolean
  prompt_tokens: number
  completion_tokens: number
  cost_usd: number
  duration_ms: number
  commit: string
  error?: string
}

export const caseId = (key: CaseKey): string => {
  const raw = `${key.exercise}--${key.format}--${key.model}--r${key.attempt_budget}`
  return raw.replace(/[^A-Za-z0-9._-]/g, "_")
}

const deepEqual = (a: unknown, b: unknown): boolean =>
  JSON.stringify(a) === JSON.stringify(b)

export const loadOrRun = async (
  runDir: string,
  key: CaseKey,
  run: () => Promise<CaseResult>
): Promise<{ result: CaseResult; cached: boolean }> => {
  const path = join(runDir, `${caseId(key)}.json`)
  if (existsSync(path)) {
    try {
      const parsed = JSON.parse(readFileSync(path, "utf8")) as CaseResult
      if (deepEqual(parsed.key, key)) {
        return { result: parsed, cached: true }
      }
    } catch {
      // fall through to re-run on unparseable JSON
    }
  }
  const result = await run()
  const tmpPath = `${path}.tmp`
  writeFileSync(tmpPath, JSON.stringify(result, null, 2))
  renameSync(tmpPath, path)
  return { result, cached: false }
}
