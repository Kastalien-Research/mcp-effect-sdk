import {
  MCP_TRACE_SCHEMA_VERSION,
  type McpTraceDocument,
  type McpTraceEvent,
  type McpTraceLegacyRebind,
  type McpTraceRedactionReason,
  type McpTraceRedactionRecord,
} from "../model/McpTraceDocument"
import {
  isTraceIdentifier,
  isTraceLabel,
  isTraceMetadata,
  isTraceReference,
} from "../model/TraceCodecs"
import { isMcpTraceEventKind, traceEventDefinition } from "../model/TraceRegistry"

export const MCP_TRACE_REDACTION_SENTINEL = "$mcpTraceRedaction" as const
const SENSITIVE_MARKER = "$mcpSensitive"

/** Header values outside this deliberately small set are not retained in trace state or exports. */
export const SAFE_TRACE_HEADER_VALUE_ALLOWLIST = [
  "accept",
  "content-type",
  "mcp-protocol-version",
] as const

const safeHeaders = new Set<string>(SAFE_TRACE_HEADER_VALUE_ALLOWLIST)
const sensitiveHeaders = new Set(["authorization", "cookie", "proxy-authorization", "set-cookie"])
const sensitiveKeys = new Set([
  "accesstoken",
  "apikey",
  "authorization",
  "clientsecret",
  "cookie",
  "credential",
  "password",
  "passwd",
  "privatekey",
  "refreshtoken",
  "secret",
  "setcookie",
  "token",
])
const redactionReasons = new Set<McpTraceRedactionReason>([
  "sensitive-header",
  "header-not-allowlisted",
  "sensitive-key",
  "explicit-sensitive-value",
])

export interface SensitiveTraceValue {
  readonly $mcpSensitive: true
  readonly value: unknown
}

export interface McpTraceRedactionSentinel {
  readonly $mcpTraceRedaction: McpTraceRedactionReason
}

export const sensitiveTraceValue = (value: unknown): SensitiveTraceValue => ({
  $mcpSensitive: true,
  value,
})

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value)

const isSensitiveMarker = (value: unknown): value is SensitiveTraceValue =>
  isRecord(value) && value[SENSITIVE_MARKER] === true && Object.hasOwn(value, "value")

const isRedactionSentinel = (value: unknown): value is McpTraceRedactionSentinel =>
  isRecord(value) &&
  Object.keys(value).length === 1 &&
  typeof value[MCP_TRACE_REDACTION_SENTINEL] === "string" &&
  redactionReasons.has(value[MCP_TRACE_REDACTION_SENTINEL] as McpTraceRedactionReason)

const normalizedKey = (key: string): string => key.toLowerCase().replaceAll(/[-_]/g, "")
const compare = (left: string, right: string): number => (left < right ? -1 : left > right ? 1 : 0)

const escapeJsonPointerSegment = (segment: string): string =>
  segment.replaceAll("~", "~0").replaceAll("/", "~1")

const appendJsonPointer = (path: string, segment: string | number): string =>
  `${path}/${escapeJsonPointerSegment(String(segment))}`

interface RedactionContext {
  readonly eventId: string
  readonly redactions: Array<McpTraceRedactionRecord>
}

const sentinel = (reason: McpTraceRedactionReason): McpTraceRedactionSentinel => ({
  [MCP_TRACE_REDACTION_SENTINEL]: reason,
})

const recordRedaction = (
  context: RedactionContext,
  path: string,
  reason: McpTraceRedactionReason,
): McpTraceRedactionSentinel => {
  context.redactions.push({ eventId: context.eventId, path, reason })
  return sentinel(reason)
}

const sanitizeValue = (
  value: unknown,
  path: string,
  context: RedactionContext,
  insideHeaders = false,
): unknown => {
  if (isRedactionSentinel(value)) {
    return recordRedaction(context, path, value[MCP_TRACE_REDACTION_SENTINEL])
  }
  if (isSensitiveMarker(value)) {
    return recordRedaction(context, path, "explicit-sensitive-value")
  }
  if (Array.isArray(value)) {
    return value.map((child, index) =>
      sanitizeValue(child, appendJsonPointer(path, index), context),
    )
  }
  if (!isRecord(value)) return value

  return Object.fromEntries(
    Object.entries(value).map(([key, child]) => {
      const childPath = appendJsonPointer(path, key)
      const headerName = key.toLowerCase()
      if (insideHeaders) {
        if (sensitiveHeaders.has(headerName)) {
          return [key, recordRedaction(context, childPath, "sensitive-header")]
        }
        if (!safeHeaders.has(headerName)) {
          return [key, recordRedaction(context, childPath, "header-not-allowlisted")]
        }
      }
      if (isSensitiveMarker(child)) {
        return [key, recordRedaction(context, childPath, "explicit-sensitive-value")]
      }
      if (sensitiveKeys.has(normalizedKey(key))) {
        return [key, recordRedaction(context, childPath, "sensitive-key")]
      }
      return [key, sanitizeValue(child, childPath, context, key.toLowerCase() === "headers")]
    }),
  )
}

export const canonicalizePortableJson = (value: unknown): unknown => {
  if (Array.isArray(value)) return value.map(canonicalizePortableJson)
  if (!isRecord(value)) return value
  return Object.fromEntries(
    Object.entries(value)
      .toSorted(([left], [right]) => compare(left, right))
      .map(([key, child]) => [key, canonicalizePortableJson(child)]),
  )
}

const sanitizeProtocol = (
  value: unknown,
  path: string,
  context: RedactionContext,
): McpTraceEvent["protocol"] | undefined => {
  if (!isRecord(value)) return undefined
  const requestId = value.requestId
  const validRequestId =
    requestId === null ||
    (typeof requestId === "number" && Number.isFinite(requestId)) ||
    isTraceIdentifier(requestId)
  const headers = isRecord(value.headers)
    ? (sanitizeValue(value.headers, appendJsonPointer(path, "headers"), context, true) as Record<
        string,
        unknown
      >)
    : undefined
  return {
    ...(value.direction === "send" || value.direction === "receive"
      ? { direction: value.direction }
      : {}),
    ...(isTraceMetadata(value.jsonrpc) ? { jsonrpc: value.jsonrpc } : {}),
    ...(value.requestId !== undefined && validRequestId ? { requestId } : {}),
    ...(isTraceMetadata(value.method) ? { method: value.method } : {}),
    ...(headers ? { headers } : {}),
  }
}

const sanitizeRuntime = (
  value: unknown,
  path: string,
  context: RedactionContext,
): McpTraceEvent["runtime"] | undefined => {
  if (!isRecord(value)) return undefined
  return {
    ...(isTraceMetadata(value.phase) ? { phase: value.phase } : {}),
    ...(isTraceIdentifier(value.fiberId) ? { fiberId: value.fiberId } : {}),
    ...(isTraceIdentifier(value.scopeId) ? { scopeId: value.scopeId } : {}),
    ...(value.cause !== undefined
      ? { cause: sanitizeValue(value.cause, appendJsonPointer(path, "cause"), context) }
      : {}),
  }
}

const sanitizeEvent = (
  event: McpTraceEvent,
  index: number,
  redactions: Array<McpTraceRedactionRecord>,
): McpTraceEvent => {
  const eventId = isTraceIdentifier(event.id) ? event.id : `invalid-event-${index}`
  const context = { eventId, redactions }
  const eventPath = `/events/${index}`
  const kind = isMcpTraceEventKind(event.kind) ? event.kind : "runtime.failed"
  const definition = traceEventDefinition(kind)
  const protocol = sanitizeProtocol(
    event.protocol,
    appendJsonPointer(eventPath, "protocol"),
    context,
  )
  const runtime = sanitizeRuntime(event.runtime, appendJsonPointer(eventPath, "runtime"), context)
  const payload = isRecord(event.payload)
    ? (sanitizeValue(
        event.payload,
        appendJsonPointer(eventPath, "payload"),
        context,
      ) as McpTraceEvent["payload"])
    : {}

  return {
    id: eventId,
    sequence: Number.isInteger(event.sequence) && event.sequence >= 0 ? event.sequence : index,
    atMs: Number.isFinite(event.atMs) && event.atMs >= 0 ? event.atMs : 0,
    nodeId: isTraceReference(event.nodeId) ? event.nodeId : "invalid-node",
    ...(isTraceReference(event.edgeId) ? { edgeId: event.edgeId } : {}),
    kind,
    family: definition.family,
    channel: definition.channel,
    summary: isTraceLabel(event.summary) ? event.summary : "Invalid trace event",
    ...(isTraceIdentifier(event.correlationId) ? { correlationId: event.correlationId } : {}),
    ...(isTraceIdentifier(event.spanId) ? { spanId: event.spanId } : {}),
    ...(isTraceIdentifier(event.parentSpanId) ? { parentSpanId: event.parentSpanId } : {}),
    ...(protocol ? { protocol } : {}),
    ...(runtime ? { runtime } : {}),
    payload,
  }
}

const sanitizeMigration = (value: McpTraceLegacyRebind): McpTraceLegacyRebind | undefined =>
  value.kind === "legacy-v1-rebind" &&
  isTraceReference(value.sourceGraphId) &&
  isTraceReference(value.targetGraphId) &&
  isTraceReference(value.targetGraphRevision)
    ? {
        kind: "legacy-v1-rebind",
        sourceGraphId: value.sourceGraphId,
        targetGraphId: value.targetGraphId,
        targetGraphRevision: value.targetGraphRevision,
      }
    : undefined

const redactionKey = (entry: McpTraceRedactionRecord): string =>
  `${entry.eventId}\u0000${entry.path}\u0000${entry.reason}`

export const sanitizeTraceDocument = (trace: McpTraceDocument): McpTraceDocument => {
  const redactions: Array<McpTraceRedactionRecord> = []
  const graphId = isTraceReference(trace.graphId) ? trace.graphId : "invalid-graph"
  const graphRevision = isTraceReference(trace.graphRevision)
    ? trace.graphRevision
    : "invalid-revision"
  const events = Array.isArray(trace.events)
    ? trace.events.map((event, index) => sanitizeEvent(event, index, redactions))
    : []
  const migrations = Array.isArray(trace.provenance?.migrations)
    ? trace.provenance.migrations
        .map(sanitizeMigration)
        .filter(
          (migration): migration is McpTraceLegacyRebind =>
            migration !== undefined &&
            migration.targetGraphId === graphId &&
            migration.targetGraphRevision === graphRevision,
        )
    : []

  return {
    schemaVersion: MCP_TRACE_SCHEMA_VERSION,
    id: isTraceIdentifier(trace.id) ? trace.id : "invalid-trace",
    graphId,
    graphRevision,
    name: isTraceLabel(trace.name) ? trace.name : "Invalid trace label",
    provenance: {
      redactionPolicy: "allowlist-v1",
      redactions: redactions.toSorted((left, right) =>
        compare(redactionKey(left), redactionKey(right)),
      ),
      migrations,
    },
    events,
  }
}
