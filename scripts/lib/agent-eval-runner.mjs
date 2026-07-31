// Runs one scenario against one model, N times, and scores each trial.
import { betaTool } from "@anthropic-ai/sdk/helpers/beta/json-schema"

import { cacheableSystem, modelParameters, redact, usageTotals } from "./anthropic-client.mjs"
import {
  createAffordanceRecorder,
  describeAffordances,
  hostProofServer,
  readBrief,
  readResource,
  resourceAndPromptTools,
  toAnthropicTools
} from "./mcp-agent-harness.mjs"

// Deliberately spare. The point of GR-AGENT-001 is whether the *affordances*
// are discoverable, so the system prompt must not hint at which one to use, name
// any tool, or describe the task. Any nudge here would be measuring the prompt
// rather than the surface.
const SYSTEM_PROMPT = [
  "You are an agent connected to a Model Context Protocol server.",
  "Complete the user's task using only the tools you have been given.",
  "Inspect the available affordances and choose appropriately.",
  "If a tool returns an error, read it and correct your call.",
  "Stop once the task is done."
].join(" ")

const textOf = (message) =>
  (message.content ?? [])
    .filter((block) => block.type === "text")
    .map((block) => block.text)
    .join("")

/** One trial: fresh server, fresh conversation, scored against the fixture. */
export async function runTrial({ client, scenario, model, trialIndex, maxIterations }) {
  const host = await hostProofServer(scenario.server)
  const affordances = await describeAffordances(host)
  const brief = await readBrief(host, affordances)
  const recorder = createAffordanceRecorder(affordances)

  const tools = [
    ...toAnthropicTools(host, affordances, recorder, betaTool),
    ...resourceAndPromptTools(host, affordances, recorder, betaTool)
  ]

  const transcript = []
  const usages = []
  let iterations = 0
  let stopReason
  let error

  try {
    const runner = client.beta.messages.toolRunner({
      model,
      max_tokens: 8192,
      ...modelParameters(model),
      // The system prompt and tool list are byte-identical across every trial
      // of every scenario, so they are the cache prefix; the task text varies
      // and comes after.
      system: cacheableSystem(SYSTEM_PROMPT),
      tools,
      messages: [{ role: "user", content: scenario.task(brief) }],
      max_iterations: maxIterations
    })

    for await (const message of runner) {
      iterations += 1
      usages.push(message.usage)
      stopReason = message.stop_reason
      const text = textOf(message)
      if (text.trim() !== "") transcript.push({ role: "assistant", text: redact(text) })
      for (const block of message.content ?? []) {
        if (block.type === "tool_use") {
          transcript.push({ role: "tool_use", name: block.name, input: block.input })
        }
      }
      // The tool runner does not auto-resume a paused turn; without this the
      // loop would end early and read as a scenario failure.
      if (message.stop_reason === "pause_turn") {
        runner.pushMessages({ role: "assistant", content: message.content })
      }
    }
  } catch (caught) {
    error = redact(caught instanceof Error ? caught.message : String(caught))
  }

  // The observability fixture records its own trace server-side; read it back
  // so scoring sees the SDK's view, not only the harness's.
  let traceEvents
  if (affordances.resources.some((resource) => resource.uri === "eval://observability/trace")) {
    try {
      const raw = await readResource(host, "eval://observability/trace")
      traceEvents = JSON.parse(raw).events ?? []
    } catch {
      traceEvents = []
    }
  }

  const snapshot = recorder.snapshot()
  const scored =
    error === undefined ? scenario.score({ snapshot, brief, traceEvents }) : { passed: false, reason: error }

  return {
    trial: trialIndex,
    model,
    passed: scored.passed,
    reason: scored.reason,
    iterations,
    stopReason,
    affordances: snapshot,
    traceEvents,
    transcript,
    usage: usageTotals(usages)
  }
}

export async function runScenario({ client, scenario, models, trials, maxIterations }) {
  const results = []
  for (const model of models) {
    for (let trialIndex = 1; trialIndex <= trials; trialIndex += 1) {
      const result = await runTrial({ client, scenario, model, trialIndex, maxIterations })
      results.push(result)
      const mark = result.passed ? "pass" : "FAIL"
      console.log(`  ${scenario.id} ${model} trial ${trialIndex}/${trials}: ${mark} — ${result.reason}`)
    }
  }
  const byModel = {}
  for (const model of models) {
    const modelResults = results.filter((result) => result.model === model)
    const passed = modelResults.filter((result) => result.passed).length
    byModel[model] = { trials: modelResults.length, passed, passRate: passed / modelResults.length }
  }
  const passed = results.filter((result) => result.passed).length
  return {
    id: scenario.id,
    server: scenario.server,
    requirements: scenario.requirements,
    trials: results.length,
    passed,
    passRate: passed / results.length,
    byModel,
    results
  }
}
