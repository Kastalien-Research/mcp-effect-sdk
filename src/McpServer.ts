/**
 * @since 4.0.0
 */
import * as Arr from "effect/Array"
import * as Cause from "effect/Cause"
import * as Effect from "effect/Effect"
import * as Exit from "effect/Exit"
import * as Fiber from "effect/Fiber"
import * as Layer from "effect/Layer"
import * as Option from "effect/Option"
import * as Queue from "effect/Queue"
import * as RcMap from "effect/RcMap"
import { CurrentLogLevel } from "effect/References"
import * as Schema from "effect/Schema"
import * as AST from "effect/SchemaAST"
import * as ServiceMap from "effect/ServiceMap"
import * as Sink from "effect/Sink"
import type { Stdio } from "effect/Stdio"
import * as Stream from "effect/Stream"
import type * as Types from "effect/Types"
import * as FindMyWay from "effect/unstable/http/FindMyWay"
import * as Headers from "effect/unstable/http/Headers"
import { appendPreResponseHandlerUnsafe } from "effect/unstable/http/HttpEffect"
import * as HttpRouter from "effect/unstable/http/HttpRouter"
import * as HttpServerRequest from "effect/unstable/http/HttpServerRequest"
import * as HttpServerResponse from "effect/unstable/http/HttpServerResponse"
import type * as Rpc from "effect/unstable/rpc/Rpc"
import * as RpcClient from "effect/unstable/rpc/RpcClient"
import type * as RpcGroup from "effect/unstable/rpc/RpcGroup"
import * as RpcMessage from "effect/unstable/rpc/RpcMessage"
import * as RpcSerialization from "effect/unstable/rpc/RpcSerialization"
import * as RpcServer from "effect/unstable/rpc/RpcServer"
import {
  CallToolResult,
  ClientContext,
  ClientNotificationRpcs,
  ClientRpcs,
  CompleteResult,
  ContentBlock,
  EnabledWhen,
  GetPromptResult,
  InternalError,
  InvalidParams,
  isParam,
  ListPromptsResult,
  ListResourcesResult,
  ListResourceTemplatesResult,
  ListToolsResult,
  LoggingMessageNotification,
  MethodNotFound,
  McpServerClient,
  McpServerClientMiddleware,
  ProgressNotification,
  Prompt,
  Resource,
  ResourceUpdatedNotification,
  ResourceTemplate,
  ServerNotificationRpcs,
  TextContent,
  Tool as McpTool
} from "./McpSchema.js"
import type {
  CallTool,
  ClientCapabilities,
  Complete,
  GetPrompt,
  Param,
  PromptArgument,
  PromptMessage,
  ReadResourceResult,
  ServerCapabilities
} from "./McpSchema.js"
import { Tool, Toolkit } from "effect/unstable/ai"
import {
  CLIENT_NOTIFICATION_METHOD_BY_TYPE,
  CLIENT_REQUEST_METHOD_BY_TYPE,
  isClientNotificationMethod,
  LATEST_PROTOCOL_VERSION,
  SERVER_NOTIFICATION_METHOD_BY_TYPE
} from "./generated/mcp/McpProtocol.generated.js"
import type {
  ClientNotificationType,
  ClientRequestType,
  ServerNotificationType
} from "./generated/mcp/McpProtocol.generated.js"
import { layerMcpSseJsonRpc } from "./McpSerialization.js"

const clientRequestMethod = <Type extends ClientRequestType>(
  type: Type
): typeof CLIENT_REQUEST_METHOD_BY_TYPE[Type] => CLIENT_REQUEST_METHOD_BY_TYPE[type]

const clientNotificationMethod = <Type extends ClientNotificationType>(
  type: Type
): typeof CLIENT_NOTIFICATION_METHOD_BY_TYPE[Type] => CLIENT_NOTIFICATION_METHOD_BY_TYPE[type]

const serverNotificationMethod = <Type extends ServerNotificationType>(
  type: Type
): typeof SERVER_NOTIFICATION_METHOD_BY_TYPE[Type] => SERVER_NOTIFICATION_METHOD_BY_TYPE[type]

// Removed in MCP 2026-07-28 (stateless draft): server-initiated request method
// lookup (serverRequestMethod) and all task machinery (getToolTaskSupport,
// withRelatedTaskRequest). See docs/draft-2026-07-28-migration.md.

const objectJsonSchema = (schema: unknown): Record<string, unknown> => {
  if (schema && typeof schema === "object") {
    return {
      type: "object",
      properties: {},
      ...schema as Record<string, unknown>
    }
  }
  return {
    type: "object",
    properties: {}
  }
}

const privateCacheableResult = {
  resultType: "complete",
  ttlMs: 0,
  cacheScope: "private" as const
}

type ReadResourceContentInput =
  | typeof ReadResourceResult.Type
  | { readonly contents: typeof ReadResourceResult.Type["contents"] }
  | string
  | Uint8Array

const byToolName = (
  left: { readonly tool: McpTool },
  right: { readonly tool: McpTool }
): number => left.tool.name.localeCompare(right.tool.name)

const byResourceUri = (
  left: { readonly resource: Resource },
  right: { readonly resource: Resource }
): number => left.resource.uri.localeCompare(right.resource.uri)

const byResourceTemplateUri = (
  left: { readonly template: ResourceTemplate },
  right: { readonly template: ResourceTemplate }
): number => left.template.uriTemplate.localeCompare(right.template.uriTemplate)

const byPromptName = (
  left: { readonly prompt: Prompt },
  right: { readonly prompt: Prompt }
): number => left.prompt.name.localeCompare(right.prompt.name)

// Removed in MCP 2026-07-28 (stateless draft): ping, initialize, logging/setLevel,
// resources/subscribe, resources/unsubscribe, tasks/*. Added: discover,
// subscriptionsListen. See docs/draft-2026-07-28-migration.md.
const clientRequestMethods = {
  discover: clientRequestMethod("DiscoverRequest"),
  complete: clientRequestMethod("CompleteRequest"),
  getPrompt: clientRequestMethod("GetPromptRequest"),
  listPrompts: clientRequestMethod("ListPromptsRequest"),
  listResources: clientRequestMethod("ListResourcesRequest"),
  listResourceTemplates: clientRequestMethod("ListResourceTemplatesRequest"),
  readResource: clientRequestMethod("ReadResourceRequest"),
  subscriptionsListen: clientRequestMethod("SubscriptionsListenRequest"),
  callTool: clientRequestMethod("CallToolRequest"),
  listTools: clientRequestMethod("ListToolsRequest")
} as const

// Removed in MCP 2026-07-28 (stateless draft): notifications/initialized,
// notifications/progress, notifications/roots/list_changed,
// notifications/tasks/status. See docs/draft-2026-07-28-migration.md.
const clientNotificationMethods = {
  cancelled: clientNotificationMethod("CancelledNotification")
} as const

/**
 * @since 4.0.0
 * @category server
 */
export class McpServer extends ServiceMap.Service<McpServer, {
  readonly notifications: RpcClient.RpcClient<RpcGroup.Rpcs<typeof ServerNotificationRpcs>>
  readonly notificationsQueue: Queue.Dequeue<RpcMessage.Request<Rpc.Any>>
  readonly sendNotification: (
    request: RpcMessage.Request<Rpc.Any>,
    clientId?: number | undefined
  ) => Effect.Effect<void>
  readonly setNotificationSender: (
    sender: (
      request: RpcMessage.Request<Rpc.Any>,
      clientId?: number | undefined
    ) => Effect.Effect<void>
  ) => Effect.Effect<void>
  readonly initializedClients: Set<number>

  readonly tools: ReadonlyArray<{
    readonly tool: McpTool
    readonly annotations: ServiceMap.ServiceMap<never>
  }>
  readonly addTool: (options: {
    readonly tool: McpTool
    readonly annotations: ServiceMap.ServiceMap<never>
    readonly handle: (
      payload: unknown,
      request: typeof CallTool.payloadSchema.Type
    ) => Effect.Effect<CallToolResult, never, McpServerClient>
  }) => Effect.Effect<void>
  readonly callTool: (
    requests: typeof CallTool.payloadSchema.Type
  ) => Effect.Effect<CallToolResult, InternalError | InvalidParams | MethodNotFound, McpServerClient>

  readonly resources: ReadonlyArray<{
    readonly resource: Resource
    readonly annotations: ServiceMap.ServiceMap<never>
  }>
  readonly addResource: (options: {
    readonly resource: Resource
    readonly annotations: ServiceMap.ServiceMap<never>
    readonly handle: Effect.Effect<typeof ReadResourceResult.Type, InternalError, McpServerClient>
  }) => Effect.Effect<void>

  readonly resourceTemplates: ReadonlyArray<{
    readonly template: ResourceTemplate
    readonly annotations: ServiceMap.ServiceMap<never>
  }>
  readonly addResourceTemplate: (
    options: {
      readonly template: ResourceTemplate
      readonly annotations: ServiceMap.ServiceMap<never>
      readonly routerPath: string
      readonly completions: Record<string, (input: string) => Effect.Effect<CompleteResult, InternalError>>
      readonly handle: (
        uri: string,
        params: Array<string>
      ) => Effect.Effect<typeof ReadResourceResult.Type, InvalidParams | InternalError, McpServerClient>
    }
  ) => Effect.Effect<void>

  readonly findResource: (
    uri: string
  ) => Effect.Effect<typeof ReadResourceResult.Type, InvalidParams | InternalError, McpServerClient>

  readonly prompts: ReadonlyArray<{
    readonly prompt: Prompt
    readonly annotations: ServiceMap.ServiceMap<never>
  }>
  readonly addPrompt: (options: {
    readonly prompt: Prompt
    readonly annotations: ServiceMap.ServiceMap<never>
    readonly completions: Record<
      string,
      (input: string) => Effect.Effect<CompleteResult, InternalError, McpServerClient>
    >
    readonly handle: (
      params: Record<string, string>
    ) => Effect.Effect<GetPromptResult, InternalError | InvalidParams, McpServerClient>
  }) => Effect.Effect<void>
  readonly getPromptResult: (
    request: typeof GetPrompt.payloadSchema.Type
  ) => Effect.Effect<GetPromptResult, InternalError | InvalidParams, McpServerClient>

  // Removed in MCP 2026-07-28 (stateless draft): taskRuntime / hasTaskTools.
  // See docs/draft-2026-07-28-migration.md.

  readonly completion: (
    complete: typeof Complete.payloadSchema.Type
  ) => Effect.Effect<CompleteResult, InternalError, McpServerClient>
}>()("effect/ai/McpServer") {
  /**
   * @since 4.0.0
   */
  static readonly make = Effect.gen(function*() {
    const matcher = makeUriMatcher<
      {
        readonly _tag: "ResourceTemplate"
        readonly handle: (
          uri: string,
          params: Array<string>
        ) => Effect.Effect<typeof ReadResourceResult.Type, InternalError | InvalidParams, McpServerClient>
      } | {
        readonly _tag: "Resource"
        readonly effect: Effect.Effect<typeof ReadResourceResult.Type, InternalError, McpServerClient>
      }
    >()
    const tools = Arr.empty<{
      readonly tool: McpTool
      readonly annotations: ServiceMap.ServiceMap<never>
    }>()
    const toolMap = new Map<
      string,
      (
        payload: unknown,
        request: typeof CallTool.payloadSchema.Type
      ) => Effect.Effect<CallToolResult, InternalError, McpServerClient>
    >()
    const resources: Array<{
      readonly resource: Resource
      readonly annotations: ServiceMap.ServiceMap<never>
    }> = []
    const resourceTemplates: Array<{
      readonly template: ResourceTemplate
      readonly annotations: ServiceMap.ServiceMap<never>
    }> = []
    const prompts: Array<{
      readonly prompt: Prompt
      readonly annotations: ServiceMap.ServiceMap<never>
    }> = []
    const promptMap = new Map<
      string,
      (params: Record<string, string>) => Effect.Effect<GetPromptResult, InternalError | InvalidParams, McpServerClient>
    >()
    const completionsMap = new Map<
      string,
      (input: string) => Effect.Effect<CompleteResult, InternalError, McpServerClient>
    >()
    const notificationsQueue = yield* Queue.make<RpcMessage.Request<Rpc.Any>>()
    let notificationSender = (
      message: RpcMessage.Request<Rpc.Any>,
      _clientId?: number | undefined
    ): Effect.Effect<void> => Queue.offer(notificationsQueue, message).pipe(Effect.asVoid)
    const listChangedHandles = new Map<string, ReturnType<typeof setTimeout>>()
    const notifications = yield* RpcClient.makeNoSerialization(ServerNotificationRpcs, {
      spanPrefix: "McpServer/Notifications",
      onFromClient: (options) =>
        Effect.suspend((): Effect.Effect<void> => {
          const message = options.message
          if (message._tag !== "Request") {
            return Effect.void
          }
          if (message.tag.includes("list_changed")) {
            if (!listChangedHandles.has(message.tag)) {
              listChangedHandles.set(
                message.tag,
                setTimeout(() => {
                  Queue.offerUnsafe(notificationsQueue, message)
                  listChangedHandles.delete(message.tag)
                }, 0)
              )
            }
          } else {
            Queue.offerUnsafe(notificationsQueue, message)
          }
          return notifications.write({
            clientId: 0,
            requestId: message.id,
            _tag: "Exit",
            exit: Exit.void as never
          })
        })
    })
    // Removed in MCP 2026-07-28 (stateless draft): task runtime (McpTasks) and
    // TaskStatusNotification wiring. See docs/draft-2026-07-28-migration.md.

    return McpServer.of({
      notifications: notifications.client,
      notificationsQueue,
      sendNotification: (message, clientId) => notificationSender(message, clientId),
      setNotificationSender: (sender) =>
        Effect.sync(() => {
          notificationSender = sender
        }),
      initializedClients: new Set(),
      get tools() {
        return tools
      },
      addTool: (options) =>
        Effect.suspend(() => {
          tools.push(options)
          tools.sort(byToolName)
          toolMap.set(options.tool.name, options.handle)
          return notifications.client[
            serverNotificationMethod("ToolListChangedNotification")
          ]({})
        }),
      // In MCP 2026-07-28 (stateless draft) callTool always invokes the handler
      // directly and returns a CallToolResult; task execution was removed. See
      // docs/draft-2026-07-28-migration.md.
      callTool: (request) =>
        Effect.suspend((): Effect.Effect<
          CallToolResult,
          InternalError | InvalidParams | MethodNotFound,
          McpServerClient
        > => {
          const handle = toolMap.get(request.name)
          if (!handle) {
            return Effect.fail(new InvalidParams({ message: `Tool '${request.name}' not found` }))
          }
          return handle(request.arguments, request)
        }),
      get resources() {
        return resources
      },
      get resourceTemplates() {
        return resourceTemplates
      },
      addResource: (options) =>
        Effect.suspend(() => {
          resources.push(options)
          resources.sort(byResourceUri)
          matcher.add(options.resource.uri, { _tag: "Resource", effect: options.handle })
          return notifications.client[
            serverNotificationMethod("ResourceListChangedNotification")
          ]({})
        }),
      addResourceTemplate: ({ annotations, completions, handle, routerPath, template }) =>
        Effect.suspend(() => {
          resourceTemplates.push({ template, annotations })
          resourceTemplates.sort(byResourceTemplateUri)
          matcher.add(routerPath, { _tag: "ResourceTemplate", handle })
          for (const [param, handle] of Object.entries(completions)) {
            completionsMap.set(`ref/resource/${template.uriTemplate}/${param}`, handle)
          }
          return notifications.client[
            serverNotificationMethod("ResourceListChangedNotification")
          ]({})
        }),
      findResource: (uri) =>
        Effect.suspend(() => {
          const match = matcher.find(uri)
          if (!match) {
            return Effect.fail(new InvalidParams({ message: `Resource '${uri}' not found` }))
          } else if (match.handler._tag === "Resource") {
            return match.handler.effect
          }
          const params: Array<string> = []
          for (const key of Object.keys(match.params)) {
            params[Number(key)] = match.params[key]!
          }
          return match.handler.handle(uri, params)
        }),
      get prompts() {
        return prompts
      },
      addPrompt: (options) =>
        Effect.suspend(() => {
          prompts.push(options)
          prompts.sort(byPromptName)
          promptMap.set(options.prompt.name, options.handle)
          for (const [param, handle] of Object.entries(options.completions)) {
            completionsMap.set(`ref/prompt/${options.prompt.name}/${param}`, handle)
          }
          return notifications.client[
            serverNotificationMethod("PromptListChangedNotification")
          ]({})
        }),
      getPromptResult: Effect.fnUntraced(function*({ arguments: params, name }) {
        const handler = promptMap.get(name)
        if (!handler) {
          return yield* new InvalidParams({ message: `Prompt '${name}' not found` })
        }
        return yield* handler(params ?? {})
      }),
      completion: Effect.fnUntraced(function*(complete) {
        const ref = complete.ref
        const key = ref.type === "ref/resource"
          ? `ref/resource/${ref.uri}/${complete.argument.name}`
          : `ref/prompt/${ref.name}/${complete.argument.name}`
        const handler = completionsMap.get(key)
        return handler ? yield* handler(complete.argument.value) : CompleteResult.empty
      })
    })
  })

  /**
   * @since 4.0.0
   */
  static readonly layer: Layer.Layer<McpServer | McpServerClient> =
    Layer.effect(McpServer)(McpServer.make) as Layer.Layer<McpServer | McpServerClient>
}

// In MCP 2026-07-28 (stateless draft) only the latest protocol version is
// supported by default (the old date strings were dropped). Callers may still
// override via `supportedProtocolVersions`. Sessions / Mcp-Session-Id were
// removed (stateless). See docs/draft-2026-07-28-migration.md.
const SUPPORTED_PROTOCOL_VERSIONS = [
  LATEST_PROTOCOL_VERSION
]
const mcpProtocolVersionHeader = "mcp-protocol-version"

/**
 * Explicit extension capability advertisement.
 *
 * Extensions are disabled by default. Passing this option is an opt-in signal
 * that the caller intentionally wants to advertise non-core capabilities.
 *
 * @since 4.0.0
 * @category extensions
 */
export type ExtensionCapabilities = Record<`${string}/${string}`, unknown>

/**
 * Validate extension capability names before they are advertised.
 *
 * @since 4.0.0
 * @category extensions
 */
export const normalizeExtensionCapabilities = (
  extensions: ExtensionCapabilities | undefined
): ExtensionCapabilities | undefined => {
  if (extensions === undefined) {
    return undefined
  }
  for (const name of Object.keys(extensions)) {
    const [namespace, extensionName, ...rest] = name.split("/")
    if (!namespace || !extensionName || rest.length > 0) {
      throw new Error(
        `Invalid extension capability name '${name}'. Expected namespaced form 'namespace/name'.`
      )
    }
  }
  return { ...extensions }
}

interface ServerOptions {
  readonly name: string
  readonly version: string
  /**
   * Natural-language guidance describing the server and its features, surfaced
   * in the `server/discover` result's `instructions` field (2026-07-28 draft).
   */
  readonly instructions?: string | undefined
  readonly extensions?: ExtensionCapabilities | undefined
  readonly supportedProtocolVersions?: ReadonlyArray<string> | undefined
}

/**
 * @since 4.0.0
 * @category constructors
 */
export const run: (options: ServerOptions) => Effect.Effect<
  never,
  never,
  McpServer | RpcServer.Protocol
> = Effect.fnUntraced(function*(options: ServerOptions) {
  const extensions = normalizeExtensionCapabilities(options.extensions)
  const protocol = yield* RpcServer.Protocol
  const server = yield* McpServer
  const isHttp = Option.isSome(yield* Effect.serviceOption(HttpRouter.HttpRouter))
  const handlers = yield* Layer.build(layerHandlers({ ...options, extensions }))

  // Removed in MCP 2026-07-28 (stateless draft): session map (clientSessions),
  // server-initiated request infrastructure (RcMap of RpcClients,
  // serverRequestClientIds) and the elicit/sample/listRoots senders. The
  // Per-client context decoded from each request's `_meta` (protocol version,
  // client info, client capabilities). The draft is stateless and a client
  // sends the same capabilities on every request, so keying by clientId is
  // correct and not racy. Populated in patchedProtocol.run before dispatch.
  const clientContexts = new Map<number, typeof ClientContext.Type>()

  // The middleware no longer gates on a session id; it provides a
  // `McpServerClient` built from the request `_meta` so that
  // `McpServer.clientCapabilities` and `EnabledWhen` see the real client.
  // See docs/draft-2026-07-28-migration.md.
  const clientMiddleware = McpServerClientMiddleware.of((effect, { clientId }) => {
    server.initializedClients.add(clientId)
    return Effect.provideService(
      effect,
      McpServerClient,
      McpServerClient.of({
        clientId,
        initializePayload: clientContexts.get(clientId) ?? ClientContext.makeUnsafe({})
      })
    )
  })

  const patchedProtocol = RpcServer.Protocol.of({
    ...protocol,
    run: (f) =>
      protocol.run((clientId, request_) => {
        const request = request_ as unknown as
          | RpcMessage.FromServerEncoded
          | RpcMessage.FromClientEncoded
        switch (request._tag) {
          case "Request": {
            // Decode the per-request client context from `_meta` so the
            // middleware can expose real client capabilities (the client sends
            // these on every request in the stateless draft).
            const meta = (request.payload as { readonly _meta?: Record<string, unknown> } | undefined)?._meta
            if (meta && typeof meta === "object") {
              const caps = meta["io.modelcontextprotocol/clientCapabilities"]
              const info = meta["io.modelcontextprotocol/clientInfo"]
              const version = meta["io.modelcontextprotocol/protocolVersion"]
              const traceparent = meta.traceparent
              const tracestate = meta.tracestate
              const baggage = meta.baggage
              // Stored as a structural ClientContext value (not constructed via
              // the schema): McpServerClient is a plain service and is never
              // encoded, and ClientContext.makeUnsafe would reject the raw
              // capabilities/clientInfo objects (they are Schema.Class types).
              clientContexts.set(clientId, {
                capabilities: (caps && typeof caps === "object" ? caps : {}) as
                  typeof ClientContext.Type["capabilities"],
                clientInfo: (info && typeof info === "object" ? info : undefined) as
                  typeof ClientContext.Type["clientInfo"],
                protocolVersion: typeof version === "string" ? version : undefined,
                traceparent: typeof traceparent === "string" ? traceparent : undefined,
                tracestate: typeof tracestate === "string" ? tracestate : undefined,
                baggage: typeof baggage === "string" ? baggage : undefined
              } as typeof ClientContext.Type)
            }
            if (isHttp) {
              // Stateless: no Mcp-Session-Id. Advertise the negotiated protocol
              // version header on responses. See docs/draft-2026-07-28-migration.md.
              const fiber = Fiber.getCurrent()!
              const httpRequest = ServiceMap.getUnsafe(fiber.services, HttpServerRequest.HttpServerRequest)
              appendPreResponseHandlerUnsafe(httpRequest, (_: unknown, res: unknown) =>
                Effect.succeed(
                  HttpServerResponse.setHeader(
                    res as HttpServerResponse.HttpServerResponse,
                    mcpProtocolVersionHeader,
                    LATEST_PROTOCOL_VERSION
                  )
                ))
            }
            if (isClientNotificationMethod(request.tag)) {
              const rpc = ClientNotificationRpcs.requests.get(request.tag)
              if (!rpc) {
                return Effect.void
              }
              if (request.tag === clientNotificationMethod("CancelledNotification")) {
                return f(clientId, {
                  _tag: "Interrupt",
                  requestId: String((request.payload as { readonly requestId?: unknown }).requestId)
                })
              }
              const handler = handlers.mapUnsafe.get(request.tag) as Rpc.Handler<string>
              return handler
                ? handler.handler(request.payload, {
                  rpc,
                  requestId: RpcMessage.RequestId(request.id),
                  clientId,
                  headers: Headers.fromInput(request.headers)
                }) as Effect.Effect<void>
                : Effect.void
            }
            return f(clientId, request)
          }
          case "Ping":
          case "Ack":
          case "Interrupt":
            return f(clientId, request)
          case "Eof":
            // Connection closed (in the stateless HTTP transport this fires once
            // per request): drop the per-client context so the map stays bounded.
            // Interrupt is per-request cancellation, not disconnect, so it must
            // not evict the context other in-flight requests still need.
            clientContexts.delete(clientId)
            return f(clientId, request)
          // Removed in MCP 2026-07-28 (stateless draft): the stateless draft has
          // no server-initiated requests, so responses to them (Pong/Exit/Chunk/
          // ClientProtocolError/Defect targeting a server request) are no longer
          // routed back to a server RpcClient and are simply ignored. See
          // docs/draft-2026-07-28-migration.md.
          default:
            return Effect.void
        }
      })
  })

  const encodeNotification = Schema.encodeUnknownEffect(
    Schema.Union(Array.from(ServerNotificationRpcs.requests.values(), (rpc) => rpc.payloadSchema))
  )
  yield* server.setNotificationSender((request, clientId) =>
    Effect.gen(function*() {
      const encoded = yield* encodeNotification(request.payload)
      const message: RpcMessage.RequestEncoded = {
        _tag: "Request",
        tag: request.tag,
        payload: encoded
      } as unknown as RpcMessage.RequestEncoded
      if (clientId !== undefined) {
        yield* patchedProtocol.send(clientId, message as unknown as RpcMessage.FromServerEncoded)
        return
      }
      const clientIds = yield* patchedProtocol.clientIds
      for (const id of server.initializedClients.keys()) {
        if (!clientIds.has(id)) {
          server.initializedClients.delete(id)
          continue
        }
        yield* patchedProtocol.send(id, message as unknown as RpcMessage.FromServerEncoded)
      }
    }).pipe(Effect.catchCause(() => Effect.void))
  )
  yield* Queue.take(server.notificationsQueue).pipe(
    Effect.flatMap(Effect.fnUntraced(function*(request) {
      yield* server.sendNotification(request)
    })),
    Effect.catchCause(() => Effect.void),
    Effect.forever,
    Effect.forkScoped
  )

  return yield* RpcServer.make(ClientRpcs, {
    spanPrefix: "McpServer",
    disableFatalDefects: true
  }).pipe(
    Effect.provideService(RpcServer.Protocol, patchedProtocol),
    Effect.provideService(McpServerClientMiddleware, clientMiddleware),
    Effect.provide(handlers)
  )
}, Effect.scoped)

/**
 * @since 4.0.0
 * @category layers
 */
export const layer = (options: ServerOptions): Layer.Layer<McpServer | McpServerClient, never, RpcServer.Protocol> =>
  Layer.effectDiscard(Effect.forkScoped(run(options))).pipe(
    Layer.provideMerge(McpServer.layer)
  )

/**
 * Run the McpServer, using stdio for input and output.
 *
 * @example
 * ```ts
 * import { NodeRuntime, NodeStdio } from "@effect/platform-node"
 * import { Effect, Layer, Logger, Schema } from "effect"
 * import { McpSchema, McpServer } from "effect/unstable/ai"
 *
 * const idParam = McpSchema.param("id", Schema.Number)
 *
 * // Define a resource template for a README file
 * const ReadmeTemplate = McpServer.resource`file://readme/${idParam}`({
 *   name: "README Template",
 *   // You can add auto-completion for the ID parameter
 *   completion: {
 *     id: (_) => Effect.succeed([1, 2, 3, 4, 5])
 *   },
 *   content: Effect.fn(function*(_uri, id) {
 *     return `# MCP Server Demo - ID: ${id}`
 *   })
 * })
 *
 * // Define a test prompt with parameters
 * const TestPrompt = McpServer.prompt({
 *   name: "Test Prompt",
 *   description: "A test prompt to demonstrate MCP server capabilities",
 *   parameters: {
 *     flightNumber: Schema.String
 *   },
 *   completion: {
 *     flightNumber: () => Effect.succeed(["FL123", "FL456", "FL789"])
 *   },
 *   content: ({ flightNumber }) =>
 *     Effect.succeed(`Get the booking details for flight number: ${flightNumber}`)
 * })
 *
 * // Merge all the resources and prompts into a single server layer
 * const ServerLayer = Layer.mergeAll(
 *   ReadmeTemplate,
 *   TestPrompt
 * ).pipe(
 *   // Provide the MCP server implementation
 *   Layer.provide(McpServer.layerStdio({
 *     name: "Demo Server",
 *     version: "1.0.0",
 *   })),
 *   Layer.provide(NodeStdio.layer),
 *   Layer.provide(Layer.succeed(Logger.LogToStderr)(true))
 * )
 *
 * Layer.launch(ServerLayer).pipe(NodeRuntime.runMain)
 * ```
 *
 * @since 4.0.0
 * @category layers
 */
export const layerStdio = (options: {
  readonly name: string
  readonly version: string
  readonly instructions?: string | undefined
  readonly extensions?: ExtensionCapabilities | undefined
}): Layer.Layer<McpServer | McpServerClient, never, Stdio> =>
  layer(options).pipe(
    Layer.provide(RpcServer.layerProtocolStdio),
    Layer.provide(RpcSerialization.layerNdJsonRpc())
  )

/**
 * Run the `McpServer`, registering a router with a `HttpRouter`
 *
 * @since 4.0.0
 * @category layers
 */
export const layerHttp = (options: {
  readonly name: string
  readonly version: string
  readonly path: HttpRouter.PathInput
  readonly instructions?: string | undefined
  readonly extensions?: ExtensionCapabilities | undefined
  readonly supportedProtocolVersions?: ReadonlyArray<string> | undefined
}): Layer.Layer<McpServer | McpServerClient, never, HttpRouter.HttpRouter> =>
  layer(options).pipe(
    Layer.provide(RpcServer.layerProtocolHttp(options)),
    Layer.provide(layerMcpSseJsonRpc)
  )

/**
 * Register a `Toolkit` with the `McpServer`.
 *
 * @since 4.0.0
 * @category tools
 */
export const registerToolkit: <Tools extends Record<string, Tool.Any>>(
  toolkit: Toolkit.Toolkit<Tools>
) => Effect.Effect<
  void,
  never,
  McpServer | Tool.HandlersFor<Tools> | Exclude<Tool.HandlerServices<Tools>, McpServerClient>
> = Effect.fnUntraced(function*<Tools extends Record<string, Tool.Any>>(
  toolkit: Toolkit.Toolkit<Tools>
) {
  const registry = yield* McpServer
  const built = yield* (toolkit as unknown as Effect.Effect<
    Toolkit.WithHandler<Tools>,
    never,
    Exclude<Tool.HandlersFor<Tools>, McpServerClient>
  >)
  const services = yield* Effect.services<never>()
  for (const tool of Object.values(built.tools)) {
    const annotations = tool.annotations
    const toolMeta = ServiceMap.getOrUndefined(annotations, Tool.Meta)
    const mcpTool = new McpTool({
      name: tool.name,
      description: Tool.getDescription(tool),
      inputSchema: Tool.getJsonSchema(tool),
      annotations: {
        ...(ServiceMap.getOption(tool.annotations, Tool.Title).pipe(
          Option.map((title) => ({ title })),
          Option.getOrUndefined
        )),
        readOnlyHint: ServiceMap.get(tool.annotations, Tool.Readonly),
        destructiveHint: ServiceMap.get(tool.annotations, Tool.Destructive),
        idempotentHint: ServiceMap.get(tool.annotations, Tool.Idempotent),
        openWorldHint: ServiceMap.get(tool.annotations, Tool.OpenWorld)
      },
      _meta: toolMeta
    })
    yield* registry.addTool({
      tool: mcpTool,
      annotations,
      handle(payload) {
        return built.handle(tool.name as keyof Tools & string, payload as never).pipe(
          Stream.unwrap,
          Stream.run(Sink.last()),
          Effect.flatMap(Effect.fromOption),
          Effect.provideServices(services as ServiceMap.ServiceMap<unknown>),
          Effect.matchCause({
            onFailure: (cause) =>
              new CallToolResult({
                isError: true,
                content: [{
                  type: "text",
                  text: Cause.pretty(cause)
                }]
              }),
            onSuccess: (result: unknown) => {
              const encodedResult = result as { readonly encodedResult?: unknown }
              return new CallToolResult({
                isError: false,
                structuredContent: encodedResult.encodedResult,
                content: [{
                  type: "text",
                  text: JSON.stringify(encodedResult.encodedResult)
                }]
              })
            }
          }),
          Effect.tapCause(Effect.log)
        ) as unknown as Effect.Effect<CallToolResult, never, McpServerClient>
      }
    })
  }
})

/**
 * Register an AiToolkit with the McpServer.
 *
 * @since 4.0.0
 * @category tools
 */
export const toolkit = <Tools extends Record<string, Tool.Any>>(
  toolkit: Toolkit.Toolkit<Tools>
): Layer.Layer<
  never,
  never,
  Tool.HandlersFor<Tools> | Exclude<Tool.HandlerServices<Tools>, McpServerClient>
> =>
  Layer.effectDiscard(registerToolkit(toolkit)).pipe(
    Layer.provide(McpServer.layer)
  )

/**
 * Register a tool with the McpServer.
 *
 * @since 4.0.0
 * @category tools
 */
export const registerTool = <
  E,
  R,
  Params extends Schema.Struct.Fields = {}
>(
  options: {
    readonly name: string
    readonly description?: string | undefined
    readonly parameters?: Params | undefined
    // Removed in MCP 2026-07-28 (stateless draft): the `taskSupport` option.
    // See docs/draft-2026-07-28-migration.md.
    readonly annotations?: ServiceMap.ServiceMap<never> | undefined
    readonly content: (
      params: Schema.Struct.Type<Params>,
      request: typeof CallTool.payloadSchema.Type
    ) => Effect.Effect<
      CallToolResult | string | ReadonlyArray<typeof ContentBlock.Type>,
      E,
      R
    >
  }
): Effect.Effect<
  void,
  never,
  Exclude<Schema.Struct.DecodingServices<Params> | R, McpServerClient> | McpServer
> => {
  const props: Record<string, Schema.Top> = options.parameters ?? {}
  const schema = Schema.Struct(props)
  const decode = Schema.decodeUnknownEffect(schema)
  return Effect.gen(function*() {
    const registry = yield* McpServer
    const services = yield* Effect.services<
      Exclude<R | Schema.Struct.DecodingServices<Params>, McpServerClient>
    >()
    yield* registry.addTool({
      tool: new McpTool({
        name: options.name,
        description: options.description,
        inputSchema: objectJsonSchema(Tool.getJsonSchemaFromSchema(schema))
      }),
      annotations: options.annotations ?? ServiceMap.empty(),
      handle: (payload, request) =>
        decode(payload ?? {}).pipe(
          Effect.flatMap((params) => options.content(params as Schema.Struct.Type<Params>, request)),
          Effect.map(resolveToolResult),
          Effect.catchCause((cause) =>
            Effect.succeed(new CallToolResult({
              isError: true,
              content: [{
                type: "text",
                text: Cause.pretty(cause)
              }]
            }))
          ),
          Effect.provideServices(services as ServiceMap.ServiceMap<unknown>)
        )
    })
  })
}

/**
 * Register a tool with the McpServer as a Layer.
 *
 * @since 4.0.0
 * @category tools
 */
export const tool = <
  E,
  R,
  Params extends Schema.Struct.Fields = {}
>(
  options: {
    readonly name: string
    readonly description?: string | undefined
    readonly parameters?: Params | undefined
    // Removed in MCP 2026-07-28 (stateless draft): the `taskSupport` option.
    // See docs/draft-2026-07-28-migration.md.
    readonly annotations?: ServiceMap.ServiceMap<never> | undefined
    readonly content: (
      params: Schema.Struct.Type<Params>,
      request: typeof CallTool.payloadSchema.Type
    ) => Effect.Effect<
      CallToolResult | string | ReadonlyArray<typeof ContentBlock.Type>,
      E,
      R
    >
  }
): Layer.Layer<never, never, Exclude<Schema.Struct.DecodingServices<Params> | R, McpServerClient>> =>
  Layer.effectDiscard(registerTool(options)).pipe(
    Layer.provide(McpServer.layer)
  )

/**
 * @since 4.0.0
 */
export type ValidateCompletions<Completions, Keys extends string> =
  & Completions
  & {
    readonly [K in keyof Completions]: K extends Keys ? (input: string) => unknown : never
  }

/**
 * @since 4.0.0
 */
export type ResourceCompletions<Schemas extends ReadonlyArray<Schema.Top>> = {
  readonly [
    K in Extract<keyof Schemas, `${number}`> as Schemas[K] extends Param<infer Id, infer _S> ? Id
      : `param${K}`
  ]: (input: string) => Effect.Effect<Array<Schemas[K]["Type"]>, unknown, unknown>
}

/**
 * Register a resource with the McpServer.
 *
 * @since 4.0.0
 * @category resources
 */
export const registerResource: {
  <E, R>(options: {
    readonly uri: string
    readonly name: string
    readonly description?: string | undefined
    readonly mimeType?: string | undefined
    readonly audience?: ReadonlyArray<"user" | "assistant"> | undefined
    readonly priority?: number | undefined
    readonly content: Effect.Effect<
      ReadResourceContentInput,
      E,
      R
    >
    readonly annotations?: ServiceMap.ServiceMap<never> | undefined
  }): Effect.Effect<void, never, Exclude<R, McpServerClient> | McpServer>
  <const Schemas extends ReadonlyArray<Schema.Top>>(segments: TemplateStringsArray, ...schemas: Schemas): <
    E,
    R,
    const Completions extends Partial<ResourceCompletions<Schemas>> = {}
  >(options: {
    readonly name: string
    readonly description?: string | undefined
    readonly mimeType?: string | undefined
    readonly audience?: ReadonlyArray<"user" | "assistant"> | undefined
    readonly priority?: number | undefined
    readonly completion?: ValidateCompletions<Completions, keyof ResourceCompletions<Schemas>> | undefined
    readonly content: (
      uri: string,
      ...params: { readonly [K in keyof Schemas]: Schemas[K]["Type"] }
    ) => Effect.Effect<ReadResourceContentInput, E, R>
    readonly annotations?: ServiceMap.ServiceMap<never> | undefined
  }) => Effect.Effect<
    void,
    never,
    | Exclude<
      | Schemas[number]["DecodingServices"]
      | Schemas[number]["EncodingServices"]
      | R
      | (Completions[keyof Completions] extends (input: string) => infer Ret ?
        Ret extends Effect.Effect<infer _A, infer _E, infer _R> ? _R : never
        : never),
      McpServerClient
    >
    | McpServer
  >
} = function() {
  if (arguments.length === 1) {
    const options = arguments[0] as {
      readonly uri: string
      readonly name: string
      readonly description?: string | undefined
      readonly mimeType?: string | undefined
      readonly audience?: ReadonlyArray<"user" | "assistant"> | undefined
      readonly priority?: number | undefined
      readonly content: Effect.Effect<ReadResourceContentInput, unknown, unknown>
      readonly annotations?: ServiceMap.ServiceMap<never> | undefined
    }
    return Effect.gen(function*() {
      const services = yield* Effect.services<unknown>()
      const registry = yield* McpServer
      yield* registry.addResource({
        resource: new Resource({
          ...options,
          annotations: options
        }),
        handle: options.content.pipe(
          Effect.provideServices(services),
          Effect.map((content) => resolveResourceContent(options.uri, content)),
          Effect.catchCause((cause) => {
            const prettyError = Cause.prettyErrors(cause)[0]
            return Effect.fail(new InternalError({ message: prettyError.message }))
          })
        ),
        annotations: options.annotations ?? ServiceMap.empty()
      })
    })
  }
  const {
    params,
    routerPath,
    schema,
    uriPath
  } = compileUriTemplate(...(arguments as unknown as [TemplateStringsArray, ...ReadonlyArray<Schema.Top>]))
  return Effect.fnUntraced(function*<E, R>(options: {
    readonly name: string
    readonly description?: string | undefined
    readonly mimeType?: string | undefined
    readonly audience?: ReadonlyArray<"user" | "assistant"> | undefined
    readonly priority?: number | undefined
    readonly completion?: Record<string, (input: string) => Effect.Effect<unknown>> | undefined
    readonly content: (
      uri: string,
      ...params: Array<unknown>
    ) => Effect.Effect<ReadResourceContentInput, E, R>
    readonly annotations?: ServiceMap.ServiceMap<never> | undefined
  }) {
    const services = yield* Effect.services<unknown>()
    const registry = yield* McpServer
    const decode = Schema.decodeUnknownEffect(schema)
    const template = new ResourceTemplate({
      ...options,
      uriTemplate: uriPath,
      annotations: options!
    })
    const completions: Record<string, (input: string) => Effect.Effect<CompleteResult, InternalError>> = {}
    for (const [param, handle] of Object.entries(options.completion ?? {})) {
      const encodeArray = Schema.encodeUnknownEffect(Schema.Array(params[param]))
      const handler = (input: string) =>
        handle(input).pipe(
          Effect.flatMap(encodeArray),
          Effect.map((values) => ({
            completion: {
              values: values as Array<string>,
              total: values.length,
              hasMore: false
            }
          })),
          Effect.catchCause((cause) => {
            const prettyError = Cause.prettyErrors(cause)[0]
            return Effect.fail(new InternalError({ message: prettyError.message }))
          }),
          Effect.provideServices(services)
        )
      completions[param] = handler
    }
    yield* registry.addResourceTemplate({
      template,
      routerPath,
      completions,
      annotations: options.annotations ?? ServiceMap.empty(),
      handle: (uri, params) =>
        decode(params).pipe(
          Effect.mapError((error) => new InvalidParams({ message: error.message })),
          Effect.flatMap((params) =>
            options.content(uri, ...(params as ReadonlyArray<unknown>)).pipe(
              Effect.map((content) => resolveResourceContent(uri, content)),
              Effect.catchCause((cause) => {
                const prettyError = Cause.prettyErrors(cause)[0]
                return Effect.fail(new InternalError({ message: prettyError.message }))
              })
            )
          ),
          Effect.provideServices(services)
        )
    })
  })
} as never

/**
 * Register a resource with the McpServer.
 *
 * @since 4.0.0
 * @category resources
 */
export const resource: {
  <E, R>(options: {
    readonly uri: string
    readonly name: string
    readonly description?: string | undefined
    readonly mimeType?: string | undefined
    readonly audience?: ReadonlyArray<"user" | "assistant"> | undefined
    readonly priority?: number | undefined
    readonly content: Effect.Effect<
      ReadResourceContentInput,
      E,
      R
    >
  }): Layer.Layer<never, never, Exclude<R, McpServerClient>>
  <const Schemas extends ReadonlyArray<Schema.Top>>(segments: TemplateStringsArray, ...schemas: Schemas): <
    E,
    R,
    const Completions extends Partial<ResourceCompletions<Schemas>> = {}
  >(options: {
    readonly name: string
    readonly description?: string | undefined
    readonly mimeType?: string | undefined
    readonly audience?: ReadonlyArray<"user" | "assistant"> | undefined
    readonly priority?: number | undefined
    readonly completion?: ValidateCompletions<Completions, keyof ResourceCompletions<Schemas>> | undefined
    readonly content: (
      uri: string,
      ...params: { readonly [K in keyof Schemas]: Schemas[K]["Type"] }
    ) => Effect.Effect<ReadResourceContentInput, E, R>
  }) => Layer.Layer<
    never,
    never,
    Exclude<
      | R
      | (Completions[keyof Completions] extends (input: string) => infer Ret ?
        Ret extends Effect.Effect<infer _A, infer _E, infer _R> ? _R : never
        : never),
      McpServerClient
    >
  >
} = function() {
  if (arguments.length === 1) {
    return Layer.effectDiscard(registerResource(arguments[0])).pipe(
      Layer.provide(McpServer.layer)
    )
  }
  const register = registerResource(
    ...(arguments as unknown as [TemplateStringsArray, ...ReadonlyArray<Schema.Top>])
  )
  return (options: unknown) =>
    Layer.effectDiscard(register(options as never)).pipe(
      Layer.provide(McpServer.layer)
    )
} as never

/**
 * Register a prompt with the McpServer.
 *
 * @since 4.0.0
 * @category prompts
 */
export const registerPrompt = <
  E,
  R,
  Params extends Schema.Struct.Fields = {},
  const Completions extends {
    readonly [K in keyof Params]?: (input: string) => Effect.Effect<Array<Params[K]>, unknown, unknown>
  } = {}
>(
  options: {
    readonly name: string
    readonly description?: string | undefined
    readonly parameters?: Params | undefined
    readonly completion?: ValidateCompletions<Completions, Extract<keyof Params, string>> | undefined
    readonly content: (
      params: Schema.Struct.Type<Params>
    ) => Effect.Effect<Array<typeof PromptMessage.Type> | string, E, R>
    readonly annotations?: ServiceMap.ServiceMap<never> | undefined
  }
): Effect.Effect<void, never, Exclude<Schema.Struct.DecodingServices<Params> | R, McpServerClient> | McpServer> => {
  const args = Arr.empty<typeof PromptArgument.Type>()
  const props: Record<string, Schema.Top> = options.parameters ?? {}
  for (const [name, prop] of Object.entries(props)) {
    args.push({
      name,
      description: AST.resolveDescription(prop.ast),
      required: !AST.isOptional(prop.ast)
    })
  }
  const prompt = new Prompt({
    name: options.name,
    description: options.description,
    arguments: args
  })
  const decode = options.parameters
    ? Schema.decodeEffect(Schema.Struct(props))
    : () => Effect.succeed({} as Params)
  const completion = (options.completion ?? {}) as Record<
    string,
    (input: string) => Effect.Effect<ReadonlyArray<unknown>, unknown, unknown>
  >
  return Effect.gen(function*() {
    const registry = yield* McpServer
    const services = yield* Effect.services<Exclude<R | Schema.Struct.DecodingServices<Params>, McpServerClient>>()
    const completions: Record<
      string,
      (input: string) => Effect.Effect<CompleteResult, InternalError, McpServerClient>
    > = {}
    for (const [param, handle] of Object.entries(completion)) {
      const encodeArray = Schema.encodeEffect(Schema.Array(props[param]))
      const handler = (input: string) =>
        handle(input).pipe(
          Effect.flatMap(encodeArray),
          Effect.map((values) => ({
            completion: {
              values: values as Array<string>,
              total: values.length,
              hasMore: false
            }
          })),
          Effect.catchCause((cause) => {
            const prettyError = Cause.prettyErrors(cause)[0]
            return Effect.fail(new InternalError({ message: prettyError.message }))
          }),
          Effect.provide(services)
        )
      completions[param] = handler as unknown as (input: string) => Effect.Effect<
        CompleteResult,
        InternalError,
        McpServerClient
      >
    }
    yield* registry.addPrompt({
      prompt,
      completions,
      annotations: options.annotations ?? ServiceMap.empty(),
      handle: (params) =>
        decode(params).pipe(
          Effect.mapError((error) => new InvalidParams({ message: error.message })),
          Effect.flatMap((params) => options.content(params as Params)),
          Effect.map((messages) => {
            messages = typeof messages === "string" ?
              [{
                role: "user",
                content: TextContent.makeUnsafe({ text: messages })
              }] :
              messages
            return new GetPromptResult({ messages, description: prompt.description })
          }),
          Effect.catchCause((cause) => {
            const prettyError = Cause.prettyErrors(cause)[0]
            return Effect.fail(new InternalError({ message: prettyError.message }))
          }),
          Effect.provideServices(services as ServiceMap.ServiceMap<unknown>)
        )
    })
  })
}

/**
 * Register a prompt with the McpServer.
 *
 * @since 4.0.0
 * @category prompts
 */
export const prompt = <
  E,
  R,
  Params extends Schema.Struct.Fields = {},
  const Completions extends {
    readonly [K in keyof Params]?: (input: string) => Effect.Effect<Array<Params[K]["Type"]>, unknown, unknown>
  } = {}
>(
  options: {
    readonly name: string
    readonly description?: string | undefined
    readonly parameters?: Params | undefined
    readonly completion?: ValidateCompletions<Completions, Extract<keyof Params, string>> | undefined
    readonly content: (
      params: Schema.Struct.Type<Params>
    ) => Effect.Effect<Array<typeof PromptMessage.Type> | string, E, R>
    readonly annotations?: ServiceMap.ServiceMap<never> | undefined
  }
): Layer.Layer<never, never, Exclude<Schema.Struct.DecodingServices<Params> | R, McpServerClient>> =>
  Layer.effectDiscard(registerPrompt(options as never)).pipe(
    Layer.provide(McpServer.layer)
  ) as Layer.Layer<never, never, Exclude<Schema.Struct.DecodingServices<Params> | R, McpServerClient>>

/**
 * Create an elicitation request.
 *
 * Removed in MCP 2026-07-28 (stateless draft): the stateless draft has no
 * server-initiated requests. Use MRTR (`InputRequiredResult`) instead — tracked
 * as follow-up work. This helper now always fails with an `InternalError`. See
 * docs/draft-2026-07-28-migration.md.
 *
 * @since 4.0.0
 * @category elicitation
 */
export const elicit: <S extends Schema.Encoder<Record<string, unknown>, unknown>>(options: {
  readonly message: string
  readonly schema: S
}) => Effect.Effect<
  S["Type"],
  InternalError,
  McpServerClient | S["DecodingServices"]
> = (_options) =>
  Effect.fail(
    new InternalError({
      message:
        "server-initiated requests were removed in MCP 2026-07-28; use MRTR (InputRequiredResult) — tracked as follow-up"
    })
  )

/**
 * Create an elicitation request with an explicit JSON Schema payload.
 *
 * Removed in MCP 2026-07-28 (stateless draft). See
 * docs/draft-2026-07-28-migration.md.
 *
 * @since 4.0.0
 * @category elicitation
 */
export const elicitRaw = (
  _params: { readonly message: string; readonly requestedSchema: unknown }
): Effect.Effect<never, InternalError, McpServerClient> =>
  Effect.fail(
    new InternalError({
      message:
        "server-initiated requests were removed in MCP 2026-07-28; use MRTR (InputRequiredResult) — tracked as follow-up"
    })
  )

/**
 * Create a sampling request.
 *
 * Removed in MCP 2026-07-28 (stateless draft). See
 * docs/draft-2026-07-28-migration.md.
 *
 * @since 4.0.0
 * @category sampling
 */
export const sample: (
  _params: unknown
) => Effect.Effect<never, InternalError, McpServerClient> = (_params) =>
  Effect.fail(
    new InternalError({
      message:
        "server-initiated requests were removed in MCP 2026-07-28; use MRTR (InputRequiredResult) — tracked as follow-up"
    })
  )

/**
 * Request the client's configured roots.
 *
 * Removed in MCP 2026-07-28 (stateless draft). See
 * docs/draft-2026-07-28-migration.md.
 *
 * @since 4.0.0
 * @category roots
 */
export const listRoots: Effect.Effect<never, InternalError, McpServerClient> = Effect.fail(
  new InternalError({
    message:
      "server-initiated requests were removed in MCP 2026-07-28; use MRTR (InputRequiredResult) — tracked as follow-up"
  })
)

const sendServerNotification = (
  tag: string,
  payload: unknown,
  clientId?: number | undefined
): Effect.Effect<void, never, McpServer> =>
  Effect.gen(function*() {
    const server = yield* McpServer
    yield* server.sendNotification(
      {
        _tag: "Request",
        tag,
        payload
      } as unknown as RpcMessage.Request<Rpc.Any>,
      clientId
    )
  }).pipe(Effect.catchCause(() => Effect.void))

const sendServerNotificationToCurrentClient = (
  tag: string,
  payload: unknown
): Effect.Effect<void, never, McpServer | McpServerClient> =>
  Effect.gen(function*() {
    const client = yield* McpServerClient
    yield* sendServerNotification(tag, payload, client.clientId)
  }).pipe(Effect.catchCause(() => Effect.void))

/**
 * Send a logging notification to connected clients.
 *
 * @since 4.0.0
 * @category logging
 */
export const sendLoggingMessage = (
  params: typeof LoggingMessageNotification.payloadSchema.Type
): Effect.Effect<void, never, McpServer | McpServerClient> =>
  sendServerNotificationToCurrentClient(serverNotificationMethod("LoggingMessageNotification"), params)

/**
 * Send a progress notification to connected clients.
 *
 * @since 4.0.0
 * @category progress
 */
export const sendProgress = (
  params: typeof ProgressNotification.payloadSchema.Type
): Effect.Effect<void, never, McpServer | McpServerClient> =>
  sendServerNotificationToCurrentClient(serverNotificationMethod("ProgressNotification"), params)

/**
 * Notify clients that the resource list changed.
 *
 * @since 4.0.0
 * @category resources
 */
export const sendResourceListChanged: Effect.Effect<void, never, McpServer> =
  sendServerNotification(serverNotificationMethod("ResourceListChangedNotification"), {})

/**
 * Notify clients that a subscribed resource changed.
 *
 * @since 4.0.0
 * @category resources
 */
export const sendResourceUpdated = (
  params: typeof ResourceUpdatedNotification.payloadSchema.Type
): Effect.Effect<void, never, McpServer | McpServerClient> =>
  sendServerNotification(serverNotificationMethod("ResourceUpdatedNotification"), params)

/**
 * Notify clients that the tool list changed.
 *
 * @since 4.0.0
 * @category tools
 */
export const sendToolListChanged: Effect.Effect<void, never, McpServer> =
  sendServerNotification(serverNotificationMethod("ToolListChangedNotification"), {})

/**
 * Notify clients that the prompt list changed.
 *
 * @since 4.0.0
 * @category prompts
 */
export const sendPromptListChanged: Effect.Effect<void, never, McpServer> =
  sendServerNotification(serverNotificationMethod("PromptListChangedNotification"), {})

/**
 * Access the current client's capabilities.
 *
 * @since 4.0.0
 * @category capabilities
 */
export const clientCapabilities: Effect.Effect<
  ClientCapabilities,
  never,
  McpServerClient
> = McpServerClient.useSync((_) => _.initializePayload.capabilities ?? {})

// -----------------------------------------------------------------------------
// Internal
// -----------------------------------------------------------------------------

const makeUriMatcher = <A>() => {
  const router = FindMyWay.make<A>({
    ignoreTrailingSlash: true,
    ignoreDuplicateSlashes: true,
    caseSensitive: true
  })
  const add = (uri: string, value: A) => {
    router.on("GET", uri as never, value)
  }
  const find = (uri: string) => router.find("GET", uri)

  return { add, find } as const
}

const compileUriTemplate = (segments: TemplateStringsArray, ...schemas: ReadonlyArray<Schema.Top>) => {
  let routerPath = segments[0].replace(":", "::")
  let uriPath = segments[0]
  const params: Record<string, Schema.Top> = {}
  let pathSchema = Schema.Tuple([]) as Schema.Top
  if (schemas.length > 0) {
    const arr: Array<Schema.Top> = []
    for (let i = 0; i < schemas.length; i++) {
      const toCodecStringTree = Schema.toCodecStringTree(schemas[i])
      const segment = segments[i + 1]
      const key = String(i)
      arr.push(toCodecStringTree)
      routerPath += `:${key}${segment.replace(":", "::")}`
      const schema = schemas[i]
      const paramName = isParam(schema) ? (schema as Param<string, Schema.Top>).name : `param${key}`
      params[paramName] = toCodecStringTree
      uriPath += `{${paramName}}${segment}`
    }
    pathSchema = Schema.Tuple(arr)
  }
  return {
    routerPath,
    uriPath,
    schema: pathSchema,
    params
  } as const
}

const layerHandlers = (serverInfo: {
  readonly name: string
  readonly version: string
  readonly instructions?: string | undefined
  readonly extensions?: ExtensionCapabilities | undefined
  readonly supportedProtocolVersions?: ReadonlyArray<string> | undefined
}) =>
  ClientRpcs.toLayer(
    Effect.gen(function*() {
      const server = yield* McpServer
      // setLevel was removed in MCP 2026-07-28 (stateless draft), so the log
      // level is fixed for the lifetime of the handler layer.
      const currentLogLevel = yield* CurrentLogLevel

      return ClientRpcs.of({
        // Requests
        // `server/discover` replaces `initialize` in MCP 2026-07-28 (stateless
        // draft). It computes capabilities the same way (tools/resources/prompts/
        // completions; extensions if provided) but does NOT advertise `logging`
        // or `tasks`, and does NOT mint a session id. See
        // docs/draft-2026-07-28-migration.md.
        [clientRequestMethods.discover](_params) {
          const supportedVersions = serverInfo.supportedProtocolVersions ?? SUPPORTED_PROTOCOL_VERSIONS
          const capabilities: Types.DeepMutable<typeof ServerCapabilities.Type> = {
            completions: {}
          }
          if (server.tools.length > 0) {
            capabilities.tools = { listChanged: true }
          }
          if (server.resources.length > 0 || server.resourceTemplates.length > 0) {
            capabilities.resources = {
              listChanged: true,
              subscribe: false
            }
          }
          if (server.prompts.length > 0) {
            capabilities.prompts = { listChanged: true }
          }
          if (serverInfo.extensions !== undefined) {
            capabilities.extensions = normalizeExtensionCapabilities(
              serverInfo.extensions
            ) as typeof capabilities.extensions
          }
          // The mcp-protocol-version response header is set for every request
          // in patchedProtocol.run, so the discover handler does not set it
          // again. The draft requires every result to carry resultType, and
          // DiscoverResult (a CacheableResult) to carry ttlMs/cacheScope.
          // ttlMs: 0 = always re-fetch; cacheScope: "private" is the
          // conservative default for request-context-sensitive server state.
          return Effect.succeed({
            resultType: "complete",
            ttlMs: 0,
            cacheScope: "private" as const,
            supportedVersions: [...supportedVersions],
            capabilities,
            serverInfo,
            instructions: serverInfo.instructions
          })
        },
        [clientRequestMethods.complete]: (r) =>
          server.completion(r).pipe(
            Effect.provideService(CurrentLogLevel, currentLogLevel)
          ),
        [clientRequestMethods.getPrompt]: (r) =>
          server.getPromptResult(r).pipe(
            Effect.provideService(CurrentLogLevel, currentLogLevel)
          ),
        // List handlers filter by the calling client's capabilities
        // (EnabledWhen), read from the request `_meta`-derived ClientContext
        // the middleware provides. See docs/draft-2026-07-28-migration.md.
        [clientRequestMethods.listPrompts]: () =>
          McpServerClient.useSync(({ initializePayload }) =>
            new ListPromptsResult({
              ...privateCacheableResult,
              prompts: filterByClient(initializePayload, server.prompts, "prompt")
            })
          ),
        [clientRequestMethods.listResources]: () =>
          McpServerClient.useSync(({ initializePayload }) =>
            new ListResourcesResult({
              ...privateCacheableResult,
              resources: filterByClient(initializePayload, server.resources, "resource")
            })
          ),
        [clientRequestMethods.readResource]: ({ uri }) =>
          server.findResource(uri).pipe(
            Effect.provideService(CurrentLogLevel, currentLogLevel)
          ),
        [clientRequestMethods.listResourceTemplates]: () =>
          McpServerClient.useSync(({ initializePayload }) =>
            new ListResourceTemplatesResult({
              ...privateCacheableResult,
              resourceTemplates: filterByClient(
                initializePayload,
                server.resourceTemplates,
                "template"
              )
            })
          ),
        // Minimal acknowledgement stub. Full streaming behavior is follow-up
        // work. See docs/draft-2026-07-28-migration.md.
        [clientRequestMethods.subscriptionsListen]: () => Effect.succeed({ resultType: "complete" }),
        [clientRequestMethods.callTool]: (r) =>
          server.callTool(r).pipe(
            Effect.provideService(CurrentLogLevel, currentLogLevel)
          ),
        [clientRequestMethods.listTools]: () =>
          McpServerClient.useSync(({ initializePayload }) =>
            new ListToolsResult({
              ...privateCacheableResult,
              tools: filterByClient(initializePayload, server.tools, "tool")
            })
          ),

        // Notifications
        [clientNotificationMethods.cancelled]: (_) => Effect.void
      })
    })
  )

const resolveResourceContent = (
  uri: string,
  content: ReadResourceContentInput
): typeof ReadResourceResult.Type => {
  if (typeof content === "string") {
    return {
      ...privateCacheableResult,
      contents: [{
        uri,
        text: content
      }]
    }
  } else if (content instanceof Uint8Array) {
    return {
      ...privateCacheableResult,
      contents: [{
        uri,
        blob: content
      }]
    }
  }
  return {
    ...privateCacheableResult,
    ...content
  }
}

const resolveToolResult = (
  content: CallToolResult | string | ReadonlyArray<typeof ContentBlock.Type>
): CallToolResult => {
  if (typeof content === "string") {
    return new CallToolResult({
      content: [TextContent.makeUnsafe({ text: content })]
    })
  }
  if (Array.isArray(content)) {
    return new CallToolResult({ content })
  }
  return content as CallToolResult
}

const filterByClient = <
  A extends {
    readonly annotations: ServiceMap.ServiceMap<never>
  },
  P extends keyof A
>(
  client: typeof ClientContext.Type | undefined,
  items: ReadonlyArray<A>,
  prop: P
): Array<A[P]> => {
  if (!client) {
    return items.map((item) => item[prop])
  }
  const out = Arr.empty<A[P]>()
  for (let i = 0; i < items.length; i++) {
    const item = items[i]
    const enabledWhen = ServiceMap.getOrUndefined(item.annotations, EnabledWhen)
    if (!enabledWhen || enabledWhen(client)) {
      out.push(item[prop])
    }
  }
  return out
}

// getInitializedClient removed in MCP 2026-07-28 (stateless draft): there is no
// session map / Mcp-Session-Id to resolve a stored client from. See
// docs/draft-2026-07-28-migration.md.
