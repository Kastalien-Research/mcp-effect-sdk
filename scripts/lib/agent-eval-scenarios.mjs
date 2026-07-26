// Scenario specifications for the agent-in-the-loop evals.
//
// Each proof server in examples/agent-facing-proof-servers.ts publishes a brief
// resource declaring its own success criteria — `expectedAffordance`,
// `goodAffordance`, `expectedRetry`, `requiredToolArgument`,
// `expectedToolArguments`, `allowedKinds`. Scoring reads those criteria and
// compares them against what the model actually did.
//
// That matters for the evidence: the model under test is the *subject*, never
// the judge. A scenario passes because the run objectively matched a criterion
// the fixture declared in advance, not because another model was asked whether
// the transcript looked convincing. Non-determinism is handled by running
// several trials and recording a pass rate, not by softening the criterion.

const parseBrief = (brief) => {
  try {
    return JSON.parse(brief?.text ?? "{}")
  } catch {
    return {}
  }
}

const toolCalls = (snapshot) => snapshot.selected.filter((entry) => entry.kind === "tool")
const firstIndexOf = (snapshot, kind, name) =>
  snapshot.selected.find((entry) => entry.kind === kind && entry.name === name)?.order ?? -1

export const SCENARIOS = [
  {
    id: "discover-and-choose",
    server: "discoverAndChooseEvalServer",
    // Salience: with several plausible affordances offered and no hint about
    // which one to use, does the model pick the one the fixture designates?
    requirements: ["GR-AGENT-001", "GR-AGENT-002"],
    task: (brief) => `${parseBrief(brief).goal} Use the tools available to you.`,
    score: ({ snapshot, brief }) => {
      const criteria = parseBrief(brief)
      const [expectedKind, expectedName] = String(criteria.expectedAffordance ?? "").split(":")
      const used = snapshot.selected.some((entry) => entry.kind === expectedKind && entry.name === expectedName)
      return {
        passed: used,
        reason: used
          ? `Selected the designated affordance ${criteria.expectedAffordance}.`
          : `Did not select ${criteria.expectedAffordance}; selected ${
              toolCalls(snapshot)
                .map((entry) => entry.name)
                .join(", ") || "nothing"
            }.`
      }
    }
  },
  {
    id: "ambiguous-affordance",
    server: "ambiguousAffordanceServer",
    // Two tools could plausibly apply; one is vague ("Processes a thing.").
    // A salient surface makes the specific one obviously correct.
    requirements: ["GR-AGENT-001", "GR-AGENT-002"],
    // The fixture's goal reads "Archive invoice inv-104 after confirming it is
    // paid", but the surface offers no way to verify payment status. A careful
    // agent correctly refuses to assert `paid: true` it cannot substantiate and
    // asks the caller — observed from claude-opus-5 during harness bring-up.
    // That is right behaviour, and it would make the scenario measure caution
    // rather than the ambiguity it exists to test. The caller therefore supplies
    // the confirmation the tool documents as its precondition. This is task
    // framing, not answer leakage: which of the two tools to use is still
    // entirely unstated.
    task: (brief) => ["You have already confirmed that invoice inv-104 is paid.", parseBrief(brief).goal].join(" "),
    score: ({ snapshot, brief }) => {
      const criteria = parseBrief(brief)
      const names = toolCalls(snapshot).map((entry) => entry.name)
      const usedGood = names.includes(criteria.goodAffordance)
      const usedAmbiguous = names.includes(criteria.ambiguousAffordance)
      return {
        passed: usedGood && !usedAmbiguous,
        reason: usedGood
          ? usedAmbiguous
            ? `Called the specific tool but also the ambiguous ${criteria.ambiguousAffordance}.`
            : `Chose ${criteria.goodAffordance} over the ambiguous alternative.`
          : `Did not call ${criteria.goodAffordance}; called ${names.join(", ") || "nothing"}.`
      }
    }
  },
  {
    id: "failure-recovery",
    server: "recoveryEvalServer",
    // The first argument shape is rejected by the server. GR-AGENT-003's
    // "retried" and "failed" paths only exist if the model reacts to the error.
    requirements: ["GR-AGENT-002", "GR-AGENT-003"],
    task: (brief) => {
      const criteria = parseBrief(brief)
      return [
        `Draft a support reply for ticket ${criteria.firstAttempt?.ticketId}`,
        `with a ${criteria.firstAttempt?.responseTone} tone.`,
        "If the tool rejects your arguments, read the error and correct them."
      ].join(" ")
    },
    score: ({ snapshot, brief }) => {
      const expected = parseBrief(brief).expectedRetry ?? {}
      const calls = toolCalls(snapshot)
      const sawFailure = calls.some((entry) => entry.isError)
      const recovered = calls.some(
        (entry) =>
          !entry.isError &&
          entry.input?.ticketId === expected.ticketId &&
          entry.input?.responseTone === expected.responseTone
      )
      return {
        passed: sawFailure && recovered,
        reason: recovered
          ? sawFailure
            ? "Failed once, read the error, and retried with the corrected arguments."
            : "Succeeded without exercising the failure path."
          : `Never reached the corrected arguments ${JSON.stringify(expected)}.`
      }
    }
  },
  {
    id: "resource-before-action",
    server: "resourceFirstTaskServer",
    // The tool cannot be called correctly without first reading the policy
    // resource. This is the "ignored resources" failure mode by construction.
    requirements: ["GR-AGENT-001", "GR-AGENT-002"],
    task: () =>
      [
        "Approve a deployment window.",
        "The server exposes resources as well as tools; consult whatever you need before acting."
      ].join(" "),
    score: ({ snapshot, brief }) => {
      const criteria = parseBrief(brief)
      const resourceOrder = firstIndexOf(snapshot, "resource", "eval://resource-first/policy")
      const call = toolCalls(snapshot).find((entry) => entry.name === "approve_deployment_window")
      const readFirst = resourceOrder !== -1 && (call === undefined || resourceOrder < call.order)
      const passedArgument = call?.input?.[criteria.requiredToolArgument] === criteria.policyVersion
      return {
        passed: readFirst && passedArgument && call?.isError === false,
        reason:
          call === undefined
            ? resourceOrder === -1
              ? "Neither read the policy resource nor called the tool."
              : "Read the policy resource but never called the tool."
            : !readFirst
              ? "Called the tool without reading the policy resource first."
              : passedArgument
                ? `Read the policy, then passed ${criteria.requiredToolArgument}=${criteria.policyVersion}.`
                : `Read the policy but passed ${criteria.requiredToolArgument}=${String(
                    call.input?.[criteria.requiredToolArgument]
                  )}.`
      }
    }
  },
  {
    id: "prompt-or-tool-choice",
    server: "promptOrToolChoiceServer",
    // Deterministic arithmetic belongs in the tool, not in the model's head.
    requirements: ["GR-AGENT-001", "GR-AGENT-002"],
    task: (brief) => parseBrief(brief).toolTask,
    score: ({ snapshot, brief }) => {
      const expected = parseBrief(brief).expectedToolArguments ?? {}
      const call = toolCalls(snapshot).find((entry) => entry.name === "calculate_sla_deadline")
      const matched =
        call !== undefined &&
        Object.entries(expected).every(([key, value]) => String(call.input?.[key]) === String(value))
      return {
        passed: matched && call?.isError === false,
        reason: matched
          ? "Used the deterministic tool with the exact expected arguments."
          : call === undefined
            ? "Answered without calling the calculation tool."
            : `Called the tool with ${JSON.stringify(call.input)}, expected ${JSON.stringify(expected)}.`
      }
    }
  },
  {
    id: "affordance-observability",
    server: "observabilityTraceServer",
    // Drives the server's own trace recorder so the five observable paths are
    // exercised against the SDK, not merely inferred from harness telemetry.
    requirements: ["GR-AGENT-003"],
    task: (brief) => {
      const criteria = parseBrief(brief)
      return [
        `Record one affordance trace event of each of these kinds using the ${criteria.recorderTool} tool:`,
        `${(criteria.allowedKinds ?? []).join(", ")}.`,
        "Use a short affordance name and reason for each.",
        "Then summarize the trace."
      ].join(" ")
    },
    score: ({ snapshot, brief, traceEvents }) => {
      const allowed = parseBrief(brief).allowedKinds ?? []
      const recordedKinds = new Set((traceEvents ?? []).map((event) => event.kind))
      const missing = allowed.filter((kind) => !recordedKinds.has(kind))
      const summarized = toolCalls(snapshot).some((entry) => entry.name === "summarize_affordance_trace")
      return {
        passed: missing.length === 0 && summarized,
        reason:
          missing.length === 0
            ? summarized
              ? `Recorded all ${allowed.length} trace kinds and summarized the trace.`
              : "Recorded all trace kinds but never summarized."
            : `Missing trace kinds: ${missing.join(", ")}.`
      }
    }
  }
]

export const scenariosFor = (requirementId) =>
  SCENARIOS.filter((scenario) => scenario.requirements.includes(requirementId))
