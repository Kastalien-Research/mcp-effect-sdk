// Runs the agent-in-the-loop evals and writes the three GR-AGENT-* artifacts.
//
// This is opt-in and calls the Claude API. `pnpm run verify` never runs it and
// never needs a key: the artifacts under docs/agent-evidence/ are committed, and
// `check:agent-evidence` validates the committed files. Regenerate when the
// affordance surface changes.
//
// Usage: pnpm run eval:agent [--trials=3] [--models=a,b] [--max-iterations=12]
import { execFileSync } from "node:child_process"
import { mkdirSync } from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"
import * as Effect from "effect/Effect"
import * as NodeRuntime from "@effect/platform-node/NodeRuntime"

import { SCENARIOS, scenariosFor } from "./lib/agent-eval-scenarios.mjs"
import { runScenario } from "./lib/agent-eval-runner.mjs"
import { createClient, parseEvalArguments } from "./lib/anthropic-client.mjs"
import { buildEvidenceReport, readJsonFile, writeEvidence } from "./lib/evidence.mjs"
import { runScript } from "./lib/process.mjs"

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")
const evidenceDir = path.join(root, "docs/agent-evidence")
const schema = readJsonFile(path.join(evidenceDir, "agent-eval.schema.json"))

const runAgentEvals = Effect.gen(function* () {
  const options = parseEvalArguments()
  if (options.help) {
    console.log("Usage: pnpm run eval:agent [--trials=N] [--models=a,b] [--max-iterations=N]")
    return
  }

  const sdkCommit = execFileSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8" }).trim()

  // The model whose results carry the claim. A gap here is a gap in the
  // affordance surface, not in the model.
  const PRIMARY_MODEL = "claude-opus-5"

  // Each artifact must clear a stated bar, and `exitCode` reflects whether it did.
  // artifactResult() fails the requirement on any non-zero exit, so a regression
  // in affordance salience fails the readiness gate rather than being recorded as
  // a passing artifact with poor numbers inside it.
  //
  // The bar is structured rather than a flat percentage, because a flat
  // percentage across models measures model capability, and the requirement is
  // about the *surface*:
  //
  //   1. The primary model must pass every scenario on every trial. Any failure
  //      there means an affordance is genuinely not discoverable.
  //   2. Every scenario must be solvable by every model at least once. A scenario
  //      no floor model ever completes is a surface problem, not a model problem.
  //   3. Any model/scenario pair below 1.0 is recorded as a named gap. The
  //      artifact reports exact per-model rates; nothing is rounded up to "pass".
  //
  // GR-AGENT-003 additionally requires all five affordance paths to fire.
  const ARTIFACTS = [
    {
      file: "salience-audit.json",
      requirementId: "GR-AGENT-001",
      suite: "agent-salience",
      describe: "Affordances are discoverable and salient without prompt-side hints."
    },
    {
      file: "golden-transcripts.json",
      requirementId: "GR-AGENT-002",
      suite: "agent-task-completion",
      describe: "Representative tasks complete through MCP affordances."
    },
    {
      file: "affordance-observability.json",
      requirementId: "GR-AGENT-003",
      suite: "agent-observability",
      describe: "Offered, selected, ignored, retried, and failed paths are observable."
    }
  ]

  const client = createClient()
  mkdirSync(evidenceDir, { recursive: true })

  console.log(
    `Running ${SCENARIOS.length} scenarios x ${options.models.length} model(s) x ${options.trials} trial(s)\n` +
      `Models: ${options.models.join(", ")}`
  )

  const scenarioResults = new Map()
  for (const scenario of SCENARIOS) {
    console.log(`\n${scenario.id} (${scenario.server})`)
    scenarioResults.set(
      scenario.id,
      yield* Effect.promise(() =>
        runScenario({
          client,
          scenario,
          models: options.models,
          trials: options.trials,
          maxIterations: options.maxIterations
        })
      )
    )
  }

  /** Roll the five observable paths up across every trial of every scenario. */
  const observabilityCoverage = () => {
    const totals = { offered: 0, selected: 0, ignored: 0, retried: 0, failed: 0 }
    for (const result of scenarioResults.values()) {
      for (const trial of result.results) {
        for (const key of Object.keys(totals)) totals[key] += trial.affordances.counts[key] ?? 0
      }
    }
    return totals
  }

  let exitCode = 0
  for (const artifact of ARTIFACTS) {
    const relevant = scenariosFor(artifact.requirementId).map((scenario) => scenarioResults.get(scenario.id))
    const scenarios = relevant.map((result) => ({
      id: result.id,
      server: result.server,
      trials: result.trials,
      passed: result.passed,
      passRate: result.passRate,
      byModel: result.byModel,
      results: result.results.map((trial) => ({
        trial: trial.trial,
        model: trial.model,
        passed: trial.passed,
        reason: trial.reason,
        iterations: trial.iterations,
        stopReason: trial.stopReason,
        affordances: trial.affordances,
        traceEvents: trial.traceEvents,
        transcript: trial.transcript,
        usage: trial.usage
      }))
    }))

    const totalTrials = scenarios.reduce((sum, scenario) => sum + scenario.trials, 0)
    const totalPassed = scenarios.reduce((sum, scenario) => sum + scenario.passed, 0)
    const passRate = totalTrials === 0 ? 0 : totalPassed / totalTrials
    const coverage = observabilityCoverage()

    const primaryComplete = scenarios.every((scenario) => (scenario.byModel[PRIMARY_MODEL]?.passRate ?? 0) === 1)
    const everyScenarioSolvable = scenarios.every((scenario) =>
      Object.values(scenario.byModel).every((stats) => stats.passed > 0)
    )
    // Named, not hidden: any model/scenario pair that did not pass every trial is
    // written into the artifact so the gate's own evidence carries its caveats.
    const gaps = scenarios.flatMap((scenario) =>
      Object.entries(scenario.byModel)
        .filter(([, stats]) => stats.passRate < 1)
        .map(([model, stats]) => ({
          scenario: scenario.id,
          model,
          passed: stats.passed,
          trials: stats.trials,
          passRate: stats.passRate,
          reasons: [
            ...new Set(
              scenario.results.filter((trial) => trial.model === model && !trial.passed).map((trial) => trial.reason)
            )
          ]
        }))
    )

    // GR-AGENT-003 additionally requires all five paths to have been exercised;
    // a run where nothing ever failed proves nothing about the failure path.
    const pathsCovered = Object.values(coverage).every((count) => count > 0)
    const met = primaryComplete && everyScenarioSolvable && (artifact.requirementId !== "GR-AGENT-003" || pathsCovered)
    if (!met) exitCode = 1

    const report = buildEvidenceReport({
      evidenceKind: "agent-eval-result",
      command: "pnpm run eval:agent",
      exitCode: met ? 0 : 1,
      requirementIds: [artifact.requirementId],
      suite: artifact.suite,
      scenarios,
      summary: {
        description: artifact.describe,
        sdkCommit,
        models: options.models,
        trialsPerScenarioPerModel: options.trials,
        scenarioCount: scenarios.length,
        trials: totalTrials,
        passed: totalPassed,
        passRate,
        primaryModel: PRIMARY_MODEL,
        threshold: {
          primaryModelPassesEveryScenario: primaryComplete,
          everyScenarioSolvableByEveryModel: everyScenarioSolvable,
          allAffordancePathsExercised: pathsCovered
        },
        gaps,
        affordancePathCoverage: coverage,
        thresholdMet: met
      }
    })

    const targetPath = path.join(evidenceDir, artifact.file)
    writeEvidence({ targetPath, report, schema })
    console.log(
      `\n${artifact.file}: ${totalPassed}/${totalTrials} (${(passRate * 100).toFixed(0)}%) — ${met ? "meets" : "BELOW"} bar` +
        (gaps.length > 0
          ? `; ${gaps.length} named gap(s): ${gaps.map((g) => `${g.scenario}/${g.model}`).join(", ")}`
          : "")
    )
  }

  console.log(`\nAffordance path coverage: ${JSON.stringify(observabilityCoverage())}`)
  if (exitCode !== 0) {
    yield* Effect.fail(new Error("One or more agent eval artifacts failed gating thresholds"))
  }
})

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  NodeRuntime.runMain(runScript("run-agent-evals", runAgentEvals))
}
