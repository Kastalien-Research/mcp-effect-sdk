import { describe, expect, it } from "vitest"
import { aggregate, variants } from "./metrics.js"
import type { CaseResult } from "./results.js"

function mk(overrides: Partial<CaseResult> & { format?: string } = {}): CaseResult {
  const { format = "whole", ...rest } = overrides
  return {
    key: { exercise: "luhn", format, model: "mercury-2", attempt_budget: 2 },
    tests_outcomes: [false, true],
    parse_error: false,
    apply_error: false,
    prompt_tokens: 100,
    completion_tokens: 50,
    cost_usd: 0.001,
    duration_ms: 500,
    commit: "abc123",
    ...rest
  }
}

describe("aggregate", () => {
  it("diverges pass_rate_1 from pass_rate_2 when the first attempt fails but the second passes", () => {
    const results = [mk({ tests_outcomes: [false, true] })]
    const summary = aggregate(results)
    expect(summary.byFormat.whole?.pass_rate_1).toBe(0)
    expect(summary.byFormat.whole?.pass_rate_2).toBe(1)
  })

  it("pass_rate_1 and pass_rate_2 agree when the first attempt already passes", () => {
    const results = [mk({ tests_outcomes: [true] })]
    const summary = aggregate(results)
    expect(summary.byFormat.whole?.pass_rate_1).toBe(1)
    expect(summary.byFormat.whole?.pass_rate_2).toBe(1)
  })

  it("tolerates a short tests_outcomes array (fewer entries than the attempt budget)", () => {
    // A parse/apply error on attempt 2 consumes the attempt without a test run,
    // so tests_outcomes can be shorter than attempt_budget.
    const results = [mk({ tests_outcomes: [false], key: { exercise: "luhn", format: "whole", model: "m", attempt_budget: 2 } })]
    const summary = aggregate(results)
    expect(summary.byFormat.whole?.pass_rate_1).toBe(0)
    expect(summary.byFormat.whole?.pass_rate_2).toBe(0)
  })

  it("attributes parse errors and apply errors to separate rates", () => {
    const results = [
      mk({ parse_error: true, apply_error: false, tests_outcomes: [] }),
      mk({ parse_error: false, apply_error: true, tests_outcomes: [] }),
      mk({ parse_error: false, apply_error: false, tests_outcomes: [true] })
    ]
    const summary = aggregate(results)
    const s = summary.byFormat.whole
    expect(s?.cases).toBe(3)
    expect(s?.parse_error_rate).toBeCloseTo(1 / 3)
    expect(s?.apply_error_rate).toBeCloseTo(1 / 3)
    expect(s?.well_formed_rate).toBeCloseTo(1 / 3)
  })

  it("well_formed_rate is 1 only when neither parse_error nor apply_error is set", () => {
    const results = [
      mk({ parse_error: true, apply_error: true }),
      mk({ parse_error: false, apply_error: false })
    ]
    const summary = aggregate(results)
    expect(summary.byFormat.whole?.well_formed_rate).toBe(0.5)
  })

  it("splits into separate byFormat buckets", () => {
    const results = [
      mk({ format: "whole", tests_outcomes: [true] }),
      mk({ format: "search-replace", tests_outcomes: [false, false] })
    ]
    const summary = aggregate(results)
    expect(Object.keys(summary.byFormat).sort()).toEqual(["search-replace", "whole"])
    expect(summary.byFormat.whole?.cases).toBe(1)
    expect(summary.byFormat["search-replace"]?.cases).toBe(1)
    expect(summary.byFormat["search-replace"]?.pass_rate_2).toBe(0)
  })

  it("computes mean_cost_usd and mean_duration_ms across cases in a format", () => {
    const results = [
      mk({ cost_usd: 0.01, duration_ms: 100 }),
      mk({ cost_usd: 0.03, duration_ms: 300 })
    ]
    const summary = aggregate(results)
    expect(summary.byFormat.whole?.mean_cost_usd).toBeCloseTo(0.02)
    expect(summary.byFormat.whole?.mean_duration_ms).toBeCloseTo(200)
  })

  it("returns an empty byFormat map for no results", () => {
    expect(aggregate([])).toEqual({ byFormat: {} })
  })
})

describe("variants", () => {
  it("is not mixed when all cases share one model and one commit", () => {
    const results = [mk({ commit: "abc" }), mk({ commit: "abc" })]
    const v = variants(results)
    expect(v.mixed).toBe(false)
    expect(v.models).toEqual(["mercury-2"])
    expect(v.commits).toEqual(["abc"])
  })

  it("detects mixed when commits differ across cases", () => {
    const results = [mk({ commit: "abc" }), mk({ commit: "def" })]
    const v = variants(results)
    expect(v.mixed).toBe(true)
    expect(v.commits.sort()).toEqual(["abc", "def"])
  })

  it("detects mixed when models differ across cases", () => {
    const results = [
      mk({ key: { exercise: "luhn", format: "whole", model: "mercury-2", attempt_budget: 2 } }),
      mk({ key: { exercise: "luhn", format: "whole", model: "mercury-1", attempt_budget: 2 } })
    ]
    const v = variants(results)
    expect(v.mixed).toBe(true)
    expect(v.models.sort()).toEqual(["mercury-1", "mercury-2"])
  })

  it("returns empty arrays and mixed false for no results", () => {
    const v = variants([])
    expect(v).toEqual({ models: [], commits: [], mixed: false })
  })
})
