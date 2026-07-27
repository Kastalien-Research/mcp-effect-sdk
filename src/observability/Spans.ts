/**
 * Span names and attribute keys for the MCP SDK.
 *
 * Instrumentation is deliberately limited to protocol boundaries — request
 * dispatch, tool/resource/prompt invocation, transport send/receive, and token
 * exchange. Internal helpers stay unspanned so a trace reads as the protocol
 * conversation rather than as this package's call graph.
 *
 * The SDK stays tracing-agnostic: it emits spans through Effect's `Tracer` and
 * never installs one. A consumer chooses the backend by providing a tracer
 * layer (Effect Dev Tools, OpenTelemetry, or their own). See
 * `docs/observability.md`.
 */

/**
 * Span names. Dotted, `mcp.`-prefixed, and stable: they are a public surface
 * that consumers write dashboards and alerts against, so treat a rename as a
 * breaking change.
 */
export const SpanName = {
  clientRequest: "mcp.client.request",
  clientToolCall: "mcp.client.tool.call",
  clientDispatch: "mcp.client.dispatch",
  serverDispatch: "mcp.server.dispatch",
  serverToolCall: "mcp.server.tool.call",
  serverResourceRead: "mcp.server.resource.read",
  serverPromptGet: "mcp.server.prompt.get",
  transportSend: "mcp.transport.send",
  transportReceive: "mcp.transport.receive",
  authTokenExchange: "mcp.auth.token.exchange"
} as const

export type SpanName = (typeof SpanName)[keyof typeof SpanName]

/**
 * Attribute keys.
 *
 * Every key here is protocol metadata that is safe to export to a third-party
 * tracing backend. Message bodies, headers, tool arguments and results, and
 * anything from the authorization layer other than the grant type are
 * deliberately absent — a span is not an audit log, and traces routinely leave
 * the trust boundary that the payload does not. `test/observability/` asserts
 * this stays true.
 */
export const SpanAttribute = {
  method: "mcp.method",
  requestId: "mcp.request_id",
  toolName: "mcp.tool.name",
  resourceUri: "mcp.uri",
  promptName: "mcp.prompt.name",
  transport: "mcp.transport",
  grantType: "mcp.grant_type"
} as const

export type SpanAttribute = (typeof SpanAttribute)[keyof typeof SpanAttribute]

/** Transport kinds recorded under {@link SpanAttribute.transport}. */
export type TransportKind = "http" | "stdio"

/**
 * JSON-RPC ids are `string | number`, and a tracer attribute value should be a
 * primitive rather than whatever the peer happened to send. Absent ids (which
 * is the notification case) are reported as such instead of as `"undefined"`,
 * so a trace never implies an id that was never on the wire.
 */
export const requestIdAttribute = (id: string | number | null | undefined): string =>
  id === null || id === undefined ? "(none)" : String(id)
