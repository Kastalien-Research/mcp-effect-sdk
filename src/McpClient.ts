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
  Either,
  Effect,
  Option,
  Ref,
  Schema,
  Scope,
  Stream
} from "effect"
import { McpClientError } from "./McpClientError.js"
import { SchemaValidationError } from "./McpErrors.js"
import type { McpTransport } from "./McpTransport.js"
import type { JsonRpcRequest } from "./McpWire.js"
import { makeInboundDispatcher } from "./McpNotifications.js"
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
import { InputRequiredResult, ServerCapabilities } from "./McpSchema.js"
import { serverInfoFromResult } from "./McpModern.js"
import {
  CLIENT_REQUEST_METHOD_BY_TYPE,
  CLIENT_REQUEST_RESULT_CODEC_BY_METHOD,
  LATEST_PROTOCOL_VERSION
} from "./generated/mcp/2026-07-28/McpProtocol.generated.js"
import { cloneSchemaJson, cloneStrictJson, invalidStrictJson } from "./internal/StrictJson.js"
import type {
  ClientRequestMethod,
  ClientRequestType
} from "./generated/mcp/2026-07-28/McpProtocol.generated.js"

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

type CompleteClientResultForMethod<Method extends ClientRequestMethod> =
  Schema.Schema.Type<(typeof CLIENT_REQUEST_RESULT_CODEC_BY_METHOD)[Method]>

type InputRequiredClientMethod = "prompts/get" | "resources/read" | "tools/call"

/** The generated complete result plus the exact interim union where MRTR is permitted. */
export type ClientResultForMethod<Method extends ClientRequestMethod> =
  Method extends InputRequiredClientMethod
    ? CompleteClientResultForMethod<Method> | InputRequiredResult
    : CompleteClientResultForMethod<Method>

const INPUT_REQUIRED_CLIENT_METHODS: ReadonlySet<ClientRequestMethod> = new Set([
  "prompts/get",
  "resources/read",
  "tools/call"
])

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
  readonly serverInfo: Effect.Effect<Option.Option<Implementation>>
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
   * and `resources/subscribe`. This Effect remains active for the lifetime of
   * the subscription while acknowledgements and selected notifications are
   * delivered through `notifications`. Callers own that lifetime and should
   * fork it in a scope when they need to perform other requests concurrently.
   */
  readonly subscriptionsListen: (
    filter?: SubscriptionFilter
  ) => Effect.Effect<unknown, McpClientError>

}

// ---------------------------------------------------------------------------
// Constructor
// ---------------------------------------------------------------------------

/**
 * Create an McpClient against a request-scoped `McpTransport`.
 *
 * Performs an initial `server/discover` and attaches per-request `_meta` to
 * every outbound request, per the 2026-07-28 stateless draft.
 *
 * Requires `Scope` — background fibers (run loop, notification dispatch) are
 * interrupted on scope exit.
 */
export const make = <E>(
  transport: McpTransport<E>,
  config: McpClientConfig
): Effect.Effect<McpClient, McpClientError, Scope.Scope> =>
  Effect.gen(function* () {
    const nextIdRef = yield* Ref.make(1)
    const dispatcher = yield* makeInboundDispatcher()

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
      method: ClientRequestMethod,
      payload?: unknown
    ): Effect.Effect<unknown, McpClientError> =>
      Effect.gen(function* () {
        const id = yield* Ref.getAndUpdate(nextIdRef, (n) => n + 1)

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

        const request: JsonRpcRequest = {
          _tag: "Request",
          jsonrpc: "2.0",
          id,
          method,
          params: withMeta
        }
        const terminal = yield* transport.request(request).pipe(
          Stream.tap((frame) => frame._tag === "Notification"
            ? dispatcher.dispatch(frame.notification)
            : Effect.void),
          Stream.runLast,
          Effect.mapError((cause) => new McpClientError({
            reason: "Transport",
            message: "MCP transport request failed",
            cause
          }))
        )
        if (Option.isNone(terminal)) {
          return yield* Effect.fail(new McpClientError({
            reason: "Protocol",
            message: "Request completed without a terminal response"
          }))
        }
        if (terminal.value._tag === "Success") return terminal.value.response.result
        if (terminal.value._tag === "Error") {
          return yield* Effect.fail(new McpClientError({
            reason: "Protocol",
            message: terminal.value.response.error.message,
            cause: terminal.value.response.error
          }))
        }
        return yield* Effect.fail(new McpClientError({
          reason: "Protocol",
          message: "Request completed with a notification but no terminal response"
        }))
      })

    const decodeClientResult = <Method extends ClientRequestMethod>(
      method: Method,
      value: unknown
    ): Effect.Effect<ClientResultForMethod<Method>, McpClientError> => Effect.gen(function*() {
      const strict = yield* Effect.try({
        try: () => cloneStrictJson(value),
        catch: () => new McpClientError({
          reason: "Protocol",
          message: `Could not inspect ${method} result`,
          cause: new SchemaValidationError({ message: "Could not inspect client result" })
        })
      })
      const decodedSide = strict === invalidStrictJson
      const normalized = decodedSide
        ? yield* Effect.try({
            try: () => cloneSchemaJson(value),
            catch: () => new McpClientError({
              reason: "Protocol",
              message: `Could not inspect ${method} result`,
              cause: new SchemaValidationError({ message: "Could not inspect decoded client result" })
            })
          })
        : strict
      if (normalized === invalidStrictJson) {
        return yield* Effect.fail(new McpClientError({
          reason: "Protocol",
          message: `Invalid ${method} result`,
          cause: new SchemaValidationError({ message: "Expected a JSON or decoded schema result" })
        }))
      }

      const decodeExact = (codec: Schema.Schema.AnyNoContext) => {
        if (!decodedSide) return Schema.decodeUnknownEither(codec)(normalized)
        const validated = Schema.validateEither(codec)(normalized)
        if (Either.isLeft(validated)) return validated
        const encoded = Schema.encodeUnknownEither(codec)(validated.right)
        if (Either.isLeft(encoded)) return encoded
        const canonical = cloneStrictJson(encoded.right)
        return canonical === invalidStrictJson
          ? invalidStrictJson
          : Schema.decodeUnknownEither(codec)(canonical)
      }

      const complete = yield* Effect.try({
        try: () => decodeExact(
          CLIENT_REQUEST_RESULT_CODEC_BY_METHOD[method] as Schema.Schema.AnyNoContext
        ),
        catch: () => new McpClientError({
          reason: "Protocol",
          message: `Could not decode ${method} result`,
          cause: new SchemaValidationError({ message: "Generated result decoder failed" })
        })
      })
      if (complete === invalidStrictJson) {
        return yield* Effect.fail(new McpClientError({
          reason: "Protocol",
          message: `Invalid ${method} result`,
          cause: new SchemaValidationError({ message: "Expected a canonical JSON result" })
        }))
      }
      if (Either.isRight(complete)) {
        return complete.right as ClientResultForMethod<Method>
      }

      if (INPUT_REQUIRED_CLIENT_METHODS.has(method)) {
        const inputRequired = yield* Effect.try({
          try: () => decodeExact(InputRequiredResult),
          catch: () => new McpClientError({
            reason: "Protocol",
            message: `Could not decode ${method} input_required result`,
            cause: new SchemaValidationError({ message: "Generated input_required decoder failed" })
          })
        })
        if (inputRequired === invalidStrictJson) {
          return yield* Effect.fail(new McpClientError({
            reason: "Protocol",
            message: `Invalid ${method} input_required result`,
            cause: new SchemaValidationError({ message: "Expected a canonical JSON input_required result" })
          }))
        }
        if (Either.isRight(inputRequired)) {
          return inputRequired.right as ClientResultForMethod<Method>
        }
        if (ownResultType(normalized) === "input_required") {
          return yield* Effect.fail(new McpClientError({
            reason: "Protocol",
            message: `Invalid ${method} input_required result`,
            cause: inputRequired.left
          }))
        }
      }

      return yield* Effect.fail(new McpClientError({
        reason: "Protocol",
        message: `Invalid ${method} result`,
        cause: complete.left
      }))
    })

    // -----------------------------------------------------------------------
    // Multi Round-Trip (MRTR) — client side
    // -----------------------------------------------------------------------
    //
    // The stateless draft replaces server-initiated requests with the MRTR
    // pattern: a server may answer prompts/get, resources/read, or tools/call
    // with an `input_required` result
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

    // Send `method` with `payload`, then run the bounded MRTR loop. On an
    // exactly decoded `complete` result the value is returned; on
    // `input_required` the input requests are resolved and the ORIGINAL method
    // is re-sent with the accumulated `inputResponses` + latest `requestState`.
    const sendWithMrtr = (
      method: ClientRequestMethod,
      payload: unknown
    ): Effect.Effect<unknown, McpClientError> => {
      const loop = (
        currentPayload: unknown,
        round: number
      ): Effect.Effect<unknown, McpClientError> =>
        sendRequest(method, currentPayload).pipe(
          Effect.flatMap((value) => decodeClientResult(method, value)),
          Effect.flatMap((value) => {
            const record = (value ?? {}) as Record<string, unknown>
            const resultType = record["resultType"] as string

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
    const infoRef = yield* Ref.make<Option.Option<Implementation>>(Option.none())
    const instructionsRef = yield* Ref.make(Option.none<string>())
    const versionsRef = yield* Ref.make<ReadonlyArray<string>>([])

    const discover = (): Effect.Effect<void, McpClientError> =>
      Effect.gen(function* () {
        const method = clientRequestMethod("DiscoverRequest")
        const result = yield* sendRequest(method, {}).pipe(
          Effect.flatMap((value) => decodeClientResult(method, value))
        )
        const serverCaps = result.capabilities
        const versions = result.supportedVersions
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
        yield* Ref.set(infoRef, serverInfoFromResult(result))
        yield* Ref.set(
          instructionsRef,
          result.instructions !== undefined
            ? Option.some(result.instructions)
            : Option.none()
        )
      })

    // -- Initial discovery --
    yield* discover()

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
        request("SubscriptionsListenRequest", { notifications: filter ?? {} })
    }

    return client
  })

const ownResultType = (value: unknown): unknown => {
  if ((typeof value !== "object" && typeof value !== "function") || value === null) return undefined
  try {
    const descriptor = Object.getOwnPropertyDescriptor(value, "resultType")
    return descriptor !== undefined && "value" in descriptor ? descriptor.value : undefined
  } catch {
    return undefined
  }
}
