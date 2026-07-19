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
import type { ClientFrame } from "./McpDispatcher.js"
import type { JsonRpcId, JsonRpcRequest } from "./McpWire.js"
import { makeInboundDispatcher } from "./McpNotifications.js"
import type { InboundDispatcher } from "./McpNotifications.js"
import type {
  CallToolResult,
  ClientCapabilities,
  CompleteResult,
  GetPromptResult,
  Implementation,
  InputResponses,
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
  ProgressNotificationParams,
  ProgressToken,
  CreateMessageRequest,
  CreateMessageResult,
  ElicitRequest,
  ElicitResult,
  InputRequest,
  ListRootsRequest,
  ListRootsResult
} from "./generated/mcp/2026-07-28/McpSchema.generated.js"
import {
  InputRequiredError,
  InputRequiredPolicy,
  type AutomaticInputRequiredPolicy,
  type InputRequiredHandlerContext,
  type InputRequiredMode,
  type ManualInputRequiredPolicy
} from "./InputRequired.js"

export {
  InputRequiredError,
  InputRequiredPolicy,
  type AutomaticInputRequiredPolicy,
  type ElicitationInputHandlers,
  type InputRequiredErrorReason,
  type InputRequiredHandlerContext,
  type InputRequiredMode,
  type InputRequiredPolicy as InputRequiredPolicyType,
  type ManualInputRequiredPolicy,
  type RootsInputHandler,
  type SamplingInputHandler
} from "./InputRequired.js"
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

interface NormalizedClientRequestOptions {
  readonly progress?: {
    readonly token: typeof ProgressToken.Type
    readonly onProgress?: ProgressHandler
  }
}

interface NormalizedAutomaticInputRequiredPolicy {
  readonly mode: "automatic"
  readonly maxRounds: number
  readonly maxRequestsPerRound: number
  readonly maxConcurrency: number
  readonly sampling?: AutomaticInputRequiredPolicy<unknown>["sampling"]
  readonly roots?: AutomaticInputRequiredPolicy<unknown>["roots"]
  readonly elicitation?: AutomaticInputRequiredPolicy<unknown>["elicitation"]
}

type NormalizedInputRequiredPolicy =
  | NormalizedAutomaticInputRequiredPolicy
  | ManualInputRequiredPolicy

interface ActiveProgressTokens {
  readonly strings: ReadonlySet<string>
  readonly numbers: ReadonlySet<number>
}

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
  CacheAuthorizationRequirements = never,
  InputRequiredRequirements = never,
  Mode extends InputRequiredMode = "automatic"
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
  readonly inputRequired?: Mode extends "manual"
    ? ManualInputRequiredPolicy
    : AutomaticInputRequiredPolicy<InputRequiredRequirements>
}

export interface InputRequiredContinuation {
  readonly inputResponses?: InputResponses
  readonly requestState?: string
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

export type ProgressHandler = (
  progress: typeof ProgressNotificationParams.Type
) => Effect.Effect<void, unknown>

export interface ClientProgressOptions {
  readonly token: typeof ProgressToken.Type
  readonly onProgress?: ProgressHandler
}

export interface ClientRequestOptions {
  readonly progress?: ClientProgressOptions
}

// ---------------------------------------------------------------------------
// McpClient interface
// ---------------------------------------------------------------------------

export interface McpClient<Mode extends InputRequiredMode = "automatic"> {
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
  readonly discover: (options?: ClientRequestOptions) => Effect.Effect<void, McpClientError>

  readonly listTools: (params?: {
    readonly cursor?: string
  }, options?: ClientRequestOptions) => Effect.Effect<ListToolsResult, McpClientError>
  readonly callTool: (params: {
    readonly name: string
    readonly arguments: Record<string, unknown>
  } & InputRequiredContinuation, options?: ClientRequestOptions) => Effect.Effect<
    Mode extends "manual" ? CallToolResult | InputRequiredResult : CallToolResult,
    McpClientError
  >

  readonly listResources: (params?: {
    readonly cursor?: string
  }, options?: ClientRequestOptions) => Effect.Effect<ListResourcesResult, McpClientError>
  readonly listResourceTemplates: (params?: {
    readonly cursor?: string
  }, options?: ClientRequestOptions) => Effect.Effect<
    ListResourceTemplatesResult,
    McpClientError
  >
  readonly readResource: (params: {
    readonly uri: string
  } & InputRequiredContinuation, options?: ClientRequestOptions) => Effect.Effect<
    Mode extends "manual" ? ReadResourceResult | InputRequiredResult : ReadResourceResult,
    McpClientError
  >

  readonly listPrompts: (params?: {
    readonly cursor?: string
  }, options?: ClientRequestOptions) => Effect.Effect<ListPromptsResult, McpClientError>
  readonly getPrompt: (params: {
    readonly name: string
    readonly arguments?: Record<string, string>
  } & InputRequiredContinuation, options?: ClientRequestOptions) => Effect.Effect<
    Mode extends "manual" ? GetPromptResult | InputRequiredResult : GetPromptResult,
    McpClientError
  >

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
  }, options?: ClientRequestOptions) => Effect.Effect<CompleteResult, McpClientError>

  /**
   * Open a `subscriptions/listen` request. Replaces the legacy GET/SSE channel
   * and `resources/subscribe`. This Effect remains active for the lifetime of
   * the subscription while acknowledgements and selected notifications are
   * delivered through `notifications`. Callers own that lifetime and should
   * fork it in a scope when they need to perform other requests concurrently.
   */
  readonly subscriptionsListen: (
    filter?: SubscriptionFilter,
    options?: ClientRequestOptions
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
export const make = <
  TE,
  CE = never,
  CR = never,
  EE = never,
  ER = never,
  CAE = never,
  CAR = never,
  IR = never,
  Mode extends InputRequiredMode = "automatic"
>(
  options: McpClientOptions<TE, CE, CR, EE, ER, CAE, CAR, IR, Mode>
): Effect.Effect<McpClient<Mode>, McpClientError, Scope.Scope | CR | ER | CAR | IR> =>
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
    const inputRequiredInput = snapshot["inputRequired"]
    const nextIdRef = yield* Ref.make(1)
    const activeProgressTokens = yield* Ref.make<ActiveProgressTokens>({
      strings: new Set(),
      numbers: new Set()
    })
    const dispatcher = yield* makeInboundDispatcher()
    const providerContext = yield* Effect.context<CR | ER | CAR | IR>()
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
    const inputRequiredPolicy = yield* normalizeInputRequiredPolicy(inputRequiredInput)

    const reserveProgress = (
      progress: NonNullable<NormalizedClientRequestOptions["progress"]>
    ): Effect.Effect<void, McpClientError> => Ref.modify(activeProgressTokens, (current) => {
      const active = typeof progress.token === "string"
        ? current.strings.has(progress.token)
        : current.numbers.has(progress.token)
      if (active) return [false, current] as const
      if (typeof progress.token === "string") {
        return [true, {
          strings: new Set(current.strings).add(progress.token),
          numbers: current.numbers
        }] as const
      }
      return [true, {
        strings: current.strings,
        numbers: new Set(current.numbers).add(progress.token)
      }] as const
    }).pipe(Effect.flatMap((reserved) => reserved
      ? Effect.void
      : Effect.fail(protocolValidationError("Progress token is already active"))))

    const releaseProgress = (
      progress: NonNullable<NormalizedClientRequestOptions["progress"]>
    ): Effect.Effect<void> => Ref.update(activeProgressTokens, (current) => {
      if (typeof progress.token === "string") {
        const strings = new Set(current.strings)
        strings.delete(progress.token)
        return { strings, numbers: current.numbers }
      }
      const numbers = new Set(current.numbers)
      numbers.delete(progress.token)
      return { strings: current.strings, numbers }
    })

    const withProgressReservation = <A>(
      options: NormalizedClientRequestOptions,
      effect: Effect.Effect<A, McpClientError>
    ): Effect.Effect<A, McpClientError> => options.progress === undefined
      ? effect
      : Effect.acquireUseRelease(
          reserveProgress(options.progress),
          () => effect,
          () => releaseProgress(options.progress!)
        )

    const clientInfo = clientInfoInput === undefined
      ? undefined
      : yield* canonicalWireRecord(
          ImplementationSchema,
          clientInfoInput,
          "client info"
        )

    const inferredCapabilities = (): Record<string, unknown> =>
      inputRequiredPolicy.mode === "manual"
        ? {}
        : inputRequiredCapabilities(inputRequiredPolicy)

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
      if (inputRequiredPolicy.mode === "automatic") {
        const owned = inputRequiredCapabilities(inputRequiredPolicy)
        for (const name of ["sampling", "roots", "elicitation"] as const) {
          if (!Object.hasOwn(core, name)) continue
          if (!strictJsonEqual(core[name], owned[name])) {
            return yield* Effect.fail(protocolValidationError(
              `Client capabilities provider conflicts with input-required policy for ${name}`
            ))
          }
          delete core[name]
        }
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
      forceCacheRefresh = false,
      requestOptions: NormalizedClientRequestOptions = {}
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
        if (requestOptions.progress !== undefined) {
          metadata["progressToken"] = requestOptions.progress.token
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
        type Terminal = Exclude<ClientFrame, { readonly _tag: "Notification" }>
        const terminal = yield* transport.request(request).pipe(
          Stream.runFoldEffect(Option.none<Terminal>(), (current, frame) => {
            if (Option.isSome(current)) {
              return Effect.fail(protocolValidationError("Received a frame after the terminal response"))
            }
            if (frame._tag !== "Notification") return Effect.succeed(Option.some(frame))
            if (frame.notification.method !== "notifications/progress") {
              return handleNotification(frame.notification).pipe(Effect.as(Option.none<Terminal>()))
            }
            if (requestOptions.progress === undefined) {
              return Effect.fail(protocolValidationError("Received unexpected request progress"))
            }
            return decodeProgressNotification(frame.notification.params).pipe(
              Effect.flatMap((progress) => exactProgressToken(
                progress.progressToken,
                requestOptions.progress!.token
              ) ? Effect.succeed(progress) : Effect.fail(protocolValidationError(
                "Progress token does not own this request"
              ))),
              Effect.tap((progress) => requestOptions.progress!.onProgress === undefined
                ? Effect.void
                : containProgressCallback(
                    () => requestOptions.progress!.onProgress!(progress),
                    "Progress callback failed"
                  )),
              Effect.tap((progress) => handleNotification({
                ...frame.notification,
                params: progress
              })),
              Effect.as(Option.none<Terminal>())
            )
          }),
          Effect.catchAllCause((cause) => Effect.failCause(mapTransportCause(
            restoreProgressCallbackCause(cause)
          )))
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
          // The generated open-record decoder validates the envelope, but an
          // ordinary object cannot retain an own `__proto__` map key when the
          // generated record transform materializes it. Validate every entry
          // with the generated union and return the already-snapshotted wire
          // value so exact server-assigned keys remain intact.
          const entries = inputRequestEntries((normalized as Record<string, unknown>)["inputRequests"])
          if (entries === invalidInputRequestEntries) {
            return yield* Effect.fail(new McpClientError({
              reason: "Protocol",
              message: `Invalid ${method} input_required result`,
              cause: new SchemaValidationError({ message: "Invalid inputRequests map" })
            }))
          }
          for (const [, raw] of entries) {
            const request = Schema.decodeUnknownEither(InputRequest)(raw)
            if (Either.isLeft(request)) {
              return yield* Effect.fail(new McpClientError({
                reason: "Protocol",
                message: `Invalid ${method} input_required result`,
                cause: request.left
              }))
            }
          }
          return normalized as ClientResultForMethod<Method>
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

    const inputRequiredClientError = (
      reason: ConstructorParameters<typeof InputRequiredError>[0]["reason"],
      method: ClientRequestMethod,
      message: string,
      key?: string,
      cause?: unknown
    ): McpClientError => {
      const inputError = new InputRequiredError({
        reason, method, message,
        ...(key === undefined ? {} : { key }),
        ...(cause === undefined ? {} : { cause })
      })
      if (cause !== undefined) Object.defineProperty(inputError, "cause", {
        configurable: true, enumerable: false, value: cause, writable: false
      })
      return new McpClientError({
        reason: "InputRequired",
        message,
        cause: inputError
      })
    }

    const failInputRequired = (
      reason: ConstructorParameters<typeof InputRequiredError>[0]["reason"],
      method: ClientRequestMethod,
      message: string,
      key?: string,
      cause?: unknown
    ): Effect.Effect<never, McpClientError> => Effect.fail(inputRequiredClientError(
      reason, method, message, key, cause
    ))

    const mapInputHandlerCause = <E>(
      cause: Cause.Cause<E>,
      method: ClientRequestMethod,
      key: string,
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
          case "Fail":
          case "Die":
            mapped.set(current, Cause.fail(inputRequiredClientError(
              "InvalidInputResponse", method, message, key, cause
            )))
            break
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

    const encodeInputResponse = (
      codec: Schema.Schema.AnyNoContext,
      value: unknown,
      method: ClientRequestMethod,
      key: string
    ): Effect.Effect<unknown, McpClientError> => Effect.gen(function*() {
      const encoded = yield* Effect.sync(() => Schema.encodeUnknownEither(codec)(value)).pipe(
        Effect.catchAllCause((cause) => failInputRequired(
          "InvalidInputResponse", method,
          "Input response encoder failed", key, cause
        ))
      )
      if (Either.isLeft(encoded)) {
        return yield* failInputRequired(
          "InvalidInputResponse", method,
          "Input handler returned an invalid generated response", key, encoded.left
        )
      }
      const strict = yield* Effect.sync(() => cloneStrictJson(encoded.right)).pipe(
        Effect.catchAllCause((cause) => failInputRequired(
          "InvalidInputResponse", method,
          "Input response snapshot failed", key, cause
        ))
      )
      if (strict === invalidStrictJson) {
        return yield* failInputRequired(
          "InvalidInputResponse", method,
          "Input handler returned a non-canonical response", key
        )
      }
      return strict
    })

    const fromInputHandler = <A>(
      thunk: () => unknown,
      method: ClientRequestMethod,
      key: string,
      label: string
    ): Effect.Effect<A, McpClientError> => Effect.suspend(() => {
      const result = thunk()
      return Effect.isEffect(result)
        ? result as Effect.Effect<A, unknown, IR>
        : Effect.die(new TypeError(`${label} must return an Effect`))
    }).pipe(
      Effect.provide(providerContext as Context.Context<IR>),
      Effect.catchAllCause((cause) => Effect.failCause(mapInputHandlerCause(
        cause, method, key, `${label} failed`
      )))
    )

    const resolveInputRequest = (
      parentMethod: ClientRequestMethod,
      key: string,
      inputRequest: unknown,
      round: number,
      policy: NormalizedAutomaticInputRequiredPolicy
    ): Effect.Effect<unknown, McpClientError> => Effect.gen(function*() {
      const decoded = yield* decodeInputRequest(inputRequest).pipe(
        Effect.mapError((cause) => new McpClientError({
          reason: "InputRequired",
          message: "Invalid MRTR input request",
          cause: new InputRequiredError({
            reason: "InvalidInputRequest",
            method: parentMethod,
            key,
            message: "Invalid MRTR input request",
            cause
          })
        })))
      const context: InputRequiredHandlerContext = Object.freeze({
        parentMethod: parentMethod as InputRequiredHandlerContext["parentMethod"],
        key,
        round
      })
      switch (decoded.method) {
        case "sampling/createMessage": {
          if (policy.sampling === undefined) {
            return yield* failInputRequired(
              "MissingHandler", parentMethod,
              "Sampling input was not enabled by the input-required policy", key
            )
          }
          if ((decoded.params.tools !== undefined || decoded.params.toolChoice !== undefined) &&
            policy.sampling.tools !== true) {
            return yield* failInputRequired(
              "CapabilityMismatch", parentMethod,
              "Sampling tools were not enabled by the input-required policy", key
            )
          }
          if (decoded.params.includeContext !== undefined && decoded.params.includeContext !== "none" &&
            policy.sampling.context !== true) {
            return yield* failInputRequired(
              "CapabilityMismatch", parentMethod,
              "Sampling context was not enabled by the input-required policy", key
            )
          }
          const response = yield* fromInputHandler(
            () => policy.sampling!.handle(decoded.params, context),
            parentMethod, key, "Sampling input handler"
          )
          return yield* encodeInputResponse(CreateMessageResult, response, parentMethod, key)
        }
        case "roots/list": {
          if (policy.roots === undefined) {
            return yield* failInputRequired(
              "MissingHandler", parentMethod,
              "Roots input was not enabled by the input-required policy", key
            )
          }
          const response = yield* fromInputHandler(
            () => typeof policy.roots!.list === "function"
              ? policy.roots!.list(context)
              : policy.roots!.list,
            parentMethod, key, "Roots input handler"
          )
          return yield* encodeInputResponse(ListRootsResult, response, parentMethod, key)
        }
        case "elicitation/create": {
          const mode = decoded.params.mode === "url" ? "url" : "form"
          const handler = mode === "url" ? policy.elicitation?.url : policy.elicitation?.form
          if (handler === undefined) {
            return yield* failInputRequired(
              "MissingHandler", parentMethod,
              mode === "url"
                ? "URL elicitation is denied unless an explicit URL handler is configured"
                : "Form elicitation was not enabled by the input-required policy",
              key
            )
          }
          const response = yield* fromInputHandler(
            () => handler(decoded.params as never, context),
            parentMethod, key, `${mode === "url" ? "URL" : "Form"} elicitation handler`
          )
          const encoded = yield* encodeInputResponse(ElicitResult, response, parentMethod, key)
          if (mode === "url" && isRecord(encoded) && Object.hasOwn(encoded, "content")) {
            return yield* failInputRequired(
              "InvalidInputResponse", parentMethod,
              "URL elicitation responses must omit content", key
            )
          }
          if (mode === "form" && isRecord(encoded) && encoded["action"] === "accept" &&
            !validElicitationContent(decoded.params.requestedSchema, encoded["content"])) {
            return yield* failInputRequired(
              "InvalidInputResponse", parentMethod,
              "Form elicitation response does not satisfy requestedSchema", key
            )
          }
          return encoded
        }
      }
    })

    // Send `method` with `payload`, then run the bounded MRTR loop. On an
    // exactly decoded `complete` result the value is returned; on
    // `input_required` the input requests are resolved and the ORIGINAL method
    // is re-sent with the accumulated `inputResponses` + latest `requestState`.
    const sendWithMrtr = (
      method: ClientRequestMethod,
      payload: unknown,
      requestOptions: NormalizedClientRequestOptions
    ): Effect.Effect<unknown, McpClientError> => Effect.gen(function*() {
      const original = yield* snapshotMrtrPayload(payload)
      const base = withoutContinuation(original)
      const loop = (
        currentPayload: Readonly<Record<string, unknown>>,
        round: number
      ): Effect.Effect<unknown, McpClientError> =>
        sendRequest(method, currentPayload, false, requestOptions).pipe(
          Effect.flatMap((value) => decodeClientResult(method, value)),
          Effect.flatMap((value) => {
            const record = (value ?? {}) as Record<string, unknown>
            const resultType = record["resultType"] as string

            if (resultType !== "input_required") {
              return Effect.succeed(value)
            }

            if (inputRequiredPolicy.mode === "manual") return Effect.succeed(value)

            if (!INPUT_REQUIRED_CLIENT_METHODS.has(method)) {
              return failInputRequired(
                "InvalidInputRequest", method,
                `input_required is not permitted for ${method}`
              )
            }
            if (round >= inputRequiredPolicy.maxRounds) {
              return failInputRequired("RoundLimit", method, "MRTR exceeded max rounds")
            }
            const inputRequests = record["inputRequests"]
            const requestState = record["requestState"]
            const entries = inputRequestEntries(inputRequests)
            if (entries === invalidInputRequestEntries) {
              return failInputRequired(
                "InvalidInputRequest", method,
                "MRTR inputRequests must contain exact own data properties"
              )
            }
            if (entries.length > inputRequiredPolicy.maxRequestsPerRound) {
              return failInputRequired(
                "Overloaded", method,
                "MRTR input request count exceeds the configured bound"
              )
            }
            return Effect.forEach(
              entries,
              ([key, inputRequest]) =>
                resolveInputRequest(method, key, inputRequest, round + 1, inputRequiredPolicy).pipe(
                  Effect.map((response) => [key, response] as const)
                ),
              { concurrency: inputRequiredPolicy.maxConcurrency }
            ).pipe(
              Effect.flatMap((resolved) => {
                const inputResponses: Record<string, unknown> = Object.create(null)
                for (const [key, response] of resolved) {
                  defineOwnData(inputResponses, key, response)
                }
                const nextPayload = continuationPayload(
                  base,
                  resolved.length === 0 ? undefined : inputResponses,
                  requestState
                )
                return loop(nextPayload, round + 1)
              })
            )
          })
        )

      return yield* loop(original, 0)
    })

    // -- Capability map + discovery state --
    const capsRef = yield* Ref.make<typeof ServerCapabilities.Type>(
      Schema.decodeUnknownSync(ServerCapabilities)({}) as typeof ServerCapabilities.Type
    )
    const infoRef = yield* Ref.make<Option.Option<Implementation>>(Option.none())
    const instructionsRef = yield* Ref.make(Option.none<string>())
    const versionsRef = yield* Ref.make<ReadonlyArray<string>>([])

    const runDiscover = (
      forceCacheRefresh: boolean,
      requestOptions: NormalizedClientRequestOptions = {}
    ): Effect.Effect<void, McpClientError> =>
      Effect.gen(function* () {
        const method = clientRequestMethod("DiscoverRequest")
        const result = yield* sendRequest(method, {}, forceCacheRefresh, requestOptions).pipe(
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
      payload?: unknown,
      requestOptions?: ClientRequestOptions
    ): Effect.Effect<A, McpClientError> => {
      const method = clientRequestMethod(type)
      const capability = CLIENT_REQUEST_CAPABILITY_BY_TYPE[type]
      return normalizeClientRequestOptions(requestOptions).pipe(
        Effect.flatMap((normalized) => {
          // Drive the request through the MRTR loop so `input_required` results are
          // satisfied and retried transparently. See docs/draft-2026-07-28-migration.md.
          const send = sendWithMrtr(method, payload, normalized)
          const effect = capability === undefined
            ? send
            : requireCap(capability).pipe(Effect.andThen(send))
          return withProgressReservation(normalized, effect)
        }),
        Effect.map((v) => v as A)
      )
    }

    // -- Build client --
    const client: McpClient<Mode> = {
      serverCapabilities: Ref.get(capsRef),
      serverInfo: Ref.get(infoRef),
      instructions: Ref.get(instructionsRef),
      supportedVersions: Ref.get(versionsRef),
      notifications: dispatcher,

      discover: (options) => normalizeClientRequestOptions(options).pipe(
        Effect.flatMap((normalized) => withProgressReservation(
          normalized,
          runDiscover(true, normalized)
        ))
      ),

      listTools: (p, options) => request("ListToolsRequest", p, options),
      callTool: (p, options) => request("CallToolRequest", p, options),

      listResources: (p, options) => request("ListResourcesRequest", p, options),
      listResourceTemplates: (p, options) =>
        request("ListResourceTemplatesRequest", p, options),
      readResource: (p, options) => request("ReadResourceRequest", p, options),

      listPrompts: (p, options) => request("ListPromptsRequest", p, options),
      getPrompt: (p, options) => request("GetPromptRequest", p, options),

      complete: (p, options) => request("CompleteRequest", p, options),

      subscriptionsListen: (filter, options) =>
        request("SubscriptionsListenRequest", { notifications: filter ?? {} }, options)
    }

    return client
  })

const invalidInputRequestEntries = Symbol("InvalidInputRequestEntries")

const defineOwnData = (
  target: Record<string, unknown>,
  key: string,
  value: unknown
): void => {
  Object.defineProperty(target, key, {
    configurable: true,
    enumerable: true,
    value,
    writable: true
  })
}

const normalizeInputRequiredPolicy = (
  value: unknown
): Effect.Effect<NormalizedInputRequiredPolicy, McpClientError> => Effect.try({
  try: () => {
    if (value === undefined) return Object.freeze({
      mode: "automatic" as const,
      maxRounds: 10,
      maxRequestsPerRound: 32,
      maxConcurrency: 4
    })
    if ((typeof value !== "object" && typeof value !== "function") || value === null) {
      throw new TypeError("Input-required policy must be an object")
    }
    const descriptors = Object.getOwnPropertyDescriptors(value)
    const keys = Reflect.ownKeys(value)
    if (keys.some((key) => typeof key !== "string")) {
      throw new TypeError("Input-required policy keys must be strings")
    }
    const data = (name: string): unknown => {
      const descriptor = descriptors[name]
      if (descriptor === undefined) return undefined
      if (!("value" in descriptor) || !descriptor.enumerable) {
        throw new TypeError(`Input-required ${name} must be an enumerable data property`)
      }
      return descriptor.value
    }
    const mode = data("mode")
    if (mode === "manual") {
      if (keys.some((key) => key !== "mode")) throw new TypeError("Manual policy accepts only mode")
      return InputRequiredPolicy.manual
    }
    if (mode !== "automatic") throw new TypeError("Invalid input-required policy mode")
    const allowed = new Set(["mode", "maxRounds", "maxRequestsPerRound", "maxConcurrency", "sampling", "roots", "elicitation"])
    for (const key of keys as string[]) if (!allowed.has(key)) {
      throw new TypeError(`Unknown input-required policy property: ${key}`)
    }
    const bounded = (name: string, fallback: number, hard: number): number => {
      const candidate = data(name)
      if (candidate === undefined) return fallback
      if (typeof candidate !== "number" || !Number.isSafeInteger(candidate) || candidate < 1 || candidate > hard) {
        throw new TypeError(`Input-required ${name} must be an integer between 1 and ${hard}`)
      }
      return candidate
    }
    const sampling = inspectSamplingHandler(data("sampling"))
    const roots = inspectRootsHandler(data("roots"))
    const elicitation = inspectElicitationHandlers(data("elicitation"))
    return Object.freeze({
      mode: "automatic" as const,
      maxRounds: bounded("maxRounds", 10, 10),
      maxRequestsPerRound: bounded("maxRequestsPerRound", 32, 32),
      maxConcurrency: bounded("maxConcurrency", 4, 4),
      ...(sampling === undefined ? {} : { sampling }),
      ...(roots === undefined ? {} : { roots }),
      ...(elicitation === undefined ? {} : { elicitation })
    })
  },
  catch: (cause) => protocolValidationError("Invalid input-required policy", cause)
})

const inspectPolicyObject = (
  value: unknown,
  label: string,
  allowed: ReadonlySet<string>
): Readonly<Record<string, unknown>> | undefined => {
  if (value === undefined) return undefined
  if ((typeof value !== "object" && typeof value !== "function") || value === null) {
    throw new TypeError(`${label} must be an object`)
  }
  const keys = Reflect.ownKeys(value)
  if (keys.some((key) => typeof key !== "string" || !allowed.has(key))) {
    throw new TypeError(`Invalid ${label} property`)
  }
  const descriptors = Object.getOwnPropertyDescriptors(value)
  const result: Record<string, unknown> = Object.create(null)
  for (const key of keys as string[]) {
    const descriptor = descriptors[key]
    if (descriptor === undefined || !("value" in descriptor) || !descriptor.enumerable) {
      throw new TypeError(`${label}.${key} must be an enumerable data property`)
    }
    defineOwnData(result, key, descriptor.value)
  }
  return Object.freeze(result)
}

const inspectSamplingHandler = (value: unknown): NonNullable<NormalizedAutomaticInputRequiredPolicy["sampling"]> | undefined => {
  const record = inspectPolicyObject(value, "sampling handler", new Set(["handle", "context", "tools"]))
  if (record === undefined) return undefined
  if (typeof record["handle"] !== "function") throw new TypeError("Sampling handle must be a function")
  if (record["context"] !== undefined && typeof record["context"] !== "boolean") throw new TypeError("Sampling context must be boolean")
  if (record["tools"] !== undefined && typeof record["tools"] !== "boolean") throw new TypeError("Sampling tools must be boolean")
  return record as unknown as NonNullable<NormalizedAutomaticInputRequiredPolicy["sampling"]>
}

const inspectRootsHandler = (value: unknown): NonNullable<NormalizedAutomaticInputRequiredPolicy["roots"]> | undefined => {
  const record = inspectPolicyObject(value, "roots handler", new Set(["list"]))
  if (record === undefined) return undefined
  if (!Effect.isEffect(record["list"]) && typeof record["list"] !== "function") {
    throw new TypeError("Roots list must be an Effect or function")
  }
  return record as unknown as NonNullable<NormalizedAutomaticInputRequiredPolicy["roots"]>
}

const inspectElicitationHandlers = (value: unknown): NonNullable<NormalizedAutomaticInputRequiredPolicy["elicitation"]> | undefined => {
  const record = inspectPolicyObject(value, "elicitation handlers", new Set(["form", "url"]))
  if (record === undefined) return undefined
  if (record["form"] !== undefined && typeof record["form"] !== "function") throw new TypeError("Elicitation form must be a function")
  if (record["url"] !== undefined && typeof record["url"] !== "function") throw new TypeError("Elicitation url must be a function")
  return record as unknown as NonNullable<NormalizedAutomaticInputRequiredPolicy["elicitation"]>
}

const inputRequiredCapabilities = (
  policy: NormalizedAutomaticInputRequiredPolicy
): Record<string, unknown> => ({
  ...(policy.sampling === undefined ? {} : {
    sampling: {
      ...(policy.sampling.context === true ? { context: {} } : {}),
      ...(policy.sampling.tools === true ? { tools: {} } : {})
    }
  }),
  ...(policy.roots === undefined ? {} : { roots: {} }),
  ...(policy.elicitation === undefined ? {} : {
    elicitation: {
      ...(policy.elicitation.form === undefined ? {} : { form: {} }),
      ...(policy.elicitation.url === undefined ? {} : { url: {} })
    }
  })
})

const strictJsonEqual = (left: unknown, right: unknown): boolean => {
  const a = cloneStrictJson(left)
  const b = cloneStrictJson(right)
  if (a === invalidStrictJson || b === invalidStrictJson) return false
  const compare = (x: unknown, y: unknown): boolean => {
    if (Object.is(x, y)) return true
    if (Array.isArray(x) || Array.isArray(y)) {
      return Array.isArray(x) && Array.isArray(y) && x.length === y.length &&
        x.every((item, index) => compare(item, y[index]))
    }
    if (!isRecord(x) || !isRecord(y)) return false
    const xKeys = Object.keys(x).sort(codeUnitCompare)
    const yKeys = Object.keys(y).sort(codeUnitCompare)
    return xKeys.length === yKeys.length && xKeys.every((key, index) =>
      key === yKeys[index] && compare(x[key], y[key]))
  }
  return compare(a, b)
}

const codeUnitCompare = (left: string, right: string): number => left < right ? -1 : left > right ? 1 : 0

const decodeInputRequest = (
  value: unknown
): Effect.Effect<typeof InputRequest.Type, SchemaValidationError> => Effect.try({
  try: () => {
    const first = Schema.decodeUnknownEither(InputRequest)(value)
    const decoded = Either.isRight(first) ? first : Schema.validateEither(InputRequest)(value)
    if (Either.isLeft(decoded)) throw decoded.left
    const encoded = Schema.encodeUnknownEither(InputRequest)(decoded.right)
    if (Either.isLeft(encoded)) throw encoded.left
    const strict = cloneStrictJson(encoded.right)
    if (strict === invalidStrictJson) throw new TypeError("Input request must be canonical JSON")
    const canonical = Schema.decodeUnknownEither(InputRequest)(strict)
    if (Either.isLeft(canonical)) throw canonical.left
    return canonical.right
  },
  catch: (cause) => new SchemaValidationError({ message: "Invalid input request", cause })
})

const inputRequestEntries = (
  value: unknown
): ReadonlyArray<readonly [string, unknown]> | typeof invalidInputRequestEntries => {
  if (value === undefined) return []
  if (!isRecord(value)) return invalidInputRequestEntries
  try {
    const keys = Reflect.ownKeys(value)
    if (keys.some((key) => typeof key !== "string")) return invalidInputRequestEntries
    const descriptors = Object.getOwnPropertyDescriptors(value)
    const entries: Array<readonly [string, unknown]> = []
    for (const key of keys as string[]) {
      const descriptor = descriptors[key]
      if (descriptor === undefined || !("value" in descriptor) || !descriptor.enumerable) {
        return invalidInputRequestEntries
      }
      entries.push([key, descriptor.value])
    }
    return entries
  } catch {
    return invalidInputRequestEntries
  }
}

const snapshotMrtrPayload = (
  value: unknown
): Effect.Effect<Readonly<Record<string, unknown>>, McpClientError> => Effect.try({
  try: () => {
    const strict = cloneStrictJson(value ?? {})
    if (strict === invalidStrictJson || !isRecord(strict)) throw new TypeError("Request params must be canonical JSON")
    return Object.freeze(strict)
  },
  catch: (cause) => protocolValidationError("Invalid request params", cause)
})

const withoutContinuation = (
  value: Readonly<Record<string, unknown>>
): Readonly<Record<string, unknown>> => {
  const output: Record<string, unknown> = Object.create(null)
  for (const [key, item] of Object.entries(value)) {
    if (key !== "inputResponses" && key !== "requestState" && key !== "_meta") {
      defineOwnData(output, key, item)
    }
  }
  return Object.freeze(output)
}

const continuationPayload = (
  base: Readonly<Record<string, unknown>>,
  inputResponses: Record<string, unknown> | undefined,
  requestState: unknown
): Readonly<Record<string, unknown>> => {
  const output: Record<string, unknown> = Object.create(null)
  for (const [key, item] of Object.entries(base)) defineOwnData(output, key, item)
  if (inputResponses !== undefined) defineOwnData(output, "inputResponses", inputResponses)
  if (requestState !== undefined) defineOwnData(output, "requestState", requestState)
  return Object.freeze(output)
}

const validCalendarDate = (value: string): boolean => {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value)
  if (match === null) return false
  const year = Number(match[1])
  const month = Number(match[2])
  const day = Number(match[3])
  if (month < 1 || month > 12) return false
  const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0)
  const days = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31]
  return day >= 1 && day <= days[month - 1]
}

const validDateTime = (value: string): boolean => {
  const match = /^(\d{4}-\d{2}-\d{2})[Tt ](\d{2}):(\d{2}):(\d{2}(?:\.\d+)?)(?:[Zz]|([+-])(\d{2})(?::?(\d{2}))?)$/.exec(value)
  if (match === null || !validCalendarDate(match[1])) return false
  const hour = Number(match[2])
  const minute = Number(match[3])
  const second = Number(match[4])
  const offsetSign = match[5] === "-" ? -1 : 1
  const offsetHour = Number(match[6] ?? 0)
  const offsetMinute = Number(match[7] ?? 0)
  if (offsetHour > 23 || offsetMinute > 59) return false
  if (hour <= 23 && minute <= 59 && second < 60) return true
  const utcMinute = minute - offsetMinute * offsetSign
  const utcHour = hour - offsetHour * offsetSign - (utcMinute < 0 ? 1 : 0)
  return (utcHour === 23 || utcHour === -1) &&
    (utcMinute === 59 || utcMinute === -1) && second < 61
}

const validEmail = (value: string): boolean => {
  if (value.length === 0 || /[\u0000-\u0020\u007f]/.test(value)) return false
  const at = value.indexOf("@")
  if (at <= 0 || at !== value.lastIndexOf("@")) return false
  const local = value.slice(0, at)
  const domain = value.slice(at + 1)
  if (local.startsWith(".") || local.endsWith(".") || local.includes("..")) return false
  if (!/^[A-Za-z0-9!#$%&'*+/=?^_`{|}~.-]+$/.test(local)) return false
  if (domain.startsWith(".") || domain.endsWith(".")) return false
  const labels = domain.split(".")
  return labels.length >= 2 && labels.every((label) =>
    /^[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?$/.test(label)
  )
}

const validUri = (value: string): boolean => {
  if (!/^[A-Za-z][A-Za-z0-9+.-]*:/.test(value) ||
    /[\u0000-\u0020\u007f-\uffff]/.test(value) || value.includes("\\") ||
    /%(?![0-9A-Fa-f]{2})/.test(value)) return false
  try {
    return new URL(value).protocol.length > 1
  } catch {
    return false
  }
}

const validStringFormat = (format: unknown, value: string): boolean => {
  switch (format) {
    case undefined: return true
    case "date": return validCalendarDate(value)
    case "date-time": return validDateTime(value)
    case "email": return validEmail(value)
    case "uri": return validUri(value)
    default: return false
  }
}

const validElicitationContent = (
  schema: unknown,
  content: unknown
): boolean => {
  if (!isRecord(schema) || !isRecord(content)) return false
  const properties = isRecord(schema["properties"]) ? schema["properties"] : {}
  const required = Array.isArray(schema["required"]) && schema["required"].every((key) => typeof key === "string")
    ? schema["required"] as ReadonlyArray<string>
    : []
  if (required.some((key) => !Object.hasOwn(content, key))) return false
  for (const [key, value] of Object.entries(content)) {
    const definition = properties[key]
    if (!isRecord(definition)) return false
    const type = definition["type"]
    if (type === "string") {
      if (typeof value !== "string") return false
      const length = Array.from(value).length
      if (typeof definition["minLength"] === "number" && length < definition["minLength"]) return false
      if (typeof definition["maxLength"] === "number" && length > definition["maxLength"]) return false
      if (!validStringFormat(definition["format"], value)) return false
      const enumeration = Array.isArray(definition["enum"])
        ? definition["enum"]
        : Array.isArray(definition["oneOf"])
        ? definition["oneOf"].map((item) => isRecord(item) ? item["const"] : undefined)
        : undefined
      if (enumeration !== undefined && !enumeration.includes(value)) return false
    } else if (type === "number" || type === "integer") {
      if (typeof value !== "number" || !Number.isFinite(value) || (type === "integer" && !Number.isInteger(value))) return false
      if (typeof definition["minimum"] === "number" && value < definition["minimum"]) return false
      if (typeof definition["maximum"] === "number" && value > definition["maximum"]) return false
    } else if (type === "boolean") {
      if (typeof value !== "boolean") return false
    } else if (type === "array") {
      if (!Array.isArray(value) || !value.every((item) => typeof item === "string")) return false
      if (typeof definition["minItems"] === "number" && value.length < definition["minItems"]) return false
      if (typeof definition["maxItems"] === "number" && value.length > definition["maxItems"]) return false
      const items = isRecord(definition["items"]) ? definition["items"] : {}
      const enumeration = Array.isArray(items["enum"])
        ? items["enum"]
        : Array.isArray(items["anyOf"])
        ? items["anyOf"].map((item) => isRecord(item) ? item["const"] : undefined)
        : undefined
      if (enumeration !== undefined && !value.every((item) => enumeration.includes(item))) return false
    } else return false
  }
  return Object.keys(content).every((key) => Object.hasOwn(properties, key))
}

const ownDataProperty = (
  target: unknown,
  name: PropertyKey
): { readonly found: boolean; readonly value?: unknown } => {
  if ((typeof target !== "object" && typeof target !== "function") || target === null) {
    return { found: false }
  }
  const descriptor = Object.getOwnPropertyDescriptor(target, name)
  return descriptor !== undefined && "value" in descriptor
    ? { found: true, value: descriptor.value }
    : { found: false }
}

const normalizeClientRequestOptions = (
  value: unknown
): Effect.Effect<NormalizedClientRequestOptions, McpClientError> => Effect.try({
  try: () => {
    if (value === undefined) return Object.freeze({})
    if ((typeof value !== "object" && typeof value !== "function") || value === null) {
      throw new TypeError("Client request options must be an object")
    }
    const optionKeys = Reflect.ownKeys(value)
    for (const key of optionKeys) {
      if (key !== "progress") throw new TypeError(`Unknown client request option: ${String(key)}`)
    }
    const progressProperty = ownDataProperty(value, "progress")
    if (!optionKeys.includes("progress")) return Object.freeze({})
    if (!progressProperty.found) {
      throw new TypeError("Client progress options must be a data property")
    }
    if (progressProperty.value === undefined) return Object.freeze({})
    const progress = progressProperty.value
    if ((typeof progress !== "object" && typeof progress !== "function") || progress === null) {
      throw new TypeError("Progress options must be an object")
    }
    const progressKeys = Reflect.ownKeys(progress)
    for (const key of progressKeys) {
      if (key !== "token" && key !== "onProgress") {
        throw new TypeError(`Unknown progress option: ${String(key)}`)
      }
    }
    const tokenProperty = ownDataProperty(progress, "token")
    if (!tokenProperty.found) throw new TypeError("Progress token must be a data property")
    const decoded = Schema.decodeUnknownEither(ProgressToken)(tokenProperty.value)
    if (Either.isLeft(decoded)) throw decoded.left
    const callbackProperty = ownDataProperty(progress, "onProgress")
    if (progressKeys.includes("onProgress") && !callbackProperty.found) {
      throw new TypeError("Progress callback must be a data property")
    }
    if (callbackProperty.found && callbackProperty.value !== undefined &&
      typeof callbackProperty.value !== "function") {
      throw new TypeError("Progress callback must be a function")
    }
    return Object.freeze({
      progress: Object.freeze({
        token: decoded.right,
        ...(callbackProperty.value === undefined
          ? {}
          : { onProgress: callbackProperty.value as ProgressHandler })
      })
    })
  },
  catch: (cause) => protocolValidationError("Invalid client request options", cause)
})

const exactProgressToken = (
  left: typeof ProgressToken.Type,
  right: typeof ProgressToken.Type
): boolean => typeof left === typeof right && left === right

const decodeProgressNotification = (
  value: unknown
): Effect.Effect<typeof ProgressNotificationParams.Type, McpClientError> => Effect.try({
  try: () => {
    const strict = cloneStrictJson(value)
    if (strict === invalidStrictJson || !isRecord(strict)) {
      throw new TypeError("Progress notification params must be canonical JSON")
    }
    const meta = ownDataProperty(strict, "_meta")
    if (meta.found && isRecord(meta.value) &&
      ownDataProperty(meta.value, "io.modelcontextprotocol/subscriptionId").found) {
      throw new TypeError("Request progress must not carry subscription ownership")
    }
    const decoded = Schema.decodeUnknownEither(ProgressNotificationParams)(strict)
    if (Either.isLeft(decoded)) throw decoded.left
    return decoded.right
  },
  catch: (cause) => protocolValidationError("Invalid request progress notification", cause)
})

const progressCallbackCauses = new WeakMap<McpClientError, Cause.Cause<unknown>>()

const progressCallbackError = (
  message: string,
  cause: Cause.Cause<unknown>
): McpClientError => {
  const error = new McpClientError({ reason: "Protocol", message })
  Object.defineProperty(error, "cause", {
    configurable: true,
    enumerable: false,
    value: cause,
    writable: false
  })
  progressCallbackCauses.set(error, cause)
  return error
}

const mapProgressCause = <E>(
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
      case "Fail": mapped.set(current, Cause.fail(progressCallbackError(message, cause))); break
      case "Die": mapped.set(current, Cause.fail(progressCallbackError(message, cause))); break
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

const containProgressCallback = (
  thunk: () => unknown,
  message: string
): Effect.Effect<void, McpClientError> => Effect.suspend(() => {
  const result = thunk()
  return Effect.isEffect(result)
    ? result as Effect.Effect<void, unknown>
    : Effect.die(new TypeError("Progress callback must return an Effect"))
}).pipe(Effect.catchAllCause((cause) => Effect.failCause(mapProgressCause(cause, message))))

const restoreProgressCallbackCause = <E>(cause: Cause.Cause<E>): Cause.Cause<E | McpClientError> => {
  const failure = Cause.failureOption(cause)
  if (Option.isNone(failure) || !(failure.value instanceof McpClientError)) {
    return cause
  }
  const callbackCause = progressCallbackCauses.get(failure.value)
  return callbackCause === undefined
    ? cause
    : mapProgressCause(callbackCause, failure.value.message)
}

const mapTransportCause = <E>(cause: Cause.Cause<E>): Cause.Cause<McpClientError> => {
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
      case "Fail": mapped.set(current, Cause.fail(current.error instanceof McpClientError
        ? current.error
        : new McpClientError({
            reason: "Transport",
            message: "MCP transport request failed",
            cause: current.error
          }))); break
      case "Die": mapped.set(current, Cause.die(current.defect)); break
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
