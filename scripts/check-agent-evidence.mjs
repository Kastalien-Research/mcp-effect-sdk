// Validates the committed GR-AGENT-* evidence artifacts.
//
// `readEvidenceArtifact` in the readiness checker validates only a generic
// six-field envelope for `agent-eval-result`, with no `additionalProperties`
// check and no per-kind validator — a hand-written stub would satisfy three
// blocking requirements while proving nothing. This gate is what makes that
// evidence falsifiable, so it runs in `verify` on every checkout, offline, with
// no API key.
import path from "node:path"
import { fileURLToPath } from "node:url"

import { createChecker } from "./lib/check.mjs"
import { schemaErrors } from "./lib/evidence.mjs"

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")
const checker = createChecker({ root, name: "Agent evidence check" })

const ARTIFACTS = [
  { file: "docs/agent-evidence/salience-audit.json", requirementId: "GR-AGENT-001" },
  { file: "docs/agent-evidence/golden-transcripts.json", requirementId: "GR-AGENT-002" },
  { file: "docs/agent-evidence/affordance-observability.json", requirementId: "GR-AGENT-003" }
]

const schema = checker.requireJson("docs/agent-evidence/agent-eval.schema.json")
const scenarioSource = checker.requireText("scripts/lib/agent-eval-scenarios.mjs")

for (const { file, requirementId } of ARTIFACTS) {
  const artifact = checker.requireJson(file)
  if (artifact === undefined || schema === undefined) continue

  for (const message of schemaErrors(schema, artifact)) {
    checker.fail(`${file}${message}`)
  }

  if (!artifact.requirementIds?.includes(requirementId)) {
    checker.fail(`${file} must map to ${requirementId}`)
  }

  // The envelope's exitCode is what the readiness checker acts on, so it has to
  // agree with the artifact's own verdict. A 0 beside `thresholdMet: false`
  // would be a silently passing regression.
  if (artifact.summary?.thresholdMet !== (artifact.exitCode === 0)) {
    checker.fail(
      `${file} exitCode ${artifact.exitCode} contradicts summary.thresholdMet ${artifact.summary?.thresholdMet}`
    )
  }

  // Totals must be arithmetically consistent with the per-scenario results, so
  // an artifact cannot claim a pass rate its own data does not support.
  const scenarios = artifact.scenarios ?? []
  const trials = scenarios.reduce((sum, scenario) => sum + (scenario.trials ?? 0), 0)
  const passed = scenarios.reduce((sum, scenario) => sum + (scenario.passed ?? 0), 0)
  if (trials !== artifact.summary?.trials || passed !== artifact.summary?.passed) {
    checker.fail(
      `${file} summary ${artifact.summary?.passed}/${artifact.summary?.trials} disagrees with scenario totals ${passed}/${trials}`
    )
  }
  for (const scenario of scenarios) {
    const perModel = Object.values(scenario.byModel ?? {})
    const modelTrials = perModel.reduce((sum, stats) => sum + (stats.trials ?? 0), 0)
    if (modelTrials !== scenario.trials) {
      checker.fail(`${file} scenario ${scenario.id} per-model trials ${modelTrials} disagree with ${scenario.trials}`)
    }
    if ((scenario.results ?? []).length !== scenario.trials) {
      checker.fail(
        `${file} scenario ${scenario.id} records ${scenario.results?.length} trials, claims ${scenario.trials}`
      )
    }
    // Every scenario must correspond to a real spec, so an artifact cannot
    // invent scenarios that were never run.
    if (!scenarioSource.includes(`id: "${scenario.id}"`)) {
      checker.fail(`${file} references unknown scenario ${scenario.id}`)
    }
  }

  // Every gap the run found must be present. Dropping the caveats from a
  // passing artifact is the failure mode this guards.
  const expectedGaps = scenarios.flatMap((scenario) =>
    Object.entries(scenario.byModel ?? {})
      .filter(([, stats]) => stats.passRate < 1)
      .map(([model]) => `${scenario.id}/${model}`)
  )
  const recordedGaps = new Set((artifact.summary?.gaps ?? []).map((gap) => `${gap.scenario}/${gap.model}`))
  for (const gap of expectedGaps) {
    if (!recordedGaps.has(gap)) checker.fail(`${file} omits the observed gap ${gap} from summary.gaps`)
  }

  // Secrets must never reach a committed transcript.
  if (/sk-ant-[A-Za-z0-9_-]{8,}/.test(JSON.stringify(artifact))) {
    checker.fail(`${file} contains something shaped like an API key`)
  }
}

checker.report("Agent evidence check passed.")
