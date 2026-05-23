import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"
import * as Schema from "effect/Schema"
import * as McpSchema from "../McpSchema.js"
import * as McpServer from "../McpServer.js"

type TraceEventKind = "offered" | "selected" | "ignored" | "retried" | "failed"

interface TraceEvent {
  readonly kind: TraceEventKind
  readonly affordance: string
  readonly reason: string
}

const text = (value: string): McpSchema.TextContent =>
  McpSchema.TextContent.makeUnsafe({ type: "text", text: value })

const promptMessage = (value: string): McpSchema.PromptMessage =>
  McpSchema.PromptMessage.makeUnsafe({ role: "user", content: text(value) })

const toolError = (value: string): McpSchema.CallToolResult =>
  new McpSchema.CallToolResult({
    isError: true,
    content: [text(value)]
  })

const json = (value: unknown): string => JSON.stringify(value, null, 2)

const jsonResource = (
  uri: string,
  value: unknown
): typeof McpSchema.ReadResourceResult.Type => ({
  contents: [{
    uri,
    mimeType: "application/json",
    text: json(value)
  }]
})

const validTraceKinds = new Set<TraceEventKind>([
  "offered",
  "selected",
  "ignored",
  "retried",
  "failed"
])

const isTraceEventKind = (value: string): value is TraceEventKind =>
  validTraceKinds.has(value as TraceEventKind)

export const discoverAndChooseEvalServer = Layer.effectDiscard(
  Effect.gen(function*() {
    yield* registerDiscoverAndChooseGoal()
    yield* registerDiscoverAndChooseAffordances()
  })
)

const registerDiscoverAndChooseGoal = (): Effect.Effect<void, never, McpServer.McpServer> =>
  McpServer.registerResource({
    uri: "eval://discover-and-choose/goal",
    name: "Discover and choose eval goal",
    description: "Task brief that should be solved by inspecting available affordances first.",
    mimeType: "application/json",
    audience: ["assistant"],
    priority: 1,
    content: Effect.succeed(jsonResource("eval://discover-and-choose/goal", {
      goal: "Prepare a launch checklist for project atlas.",
      expectedAffordance: "tool:create_launch_checklist",
      distractors: ["resource:eval://discover-and-choose/archive", "prompt:summarize_release"]
    }))
  })

const registerDiscoverAndChooseAffordances = (): Effect.Effect<void, never, McpServer.McpServer> =>
  Effect.gen(function*() {
    yield* McpServer.registerResource({
      uri: "eval://discover-and-choose/archive",
      name: "Historical launch archive",
      description: "Older launch notes that are intentionally insufficient for the current goal.",
      mimeType: "text/plain",
      content: Effect.succeed("Archived launch notes for retired projects. Do not use for atlas.")
    })
    yield* McpServer.registerPrompt({
      name: "summarize_release",
      description: "Drafts a release summary when the source release notes are already known.",
      parameters: { release: Schema.String },
      content: ({ release }) => Effect.succeed(`Summarize the release notes for ${release}.`)
    })
    yield* McpServer.registerTool({
      name: "create_launch_checklist",
      description: "Creates the required launch checklist from a project name.",
      parameters: { project: Schema.String },
      content: ({ project }) =>
        Effect.succeed([
          text(`Launch checklist for ${project}: owner, rollback plan, metrics, comms.`)
        ])
    })
  })

export const ambiguousAffordanceServer = Layer.effectDiscard(
  Effect.gen(function*() {
    yield* registerAmbiguousAffordanceBrief()
    yield* registerAmbiguousAffordanceTools()
  })
)

const registerAmbiguousAffordanceBrief = (): Effect.Effect<void, never, McpServer.McpServer> =>
  McpServer.registerResource({
    uri: "eval://ambiguous-affordance/brief",
    name: "Ambiguous affordance eval brief",
    description: "Explains which good and bad affordance labels are present.",
    mimeType: "application/json",
    audience: ["assistant"],
    priority: 1,
    content: Effect.succeed(jsonResource("eval://ambiguous-affordance/brief", {
      goal: "Archive invoice inv-104 after confirming it is paid.",
      goodAffordance: "archive_paid_invoice",
      ambiguousAffordance: "process"
    }))
  })

const registerAmbiguousAffordanceTools = (): Effect.Effect<void, never, McpServer.McpServer> =>
  Effect.gen(function*() {
    yield* McpServer.registerTool({
      name: "process",
      description: "Processes a thing.",
      parameters: { value: Schema.String },
      content: ({ value }) => Effect.succeed(`Processed ${value}, but the operation is ambiguous.`)
    })
    yield* McpServer.registerTool({
      name: "archive_paid_invoice",
      description: "Archives a paid invoice only after the caller confirms its paid status.",
      parameters: {
        invoiceId: Schema.String,
        paid: Schema.Boolean
      },
      content: ({ invoiceId, paid }) =>
        paid
          ? Effect.succeed(`Archived paid invoice ${invoiceId}.`)
          : Effect.succeed(toolError(`Invoice ${invoiceId} was not archived because paid=false.`))
    })
  })

export const recoveryEvalServer = Layer.effectDiscard(
  Effect.gen(function*() {
    yield* registerRecoveryBrief()
    yield* registerRecoveryTool()
  })
)

const registerRecoveryBrief = (): Effect.Effect<void, never, McpServer.McpServer> =>
  McpServer.registerResource({
    uri: "eval://recovery/case",
    name: "Recovery eval case",
    description: "Contains the task and the correct retry arguments after a validation error.",
    mimeType: "application/json",
    audience: ["assistant"],
    priority: 1,
    content: Effect.succeed(jsonResource("eval://recovery/case", {
      firstAttempt: { ticketId: "42", responseTone: "brief" },
      expectedRetry: { ticketId: "TCK-42", responseTone: "calm" }
    }))
  })

const registerRecoveryTool = (): Effect.Effect<void, never, McpServer.McpServer> =>
  McpServer.registerTool({
    name: "draft_support_reply",
    description: "Drafts a support reply. ticketId must use TCK-<number> and tone must be calm.",
    parameters: {
      ticketId: Schema.String,
      responseTone: Schema.String
    },
    content: ({ ticketId, responseTone }) => {
      if (!ticketId.startsWith("TCK-")) {
        return Effect.succeed(toolError("Invalid ticketId. Retry with the TCK-<number> format."))
      }
      if (responseTone !== "calm") {
        return Effect.succeed(toolError("Invalid responseTone. Retry with responseTone=calm."))
      }
      return Effect.succeed(`Drafted calm support reply for ${ticketId}.`)
    }
  })

export const resourceFirstTaskServer = Layer.effectDiscard(
  Effect.gen(function*() {
    yield* registerResourceFirstContext()
    yield* registerResourceFirstTool()
  })
)

const registerResourceFirstContext = (): Effect.Effect<void, never, McpServer.McpServer> =>
  McpServer.registerResource({
    uri: "eval://resource-first/policy",
    name: "Deployment policy",
    description: "Policy context required before calling approve_deployment_window.",
    mimeType: "application/json",
    audience: ["assistant"],
    priority: 1,
    content: Effect.succeed(jsonResource("eval://resource-first/policy", {
      policyVersion: "deploy-2026-05",
      allowedWindow: "Tuesday 14:00-16:00 UTC",
      requiredToolArgument: "policyVersion"
    }))
  })

const registerResourceFirstTool = (): Effect.Effect<void, never, McpServer.McpServer> =>
  McpServer.registerTool({
    name: "approve_deployment_window",
    description: "Approves a deployment window only when called with the policy version.",
    parameters: {
      service: Schema.String,
      policyVersion: Schema.String
    },
    content: ({ service, policyVersion }) => {
      if (policyVersion !== "deploy-2026-05") {
        return Effect.succeed(toolError(
          "Read eval://resource-first/policy and retry with its policyVersion."
        ))
      }
      return Effect.succeed(`Approved deployment window for ${service} under ${policyVersion}.`)
    }
  })

export const promptOrToolChoiceServer = Layer.effectDiscard(
  Effect.gen(function*() {
    yield* registerPromptOrToolBrief()
    yield* registerPromptOrToolAffordances()
  })
)

const registerPromptOrToolBrief = (): Effect.Effect<void, never, McpServer.McpServer> =>
  McpServer.registerResource({
    uri: "eval://prompt-or-tool/brief",
    name: "Prompt or tool choice brief",
    description: "Contains tasks where one should use a prompt and one should use a tool.",
    mimeType: "application/json",
    audience: ["assistant"],
    priority: 1,
    content: Effect.succeed(jsonResource("eval://prompt-or-tool/brief", {
      promptTask: "Draft an incident update for incident inc-7.",
      toolTask: [
        "Calculate the SLA deadline from start time 2026-05-22T10:00:00Z",
        "using a duration of 120 minutes."
      ].join(" "),
      expectedToolArguments: {
        startIso: "2026-05-22T10:00:00Z",
        durationMinutes: 120
      }
    }))
  })

const registerPromptOrToolAffordances = (): Effect.Effect<void, never, McpServer.McpServer> =>
  Effect.gen(function*() {
    yield* McpServer.registerPrompt({
      name: "draft_incident_update",
      description: "Creates a user-facing incident update draft from incident facts.",
      parameters: {
        incidentId: Schema.String,
        impact: Schema.String
      },
      content: ({ incidentId, impact }) =>
        Effect.succeed([
          promptMessage(`Draft a concise incident update for ${incidentId}. Impact: ${impact}.`)
        ])
    })
    yield* McpServer.registerTool({
      name: "calculate_sla_deadline",
      description: "Calculates an SLA deadline by adding minutes to an ISO start time.",
      parameters: {
        startIso: Schema.String,
        durationMinutes: Schema.Number
      },
      content: ({ startIso, durationMinutes }) => {
        const start = Date.parse(startIso)
        if (!Number.isFinite(start)) {
          return Effect.succeed(toolError("startIso must be a valid ISO timestamp."))
        }
        const deadline = new Date(start + durationMinutes * 60_000).toISOString()
        return Effect.succeed(`SLA deadline: ${deadline}`)
      }
    })
  })

export const observabilityTraceServer = Layer.effectDiscard(
  Effect.gen(function*() {
    const events: Array<TraceEvent> = [
      {
        kind: "offered",
        affordance: "resource:eval://observability/brief",
        reason: "Initial task context"
      },
      { kind: "offered", affordance: "tool:record_affordance_event", reason: "Trace recorder" }
    ]
    yield* registerObservabilityBrief()
    yield* registerObservabilityTraceResource(events)
    yield* registerObservabilityTraceTools(events)
  })
)

const registerObservabilityBrief = (): Effect.Effect<void, never, McpServer.McpServer> =>
  McpServer.registerResource({
    uri: "eval://observability/brief",
    name: "Observability trace brief",
    description: "Explains how to record selected, ignored, retried, and failed affordances.",
    mimeType: "application/json",
    audience: ["assistant"],
    priority: 1,
    content: Effect.succeed(jsonResource("eval://observability/brief", {
      traceResource: "eval://observability/trace",
      recorderTool: "record_affordance_event",
      allowedKinds: [...validTraceKinds]
    }))
  })

const registerObservabilityTraceResource = (
  events: ReadonlyArray<TraceEvent>
): Effect.Effect<void, never, McpServer.McpServer> =>
  McpServer.registerResource({
    uri: "eval://observability/trace",
    name: "Affordance decision trace",
    description: "Machine-readable trace of affordance decisions.",
    mimeType: "application/json",
    audience: ["assistant"],
    priority: 1,
    content: Effect.sync(() => jsonResource("eval://observability/trace", { events }))
  })

const registerObservabilityTraceTools = (
  events: Array<TraceEvent>
): Effect.Effect<void, never, McpServer.McpServer> =>
  Effect.gen(function*() {
    yield* McpServer.registerTool({
      name: "record_affordance_event",
      description: "Records one affordance trace event for the trace resource.",
      parameters: {
        kind: Schema.String,
        affordance: Schema.String,
        reason: Schema.String
      },
      content: ({ kind, affordance, reason }) => {
        if (!isTraceEventKind(kind)) {
          const expected = [...validTraceKinds].join(", ")
          return Effect.succeed(toolError(`kind must be one of: ${expected}.`))
        }
        events.push({ kind, affordance, reason })
        return Effect.succeed(`Recorded ${kind} event for ${affordance}.`)
      }
    })
    yield* McpServer.registerTool({
      name: "summarize_affordance_trace",
      description: "Returns a compact count of recorded affordance trace event kinds.",
      content: () => Effect.succeed(json(countTraceEvents(events)))
    })
  })

const countTraceEvents = (events: ReadonlyArray<TraceEvent>): Record<TraceEventKind, number> => {
  const counts: Record<TraceEventKind, number> = {
    offered: 0,
    selected: 0,
    ignored: 0,
    retried: 0,
    failed: 0
  }
  for (const event of events) {
    counts[event.kind] += 1
  }
  return counts
}
