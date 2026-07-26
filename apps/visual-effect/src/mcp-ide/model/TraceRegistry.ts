import type { McpNodeExecutionState } from "./McpTraceDocument"

export type McpTraceFamily = "wire" | "runtime" | "mrtr" | "tasks" | "apps"
export type McpTraceChannel = "mcp" | "effect" | "tasks" | "apps"

interface McpTraceEventDefinition {
  readonly family: McpTraceFamily
  readonly channel: McpTraceChannel
  readonly nodeState?: McpNodeExecutionState
}

const defineEvent = (definition: McpTraceEventDefinition): McpTraceEventDefinition => definition

/**
 * UI-independent normalized event contract. These are trace semantics, not MCP wire methods.
 * MRTR and Tasks remain separate families even when they project to the same visual state.
 */
export const traceEventRegistry = {
  "wire.message-sent": defineEvent({ family: "wire", channel: "mcp" }),
  "wire.message-received": defineEvent({ family: "wire", channel: "mcp" }),
  "runtime.started": defineEvent({
    family: "runtime",
    channel: "effect",
    nodeState: "active",
  }),
  "runtime.waiting": defineEvent({
    family: "runtime",
    channel: "effect",
    nodeState: "waiting",
  }),
  "runtime.completed": defineEvent({
    family: "runtime",
    channel: "effect",
    nodeState: "completed",
  }),
  "runtime.failed": defineEvent({
    family: "runtime",
    channel: "effect",
    nodeState: "failed",
  }),
  "runtime.cancelled": defineEvent({
    family: "runtime",
    channel: "effect",
    nodeState: "cancelled",
  }),
  "runtime.interrupted": defineEvent({
    family: "runtime",
    channel: "effect",
    nodeState: "interrupted",
  }),
  "mrtr.input-required": defineEvent({
    family: "mrtr",
    channel: "mcp",
    nodeState: "input-required",
  }),
  "mrtr.input-supplied": defineEvent({
    family: "mrtr",
    channel: "mcp",
    nodeState: "active",
  }),
  "mrtr.resumed": defineEvent({ family: "mrtr", channel: "mcp", nodeState: "active" }),
  "tasks.created": defineEvent({ family: "tasks", channel: "tasks", nodeState: "active" }),
  "tasks.waiting": defineEvent({ family: "tasks", channel: "tasks", nodeState: "waiting" }),
  "tasks.input-required": defineEvent({
    family: "tasks",
    channel: "tasks",
    nodeState: "input-required",
  }),
  "tasks.input-supplied": defineEvent({
    family: "tasks",
    channel: "tasks",
    nodeState: "active",
  }),
  "tasks.resumed": defineEvent({ family: "tasks", channel: "tasks", nodeState: "active" }),
  "tasks.completed": defineEvent({
    family: "tasks",
    channel: "tasks",
    nodeState: "completed",
  }),
  "tasks.failed": defineEvent({ family: "tasks", channel: "tasks", nodeState: "failed" }),
  "tasks.cancelled": defineEvent({
    family: "tasks",
    channel: "tasks",
    nodeState: "cancelled",
  }),
  "apps.resource-linked": defineEvent({ family: "apps", channel: "apps" }),
  "apps.view-loading": defineEvent({ family: "apps", channel: "apps", nodeState: "active" }),
  "apps.view-ready": defineEvent({ family: "apps", channel: "apps", nodeState: "completed" }),
  "apps.consent-allowed": defineEvent({ family: "apps", channel: "apps" }),
  "apps.consent-denied": defineEvent({ family: "apps", channel: "apps", nodeState: "failed" }),
  "apps.policy-allowed": defineEvent({ family: "apps", channel: "apps" }),
  "apps.policy-denied": defineEvent({ family: "apps", channel: "apps", nodeState: "failed" }),
  "apps.view-closed": defineEvent({ family: "apps", channel: "apps" }),
} as const satisfies Readonly<Record<string, McpTraceEventDefinition>>

export type McpTraceEventKind = keyof typeof traceEventRegistry

export const TRACE_EVENT_KINDS = Object.keys(traceEventRegistry) as ReadonlyArray<McpTraceEventKind>

export const isMcpTraceEventKind = (value: string): value is McpTraceEventKind =>
  Object.hasOwn(traceEventRegistry, value)

export const traceEventDefinition = (kind: McpTraceEventKind): McpTraceEventDefinition =>
  traceEventRegistry[kind]
