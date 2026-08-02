import { mkdtempSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { describe, expect, it, vi } from "vitest"
import type { Exercise } from "./corpus.js"
import { searchReplace } from "./formats/search-replace.js"
import { whole } from "./formats/whole.js"
import { runCase, type ChatFn, type ChatMessage } from "./runner.js"

function mkTmpRoot(): string {
  return mkdtempSync(join(tmpdir(), "runcase-"))
}

function scriptedChat(responses: string[]): ChatFn {
  let i = 0
  return vi.fn(async (_messages: ChatMessage[]) => {
    const text = responses[i] ?? responses[responses.length - 1]!
    i++
    return { text, promptTokens: 10, completionTokens: 20 }
  })
}

function userContent(chat: ChatFn, callIndex: number): string {
  const calls = (chat as unknown as { mock: { calls: [ChatMessage[]][] } }).mock.calls
  const messages = calls[callIndex]![0]
  const user = messages.find((m) => m.role === "user")
  if (!user) throw new Error(`no user message in call ${callIndex}`)
  return user.content
}

const exercise: Exercise = {
  name: "toy",
  instructions: "Make add(a, b) return a + b.",
  files: { "src/index.ts": "export const add = (a: number, b: number) => a - b\n" },
  testFiles: { "tests/index.test.ts": "// pristine test content\n" }
}

describe("runCase", () => {
  it("succeeds on the first attempt with a correct whole response", async () => {
    const chat = scriptedChat(["src/index.ts\n```ts\nexport const add = (a: number, b: number) => a + b\n```\n"])
    const testRunner = vi.fn(async () => ({ passed: true, output: "n/a" }))
    const result = await runCase({
      exercise,
      format: whole,
      chat,
      workRoot: mkTmpRoot(),
      attemptBudget: 2,
      model: "m",
      commit: "abc",
      testRunner
    })
    expect(result.tests_outcomes).toEqual([true])
    expect(result.parse_error).toBe(false)
    expect(result.apply_error).toBe(false)
    expect(testRunner).toHaveBeenCalledTimes(1)
    expect(result.prompt_tokens).toBe(10)
    expect(result.completion_tokens).toBe(20)
    expect(result.cost_usd).toBeCloseTo((10 / 1_000_000) * 0.25 + (20 / 1_000_000) * 0.75, 12)
  })

  it("records a parse error, feeds the error message back, and succeeds on retry", async () => {
    const chat = scriptedChat([
      "this response has no fenced block at all",
      "src/index.ts\n```ts\nexport const add = (a: number, b: number) => a + b\n```\n"
    ])
    const testRunner = vi.fn(async () => ({ passed: true, output: "n/a" }))
    const result = await runCase({
      exercise,
      format: whole,
      chat,
      workRoot: mkTmpRoot(),
      attemptBudget: 2,
      model: "m",
      commit: "abc",
      testRunner
    })
    expect(result.parse_error).toBe(true)
    expect(result.apply_error).toBe(false)
    expect(result.tests_outcomes).toEqual([true])
    expect(chat).toHaveBeenCalledTimes(2)
    expect(userContent(chat, 1)).toContain("no fenced file blocks found")
  })

  it("consumes both attempts on repeated apply errors without ever running tests", async () => {
    const badBlock =
      "src/index.ts\n<<<<<<< SEARCH\nthis text does not exist in the file\n=======\nreplacement\n>>>>>>> REPLACE\n"
    const chat = scriptedChat([badBlock, badBlock])
    const testRunner = vi.fn(async () => ({ passed: true, output: "n/a" }))
    const result = await runCase({
      exercise,
      format: searchReplace,
      chat,
      workRoot: mkTmpRoot(),
      attemptBudget: 2,
      model: "m",
      commit: "abc",
      testRunner
    })
    expect(result.apply_error).toBe(true)
    expect(result.parse_error).toBe(false)
    // A failed apply consumes the attempt WITHOUT a test run: tests_outcomes
    // stays empty here, it is never padded with `false` placeholders.
    expect(result.tests_outcomes).toEqual([])
    expect(testRunner).not.toHaveBeenCalled()
    expect(chat).toHaveBeenCalledTimes(2)
  })

  it("feeds scrubbed test output back on failure and stops early once tests pass", async () => {
    const chat = scriptedChat([
      "src/index.ts\n```ts\nexport const add = (a: number, b: number) => a - b\n```\n",
      "src/index.ts\n```ts\nexport const add = (a: number, b: number) => a + b\n```\n"
    ])
    let call = 0
    const testRunner = vi.fn(async () => {
      call++
      return call === 1
        ? { passed: false, output: "FAIL tests/index.test.ts > add > adds numbers" }
        : { passed: true, output: "n/a" }
    })
    const result = await runCase({
      exercise,
      format: whole,
      chat,
      workRoot: mkTmpRoot(),
      attemptBudget: 2,
      model: "m",
      commit: "abc",
      testRunner
    })
    expect(result.tests_outcomes).toEqual([false, true])
    expect(testRunner).toHaveBeenCalledTimes(2)
    expect(userContent(chat, 1)).toContain("FAIL tests/index.test.ts > add > adds numbers")
    expect(userContent(chat, 1)).toContain("The tests are correct; do not modify tests. Fix the code.")
  })
})
