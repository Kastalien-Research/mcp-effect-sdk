import { execFileSync } from "node:child_process"
import { mkdirSync, writeFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { MERCURY_MODEL } from "../lib/constants.js"
import { loadEnv, mercuryConfig } from "../lib/env.js"
import type { MercuryConfig } from "../lib/env.js"
import { mercuryFetch } from "../lib/mercury.js"
import type { Exercise } from "./corpus.js"
import { listExercises } from "./corpus.js"
import { searchReplace } from "./formats/search-replace.js"
import type { EditFormat } from "./formats/types.js"
import { whole } from "./formats/whole.js"
import { aggregate, variants } from "./metrics.js"
import { loadOrRun } from "./results.js"
import type { CaseKey, CaseResult } from "./results.js"
import { runCase } from "./runner.js"
import type { ChatFn } from "./runner.js"
import { traced } from "./tracing.js"

const packageRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..")

const KNOWN_FORMATS: Record<string, EditFormat> = {
  whole,
  "search-replace": searchReplace
}

const RED = "\x1b[31m"
const RESET = "\x1b[0m"

interface CampaignArgs {
  run: string
  formats: string[]
  budget: number
  allowMixed: boolean
  dryRun: boolean
  only?: string
}

function parseArgs(argv: string[]): CampaignArgs {
  let run: string | undefined
  let formatsArg = "whole,search-replace"
  let budget = 2
  let allowMixed = false
  let dryRun = false
  let only: string | undefined
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]
    if (arg === "--run") run = argv[++i]
    else if (arg === "--formats") formatsArg = argv[++i] ?? formatsArg
    else if (arg === "--budget") budget = Number(argv[++i])
    else if (arg === "--allow-mixed") allowMixed = true
    else if (arg === "--dry-run") dryRun = true
    else if (arg === "--only") only = argv[++i]
  }
  if (!run) throw new Error("--run <runId> is required")
  if (!Number.isFinite(budget) || budget < 1) throw new Error("--budget must be a positive integer")
  const formats = formatsArg
    .split(",")
    .map((f) => f.trim())
    .filter((f) => f.length > 0)
  for (const f of formats) {
    if (!(f in KNOWN_FORMATS)) throw new Error(`unknown format: ${f}`)
  }
  return { run, formats, budget, allowMixed, dryRun, only }
}

function getCommit(): string {
  try {
    return execFileSync("git", ["rev-parse", "--short", "HEAD"], { cwd: packageRoot }).toString().trim()
  } catch {
    return "unknown"
  }
}

function makeMercuryChat(cfg: MercuryConfig): ChatFn {
  const rawChat: ChatFn = async (messages) => {
    const res = await mercuryFetch(cfg, "/chat/completions", {
      model: MERCURY_MODEL,
      messages,
      reasoning_effort: "low",
      temperature: 0.2
    })
    if (!res.ok) {
      throw new Error(`Mercury chat request failed: HTTP ${res.status}: ${await res.text()}`)
    }
    const body = (await res.json()) as {
      choices?: Array<{ message?: { content?: string } }>
      usage?: { prompt_tokens?: number; completion_tokens?: number }
    }
    return {
      text: body.choices?.[0]?.message?.content ?? "",
      promptTokens: body.usage?.prompt_tokens ?? 0,
      completionTokens: body.usage?.completion_tokens ?? 0
    }
  }
  // "llm" run type + usage_metadata on the (logged-only) processed outputs is
  // what LangSmith reads to attach token counts/cost to the trace; the actual
  // returned value (consumed by runner.ts) is untouched.
  return traced("mercury-chat", rawChat, {
    runType: "llm",
    processOutputs: (outputs: { text: string; promptTokens: number; completionTokens: number }) => ({
      outputs: { text: outputs.text },
      usage_metadata: {
        input_tokens: outputs.promptTokens,
        output_tokens: outputs.completionTokens,
        total_tokens: outputs.promptTokens + outputs.completionTokens
      }
    })
  })
}

// The dry-run stand-in for the "luhn" exercise: a known-correct implementation,
// verified against the corpus's own test cases before being embedded here.
const LUHN_SOLUTION = `export function valid(digits: string): boolean {
  const trimmed = digits.replace(/ /g, "")
  if (trimmed.length <= 1) return false
  if (!/^[0-9]+$/.test(trimmed)) return false
  let sum = 0
  for (let i = 0; i < trimmed.length; i++) {
    let digit = Number(trimmed[trimmed.length - 1 - i])
    if (i % 2 === 1) {
      digit *= 2
      if (digit > 9) digit -= 9
    }
    sum += digit
  }
  return sum % 10 === 0
}
`

const SCRIPTED_PATH = "src/index.ts"

// Offline scripted ChatFn for --dry-run: returns the fixed correct solution
// for "luhn" and a well-formed no-op edit (unchanged content) for every other
// exercise, so those exercises stay well-formed but keep failing their own
// stub implementation, exactly as their tests_outcomes should show.
function makeDryRunChat(exercise: Exercise, format: EditFormat): ChatFn {
  const original = exercise.files[SCRIPTED_PATH] ?? ""
  const newContent = exercise.name === "luhn" ? LUHN_SOLUTION : original
  const text =
    format.name === "search-replace"
      ? `${SCRIPTED_PATH}\n<<<<<<< SEARCH\n${original}\n=======\n${newContent}\n>>>>>>> REPLACE\n`
      : `${SCRIPTED_PATH}\n\`\`\`ts\n${newContent}\n\`\`\`\n`
  return async () => ({ text, promptTokens: 0, completionTokens: 0 })
}

function printSummaryTable(summary: ReturnType<typeof aggregate>): void {
  const cols = [
    "format",
    "cases",
    "pass@1",
    "pass@2",
    "parse_err",
    "apply_err",
    "well_formed",
    "mean_cost_usd",
    "mean_ms"
  ]
  console.log(cols.join("\t"))
  for (const [format, s] of Object.entries(summary.byFormat)) {
    console.log(
      [
        format,
        s.cases,
        s.pass_rate_1.toFixed(2),
        s.pass_rate_2.toFixed(2),
        s.parse_error_rate.toFixed(2),
        s.apply_error_rate.toFixed(2),
        s.well_formed_rate.toFixed(2),
        s.mean_cost_usd.toFixed(4),
        s.mean_duration_ms.toFixed(0)
      ].join("\t")
    )
  }
}

async function runCampaignBody(args: CampaignArgs): Promise<{ results: CaseResult[]; exitCode: number }> {
  const runDir = join(packageRoot, "runs", args.run)
  const workRoot = join(runDir, "work")
  mkdirSync(runDir, { recursive: true })

  const model = args.dryRun ? "dry-run" : MERCURY_MODEL
  const commit = getCommit()
  const cfg = args.dryRun ? undefined : mercuryConfig(loadEnv(join(packageRoot, "..", "..", "..", "..")))

  const allExercises = await listExercises()
  const exercises = args.only ? allExercises.filter((e) => e.name === args.only) : allExercises
  if (args.only && exercises.length === 0) throw new Error(`--only: no exercise named "${args.only}"`)
  const results: CaseResult[] = []

  for (const exercise of exercises) {
    for (const formatName of args.formats) {
      const format = KNOWN_FORMATS[formatName]
      if (!format) throw new Error(`unknown format: ${formatName}`)
      const chat: ChatFn = args.dryRun ? makeDryRunChat(exercise, format) : makeMercuryChat(cfg!)
      const key: CaseKey = {
        exercise: exercise.name,
        format: format.name,
        model,
        attempt_budget: args.budget
      }
      const tracedRunCase = traced(
        `case:${exercise.name}:${format.name}`,
        () =>
          runCase({
            exercise,
            format,
            chat,
            workRoot,
            attemptBudget: args.budget,
            model,
            commit
          }),
        { runType: "chain" }
      )
      const { result } = await loadOrRun(runDir, key, commit, tracedRunCase)
      results.push(result)
    }
  }

  const summary = aggregate(results)
  printSummaryTable(summary)
  writeFileSync(join(runDir, "summary.json"), JSON.stringify(summary, null, 2))

  const v = variants(results)
  let exitCode = 0
  if (v.mixed) {
    const msg = `mixed variants detected: models=[${v.models.join(", ")}] commits=[${v.commits.join(", ")}]`
    if (args.allowMixed) {
      console.warn(`${RED}${msg}${RESET}`)
    } else {
      console.error(`${RED}${msg}${RESET}`)
      exitCode = 1
    }
  }

  return { results, exitCode }
}

export async function runCampaign(args: CampaignArgs): Promise<{ results: CaseResult[]; exitCode: number }> {
  const tracedCampaign = traced("campaign", runCampaignBody, { runType: "chain" })
  return tracedCampaign(args)
}

// `traced()` decides identity-vs-traceable synchronously at wrap time (before
// any campaign/case body runs), so LANGSMITH_* must land in process.env here,
// before runCampaign() is called — loading it later, inside the campaign
// body, would be too late for the wrapping decision already made.
function seedLangsmithEnv(): void {
  const envFile = loadEnv(join(packageRoot, "..", "..", "..", ".."))
  for (const k of ["LANGSMITH_TRACING", "LANGSMITH_API_KEY", "LANGSMITH_ENDPOINT", "LANGSMITH_PROJECT"]) {
    if (envFile[k] !== undefined && process.env[k] === undefined) process.env[k] = envFile[k]
  }
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2))
  seedLangsmithEnv()
  const { exitCode } = await runCampaign(args)
  process.exitCode = exitCode
}

const isMain = process.argv[1] !== undefined && import.meta.url === `file://${process.argv[1]}`
if (isMain) {
  main().catch((err) => {
    console.error(err instanceof Error ? err.message : String(err))
    process.exitCode = 1
  })
}
