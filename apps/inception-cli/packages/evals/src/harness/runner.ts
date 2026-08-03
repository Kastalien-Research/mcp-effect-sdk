import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs"
import { dirname, join, resolve, sep } from "node:path"
import { PRICING } from "../lib/constants.js"
import type { Exercise, FileMap } from "./corpus.js"
import { ApplyError, ParseError } from "./formats/types.js"
import type { EditFormat } from "./formats/types.js"
import type { CaseResult } from "./results.js"
import { runTests as defaultRunTests } from "./testExec.js"
import type { TestRunResult } from "./testExec.js"

export interface ChatMessage {
  role: string
  content: string
}

export type ChatFn = (
  messages: ChatMessage[]
) => Promise<{ text: string; promptTokens: number; completionTokens: number }>

export type TestRunner = (workdir: string) => Promise<TestRunResult>

export interface RunCaseOptions {
  exercise: Exercise
  format: EditFormat
  chat: ChatFn
  workRoot: string
  attemptBudget: number
  model: string
  commit: string
  /** Injected in tests; defaults to the real vitest-spawning runner from testExec.ts. */
  testRunner?: TestRunner
}

const SYSTEM_PREAMBLE =
  "You are a terse coding executor. Apply the requested change using exactly the edit format below. " +
  "Emit nothing except edits in that format — no prose, no explanations."

const FEEDBACK_LINE = "The tests are correct; do not modify tests. Fix the code."

/**
 * True when `abs` is `root` itself or lies strictly inside it. Requires the
 * trailing separator on the prefix comparison so that a sibling directory
 * whose name merely starts with `root`'s name (e.g. "workdir-evil" vs
 * "workdir") is never mistaken for containment.
 */
function isContainedIn(root: string, abs: string): boolean {
  return abs === root || abs.startsWith(root + sep)
}

/**
 * Writes `files` into `dir`. Every target path is resolved and must stay
 * inside `dir` — this rejects `../` traversal in model-controlled paths
 * (see formats/whole.ts, formats/search-replace.ts) before anything touches
 * disk. When `restrictToSrc` is set (used for model-produced edits, never for
 * the harness's own trusted exercise/testFiles materialization) the target
 * must additionally resolve under `dir/src`, so a model-emitted
 * `vitest.config.ts` or a new `tests/*.test.ts` cannot land outside the
 * sandboxed source tree and alter what `runTests` grades.
 */
function materialize(dir: string, files: FileMap, options?: { restrictToSrc?: boolean }): void {
  const dirResolved = resolve(dir)
  const srcRoot = resolve(dir, "src")
  for (const [relPath, content] of Object.entries(files)) {
    const abs = resolve(dir, relPath)
    if (!isContainedIn(dirResolved, abs)) {
      throw new ApplyError(`${relPath}: resolves outside the sandboxed workdir`)
    }
    if (options?.restrictToSrc && !isContainedIn(srcRoot, abs)) {
      throw new ApplyError(`${relPath}: writes must stay under src/`)
    }
    mkdirSync(dirname(abs), { recursive: true })
    writeFileSync(abs, content)
  }
}

function buildSystemPrompt(format: EditFormat): string {
  return `${SYSTEM_PREAMBLE}\n\n${format.formatInstructions}`
}

function buildUserPrompt(
  exercise: Exercise,
  format: EditFormat,
  currentFiles: FileMap,
  trailer: string | undefined
): string {
  const base = `${exercise.instructions}\n\n${format.renderFiles(currentFiles)}`
  return trailer === undefined ? base : `${base}\n\n${trailer}`
}

/**
 * Runs one exercise/format/model case against a `chat` function (real or
 * scripted) using aider's two-attempt-style loop: build a prompt from the
 * current files (plus feedback from the previous attempt, if any), ask the
 * model to edit, parse, apply, run tests, repeat until pass or the attempt
 * budget is exhausted.
 *
 * Attempt-consumption semantics: each pass through the loop is one attempt.
 * A ParseError or ApplyError consumes that attempt WITHOUT ever invoking the
 * test runner — the error message is fed back as the next prompt's trailer
 * and the loop continues. Only an attempt that reaches a successful parse
 * *and* apply pushes a boolean onto `tests_outcomes`. As a result
 * `tests_outcomes.length` can be shorter than `attemptBudget` — including
 * empty, if every attempt fails to parse or apply — and that is the correct,
 * expected shape, not an error condition to paper over with placeholder
 * `false` entries.
 */
export async function runCase(opts: RunCaseOptions): Promise<CaseResult> {
  const { exercise, format, chat, workRoot, attemptBudget, model, commit } = opts
  const testRunner = opts.testRunner ?? defaultRunTests
  const start = Date.now()

  mkdirSync(workRoot, { recursive: true })
  const workdir = mkdtempSync(join(workRoot, `${exercise.name}-${format.name}-`))
  materialize(workdir, exercise.files)
  materialize(workdir, exercise.testFiles)

  let currentFiles: FileMap = { ...exercise.files }
  const testsOutcomes: boolean[] = []
  let parseErrorSeen = false
  let applyErrorSeen = false
  let promptTokens = 0
  let completionTokens = 0
  let trailer: string | undefined

  for (let attempt = 1; attempt <= attemptBudget; attempt++) {
    const messages: ChatMessage[] = [
      { role: "system", content: buildSystemPrompt(format) },
      { role: "user", content: buildUserPrompt(exercise, format, currentFiles, trailer) }
    ]
    const response = await chat(messages)
    promptTokens += response.promptTokens
    completionTokens += response.completionTokens

    let edits
    try {
      edits = format.parse(response.text)
    } catch (err) {
      if (!(err instanceof ParseError)) throw err
      parseErrorSeen = true
      trailer = `Your previous response failed to parse: ${err.message}`
      continue
    }

    let applied: FileMap
    try {
      applied = format.apply(edits, currentFiles)
      // Model-controlled paths (parsed straight from the response) must stay
      // inside the sandbox and under src/ — a path-traversal or a write to a
      // test/config location is treated as an apply failure, same as a
      // malformed edit, not a crash.
      materialize(workdir, applied, { restrictToSrc: true })
    } catch (err) {
      if (!(err instanceof ApplyError)) throw err
      applyErrorSeen = true
      trailer = `Your previous edit failed to apply: ${err.message}`
      continue
    }

    currentFiles = applied
    // Re-copy pristine test files: a successful apply must never be allowed
    // to alter the tests it is about to be graded against.
    materialize(workdir, exercise.testFiles)

    const testResult = await testRunner(workdir)
    testsOutcomes.push(testResult.passed)
    if (testResult.passed) break
    trailer = `${FEEDBACK_LINE}\n\n${testResult.output}`
  }

  return {
    key: { exercise: exercise.name, format: format.name, model, attempt_budget: attemptBudget },
    tests_outcomes: testsOutcomes,
    parse_error: parseErrorSeen,
    apply_error: applyErrorSeen,
    prompt_tokens: promptTokens,
    completion_tokens: completionTokens,
    cost_usd: (promptTokens / 1_000_000) * PRICING.inputPerM + (completionTokens / 1_000_000) * PRICING.outputPerM,
    duration_ms: Date.now() - start,
    commit
  }
}
