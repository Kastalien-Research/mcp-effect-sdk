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
  Cause,
  Clock,
  Context,
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
import type { JsonRpcId, JsonRpcRequest } from "./McpWire.js"
import { makeInboundDispatcher } from "./McpNotifications.js"
import type { InboundDispatcher } from "./McpNotifications.js"
import { SamplingHandler } from "./client-handlers/SamplingHandler.js"
import { ElicitationHandler } from "./client-handlers/ElicitationHandler.js"
import { RootsProvider } from "./client-handlers/RootsProvider.js"
import type {
  CallToolResult,
  ClientCapabilities,
  CompleteResult,
  GetPromptResult,
  Implementation,
  ListPromptsResult,
  ListResourcesResult,
  ListResourceTemplatesResult,
  ListToolsResult,
  ReadResourceResult
} from "./McpSchema.js"
import {
  ClientCapabilities as ClientCapabilitiesSchema,
  Implementation as ImplementationSchema,
  InputRequiredResult,
  ServerCapabilities
} from "./McpSchema.js"
import { serverInfoFromResult } from "./McpModern.js"
import {
  CLIENT_REQUEST_METHOD_BY_TYPE,
  CLIENT_REQUEST_RESULT_CODEC_BY_METHOD,
  LATEST_PROTOCOL_VERSION
} from "./generated/mcp/2026-07-28/McpProtocol.generated.js"
import {
  McpCache,
  McpCacheError,
  randomCacheNamespace,
  type CacheableClientMethod,
  type McpCacheAuthorization,
  type McpCacheAuthorizationProvider,
  type McpCacheEntry,
  type McpCacheKey,
  type McpCacheSelector,
  type McpCacheService
} from "./McpCache.js"

export {
  McpCache,
  McpCacheError,
  type CacheableClientMethod,
  type McpCacheAuthorization,
  type McpCacheAuthorizationProvider,
  type McpCacheEntry,
  type McpCacheKey,
  type McpCacheSelector,
  type McpCacheService
}
import { cloneSchemaJson, cloneStrictJson, invalidStrictJson } from "./internal/StrictJson.js"
import { snapshotConstructorOptions } from "./internal/ConstructorOptions.js"
import {
  normalizeExtensionCapabilities,
  type ExtensionCapabilities
} from "./internal/ExtensionCapabilities.js"
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

const CACHEABLE_CLIENT_METHODS: ReadonlySet<ClientRequestMethod> = new Set([
  "server/discover",
  "tools/list",
  "resources/list",
  "resources/templates/list",
  "resources/read",
  "prompts/list"
])

const isCacheableMethod = (method: ClientRequestMethod): method is CacheableClientMethod =>
  CACHEABLE_CLIENT_METHODS.has(method)

export interface ClientRequestProfileContext {
  readonly id: JsonRpcId
  readonly method: ClientRequestMethod
}

export type CoreClientCapabilities = Omit<ClientCapabilities, "extensions"> & {
  readonly extensions?: never
}

export type ClientExtensionCapabilities = ExtensionCapabilities

export type ClientCapabilitiesProvider<E = never, R = never> = (
  context: ClientRequestProfileContext
) => Effect.Effect<CoreClientCapabilities, E, R>

export type ClientExtensionsProvider<E = never, R = never> = (
  context: ClientRequestProfileContext
) => Effect.Effect<ClientExtensionCapabilities, E, R>

export interface McpClientOptions<
  TransportError,
  CapabilityError = never,
  CapabilityRequirements = never,
  ExtensionError = never,
  ExtensionRequirements = never,
  CacheAuthorizationError = never,
  CacheAuthorizationRequirements = never
> {
  readonly transport: McpTransport<TransportError>
  readonly clientInfo?: Implementation
  readonly capabilities?: ClientCapabilitiesProvider<
    CapabilityError,
    CapabilityRequirements
  >
  readonly extensions?: ClientExtensionsProvider<
    ExtensionError,
    ExtensionRequirements
  >
  readonly cache?: McpCacheService
  readonly cacheNamespace?: string
  readonly cacheAuthorization?: McpCacheAuthorizationProvider<
    CacheAuthorizationError,
    CacheAuthorizationRequirements
  >
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
export const make = <TE, CE = never, CR = never, EE = never, ER = never, CAE = never, CAR = never>(
  options: McpClientOptions<TE, CE, CR, EE, ER, CAE, CAR>
): Effect.Effect<McpClient, McpClientError, Scope.Scope | CR | ER | CAR> =>
  Effect.gen(function* () {
    const snapshot = yield* Effect.try({
      try: () => snapshotConstructorOptions(options),
      catch: (cause) => protocolValidationError("Invalid MCP client options", cause)
    })
    const transport = snapshot["transport"] as McpTransport<TE>
    const clientInfoInput = snapshot["clientInfo"] as Implementation | undefined
    const capabilitiesProvider = snapshot["capabilities"] as ClientCapabilitiesProvider<CE, CR> | undefined
    const extensionsProvider = snapshot["extensions"] as ClientExtensionsProvider<EE, ER> | undefined
    const cacheInput = snapshot["cache"]
    const cacheNamespaceInput = snapshot["cacheNamespace"]
    const cacheAuthorizationInput = snapshot["cacheAuthorization"]
    const nextIdRef = yield* Ref.make(1)
    const dispatcher = yield* makeInboundDispatcher()
    const providerContext = yield* Effect.context<CR | ER | CAR>()
    const cacheContext = providerContext as Context.Context<never>
    const cache = cacheInput === undefined
      ? undefined
      : yield* Effect.try({
          try: () => snapshotCacheService(cacheInput, cacheContext),
          catch: () => cacheClientError("Invalid MCP cache service")
        })
    const cacheNamespace = cacheNamespaceInput === undefined
      ? yield* randomCacheNamespace()
      : yield* Effect.try({
          try: () => validateOpaqueCacheString(cacheNamespaceInput, "cache namespace"),
          catch: () => cacheClientError("Invalid cache namespace")
        })
    const cacheAuthorizationProvider = cacheAuthorizationInput === undefined
      ? undefined
      : yield* Effect.try({
          try: () => {
            if (typeof cacheAuthorizationInput !== "function") {
              throw new TypeError("cacheAuthorization must be a function")
            }
            return cacheAuthorizationInput as McpCacheAuthorizationProvider<CAE, CAR>
          },
          catch: () => cacheClientError("Invalid cache authorization provider")
        })
    const cacheEpochs = yield* Ref.make<Record<CacheableClientMethod, number>>({
      "server/discover": 0,
      "tools/list": 0,
      "resources/list": 0,
      "resources/templates/list": 0,
      "resources/read": 0,
      "prompts/list": 0
    })

    const clientInfo = clientInfoInput === undefined
      ? undefined
      : yield* canonicalWireRecord(
          ImplementationSchema,
          clientInfoInput,
          "client info"
        )

    // -- Build client capabilities from available handlers --
    const samplingOpt = yield* Effect.serviceOption(SamplingHandler)
    const elicitOpt = yield* Effect.serviceOption(ElicitationHandler)
    const rootsOpt = yield* Effect.serviceOption(RootsProvider)

    const inferredCapabilities = (): Record<string, unknown> => ({
      ...(Option.isSome(samplingOpt) ? { sampling: {} } : {}),
      ...(Option.isSome(elicitOpt) ? { elicitation: {} } : {}),
      ...(Option.isSome(rootsOpt) ? { roots: { listChanged: true } } : {})
    })

    const invokeProvider = <A, E, R>(
      provider: (context: ClientRequestProfileContext) => Effect.Effect<A, E, R>,
      context: ClientRequestProfileContext,
      label: string
    ): Effect.Effect<A, McpClientError> =>
      Effect.suspend(() => provider(context)).pipe(
        Effect.provide(providerContext as Context.Context<R>),
        Effect.catchAllCause((cause) => Effect.fail(new McpClientError({
          reason: "Protocol",
          message: `${label} failed for ${context.method}`,
          cause
        })))
      )

    const requestCapabilities = (
      context: ClientRequestProfileContext
    ): Effect.Effect<Record<string, unknown>, McpClientError> => Effect.gen(function*() {
      const explicit = capabilitiesProvider === undefined
        ? {}
        : yield* invokeProvider(capabilitiesProvider, context, "Client capabilities provider")
      const core = yield* inspectProviderRecord(explicit, "client capabilities")
      if (Object.hasOwn(core, "extensions")) {
        return yield* Effect.fail(protocolValidationError(
          "Client capabilities provider must not return extensions"
        ))
      }

      const extensions = extensionsProvider === undefined
        ? {}
        : yield* invokeProvider(extensionsProvider, context, "Client extensions provider")
      const extensionSnapshot = yield* Effect.try({
        try: () => normalizeExtensionCapabilities(extensions) ?? {},
        catch: (cause) => protocolValidationError("Invalid client extensions", cause)
      })

      const merged = {
        ...inferredCapabilities(),
        ...core,
        ...(Object.keys(extensionSnapshot).length === 0
          ? {}
          : { extensions: extensionSnapshot })
      }
      return yield* canonicalWireRecord(
        ClientCapabilitiesSchema,
        merged,
        "client capabilities"
      )
    })

    const cacheAuthorizationPartition = (): Effect.Effect<string | undefined, McpClientError> => {
      if (cacheAuthorizationProvider === undefined) return Effect.succeed(undefined)
      return containCacheCallback<McpCacheAuthorization>(
        () => cacheAuthorizationProvider(),
        cacheContext,
        "Cache authorization provider failed"
      ).pipe(Effect.flatMap((authorization) => Effect.try({
        try: () => inspectAuthorization(authorization),
        catch: () => cacheClientError("Invalid cache authorization")
      })))
    }

    const updateEpochs = (methods: ReadonlyArray<CacheableClientMethod>): Effect.Effect<void> =>
      Ref.update(cacheEpochs, (current) => {
        const next = { ...current }
        for (const method of methods) next[method] += 1
        return next
      })

    const invalidateCache = (selector: McpCacheSelector): Effect.Effect<void, McpClientError> =>
      cache === undefined ? Effect.void : cache.invalidate(selector) as Effect.Effect<void, McpClientError>

    const handleNotification = (notification: {
      readonly method: string
      readonly params?: unknown
    }): Effect.Effect<void, McpClientError> => Effect.gen(function*() {
      if (notification.method === "notifications/tools/list_changed") {
        const methods: ReadonlyArray<CacheableClientMethod> = ["tools/list", "server/discover"]
        yield* updateEpochs(methods)
        yield* invalidateCache({ namespace: cacheNamespace, methods })
      } else if (notification.method === "notifications/prompts/list_changed") {
        const methods: ReadonlyArray<CacheableClientMethod> = ["prompts/list", "server/discover"]
        yield* updateEpochs(methods)
        yield* invalidateCache({ namespace: cacheNamespace, methods })
      } else if (notification.method === "notifications/resources/list_changed") {
        const methods: ReadonlyArray<CacheableClientMethod> = [
          "resources/list", "resources/templates/list", "server/discover"
        ]
        yield* updateEpochs(methods)
        yield* invalidateCache({ namespace: cacheNamespace, methods })
      } else if (notification.method === "notifications/resources/updated") {
        const methods: ReadonlyArray<CacheableClientMethod> = ["resources/read"]
        yield* updateEpochs(methods)
        const params = isRecord(notification.params) ? notification.params : undefined
        const uri = params === undefined ? undefined : Object.getOwnPropertyDescriptor(params, "uri")
        if (uri !== undefined && "value" in uri && typeof uri.value === "string") {
          yield* invalidateCache({ namespace: cacheNamespace, methods, uri: uri.value })
        }
      }
      yield* dispatcher.dispatch(notification as never)
    })

    type CacheLookup =
      | { readonly _tag: "Hit"; readonly result: Readonly<Record<string, unknown>> }
      | { readonly _tag: "Miss" }
      | { readonly _tag: "Corrupt" }

    const selectorForKey = (key: McpCacheKey): McpCacheSelector => ({
      namespace: key.namespace,
      methods: [key.method],
      ...(key.method === "resources/read" && typeof key.params["uri"] === "string"
        ? { uri: key.params["uri"] as string }
        : {})
    })

    const readCacheKey = (
      key: McpCacheKey,
      expectedEpoch: number
    ): Effect.Effect<CacheLookup, McpClientError> => Effect.gen(function*() {
      if (cache === undefined) return { _tag: "Miss" }
      const rawOption = yield* cache.get(key) as Effect.Effect<Option.Option<McpCacheEntry>, McpClientError>
      const option = inspectCacheOption(rawOption)
      if (option?._tag === "None") return { _tag: "Miss" }
      if (option === undefined || option._tag !== "Some") {
        yield* invalidateCache(selectorForKey(key))
        return { _tag: "Corrupt" }
      }
      const entry = snapshotCacheEntry(option.value)
      const now = yield* Clock.currentTimeMillis
      if (entry === undefined || entry.cacheScope !== key.cacheScope ||
        now < entry.receivedAt || now >= entry.expiresAt) {
        yield* invalidateCache(selectorForKey(key))
        return { _tag: "Corrupt" }
      }
      const decoded = yield* decodeClientResult(key.method, entry.result).pipe(Effect.either)
      if (Either.isLeft(decoded) || ownResultType(decoded.right) !== "complete") {
        yield* invalidateCache(selectorForKey(key))
        return { _tag: "Corrupt" }
      }
      const copied = cloneStrictJson(entry.result)
      if (copied === invalidStrictJson || !isRecord(copied)) {
        yield* invalidateCache(selectorForKey(key))
        return { _tag: "Corrupt" }
      }
      if ((yield* Ref.get(cacheEpochs))[key.method] !== expectedEpoch) return { _tag: "Miss" }
      return { _tag: "Hit", result: Object.freeze(copied) }
    })

    const makeCacheKey = (
      method: CacheableClientMethod,
      params: Readonly<Record<string, unknown>>,
      capabilities: Readonly<Record<string, unknown>>,
      cacheScope: "public" | "private",
      authorizationPartition?: string
    ): McpCacheKey => Object.freeze({
      namespace: cacheNamespace,
      method,
      params,
      protocolVersion: LATEST_PROTOCOL_VERSION,
      capabilities,
      cacheScope,
      ...(authorizationPartition === undefined ? {} : { authorizationPartition })
    })

    const wireCacheResult = (
      method: CacheableClientMethod,
      value: unknown
    ): Effect.Effect<Readonly<Record<string, unknown>>, McpClientError> => Effect.try({
      try: () => {
        const encoded = Schema.encodeUnknownEither(
          CLIENT_REQUEST_RESULT_CODEC_BY_METHOD[method] as Schema.Schema.AnyNoContext
        )(value)
        if (Either.isLeft(encoded)) throw encoded.left
        const strict = cloneStrictJson(encoded.right)
        if (strict === invalidStrictJson || !isRecord(strict)) throw new TypeError("Invalid cache wire result")
        return Object.freeze(strict)
      },
      catch: (cause) => protocolValidationError(`Could not encode ${method} cache result`, cause)
    })

    // -- Request sender: injects per-request `_meta` then correlates --
    const sendRequest = (
      method: ClientRequestMethod,
      payload?: unknown,
      forceCacheRefresh = false
    ): Effect.Effect<unknown, McpClientError> =>
      Effect.gen(function* () {
        const id = yield* Ref.getAndUpdate(nextIdRef, (n) => n + 1)
        const methodCapabilities = yield* requestCapabilities({ id, method })
        const cacheable = cache !== undefined && isCacheableMethod(method)
        const cacheParams = cacheable ? canonicalCacheParams(payload) : undefined
        if (cacheable && cacheParams === undefined) {
          return yield* Effect.fail(cacheClientError("Could not construct MCP cache key"))
        }
        const startEpoch = cacheable ? (yield* Ref.get(cacheEpochs))[method] : undefined
        let authorizationPartition: string | undefined
        if (cacheable && !forceCacheRefresh) {
          const publicKey = makeCacheKey(method, cacheParams!, methodCapabilities, "public")
          const publicLookup = yield* readCacheKey(publicKey, startEpoch!)
          if (publicLookup._tag === "Hit") return publicLookup.result
          authorizationPartition = yield* cacheAuthorizationPartition()
          if (publicLookup._tag === "Miss" && authorizationPartition !== undefined) {
            const privateLookup = yield* readCacheKey(makeCacheKey(
              method, cacheParams!, methodCapabilities, "private", authorizationPartition
            ), startEpoch!)
            if (privateLookup._tag === "Hit") return privateLookup.result
          }
        } else if (cacheable) {
          authorizationPartition = yield* cacheAuthorizationPartition()
        }

        const base = (payload ?? {}) as Record<string, unknown>
        const existingMeta = (base["_meta"] ?? {}) as Record<string, unknown>
        const metadata: Record<string, unknown> = {
          ...existingMeta,
          [META_PROTOCOL_VERSION]: LATEST_PROTOCOL_VERSION,
          [META_CLIENT_CAPABILITIES]: methodCapabilities
        }
        if (clientInfo !== undefined) {
          metadata[META_CLIENT_INFO] = clientInfo
        }
        const withMeta = {
          ...base,
          _meta: metadata
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
            ? handleNotification(frame.notification)
            : Effect.void),
          Stream.runLast,
          Effect.mapError((cause) => cause instanceof McpClientError
            ? cause
            : new McpClientError({
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
        if (terminal.value._tag === "Success") {
          const result = terminal.value.response.result
          if (!cacheable) return result
          const decoded = yield* decodeClientResult(method, result)
          if (ownResultType(decoded) !== "complete") return result
          const record = decoded as unknown as Record<string, unknown>
          const ttlMs = record["ttlMs"]
          const cacheScope = record["cacheScope"]
          if (typeof ttlMs !== "number" || !Number.isSafeInteger(ttlMs) || ttlMs <= 0 ||
            (cacheScope !== "public" && cacheScope !== "private")) return result
          if (cacheScope === "private" && authorizationPartition === undefined) return result
          const currentEpoch = (yield* Ref.get(cacheEpochs))[method]
          if (currentEpoch !== startEpoch) return result
          const wire = yield* wireCacheResult(method, decoded)
          const receivedAt = yield* Clock.currentTimeMillis
          const expiresAt = ttlMs > Number.MAX_SAFE_INTEGER - receivedAt
            ? Number.MAX_SAFE_INTEGER
            : receivedAt + ttlMs
          const key = makeCacheKey(
            method, cacheParams!, methodCapabilities, cacheScope,
            cacheScope === "private" ? authorizationPartition : undefined
          )
          const entry: McpCacheEntry = Object.freeze({
            result: wire, receivedAt, expiresAt, cacheScope
          })
          yield* cache!.set(key, entry) as Effect.Effect<void, McpClientError>
          if ((yield* Ref.get(cacheEpochs))[method] !== startEpoch) {
            yield* invalidateCache(selectorForKey(key))
          }
          return wire
        }
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
        const decoded = Schema.decodeUnknownEither(codec)(normalized)
        const exact = Either.isRight(decoded) ? decoded : Schema.validateEither(codec)(normalized)
        if (Either.isLeft(exact)) return exact
        const encoded = Schema.encodeUnknownEither(codec)(exact.right)
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

    const runDiscover = (forceCacheRefresh: boolean): Effect.Effect<void, McpClientError> =>
      Effect.gen(function* () {
        const method = clientRequestMethod("DiscoverRequest")
        const result = yield* sendRequest(method, {}, forceCacheRefresh).pipe(
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
    yield* runDiscover(false)

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

      discover: () => runDiscover(true),

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

const protocolValidationError = (
  message: string,
  cause: unknown = new SchemaValidationError({ message })
): McpClientError => new McpClientError({
  reason: "Protocol",
  message,
  cause
})

const inspectProviderRecord = (
  value: unknown,
  label: string
): Effect.Effect<Record<string, unknown>, McpClientError> => Effect.try({
  try: () => {
    const inspected = cloneSchemaJson(value)
    if (inspected === invalidStrictJson || !isRecord(inspected)) {
      throw new SchemaValidationError({ message: `Expected canonical ${label}` })
    }
    return inspected
  },
  catch: (cause) => protocolValidationError(`Invalid ${label}`, cause)
})

const canonicalWireRecord = (
  schema: Schema.Schema.AnyNoContext,
  value: unknown,
  label: string
): Effect.Effect<Record<string, unknown>, McpClientError> => Effect.try({
  try: () => {
    const inspected = cloneSchemaJson(value)
    if (inspected === invalidStrictJson) {
      throw new SchemaValidationError({ message: `Could not inspect ${label}` })
    }
    const decoded = Schema.decodeUnknownEither(schema)(inspected)
    const exact = Either.isRight(decoded)
      ? decoded
      : Schema.validateEither(schema)(inspected)
    if (Either.isLeft(exact)) throw exact.left
    const encoded = Schema.encodeUnknownEither(schema)(exact.right)
    if (Either.isLeft(encoded)) throw encoded.left
    const canonical = cloneStrictJson(encoded.right)
    if (canonical === invalidStrictJson || !isRecord(canonical)) {
      throw new SchemaValidationError({ message: `Expected canonical JSON ${label}` })
    }
    return canonical
  },
  catch: (cause) => protocolValidationError(`Invalid ${label}`, cause)
})

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value) && !ArrayBuffer.isView(value)

const utf8Length = (value: string): number => {
  let length = 0
  for (let index = 0; index < value.length; index++) {
    const code = value.charCodeAt(index)
    if (code <= 0x7f) length += 1
    else if (code <= 0x7ff) length += 2
    else if (code >= 0xd800 && code <= 0xdbff && index + 1 < value.length &&
      value.charCodeAt(index + 1) >= 0xdc00 && value.charCodeAt(index + 1) <= 0xdfff) {
      length += 4
      index += 1
    } else length += 3
  }
  return length
}

const validateOpaqueCacheString = (value: unknown, label: string): string => {
  if (typeof value !== "string" || value.length === 0 || utf8Length(value) > 256) {
    throw new TypeError(`${label} must be a nonempty string of at most 256 UTF-8 bytes`)
  }
  return value
}

const dataMethod = (target: unknown, name: string): ((...args: ReadonlyArray<unknown>) => unknown) => {
  if ((typeof target !== "object" && typeof target !== "function") || target === null) {
    throw new TypeError("Cache service must be an object")
  }
  let current: object | null = target
  const seen = new Set<object>()
  while (current !== null && !seen.has(current)) {
    seen.add(current)
    const descriptor = Object.getOwnPropertyDescriptor(current, name)
    if (descriptor !== undefined) {
      if (!("value" in descriptor) || typeof descriptor.value !== "function") {
        throw new TypeError(`Cache ${name} must be a data function`)
      }
      return descriptor.value as (...args: ReadonlyArray<unknown>) => unknown
    }
    current = Object.getPrototypeOf(current)
  }
  throw new TypeError(`Cache ${name} must be a data function`)
}

const cacheClientError = (message: string, originalCause?: Cause.Cause<unknown>): McpClientError => {
  const cacheError = new McpCacheError({
    message,
    ...(originalCause === undefined ? {} : { cause: originalCause })
  })
  if (originalCause !== undefined) {
    Object.defineProperty(cacheError, "cause", {
      configurable: true,
      enumerable: false,
      value: originalCause,
      writable: false
    })
  }
  return new McpClientError({ reason: "Cache", message, cause: cacheError })
}

const mapCacheCause = <E>(
  cause: Cause.Cause<E>,
  message: string
): Cause.Cause<McpClientError> => {
  const mapped = new Map<Cause.Cause<E>, Cause.Cause<McpClientError>>()
  const pending: Array<{ readonly cause: Cause.Cause<E>; readonly expanded: boolean }> = [
    { cause, expanded: false }
  ]
  while (pending.length > 0) {
    const frame = pending.pop()!
    const current = frame.cause
    if (mapped.has(current)) continue
    switch (current._tag) {
      case "Empty": mapped.set(current, Cause.empty); break
      case "Fail": mapped.set(current, Cause.fail(cacheClientError(message, cause))); break
      case "Die": mapped.set(current, Cause.fail(cacheClientError(message, cause))); break
      case "Interrupt": mapped.set(current, Cause.interrupt(current.fiberId)); break
      case "Sequential":
      case "Parallel":
        if (!frame.expanded) {
          pending.push({ cause: current, expanded: true })
          if (!mapped.has(current.right)) pending.push({ cause: current.right, expanded: false })
          if (!mapped.has(current.left)) pending.push({ cause: current.left, expanded: false })
        } else {
          mapped.set(current, current._tag === "Sequential"
            ? Cause.sequential(mapped.get(current.left)!, mapped.get(current.right)!)
            : Cause.parallel(mapped.get(current.left)!, mapped.get(current.right)!))
        }
        break
    }
  }
  return mapped.get(cause)!
}

const containCacheCallback = <A>(
  thunk: () => unknown,
  context: Context.Context<never>,
  message: string
): Effect.Effect<A, McpClientError> => Effect.suspend(() => {
  const result = thunk()
  return Effect.isEffect(result)
    ? (result as Effect.Effect<A, unknown, never>).pipe(Effect.provide(context))
    : Effect.die(new TypeError("Cache callback must return an Effect"))
}).pipe(Effect.catchAllCause((cause) => Effect.failCause(mapCacheCause(cause, message))))

const snapshotCacheService = (
  value: unknown,
  context: Context.Context<never>
): McpCacheService => {
  const get = dataMethod(value, "get")
  const set = dataMethod(value, "set")
  const invalidate = dataMethod(value, "invalidate")
  return Object.freeze({
    get: (key: McpCacheKey) => containCacheCallback<Option.Option<McpCacheEntry>>(
      () => Reflect.apply(get, value, [key]), context, "MCP cache get failed"),
    set: (key: McpCacheKey, entry: McpCacheEntry) => containCacheCallback<void>(
      () => Reflect.apply(set, value, [key, entry]), context, "MCP cache set failed"),
    invalidate: (selector: McpCacheSelector) => containCacheCallback<void>(
      () => Reflect.apply(invalidate, value, [selector]), context, "MCP cache invalidation failed")
  })
}

const inspectAuthorization = (value: unknown): string | undefined => {
  if ((typeof value !== "object" && typeof value !== "function") || value === null) {
    throw new TypeError("Invalid cache authorization")
  }
  const tagDescriptor = Object.getOwnPropertyDescriptor(value, "_tag")
  if (tagDescriptor === undefined || !("value" in tagDescriptor)) throw new TypeError("Invalid cache authorization")
  if (tagDescriptor.value === "Anonymous") return "mcp:anonymous"
  if (tagDescriptor.value === "AuthorizedUnpartitioned") return undefined
  if (tagDescriptor.value === "Authorized") {
    const partitionDescriptor = Object.getOwnPropertyDescriptor(value, "partition")
    if (partitionDescriptor === undefined || !("value" in partitionDescriptor)) {
      throw new TypeError("Invalid cache authorization")
    }
    return `mcp:authorized:${validateOpaqueCacheString(partitionDescriptor.value, "cache partition")}`
  }
  throw new TypeError("Invalid cache authorization")
}

const inspectCacheOption = (value: unknown): { readonly _tag: "None" } | {
  readonly _tag: "Some"
  readonly value: unknown
} | undefined => {
  try {
    if ((typeof value !== "object" && typeof value !== "function") || value === null) return undefined
    const find = (name: string): { readonly found: boolean; readonly value?: unknown } => {
      let current: object | null = value
      const seen = new Set<object>()
      while (current !== null && !seen.has(current)) {
        seen.add(current)
        const descriptor = Object.getOwnPropertyDescriptor(current, name)
        if (descriptor !== undefined) {
          return "value" in descriptor ? { found: true, value: descriptor.value } : { found: false }
        }
        current = Object.getPrototypeOf(current)
      }
      return { found: false }
    }
    const tag = find("_tag")
    if (!tag.found) return undefined
    if (tag.value === "None") return { _tag: "None" }
    if (tag.value !== "Some") return undefined
    const entry = find("value")
    return entry.found ? { _tag: "Some", value: entry.value } : undefined
  } catch {
    return undefined
  }
}

const snapshotCacheEntry = (value: unknown): McpCacheEntry | undefined => {
  try {
    if ((typeof value !== "object" && typeof value !== "function") || value === null) return undefined
    const descriptors = Object.getOwnPropertyDescriptors(value)
    const field = (name: string): unknown => {
      const descriptor = descriptors[name]
      return descriptor !== undefined && "value" in descriptor ? descriptor.value : undefined
    }
    const result = cloneStrictJson(field("result"))
    const receivedAt = field("receivedAt")
    const expiresAt = field("expiresAt")
    const cacheScope = field("cacheScope")
    if (result === invalidStrictJson || !isRecord(result) ||
      typeof receivedAt !== "number" || !Number.isSafeInteger(receivedAt) || receivedAt < 0 ||
      typeof expiresAt !== "number" || !Number.isSafeInteger(expiresAt) || expiresAt < 0 ||
      (cacheScope !== "public" && cacheScope !== "private")) return undefined
    return Object.freeze({ result: Object.freeze(result), receivedAt, expiresAt, cacheScope })
  } catch {
    return undefined
  }
}

const canonicalCacheParams = (value: unknown): Readonly<Record<string, unknown>> | undefined => {
  try {
    if (value === undefined) return Object.freeze({})
    if (!isRecord(value)) return undefined
    const copied: Record<string, unknown> = {}
    const descriptors = Object.getOwnPropertyDescriptors(value)
    for (const [name, descriptor] of Object.entries(descriptors)) {
      if (name === "_meta" || !descriptor.enumerable) continue
      if (!("value" in descriptor)) return undefined
      Object.defineProperty(copied, name, {
        configurable: true, enumerable: true, writable: true, value: descriptor.value
      })
    }
    const strict = cloneStrictJson(copied)
    return strict === invalidStrictJson || !isRecord(strict) ? undefined : Object.freeze(strict)
  } catch {
    return undefined
  }
}
