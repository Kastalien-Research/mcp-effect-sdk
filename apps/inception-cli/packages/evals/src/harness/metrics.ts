import type { CaseResult } from "./results.js"

export interface FormatSummary {
  cases: number
  pass_rate_1: number
  pass_rate_2: number
  parse_error_rate: number
  apply_error_rate: number
  well_formed_rate: number
  mean_cost_usd: number
  mean_duration_ms: number
}

export interface Summary {
  byFormat: Record<string, FormatSummary>
}

export interface Variants {
  models: string[]
  commits: string[]
  mixed: boolean
}

function rate(results: CaseResult[], pred: (r: CaseResult) => boolean): number {
  if (results.length === 0) return 0
  return results.filter(pred).length / results.length
}

function mean(results: CaseResult[], select: (r: CaseResult) => number): number {
  if (results.length === 0) return 0
  return results.reduce((sum, r) => sum + select(r), 0) / results.length
}

// `tests_outcomes` can be shorter than `k` (a parse/apply error consumes an
// attempt without a test run) — `.slice(0, k)` on a short array degrades
// gracefully to whatever entries exist, which is the correct behavior here.
function passRateK(results: CaseResult[], k: number): number {
  return rate(results, (r) => r.tests_outcomes.slice(0, k).some(Boolean))
}

export function aggregate(results: CaseResult[]): Summary {
  const byFormat: Record<string, FormatSummary> = {}
  const formats = [...new Set(results.map((r) => r.key.format))]
  for (const format of formats) {
    const subset = results.filter((r) => r.key.format === format)
    byFormat[format] = {
      cases: subset.length,
      pass_rate_1: passRateK(subset, 1),
      pass_rate_2: passRateK(subset, 2),
      parse_error_rate: rate(subset, (r) => r.parse_error),
      apply_error_rate: rate(subset, (r) => r.apply_error),
      well_formed_rate: rate(subset, (r) => !r.parse_error && !r.apply_error),
      mean_cost_usd: mean(subset, (r) => r.cost_usd),
      mean_duration_ms: mean(subset, (r) => r.duration_ms)
    }
  }
  return { byFormat }
}

export function variants(results: CaseResult[]): Variants {
  const models = [...new Set(results.map((r) => r.key.model))]
  const commits = [...new Set(results.map((r) => r.commit))]
  return { models, commits, mixed: models.length > 1 || commits.length > 1 }
}
