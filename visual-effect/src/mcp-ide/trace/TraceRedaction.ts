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

const ownDataValue = (value: object, key: PropertyKey): unknown => {
  const descriptor = Object.getOwnPropertyDescriptor(value, key)
  return descriptor && "value" in descriptor ? descriptor.value : undefined
}

const isSensitiveMarker = (value: unknown): value is SensitiveTraceValue => {
  if (!isRecord(value)) return false
  const marker = Object.getOwnPropertyDescriptor(value, SENSITIVE_MARKER)
  const content = Object.getOwnPropertyDescriptor(value, "value")
  return Boolean(
    marker && "value" in marker && marker.value === true && content && "value" in content,
  )
}

const isRedactionSentinel = (value: unknown): value is McpTraceRedactionSentinel => {
  if (!isRecord(value)) return false
  const keys = Reflect.ownKeys(value)
  if (keys.length !== 1 || keys[0] !== MCP_TRACE_REDACTION_SENTINEL) return false
  const reason = ownDataValue(value, MCP_TRACE_REDACTION_SENTINEL)
  return typeof reason === "string" && redactionReasons.has(reason as McpTraceRedactionReason)
}

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

const safeInvalidPrototype = Object.freeze(
  Object.defineProperty({}, "$invalidPortablePrototype", {
    value: true,
    enumerable: true,
  }),
)

const safeInvalidArrayPrototype = Object.freeze(
  Object.defineProperty(Object.create(Array.prototype), "$invalidPortablePrototype", {
    value: true,
    enumerable: true,
  }),
)

const defineSanitizedProperty = (
  target: object,
  key: PropertyKey,
  source: PropertyDescriptor,
  value: unknown,
): void => {
  Object.defineProperty(target, key, {
    value,
    enumerable: source.enumerable ?? false,
    configurable: true,
    writable: true,
  })
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
    const length = ownDataValue(value, "length")
    const sanitized: Array<unknown> = new Array(
      typeof length === "number" && Number.isInteger(length) && length >= 0 ? length : 0,
    )
    if (Object.getPrototypeOf(value) !== Array.prototype) {
      Object.setPrototypeOf(sanitized, safeInvalidArrayPrototype)
    }
    for (const key of Reflect.ownKeys(value)) {
      if (key === "length") continue
      const descriptor = Object.getOwnPropertyDescriptor(value, key)
      if (!descriptor) continue
      const child = "value" in descriptor ? descriptor.value : undefined
      const childPath = appendJsonPointer(path, typeof key === "symbol" ? "$symbol" : key)
      defineSanitizedProperty(sanitized, key, descriptor, sanitizeValue(child, childPath, context))
    }
    return sanitized
  }
  if (!isRecord(value)) return value

  const prototype = Object.getPrototypeOf(value)
  const sanitized = Object.create(
    prototype === Object.prototype || prototype === null ? prototype : safeInvalidPrototype,
  ) as Record<PropertyKey, unknown>
  for (const key of Reflect.ownKeys(value)) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key)
    if (!descriptor) continue
    const child = "value" in descriptor ? descriptor.value : undefined
    const pathKey = typeof key === "symbol" ? "$symbol" : key
    const childPath = appendJsonPointer(path, pathKey)
    if (typeof key === "string") {
      const headerName = key.toLowerCase()
      if (insideHeaders && sensitiveHeaders.has(headerName)) {
        defineSanitizedProperty(
          sanitized,
          key,
          descriptor,
          recordRedaction(context, childPath, "sensitive-header"),
        )
        continue
      }
      if (insideHeaders && !safeHeaders.has(headerName)) {
        defineSanitizedProperty(
          sanitized,
          key,
          descriptor,
          recordRedaction(context, childPath, "header-not-allowlisted"),
        )
        continue
      }
      if (isSensitiveMarker(child)) {
        defineSanitizedProperty(
          sanitized,
          key,
          descriptor,
          recordRedaction(context, childPath, "explicit-sensitive-value"),
        )
        continue
      }
      if (sensitiveKeys.has(normalizedKey(key))) {
        defineSanitizedProperty(
          sanitized,
          key,
          descriptor,
          recordRedaction(context, childPath, "sensitive-key"),
        )
        continue
      }
    }
    defineSanitizedProperty(
      sanitized,
      key,
      descriptor,
      sanitizeValue(
        child,
        childPath,
        context,
        typeof key === "string" && key.toLowerCase() === "headers",
      ),
    )
  }
  return sanitized
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
