/**
 * MCP streamable HTTP server transport.
 *
 * This is the package-local server-side HTTP transport surface. It delegates to
 * the SDK server runtime and Effect RPC HTTP transport.
 */
import * as Layer from "effect/Layer"
import * as HttpRouter from "effect/unstable/http/HttpRouter"
import * as McpServer from "../McpServer.js"

export interface AuthInfo {
  readonly token?: string | undefined
  readonly clientId?: string | undefined
  readonly scopes?: ReadonlyArray<string> | undefined
  readonly extra?: unknown
}

export type StreamId = string
export type EventId = string

export interface EventStore {
  readonly storeEvent: (streamId: StreamId, message: unknown) => Promise<EventId>
  readonly getStreamIdForEventId?: (eventId: EventId) => Promise<StreamId | undefined>
  readonly replayEventsAfter: (
    lastEventId: EventId,
    sink: { readonly send: (eventId: EventId, message: unknown) => Promise<void> }
  ) => Promise<StreamId>
}

export interface StreamableHttpServerTransportOptions {
  readonly name: string
  readonly version: string
  readonly path: HttpRouter.PathInput
  readonly extensions?: McpServer.ExtensionCapabilities | undefined
  readonly sessionIdGenerator?: (() => string) | undefined
  readonly onsessioninitialized?: ((sessionId: string) => void | Promise<void>) | undefined
  readonly onsessionclosed?: ((sessionId: string) => void | Promise<void>) | undefined
  readonly enableJsonResponse?: boolean | undefined
  readonly eventStore?: EventStore | undefined
  readonly retryInterval?: number | undefined
  readonly supportedProtocolVersions?: ReadonlyArray<string> | undefined
  readonly allowedHosts?: ReadonlyArray<string> | undefined
  readonly allowedOrigins?: ReadonlyArray<string> | undefined
  readonly enableDnsRebindingProtection?: boolean | undefined
}

export interface HandleRequestOptions {
  readonly parsedBody?: unknown
  readonly authInfo?: AuthInfo | undefined
}

/**
 * Create a streamable-HTTP-backed MCP server layer.
 */
export const layer = (
  options: StreamableHttpServerTransportOptions
) => McpServer.layerHttp({
  name: options.name,
  version: options.version,
  path: options.path,
  extensions: options.extensions,
  sessionIdGenerator: options.sessionIdGenerator,
  onsessioninitialized: options.onsessioninitialized,
  supportedProtocolVersions: options.supportedProtocolVersions
})

/**
 * Build a Web-standard request handler for a streamable HTTP MCP server.
 */
export const toWebHandler = <A, E, R>(
  appLayer: Layer.Layer<A, E, R>,
  options: StreamableHttpServerTransportOptions
) => {
  const webHandler = HttpRouter.toWebHandler(
    appLayer.pipe(
      Layer.provide(layer(options))
    ) as Layer.Layer<A, E, never>,
    { disableLogger: true }
  )
  return {
    ...webHandler,
    handler: (request: Request, handleOptions?: HandleRequestOptions) =>
      handleRequest(request, webHandler.handler, options, handleOptions)
  }
}

export const handleRequest = async (
  request: Request,
  handler: (request: Request) => Promise<Response>,
  options: StreamableHttpServerTransportOptions,
  handleOptions: HandleRequestOptions = {}
): Promise<Response> => {
  if (options.enableDnsRebindingProtection) {
    const hostResponse = hostHeaderValidationResponse(
      request,
      options.allowedHosts ?? localhostAllowedHostnames()
    )
    if (hostResponse) {
      return hostResponse
    }
    const originResponse = originHeaderValidationResponse(request, options.allowedOrigins)
    if (originResponse) {
      return originResponse
    }
  }

  // MCP 2026-07-28 (stateless draft): sessions and the GET/SSE channel were
  // removed. The endpoint only accepts POST JSON-RPC; GET/DELETE (and any other
  // method) are rejected with 405. Server-initiated streaming now happens via
  // `subscriptions/listen` (a POST), and there is no `Mcp-Session-Id` to mint or
  // tear down. See docs/draft-2026-07-28-migration.md.
  if (request.method !== "POST") {
    return methodNotAllowedResponse()
  }

  if (await isJsonRpcNotification(request)) {
    return new Response(null, { status: 202 })
  }

  const authInfo = handleOptions.authInfo ?? extractBearerAuthInfo(request.headers)
  const response = await handler(withAuthInfo(request, authInfo))
  return convertJsonResponseToSseIfRequested(request, response)
}

export type HostHeaderValidationResult =
  | { readonly ok: true; readonly hostname: string }
  | {
    readonly ok: false
    readonly errorCode: "missing_host" | "invalid_host_header" | "invalid_host"
    readonly message: string
    readonly hostHeader?: string | undefined
    readonly hostname?: string | undefined
  }

export const validateHostHeader = (
  hostHeader: string | null | undefined,
  allowedHosts: ReadonlyArray<string>
): HostHeaderValidationResult => {
  if (!hostHeader) {
    return { ok: false, errorCode: "missing_host", message: "Missing Host header" }
  }

  let hostname: string
  try {
    hostname = new URL(`http://${hostHeader}`).hostname
  } catch {
    return {
      ok: false,
      errorCode: "invalid_host_header",
      message: `Invalid Host header: ${hostHeader}`,
      hostHeader
    }
  }

  if (!allowedHosts.includes(hostname)) {
    return {
      ok: false,
      errorCode: "invalid_host",
      message: `Invalid Host: ${hostname}`,
      hostHeader,
      hostname
    }
  }

  return { ok: true, hostname }
}

export const localhostAllowedHostnames = (): ReadonlyArray<string> => [
  "localhost",
  "127.0.0.1",
  "[::1]"
]

export const hostHeaderValidationResponse = (
  request: Request,
  allowedHosts: ReadonlyArray<string>
): Response | undefined => {
  const result = validateHostHeader(request.headers.get("host"), allowedHosts)
  if (result.ok) {
    return undefined
  }
  return jsonRpcErrorResponse(403, result.message)
}

const originHeaderValidationResponse = (
  request: Request,
  allowedOrigins: ReadonlyArray<string> | undefined
): Response | undefined => {
  const origin = request.headers.get("origin")
  if (!origin || allowedOrigins === undefined) {
    return undefined
  }
  return allowedOrigins.includes(origin)
    ? undefined
    : jsonRpcErrorResponse(403, `Invalid Origin: ${origin}`)
}

const extractBearerAuthInfo = (headers: Headers): AuthInfo | undefined => {
  const authorization = headers.get("authorization")
  if (!authorization?.startsWith("Bearer ")) {
    return undefined
  }
  return { token: authorization.slice("Bearer ".length) }
}

const isJsonRpcNotification = async (request: Request): Promise<boolean> => {
  if (request.method !== "POST") {
    return false
  }
  try {
    const body = await request.clone().json() as
      | Record<string, unknown>
      | ReadonlyArray<Record<string, unknown>>
    const messages = Array.isArray(body) ? body : [body]
    return messages.every((message) =>
      typeof message.method === "string" &&
      message.method.startsWith("notifications/") &&
      message.id === undefined
    )
  } catch {
    return false
  }
}

const withAuthInfo = (request: Request, authInfo: AuthInfo | undefined): Request => {
  if (!authInfo) {
    return request
  }
  const headers = new Headers(request.headers)
  headers.set("authorization", `Bearer ${authInfo.token ?? ""}`)
  return new Request(request, { headers })
}

const jsonRpcErrorResponse = (status: number, message: string): Response =>
  Response.json(
    {
      jsonrpc: "2.0",
      error: {
        code: -32000,
        message
      },
      id: null
    },
    { status }
  )

// MCP 2026-07-28 (stateless draft): GET/DELETE (and any non-POST method) are not
// supported on the endpoint. See docs/draft-2026-07-28-migration.md.
const methodNotAllowedResponse = (): Response => {
  const response = jsonRpcErrorResponse(405, "Method Not Allowed")
  response.headers.set("Allow", "POST")
  return response
}

const convertJsonResponseToSseIfRequested = async (
  request: Request,
  response: Response
): Promise<Response> => {
  if (
    request.method !== "POST" ||
    response.status !== 200 ||
    !request.headers.get("accept")?.includes("text/event-stream") ||
    !response.headers.get("content-type")?.includes("application/json")
  ) {
    return response
  }

  const text = await response.text()
  if (!text.trim()) {
    return new Response(null, response)
  }

  const parsed = JSON.parse(text) as unknown
  const messages = Array.isArray(parsed) ? parsed : [parsed]
  const body = messages
    .map((message) => `event: message\ndata: ${JSON.stringify(message)}\n\n`)
    .join("")
  const headers = new Headers(response.headers)
  headers.delete("content-length")
  headers.set("content-type", "text/event-stream")
  headers.set("cache-control", "no-cache")
  headers.set("connection", "keep-alive")
  return new Response(body, {
    status: response.status,
    statusText: response.statusText,
    headers
  })
}
