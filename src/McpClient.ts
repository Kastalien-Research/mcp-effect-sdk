/**
 * High-level MCP client service.
 *
 * Performs the three-message initialization handshake, stores
 * server capabilities, and provides typed methods for every
 * client→server request — each gated on the server's
 * advertised capabilities.
 */
import {
  Deferred,
  Effect,
  HashMap,
  Option,
  Queue,
  Ref,
  Schema,
  Scope
} from "effect"
import { McpClientError } from "./McpClientError.js"
import type {
  IncomingServerRequest,
  McpClientProtocol
} from "./McpClientProtocol.js"
import {
  makeInboundDispatcher,
  outbound
} from "./McpNotifications.js"
import type { InboundDispatcher } from "./McpNotifications.js"
import { SamplingHandler } from "./client-handlers/SamplingHandler.js"
import { ElicitationHandler } from "./client-handlers/ElicitationHandler.js"
import { RootsProvider } from "./client-handlers/RootsProvider.js"
import type {
  CallToolResult,
  CancelTaskResult,
  CompleteResult,
  GetPromptResult,
  GetTaskPayloadResult,
  GetTaskResult,
  Implementation,
  ListPromptsResult,
  ListResourcesResult,
  ListResourceTemplatesResult,
  ListTasksResult,
  ListToolsResult,
  ReadResourceResult
} from "./McpSchema.js"
import { ServerCapabilities } from "./McpSchema.js"
import {
  CLIENT_REQUEST_METHOD_BY_TYPE,
  LATEST_PROTOCOL_VERSION,
  SERVER_REQUEST_METHOD_BY_TYPE
} from "./generated/mcp/McpProtocol.generated.js"
import type {
  ClientRequestType,
  ServerRequestType
} from "./generated/mcp/McpProtocol.generated.js"

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

const CLIENT_REQUEST_CAPABILITY_BY_TYPE = {
  PingRequest: undefined,
  InitializeRequest: undefined,
  CompleteRequest: "completions",
  SetLevelRequest: "logging",
  GetPromptRequest: "prompts",
  ListPromptsRequest: "prompts",
  ListResourcesRequest: "resources",
  ListResourceTemplatesRequest: "resources",
  ReadResourceRequest: "resources",
  SubscribeRequest: "resources",
  UnsubscribeRequest: "resources",
  CallToolRequest: "tools",
  ListToolsRequest: "tools",
  GetTaskRequest: "tasks",
  GetTaskPayloadRequest: "tasks",
  ListTasksRequest: "tasks",
  CancelTaskRequest: "tasks"
} satisfies Record<ClientRequestType, string | undefined>

const clientRequestMethod = <Type extends ClientRequestType>(
  type: Type
): typeof CLIENT_REQUEST_METHOD_BY_TYPE[Type] => CLIENT_REQUEST_METHOD_BY_TYPE[type]

const serverRequestMethod = <Type extends ServerRequestType>(
  type: Type
): typeof SERVER_REQUEST_METHOD_BY_TYPE[Type] => SERVER_REQUEST_METHOD_BY_TYPE[type]

export interface McpClientConfig {
  readonly clientInfo: {
    readonly name: string
    readonly version: string
  }
}

// ---------------------------------------------------------------------------
// McpClient interface
// ---------------------------------------------------------------------------

export interface McpClient {
  readonly serverCapabilities: Effect.Effect<
    typeof ServerCapabilities.Type
  >
  readonly serverInfo: Effect.Effect<Implementation>
  readonly instructions: Effect.Effect<
    Option.Option<string>
  >
  readonly notifications: InboundDispatcher

  readonly listTools: (params?: {
    readonly cursor?: string
  }) => Effect.Effect<ListToolsResult, McpClientError>
  readonly callTool: (params: {
    readonly name: string
    readonly arguments: Record<string, unknown>
  }) => Effect.Effect<CallToolResult, McpClientError>

  readonly listResources: (params?: {
    readonly cursor?: string
  }) => Effect.Effect<ListResourcesResult, McpClientError>
  readonly listResourceTemplates: (params?: {
    readonly cursor?: string
  }) => Effect.Effect<
    ListResourceTemplatesResult,
    McpClientError
  >
  readonly readResource: (params: {
    readonly uri: string
  }) => Effect.Effect<ReadResourceResult, McpClientError>
  readonly subscribe: (params: {
    readonly uri: string
  }) => Effect.Effect<void, McpClientError>
  readonly unsubscribe: (params: {
    readonly uri: string
  }) => Effect.Effect<void, McpClientError>

  readonly listPrompts: (params?: {
    readonly cursor?: string
  }) => Effect.Effect<ListPromptsResult, McpClientError>
  readonly getPrompt: (params: {
    readonly name: string
    readonly arguments?: Record<string, string>
  }) => Effect.Effect<GetPromptResult, McpClientError>

  readonly complete: (params: {
    readonly ref:
      | {
          readonly type: "ref/prompt"
          readonly name: string
        }
      | {
          readonly type: "ref/resource"
          readonly uri: string
        }
    readonly argument: {
      readonly name: string
      readonly value: string
    }
  }) => Effect.Effect<CompleteResult, McpClientError>

  readonly setLogLevel: (params: {
    readonly level: string
  }) => Effect.Effect<void, McpClientError>

  readonly getTask: (params: {
    readonly taskId: string
  }) => Effect.Effect<GetTaskResult, McpClientError>
  readonly getTaskPayload: (params: {
    readonly taskId: string
  }) => Effect.Effect<GetTaskPayloadResult, McpClientError>
  readonly listTasks: (params?: {
    readonly cursor?: string
  }) => Effect.Effect<ListTasksResult, McpClientError>
  readonly cancelTask: (params: {
    readonly taskId: string
  }) => Effect.Effect<CancelTaskResult, McpClientError>

  readonly ping: () => Effect.Effect<void, McpClientError>

  readonly sendCancelled: (params: {
    readonly requestId: string | number
    readonly reason?: string
  }) => Effect.Effect<void, McpClientError>
  readonly sendProgress: (params: {
    readonly progressToken: string | number
    readonly progress: number
    readonly total?: number
    readonly message?: string
  }) => Effect.Effect<void, McpClientError>
  readonly sendRootsListChanged: () => Effect.Effect<
    void,
    McpClientError
  >
}

// ---------------------------------------------------------------------------
// Service shape types (what Effect.serviceOption returns)
// ---------------------------------------------------------------------------

type SamplingService = {
  readonly handle: (
    params: never
  ) => Effect.Effect<unknown, unknown>
}

type ElicitationService = {
  readonly handle: (
    params: never
  ) => Effect.Effect<unknown, unknown>
}

type RootsService = {
  readonly list: Effect.Effect<unknown, unknown>
}

// ---------------------------------------------------------------------------
// Constructor
// ---------------------------------------------------------------------------

/**
 * Create an McpClient by running the three-message init handshake
 * over the provided McpClientProtocol.
 *
 * Requires `Scope` — background fibers (run loop, notification
 * dispatch, server request handler) are interrupted on scope exit.
 */
export const make = (
  protocol: McpClientProtocol,
  config: McpClientConfig
): Effect.Effect<McpClient, McpClientError, Scope.Scope> =>
  (Effect.gen(function* () {
    // -- Per-instance state for request/response correlation --
    const nextIdRef = yield* Ref.make(1)
    const pendingRef = yield* Ref.make(
      HashMap.empty<
        string,
        Deferred.Deferred<unknown, McpClientError>
      >()
    )

    // -- Start the run loop (routes Exit messages to Deferreds) --
    yield* protocol.clientProtocol
      .run((message) => {
        const msg = message as unknown as Record<
          string,
          unknown
        >
        const tag = msg["_tag"] as string

        if (tag === "Exit") {
          const requestId = msg["requestId"] as string
          const exit = msg["exit"] as Record<
            string,
            unknown
          >
          return Effect.gen(function* () {
            const map = yield* Ref.get(pendingRef)
            const deferred = HashMap.get(map, requestId)
            if (Option.isSome(deferred)) {
              yield* Ref.update(
                pendingRef,
                HashMap.remove(requestId)
              )
              if (exit["_tag"] === "Success") {
                yield* Deferred.succeed(
                  deferred.value,
                  exit["value"]
                )
              } else {
                const cause = exit["cause"] as
                  | Record<string, unknown>
                  | undefined
                const error = cause?.["error"] as
                  | Record<string, unknown>
                  | undefined
                yield* Deferred.fail(
                  deferred.value,
                  new McpClientError({
                    reason: "Protocol",
                    message:
                      (error?.["message"] as string) ??
                      "Server error",
                    cause: error
                  })
                )
              }
            }
          })
        }

        return Effect.void
      })
      .pipe(Effect.forkScoped)

    // -- Request sender with Deferred-based correlation --
    const sendRequest = (
      method: string,
      payload?: unknown
    ): Effect.Effect<unknown, McpClientError> =>
      Effect.gen(function* () {
        const id = yield* Ref.getAndUpdate(
          nextIdRef,
          (n) => n + 1
        )
        const idStr = String(id)
        const deferred = yield* Deferred.make<
          unknown,
          McpClientError
        >()

        yield* Ref.update(
          pendingRef,
          HashMap.set(idStr, deferred)
        )

        yield* protocol.clientProtocol
          .send({
            _tag: "Request",
            id: idStr,
            tag: method,
            payload: payload ?? {},
            headers: []
          } as never)
          .pipe(
            Effect.catchCause((cause) =>
              Effect.gen(function* () {
                yield* Ref.update(
                  pendingRef,
                  HashMap.remove(idStr)
                )
                yield* Deferred.fail(
                  deferred,
                  new McpClientError({
                    reason: "Transport",
                    message: `Send failed`,
                    cause
                  })
                )
              })
            )
          )

        return yield* (Deferred.await(deferred) as Effect.Effect<unknown, McpClientError, never>)
      }) as Effect.Effect<unknown, McpClientError, never>

    // -- Build client capabilities from available handlers --
    const samplingOpt = yield* Effect.serviceOption(
      SamplingHandler
    )
    const elicitOpt = yield* Effect.serviceOption(
      ElicitationHandler
    )
    const rootsOpt = yield* Effect.serviceOption(
      RootsProvider
    )

    const clientCapabilities: Record<string, unknown> = {}
    if (Option.isSome(samplingOpt)) {
      clientCapabilities["sampling"] = {}
    }
    if (Option.isSome(elicitOpt)) {
      clientCapabilities["elicitation"] = {}
    }
    if (Option.isSome(rootsOpt)) {
      clientCapabilities["roots"] = { listChanged: true }
    }

    // -- Initialize handshake --
    const initResult = yield* sendRequest("initialize", {
      protocolVersion: LATEST_PROTOCOL_VERSION,
      capabilities: clientCapabilities,
      clientInfo: config.clientInfo
    })

    const initRecord = initResult as Record<
      string,
      unknown
    >

    // Decode server capabilities (cast to branded type)
    const serverCaps = yield* Effect.try({
      try: () =>
        Schema.decodeUnknownSync(ServerCapabilities)(
          initRecord["capabilities"] ?? {}
        ) as typeof ServerCapabilities.Type,
      catch: (err) =>
        new McpClientError({
          reason: "Protocol",
          message: `Invalid server capabilities: ${err}`,
          cause: err
        })
    })

    const capsRef = yield* Ref.make(serverCaps)
    const infoRef = yield* Ref.make(
      initRecord["serverInfo"] as Implementation
    )
    const instructionsRef = yield* Ref.make(
      initRecord["instructions"]
        ? Option.some(initRecord["instructions"] as string)
        : Option.none()
    )

    // Send initialized notification
    const outboundN = outbound(protocol.clientProtocol)
    yield* outboundN
      .sendInitialized()
      .pipe(
        Effect.catchCause((cause) =>
          Effect.fail(
            new McpClientError({
              reason: "Transport",
              message: `RPC error`,
              cause
            })
          )
        )
      )

    // -- Notification dispatch loop --
    const dispatcher = yield* makeInboundDispatcher()

    yield* Queue.take(protocol.notifications)
      .pipe(
        Effect.flatMap((n) => dispatcher.dispatch(n)),
        Effect.forever,
        Effect.forkScoped
      )

    // -- Server request handler loop --
    // Extract service shapes for the handler function
    const samplingService: Option.Option<SamplingService> =
      Option.isSome(samplingOpt)
        ? Option.some(
            samplingOpt.value as unknown as SamplingService
          )
        : Option.none()

    const elicitService: Option.Option<ElicitationService> =
      Option.isSome(elicitOpt)
        ? Option.some(
            elicitOpt.value as unknown as ElicitationService
          )
        : Option.none()

    const rootsService: Option.Option<RootsService> =
      Option.isSome(rootsOpt)
        ? Option.some(
            rootsOpt.value as unknown as RootsService
          )
        : Option.none()

    yield* Queue.take(protocol.serverRequests)
      .pipe(
        Effect.flatMap((req) =>
          handleServerRequest(
            protocol,
            req,
            samplingService,
            elicitService,
            rootsService
          )
        ),
        Effect.forever,
        Effect.forkScoped
      )

    // -- Capability gating --
    const requireCap = (
      name: string
    ): Effect.Effect<void, McpClientError> =>
      Effect.gen(function* () {
        const caps = yield* Ref.get(capsRef)
        const raw = caps as unknown as Record<
          string,
          unknown
        >
        if (raw[name] === undefined) {
          return yield* Effect.fail(
            new McpClientError({
              reason: "CapabilityNotSupported",
              message: `Server does not support: ${name}`
            })
          )
        }
      })

    const request = <A>(
      type: ClientRequestType,
      payload?: unknown
    ): Effect.Effect<A, McpClientError> => {
      const method = clientRequestMethod(type)
      const capability = CLIENT_REQUEST_CAPABILITY_BY_TYPE[type]
      const effect = capability === undefined
        ? sendRequest(method, payload)
        : requireCap(capability).pipe(
            Effect.andThen(sendRequest(method, payload))
          )
      return effect.pipe(Effect.map((v) => v as A))
    }

    // -- Build client --
    const client: McpClient = {
      serverCapabilities: Ref.get(capsRef),
      serverInfo: Ref.get(infoRef),
      instructions: Ref.get(instructionsRef),
      notifications: dispatcher,

      listTools: (p) => request("ListToolsRequest", p),
      callTool: (p) => request("CallToolRequest", p),

      listResources: (p) =>
        request("ListResourcesRequest", p),
      listResourceTemplates: (p) =>
        request("ListResourceTemplatesRequest", p),
      readResource: (p) =>
        request("ReadResourceRequest", p),
      subscribe: (p) =>
        request("SubscribeRequest", p),
      unsubscribe: (p) =>
        request("UnsubscribeRequest", p),

      listPrompts: (p) =>
        request("ListPromptsRequest", p),
      getPrompt: (p) =>
        request("GetPromptRequest", p),

      complete: (p) =>
        request("CompleteRequest", p),

      setLogLevel: (p) =>
        request("SetLevelRequest", p),

      getTask: (p) => request("GetTaskRequest", p),
      getTaskPayload: (p) =>
        request("GetTaskPayloadRequest", p),
      listTasks: (p) => request("ListTasksRequest", p),
      cancelTask: (p) =>
        request("CancelTaskRequest", p),

      ping: () =>
        request("PingRequest").pipe(Effect.asVoid),

      sendCancelled: (p) =>
        outboundN.sendCancelled(p).pipe(
          Effect.catchCause((cause) =>
            Effect.fail(
              new McpClientError({
                reason: "Transport",
                message: `RPC error`,
                cause
              })
            )
          )
        ),
      sendProgress: (p) =>
        outboundN.sendProgress(p).pipe(
          Effect.catchCause((cause) =>
            Effect.fail(
              new McpClientError({
                reason: "Transport",
                message: `RPC error`,
                cause
              })
            )
          )
        ),
      sendRootsListChanged: () =>
        outboundN.sendRootsListChanged().pipe(
          Effect.catchCause((cause) =>
            Effect.fail(
              new McpClientError({
                reason: "Transport",
                message: `RPC error`,
                cause
              })
            )
          )
        )
    }

    return client
  }))

// ---------------------------------------------------------------------------
// Internal: server request handler
// ---------------------------------------------------------------------------

const handleServerRequest = (
  protocol: McpClientProtocol,
  req: IncomingServerRequest,
  samplingOpt: Option.Option<SamplingService>,
  elicitOpt: Option.Option<ElicitationService>,
  rootsOpt: Option.Option<RootsService>
): Effect.Effect<void> => {
  const methodNotFound = (id: string) =>
    protocol
      .respondError(id, {
        code: -32601,
        message: "Method not found"
      })
      .pipe(Effect.orDie)

  switch (req.tag) {
    case serverRequestMethod("CreateMessageRequest"): {
      if (Option.isSome(samplingOpt)) {
        return samplingOpt.value
          .handle(req.payload as never)
          .pipe(
            Effect.flatMap((result) =>
              protocol
                .respond(req.id, result)
                .pipe(Effect.orDie)
            ),
            Effect.catchCause((cause) =>
              protocol
                .respondError(req.id, {
                  code: -32603,
                  message: String(cause)
                })
                .pipe(Effect.orDie)
            )
          )
      }
      return methodNotFound(req.id)
    }
    case serverRequestMethod("ElicitRequest"): {
      if (Option.isSome(elicitOpt)) {
        return elicitOpt.value
          .handle(req.payload as never)
          .pipe(
            Effect.flatMap((result) =>
              protocol
                .respond(req.id, result)
                .pipe(Effect.orDie)
            ),
            Effect.catchCause((cause) =>
              protocol
                .respondError(req.id, {
                  code: -32603,
                  message: String(cause)
                })
                .pipe(Effect.orDie)
            )
          )
      }
      return methodNotFound(req.id)
    }
    case serverRequestMethod("ListRootsRequest"): {
      if (Option.isSome(rootsOpt)) {
        return rootsOpt.value.list.pipe(
          Effect.flatMap((result) =>
            protocol
              .respond(req.id, result)
              .pipe(Effect.orDie)
          ),
          Effect.catchCause((cause) =>
            protocol
              .respondError(req.id, {
                code: -32603,
                message: String(cause)
              })
              .pipe(Effect.orDie)
          )
        )
      }
      return methodNotFound(req.id)
    }
    case serverRequestMethod("PingRequest"): {
      return protocol
        .respond(req.id, {})
        .pipe(Effect.orDie)
    }
    default: {
      return protocol
        .respondError(req.id, {
          code: -32601,
          message: `Unknown method: ${req.tag}`
        })
        .pipe(Effect.orDie)
    }
  }
}
