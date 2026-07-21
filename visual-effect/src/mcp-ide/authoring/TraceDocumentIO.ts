import { Data, Effect } from "effect"
import type { McpGraphDocument } from "../model/McpGraphDocument"
import {
  MCP_TRACE_SCHEMA_VERSION,
  type McpTraceDocument,
  type McpTraceEvent,
  type McpTraceLegacyRebind,
  type McpTraceProvenance,
  type McpTraceValidationError,
  validateTraceDocument,
} from "../model/McpTraceDocument"
import {
  isTraceIdentifier,
  isTraceLabel,
  isTraceMetadata,
  isTraceReference,
} from "../model/TraceCodecs"
import {
  isMcpTraceEventKind,
  type McpTraceEventKind,
  traceEventDefinition,
} from "../model/TraceRegistry"
import { canonicalizePortableJson, sanitizeTraceDocument } from "../trace/TraceRedaction"

export type McpTraceImportIssueCode =
  | "invalid-json"
  | "invalid-document"
  | "unsupported-schema"
  | "legacy-rebind-required"

export class McpTraceImportError extends Data.TaggedError("McpTraceImportError")<{
  readonly code: McpTraceImportIssueCode
  readonly message: string
}> {}

export interface ParseTraceDocumentOptions {
  readonly allowLegacyRebind?: boolean
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value)

const isString = (value: unknown): value is string => typeof value === "string"
const isFiniteNumber = (value: unknown): value is number =>
  typeof value === "number" && Number.isFinite(value)
const isSequence = (value: unknown): value is number =>
  isFiniteNumber(value) && Number.isInteger(value) && value >= 0

const invalidDocument = (): Effect.Effect<never, McpTraceImportError> =>
  Effect.fail(
    new McpTraceImportError({
      code: "invalid-document",
      message: "The imported JSON does not match the MCP trace document contract",
    }),
  )

const decodeProtocol = (value: unknown): McpTraceEvent["protocol"] | undefined => {
  if (!isRecord(value)) return undefined
  const { direction, jsonrpc, requestId, method, headers } = value
  if (direction !== undefined && direction !== "send" && direction !== "receive") return undefined
  if (
    (jsonrpc !== undefined && !isTraceMetadata(jsonrpc)) ||
    (method !== undefined && !isTraceMetadata(method))
  ) {
    return undefined
  }
  if (
    requestId !== undefined &&
    requestId !== null &&
    !isTraceIdentifier(requestId) &&
    !(typeof requestId === "number" && Number.isFinite(requestId))
  ) {
    return undefined
  }
  if (headers !== undefined && !isRecord(headers)) return undefined

  return {
    ...(direction ? { direction } : {}),
    ...(jsonrpc !== undefined ? { jsonrpc } : {}),
    ...(requestId !== undefined ? { requestId } : {}),
    ...(method !== undefined ? { method } : {}),
    ...(headers !== undefined ? { headers } : {}),
  }
}

const decodeRuntime = (value: unknown): McpTraceEvent["runtime"] | undefined => {
  if (!isRecord(value)) return undefined
  const { phase, fiberId, scopeId, cause } = value
  if (
    (phase !== undefined && !isTraceMetadata(phase)) ||
    (fiberId !== undefined && !isTraceIdentifier(fiberId)) ||
    (scopeId !== undefined && !isTraceIdentifier(scopeId))
  ) {
    return undefined
  }
  return {
    ...(phase !== undefined ? { phase } : {}),
    ...(fiberId !== undefined ? { fiberId } : {}),
    ...(scopeId !== undefined ? { scopeId } : {}),
    ...(cause !== undefined ? { cause } : {}),
  }
}

const decodeV2Event = (value: unknown): McpTraceEvent | undefined => {
  if (!isRecord(value)) return undefined
  const { id, sequence, atMs, nodeId, edgeId, kind, family, channel, summary } = value
  if (
    !isTraceIdentifier(id) ||
    !isSequence(sequence) ||
    !isFiniteNumber(atMs) ||
    atMs < 0 ||
    !isTraceReference(nodeId) ||
    (edgeId !== undefined && !isTraceReference(edgeId)) ||
    !isString(kind) ||
    !isMcpTraceEventKind(kind) ||
    !isTraceLabel(summary) ||
    !isRecord(value.payload) ||
    (value.correlationId !== undefined && !isTraceIdentifier(value.correlationId)) ||
    (value.spanId !== undefined && !isTraceIdentifier(value.spanId)) ||
    (value.parentSpanId !== undefined && !isTraceIdentifier(value.parentSpanId))
  ) {
    return undefined
  }
  const definition = traceEventDefinition(kind)
  if (family !== definition.family || channel !== definition.channel) return undefined

  const protocol = value.protocol === undefined ? undefined : decodeProtocol(value.protocol)
  const runtime = value.runtime === undefined ? undefined : decodeRuntime(value.runtime)
  if (value.protocol !== undefined && protocol === undefined) return undefined
  if (value.runtime !== undefined && runtime === undefined) return undefined

  return {
    id,
    sequence,
    atMs,
    nodeId,
    ...(edgeId !== undefined ? { edgeId } : {}),
    kind,
    family: definition.family,
    channel: definition.channel,
    summary,
    ...(value.correlationId !== undefined ? { correlationId: value.correlationId } : {}),
    ...(value.spanId !== undefined ? { spanId: value.spanId } : {}),
    ...(value.parentSpanId !== undefined ? { parentSpanId: value.parentSpanId } : {}),
    ...(protocol !== undefined ? { protocol } : {}),
    ...(runtime !== undefined ? { runtime } : {}),
    payload: value.payload,
  }
}

const decodeMigration = (value: unknown): McpTraceLegacyRebind | undefined => {
  if (!isRecord(value)) return undefined
  if (
    value.kind !== "legacy-v1-rebind" ||
    !isTraceReference(value.sourceGraphId) ||
    !isTraceReference(value.targetGraphId) ||
    !isTraceReference(value.targetGraphRevision)
  ) {
    return undefined
  }
  return {
    kind: "legacy-v1-rebind",
    sourceGraphId: value.sourceGraphId,
    targetGraphId: value.targetGraphId,
    targetGraphRevision: value.targetGraphRevision,
  }
}

const decodeProvenance = (value: unknown): McpTraceProvenance | undefined => {
  if (
    !isRecord(value) ||
    value.redactionPolicy !== "allowlist-v1" ||
    !Array.isArray(value.redactions) ||
    !Array.isArray(value.migrations)
  ) {
    return undefined
  }
  const migrations = value.migrations.map(decodeMigration)
  if (migrations.some(entry => entry === undefined)) return undefined
  return {
    redactionPolicy: "allowlist-v1",
    // Imported claims are not authoritative; sanitization regenerates these from tagged values.
    redactions: [],
    migrations: migrations as Array<McpTraceLegacyRebind>,
  }
}

const decodeV2Trace = (value: Record<string, unknown>): McpTraceDocument | undefined => {
  if (
    value.schemaVersion !== MCP_TRACE_SCHEMA_VERSION ||
    !isTraceIdentifier(value.id) ||
    !isTraceReference(value.graphId) ||
    !isTraceReference(value.graphRevision) ||
    !isTraceLabel(value.name) ||
    !Array.isArray(value.events)
  ) {
    return undefined
  }
  const provenance = decodeProvenance(value.provenance)
  const events = value.events.map(decodeV2Event)
  if (
    !provenance ||
    events.some(event => event === undefined) ||
    provenance.migrations.some(
      migration =>
        migration.targetGraphId !== value.graphId ||
        migration.targetGraphRevision !== value.graphRevision,
    )
  ) {
    return undefined
  }
  return {
    schemaVersion: MCP_TRACE_SCHEMA_VERSION,
    id: value.id,
    graphId: value.graphId,
    graphRevision: value.graphRevision,
    name: value.name,
    provenance,
    events: events as Array<McpTraceEvent>,
  }
}

const legacyEventKind = (kind: string, channel: string): McpTraceEventKind | undefined => {
  if (kind === "message.sent") return "wire.message-sent"
  if (kind === "message.received") return "wire.message-received"
  if (kind === "node.input-required") {
    return channel === "task" ? "tasks.input-required" : "mrtr.input-required"
  }
  if (channel === "task") {
    const taskKinds: Readonly<Record<string, McpTraceEventKind>> = {
      "node.started": "tasks.created",
      "node.waiting": "tasks.waiting",
      "node.completed": "tasks.completed",
      "node.failed": "tasks.failed",
      "node.cancelled": "tasks.cancelled",
      "node.interrupted": "tasks.cancelled",
    }
    return taskKinds[kind]
  }
  const runtimeKinds: Readonly<Record<string, McpTraceEventKind>> = {
    "node.started": "runtime.started",
    "node.waiting": "runtime.waiting",
    "node.completed": "runtime.completed",
    "node.failed": "runtime.failed",
    "node.cancelled": "runtime.cancelled",
    "node.interrupted": "runtime.interrupted",
  }
  return runtimeKinds[kind]
}

const decodeLegacyEvent = (value: unknown): McpTraceEvent | undefined => {
  if (!isRecord(value) || !isString(value.kind) || !isString(value.channel)) return undefined
  const kind = legacyEventKind(value.kind, value.channel)
  if (!kind) return undefined
  const definition = traceEventDefinition(kind)
  if (
    !isTraceIdentifier(value.id) ||
    !isSequence(value.sequence) ||
    !isFiniteNumber(value.atMs) ||
    value.atMs < 0 ||
    !isTraceReference(value.nodeId) ||
    !isTraceLabel(value.summary) ||
    !isRecord(value.payload) ||
    (value.correlationId !== undefined && !isTraceIdentifier(value.correlationId))
  ) {
    return undefined
  }
  return {
    id: value.id,
    sequence: value.sequence,
    atMs: value.atMs,
    nodeId: value.nodeId,
    kind,
    family: definition.family,
    channel: definition.channel,
    summary: value.summary,
    ...(value.correlationId !== undefined ? { correlationId: value.correlationId } : {}),
    payload: value.payload,
  }
}

const migrateLegacyTrace = (
  value: Record<string, unknown>,
  graph: McpGraphDocument,
): McpTraceDocument | undefined => {
  if (
    value.schemaVersion !== "1" ||
    !isTraceIdentifier(value.id) ||
    !isTraceReference(value.graphId) ||
    !isTraceLabel(value.name) ||
    !Array.isArray(value.events)
  ) {
    return undefined
  }
  const events = value.events.map(decodeLegacyEvent)
  if (events.some(event => event === undefined)) return undefined
  return {
    schemaVersion: MCP_TRACE_SCHEMA_VERSION,
    id: value.id,
    graphId: graph.id,
    graphRevision: graph.revision,
    name: value.name,
    provenance: {
      redactionPolicy: "allowlist-v1",
      redactions: [],
      migrations: [
        {
          kind: "legacy-v1-rebind",
          sourceGraphId: value.graphId,
          targetGraphId: graph.id,
          targetGraphRevision: graph.revision,
        },
      ],
    },
    events: events as Array<McpTraceEvent>,
  }
}

export const decodeTraceDocument = (
  value: unknown,
  graph: McpGraphDocument,
  options: ParseTraceDocumentOptions = {},
): Effect.Effect<McpTraceDocument, McpTraceImportError | McpTraceValidationError> => {
  if (!isRecord(value)) return invalidDocument()
  if (typeof value.schemaVersion === "string") {
    if (value.schemaVersion !== "1" && value.schemaVersion !== MCP_TRACE_SCHEMA_VERSION) {
      return Effect.fail(
        new McpTraceImportError({
          code: "unsupported-schema",
          message: `Trace schema version "${value.schemaVersion}" is not supported`,
        }),
      )
    }
  }

  let decoded: McpTraceDocument | undefined
  if (value.schemaVersion === "1") {
    if (!options.allowLegacyRebind) {
      return Effect.fail(
        new McpTraceImportError({
          code: "legacy-rebind-required",
          message: "Trace schema v1 has no graph revision; explicitly allow legacy rebind",
        }),
      )
    }
    decoded = migrateLegacyTrace(value, graph)
  } else {
    decoded = decodeV2Trace(value)
  }
  if (!decoded) return invalidDocument()
  return validateTraceDocument(graph, sanitizeTraceDocument(decoded))
}

export const serializeTraceDocument = (trace: McpTraceDocument): string =>
  `${JSON.stringify(canonicalizePortableJson(sanitizeTraceDocument(trace)), null, 2)}\n`

export const parseTraceDocument = (
  source: string,
  graph: McpGraphDocument,
  options: ParseTraceDocumentOptions = {},
): Effect.Effect<McpTraceDocument, McpTraceImportError | McpTraceValidationError> =>
  Effect.try({
    try: () => JSON.parse(source) as unknown,
    catch: () =>
      new McpTraceImportError({
        code: "invalid-json",
        message: "The imported trace is not valid JSON",
      }),
  }).pipe(Effect.flatMap(value => decodeTraceDocument(value, graph, options)))
