/**
 * MCP streamable HTTP server transport.
 *
 * This is the package-local server-side HTTP transport surface. It delegates to
 * the SDK server runtime and stable Effect Platform HTTP router.
 */
import * as HttpRouter from "@effect/platform/HttpRouter"
import * as HttpServerRequest from "@effect/platform/HttpServerRequest"
import * as HttpServerResponse from "@effect/platform/HttpServerResponse"
import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"
import * as ManagedRuntime from "effect/ManagedRuntime"
import * as McpServer from "../McpServer.js"
import {
  HEADER_MISMATCH_ERROR_CODE,
  MCP_METHOD_HEADER,
  MCP_NAME_HEADER,
  MCP_PROTOCOL_VERSION_HEADER,
  MODERN_PROTOCOL_VERSION,
  SERVER_DISCOVER_METHOD,
  UNSUPPORTED_PROTOCOL_VERSION_ERROR_CODE,
  makeDiscoverResult
} from "../McpModern.js"

export interface AuthInfo {
  readonly token?: string | undefined
  readonly clientId?: string | undefined
  readonly scopes?: ReadonlyArray<string> | undefined
  readonly extra?: unknown
}

interface HeaderMismatchErrorResponse {
  readonly jsonrpc: "2.0"
  readonly id: unknown
  readonly error: {
    readonly code: typeof HEADER_MISMATCH_ERROR_CODE
    readonly message: string
  }
}

export interface StreamableHttpServerTransportOptions {
  readonly name: string
  readonly version: string
  readonly path: string
  readonly instructions?: string | undefined
  readonly extensions?: McpServer.ExtensionCapabilities | undefined
  readonly enableJsonResponse?: boolean | undefined
  readonly supportedProtocolVersions?: ReadonlyArray<string> | undefined
  readonly allowedHosts?: ReadonlyArray<string> | undefined
  readonly allowedOrigins?: ReadonlyArray<string> | undefined
  readonly enableDnsRebindingProtection?: boolean | undefined
  /** Enable draft/modern (`2026-07-28`) stateless HTTP semantics. */
  readonly modern?: boolean | undefined
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
    instructions: options.instructions,
    extensions: options.extensions,
    supportedProtocolVersions: options.supportedProtocolVersions
  }).pipe(Layer.provide(Layer.effect(
    McpServer.HttpRouteRegistry,
    HttpRouter.Default.pipe(Effect.map((router) => ({
      post: (path: string, handler: (request: Request) => Effect.Effect<Response>) =>
        router.post(path as HttpRouter.PathInput, Effect.gen(function*() {
          const request = yield* HttpServerRequest.HttpServerRequest
          const webRequest = yield* HttpServerRequest.toWeb(request)
          const response = yield* handler(webRequest)
          return HttpServerResponse.fromWeb(response)
        }))
    })))
  )))

/**
 * Build a Web-standard request handler for a streamable HTTP MCP server.
 */
export const toWebHandler = <A, E>(
  appLayer: Layer.Layer<A, E, McpServer.McpServer>,
  options: StreamableHttpServerTransportOptions
) => {
  const runtime = ManagedRuntime.make(
    appLayer.pipe(Layer.provideMerge(McpServer.McpServer.layer)) as Layer.Layer<McpServer.McpServer, E, never>
  )
  const dispatchHandler = (request: Request): Promise<Response> =>
    runtime.runPromise(McpServer.handleWebRequest(request))
  return {
    dispose: () => runtime.dispose(),
    handler: (request: Request, handleOptions?: HandleRequestOptions) =>
      handleRequest(request, dispatchHandler, options, handleOptions)
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
      return options.modern === true
        ? withModernProtocolVersionHeader(request, hostResponse)
        : hostResponse
    }
    const originResponse = originHeaderValidationResponse(request, options.allowedOrigins)
    if (originResponse) {
      return options.modern === true
        ? withModernProtocolVersionHeader(request, originResponse)
        : originResponse
    }
  }

  if (options.modern === true) {
    const modernResponse = await handleModernRequest(request, options)
    if (modernResponse) {
      return withModernProtocolVersionHeader(request, modernResponse)
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
    const response = new Response(null, { status: 202 })
    return options.modern === true ? withModernProtocolVersionHeader(request, response) : response
  }

  const authInfo = handleOptions.authInfo ?? extractBearerAuthInfo(request.headers)
  const response = await handler(withAuthInfo(request, authInfo))
  const convertedResponse = await convertJsonResponseToSseIfRequested(request, response)
  return options.modern === true
    ? withModernProtocolVersionHeader(request, convertedResponse)
    : convertedResponse
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

const handleModernRequest = async (
  request: Request,
  options: StreamableHttpServerTransportOptions
): Promise<Response | undefined> => {
  if (request.method !== "POST") {
    return methodNotAllowedResponse()
  }

  let body: Record<string, unknown> | undefined
  try {
    body = await request.clone().json() as Record<string, unknown>
  } catch {
    return undefined
  }
  const method = typeof body.method === "string" ? body.method : undefined
  const headerMethod = request.headers.get(MCP_METHOD_HEADER)
  const headerVersion = request.headers.get(MCP_PROTOCOL_VERSION_HEADER)
  const supportedVersions = options.supportedProtocolVersions ?? [MODERN_PROTOCOL_VERSION]

  if (!headerVersion) {
    return headerMismatchResponse(`Missing ${MCP_PROTOCOL_VERSION_HEADER} header`, body.id)
  }
  if (!headerMethod) {
    return headerMismatchResponse(`Missing ${MCP_METHOD_HEADER} header`, body.id)
  }
  if (!method) {
    return headerMismatchResponse("Missing JSON-RPC method in request body", body.id)
  }

  if (!supportedVersions.includes(headerVersion)) {
    return Response.json({
      jsonrpc: "2.0",
      id: body.id ?? null,
      error: {
        code: UNSUPPORTED_PROTOCOL_VERSION_ERROR_CODE,
        message: `Unsupported MCP protocol version: ${headerVersion}`,
        data: { supported: supportedVersions, requested: headerVersion }
      }
    }, { status: 400 })
  }

  if (headerMethod !== method) {
    return headerMismatchResponse(
      `MCP header/body method mismatch: ${headerMethod} !== ${method}`,
      body.id
    )
  }

  const params = body.params as { readonly name?: unknown } | undefined
  const headerName = request.headers.get(MCP_NAME_HEADER)
  const bodyName = typeof params?.name === "string" ? params.name : undefined
  if (bodyName && !headerName) {
    return headerMismatchResponse(`Missing ${MCP_NAME_HEADER} header`, body.id)
  }
  if (headerName && !bodyName) {
    return headerMismatchResponse(
      `${MCP_NAME_HEADER} header requires a string params.name in the body`,
      body.id
    )
  }
  if (headerName && bodyName && headerName !== bodyName) {
    return headerMismatchResponse(
      `MCP header/body name mismatch: ${headerName} !== ${bodyName}`,
      body.id
    )
  }

  if (method === SERVER_DISCOVER_METHOD) {
    return Response.json({
      jsonrpc: "2.0",
      id: body.id ?? null,
      result: makeDiscoverResult({
        supportedVersions,
        capabilities: {
          tools: {},
          resources: {},
          prompts: {},
          completions: {},
          logging: {},
          extensions: (options.extensions ?? {}) as never
        },
        serverInfo: { name: options.name, version: options.version },
        instructions: options.instructions,
        ttlMs: 60_000,
        cacheScope: "public"
      })
    })
  }

  return undefined
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

const jsonRpcErrorResponse = (
  status: number,
  message: string,
  code = -32000,
  id: unknown = null
): Response =>
  Response.json(
    {
      jsonrpc: "2.0",
      error: {
        code,
        message
      },
      id
    },
    { status }
  )

const headerMismatchResponse = (message: string, id: unknown = null): Response =>
  Response.json(
    {
      jsonrpc: "2.0",
      error: {
        code: HEADER_MISMATCH_ERROR_CODE,
        message
      },
      id
    } satisfies HeaderMismatchErrorResponse,
    { status: 400 }
  )

const withModernProtocolVersionHeader = (request: Request, response: Response): Response => {
  const protocolVersion =
    request.headers.get(MCP_PROTOCOL_VERSION_HEADER) ?? MODERN_PROTOCOL_VERSION
  const headers = new Headers(response.headers)
  headers.set(MCP_PROTOCOL_VERSION_HEADER, protocolVersion)
  return new Response(response.body, {
    headers,
    status: response.status,
    statusText: response.statusText
  })
}

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
