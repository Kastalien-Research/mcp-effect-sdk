import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { describe, expect, it } from "vitest"
import { runTests } from "./testExec.js"

function makeWorkdir(testFile: string): string {
  const dir = mkdtempSync(join(tmpdir(), "testexec-"))
  mkdirSync(join(dir, "tests"))
  writeFileSync(join(dir, "tests/index.test.ts"), testFile)
  return dir
}

describe("runTests", () => {
  it("reports passed: true for a trivially passing vitest file", async () => {
    const dir = makeWorkdir(`
      import { describe, it, expect } from "vitest"
      describe("ok", () => { it("passes", () => { expect(1 + 1).toBe(2) }) })
    `)
    const result = await runTests(dir)
    expect(result.passed).toBe(true)
  })

  it("reports passed: false and mentions the test name for a failing file", async () => {
    const dir = makeWorkdir(`
      import { describe, it, expect } from "vitest"
      describe("broken", () => { it("a very specific failing test", () => { expect(1 + 1).toBe(3) }) })
    `)
    const result = await runTests(dir)
    expect(result.passed).toBe(false)
    expect(result.output).toContain("a very specific failing test")
  })

  it("scrubs timing strings so a passing run's output is stable across runs", async () => {
    const dir = makeWorkdir(`
      import { describe, it, expect } from "vitest"
      describe("ok", () => { it("passes", () => { expect(1).toBe(1) }) })
    `)
    const first = await runTests(dir)
    const second = await runTests(dir)
    expect(first.output).not.toMatch(/\d+(?:\.\d+)?m?s\b/)
    expect(first.output).toEqual(second.output)
  })

  // This is the path that actually matters: a failing run's output is the
  // only output ever fed back into a retry prompt (runner.ts breaks the
  // attempt loop on the first pass), and the default reporter prints
  // per-file/per-test trailing timing suffixes ("... 1 failed) 4ms",
  // "× fails 3ms") only when a run fails — a passing-only fixture can't
  // catch a scrub gap in this shape.
  it("scrubs timing strings so a failing run's output is stable across runs", async () => {
    const dir = makeWorkdir(`
      import { describe, it, expect } from "vitest"
      describe("broken", () => { it("a very specific failing test", () => { expect(1 + 1).toBe(3) }) })
    `)
    const first = await runTests(dir)
    const second = await runTests(dir)
    expect(first.passed).toBe(false)
    expect(first.output).not.toMatch(/\d+(?:\.\d+)?m?s\b/)
    expect(first.output).toEqual(second.output)
  })
})
