/** Modern, stateless MCP Streamable HTTP server transport. */
import * as Cause from "effect/Cause"
import * as Context from "effect/Context"
import * as Deferred from "effect/Deferred"
import * as Effect from "effect/Effect"
import * as Semaphore from "effect/Semaphore"
import * as Result from "effect/Result"
import * as Exit from "effect/Exit"
import * as Fiber from "effect/Fiber"
import * as Layer from "effect/Layer"
import * as ManagedRuntime from "effect/ManagedRuntime"
import * as Queue from "effect/Queue"
import * as Ref from "effect/Ref"
import * as Schema from "effect/Schema"
import * as Scope from "effect/Scope"
import * as Stream from "effect/Stream"
import type * as Take from "effect/Take"
import { AuthorizationScopeSet, SafeAuthorizationUri } from "../auth/common.js"
import {
  AuthorizationPolicyError,
  BearerAuthorizationError,
  TokenVerificationError
} from "../auth/protected-resource/errors.js"
import type { AuthorizationPrincipal } from "../auth/protected-resource/models.js"
import { type TokenVerifierService } from "../auth/protected-resource/models.js"
import {
  type AuthorizationScopeSatisfaction,
  type AuthorizationScopeSatisfies,
  embedVerifiedAuthorizationPrincipal,
  insufficientScopeChallenge,
  serializeAuthorizationChallenge,
  TokenVerifier,
  unauthorizedChallenge,
  verifyBearerAuthorization
} from "../auth/protected-resource/services.js"
import type * as McpDispatcher from "../McpDispatcher.js"
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
import { MCP_PROTOCOL_VERSION_HEADER, MODERN_PROTOCOL_VERSION } from "../McpModern.js"
import * as McpWire from "../McpWire.js"
import {
  CLIENT_REQUEST_PAYLOAD_CODEC_BY_METHOD,
  SERVER_NOTIFICATION_PAYLOAD_CODEC_BY_METHOD,
  isClientRequestMethod
} from "../generated/mcp/2026-07-28/McpProtocol.generated.js"
import {
  Implementation,
  SubscriptionsListenResult,
  SubscriptionsListenResultResponse
} from "../generated/mcp/2026-07-28/McpSchema.generated.js"
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
  readonly fork: Effect.Effect<Scope.Closeable>
  readonly supervise: (start: () => Effect.Effect<void, unknown>) => Effect.Effect<void>
}

class ResponseScopeOwner extends Context.Service<ResponseScopeOwner, ResponseScopeOwnerService>()(
  "mcp-effect-sdk/StreamableHttpServerTransport/ResponseScopeOwner"
) {}

const makeResponseScopeOwner = (parent: Scope.Scope): ResponseScopeOwnerService => ({
  fork: Scope.fork(parent, "sequential"),
  supervise: (start) =>
    Effect.gen(function* () {
      const accepted = yield* Deferred.make<void>()
      const report = Effect.suspend(() => {
        let effect: Effect.Effect<void, unknown>
        try {
          effect = start()
        } catch {
          return Deferred.succeed(accepted, undefined).pipe(Effect.asVoid)
        }
        return Deferred.succeed(accepted, undefined).pipe(Effect.andThen(effect))
      }).pipe(
        Effect.timeout(FAILURE_REPORT_TIMEOUT),
        Effect.catchCause(() => Effect.void)
      )
      const fiber = yield* report.pipe(Effect.forkIn(parent))
      yield* Effect.raceFirst(
        Deferred.await(accepted).pipe(Effect.asVoid),
        Fiber.await(fiber).pipe(Effect.andThen(Deferred.succeed(accepted, undefined)), Effect.asVoid)
      ).pipe(
        Effect.timeout(FAILURE_REPORT_TIMEOUT),
        Effect.catchCause(() => Effect.void)
      )
    })
})

export type ScopedWebHandler = (request: Request, handleOptions?: HandleRequestOptions) => Effect.Effect<Response>

class ScopedWebHandlerService extends Context.Service<ScopedWebHandlerService, ScopedWebHandler>()(
  "mcp-effect-sdk/StreamableHttpServerTransport/ScopedWebHandler"
) {}

export interface ExtensionNotificationContext {
  readonly authorizationPrincipal: AuthorizationPrincipal | undefined
  readonly requestHeaders: Readonly<Record<string, string>>
}

export type ExtensionNotificationHandler = (
  notification: McpWire.JsonRpcNotification,
  context: ExtensionNotificationContext
) => Effect.Effect<void, McpError>

export type HttpServerFailureStage = "request_body" | "json_response" | "sse_response"

export interface HttpServerFailureDiagnostic {
  readonly stage: HttpServerFailureStage
  readonly cause: Cause.Cause<unknown>
}

export type HttpServerFailureSink = (diagnostic: HttpServerFailureDiagnostic) => Effect.Effect<void, unknown>

export interface StreamableHttpServerTransportOptions {
  readonly path: string
  readonly enableJsonResponse?: boolean | undefined
  readonly allowedHosts?: ReadonlyArray<string> | undefined
  readonly allowedOrigins?: ReadonlyArray<string> | undefined
  readonly enableDnsRebindingProtection?: boolean | undefined
  readonly maxBodyBytes?: number | undefined
  readonly maxPendingFrames?: number | undefined
  readonly runtimeLayer?: Layer.Layer<never, never, never> | undefined
  readonly instrumentation?: Layer.Layer<never, never, never> | undefined
  readonly warningSink?: HttpMetadata.HttpToolWarningSink | undefined
  readonly failureSink?: HttpServerFailureSink | undefined
  readonly acceptNotification?: ExtensionNotificationHandler | undefined
  readonly authorization?: StreamableHttpProtectedResourceAuthorization | undefined
}

export interface StreamableHttpProtectedResourceAuthorization {
  readonly verifier: TokenVerifierService
  readonly protectedResource: string
  readonly resourceMetadata: string
  readonly requiredScopes?: typeof AuthorizationScopeSet.Type | undefined
  readonly scopeSatisfies?: AuthorizationScopeSatisfies | undefined
}

export interface HandleRequestOptions {
  readonly parsedBody?: unknown
  /** Trusted byte length of the original body consumed by an upstream parser. */
  readonly parsedBodyByteLength?: number | undefined
  readonly verifiedAuthorizationPrincipal?: AuthorizationPrincipal | undefined
}

type TrustedParsedBodyOptions = {
  readonly _tag: "Trusted"
  readonly parsedBody: unknown
  readonly parsedBodyByteLength: unknown
  readonly verifiedAuthorizationPrincipal: unknown
  readonly hasVerifiedAuthorizationPrincipal: boolean
}

const trustedParsedBodyOptions = (
  options: HandleRequestOptions
): TrustedParsedBodyOptions | { readonly _tag: "Invalid" } => {
  let parsedBody: PropertyDescriptor | undefined
  let parsedBodyByteLength: PropertyDescriptor | undefined
  let verifiedAuthorizationPrincipal: PropertyDescriptor | undefined
  try {
    parsedBody = Object.getOwnPropertyDescriptor(options, "parsedBody")
    parsedBodyByteLength = Object.getOwnPropertyDescriptor(options, "parsedBodyByteLength")
    verifiedAuthorizationPrincipal = Object.getOwnPropertyDescriptor(options, "verifiedAuthorizationPrincipal")
  } catch {
    return { _tag: "Invalid" }
  }
  if (
    (parsedBody !== undefined && !("value" in parsedBody)) ||
    (parsedBodyByteLength !== undefined && !("value" in parsedBodyByteLength)) ||
    (verifiedAuthorizationPrincipal !== undefined && !("value" in verifiedAuthorizationPrincipal))
  ) {
    return { _tag: "Invalid" }
  }
  return {
    _tag: "Trusted",
    parsedBody: parsedBody?.value,
    parsedBodyByteLength: parsedBodyByteLength?.value,
    verifiedAuthorizationPrincipal: verifiedAuthorizationPrincipal?.value,
    hasVerifiedAuthorizationPrincipal: verifiedAuthorizationPrincipal !== undefined
  }
}

interface ValidatedAuthorization {
  readonly verifier: TokenVerifierService
  readonly protectedResource: string
  readonly resourceMetadata: string
  readonly requiredScopes: typeof AuthorizationScopeSet.Type
  readonly scopeSatisfies: AuthorizationScopeSatisfies | undefined
}

interface ValidatedOptions {
  readonly maxBodyBytes: number
  readonly maxPendingFrames: number
  readonly supportedProtocolVersions: ReadonlyArray<string>
  readonly authorization: ValidatedAuthorization | undefined
}

type DecodedBody = {
  readonly message: McpWire.JsonRpcMessage
  readonly encoded: string
}

type BodyDecodeResult =
  | { readonly _tag: "Decoded"; readonly value: DecodedBody }
  | { readonly _tag: "Invalid"; readonly id: McpWire.JsonRpcId | undefined }
  | { readonly _tag: "TooLarge" }

const decodeAuthorizationUri = Schema.decodeUnknownSync(SafeAuthorizationUri)
const decodeAuthorizationScopes = Schema.decodeUnknownSync(AuthorizationScopeSet)

const validateAuthorization = (
  input: StreamableHttpProtectedResourceAuthorization | undefined
): ValidatedAuthorization | undefined => {
  if (input === undefined) return undefined
  try {
    if (input === null || typeof input !== "object") throw new TypeError()
    const verifierDescriptor = Reflect.getOwnPropertyDescriptor(input, "verifier")
    const protectedResourceDescriptor = Reflect.getOwnPropertyDescriptor(input, "protectedResource")
    const resourceMetadataDescriptor = Reflect.getOwnPropertyDescriptor(input, "resourceMetadata")
    const requiredScopesDescriptor = Reflect.getOwnPropertyDescriptor(input, "requiredScopes")
    const scopeSatisfiesDescriptor = Reflect.getOwnPropertyDescriptor(input, "scopeSatisfies")
    if (
      verifierDescriptor === undefined ||
      !("value" in verifierDescriptor) ||
      protectedResourceDescriptor === undefined ||
      !("value" in protectedResourceDescriptor) ||
      resourceMetadataDescriptor === undefined ||
      !("value" in resourceMetadataDescriptor) ||
      (requiredScopesDescriptor !== undefined && !("value" in requiredScopesDescriptor)) ||
      (scopeSatisfiesDescriptor !== undefined && !("value" in scopeSatisfiesDescriptor))
    ) {
      throw new TypeError()
    }
    const verifier = verifierDescriptor.value
    if (verifier === null || typeof verifier !== "object") throw new TypeError()
    const verifyDescriptor = Reflect.getOwnPropertyDescriptor(verifier, "verify")
    if (
      verifyDescriptor === undefined ||
      !("value" in verifyDescriptor) ||
      typeof verifyDescriptor.value !== "function"
    )
      throw new TypeError()
    const verify = verifyDescriptor.value as TokenVerifierService["verify"]
    const scopeSatisfies = scopeSatisfiesDescriptor?.value
    if (scopeSatisfies !== undefined && typeof scopeSatisfies !== "function") throw new TypeError()
    return Object.freeze({
      verifier: Object.freeze({
        verify: (request: Parameters<TokenVerifierService["verify"]>[0]) => Reflect.apply(verify, verifier, [request])
      }),
      protectedResource: decodeAuthorizationUri(protectedResourceDescriptor.value),
      resourceMetadata: decodeAuthorizationUri(resourceMetadataDescriptor.value),
      requiredScopes: decodeAuthorizationScopes(requiredScopesDescriptor?.value ?? []),
      scopeSatisfies:
        scopeSatisfies === undefined
          ? undefined
          : (satisfaction: AuthorizationScopeSatisfaction) => Reflect.apply(scopeSatisfies, undefined, [satisfaction])
    })
  } catch {
    throw new TypeError("authorization must contain a verifier and safe protected-resource configuration")
  }
}

const validateOptions = (
  options: StreamableHttpServerTransportOptions,
  supportedProtocolVersions: ReadonlyArray<string> = [MODERN_PROTOCOL_VERSION]
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
    authorization: validateAuthorization(options.authorization),
    supportedProtocolVersions:
      supportedProtocolVersions.length > 0 ? [...supportedProtocolVersions] : [MODERN_PROTOCOL_VERSION]
  }
}

/**
 * Build a Web-standard request handler backed by one managed MCP server
 * registry. The Promise conversion is confined to this Web API edge.
 */
export const toWebHandler = (server: McpServer.McpServerService, options: StreamableHttpServerTransportOptions) => {
  validateOptions(options)
  const handlerLayer = Layer.effect(ScopedWebHandlerService, makeScopedHandler(server, options))
  const runtimeLayer = options.runtimeLayer === undefined ? Layer.empty : options.runtimeLayer
  const instrumentationLayer = options.instrumentation === undefined ? Layer.empty : options.instrumentation
  const mergedLayer = Layer.mergeAll(runtimeLayer, instrumentationLayer, handlerLayer)
  const runtime = ManagedRuntime.make(mergedLayer)
  let disposal: Promise<void> | undefined
  return {
    dispose: () => {
      if (disposal === undefined) {
        disposal = (async () => {
          await runtime.runPromise(server.closeSubscriptions)
          await runtime.dispose()
        })()
      }
      return disposal
    },
    // Request body cleanup follows the request signal; response resources use the managed handler scope.
    handler: (request: Request, handleOptions?: HandleRequestOptions) =>
      Effect.runPromise(
        runtime.contextEffect.pipe(
          Effect.flatMap((context) =>
            ScopedWebHandlerService.pipe(
              Effect.flatMap((handler) => handler(request, handleOptions)),
              Effect.provideContext(context)
            )
          )
        ),
        { signal: request.signal }
      )
  }
}

/** @internal Build a handler whose response scopes are children of the current scope. */
export const makeScopedHandler = (
  server: McpServer.McpServerService,
  options: StreamableHttpServerTransportOptions
): Effect.Effect<ScopedWebHandler, never, Scope.Scope> =>
  Effect.gen(function* () {
    const validated = validateOptions(options, server.options.supportedProtocolVersions)
    const parent = yield* Effect.scope
    const owner = makeResponseScopeOwner(parent)
    return (request, handleOptions) =>
      handleValidated(request, options, validated, handleOptions).pipe(
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
  return Effect.gen(function* () {
    const server = yield* McpServer.McpServer
    const validated = validateOptions(options, server.options.supportedProtocolVersions)
    const parent = yield* Effect.scope
    return yield* handleValidated(request, options, validated, handleOptions).pipe(
      Effect.provideService(ResponseScopeOwner, makeResponseScopeOwner(parent))
    )
  })
}

type AuthorizationBoundaryResult =
  | { readonly _tag: "Authorized"; readonly principal: AuthorizationPrincipal }
  | { readonly _tag: "Rejected"; readonly response: Response }

const authorizationRejection = (
  challenge: ReturnType<typeof unauthorizedChallenge> | ReturnType<typeof insufficientScopeChallenge>
): Response => {
  const response = bodylessResponse(challenge.status)
  response.headers.set("www-authenticate", serializeAuthorizationChallenge(challenge))
  return response
}

const verifyAuthorization = (
  request: Request,
  authorization: ValidatedAuthorization
): Effect.Effect<AuthorizationBoundaryResult> =>
  Effect.gen(function* () {
    const verified = yield* verifyBearerAuthorization({
      authorizationHeader: request.headers.get("authorization"),
      protectedResource: authorization.protectedResource,
      requiredScopes: authorization.requiredScopes,
      scopeSatisfies: authorization.scopeSatisfies
    }).pipe(Effect.provideService(TokenVerifier, authorization.verifier), Effect.exit)
    if (Exit.isFailure(verified)) {
      if (Cause.hasInterrupts(verified.cause)) {
        return yield* Effect.failCause(
          Cause.fromReasons<never>(verified.cause.reasons.filter((reason) => !Cause.isFailReason(reason)))
        )
      }
      const reason = verified.cause.reasons[0]
      if (verified.cause.reasons.length !== 1 || reason === undefined || !Cause.isFailReason(reason)) {
        return { _tag: "Rejected", response: bodylessResponse(500) }
      }
      const failure = reason.error
      if (failure instanceof BearerAuthorizationError) {
        return {
          _tag: "Rejected",
          response: authorizationRejection(
            unauthorizedChallenge({
              resourceMetadata: authorization.resourceMetadata,
              scopes: authorization.requiredScopes
            })
          )
        }
      }
      if (
        failure instanceof TokenVerificationError &&
        (failure.reason === "Invalid" || failure.reason === "Expired" || failure.reason === "AudienceMismatch")
      ) {
        return {
          _tag: "Rejected",
          response: authorizationRejection(
            unauthorizedChallenge({
              resourceMetadata: authorization.resourceMetadata,
              scopes: authorization.requiredScopes,
              error: "invalid_token"
            })
          )
        }
      }
      if (failure instanceof AuthorizationPolicyError) {
        if (failure.reason === "PolicyFailure") {
          return { _tag: "Rejected", response: bodylessResponse(500) }
        }
        return {
          _tag: "Rejected",
          response: authorizationRejection(
            insufficientScopeChallenge({
              resourceMetadata: authorization.resourceMetadata,
              scopes: failure.required
            })
          )
        }
      }
      return { _tag: "Rejected", response: bodylessResponse(500) }
    }
    return { _tag: "Authorized", principal: verified.value }
  })

const handleValidated = (
  request: Request,
  options: StreamableHttpServerTransportOptions,
  validated: ValidatedOptions,
  handleOptions: HandleRequestOptions = {}
): Effect.Effect<Response, never, McpServer.McpServer | ResponseScopeOwner> =>
  Effect.gen(function* () {
    const owner = yield* ResponseScopeOwner
    let protocolVersion = defaultProtocolVersion(validated)
    const finish = (response: Response): Response => withProtocolVersion(response, protocolVersion)
    const rejectBeforeBody = (response: Response): Effect.Effect<Response> =>
      releaseRequestBody(request).pipe(Effect.as(finish(response)))

    if (new URL(request.url).pathname !== options.path) {
      return yield* rejectBeforeBody(bodylessResponse(404))
    }

    if (!validOrigin(request, options.allowedOrigins)) {
      return yield* rejectBeforeBody(bodylessResponse(403))
    }

    if (
      options.enableDnsRebindingProtection === true &&
      !validateHostHeader(request.headers.get("host"), options.allowedHosts ?? localhostAllowedHostnames()).ok
    ) {
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
    let authorizationPrincipal: AuthorizationPrincipal | undefined
    if (validated.authorization !== undefined) {
      if (parsedInput.hasVerifiedAuthorizationPrincipal && parsedInput.verifiedAuthorizationPrincipal !== undefined) {
        return yield* rejectBeforeBody(bodylessResponse(400))
      }
      const boundary = yield* verifyAuthorization(request, validated.authorization)
      if (boundary._tag === "Rejected") {
        return yield* rejectBeforeBody(boundary.response)
      }
      authorizationPrincipal = boundary.principal
    } else if (parsedInput.hasVerifiedAuthorizationPrincipal) {
      const embedded = yield* embedVerifiedAuthorizationPrincipal(parsedInput.verifiedAuthorizationPrincipal).pipe(
        Effect.result
      )
      if (Result.isFailure(embedded)) {
        return yield* rejectBeforeBody(bodylessResponse(400))
      }
      authorizationPrincipal = embedded.success
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
      return finish(
        decoded.id === undefined
          ? bodylessResponse(400)
          : jsonRpcErrorResponse(decoded.id, new InvalidRequest({ message: "Invalid JSON-RPC request" }))
      )
    }

    const message = decoded.value.message
    if (message._tag === "SuccessResponse" || message._tag === "ErrorResponse") {
      return finish(jsonRpcErrorResponse(message.id, new InvalidRequest({ message: "Invalid JSON-RPC request" })))
    }

    const requestedVersion = request.headers.get(MCP_PROTOCOL_VERSION_HEADER) ?? ""
    const unsupportedVersion = () =>
      new UnsupportedProtocolVersionError({
        message: "Unsupported MCP protocol version",
        data: {
          requested: requestedVersion,
          supported: [...validated.supportedProtocolVersions]
        }
      })

    if (message._tag === "Notification") {
      const standardHeaders = yield* HttpMetadata.validateStandardRequestHeaders(message, request.headers).pipe(
        Effect.result
      )
      if (Result.isFailure(standardHeaders) || !validated.supportedProtocolVersions.includes(requestedVersion)) {
        return finish(bodylessResponse(400))
      }
      protocolVersion = requestedVersion
      if (message.method === "notifications/cancelled" || options.acceptNotification === undefined) {
        return finish(bodylessResponse(400))
      }
      const accepted = yield* options
        .acceptNotification(message, {
          authorizationPrincipal,
          requestHeaders: cloneRequestHeaders(request.headers)
        })
        .pipe(Effect.exit)
      return finish(accepted._tag === "Success" ? bodylessResponse(202) : bodylessResponse(400))
    }

    const knownMethod = isClientRequestMethod(message.method)
    let exactRequest = message
    if (knownMethod) {
      const paramsCodec = CLIENT_REQUEST_PAYLOAD_CODEC_BY_METHOD[message.method] as Schema.Codec<
        Record<string, unknown>,
        unknown
      >
      const exactParams = Schema.decodeUnknownResult(paramsCodec)(message.params)
      if (Result.isFailure(exactParams)) {
        return finish(jsonRpcErrorResponse(message.id, new InvalidParams({ message: "Invalid request parameters" })))
      }
      exactRequest = { ...message, params: exactParams.success }
    }

    const standardHeaders = yield* HttpMetadata.validateStandardRequestHeaders(exactRequest, request.headers).pipe(
      Effect.result
    )
    if (Result.isFailure(standardHeaders)) {
      return finish(jsonRpcErrorResponse(message.id, standardHeaders.failure))
    }
    if (!validated.supportedProtocolVersions.includes(requestedVersion)) {
      return finish(jsonRpcErrorResponse(message.id, unsupportedVersion()))
    }
    protocolVersion = requestedVersion

    if (!knownMethod) {
      return finish(jsonRpcErrorResponse(message.id, new MethodNotFound({ message: "Method not found" })))
    }

    const server = yield* McpServer.McpServer
    const httpServer = yield* prepareHttpServer(server, exactRequest, request.headers, options.warningSink).pipe(
      Effect.result
    )
    if (Result.isFailure(httpServer)) {
      return finish(jsonRpcErrorResponse(message.id, httpServer.failure))
    }

    const response = yield* dispatchOrdinaryRequest(
      exactRequest,
      authorizationPrincipal,
      httpServer.success,
      options.enableJsonResponse === true,
      validated.maxPendingFrames,
      options.failureSink
    )
    return finish(response)
  })

const nonFailingWarningSink =
  (sink: HttpMetadata.HttpToolWarningSink): HttpMetadata.HttpToolWarningSink =>
  (warning) =>
    Effect.suspend(() => sink(warning)).pipe(
      Effect.catch(() => Effect.void),
      Effect.catchDefect(() => Effect.void)
    )

const reportHttpFailure = (
  sink: HttpServerFailureSink | undefined,
  stage: HttpServerFailureStage,
  cause: Cause.Cause<unknown>
): Effect.Effect<void> =>
  sink === undefined
    ? Effect.void
    : Effect.suspend(() => sink({ stage, cause })).pipe(Effect.catchCause(() => Effect.void))

const httpServerWithTools = (
  server: McpServer.McpServerService,
  tools: McpServer.McpServerService["tools"]
): McpServer.McpServerService =>
  McpServer.copyPaginationRuntime(server, {
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
): Effect.Effect<McpServer.McpServerService, McpError> =>
  Effect.gen(function* () {
    if (request.method !== "tools/list" && request.method !== "tools/call") {
      return server
    }

    const warningSink = nonFailingWarningSink(configuredWarningSink ?? ((warning) => Effect.logWarning(warning)))
    const candidates =
      request.method === "tools/list"
        ? server.tools
        : server.tools.filter(
            ({ tool }) =>
              typeof request.params === "object" &&
              request.params !== null &&
              tool.name === (request.params as { readonly name?: unknown }).name
          )
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
  readonly deliveryAck?: Deferred.Deferred<void> | undefined
}

const responseAlreadyComplete = (): TransportError =>
  new TransportError({
    message: "HTTP response is already complete"
  })

const notificationInJsonMode = (): InternalError =>
  new InternalError({
    message: "Request-bound notifications require an SSE response"
  })

const terminalForError = (id: McpWire.JsonRpcId, error: McpError): McpWire.JsonRpcErrorResponse => ({
  _tag: "ErrorResponse",
  jsonrpc: "2.0",
  id,
  error: toJsonRpcErrorObject(error)
})

const encodeSseFrame = (
  message: McpWire.JsonRpcNotification | TerminalMessage
): Effect.Effect<Uint8Array, InternalError> => {
  const validated: Effect.Effect<McpWire.JsonRpcNotification | TerminalMessage, InternalError> =
    message._tag === "Notification" ? validateServerNotification(message) : Effect.succeed(message)
  return validated.pipe(
    Effect.flatMap((value) => {
      const encoded = McpWire.encodeJsonRpcText(value)
      return Result.isFailure(encoded)
        ? Effect.fail(new InternalError({ message: "Could not encode HTTP response frame" }))
        : Effect.succeed(new TextEncoder().encode(`event: message\ndata: ${encoded.success}\n\n`))
    })
  )
}

const validateServerNotification = (
  notification: McpWire.JsonRpcNotification
): Effect.Effect<McpWire.JsonRpcNotification, InternalError> => {
  if (!Object.hasOwn(SERVER_NOTIFICATION_PAYLOAD_CODEC_BY_METHOD, notification.method))
    return Effect.succeed(notification)
  const codec =
    SERVER_NOTIFICATION_PAYLOAD_CODEC_BY_METHOD[
      notification.method as keyof typeof SERVER_NOTIFICATION_PAYLOAD_CODEC_BY_METHOD
    ]
  const schema = codec as Schema.Codec<unknown, unknown>
  const encoded = Schema.decodeUnknownResult(schema)(notification.params).pipe(
    Result.flatMap(Schema.encodeUnknownResult(schema))
  )
  return Result.isFailure(encoded)
    ? Effect.fail(
        new InternalError({
          message: "Could not encode HTTP response frame",
          cause: encoded.failure
        })
      )
    : Effect.succeed({
        ...notification,
        params: encoded.success as McpWire.JsonRpcNotification["params"]
      })
}

type SubscriptionFilter = {
  readonly promptsListChanged?: boolean
  readonly resourcesListChanged?: boolean
  readonly resourceSubscriptions?: ReadonlyArray<string>
  readonly toolsListChanged?: boolean
}

const exactSubscriptionFilter = (value: SubscriptionFilter): SubscriptionFilter => ({
  ...(value.promptsListChanged === undefined ? {} : { promptsListChanged: value.promptsListChanged }),
  ...(value.resourcesListChanged === undefined ? {} : { resourcesListChanged: value.resourcesListChanged }),
  ...(value.resourceSubscriptions === undefined ? {} : { resourceSubscriptions: [...value.resourceSubscriptions] }),
  ...(value.toolsListChanged === undefined ? {} : { toolsListChanged: value.toolsListChanged })
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

const subscriptionCompleted = (
  id: McpWire.JsonRpcId,
  serverInfo: McpServer.McpServerService["options"]["serverInfo"]
): McpWire.JsonRpcSuccessResponse => {
  const response = new SubscriptionsListenResultResponse({
    jsonrpc: "2.0",
    id,
    result: new SubscriptionsListenResult({
      resultType: "complete",
      _meta: {
        "io.modelcontextprotocol/serverInfo": new Implementation(serverInfo),
        "io.modelcontextprotocol/subscriptionId": id
      }
    })
  })
  const encoded = Schema.encodeSync(SubscriptionsListenResultResponse)(response)
  return {
    _tag: "SuccessResponse",
    jsonrpc: encoded.jsonrpc,
    id: encoded.id,
    result: encoded.result
  }
}

const registryNotification = (notification: McpServer.ServerNotification): McpWire.JsonRpcNotification => ({
  _tag: "Notification",
  jsonrpc: "2.0",
  method: notification.tag,
  params: notification.payload as McpWire.JsonRpcNotification["params"]
})

const makeDispatcherInScope = <SendError>(
  childScope: Scope.Closeable,
  server: McpServer.McpServerService,
  send: (
    message: McpWire.JsonRpcSuccessResponse | McpWire.JsonRpcErrorResponse | McpWire.JsonRpcNotification
  ) => Effect.Effect<void, SendError>
) =>
  Effect.provideService(
    McpServer.makeDispatcher({ send, transport: "http" }).pipe(Effect.provideService(McpServer.McpServer, server)),
    Scope.Scope,
    childScope
  )

const acceptOwnedRequest = <SendError>(
  dispatcher: McpDispatcher.ServerDispatcher,
  request: McpWire.JsonRpcRequest,
  authorizationPrincipal: AuthorizationPrincipal | undefined,
  send: (message: TerminalMessage) => Effect.Effect<void, SendError>
): Effect.Effect<void, SendError> =>
  dispatcher
    .accept(request, {
      authorizationPrincipal
    })
    .pipe(Effect.catch((error) => send(terminalForError(request.id, error))))

const dispatchJsonRequest = (
  childScope: Scope.Closeable,
  request: McpWire.JsonRpcRequest,
  authorizationPrincipal: AuthorizationPrincipal | undefined,
  server: McpServer.McpServerService,
  maxPendingFrames: number,
  failureSink: HttpServerFailureSink | undefined
): Effect.Effect<Response, never> =>
  Effect.gen(function* () {
    const output = yield* Queue.make<TerminalMessage>({ capacity: maxPendingFrames })
    const state = yield* Ref.make<ResponseSendState>("Open")
    const lock = yield* Semaphore.make(1)
    yield* Scope.addFinalizer(childScope, Ref.set(state, "Closed").pipe(Effect.andThen(Queue.shutdown(output))))

    const send = (
      message: McpWire.JsonRpcNotification | TerminalMessage
    ): Effect.Effect<void, InternalError | TransportError> =>
      lock.withPermits(1)(
        Effect.gen(function* () {
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
    Effect.catchCause((cause) =>
      Cause.hasInterruptsOnly(cause)
        ? Effect.interrupt
        : reportHttpFailure(failureSink, "json_response", cause).pipe(
            Effect.as(jsonRpcErrorResponse(request.id, new InternalError({ message: "HTTP response failed" })))
          )
    )
  )

const dispatchSseRequest = (
  childScope: Scope.Closeable,
  request: McpWire.JsonRpcRequest,
  authorizationPrincipal: AuthorizationPrincipal | undefined,
  server: McpServer.McpServerService,
  maxPendingFrames: number,
  failureSink: HttpServerFailureSink | undefined
): Effect.Effect<Response, never> =>
  Effect.gen(function* () {
    const output = yield* Queue.make<SseOutput>({ capacity: maxPendingFrames + 1 })
    const frameSlots = yield* Semaphore.make(maxPendingFrames)
    const state = yield* Ref.make<ResponseSendState>("Open")
    const lock = yield* Semaphore.make(1)
    let closeSubscription = () => {}
    yield* Scope.addFinalizer(
      childScope,
      Ref.set(state, "Closed").pipe(Effect.andThen(frameSlots.releaseAll), Effect.andThen(Queue.shutdown(output)))
    )

    const offerFrame = (
      take: Take.Take<Uint8Array, InternalError>,
      deliveryAck?: Deferred.Deferred<void>
    ): Effect.Effect<void> =>
      Effect.uninterruptibleMask((restore) =>
        Effect.gen(function* () {
          yield* restore(frameSlots.take(1))
          const offered = yield* restore(
            Queue.offer(output, {
              take,
              releasesFrameSlot: true,
              ...(deliveryAck === undefined ? {} : { deliveryAck })
            })
          ).pipe(Effect.exit)
          if (Exit.isFailure(offered)) {
            yield* frameSlots.release(1)
            return yield* Effect.failCause(offered.cause)
          }
        })
      )

    const offerControl = (take: Take.Take<Uint8Array, InternalError>): Effect.Effect<void> =>
      Queue.offer(output, {
        take,
        releasesFrameSlot: false
      }).pipe(Effect.asVoid, Effect.uninterruptible)

    const failStreamUnlocked = (error: InternalError): Effect.Effect<void> =>
      Effect.gen(function* () {
        if ((yield* Ref.get(state)) !== "Open") return
        closeSubscription()
        yield* Ref.set(state, "Closed")
        const failure = new InternalError({
          message: "HTTP response stream failed",
          cause: error
        })
        yield* offerControl(Exit.fail(failure))
        yield* reportHttpFailure(failureSink, "sse_response", Cause.fail(error))
      })

    const offerUnlocked = (
      message: McpWire.JsonRpcNotification | TerminalMessage
    ): Effect.Effect<Deferred.Deferred<void> | undefined, InternalError> =>
      Effect.gen(function* () {
        const frame = yield* encodeSseFrame(message).pipe(
          Effect.catch((error) => failStreamUnlocked(error).pipe(Effect.andThen(Effect.fail(error))))
        )
        const deliveryAck = message._tag === "Notification" ? undefined : yield* Deferred.make<void>()
        if (deliveryAck !== undefined) {
          yield* Ref.set(state, "Terminal")
        }
        yield* offerFrame([frame], deliveryAck)
        if (deliveryAck !== undefined) {
          yield* offerControl(Exit.void)
        }
        return deliveryAck
      })

    const failSubscriptionStream = (error: InternalError): Effect.Effect<void> =>
      lock.withPermits(1)(failStreamUnlocked(error))

    const send = (
      message: McpWire.JsonRpcNotification | TerminalMessage
    ): Effect.Effect<void, InternalError | TransportError> =>
      lock.withPermits(1)(
        Effect.gen(function* () {
          if ((yield* Ref.get(state)) !== "Open") {
            return yield* Effect.fail(responseAlreadyComplete())
          }
          yield* offerUnlocked(message)
        })
      )

    const sendTerminalAndAwaitDelivery = (
      message: TerminalMessage
    ): Effect.Effect<void, InternalError | TransportError> =>
      lock
        .withPermits(1)(
          Effect.gen(function* () {
            if ((yield* Ref.get(state)) !== "Open") {
              return yield* Effect.fail(responseAlreadyComplete())
            }
            const deliveryAck = yield* offerUnlocked(message)
            if (deliveryAck === undefined) {
              return yield* Effect.fail(
                new InternalError({ message: "HTTP terminal response is missing its delivery acknowledgement" })
              )
            }
            return deliveryAck
          })
        )
        .pipe(Effect.flatMap(Deferred.await))

    const dispatcher = yield* makeDispatcherInScope(childScope, server, send)
    yield* acceptOwnedRequest(dispatcher, request, authorizationPrincipal, send)
    if (request.method === "subscriptions/listen") {
      const params = request.params as {
        readonly notifications: SubscriptionFilter
      }
      const notifications = exactSubscriptionFilter(params.notifications)
      yield* lock.withPermits(1)(
        Effect.gen(function* () {
          if ((yield* Ref.get(state)) !== "Open") {
            return yield* Effect.fail(responseAlreadyComplete())
          }
          const closeRegistry = server.openSubscription(
            request.id,
            notifications,
            (notification) =>
              send(registryNotification(notification)).pipe(
                Effect.catch((error) => (error instanceof TransportError ? Effect.void : failSubscriptionStream(error)))
              ),
            () => sendTerminalAndAwaitDelivery(subscriptionCompleted(request.id, server.options.serverInfo))
          )
          let registryOpen = true
          closeSubscription = () => {
            if (!registryOpen) return
            registryOpen = false
            closeRegistry()
          }
          yield* Scope.addFinalizer(childScope, Effect.sync(closeSubscription))
          yield* offerUnlocked(subscriptionAcknowledged(request.id, notifications))
        })
      )
    }
    const context = yield* Effect.context<never>()
    const deliveryAcks: Array<Deferred.Deferred<void> | undefined> = []
    const encodedBody = Stream.fromEffectRepeat(Queue.take(output)).pipe(
      Stream.mapEffect(({ deliveryAck, releasesFrameSlot, take }) =>
        (releasesFrameSlot ? frameSlots.release(1) : Effect.void).pipe(
          Effect.tap(() =>
            Effect.sync(() => {
              deliveryAcks.push(deliveryAck)
            })
          ),
          Effect.as(take)
        )
      ),
      Stream.flattenTake,
      Stream.catchCause((cause) =>
        Cause.hasInterruptsOnly(cause) && Ref.getUnsafe(state) === "Closed" ? Stream.empty : Stream.failCause(cause)
      ),
      Stream.ensuring(Scope.close(childScope, Exit.void)),
      Stream.toReadableStreamWith(context, { strategy: { highWaterMark: 0 } })
    )
    const encodedReader = encodedBody.getReader()
    let readerReleased = false
    const releaseEncodedReader = () => {
      if (readerReleased) return
      readerReleased = true
      encodedReader.releaseLock()
    }
    const body = new ReadableStream<Uint8Array>(
      {
        cancel: (reason) => encodedReader.cancel(reason).finally(releaseEncodedReader),
        pull: async (controller) => {
          try {
            const next = await encodedReader.read()
            if (next.done) {
              releaseEncodedReader()
              controller.close()
              return
            }
            controller.enqueue(next.value)
            const deliveryAck = deliveryAcks.shift()
            if (deliveryAck !== undefined) {
              Effect.runSync(Deferred.succeed(deliveryAck, undefined))
            }
          } catch (cause) {
            releaseEncodedReader()
            controller.error(cause)
          }
        }
      },
      { highWaterMark: 0 }
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
    Effect.catchCause((cause) =>
      Scope.close(childScope, Exit.void).pipe(
        Effect.andThen(
          Cause.hasInterruptsOnly(cause)
            ? Effect.interrupt
            : reportHttpFailure(failureSink, "sse_response", cause).pipe(
                Effect.as(jsonRpcErrorResponse(request.id, new InternalError({ message: "HTTP response failed" })))
              )
        )
      )
    )
  )

const dispatchOrdinaryRequest = (
  request: McpWire.JsonRpcRequest,
  authorizationPrincipal: AuthorizationPrincipal | undefined,
  server: McpServer.McpServerService,
  enableJsonResponse: boolean,
  maxPendingFrames: number,
  failureSink: HttpServerFailureSink | undefined
): Effect.Effect<Response, never, ResponseScopeOwner> =>
  Effect.gen(function* () {
    const owner = yield* ResponseScopeOwner
    const childScope = yield* owner.fork
    return yield* enableJsonResponse &&
    !requestUsesProgressToken(request) &&
    !requestUsesLogLevel(request) &&
    request.method !== "subscriptions/listen"
      ? dispatchJsonRequest(childScope, request, authorizationPrincipal, server, maxPendingFrames, failureSink)
      : dispatchSseRequest(childScope, request, authorizationPrincipal, server, maxPendingFrames, failureSink)
  })

const requestMetadataValue = (request: McpWire.JsonRpcRequest, key: string): unknown => {
  const params = request.params
  if (typeof params !== "object" || params === null || Array.isArray(params)) return undefined
  const metadataProperty = Reflect.getOwnPropertyDescriptor(params, "_meta")
  if (metadataProperty === undefined || !("value" in metadataProperty)) return undefined
  const metadata = metadataProperty.value
  if (typeof metadata !== "object" || metadata === null || Array.isArray(metadata)) return undefined
  const property = Reflect.getOwnPropertyDescriptor(metadata, key)
  return property !== undefined && "value" in property ? property.value : undefined
}

const requestUsesProgressToken = (request: McpWire.JsonRpcRequest): boolean => {
  const progressToken = requestMetadataValue(request, "progressToken")
  return typeof progressToken === "string" || typeof progressToken === "number"
}

const requestUsesLogLevel = (request: McpWire.JsonRpcRequest): boolean =>
  typeof requestMetadataValue(request, "io.modelcontextprotocol/logLevel") === "string"

const decodeBody = (
  request: Request,
  parsedBody: unknown,
  parsedBodyByteLength: unknown,
  maxBodyBytes: number,
  failureSink: HttpServerFailureSink | undefined,
  superviseFailure: (start: () => Effect.Effect<void, unknown>) => Effect.Effect<void>
): Effect.Effect<BodyDecodeResult> => {
  const contentLength = declaredContentLength(request)
  if (contentLength !== undefined && contentLength > maxBodyBytes) {
    return releaseRequestBody(request).pipe(Effect.as({ _tag: "TooLarge" as const }))
  }
  if (parsedBody !== undefined) {
    if (
      parsedBodyByteLength !== undefined &&
      (typeof parsedBodyByteLength !== "number" ||
        !Number.isSafeInteger(parsedBodyByteLength) ||
        parsedBodyByteLength < 0)
    ) {
      return releaseRequestBody(request).pipe(Effect.as({ _tag: "Invalid" as const, id: recoverExactId(parsedBody) }))
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
      Effect.flatMap((result) =>
        finishBodyRead(result, failureSink, superviseFailure, () => decodeParsedBody(parsedBody, maxBodyBytes))
      ),
      Effect.catch((cause) =>
        reportHttpFailure(failureSink, "request_body", Cause.fail(cause)).pipe(
          Effect.as({ _tag: "Invalid" as const, id: undefined })
        )
      )
    )
  }
  return readBodyBytes(request, maxBodyBytes).pipe(
    Effect.flatMap((result) => finishBodyRead(result, failureSink, superviseFailure, decodeBytes)),
    Effect.catch((cause) =>
      reportHttpFailure(failureSink, "request_body", Cause.fail(cause)).pipe(
        Effect.as({ _tag: "Invalid" as const, id: undefined })
      )
    )
  )
}

const finishBodyRead = (
  result: Uint8Array | BodyReadTooLarge,
  failureSink: HttpServerFailureSink | undefined,
  superviseFailure: (start: () => Effect.Effect<void, unknown>) => Effect.Effect<void>,
  decode: (bytes: Uint8Array) => BodyDecodeResult
): Effect.Effect<BodyDecodeResult> =>
  result instanceof Uint8Array
    ? Effect.succeed(decode(result))
    : (result.cleanupFailed
        ? superviseFailure(() =>
            failureSink === undefined
              ? Effect.void
              : failureSink({
                  stage: "request_body",
                  cause: Cause.fail(result.cleanupCause)
                })
          )
        : Effect.void
      ).pipe(Effect.as({ _tag: "TooLarge" as const }))

const decodeParsedBody = (parsedBody: unknown, maxBodyBytes: number): BodyDecodeResult => {
  const decoded = McpWire.decodeJsonRpc(parsedBody)
  if (Result.isFailure(decoded)) {
    return { _tag: "Invalid", id: recoverExactId(parsedBody) }
  }
  const encoded = McpWire.encodeJsonRpcText(decoded.success)
  if (Result.isFailure(encoded)) {
    return { _tag: "Invalid", id: recoverExactId(parsedBody) }
  }
  if (new TextEncoder().encode(encoded.success).byteLength > maxBodyBytes) {
    return { _tag: "TooLarge" }
  }
  return {
    _tag: "Decoded",
    value: { message: decoded.success, encoded: encoded.success }
  }
}

const decodeBytes = (bytes: Uint8Array): BodyDecodeResult => {
  const decoded = McpWire.decodeJsonRpcBytes(bytes)
  if (Result.isFailure(decoded)) {
    return { _tag: "Invalid", id: recoverExactIdFromBytes(bytes) }
  }
  const encoded = McpWire.encodeJsonRpcText(decoded.success)
  return Result.isFailure(encoded)
    ? { _tag: "Invalid", id: decoded.success._tag === "Notification" ? undefined : decoded.success.id }
    : {
        _tag: "Decoded",
        value: { message: decoded.success, encoded: encoded.success }
      }
}

const readBodyBytes = (request: Request, maxBodyBytes: number): Effect.Effect<Uint8Array | BodyReadTooLarge, unknown> =>
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
    (reader, exit) =>
      reader === undefined
        ? Effect.void
        : (Exit.hasInterrupts(exit)
            ? Effect.tryPromise({
                try: () => reader.cancel(),
                catch: () => undefined
              }).pipe(Effect.ignore)
            : Effect.void
          ).pipe(Effect.ensuring(Effect.sync(() => reader.releaseLock()).pipe(Effect.ignore)))
  )

const declaredContentLength = (request: Request): number | undefined => {
  const value = request.headers.get("content-length")
  if (value === null || !/^\d+$/.test(value)) return undefined
  const parsed = Number(value)
  return Number.isSafeInteger(parsed) ? parsed : Number.POSITIVE_INFINITY
}

const releaseRequestBody = (request: Request): Effect.Effect<void> =>
  Effect.tryPromise({
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

const recoverExactIdFromBytes = (bytes: Uint8Array): McpWire.JsonRpcId | undefined => {
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
      ? (descriptor.value as McpWire.JsonRpcId)
      : undefined
  } catch {
    return undefined
  }
}

const validOrigin = (request: Request, allowedOrigins: ReadonlyArray<string> | undefined): boolean => {
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
      if (name !== "q" || qualitySeen || !/^(?:0(?:\.\d{0,3})?|1(?:\.0{0,3})?)$/.test(parameterValue)) {
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

const defaultProtocolVersion = (options: ValidatedOptions): string =>
  options.supportedProtocolVersions[0] ?? MODERN_PROTOCOL_VERSION

const bodylessResponse = (status: number): Response => new Response(null, { status })

const jsonRpcErrorResponse = (id: McpWire.JsonRpcId, error: McpError): Response =>
  Response.json(
    {
      jsonrpc: "2.0",
      id,
      error: toJsonRpcErrorObject(error)
    },
    { status: defaultHttpStatus(error) }
  )

const terminalResponse = (terminal: McpWire.JsonRpcSuccessResponse | McpWire.JsonRpcErrorResponse): Response =>
  terminal._tag === "SuccessResponse"
    ? Response.json({
        jsonrpc: terminal.jsonrpc,
        id: terminal.id,
        result: terminal.result
      })
    : Response.json(
        {
          jsonrpc: terminal.jsonrpc,
          id: terminal.id,
          error: terminal.error
        },
        {
          status: terminal.error.code === -32601 ? 404 : terminal.error.code === -32603 ? 500 : 400
        }
      )

const withProtocolVersion = (response: Response, protocolVersion: string): Response => {
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

export const localhostAllowedHostnames = (): ReadonlyArray<string> => ["localhost", "127.0.0.1", "[::1]"]
