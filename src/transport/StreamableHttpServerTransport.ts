/** Modern, stateless MCP Streamable HTTP server transport. */
import * as Deferred from "effect/Deferred"
import * as Effect from "effect/Effect"
import * as Either from "effect/Either"
import * as Layer from "effect/Layer"
import * as ManagedRuntime from "effect/ManagedRuntime"
import * as Schema from "effect/Schema"
import * as McpServer from "../McpServer.js"
import {
  InvalidParams,
  InvalidRequest,
  MethodNotFound,
  UnsupportedProtocolVersionError,
  defaultHttpStatus,
  toJsonRpcErrorObject,
  type McpError
} from "../McpErrors.js"
import {
  MCP_PROTOCOL_VERSION_HEADER,
  MODERN_PROTOCOL_VERSION
} from "../McpModern.js"
import * as McpWire from "../McpWire.js"
import {
  CLIENT_REQUEST_PAYLOAD_CODEC_BY_METHOD,
  isClientRequestMethod
} from "../generated/mcp/2026-07-28/McpProtocol.generated.js"
import * as HttpMetadata from "./HttpMetadata.js"

const DEFAULT_MAX_BODY_BYTES = 1024 * 1024
const BODY_TOO_LARGE = Symbol("BodyTooLarge")

export interface AuthInfo {
  readonly token?: string | undefined
  readonly clientId?: string | undefined
  readonly scopes?: ReadonlyArray<string> | undefined
  readonly extra?: unknown
}

export interface ExtensionNotificationContext {
  readonly authorizationPrincipal: AuthInfo | undefined
}

export type ExtensionNotificationHandler = (
  notification: McpWire.JsonRpcNotification,
  context: ExtensionNotificationContext
) => Effect.Effect<void, McpError>

export interface StreamableHttpServerTransportOptions
  extends McpServer.ServerLayerOptions {
  readonly path: string
  readonly enableJsonResponse?: boolean | undefined
  readonly allowedHosts?: ReadonlyArray<string> | undefined
  readonly allowedOrigins?: ReadonlyArray<string> | undefined
  readonly enableDnsRebindingProtection?: boolean | undefined
  readonly maxBodyBytes?: number | undefined
  readonly maxPendingFrames?: number | undefined
  readonly acceptNotification?: ExtensionNotificationHandler | undefined
}

export interface HandleRequestOptions {
  readonly parsedBody?: unknown
  readonly authInfo?: AuthInfo | undefined
}

interface ValidatedOptions {
  readonly maxBodyBytes: number
  readonly supportedProtocolVersions: ReadonlyArray<string>
}

type DecodedBody = {
  readonly message: McpWire.JsonRpcMessage
  readonly encoded: string
}

type BodyDecodeResult =
  | { readonly _tag: "Decoded"; readonly value: DecodedBody }
  | { readonly _tag: "Invalid"; readonly id: McpWire.JsonRpcId | undefined }
  | { readonly _tag: "TooLarge" }

const validateOptions = (
  options: StreamableHttpServerTransportOptions
): ValidatedOptions => {
  const maxBodyBytes = options.maxBodyBytes ?? DEFAULT_MAX_BODY_BYTES
  if (!Number.isSafeInteger(maxBodyBytes) || maxBodyBytes <= 0) {
    throw new RangeError("maxBodyBytes must be a positive safe integer")
  }
  return {
    maxBodyBytes,
    supportedProtocolVersions:
      options.supportedProtocolVersions !== undefined &&
      options.supportedProtocolVersions.length > 0
        ? options.supportedProtocolVersions
        : [MODERN_PROTOCOL_VERSION]
  }
}

/**
 * Build a Web-standard request handler backed by one managed MCP server
 * registry. The Promise conversion is confined to this Web API edge.
 */
export const toWebHandler = <A, E>(
  appLayer: Layer.Layer<A, E, McpServer.McpServer>,
  options: StreamableHttpServerTransportOptions
) => {
  const validated = validateOptions(options)
  const runtime = ManagedRuntime.make(
    appLayer.pipe(Layer.provideMerge(Layer.effect(
      McpServer.McpServer,
      McpServer.McpServer.makeWithOptions(options)
    ))) as Layer.Layer<McpServer.McpServer, E, never>
  )
  return {
    dispose: () => runtime.dispose(),
    handler: (request: Request, handleOptions?: HandleRequestOptions) =>
      runtime.runPromise(
        handleValidated(request, options, validated, handleOptions),
        { signal: request.signal }
      )
  }
}

/** Handle one modern HTTP request using the current MCP server registry. */
export const handle = (
  request: Request,
  options: StreamableHttpServerTransportOptions,
  handleOptions: HandleRequestOptions = {}
): Effect.Effect<Response, never, McpServer.McpServer> =>
  handleValidated(request, options, validateOptions(options), handleOptions)

const handleValidated = (
  request: Request,
  options: StreamableHttpServerTransportOptions,
  validated: ValidatedOptions,
  handleOptions: HandleRequestOptions = {}
): Effect.Effect<Response, never, McpServer.McpServer> => Effect.gen(function*() {
  const protocolVersion = responseProtocolVersion(request, validated)
  const finish = (response: Response): Response =>
    withProtocolVersion(response, protocolVersion)

  if (!validOrigin(request, options.allowedOrigins)) {
    return finish(bodylessResponse(403))
  }

  if (options.enableDnsRebindingProtection === true &&
    !validateHostHeader(
      request.headers.get("host"),
      options.allowedHosts ?? localhostAllowedHostnames()
    ).ok) {
    return finish(bodylessResponse(403))
  }

  if (request.method !== "POST") {
    const response = bodylessResponse(405)
    response.headers.set("Allow", "POST")
    return finish(response)
  }

  if (!isJsonContentType(request.headers.get("content-type"))) {
    return finish(bodylessResponse(415))
  }

  if (!acceptsJsonAndSse(request.headers.get("accept"))) {
    return finish(bodylessResponse(406))
  }

  const decoded = yield* decodeBody(
    request,
    handleOptions.parsedBody,
    validated.maxBodyBytes
  )
  if (decoded._tag === "TooLarge") {
    return finish(bodylessResponse(413))
  }
  if (decoded._tag === "Invalid") {
    return finish(decoded.id === undefined
      ? bodylessResponse(400)
      : jsonRpcErrorResponse(
        decoded.id,
        new InvalidRequest({ message: "Invalid JSON-RPC request" })
      ))
  }

  const message = decoded.value.message
  if (message._tag === "SuccessResponse" || message._tag === "ErrorResponse") {
    return finish(jsonRpcErrorResponse(
      message.id,
      new InvalidRequest({ message: "Invalid JSON-RPC request" })
    ))
  }

  if (message._tag === "Notification") {
    if (message.method === "notifications/cancelled" ||
      options.acceptNotification === undefined) {
      return finish(bodylessResponse(400))
    }
    const accepted = yield* options.acceptNotification(message, {
      authorizationPrincipal: handleOptions.authInfo
    }).pipe(Effect.exit)
    return finish(accepted._tag === "Success"
      ? bodylessResponse(202)
      : bodylessResponse(400))
  }

  const knownMethod = isClientRequestMethod(message.method)
  let exactRequest = message
  if (knownMethod) {
    const paramsCodec = CLIENT_REQUEST_PAYLOAD_CODEC_BY_METHOD[
      message.method
    ] as Schema.Schema.AnyNoContext
    const exactParams = Schema.decodeUnknownEither(paramsCodec)(message.params)
    if (Either.isLeft(exactParams)) {
      return finish(jsonRpcErrorResponse(
        message.id,
        new InvalidParams({ message: "Invalid request parameters" })
      ))
    }
    exactRequest = { ...message, params: exactParams.right }
  }

  const standardHeaders = yield* HttpMetadata.validateStandardRequestHeaders(
    exactRequest,
    request.headers
  ).pipe(Effect.either)
  if (Either.isLeft(standardHeaders)) {
    return finish(jsonRpcErrorResponse(message.id, standardHeaders.left))
  }

  const requestedVersion = request.headers.get(MCP_PROTOCOL_VERSION_HEADER) ?? ""
  if (!validated.supportedProtocolVersions.includes(requestedVersion)) {
    return finish(jsonRpcErrorResponse(
      message.id,
      new UnsupportedProtocolVersionError({
        message: "Unsupported MCP protocol version",
        data: {
          requested: requestedVersion,
          supported: [...validated.supportedProtocolVersions]
        }
      })
    ))
  }

  if (!knownMethod) {
    return finish(jsonRpcErrorResponse(
      message.id,
      new MethodNotFound({ message: "Method not found" })
    ))
  }

  const terminal = yield* dispatchSingleRequest(
    exactRequest,
    handleOptions.authInfo
  )
  return finish(terminalResponse(terminal))
})

const dispatchSingleRequest = (
  request: McpWire.JsonRpcRequest,
  authorizationPrincipal: AuthInfo | undefined
): Effect.Effect<
  McpWire.JsonRpcSuccessResponse | McpWire.JsonRpcErrorResponse,
  never,
  McpServer.McpServer
> => Effect.scoped(Effect.gen(function*() {
  const terminal = yield* Deferred.make<
    McpWire.JsonRpcSuccessResponse | McpWire.JsonRpcErrorResponse
  >()
  const dispatcher = yield* McpServer.makeDispatcher({
    send: (message) => message._tag === "Notification"
      ? Effect.void
      : Deferred.succeed(terminal, message).pipe(Effect.asVoid)
  })
  yield* dispatcher.accept(request, { authorizationPrincipal }).pipe(
    Effect.catchAll((error) => Deferred.succeed(terminal, {
      _tag: "ErrorResponse" as const,
      jsonrpc: "2.0" as const,
      id: request.id,
      error: toJsonRpcErrorObject(error)
    }).pipe(Effect.asVoid))
  )
  return yield* Deferred.await(terminal)
}))

const decodeBody = (
  request: Request,
  parsedBody: unknown,
  maxBodyBytes: number
): Effect.Effect<BodyDecodeResult> => {
  if (parsedBody !== undefined) {
    return Effect.succeed(decodeParsedBody(parsedBody, maxBodyBytes))
  }
  return readBodyBytes(request, maxBodyBytes).pipe(
    Effect.map((bytes) => bytes === BODY_TOO_LARGE
      ? { _tag: "TooLarge" as const }
      : decodeBytes(bytes)),
    Effect.catchAll(() => Effect.succeed({ _tag: "Invalid" as const, id: undefined }))
  )
}

const decodeParsedBody = (
  parsedBody: unknown,
  maxBodyBytes: number
): BodyDecodeResult => {
  const decoded = McpWire.decodeJsonRpc(parsedBody)
  if (Either.isLeft(decoded)) {
    return { _tag: "Invalid", id: recoverExactId(parsedBody) }
  }
  const encoded = McpWire.encodeJsonRpcText(decoded.right)
  if (Either.isLeft(encoded)) {
    return { _tag: "Invalid", id: recoverExactId(parsedBody) }
  }
  if (new TextEncoder().encode(encoded.right).byteLength > maxBodyBytes) {
    return { _tag: "TooLarge" }
  }
  return {
    _tag: "Decoded",
    value: { message: decoded.right, encoded: encoded.right }
  }
}

const decodeBytes = (bytes: Uint8Array): BodyDecodeResult => {
  const decoded = McpWire.decodeJsonRpcBytes(bytes)
  if (Either.isLeft(decoded)) {
    return { _tag: "Invalid", id: recoverExactIdFromBytes(bytes) }
  }
  const encoded = McpWire.encodeJsonRpcText(decoded.right)
  return Either.isLeft(encoded)
    ? { _tag: "Invalid", id: decoded.right._tag === "Notification" ? undefined : decoded.right.id }
    : {
      _tag: "Decoded",
      value: { message: decoded.right, encoded: encoded.right }
    }
}

const readBodyBytes = (
  request: Request,
  maxBodyBytes: number
): Effect.Effect<Uint8Array | typeof BODY_TOO_LARGE, unknown> =>
  Effect.tryPromise({
    try: async () => {
      const contentLength = request.headers.get("content-length")
      if (contentLength !== null && /^\d+$/.test(contentLength) &&
        Number(contentLength) > maxBodyBytes) {
        return BODY_TOO_LARGE
      }

      const reader = request.body?.getReader()
      if (reader === undefined) return new Uint8Array()
      const chunks: Array<Uint8Array> = []
      let total = 0
      try {
        while (true) {
          const next = await reader.read()
          if (next.done) break
          total += next.value.byteLength
          if (total > maxBodyBytes) {
            await reader.cancel()
            return BODY_TOO_LARGE
          }
          chunks.push(next.value)
        }
      } finally {
        reader.releaseLock()
      }

      const bytes = new Uint8Array(total)
      let offset = 0
      for (const chunk of chunks) {
        bytes.set(chunk, offset)
        offset += chunk.byteLength
      }
      return bytes
    },
    catch: (cause) => cause
  })

const recoverExactIdFromBytes = (
  bytes: Uint8Array
): McpWire.JsonRpcId | undefined => {
  try {
    const value = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes))
    return recoverExactId(value)
  } catch {
    return undefined
  }
}

const recoverExactId = (value: unknown): McpWire.JsonRpcId | undefined => {
  try {
    if (typeof value !== "object" || value === null || Array.isArray(value)) return undefined
    const descriptor = Object.getOwnPropertyDescriptor(value, "id")
    if (descriptor === undefined || !("value" in descriptor)) return undefined
    return typeof descriptor.value === "string" || Number.isSafeInteger(descriptor.value)
      ? descriptor.value as McpWire.JsonRpcId
      : undefined
  } catch {
    return undefined
  }
}

const validOrigin = (
  request: Request,
  allowedOrigins: ReadonlyArray<string> | undefined
): boolean => {
  const origin = request.headers.get("origin")
  return origin === null || allowedOrigins?.includes(origin) === true
}

const isJsonContentType = (value: string | null): boolean =>
  value?.split(";", 1)[0]?.trim().toLowerCase() === "application/json"

const acceptsJsonAndSse = (value: string | null): boolean => {
  if (value === null) return false
  const mediaTypes = value.split(",").map((part) =>
    part.split(";", 1)[0]?.trim().toLowerCase())
  return mediaTypes.includes("application/json") &&
    mediaTypes.includes("text/event-stream")
}

const responseProtocolVersion = (
  request: Request,
  options: ValidatedOptions
): string => {
  const requested = request.headers.get(MCP_PROTOCOL_VERSION_HEADER)
  return requested !== null && options.supportedProtocolVersions.includes(requested)
    ? requested
    : options.supportedProtocolVersions[0] ?? MODERN_PROTOCOL_VERSION
}

const bodylessResponse = (status: number): Response =>
  new Response(null, { status })

const jsonRpcErrorResponse = (
  id: McpWire.JsonRpcId,
  error: McpError
): Response => Response.json({
  jsonrpc: "2.0",
  id,
  error: toJsonRpcErrorObject(error)
}, { status: defaultHttpStatus(error) })

const terminalResponse = (
  terminal: McpWire.JsonRpcSuccessResponse | McpWire.JsonRpcErrorResponse
): Response => terminal._tag === "SuccessResponse"
  ? Response.json({
    jsonrpc: terminal.jsonrpc,
    id: terminal.id,
    result: terminal.result
  })
  : Response.json({
    jsonrpc: terminal.jsonrpc,
    id: terminal.id,
    error: terminal.error
  }, {
    status: terminal.error.code === -32601
      ? 404
      : terminal.error.code === -32603
        ? 500
        : 400
  })

const withProtocolVersion = (
  response: Response,
  protocolVersion: string
): Response => {
  const headers = new Headers(response.headers)
  headers.set(MCP_PROTOCOL_VERSION_HEADER, protocolVersion)
  headers.delete("mcp-session-id")
  headers.delete("last-event-id")
  headers.delete("connection")
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers
  })
}

export type HostHeaderValidationResult =
  | { readonly ok: true; readonly hostname: string }
  | {
    readonly ok: false
    readonly errorCode: "missing_host" | "invalid_host_header" | "invalid_host"
    readonly message: string
  }

export const validateHostHeader = (
  hostHeader: string | null | undefined,
  allowedHosts: ReadonlyArray<string>
): HostHeaderValidationResult => {
  if (!hostHeader) {
    return { ok: false, errorCode: "missing_host", message: "Host header rejected" }
  }

  let hostname: string
  try {
    hostname = new URL(`http://${hostHeader}`).hostname
  } catch {
    return { ok: false, errorCode: "invalid_host_header", message: "Host header rejected" }
  }

  return allowedHosts.includes(hostname)
    ? { ok: true, hostname }
    : { ok: false, errorCode: "invalid_host", message: "Host header rejected" }
}

export const localhostAllowedHostnames = (): ReadonlyArray<string> => [
  "localhost",
  "127.0.0.1",
  "[::1]"
]
