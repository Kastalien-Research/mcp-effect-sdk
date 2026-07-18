/**
 * High-level MCP client service (2026-07-28 stateless draft).
 *
 * The stateless draft removes the three-message initialization handshake. The
 * client instead:
 *
 * - attaches per-request `_meta` metadata (protocol version, client info,
 *   client capabilities) to every request, and
 * - calls `server/discover` to learn the server's supported versions,
 *   capabilities, info, and instructions.
 *
 * There is no `Mcp-Session-Id` and there are no server-initiated requests:
 * server→client interaction now flows through MRTR (`InputRequiredResult`) and
 * `subscriptions/listen`. See `docs/draft-2026-07-28-migration.md`.
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
import type { McpClientProtocol } from "./McpClientProtocol.js"
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
  CompleteResult,
  GetPromptResult,
  Implementation,
  ListPromptsResult,
  ListResourcesResult,
  ListResourceTemplatesResult,
  ListToolsResult,
  ReadResourceResult
} from "./McpSchema.js"
import { ServerCapabilities } from "./McpSchema.js"
import {
  CLIENT_REQUEST_METHOD_BY_TYPE,
  LATEST_PROTOCOL_VERSION
} from "./generated/mcp/2026-07-28/McpProtocol.generated.js"
import type { ClientRequestType } from "./generated/mcp/2026-07-28/McpProtocol.generated.js"

// ---------------------------------------------------------------------------
// Per-request metadata keys (2026-07-28 draft)
// ---------------------------------------------------------------------------

const META_PROTOCOL_VERSION = "io.modelcontextprotocol/protocolVersion"
const META_CLIENT_INFO = "io.modelcontextprotocol/clientInfo"
const META_CLIENT_CAPABILITIES = "io.modelcontextprotocol/clientCapabilities"

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

// Capability gating for the draft client request surface. Discover and the
// listing/read/call requests are always available; completion is gated on the
// server advertising `completions`, and subscriptions on `resources`.
const CLIENT_REQUEST_CAPABILITY_BY_TYPE = {
  DiscoverRequest: undefined,
  CompleteRequest: "completions",
  GetPromptRequest: "prompts",
  ListPromptsRequest: "prompts",
  ListResourcesRequest: "resources",
  ListResourceTemplatesRequest: "resources",
  ReadResourceRequest: "resources",
  SubscriptionsListenRequest: undefined,
  CallToolRequest: "tools",
  ListToolsRequest: "tools"
} satisfies Record<ClientRequestType, string | undefined>

const clientRequestMethod = <Type extends ClientRequestType>(
  type: Type
): typeof CLIENT_REQUEST_METHOD_BY_TYPE[Type] => CLIENT_REQUEST_METHOD_BY_TYPE[type]

export interface McpClientConfig {
  readonly clientInfo: {
    readonly name: string
    readonly version: string
  }
}

/**
 * Subscription filter for `subscriptions/listen`. All fields are optional
 * opt-ins; the server streams only the notification kinds requested.
 */
export interface SubscriptionFilter {
  readonly toolsListChanged?: boolean
  readonly promptsListChanged?: boolean
  readonly resourcesListChanged?: boolean
  readonly resourceSubscriptions?: ReadonlyArray<string>
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
  readonly supportedVersions: Effect.Effect<ReadonlyArray<string>>
  readonly notifications: InboundDispatcher

  /**
   * Re-run `server/discover`. Called automatically during construction; exposed
   * for callers that want to refresh capabilities (the draft is stateless, so
   * discovery results may be cached via `ttlMs`/`cacheScope`).
   */
  readonly discover: () => Effect.Effect<void, McpClientError>

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

  /**
   * Open a `subscriptions/listen` request. Replaces the legacy GET/SSE channel
   * and `resources/subscribe`. The returned result acknowledges the
   * subscription; notifications are delivered through `notifications`.
   */
  readonly subscriptionsListen: (
    filter?: SubscriptionFilter
  ) => Effect.Effect<unknown, McpClientError>

  readonly sendCancelled: (params: {
    readonly requestId: string | number
    readonly reason?: string
  }) => Effect.Effect<void, McpClientError>
}

// ---------------------------------------------------------------------------
// Constructor
// ---------------------------------------------------------------------------

/**
 * Create an McpClient against a transport `McpClientProtocol`.
 *
 * Performs an initial `server/discover` and attaches per-request `_meta` to
 * every outbound request, per the 2026-07-28 stateless draft.
 *
 * Requires `Scope` — background fibers (run loop, notification dispatch) are
 * interrupted on scope exit.
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
        const msg = message as unknown as Record<string, unknown>
        const tag = msg["_tag"] as string

        if (tag === "Exit") {
          const requestId = msg["requestId"] as string
          const exit = msg["exit"] as Record<string, unknown>
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

    // -- Build client capabilities from available handlers --
    const samplingOpt = yield* Effect.serviceOption(SamplingHandler)
    const elicitOpt = yield* Effect.serviceOption(ElicitationHandler)
    const rootsOpt = yield* Effect.serviceOption(RootsProvider)

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

    // -- Request sender: injects per-request `_meta` then correlates --
    const sendRequest = (
      method: string,
      payload?: unknown
    ): Effect.Effect<unknown, McpClientError> =>
      Effect.gen(function* () {
        const id = yield* Ref.getAndUpdate(nextIdRef, (n) => n + 1)
        const idStr = String(id)
        const deferred = yield* Deferred.make<unknown, McpClientError>()

        yield* Ref.update(pendingRef, HashMap.set(idStr, deferred))

        const base = (payload ?? {}) as Record<string, unknown>
        const existingMeta = (base["_meta"] ?? {}) as Record<string, unknown>
        const withMeta = {
          ...base,
          _meta: {
            ...existingMeta,
            [META_PROTOCOL_VERSION]: LATEST_PROTOCOL_VERSION,
            [META_CLIENT_INFO]: config.clientInfo,
            [META_CLIENT_CAPABILITIES]: clientCapabilities
          }
        }

        yield* protocol.clientProtocol
          .send({
            _tag: "Request",
            id: idStr,
            tag: method,
            payload: withMeta,
            headers: []
          } as never)
          .pipe(
            Effect.catchAllCause((cause: unknown) =>
              Effect.gen(function* () {
                yield* Ref.update(pendingRef, HashMap.remove(idStr))
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

        return yield* Deferred.await(deferred)
      })

    // -----------------------------------------------------------------------
    // Multi Round-Trip (MRTR) — client side
    // -----------------------------------------------------------------------
    //
    // The stateless draft replaces server-initiated requests with the MRTR
    // pattern: a server may answer any request with an `input_required` result
    // carrying a map of `inputRequests` (each a sampling/roots/elicitation
    // request) plus an opaque `requestState`. The client resolves each request
    // via its locally-registered handler, then RE-SENDS the ORIGINAL request
    // method with params extended by `inputResponses` (keyed identically) and
    // `requestState`. This repeats until the server returns a `complete`
    // result. See docs/draft-2026-07-28-migration.md.

    // Bound on MRTR rounds to prevent an unbounded server from looping the
    // client forever.
    const MRTR_MAX_ROUNDS = 8

    // Resolve a single server-initiated input request via the matching
    // optional client handler. Fails with `InputRequired` when no handler for
    // the requested method is registered.
    const resolveInputRequest = (
      inputRequest: Record<string, unknown>
    ): Effect.Effect<unknown, McpClientError> => {
      const method = inputRequest["method"] as string | undefined
      const params = (inputRequest["params"] ?? {}) as Record<string, unknown>

      const fromHandler = <A>(
        eff: Effect.Effect<A, unknown>
      ): Effect.Effect<unknown, McpClientError> =>
        eff.pipe(
          Effect.catchAllCause((cause: unknown) =>
            Effect.fail(
              new McpClientError({
                reason: "InputRequired",
                message: `MRTR handler for ${method} failed`,
                cause
              })
            )
          )
        )

      const noHandler = (m: string): Effect.Effect<never, McpClientError> =>
        Effect.fail(
          new McpClientError({
            reason: "InputRequired",
            message: `Server requested MRTR input but no handler for ${m} is registered`
          })
        )

      switch (method) {
        case "sampling/createMessage":
          return Option.isSome(samplingOpt)
            ? fromHandler(
                samplingOpt.value.handle(
                  params as unknown as Parameters<typeof samplingOpt.value.handle>[0]
                )
              )
            : noHandler(method)
        case "elicitation/create":
          return Option.isSome(elicitOpt)
            ? fromHandler(
                elicitOpt.value.handle(
                  params as unknown as Parameters<typeof elicitOpt.value.handle>[0]
                )
              )
            : noHandler(method)
        case "roots/list":
          return Option.isSome(rootsOpt)
            ? fromHandler(rootsOpt.value.list)
            : noHandler("roots/list")
        default:
          return Effect.fail(
            new McpClientError({
              reason: "InputRequired",
              message: `Unknown MRTR input request method: ${String(method)}`,
              cause: inputRequest
            })
          )
      }
    }

    // Send `method` with `payload`, then run the bounded MRTR loop. On
    // `complete` (or absent `resultType`) the raw result is returned; on
    // `input_required` the input requests are resolved and the ORIGINAL method
    // is re-sent with the accumulated `inputResponses` + latest `requestState`.
    const sendWithMrtr = (
      method: string,
      payload: unknown
    ): Effect.Effect<unknown, McpClientError> => {
      const loop = (
        currentPayload: unknown,
        round: number
      ): Effect.Effect<unknown, McpClientError> =>
        sendRequest(method, currentPayload).pipe(
          Effect.flatMap((value) => {
            const record = (value ?? {}) as Record<string, unknown>
            // Servers from before the draft omit `resultType`; treat as
            // "complete".
            const resultType =
              (record["resultType"] as string | undefined) ?? "complete"

            if (resultType !== "input_required") {
              return Effect.succeed(value)
            }

            if (round >= MRTR_MAX_ROUNDS) {
              return Effect.fail(
                new McpClientError({
                  reason: "InputRequired",
                  message: "MRTR exceeded max rounds",
                  cause: record
                })
              )
            }

            const inputRequests = (record["inputRequests"] ?? {}) as Record<
              string,
              Record<string, unknown>
            >
            const requestState = record["requestState"]

            // Resolve every input request, preserving its key so the
            // `inputResponses` map can be built with matching keys.
            const entries = Object.entries(inputRequests)
            return Effect.forEach(
              entries,
              ([key, inputRequest]) =>
                resolveInputRequest(inputRequest).pipe(
                  Effect.map((response) => [key, response] as const)
                ),
              { concurrency: "unbounded" }
            ).pipe(
              Effect.flatMap((resolved) => {
                const inputResponses: Record<string, unknown> = {}
                for (const [key, response] of resolved) {
                  inputResponses[key] = response
                }
                // Thread the ORIGINAL params through; extend with the MRTR
                // retry fields. `_meta` is re-injected by `sendRequest`.
                const base = (payload ?? {}) as Record<string, unknown>
                const nextPayload: Record<string, unknown> = {
                  ...base,
                  inputResponses,
                  ...(requestState === undefined
                    ? {}
                    : { requestState })
                }
                return loop(nextPayload, round + 1)
              })
            )
          })
        )

      return loop(payload, 0)
    }

    // -- Capability map + discovery state --
    const capsRef = yield* Ref.make<typeof ServerCapabilities.Type>(
      Schema.decodeUnknownSync(ServerCapabilities)({}) as typeof ServerCapabilities.Type
    )
    const infoRef = yield* Ref.make<Implementation>({
      name: "unknown",
      version: "0.0.0"
    } as Implementation)
    const instructionsRef = yield* Ref.make(Option.none<string>())
    const versionsRef = yield* Ref.make<ReadonlyArray<string>>([])

    const discover = (): Effect.Effect<void, McpClientError> =>
      Effect.gen(function* () {
        const result = yield* sendRequest(
          clientRequestMethod("DiscoverRequest"),
          {}
        )
        const record = (result ?? {}) as Record<string, unknown>

        // `server/discover` is the stateless entry point and must not require
        // MRTR input. Guard against an unexpected `input_required` so we never
        // silently decode empty capabilities from an interim result.
        if (record["resultType"] === "input_required") {
          return yield* Effect.fail(
            new McpClientError({
              reason: "InputRequired",
              message: "server/discover unexpectedly returned an input_required result"
            })
          )
        }

        const serverCaps = yield* Effect.try({
          try: () =>
            Schema.decodeUnknownSync(ServerCapabilities)(
              record["capabilities"] ?? {}
            ) as typeof ServerCapabilities.Type,
          catch: (err) =>
            new McpClientError({
              reason: "Protocol",
              message: `Invalid server capabilities: ${err}`,
              cause: err
            })
        })

        const versions = Array.isArray(record["supportedVersions"])
          ? (record["supportedVersions"] as ReadonlyArray<string>)
          : []
        if (versions.length > 0 && !versions.includes(LATEST_PROTOCOL_VERSION)) {
          return yield* Effect.fail(
            new McpClientError({
              reason: "UnsupportedProtocolVersion",
              message: `Server does not support protocol version ${LATEST_PROTOCOL_VERSION}; supported: ${versions.join(", ")}`
            })
          )
        }

        yield* Ref.set(capsRef, serverCaps)
        yield* Ref.set(versionsRef, versions)
        yield* Ref.set(
          infoRef,
          (record["serverInfo"] ?? { name: "unknown", version: "0.0.0" }) as Implementation
        )
        yield* Ref.set(
          instructionsRef,
          record["instructions"]
            ? Option.some(record["instructions"] as string)
            : Option.none()
        )
      })

    // -- Initial discovery --
    yield* discover()

    // -- Notification dispatch loop --
    const dispatcher = yield* makeInboundDispatcher()
    const outboundN = outbound(protocol.clientProtocol)

    yield* Queue.take(protocol.notifications)
      .pipe(
        Effect.flatMap((n) => dispatcher.dispatch(n)),
        Effect.forever,
        Effect.forkScoped
      )

    // -- Capability gating --
    const requireCap = (
      name: string
    ): Effect.Effect<void, McpClientError> =>
      Effect.gen(function* () {
        const caps = yield* Ref.get(capsRef)
        const raw = caps as unknown as Record<string, unknown>
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
      // Drive the request through the MRTR loop so `input_required` results are
      // satisfied and retried transparently. See docs/draft-2026-07-28-migration.md.
      const send = sendWithMrtr(method, payload)
      const effect = capability === undefined
        ? send
        : requireCap(capability).pipe(Effect.andThen(send))
      return effect.pipe(Effect.map((v) => v as A))
    }

    // -- Build client --
    const client: McpClient = {
      serverCapabilities: Ref.get(capsRef),
      serverInfo: Ref.get(infoRef),
      instructions: Ref.get(instructionsRef),
      supportedVersions: Ref.get(versionsRef),
      notifications: dispatcher,

      discover,

      listTools: (p) => request("ListToolsRequest", p),
      callTool: (p) => request("CallToolRequest", p),

      listResources: (p) => request("ListResourcesRequest", p),
      listResourceTemplates: (p) =>
        request("ListResourceTemplatesRequest", p),
      readResource: (p) => request("ReadResourceRequest", p),

      listPrompts: (p) => request("ListPromptsRequest", p),
      getPrompt: (p) => request("GetPromptRequest", p),

      complete: (p) => request("CompleteRequest", p),

      subscriptionsListen: (filter) =>
        request("SubscriptionsListenRequest", filter ?? {}),

      sendCancelled: (p) =>
        outboundN.sendCancelled(p).pipe(
          Effect.catchAllCause((cause: unknown) =>
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
  })
