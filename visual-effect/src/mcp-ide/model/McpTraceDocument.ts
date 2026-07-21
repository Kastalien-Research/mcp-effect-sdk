import { Data, Effect } from "effect"
import type { McpGraphDocument } from "./McpGraphDocument"
import {
  type McpTraceChannel,
  type McpTraceEventKind,
  type McpTraceFamily,
  traceEventDefinition,
} from "./TraceRegistry"

export const MCP_TRACE_SCHEMA_VERSION = "2" as const

export type { McpTraceChannel, McpTraceEventKind, McpTraceFamily }

export interface McpTraceProtocolMetadata {
  readonly direction?: "send" | "receive"
  readonly jsonrpc?: string
  readonly requestId?: string | number | null
  readonly method?: string
  readonly headers?: Readonly<Record<string, unknown>>
}

export interface McpTraceRuntimeMetadata {
  readonly phase?: string
  readonly fiberId?: string
  readonly scopeId?: string
  readonly cause?: unknown
}

export interface McpTraceEvent {
  readonly id: string
  readonly sequence: number
  readonly atMs: number
  readonly nodeId: string
  readonly edgeId?: string
  readonly kind: McpTraceEventKind
  readonly family: McpTraceFamily
  readonly channel: McpTraceChannel
  readonly summary: string
  readonly correlationId?: string
  readonly spanId?: string
  readonly parentSpanId?: string
  readonly protocol?: McpTraceProtocolMetadata
  readonly runtime?: McpTraceRuntimeMetadata
  readonly payload: Readonly<Record<string, unknown>>
}

export type McpTraceRedactionReason =
  | "sensitive-header"
  | "header-not-allowlisted"
  | "sensitive-key"
  | "explicit-sensitive-value"

export interface McpTraceRedactionRecord {
  readonly eventId: string
  readonly path: string
  readonly reason: McpTraceRedactionReason
}

export interface McpTraceLegacyRebind {
  readonly kind: "legacy-v1-rebind"
  readonly sourceGraphId: string
  readonly targetGraphId: string
  readonly targetGraphRevision: string
}

export interface McpTraceProvenance {
  readonly redactionPolicy: "allowlist-v1"
  readonly redactions: ReadonlyArray<McpTraceRedactionRecord>
  readonly migrations: ReadonlyArray<McpTraceLegacyRebind>
}

export interface McpTraceDocument {
  readonly schemaVersion: typeof MCP_TRACE_SCHEMA_VERSION
  readonly id: string
  readonly graphId: string
  readonly graphRevision: string
  readonly name: string
  readonly provenance: McpTraceProvenance
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
  | "graph-revision-mismatch"
  | "duplicate-event-id"
  | "duplicate-event-sequence"
  | "unknown-event-node"
  | "unknown-event-edge"
  | "event-family-mismatch"
  | "event-channel-mismatch"

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
    const graphEdgeIds = new Set(graph.edges.map(edge => edge.id))
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

    if (trace.graphRevision !== graph.revision) {
      issues.push({
        code: "graph-revision-mismatch",
        path: "graphRevision",
        message: `Trace targets graph revision "${trace.graphRevision}" but the active revision is "${graph.revision}"`,
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

      if (event.edgeId !== undefined && !graphEdgeIds.has(event.edgeId)) {
        issues.push({
          code: "unknown-event-edge",
          path: `events.${event.id}.edgeId`,
          message: `Trace event "${event.id}" references unknown edge "${event.edgeId}"`,
        })
      }

      const definition = traceEventDefinition(event.kind)
      if (event.family !== definition.family) {
        issues.push({
          code: "event-family-mismatch",
          path: `events.${event.id}.family`,
          message: `Trace event "${event.id}" kind "${event.kind}" belongs to the ${definition.family} family`,
        })
      }
      if (event.channel !== definition.channel) {
        issues.push({
          code: "event-channel-mismatch",
          path: `events.${event.id}.channel`,
          message: `Trace event "${event.id}" kind "${event.kind}" uses the ${definition.channel} channel`,
        })
      }
    }

    if (issues.length > 0) return yield* new McpTraceValidationError({ issues })
    return trace
  })
