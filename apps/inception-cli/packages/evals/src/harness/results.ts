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

/**
 * `expectedCommit` guards resume-after-crash caching against a silent stale
 * hit: rerunning a campaign under the same `--run` id after the repo moved
 * to a new revision must NOT replay the old revision's outcomes/costs. A
 * cache hit requires the key to match (as before) AND the cached record's
 * `commit` to equal `expectedCommit`; a commit mismatch falls through to
 * `run()` exactly like a key mismatch or a corrupt record, and the fresh
 * result overwrites the file via the existing tmp+rename path. Resuming a
 * crashed campaign at the SAME commit is unaffected — that's the case this
 * cache exists for.
 */
export const loadOrRun = async (
  runDir: string,
  key: CaseKey,
  expectedCommit: string,
  run: () => Promise<CaseResult>
): Promise<{ result: CaseResult; cached: boolean }> => {
  const path = join(runDir, `${caseId(key)}.json`)
  if (existsSync(path)) {
    try {
      const parsed = JSON.parse(readFileSync(path, "utf8")) as CaseResult
      if (deepEqual(parsed.key, key) && parsed.commit === expectedCommit) {
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
