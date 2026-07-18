/** Modern, stateless MCP Streamable HTTP server transport. */
import * as Cause from "effect/Cause"
import * as Chunk from "effect/Chunk"
import * as Context from "effect/Context"
import * as Deferred from "effect/Deferred"
import * as Effect from "effect/Effect"
import * as Either from "effect/Either"
import * as ExecutionStrategy from "effect/ExecutionStrategy"
import * as Exit from "effect/Exit"
import * as Layer from "effect/Layer"
import * as ManagedRuntime from "effect/ManagedRuntime"
import * as Queue from "effect/Queue"
import * as Ref from "effect/Ref"
import * as Schema from "effect/Schema"
import * as Scope from "effect/Scope"
import * as Stream from "effect/Stream"
import * as Take from "effect/Take"
import * as McpDispatcher from "../McpDispatcher.js"
import * as McpServer from "../McpServer.js"
import {
  InternalError,
  InvalidParams,
  InvalidRequest,
  MethodNotFound,
  TransportError,
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
  SERVER_NOTIFICATION_PAYLOAD_CODEC_BY_METHOD,
  isClientRequestMethod
} from "../generated/mcp/2026-07-28/McpProtocol.generated.js"
import * as HttpMetadata from "./HttpMetadata.js"

const DEFAULT_MAX_BODY_BYTES = 1024 * 1024
const DEFAULT_MAX_PENDING_FRAMES = 16
const FAILURE_REPORT_TIMEOUT = "1 second"

interface BodyReadTooLarge {
  readonly _tag: "BodyReadTooLarge"
  readonly cleanupFailed: boolean
  readonly cleanupCause: unknown
}

interface ResponseScopeOwnerService {
  readonly fork: Effect.Effect<Scope.CloseableScope>
  readonly supervise: (
    start: () => Effect.Effect<void, unknown>
  ) => Effect.Effect<void>
}

class ResponseScopeOwner extends Context.Tag(
  "mcp-effect-sdk/StreamableHttpServerTransport/ResponseScopeOwner"
)<ResponseScopeOwner, ResponseScopeOwnerService>() {}

const makeResponseScopeOwner = (
  parent: Scope.Scope
): ResponseScopeOwnerService => ({
  fork: Scope.fork(parent, ExecutionStrategy.sequential),
  supervise: (start) => Effect.gen(function*() {
    const accepted = yield* Deferred.make<void>()
    const report = Effect.suspend(() => {
      let effect: Effect.Effect<void, unknown>
      try {
        effect = start()
      } catch {
        return Deferred.succeed(accepted, undefined).pipe(Effect.asVoid)
      }
      return Deferred.succeed(accepted, undefined).pipe(
        Effect.zipRight(effect)
      )
    }).pipe(
      Effect.timeout(FAILURE_REPORT_TIMEOUT),
      Effect.catchAllCause(() => Effect.void)
    )
    yield* report.pipe(Effect.forkIn(parent))
    yield* Deferred.await(accepted).pipe(
      Effect.timeout(FAILURE_REPORT_TIMEOUT),
      Effect.catchAllCause(() => Effect.void)
    )
  })
})

export type ScopedWebHandler = (
  request: Request,
  handleOptions?: HandleRequestOptions
) => Effect.Effect<Response>

class ScopedWebHandlerService extends Context.Tag(
  "mcp-effect-sdk/StreamableHttpServerTransport/ScopedWebHandler"
)<ScopedWebHandlerService, ScopedWebHandler>() {}

export interface AuthInfo {
  readonly token?: string | undefined
  readonly clientId?: string | undefined
  readonly scopes?: ReadonlyArray<string> | undefined
  readonly extra?: unknown
}

export interface ExtensionNotificationContext {
  readonly authorizationPrincipal: AuthInfo | undefined
  readonly requestHeaders: Readonly<Record<string, string>>
}

export type ExtensionNotificationHandler = (
  notification: McpWire.JsonRpcNotification,
  context: ExtensionNotificationContext
) => Effect.Effect<void, McpError>

export type HttpServerFailureStage =
  | "request_body"
  | "json_response"
  | "sse_response"

export interface HttpServerFailureDiagnostic {
  readonly stage: HttpServerFailureStage
  readonly cause: Cause.Cause<unknown>
}

export type HttpServerFailureSink = (
  diagnostic: HttpServerFailureDiagnostic
) => Effect.Effect<void, unknown>

export interface StreamableHttpServerTransportOptions
  extends McpServer.ServerLayerOptions {
  readonly path: string
  readonly enableJsonResponse?: boolean | undefined
  readonly allowedHosts?: ReadonlyArray<string> | undefined
  readonly allowedOrigins?: ReadonlyArray<string> | undefined
  readonly enableDnsRebindingProtection?: boolean | undefined
  readonly maxBodyBytes?: number | undefined
  readonly maxPendingFrames?: number | undefined
  readonly warningSink?: HttpMetadata.HttpToolWarningSink | undefined
  readonly failureSink?: HttpServerFailureSink | undefined
  readonly acceptNotification?: ExtensionNotificationHandler | undefined
}

export interface HandleRequestOptions {
  readonly parsedBody?: unknown
  /** Trusted byte length of the original body consumed by an upstream parser. */
  readonly parsedBodyByteLength?: number | undefined
  readonly authInfo?: AuthInfo | undefined
}

type TrustedParsedBodyOptions = {
  readonly _tag: "Trusted"
  readonly parsedBody: unknown
  readonly parsedBodyByteLength: unknown
}

const trustedParsedBodyOptions = (
  options: HandleRequestOptions
): TrustedParsedBodyOptions | { readonly _tag: "Invalid" } => {
  let parsedBody: PropertyDescriptor | undefined
  let parsedBodyByteLength: PropertyDescriptor | undefined
  try {
    parsedBody = Object.getOwnPropertyDescriptor(options, "parsedBody")
    parsedBodyByteLength = Object.getOwnPropertyDescriptor(
      options,
      "parsedBodyByteLength"
    )
  } catch {
    return { _tag: "Invalid" }
  }
  if ((parsedBody !== undefined && !("value" in parsedBody)) ||
    (parsedBodyByteLength !== undefined && !("value" in parsedBodyByteLength))) {
    return { _tag: "Invalid" }
  }
  return {
    _tag: "Trusted",
    parsedBody: parsedBody?.value,
    parsedBodyByteLength: parsedBodyByteLength?.value
  }
}

interface ValidatedOptions {
  readonly maxBodyBytes: number
  readonly maxPendingFrames: number
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
  const maxPendingFrames = options.maxPendingFrames ?? DEFAULT_MAX_PENDING_FRAMES
  if (!Number.isSafeInteger(maxPendingFrames) || maxPendingFrames <= 0) {
    throw new RangeError("maxPendingFrames must be a positive safe integer")
  }
  return {
    maxBodyBytes,
    maxPendingFrames,
    supportedProtocolVersions:
      options.supportedProtocolVersions !== undefined &&
      options.supportedProtocolVersions.length > 0
        ? [...options.supportedProtocolVersions]
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
  validateOptions(options)
  const serverLayer = appLayer.pipe(Layer.provideMerge(Layer.effect(
    McpServer.McpServer,
    McpServer.McpServer.makeWithOptions(options)
  )))
  const handlerLayer = Layer.scoped(ScopedWebHandlerService, Effect.gen(function*() {
    const server = yield* McpServer.McpServer
    return yield* makeScopedHandler(server, options)
  }))
  const runtime = ManagedRuntime.make(
    handlerLayer.pipe(Layer.provideMerge(serverLayer)) as Layer.Layer<
      A | McpServer.McpServer | ScopedWebHandlerService,
      E,
      never
    >
  )
  return {
    dispose: () => runtime.dispose(),
    handler: (request: Request, handleOptions?: HandleRequestOptions) =>
      runtime.runPromise(
        ScopedWebHandlerService.pipe(Effect.flatMap((handler) =>
          handler(request, handleOptions))),
        { signal: request.signal }
      )
  }
}

/** @internal Build a handler whose response scopes are children of the current scope. */
export const makeScopedHandler = (
  server: McpServer.McpServerService,
  options: StreamableHttpServerTransportOptions
): Effect.Effect<ScopedWebHandler, never, Scope.Scope> => Effect.gen(function*() {
  const validated = validateOptions(options)
  const parent = yield* Effect.scope
  const owner = makeResponseScopeOwner(parent)
  return (request, handleOptions) => handleValidated(
    request,
    options,
    validated,
    handleOptions
  ).pipe(
    Effect.provideService(McpServer.McpServer, server),
    Effect.provideService(ResponseScopeOwner, owner)
  )
})

/** Handle one modern HTTP request using the current MCP server registry. */
export const handle = (
  request: Request,
  options: StreamableHttpServerTransportOptions,
  handleOptions: HandleRequestOptions = {}
): Effect.Effect<Response, never, McpServer.McpServer | Scope.Scope> => {
  const validated = validateOptions(options)
  return Effect.gen(function*() {
    const parent = yield* Effect.scope
    return yield* handleValidated(request, options, validated, handleOptions).pipe(
      Effect.provideService(ResponseScopeOwner, makeResponseScopeOwner(parent))
    )
  })
}

const handleValidated = (
  request: Request,
  options: StreamableHttpServerTransportOptions,
  validated: ValidatedOptions,
  handleOptions: HandleRequestOptions = {}
): Effect.Effect<Response, never, McpServer.McpServer | ResponseScopeOwner> => Effect.gen(function*() {
  const owner = yield* ResponseScopeOwner
  let protocolVersion = defaultProtocolVersion(validated)
  const finish = (response: Response): Response =>
    withProtocolVersion(response, protocolVersion)
  const rejectBeforeBody = (response: Response): Effect.Effect<Response> =>
    releaseRequestBody(request).pipe(Effect.as(finish(response)))

  if (new URL(request.url).pathname !== options.path) {
    return yield* rejectBeforeBody(bodylessResponse(404))
  }

  if (!validOrigin(request, options.allowedOrigins)) {
    return yield* rejectBeforeBody(bodylessResponse(403))
  }

  if (options.enableDnsRebindingProtection === true &&
    !validateHostHeader(
      request.headers.get("host"),
      options.allowedHosts ?? localhostAllowedHostnames()
    ).ok) {
    return yield* rejectBeforeBody(bodylessResponse(403))
  }

  if (request.method !== "POST") {
    const response = bodylessResponse(405)
    response.headers.set("Allow", "POST")
    return yield* rejectBeforeBody(response)
  }

  if (!isJsonContentType(request.headers.get("content-type"))) {
    return yield* rejectBeforeBody(bodylessResponse(415))
  }

  if (!acceptsJsonAndSse(request.headers.get("accept"))) {
    return yield* rejectBeforeBody(bodylessResponse(406))
  }

  const parsedInput = trustedParsedBodyOptions(handleOptions)
  if (parsedInput._tag === "Invalid") {
    return yield* rejectBeforeBody(bodylessResponse(400))
  }
  const decoded = yield* decodeBody(
    request,
    parsedInput.parsedBody,
    parsedInput.parsedBodyByteLength,
    validated.maxBodyBytes,
    options.failureSink,
    owner.supervise
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

  const requestedVersion = request.headers.get(MCP_PROTOCOL_VERSION_HEADER) ?? ""
  const unsupportedVersion = () => new UnsupportedProtocolVersionError({
        message: "Unsupported MCP protocol version",
        data: {
          requested: requestedVersion,
          supported: [...validated.supportedProtocolVersions]
        }
      })

  if (message._tag === "Notification") {
    const standardHeaders = yield* HttpMetadata.validateStandardRequestHeaders(
      message,
      request.headers
    ).pipe(Effect.either)
    if (Either.isLeft(standardHeaders) ||
      !validated.supportedProtocolVersions.includes(requestedVersion)) {
      return finish(bodylessResponse(400))
    }
    protocolVersion = requestedVersion
    if (message.method === "notifications/cancelled" ||
      options.acceptNotification === undefined) {
      return finish(bodylessResponse(400))
    }
    const accepted = yield* options.acceptNotification(message, {
      authorizationPrincipal: handleOptions.authInfo,
      requestHeaders: cloneRequestHeaders(request.headers)
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
  if (!validated.supportedProtocolVersions.includes(requestedVersion)) {
    return finish(jsonRpcErrorResponse(message.id, unsupportedVersion()))
  }
  protocolVersion = requestedVersion

  if (!knownMethod) {
    return finish(jsonRpcErrorResponse(
      message.id,
      new MethodNotFound({ message: "Method not found" })
    ))
  }

  const server = yield* McpServer.McpServer
  const httpServer = yield* prepareHttpServer(
    server,
    exactRequest,
    request.headers,
    options.warningSink
  ).pipe(Effect.either)
  if (Either.isLeft(httpServer)) {
    return finish(jsonRpcErrorResponse(message.id, httpServer.left))
  }

  const response = yield* dispatchOrdinaryRequest(
    exactRequest,
    handleOptions.authInfo,
    httpServer.right,
    options.enableJsonResponse === true,
    validated.maxPendingFrames,
    options.failureSink
  )
  return finish(response)
})

const nonFailingWarningSink = (
  sink: HttpMetadata.HttpToolWarningSink
): HttpMetadata.HttpToolWarningSink => (warning) => Effect.suspend(() => sink(warning)).pipe(
  Effect.catchAll(() => Effect.void),
  Effect.catchAllDefect(() => Effect.void)
)

const reportHttpFailure = (
  sink: HttpServerFailureSink | undefined,
  stage: HttpServerFailureStage,
  cause: Cause.Cause<unknown>
): Effect.Effect<void> => sink === undefined
  ? Effect.void
  : Effect.suspend(() => sink({ stage, cause })).pipe(
    Effect.catchAllCause(() => Effect.void)
  )

const httpServerWithTools = (
  server: McpServer.McpServerService,
  tools: McpServer.McpServerService["tools"]
): McpServer.McpServerService => ({
  ...server,
  tools,
  callTool: (request) => {
    const entry = tools.find(({ tool }) => tool.name === request.name)
    return entry === undefined
      ? Effect.fail(new InvalidParams({ message: "Tool not found" }))
      : entry.handler(request)
  }
})

const visibleToolEntries = (
  server: McpServer.McpServerService,
  visible: ReadonlyArray<HttpMetadata.HttpToolDefinition>
): McpServer.McpServerService["tools"] => {
  const definitions = new Set(visible)
  return server.tools.filter((entry) => definitions.has(entry.tool))
}

const prepareHttpServer = (
  server: McpServer.McpServerService,
  request: McpWire.JsonRpcRequest,
  headers: Headers,
  configuredWarningSink: HttpMetadata.HttpToolWarningSink | undefined
): Effect.Effect<McpServer.McpServerService, McpError> => Effect.gen(function*() {
  if (request.method !== "tools/list" && request.method !== "tools/call") {
    return server
  }

  const warningSink = nonFailingWarningSink(
    configuredWarningSink ?? ((warning) => Effect.logWarning(warning))
  )
  const candidates = request.method === "tools/list"
    ? server.tools
    : server.tools.filter(({ tool }) =>
      typeof request.params === "object" && request.params !== null &&
      tool.name === (request.params as { readonly name?: unknown }).name)
  const catalog = yield* HttpMetadata.filterHttpTools(
    candidates.map(({ tool }) => tool),
    warningSink
  )
  const tools = visibleToolEntries(server, catalog.tools)

  if (request.method === "tools/call" && tools.length > 0) {
    const params = request.params as {
      readonly name: string
      readonly arguments?: unknown
    }
    const plan = catalog.plans[params.name]
    if (plan !== undefined) {
      yield* HttpMetadata.validateToolHeaders(plan, params.arguments, headers)
    }
  }

  return httpServerWithTools(server, tools)
})

type TerminalMessage = McpWire.JsonRpcSuccessResponse | McpWire.JsonRpcErrorResponse
type ResponseSendState = "Open" | "Terminal" | "Closed"
type SseOutput = {
  readonly take: Take.Take<Uint8Array, InternalError>
  readonly releasesFrameSlot: boolean
}

const responseAlreadyComplete = (): TransportError => new TransportError({
  message: "HTTP response is already complete"
})

const notificationInJsonMode = (): InternalError => new InternalError({
  message: "Request-bound notifications require an SSE response"
})

const terminalForError = (
  id: McpWire.JsonRpcId,
  error: McpError
): McpWire.JsonRpcErrorResponse => ({
  _tag: "ErrorResponse",
  jsonrpc: "2.0",
  id,
  error: toJsonRpcErrorObject(error)
})

const encodeSseFrame = (
  message: McpWire.JsonRpcNotification | TerminalMessage
): Effect.Effect<Uint8Array, InternalError> => {
  const validated: Effect.Effect<
    McpWire.JsonRpcNotification | TerminalMessage,
    InternalError
  > = message._tag === "Notification"
    ? validateServerNotification(message)
    : Effect.succeed(message)
  return validated.pipe(Effect.flatMap((value) => {
    const encoded = McpWire.encodeJsonRpcText(value)
    return Either.isLeft(encoded)
      ? Effect.fail(new InternalError({ message: "Could not encode HTTP response frame" }))
      : Effect.succeed(new TextEncoder().encode(
        `event: message\ndata: ${encoded.right}\n\n`
      ))
  }))
}

const validateServerNotification = (
  notification: McpWire.JsonRpcNotification
): Effect.Effect<McpWire.JsonRpcNotification, InternalError> => {
  if (!Object.hasOwn(
    SERVER_NOTIFICATION_PAYLOAD_CODEC_BY_METHOD,
    notification.method
  )) return Effect.succeed(notification)
  const codec = SERVER_NOTIFICATION_PAYLOAD_CODEC_BY_METHOD[
    notification.method as keyof typeof SERVER_NOTIFICATION_PAYLOAD_CODEC_BY_METHOD
  ]
  const decoded = Schema.decodeUnknownEither(
    codec as Schema.Schema.AnyNoContext
  )(notification.params)
  return Either.isLeft(decoded)
    ? Effect.fail(new InternalError({
      message: "Could not encode HTTP response frame",
      cause: decoded.left
    }))
    : Effect.succeed(notification)
}

type SubscriptionFilter = {
  readonly promptsListChanged?: boolean
  readonly resourcesListChanged?: boolean
  readonly resourceSubscriptions?: ReadonlyArray<string>
  readonly toolsListChanged?: boolean
}

const exactSubscriptionFilter = (
  value: SubscriptionFilter
): SubscriptionFilter => ({
  ...(value.promptsListChanged === undefined
    ? {}
    : { promptsListChanged: value.promptsListChanged }),
  ...(value.resourcesListChanged === undefined
    ? {}
    : { resourcesListChanged: value.resourcesListChanged }),
  ...(value.resourceSubscriptions === undefined
    ? {}
    : { resourceSubscriptions: [...value.resourceSubscriptions] }),
  ...(value.toolsListChanged === undefined
    ? {}
    : { toolsListChanged: value.toolsListChanged })
})

const subscriptionAcknowledged = (
  id: McpWire.JsonRpcId,
  notifications: SubscriptionFilter
): McpWire.JsonRpcNotification => ({
  _tag: "Notification",
  jsonrpc: "2.0",
  method: "notifications/subscriptions/acknowledged",
  params: {
    notifications,
    _meta: { "io.modelcontextprotocol/subscriptionId": id }
  }
})

const registryNotification = (
  notification: McpServer.ServerNotification
): McpWire.JsonRpcNotification => ({
  _tag: "Notification",
  jsonrpc: "2.0",
  method: notification.tag,
  params: notification.payload as McpWire.JsonRpcNotification["params"]
})

const makeDispatcherInScope = <SendError>(
  childScope: Scope.CloseableScope,
  server: McpServer.McpServerService,
  send: (
    message: McpWire.JsonRpcSuccessResponse | McpWire.JsonRpcErrorResponse | McpWire.JsonRpcNotification
  ) => Effect.Effect<void, SendError>
) => Scope.extend(
  McpServer.makeDispatcher({ send }).pipe(
    Effect.provideService(McpServer.McpServer, server)
  ),
  childScope
)

const acceptOwnedRequest = <SendError>(
  dispatcher: McpDispatcher.ServerDispatcher,
  request: McpWire.JsonRpcRequest,
  authorizationPrincipal: AuthInfo | undefined,
  send: (message: TerminalMessage) => Effect.Effect<void, SendError>
): Effect.Effect<void, SendError> => dispatcher.accept(request, {
  authorizationPrincipal
}).pipe(
  Effect.catchAll((error) => send(terminalForError(request.id, error)))
)

const dispatchJsonRequest = (
  childScope: Scope.CloseableScope,
  request: McpWire.JsonRpcRequest,
  authorizationPrincipal: AuthInfo | undefined,
  server: McpServer.McpServerService,
  maxPendingFrames: number,
  failureSink: HttpServerFailureSink | undefined
): Effect.Effect<Response, never> => Effect.gen(function*() {
  const output = yield* Queue.bounded<TerminalMessage>(maxPendingFrames)
  const state = yield* Ref.make<ResponseSendState>("Open")
  const lock = yield* Effect.makeSemaphore(1)
  yield* Scope.addFinalizer(childScope, Ref.set(state, "Closed").pipe(
    Effect.zipRight(Queue.shutdown(output))
  ))

  const send = (
    message: McpWire.JsonRpcNotification | TerminalMessage
  ): Effect.Effect<void, InternalError | TransportError> => lock.withPermits(1)(
    Effect.gen(function*() {
      if ((yield* Ref.get(state)) !== "Open") {
        return yield* Effect.fail(responseAlreadyComplete())
      }
      if (message._tag === "Notification") {
        return yield* Effect.fail(notificationInJsonMode())
      }
      yield* Ref.set(state, "Terminal")
      yield* Queue.offer(output, message)
    })
  )

  const dispatcher = yield* makeDispatcherInScope(childScope, server, send)
  yield* acceptOwnedRequest(dispatcher, request, authorizationPrincipal, send)
  const terminal = yield* Queue.take(output)
  yield* Scope.close(childScope, Exit.void)
  return terminalResponse(terminal)
}).pipe(
  Effect.ensuring(Scope.close(childScope, Exit.void)),
  Effect.catchAllCause((cause) => Cause.isInterruptedOnly(cause)
    ? Effect.interrupt
    : reportHttpFailure(failureSink, "json_response", cause).pipe(
      Effect.as(jsonRpcErrorResponse(
        request.id,
        new InternalError({ message: "HTTP response failed" })
      ))
    ))
)

const dispatchSseRequest = (
  childScope: Scope.CloseableScope,
  request: McpWire.JsonRpcRequest,
  authorizationPrincipal: AuthInfo | undefined,
  server: McpServer.McpServerService,
  maxPendingFrames: number,
  failureSink: HttpServerFailureSink | undefined
): Effect.Effect<Response, never> => Effect.gen(function*() {
  const output = yield* Queue.bounded<SseOutput>(maxPendingFrames + 1)
  const frameSlots = yield* Effect.makeSemaphore(maxPendingFrames)
  const state = yield* Ref.make<ResponseSendState>("Open")
  const lock = yield* Effect.makeSemaphore(1)
  let closeSubscription = () => {}
  yield* Scope.addFinalizer(childScope, Ref.set(state, "Closed").pipe(
    Effect.zipRight(frameSlots.releaseAll),
    Effect.zipRight(Queue.shutdown(output))
  ))

  const offerFrame = (
    take: Take.Take<Uint8Array, InternalError>
  ): Effect.Effect<void> => Effect.uninterruptibleMask((restore) => Effect.gen(function*() {
    yield* restore(frameSlots.take(1))
    const offered = yield* restore(Queue.offer(output, {
      take,
      releasesFrameSlot: true
    })).pipe(Effect.exit)
    if (Exit.isFailure(offered)) {
      yield* frameSlots.release(1)
      return yield* Effect.failCause(offered.cause)
    }
  }))

  const offerControl = (
    take: Take.Take<Uint8Array, InternalError>
  ): Effect.Effect<void> => Queue.offer(output, {
    take,
    releasesFrameSlot: false
  }).pipe(Effect.asVoid, Effect.uninterruptible)

  const failStreamUnlocked = (error: InternalError): Effect.Effect<void> =>
    Effect.gen(function*() {
      if ((yield* Ref.get(state)) !== "Open") return
      closeSubscription()
      yield* Ref.set(state, "Closed")
      const failure = new InternalError({
        message: "HTTP response stream failed",
        cause: error
      })
      yield* offerControl(Take.fail(failure))
      yield* reportHttpFailure(
        failureSink,
        "sse_response",
        Cause.fail(error)
      )
    })

  const offerUnlocked = (
    message: McpWire.JsonRpcNotification | TerminalMessage
  ): Effect.Effect<void, InternalError> => Effect.gen(function*() {
    const frame = yield* encodeSseFrame(message).pipe(
      Effect.catchAll((error) => failStreamUnlocked(error).pipe(
        Effect.zipRight(Effect.fail(error))
      ))
    )
    if (message._tag !== "Notification") {
      yield* Ref.set(state, "Terminal")
    }
    yield* offerFrame(Take.chunk(Chunk.of(frame)))
    if (message._tag !== "Notification") {
      yield* offerControl(Take.end)
    }
  })

  const failSubscriptionStream = (error: InternalError): Effect.Effect<void> =>
    lock.withPermits(1)(failStreamUnlocked(error))

  const send = (
    message: McpWire.JsonRpcNotification | TerminalMessage
  ): Effect.Effect<void, InternalError | TransportError> => lock.withPermits(1)(
    Effect.gen(function*() {
      if ((yield* Ref.get(state)) !== "Open") {
        return yield* Effect.fail(responseAlreadyComplete())
      }
      yield* offerUnlocked(message)
    })
  )

  const dispatcher = yield* makeDispatcherInScope(childScope, server, send)
  yield* acceptOwnedRequest(dispatcher, request, authorizationPrincipal, send)
  if (request.method === "subscriptions/listen") {
    const params = request.params as {
      readonly notifications: SubscriptionFilter
    }
    const notifications = exactSubscriptionFilter(params.notifications)
    yield* lock.withPermits(1)(Effect.gen(function*() {
      if ((yield* Ref.get(state)) !== "Open") {
        return yield* Effect.fail(responseAlreadyComplete())
      }
      const closeRegistry = server.openSubscription(
        request.id,
        notifications,
        (notification) => send(registryNotification(notification)).pipe(
          Effect.catchAll((error) => error instanceof TransportError
            ? Effect.void
            : failSubscriptionStream(error))
        )
      )
      let registryOpen = true
      closeSubscription = () => {
        if (!registryOpen) return
        registryOpen = false
        closeRegistry()
      }
      yield* Scope.addFinalizer(childScope, Effect.sync(closeSubscription))
      yield* offerUnlocked(subscriptionAcknowledged(request.id, notifications))
    }))
  }
  const runtime = yield* Effect.runtime<never>()
  const body = Stream.fromQueue(output, { maxChunkSize: 1 }).pipe(
    Stream.mapEffect(({ take, releasesFrameSlot }) => releasesFrameSlot
      ? frameSlots.release(1).pipe(Effect.as(take))
      : Effect.succeed(take)),
    Stream.flattenTake,
    Stream.ensuring(Scope.close(childScope, Exit.void)),
    Stream.toReadableStreamRuntime(runtime, { strategy: { highWaterMark: 0 } })
  )
  return new Response(body, {
    status: 200,
    headers: {
      "content-type": "text/event-stream",
      "cache-control": "no-cache",
      "x-accel-buffering": "no"
    }
  })
}).pipe(
  Effect.catchAllCause((cause) => Scope.close(childScope, Exit.void).pipe(
    Effect.zipRight(Cause.isInterruptedOnly(cause)
      ? Effect.interrupt
      : reportHttpFailure(failureSink, "sse_response", cause).pipe(
        Effect.as(jsonRpcErrorResponse(
          request.id,
          new InternalError({ message: "HTTP response failed" })
        ))
      ))
  ))
)

const dispatchOrdinaryRequest = (
  request: McpWire.JsonRpcRequest,
  authorizationPrincipal: AuthInfo | undefined,
  server: McpServer.McpServerService,
  enableJsonResponse: boolean,
  maxPendingFrames: number,
  failureSink: HttpServerFailureSink | undefined
): Effect.Effect<Response, never, ResponseScopeOwner> => Effect.gen(function*() {
  const owner = yield* ResponseScopeOwner
  const childScope = yield* owner.fork
  return yield* (enableJsonResponse && request.method !== "subscriptions/listen"
    ? dispatchJsonRequest(
      childScope,
      request,
      authorizationPrincipal,
      server,
      maxPendingFrames,
      failureSink
    )
    : dispatchSseRequest(
      childScope,
      request,
      authorizationPrincipal,
      server,
      maxPendingFrames,
      failureSink
    ))
})

const decodeBody = (
  request: Request,
  parsedBody: unknown,
  parsedBodyByteLength: unknown,
  maxBodyBytes: number,
  failureSink: HttpServerFailureSink | undefined,
  superviseFailure: (
    start: () => Effect.Effect<void, unknown>
  ) => Effect.Effect<void>
): Effect.Effect<BodyDecodeResult> => {
  const contentLength = declaredContentLength(request)
  if (contentLength !== undefined && contentLength > maxBodyBytes) {
    return releaseRequestBody(request).pipe(Effect.as({ _tag: "TooLarge" as const }))
  }
  if (parsedBody !== undefined) {
    if (parsedBodyByteLength !== undefined && (
      typeof parsedBodyByteLength !== "number" ||
      !Number.isSafeInteger(parsedBodyByteLength) ||
      parsedBodyByteLength < 0
    )) {
      return releaseRequestBody(request).pipe(
        Effect.as({ _tag: "Invalid" as const, id: recoverExactId(parsedBody) })
      )
    }
    if (typeof parsedBodyByteLength === "number" && parsedBodyByteLength > maxBodyBytes) {
      return releaseRequestBody(request).pipe(Effect.as({ _tag: "TooLarge" as const }))
    }
    const rawBody = request.body
    if (rawBody === null || request.bodyUsed || rawBody.locked) {
      if (typeof parsedBodyByteLength !== "number") {
        return Effect.succeed({
          _tag: "Invalid" as const,
          id: recoverExactId(parsedBody)
        })
      }
      return Effect.succeed(decodeParsedBody(parsedBody, maxBodyBytes))
    }
    return readBodyBytes(request, maxBodyBytes).pipe(
      Effect.flatMap((result) => finishBodyRead(
        result,
        failureSink,
        superviseFailure,
        () => decodeParsedBody(parsedBody, maxBodyBytes)
      )),
      Effect.catchAll((cause) => reportHttpFailure(
        failureSink,
        "request_body",
        Cause.fail(cause)
      ).pipe(Effect.as({ _tag: "Invalid" as const, id: undefined })))
    )
  }
  return readBodyBytes(request, maxBodyBytes).pipe(
    Effect.flatMap((result) => finishBodyRead(
      result,
      failureSink,
      superviseFailure,
      decodeBytes
    )),
    Effect.catchAll((cause) => reportHttpFailure(
      failureSink,
      "request_body",
      Cause.fail(cause)
    ).pipe(Effect.as({ _tag: "Invalid" as const, id: undefined })))
  )
}

const finishBodyRead = (
  result: Uint8Array | BodyReadTooLarge,
  failureSink: HttpServerFailureSink | undefined,
  superviseFailure: (
    start: () => Effect.Effect<void, unknown>
  ) => Effect.Effect<void>,
  decode: (bytes: Uint8Array) => BodyDecodeResult
): Effect.Effect<BodyDecodeResult> => result instanceof Uint8Array
  ? Effect.succeed(decode(result))
  : (result.cleanupFailed
    ? superviseFailure(() => failureSink === undefined
      ? Effect.void
      : failureSink({
        stage: "request_body",
        cause: Cause.fail(result.cleanupCause)
      }))
    : Effect.void).pipe(Effect.as({ _tag: "TooLarge" as const }))

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
): Effect.Effect<Uint8Array | BodyReadTooLarge, unknown> =>
  Effect.acquireUseRelease(
    Effect.try({
      try: () => request.body?.getReader(),
      catch: (cause) => cause
    }),
    (reader) => {
      if (reader === undefined) return Effect.succeed(new Uint8Array())
      return Effect.tryPromise({
        try: async () => {
          const chunks: Array<Uint8Array> = []
          let total = 0
          while (true) {
            const next = await reader.read()
            if (next.done) break
            if (next.value.byteLength === 0) continue
            total += next.value.byteLength
            if (total > maxBodyBytes) {
              try {
                await reader.cancel()
                return {
                  _tag: "BodyReadTooLarge" as const,
                  cleanupFailed: false,
                  cleanupCause: undefined
                }
              } catch (cleanupCause) {
                return {
                  _tag: "BodyReadTooLarge" as const,
                  cleanupFailed: true,
                  cleanupCause
                }
              }
            }
            chunks.push(next.value)
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
    },
    (reader, exit) => reader === undefined
      ? Effect.void
      : (Exit.isInterrupted(exit)
        ? Effect.tryPromise({
          try: () => reader.cancel(),
          catch: () => undefined
        }).pipe(Effect.ignore)
        : Effect.void).pipe(
          Effect.ensuring(Effect.sync(() => reader.releaseLock()).pipe(Effect.ignore))
        )
  )

const declaredContentLength = (request: Request): number | undefined => {
  const value = request.headers.get("content-length")
  if (value === null || !/^\d+$/.test(value)) return undefined
  const parsed = Number(value)
  return Number.isSafeInteger(parsed) ? parsed : Number.POSITIVE_INFINITY
}

const releaseRequestBody = (request: Request): Effect.Effect<void> => Effect.tryPromise({
  try: async () => {
    const reader = request.body?.getReader()
    if (reader === undefined) return
    try {
      await reader.cancel()
    } catch {
      // Rejection cannot weaken the primary HTTP response.
    } finally {
      reader.releaseLock()
    }
  },
  catch: () => undefined
}).pipe(Effect.ignore)

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

const cloneRequestHeaders = (headers: Headers): Readonly<Record<string, string>> => {
  const clone: Record<string, string> = {}
  headers.forEach((value, name) => {
    Object.defineProperty(clone, name, {
      value,
      enumerable: true,
      configurable: false,
      writable: false
    })
  })
  return Object.freeze(clone)
}

const isJsonContentType = (value: string | null): boolean =>
  value?.split(";", 1)[0]?.trim().toLowerCase() === "application/json"

const acceptsJsonAndSse = (value: string | null): boolean => {
  if (value === null) return false
  let json = false
  let sse = false
  for (const rawRange of value.split(",")) {
    const [rawType, ...rawParameters] = rawRange.split(";")
    const mediaType = rawType?.trim().toLowerCase()
    if (!mediaType) return false
    let quality = 1
    let qualitySeen = false
    for (const rawParameter of rawParameters) {
      const parameter = rawParameter.trim()
      const separator = parameter.indexOf("=")
      if (separator <= 0) return false
      const name = parameter.slice(0, separator).trim().toLowerCase()
      const parameterValue = parameter.slice(separator + 1).trim()
      if (name !== "q" || qualitySeen ||
        !/^(?:0(?:\.\d{0,3})?|1(?:\.0{0,3})?)$/.test(parameterValue)) {
        return false
      }
      qualitySeen = true
      quality = Number(parameterValue)
    }
    if (mediaType === "application/json") json ||= quality > 0
    if (mediaType === "text/event-stream") sse ||= quality > 0
  }
  return json && sse
}

const defaultProtocolVersion = (
  options: ValidatedOptions
): string => options.supportedProtocolVersions[0] ?? MODERN_PROTOCOL_VERSION

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

  if (/\s|[@/?#\\,]/.test(hostHeader)) {
    return { ok: false, errorCode: "invalid_host_header", message: "Host header rejected" }
  }
  const authority = hostHeader.startsWith("[")
    ? /^\[[0-9a-f:.]+\](?::\d+)?$/i.test(hostHeader)
    : /^[a-z0-9.-]+(?::\d+)?$/i.test(hostHeader)
  if (!authority) {
    return { ok: false, errorCode: "invalid_host_header", message: "Host header rejected" }
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
