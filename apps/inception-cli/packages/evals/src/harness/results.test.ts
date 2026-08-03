import { mkdtempSync, readFileSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { describe, expect, it, vi } from "vitest"
import { caseId, loadOrRun, type CaseKey, type CaseResult } from "./results.js"

const key: CaseKey = {
  exercise: "luhn",
  format: "whole",
  model: "m",
  attempt_budget: 2
}
const mkResult = (): CaseResult => ({
  key,
  tests_outcomes: [false, true],
  parse_error: false,
  apply_error: false,
  prompt_tokens: 10,
  completion_tokens: 20,
  cost_usd: 0.001,
  duration_ms: 5,
  commit: "abc"
})

describe("loadOrRun", () => {
  it("runs and persists on miss", async () => {
    const dir = mkdtempSync(join(tmpdir(), "res-"))
    const { result, cached } = await loadOrRun(dir, key, "abc", async () => mkResult())
    expect(cached).toBe(false)
    expect(
      JSON.parse(readFileSync(join(dir, `${caseId(key)}.json`), "utf8")).key
        .exercise
    ).toBe("luhn")
    expect(result.tests_outcomes).toEqual([false, true])
  })
  it("short-circuits on hit when key and commit both match", async () => {
    const dir = mkdtempSync(join(tmpdir(), "res-"))
    await loadOrRun(dir, key, "abc", async () => mkResult())
    const spy = vi.fn(async () => mkResult())
    const { cached } = await loadOrRun(dir, key, "abc", spy)
    expect(cached).toBe(true)
    expect(spy).not.toHaveBeenCalled()
  })
  it("re-runs and overwrites the record when the key matches but the commit differs", async () => {
    const dir = mkdtempSync(join(tmpdir(), "res-"))
    await loadOrRun(dir, key, "abc", async () => mkResult())
    const fresh: CaseResult = { ...mkResult(), commit: "def", tests_outcomes: [true] }
    const spy = vi.fn(async () => fresh)
    const { result, cached } = await loadOrRun(dir, key, "def", spy)
    expect(cached).toBe(false)
    expect(spy).toHaveBeenCalledTimes(1)
    expect(result.commit).toBe("def")
    const onDisk = JSON.parse(readFileSync(join(dir, `${caseId(key)}.json`), "utf8")) as CaseResult
    expect(onDisk.commit).toBe("def")
    expect(onDisk.tests_outcomes).toEqual([true])
  })
  it("re-runs on corrupt record", async () => {
    const dir = mkdtempSync(join(tmpdir(), "res-"))
    writeFileSync(join(dir, `${caseId(key)}.json`), "{not json")
    const { cached } = await loadOrRun(dir, key, "abc", async () => mkResult())
    expect(cached).toBe(false)
  })
  it("caseId is filesystem-safe", () => {
    expect(caseId({ ...key, exercise: "a/b" })).not.toContain("/")
  })
})
