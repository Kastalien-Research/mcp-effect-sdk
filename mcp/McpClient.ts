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
import { SamplingHandler } from "./handlers/SamplingHandler.js"
import { ElicitationHandler } from "./handlers/ElicitationHandler.js"
import { RootsProvider } from "./handlers/RootsProvider.js"
import type {
  CallToolResult,
  CompleteResult,
  GetPromptResult,
  Implementation,
  ListPromptsResult,
  ListResourcesResult,
  ListResourceTemplatesResult,
  ListToolsResult,
  ReadResourceResult,
  Task
} from "./McpSchema.js"
import { ServerCapabilities } from "./McpSchema.js"

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

const PROTOCOL_VERSION = "2025-11-25"

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
  }) => Effect.Effect<Task, McpClientError>
  readonly listTasks: (params?: {
    readonly cursor?: string
  }) => Effect.Effect<
    { readonly tasks: ReadonlyArray<Task> },
    McpClientError
  >
  readonly cancelTask: (params: {
    readonly taskId: string
  }) => Effect.Effect<Task, McpClientError>

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
  Effect.gen(function* () {
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
      .pipe(Effect.fork)

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
            Effect.catchAll((err) =>
              Effect.gen(function* () {
                yield* Ref.update(
                  pendingRef,
                  HashMap.remove(idStr)
                )
                yield* Deferred.fail(
                  deferred,
                  new McpClientError({
                    reason: "Transport",
                    message: `Send failed: ${err}`,
                    cause: err
                  })
                )
              })
            )
          )

        return yield* Deferred.await(deferred)
      })

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
      protocolVersion: PROTOCOL_VERSION,
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
      Option.fromNullable(
        initRecord["instructions"] as string | undefined
      )
    )

    // Send initialized notification
    const outboundN = outbound(protocol.clientProtocol)
    yield* outboundN
      .sendInitialized()
      .pipe(
        Effect.catchAll((err) =>
          Effect.fail(
            new McpClientError({
              reason: "Transport",
              message: `RPC error: ${err}`,
              cause: err
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
        Effect.fork
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
        Effect.fork
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

    const gated = <A>(
      cap: string,
      method: string,
      payload?: unknown
    ): Effect.Effect<A, McpClientError> =>
      requireCap(cap).pipe(
        Effect.andThen(sendRequest(method, payload)),
        Effect.map((v) => v as A)
      )

    // -- Build client --
    return {
      serverCapabilities: Ref.get(capsRef),
      serverInfo: Ref.get(infoRef),
      instructions: Ref.get(instructionsRef),
      notifications: dispatcher,

      listTools: (p) => gated("tools", "tools/list", p),
      callTool: (p) => gated("tools", "tools/call", p),

      listResources: (p) =>
        gated("resources", "resources/list", p),
      listResourceTemplates: (p) =>
        gated("resources", "resources/templates/list", p),
      readResource: (p) =>
        gated("resources", "resources/read", p),
      subscribe: (p) =>
        gated("resources", "resources/subscribe", p),
      unsubscribe: (p) =>
        gated("resources", "resources/unsubscribe", p),

      listPrompts: (p) =>
        gated("prompts", "prompts/list", p),
      getPrompt: (p) =>
        gated("prompts", "prompts/get", p),

      complete: (p) =>
        gated("completions", "completion/complete", p),

      setLogLevel: (p) =>
        gated("logging", "logging/setLevel", p),

      getTask: (p) => gated("tasks", "tasks/get", p),
      listTasks: (p) => gated("tasks", "tasks/list", p),
      cancelTask: (p) =>
        gated("tasks", "tasks/cancel", p),

      ping: () =>
        sendRequest("ping").pipe(Effect.asVoid),

      sendCancelled: (p) =>
        outboundN.sendCancelled(p).pipe(
          Effect.catchAll((err) =>
            Effect.fail(
              new McpClientError({
                reason: "Transport",
                message: `RPC error: ${err}`,
                cause: err
              })
            )
          )
        ),
      sendProgress: (p) =>
        outboundN.sendProgress(p).pipe(
          Effect.catchAll((err) =>
            Effect.fail(
              new McpClientError({
                reason: "Transport",
                message: `RPC error: ${err}`,
                cause: err
              })
            )
          )
        ),
      sendRootsListChanged: () =>
        outboundN.sendRootsListChanged().pipe(
          Effect.catchAll((err) =>
            Effect.fail(
              new McpClientError({
                reason: "Transport",
                message: `RPC error: ${err}`,
                cause: err
              })
            )
          )
        )
    } satisfies McpClient
  })

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
    case "sampling/createMessage": {
      if (Option.isSome(samplingOpt)) {
        return samplingOpt.value
          .handle(req.payload as never)
          .pipe(
            Effect.flatMap((result) =>
              protocol
                .respond(req.id, result)
                .pipe(Effect.orDie)
            ),
            Effect.catchAll((err) =>
              protocol
                .respondError(req.id, {
                  code: -32603,
                  message: String(err)
                })
                .pipe(Effect.orDie)
            )
          )
      }
      return methodNotFound(req.id)
    }
    case "elicitation/create": {
      if (Option.isSome(elicitOpt)) {
        return elicitOpt.value
          .handle(req.payload as never)
          .pipe(
            Effect.flatMap((result) =>
              protocol
                .respond(req.id, result)
                .pipe(Effect.orDie)
            ),
            Effect.catchAll((err) =>
              protocol
                .respondError(req.id, {
                  code: -32603,
                  message: String(err)
                })
                .pipe(Effect.orDie)
            )
          )
      }
      return methodNotFound(req.id)
    }
    case "roots/list": {
      if (Option.isSome(rootsOpt)) {
        return rootsOpt.value.list.pipe(
          Effect.flatMap((result) =>
            protocol
              .respond(req.id, result)
              .pipe(Effect.orDie)
          ),
          Effect.catchAll((err) =>
            protocol
              .respondError(req.id, {
                code: -32603,
                message: String(err)
              })
              .pipe(Effect.orDie)
          )
        )
      }
      return methodNotFound(req.id)
    }
    case "ping": {
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
