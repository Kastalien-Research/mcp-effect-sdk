import type {
  McpTraceDocument,
  McpTraceEvent,
  McpTraceRedactionReason,
  McpTraceRedactionRecord,
} from "../model/McpTraceDocument"

const REDACTED_VALUE = Object.freeze({ redacted: true })
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

export interface SensitiveTraceValue {
  readonly $mcpSensitive: true
  readonly value: unknown
}

export const sensitiveTraceValue = (value: unknown): SensitiveTraceValue => ({
  $mcpSensitive: true,
  value,
})

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value)

const isRedacted = (value: unknown): boolean =>
  isRecord(value) && value.redacted === true && Object.keys(value).length === 1

const isSensitiveMarker = (value: unknown): value is SensitiveTraceValue =>
  isRecord(value) && value[SENSITIVE_MARKER] === true && Object.hasOwn(value, "value")

const normalizedKey = (key: string): string => key.toLowerCase().replaceAll(/[-_]/g, "")

const compare = (left: string, right: string): number => (left < right ? -1 : left > right ? 1 : 0)

interface RedactionContext {
  readonly eventId: string
  readonly redactions: Array<McpTraceRedactionRecord>
}

const recordRedaction = (
  context: RedactionContext,
  path: string,
  reason: McpTraceRedactionReason,
) => {
  context.redactions.push({ eventId: context.eventId, path, reason })
  return REDACTED_VALUE
}

const sanitizeValue = (
  value: unknown,
  path: string,
  context: RedactionContext,
  insideHeaders = false,
): unknown => {
  if (isRedacted(value)) return REDACTED_VALUE
  if (isSensitiveMarker(value)) {
    return recordRedaction(context, path, "explicit-sensitive-value")
  }
  if (Array.isArray(value)) {
    return value.map((child, index) => sanitizeValue(child, `${path}.${index}`, context))
  }
  if (!isRecord(value)) return value

  return Object.fromEntries(
    Object.entries(value).map(([key, child]) => {
      const childPath = `${path}.${key}`
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

const sanitizeEvent = (
  event: McpTraceEvent,
  redactions: Array<McpTraceRedactionRecord>,
): McpTraceEvent => {
  const context = { eventId: event.id, redactions }
  const { protocol, runtime, payload } = event
  return {
    id: event.id,
    sequence: event.sequence,
    atMs: event.atMs,
    nodeId: event.nodeId,
    ...(event.edgeId !== undefined ? { edgeId: event.edgeId } : {}),
    kind: event.kind,
    family: event.family,
    channel: event.channel,
    summary: event.summary,
    ...(event.correlationId !== undefined ? { correlationId: event.correlationId } : {}),
    ...(event.spanId !== undefined ? { spanId: event.spanId } : {}),
    ...(event.parentSpanId !== undefined ? { parentSpanId: event.parentSpanId } : {}),
    ...(protocol
      ? {
          protocol: sanitizeValue(protocol, `events.${event.id}.protocol`, context) as NonNullable<
            McpTraceEvent["protocol"]
          >,
        }
      : {}),
    ...(runtime
      ? {
          runtime: sanitizeValue(runtime, `events.${event.id}.runtime`, context) as NonNullable<
            McpTraceEvent["runtime"]
          >,
        }
      : {}),
    payload: sanitizeValue(
      payload,
      `events.${event.id}.payload`,
      context,
    ) as McpTraceEvent["payload"],
  }
}

const redactionKey = (entry: McpTraceRedactionRecord): string =>
  `${entry.eventId}\u0000${entry.path}\u0000${entry.reason}`

export const sanitizeTraceDocument = (trace: McpTraceDocument): McpTraceDocument => {
  const discovered: Array<McpTraceRedactionRecord> = []
  const events = trace.events.map(event => sanitizeEvent(event, discovered))
  const allRedactions = new Map<string, McpTraceRedactionRecord>()
  for (const entry of [...trace.provenance.redactions, ...discovered]) {
    allRedactions.set(redactionKey(entry), entry)
  }

  return {
    schemaVersion: trace.schemaVersion,
    id: trace.id,
    graphId: trace.graphId,
    graphRevision: trace.graphRevision,
    name: trace.name,
    provenance: {
      redactionPolicy: "allowlist-v1",
      redactions: [...allRedactions.values()].toSorted((left, right) =>
        compare(redactionKey(left), redactionKey(right)),
      ),
      migrations: [...trace.provenance.migrations],
    },
    events,
  }
}
