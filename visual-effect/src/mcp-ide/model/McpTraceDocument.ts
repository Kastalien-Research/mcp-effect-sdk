import { Data, Effect } from "effect"
import type { McpGraphDocument } from "./McpGraphDocument"

export const MCP_TRACE_SCHEMA_VERSION = "1" as const

export type McpTraceChannel = "mcp" | "effect" | "task" | "apps"

export type McpTraceEventKind =
  | "node.started"
  | "node.waiting"
  | "node.input-required"
  | "node.completed"
  | "node.failed"
  | "node.cancelled"
  | "node.interrupted"
  | "message.sent"
  | "message.received"

export interface McpTraceEvent {
  readonly id: string
  readonly sequence: number
  readonly atMs: number
  readonly nodeId: string
  readonly kind: McpTraceEventKind
  readonly channel: McpTraceChannel
  readonly summary: string
  readonly correlationId?: string
  readonly payload: Readonly<Record<string, unknown>>
}

export interface McpTraceDocument {
  readonly schemaVersion: typeof MCP_TRACE_SCHEMA_VERSION
  readonly id: string
  readonly graphId: string
  readonly name: string
  readonly events: ReadonlyArray<McpTraceEvent>
}

export type McpNodeExecutionState =
  | "idle"
  | "active"
  | "waiting"
  | "input-required"
  | "completed"
  | "failed"
  | "cancelled"
  | "interrupted"

export type McpTraceReplayStatus = "idle" | "running" | "completed" | "cancelled" | "failed"

export interface McpTraceSnapshot {
  readonly status: McpTraceReplayStatus
  readonly cursor: number
  readonly appliedEvents: ReadonlyArray<McpTraceEvent>
  readonly nodeStates: ReadonlyMap<string, McpNodeExecutionState>
}

export type McpTraceIssueCode =
  | "graph-id-mismatch"
  | "duplicate-event-id"
  | "duplicate-event-sequence"
  | "unknown-event-node"

export interface McpTraceIssue {
  readonly code: McpTraceIssueCode
  readonly path: string
  readonly message: string
}

export class McpTraceValidationError extends Data.TaggedError("McpTraceValidationError")<{
  readonly issues: ReadonlyArray<McpTraceIssue>
}> {}

export const validateTraceDocument = (
  graph: McpGraphDocument,
  trace: McpTraceDocument,
): Effect.Effect<McpTraceDocument, McpTraceValidationError> =>
  Effect.gen(function* () {
    const issues: Array<McpTraceIssue> = []
    const graphNodeIds = new Set(graph.nodes.map(node => node.id))
    const seenEventIds = new Set<string>()
    const duplicateEventIds = new Set<string>()
    const seenSequences = new Set<number>()
    const duplicateSequences = new Set<number>()

    if (trace.graphId !== graph.id) {
      issues.push({
        code: "graph-id-mismatch",
        path: "graphId",
        message: `Trace targets graph "${trace.graphId}" but the active graph is "${graph.id}"`,
      })
    }

    for (const event of trace.events) {
      if (seenEventIds.has(event.id)) duplicateEventIds.add(event.id)
      if (seenSequences.has(event.sequence)) duplicateSequences.add(event.sequence)
      seenEventIds.add(event.id)
      seenSequences.add(event.sequence)
    }

    for (const eventId of duplicateEventIds) {
      issues.push({
        code: "duplicate-event-id",
        path: `events.${eventId}`,
        message: `Trace event id "${eventId}" is used more than once`,
      })
    }

    for (const sequence of duplicateSequences) {
      issues.push({
        code: "duplicate-event-sequence",
        path: `events.sequence.${sequence}`,
        message: `Trace sequence ${sequence} is used more than once`,
      })
    }

    for (const event of trace.events) {
      if (!graphNodeIds.has(event.nodeId)) {
        issues.push({
          code: "unknown-event-node",
          path: `events.${event.id}.nodeId`,
          message: `Trace event "${event.id}" references unknown node "${event.nodeId}"`,
        })
      }
    }

    if (issues.length > 0) {
      return yield* new McpTraceValidationError({ issues })
    }

    return trace
  })
