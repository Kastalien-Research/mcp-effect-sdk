/**
 * Effect 3-native MCP server registry for the frozen modern draft surface.
 *
 * The JSON-RPC and transport rewrite remains WP4. This module establishes the
 * stable Context/Layer substrate and preserves the existing modern registry
 * behavior without Effect RPC, unstable imports, or Effect AI coupling.
 */
import * as Cause from "effect/Cause"
import * as Context from "effect/Context"
import * as Effect from "effect/Effect"
import * as Either from "effect/Either"
import * as JSONSchema from "effect/JSONSchema"
import * as Layer from "effect/Layer"
import * as Option from "effect/Option"
import * as Queue from "effect/Queue"
import * as Schema from "effect/Schema"
import * as SchemaAST from "effect/SchemaAST"
import type * as Scope from "effect/Scope"
import * as McpDispatcher from "./McpDispatcher.js"
import type { JsonValue } from "./McpErrors.js"
import { SchemaValidationError } from "./McpErrors.js"
import type {
  JsonRpcErrorResponse,
  JsonRpcNotification,
  JsonRpcRequest,
  JsonRpcSuccessResponse
} from "./McpWire.js"
import {
  CallToolResult,
  BlobResourceContents,
  Annotations,
  ClientContext,
  CompleteResult,
  EnabledWhen,
  GetPromptResult,
  InputRequiredResult,
  InternalError,
  Implementation,
  InvalidParams,
  ListPromptsResult,
  ListResourceTemplatesResult,
  ListResourcesResult,
  ListToolsResult,
  McpServerClient,
  MethodNotFound,
  Prompt,
  PromptArgument,
  PromptMessage,
  ReadResourceResult,
  Resource,
  ResourceTemplate,
  TextResourceContents,
  TextContent,
  Tool,
  type ContentBlock,
  type McpError,
  type McpServerClientService,
  type Param
} from "./McpSchema.js"
import {
  makeDiscoverResult,
  MCP_SERVER_INFO_META_KEY,
  MODERN_PROTOCOL_VERSION
} from "./McpModern.js"
import {
  CLIENT_NOTIFICATION_METHOD_BY_TYPE,
  CLIENT_REQUEST_METHOD_BY_TYPE,
  CLIENT_REQUEST_RESULT_CODEC_BY_METHOD,
  SERVER_NOTIFICATION_METHOD_BY_TYPE,
  SERVER_REQUEST_METHOD_BY_TYPE
} from "./generated/mcp/2026-07-28/McpProtocol.generated.js"
import {
  ProgressNotificationParams,
  ProgressToken
} from "./generated/mcp/2026-07-28/McpSchema.generated.js"
import { InputRequest } from "./generated/mcp/2026-07-28/McpSchema.generated.js"
import { MissingRequiredClientCapabilityError } from "./McpErrors.js"
import { withRequestAnnotations } from "./internal/RuntimeContext.js"
import {
  cloneExactUint8Array,
  invalidExactUint8Array,
  notArrayBufferView
} from "./internal/ExactUint8Array.js"
import {
  cloneSchemaJson,
  cloneStrictJson,
  defineJsonProperty,
  invalidStrictJson
} from "./internal/StrictJson.js"
import { snapshotConstructorOptions } from "./internal/ConstructorOptions.js"
import {
  containSchemaCallback as containSchemaCallbackCause,
  mapSchemaCause
} from "./internal/SchemaCallback.js"
import {
  JsonSchemaValidator,
  snapshotJsonSchemaResolverService,
  type CompiledJsonSchema,
  type JsonSchema,
  type JsonSchemaResolverService,
  type JsonSchemaValidatorService
} from "./JsonSchemaRuntime.js"
import {
  normalizeExtensionCapabilities,
  type ExtensionCapabilities
} from "./internal/ExtensionCapabilities.js"
import {
  PaginationCursor,
  normalizePaginationPolicy,
  randomOpaque128,
  type NormalizedPaginationPolicy,
  type PaginatedCollection,
  type PaginationCursorService,
  type PaginationCursorState,
  type PaginationPolicy
} from "./Pagination.js"

export { normalizeExtensionCapabilities }
export type { ExtensionCapabilities }

export interface ServerNotification {
  readonly tag: string
  readonly payload: unknown
}

export interface McpServerOptions<R = never> {
  readonly serverInfo: Implementation
  readonly handlers: Effect.Effect<void, SchemaValidationError, McpServer | R>
  readonly instructions?: string
  readonly extensions?: ExtensionCapabilities
  readonly supportedProtocolVersions?: ReadonlyArray<string>
  readonly jsonSchemaValidator?: JsonSchemaValidatorService
  readonly jsonSchemaResolver?: JsonSchemaResolverService
  readonly pagination?: PaginationPolicy
  readonly paginationCursor?: PaginationCursorService
}

interface McpServerConfiguration {
  readonly serverInfo: Implementation
  readonly instructions?: string
  readonly extensions?: ExtensionCapabilities
  readonly supportedProtocolVersions?: ReadonlyArray<string>
  readonly jsonSchemaValidator: JsonSchemaValidatorService
  readonly jsonSchemaResolver?: JsonSchemaResolverService
  readonly pagination: NormalizedPaginationPolicy
  readonly paginationCursor?: PaginationCursorService
}

type RequestId = string | number
type SubscriptionFilter = {
  readonly toolsListChanged?: boolean
  readonly promptsListChanged?: boolean
  readonly resourcesListChanged?: boolean
  readonly resourceSubscriptions?: ReadonlyArray<string>
}
type SubscriptionSink = (notification: ServerNotification) => Effect.Effect<void>

type Fields = Schema.Struct.Fields
type FieldValues<F extends Fields> = { readonly [K in keyof F]: Schema.Schema.Type<F[K]> }
type VisibilityAnnotations = Context.Context<never>
type StableContext<R> = Exclude<R, McpServerClient | McpServer | McpRequestContext>

export interface ProgressUpdate {
  readonly progress: number
  readonly total?: number
  readonly message?: string
}

export interface McpRequestContextService {
  readonly request: JsonRpcRequest
  readonly id: string | number
  readonly protocolVersion: string
  readonly clientCapabilities: unknown
  readonly extensions: unknown
  readonly clientInfo: unknown
  readonly authorizationPrincipal: unknown
  readonly progressToken: Option.Option<typeof ProgressToken.Type>
  readonly cancelled: Effect.Effect<void>
  readonly isCancelled: Effect.Effect<boolean>
  readonly reportProgress: (update: ProgressUpdate) => Effect.Effect<void, SchemaValidationError>
  readonly annotations: Context.Context<never>
}

export class McpRequestContext extends Context.Tag("mcp/McpStableRequestContext")<
  McpRequestContext,
  McpRequestContextService
>() {}
interface RegisteredTool {
  readonly tool: Tool
  readonly annotations: VisibilityAnnotations
  readonly outputValidator?: CompiledJsonSchema
  readonly handler: (request: { readonly name: string; readonly arguments?: Record<string, unknown>; readonly inputResponses?: Record<string, unknown>; readonly requestState?: string; readonly _meta?: Record<string, unknown> }) => Effect.Effect<CallToolResult | InputRequiredResult, SchemaValidationError, McpServerClient>
}

interface RegisteredResource {
  readonly resource: Resource
  readonly annotations: VisibilityAnnotations
  readonly read: (uri: string) => Effect.Effect<ReadResourceResult | InputRequiredResult, McpError, McpServerClient>
}

interface RegisteredTemplate {
  readonly template: ResourceTemplate
  readonly annotations: VisibilityAnnotations
  readonly match: (uri: string) => ReadonlyArray<string> | undefined
  readonly read: (uri: string, values: ReadonlyArray<string>) => Effect.Effect<ReadResourceResult | InputRequiredResult, McpError, McpServerClient>
  readonly completions: Readonly<Record<string, (input: string) => Effect.Effect<CompleteResult, McpError, McpServerClient>>>
}

interface RegisteredPrompt {
  readonly prompt: Prompt
  readonly annotations: VisibilityAnnotations
  readonly get: (args: Record<string, string>) => Effect.Effect<GetPromptResult | InputRequiredResult, McpError, McpServerClient>
  readonly completions: Readonly<Record<string, (input: string) => Effect.Effect<CompleteResult, McpError, McpServerClient>>>
}

export interface McpServerService {
  readonly tools: Array<RegisteredTool>
  readonly resources: Array<RegisteredResource>
  readonly resourceTemplates: Array<RegisteredTemplate>
  readonly prompts: Array<RegisteredPrompt>
  readonly notificationsQueue: Queue.Queue<ServerNotification>
  readonly options: McpServerConfiguration
  readonly publish: (notification: ServerNotification) => Effect.Effect<void, SchemaValidationError>
  readonly openSubscription: (
    id: RequestId,
    filter: SubscriptionFilter,
    sink: SubscriptionSink
  ) => () => void
  readonly addTool: (entry: RegisteredTool) => Effect.Effect<void, SchemaValidationError>
  readonly addResource: (entry: RegisteredResource) => Effect.Effect<void, SchemaValidationError>
  readonly addResourceTemplate: (entry: RegisteredTemplate) => Effect.Effect<void, SchemaValidationError>
  readonly addPrompt: (entry: RegisteredPrompt) => Effect.Effect<void, SchemaValidationError>
  readonly callTool: (request: { readonly name: string; readonly arguments?: Record<string, unknown>; readonly inputResponses?: Record<string, unknown>; readonly requestState?: string; readonly _meta?: Record<string, unknown> }) => Effect.Effect<CallToolResult | InputRequiredResult, McpError, McpServerClient>
  readonly findResource: (uri: string) => Effect.Effect<ReadResourceResult | InputRequiredResult, McpError, McpServerClient>
  readonly getPromptResult: (request: { readonly name: string; readonly arguments?: Record<string, string>; readonly inputResponses?: Record<string, unknown>; readonly requestState?: string }) => Effect.Effect<GetPromptResult | InputRequiredResult, McpError, McpServerClient>
  readonly completion: (request: {
    readonly ref: { readonly type: "ref/resource"; readonly uri: string } | { readonly type: "ref/prompt"; readonly name: string }
    readonly argument: { readonly name: string; readonly value: string }
  }) => Effect.Effect<CompleteResult, McpError, McpServerClient>
}

export class McpServer extends Context.Tag("mcp/McpServer")<McpServer, McpServerService>() {}

interface PaginationRuntime {
  readonly owner: string
  readonly cursor: PaginationCursorService
  readonly revisions: Record<PaginatedCollection, number>
}

const paginationRuntimes = new WeakMap<McpServerService, PaginationRuntime>()

const paginationRuntime = (server: McpServerService): PaginationRuntime => {
  const runtime = paginationRuntimes.get(server)
  if (runtime === undefined) throw new Error("Missing internal pagination runtime")
  return runtime
}

/** @internal Preserve private pagination ownership across an internal filtered server view. */
export const copyPaginationRuntime = (
  source: McpServerService,
  target: McpServerService
): McpServerService => {
  paginationRuntimes.set(target, paginationRuntime(source))
  return target
}

const makeService = (options: McpServerConfiguration): Effect.Effect<McpServerService, SchemaValidationError> => Effect.gen(function*() {
    const notificationsQueue = yield* Queue.sliding<ServerNotification>(64)
    const paginationOwner = yield* randomOpaque128()
    const paginationCursor = options.paginationCursor ?? (yield* PaginationCursor.memory())
    const paginationRevisions: Record<PaginatedCollection, number> = {
      tools: 0,
      resources: 0,
      resourceTemplates: 0,
      prompts: 0
    }
    const tools: Array<RegisteredTool> = []
    const resources: Array<RegisteredResource> = []
    const resourceTemplates: Array<RegisteredTemplate> = []
    const prompts: Array<RegisteredPrompt> = []
    const completions = new Map<
      string,
      (input: string) => Effect.Effect<CompleteResult, McpError, McpServerClient>
    >()
    const subscriptions = new Map<symbol, {
      readonly id: RequestId
      readonly filter: SubscriptionFilter
      readonly sink: SubscriptionSink
    }>()

    const invalidateCollections = (collections: ReadonlyArray<PaginatedCollection>) => Effect.gen(function*() {
      if (collections.length > 0) yield* paginationCursor.invalidate(Object.freeze([...collections]))
      for (const collection of collections) {
        paginationRevisions[collection] += 1
      }
    })

    const changedCollections = (notification: ServerNotification): ReadonlyArray<PaginatedCollection> => {
      if (notification.tag === SERVER_NOTIFICATION_METHOD_BY_TYPE.ToolListChangedNotification) return ["tools"]
      if (notification.tag === SERVER_NOTIFICATION_METHOD_BY_TYPE.PromptListChangedNotification) return ["prompts"]
      if (notification.tag === SERVER_NOTIFICATION_METHOD_BY_TYPE.ResourceListChangedNotification) {
        return ["resources", "resourceTemplates"]
      }
      return []
    }

    const exposeNotification = (notification: ServerNotification): Effect.Effect<void> => Effect.all([
      Queue.offer(notificationsQueue, notification).pipe(Effect.asVoid),
      Effect.forEach(
        Array.from(subscriptions.entries()),
        ([, subscription]) => matchesSubscription(subscription.filter, notification)
          ? subscription.sink(withSubscriptionId(notification, subscription.id)).pipe(
            Effect.catchAllCause((cause) => Cause.isInterruptedOnly(cause)
              ? Effect.failCause(cause)
              : Effect.void)
          )
          : Effect.void,
        { discard: true }
      )
    ]).pipe(Effect.asVoid)

    const publish = (notification: ServerNotification): Effect.Effect<void, SchemaValidationError> => Effect.gen(function*() {
      yield* invalidateCollections(changedCollections(notification))
      yield* exposeNotification(notification)
    })

    const commitRegistryChange = (
      notification: ServerNotification,
      mutate: () => void
    ): Effect.Effect<void, SchemaValidationError> => Effect.gen(function*() {
      yield* invalidateCollections(changedCollections(notification))
      yield* Effect.sync(mutate)
      yield* exposeNotification(notification)
    })

    const openSubscription: McpServerService["openSubscription"] = (id, filter, sink) => {
      const key = Symbol()
      subscriptions.set(key, { id, filter, sink })
      return () => {
        subscriptions.delete(key)
      }
    }

    const addTool = (entry: RegisteredTool) => commitRegistryChange({
      tag: SERVER_NOTIFICATION_METHOD_BY_TYPE.ToolListChangedNotification,
      payload: {}
    }, () => {
      const current = tools.findIndex(({ tool }) => tool.name === entry.tool.name)
      if (current >= 0) tools.splice(current, 1)
      tools.push(entry)
      tools.sort((left, right) => left.tool.name.localeCompare(right.tool.name))
    })
    const addResource = (entry: RegisteredResource) => commitRegistryChange({
      tag: SERVER_NOTIFICATION_METHOD_BY_TYPE.ResourceListChangedNotification,
      payload: {}
    }, () => {
      const current = resources.findIndex(({ resource }) => resource.uri === entry.resource.uri)
      if (current >= 0) resources.splice(current, 1)
      resources.push(entry)
      resources.sort((left, right) => left.resource.uri.localeCompare(right.resource.uri))
    })
    const addResourceTemplate = (entry: RegisteredTemplate) => commitRegistryChange({
      tag: SERVER_NOTIFICATION_METHOD_BY_TYPE.ResourceListChangedNotification,
      payload: {}
    }, () => {
      const current = resourceTemplates.findIndex(({ template }) =>
        template.uriTemplate === entry.template.uriTemplate)
      if (current >= 0) {
        const replaced = resourceTemplates[current]!
        for (const name of Object.keys(replaced.completions)) {
          completions.delete(`ref/resource/${replaced.template.uriTemplate}/${name}`)
        }
        resourceTemplates.splice(current, 1)
      }
      resourceTemplates.push(entry)
      for (const [name, handler] of Object.entries(entry.completions)) {
        completions.set(`ref/resource/${entry.template.uriTemplate}/${name}`, handler)
      }
    })
    const addPrompt = (entry: RegisteredPrompt) => commitRegistryChange({
      tag: SERVER_NOTIFICATION_METHOD_BY_TYPE.PromptListChangedNotification,
      payload: {}
    }, () => {
      const current = prompts.findIndex(({ prompt }) => prompt.name === entry.prompt.name)
      if (current >= 0) {
        const replaced = prompts[current]!
        for (const name of Object.keys(replaced.completions)) {
          completions.delete(`ref/prompt/${replaced.prompt.name}/${name}`)
        }
        prompts.splice(current, 1)
      }
      prompts.push(entry)
      prompts.sort((left, right) => left.prompt.name.localeCompare(right.prompt.name))
      for (const [name, handler] of Object.entries(entry.completions)) {
        completions.set(`ref/prompt/${entry.prompt.name}/${name}`, handler)
      }
    })

    const callTool: McpServerService["callTool"] = (request) => {
      const entry = tools.find(({ tool }) => tool.name === request.name)
      return entry
        ? entry.handler(request)
        : Effect.fail(new InvalidParams({ message: `Tool '${request.name}' not found` }))
    }
    const findResource: McpServerService["findResource"] = (uri) => {
      const direct = resources.find(({ resource }) => resource.uri === uri)
      if (direct) return direct.read(uri)
      for (const template of resourceTemplates) {
        const values = template.match(uri)
        if (values) return template.read(uri, values)
      }
      return Effect.fail(new InvalidParams({ message: `Resource '${uri}' not found` }))
    }
    const getPromptResult: McpServerService["getPromptResult"] = (request) => {
      const entry = prompts.find(({ prompt }) => prompt.name === request.name)
      return entry
        ? entry.get(request.arguments ?? {})
        : Effect.fail(new InvalidParams({ message: `Prompt '${request.name}' not found` }))
    }
    const completion: McpServerService["completion"] = (request) => {
      const key = request.ref.type === "ref/resource"
        ? `ref/resource/${request.ref.uri}/${request.argument.name}`
        : `ref/prompt/${request.ref.name}/${request.argument.name}`
      return completions.get(key)?.(request.argument.value) ?? Effect.succeed(new CompleteResult({
        resultType: "complete",
        completion: { values: [] }
      }))
    }

    const server: McpServerService = {
      tools, resources, resourceTemplates, prompts, notificationsQueue, options,
      publish, openSubscription, addTool, addResource, addResourceTemplate, addPrompt,
      callTool, findResource, getPromptResult, completion
    }
    paginationRuntimes.set(server, Object.freeze({
      owner: paginationOwner,
      cursor: paginationCursor,
      revisions: paginationRevisions
    }))
    return server
})

export const make = <R>(
  options: McpServerOptions<R>
): Effect.Effect<McpServerService, SchemaValidationError, Exclude<R, McpServer>> => Effect.gen(function*() {
  const constructionContext = yield* Effect.context<never>()
  const snapshot = yield* Effect.try({
    try: () => snapshotConstructorOptions(options) as unknown as McpServerOptions<R>,
    catch: (cause) => new SchemaValidationError({
      message: "Invalid MCP server configuration",
      cause
    })
  })
  const configuration = yield* validateServerConfiguration(snapshot, constructionContext)
  const server = yield* makeService(configuration)
  yield* snapshot.handlers.pipe(Effect.provideService(McpServer, server))
  return server
})

export const layer = <R>(
  options: McpServerOptions<R>
): Layer.Layer<McpServer, SchemaValidationError, Exclude<R, McpServer>> =>
  Layer.effect(McpServer, make(options))

const validateServerConfiguration = <R>(
  options: McpServerOptions<R>,
  constructionContext: Context.Context<never>
): Effect.Effect<McpServerConfiguration, SchemaValidationError> => Effect.try({
  try: () => {
    if (!Effect.isEffect(options.handlers)) {
      throw new Error("Server handlers must be an Effect")
    }
    if (options.instructions !== undefined && typeof options.instructions !== "string") {
      throw new Error("Server instructions must be a string")
    }
    if (options.supportedProtocolVersions !== undefined &&
      options.supportedProtocolVersions.some((version) => typeof version !== "string" || version.length === 0)) {
      throw new Error("Supported protocol versions must be non-empty strings")
    }
    const jsonSchemaValidator = snapshotJsonSchemaValidator(
      options.jsonSchemaValidator ?? JsonSchemaValidator.default
    )
    const jsonSchemaResolver = options.jsonSchemaResolver === undefined
      ? undefined
      : snapshotJsonSchemaResolverService(options.jsonSchemaResolver)
    const pagination = normalizePaginationPolicy(options.pagination)
    const paginationCursor = options.paginationCursor === undefined
      ? undefined
      : snapshotPaginationCursorService(options.paginationCursor, constructionContext)

    const inspected = cloneSchemaJson(options.serverInfo)
    if (inspected === invalidStrictJson) {
      throw new Error("Could not inspect server info")
    }
    const decoded = Schema.decodeUnknownEither(Implementation)(inspected)
    const exact = Either.isRight(decoded)
      ? decoded
      : Schema.validateEither(Implementation)(inspected)
    if (Either.isLeft(exact)) throw exact.left
    const encoded = Schema.encodeUnknownEither(Implementation)(exact.right)
    if (Either.isLeft(encoded)) throw encoded.left
    const serverInfo = cloneStrictJson(encoded.right)
    if (serverInfo === invalidStrictJson ||
      typeof serverInfo !== "object" || serverInfo === null || Array.isArray(serverInfo)) {
      throw new Error("Server info must be canonical JSON")
    }

    return {
      serverInfo: serverInfo as unknown as Implementation,
      jsonSchemaValidator,
      pagination,
      ...(paginationCursor === undefined ? {} : { paginationCursor }),
      ...(jsonSchemaResolver === undefined
        ? {}
        : { jsonSchemaResolver }),
      ...(options.instructions === undefined ? {} : { instructions: options.instructions }),
      ...(options.extensions === undefined
        ? {}
        : { extensions: normalizeExtensionCapabilities(options.extensions) }),
      ...(options.supportedProtocolVersions === undefined
        ? {}
        : { supportedProtocolVersions: [...options.supportedProtocolVersions] })
    }
  },
  catch: (cause) => cause instanceof SchemaValidationError
    ? cause
    : new SchemaValidationError({
        message: "Invalid MCP server configuration",
        cause
      })
})

const findDataProperty = (target: unknown, key: PropertyKey): { readonly found: boolean; readonly value?: unknown } => {
  if ((typeof target !== "object" && typeof target !== "function") || target === null) return { found: false }
  let current: object | null = target
  const seen = new Set<object>()
  while (current !== null && !seen.has(current)) {
    seen.add(current)
    const descriptor = Object.getOwnPropertyDescriptor(current, key)
    if (descriptor !== undefined) {
      return "value" in descriptor
        ? { found: true, value: descriptor.value }
        : { found: false }
    }
    current = Object.getPrototypeOf(current)
  }
  return { found: false }
}

const paginationCallbackError = (
  message: string,
  cause: Cause.Cause<unknown>
): SchemaValidationError => {
  const error = new SchemaValidationError({ message })
  Object.defineProperty(error, "cause", {
    configurable: true,
    enumerable: false,
    value: cause,
    writable: false
  })
  return error
}

const containPaginationCallback = <A>(
  thunk: () => unknown,
  context: Context.Context<never>,
  message: string
): Effect.Effect<A, SchemaValidationError> => Effect.suspend(() => {
  const result = thunk()
  return Effect.isEffect(result)
    ? (result as Effect.Effect<A, unknown, never>).pipe(Effect.provide(context))
    : Effect.die(new TypeError("Pagination cursor callback must return an Effect"))
}).pipe(Effect.catchAllCause((cause) => Effect.failCause(mapSchemaCause(
  cause,
  cause,
  (_error, original) => paginationCallbackError(message, original),
  (_defect, original) => paginationCallbackError(message, original)
))))

const snapshotPaginationCursorService = (
  value: unknown,
  context: Context.Context<never>
): PaginationCursorService => {
  const issue = findDataProperty(value, "issue")
  const resolve = findDataProperty(value, "resolve")
  const invalidate = findDataProperty(value, "invalidate")
  if (!issue.found || typeof issue.value !== "function" ||
    !resolve.found || typeof resolve.value !== "function" ||
    !invalidate.found || typeof invalidate.value !== "function") {
    throw new TypeError("Pagination cursor service methods must be data functions")
  }
  return Object.freeze({
    issue: (state: PaginationCursorState) => containPaginationCallback<string>(
      () => Reflect.apply(issue.value as (...args: ReadonlyArray<unknown>) => unknown, value, [state]),
      context,
      "Pagination cursor issue failed"
    ),
    resolve: (cursor: string) => containPaginationCallback<PaginationCursorState>(
      () => Reflect.apply(resolve.value as (...args: ReadonlyArray<unknown>) => unknown, value, [cursor]),
      context,
      "Pagination cursor resolve failed"
    ),
    invalidate: (collections?: ReadonlyArray<PaginatedCollection>) => containPaginationCallback<void>(
      () => Reflect.apply(invalidate.value as (...args: ReadonlyArray<unknown>) => unknown, value, [collections]),
      context,
      "Pagination cursor invalidate failed"
    )
  })
}

const localSchemaError = (message: string, cause: unknown): SchemaValidationError => {
  const error = new SchemaValidationError({ message, cause })
  Object.defineProperty(error, "cause", {
    configurable: true,
    enumerable: false,
    value: cause,
    writable: false
  })
  return error
}

const containSchemaCallback = <A>(
  thunk: () => Effect.Effect<A, unknown>,
  message: string
): Effect.Effect<A, SchemaValidationError> => containSchemaCallbackCause(
  thunk,
  (cause) => localSchemaError(message, cause)
)

const snapshotJsonSchemaValidator = (value: unknown): JsonSchemaValidatorService => {
  const property = findDataProperty(value, "compile")
  if (!property.found || typeof property.value !== "function") {
    throw new TypeError("JSON Schema validator compile must be a data method")
  }
  const compile = property.value
  return Object.freeze({
    compile: (options: Parameters<JsonSchemaValidatorService["compile"]>[0]) => containSchemaCallback(
      () => Reflect.apply(compile, value, [options]) as Effect.Effect<CompiledJsonSchema, unknown>,
      "JSON Schema validator compile failed"
    )
  })
}

const snapshotCompiledJsonSchema = (
  value: unknown
): Effect.Effect<CompiledJsonSchema, SchemaValidationError> => Effect.try({
  try: () => {
    const property = findDataProperty(value, "validate")
    if (!property.found || typeof property.value !== "function") {
      throw new TypeError("Compiled JSON Schema validate must be a data method")
    }
    const validate = property.value
    return Object.freeze({
      validate: (input: unknown) => containSchemaCallback(
        () => Reflect.apply(validate, value, [input]) as Effect.Effect<void, unknown>,
        "JSON Schema validator validate failed"
      )
    })
  },
  catch: (cause) => localSchemaError("Invalid compiled JSON Schema validator", cause)
})

const matchesSubscription = (filter: SubscriptionFilter, notification: ServerNotification): boolean => {
  switch (notification.tag) {
    case SERVER_NOTIFICATION_METHOD_BY_TYPE.ToolListChangedNotification:
      return filter.toolsListChanged === true
    case SERVER_NOTIFICATION_METHOD_BY_TYPE.PromptListChangedNotification:
      return filter.promptsListChanged === true
    case SERVER_NOTIFICATION_METHOD_BY_TYPE.ResourceListChangedNotification:
      return filter.resourcesListChanged === true
    case SERVER_NOTIFICATION_METHOD_BY_TYPE.ResourceUpdatedNotification: {
      if (!isRecord(notification.payload) || typeof notification.payload.uri !== "string") return false
      return filter.resourceSubscriptions?.includes(notification.payload.uri) === true
    }
    default:
      return false
  }
}

const withSubscriptionId = (notification: ServerNotification, id: RequestId): ServerNotification => ({
  tag: notification.tag,
  payload: {
    ...(isRecord(notification.payload) ? notification.payload : {}),
    _meta: {
      ...(isRecord(notification.payload) && isRecord(notification.payload._meta) ? notification.payload._meta : {}),
      "io.modelcontextprotocol/subscriptionId": id
    }
  }
})

const inputRequiredValue = (value: unknown): value is InputRequiredResult => {
  const property = findDataProperty(value, "resultType")
  return property.found && property.value === "input_required"
}

const normalizeToolResult = (value: unknown): CallToolResult | InputRequiredResult => {
  if (inputRequiredValue(value)) return value
  if (value instanceof CallToolResult) return value
  if (typeof value === "string") {
    return new CallToolResult({ resultType: "complete", content: [new TextContent({ type: "text", text: value })] })
  }
  if (Array.isArray(value)) return new CallToolResult({ resultType: "complete", content: value as Array<ContentBlock> })
  if (value && typeof value === "object") {
    const record = snapshotEnumerableDataProperties(value)
    if (record !== undefined && Array.isArray(record.content)) {
      return new CallToolResult({
        ...record,
        resultType: "complete"
      } as ConstructorParameters<typeof CallToolResult>[0])
    }
  }
  const snapshot = cloneStrictJson(value)
  return new CallToolResult({
    resultType: "complete",
    content: [new TextContent({
      type: "text",
      text: snapshot === invalidStrictJson ? "Unserializable tool result" : JSON.stringify(snapshot)
    })],
    structuredContent: value
  })
}

const snapshotEnumerableDataProperties = (value: object): Record<string, unknown> | undefined => {
  try {
    const descriptors = Object.getOwnPropertyDescriptors(value)
    if (Object.getOwnPropertySymbols(descriptors).length > 0) return undefined
    const snapshot: Record<string, unknown> = {}
    for (const [key, descriptor] of Object.entries(descriptors)) {
      if (!descriptor.enumerable) continue
      if (!("value" in descriptor)) continue
      Object.defineProperty(snapshot, key, {
        configurable: true,
        enumerable: true,
        value: descriptor.value,
        writable: true
      })
    }
    return snapshot
  } catch {
    return undefined
  }
}

const normalizeReadResult = (uri: string, value: unknown): ReadResourceResult | InputRequiredResult => {
  if (inputRequiredValue(value)) return value
  if (value instanceof ReadResourceResult) return value
  if (value instanceof Uint8Array) {
    return new ReadResourceResult({
      resultType: "complete", ttlMs: 0, cacheScope: "private",
      contents: [new BlobResourceContents({ uri, blob: value })]
    })
  }
  if (typeof value === "string") {
    return new ReadResourceResult({
      resultType: "complete", ttlMs: 0, cacheScope: "private",
      contents: [new TextResourceContents({ uri, text: value })]
    })
  }
  const record = (value ?? {}) as Record<string, unknown>
  return new ReadResourceResult({
    ...record,
    resultType: "complete",
    ttlMs: typeof record.ttlMs === "number" ? record.ttlMs : 0,
    cacheScope: record.cacheScope === "public" ? "public" : "private",
    contents: Array.isArray(record.contents)
      ? record.contents.map((content) => {
          if (content instanceof TextResourceContents) return content
          const item = content as Record<string, unknown>
          if (content instanceof BlobResourceContents || item.blob instanceof Uint8Array) {
            return content instanceof BlobResourceContents ? content : new BlobResourceContents({
              uri: String(item.uri ?? uri),
              mimeType: typeof item.mimeType === "string" ? item.mimeType : undefined,
              blob: item.blob as Uint8Array
            })
          }
          return new TextResourceContents({
            uri: String(item.uri ?? uri),
            mimeType: typeof item.mimeType === "string" ? item.mimeType : undefined,
            text: typeof item.text === "string" ? item.text : ""
          })
        })
      : []
  })
}

const normalizePromptResult = (value: unknown): GetPromptResult | InputRequiredResult => {
  if (inputRequiredValue(value)) return value
  if (value instanceof GetPromptResult) return value
  if (typeof value === "string") {
    return new GetPromptResult({
      resultType: "complete",
      messages: [new PromptMessage({
        role: "user",
        content: new TextContent({ type: "text", text: value })
      })]
    })
  }
  if (Array.isArray(value)) return new GetPromptResult({ resultType: "complete", messages: value as Array<PromptMessage> })
  return new GetPromptResult({
    ...(value as ConstructorParameters<typeof GetPromptResult>[0]),
    resultType: "complete"
  })
}

const isRequestInputError = (
  error: unknown
): error is InvalidParams | MissingRequiredClientCapabilityError =>
  error instanceof InvalidParams || error instanceof MissingRequiredClientCapabilityError

const preserveRequestInputError = (error: unknown): McpError =>
  isRequestInputError(error)
    ? error
    : new InternalError({ message: String(error) })

interface RegisterToolOptions<F extends Fields, R> {
  readonly name: string
  readonly title?: string
  readonly description?: string
  readonly parameters?: F
  readonly outputSchema?: Readonly<Record<string, unknown>>
  readonly annotations?: VisibilityAnnotations
  readonly content: (params: FieldValues<F>, request: { readonly name: string; readonly arguments?: Record<string, unknown>; readonly _meta?: Record<string, unknown> }) => Effect.Effect<unknown, unknown, R>
}

type RegisterToolWithOutput<F extends Fields, R> = RegisterToolOptions<F, R> & {
  readonly outputSchema: Readonly<Record<string, unknown>>
}

type RegisterToolWithoutOutput<F extends Fields, R> = Omit<RegisterToolOptions<F, R>, "outputSchema"> & {
  readonly outputSchema?: undefined
}

type RegisterToolWithParameters<F extends Fields, R> = RegisterToolWithoutOutput<F, R> & {
  readonly parameters: F
}

type RegisterToolWithoutSchemas<R> = Omit<RegisterToolWithoutOutput<{}, R>, "parameters"> & {
  readonly parameters?: undefined
}

export function registerTool<F extends Fields = {}, R = never>(
  options: RegisterToolWithOutput<F, R>
): Effect.Effect<void, SchemaValidationError, McpServer | StableContext<R | Schema.Struct.Context<F>>>
export function registerTool<F extends Fields = {}, R = never>(
  options: RegisterToolWithParameters<F, R>
): Effect.Effect<void, SchemaValidationError, McpServer | StableContext<R | Schema.Struct.Context<F>>>
export function registerTool<R = never>(
  options: RegisterToolWithoutSchemas<R>
): Effect.Effect<void, SchemaValidationError, McpServer | StableContext<R>>
export function registerTool<F extends Fields = {}, R = never>(
  options: RegisterToolOptions<F, R>
): Effect.Effect<void, SchemaValidationError, McpServer | StableContext<R | Schema.Struct.Context<F>>> {
  return Effect.gen(function*() {
  const server = yield* McpServer
  type Captured = StableContext<R | Schema.Struct.Context<F>>
  const captured = Context.omit(McpServerClient, McpServer, McpRequestContext)(yield* Effect.context<Captured>())
  const parameterSchema = Schema.Struct(options.parameters ?? {} as F)
  const inputSchema = yield* Effect.try({
    try: () => ({
      ...JSONSchema.make(parameterSchema, { target: "jsonSchema2020-12" }),
      type: "object" as const
    }),
    catch: (cause) => localSchemaError("Could not generate tool input JSON Schema", cause)
  })
  const outputSchemaValue = yield* inspectOptionalOutputSchema(options)
  const outputSchema = outputSchemaValue === undefined
    ? undefined
    : yield* inspectToolOutputSchema(outputSchemaValue)
  const compiledOutput = outputSchema === undefined
    ? undefined
    : yield* server.options.jsonSchemaValidator.compile({
      schema: outputSchema,
      ...(server.options.jsonSchemaResolver === undefined
        ? {}
        : { resolver: server.options.jsonSchemaResolver })
    })
  const outputValidator = compiledOutput === undefined
    ? undefined
    : yield* snapshotCompiledJsonSchema(compiledOutput)
  const entry: RegisteredTool = {
    tool: new Tool({
      name: options.name,
      title: options.title,
      description: options.description,
      inputSchema: inputSchema as unknown as ConstructorParameters<typeof Tool>[0]["inputSchema"],
      outputSchema
    }),
    annotations: options.annotations ?? Context.empty(),
    ...(outputValidator === undefined ? {} : { outputValidator }),
    handler: (request) => Schema.decodeUnknown(parameterSchema, {
      onExcessProperty: "error"
    })(request.arguments ?? {}).pipe(
      Effect.mapError((error) => new InvalidParams({ message: String(error) })),
      Effect.flatMap((params) => options.content(params as FieldValues<F>, request).pipe(
        Effect.provide(captured),
        Effect.map(normalizeToolResult),
        Effect.catchAll((error) => isRequestInputError(error)
          ? Effect.fail(error)
          : Effect.succeed(new CallToolResult({
              resultType: "complete",
              isError: true,
              content: [new TextContent({ type: "text", text: error instanceof Error ? error.message : String(error) })]
            })))
      )),
      Effect.flatMap((result) => outputValidator === undefined || inputRequiredValue(result)
        ? Effect.succeed(result)
        : validateToolOutput(outputValidator, result).pipe(Effect.as(result)))
    ) as Effect.Effect<CallToolResult | InputRequiredResult, SchemaValidationError, McpServerClient>
  }
  yield* server.addTool(entry)
  })
}

const inspectToolOutputSchema = (
  value: Readonly<Record<string, unknown>>
): Effect.Effect<Exclude<JsonSchema, boolean>, SchemaValidationError> => Effect.try({
  try: () => {
    const snapshot = cloneStrictJson(value)
    if (snapshot === invalidStrictJson || !isRecord(snapshot)) {
      throw new TypeError("Tool output schema must be a strict JSON object")
    }
    return freezeJson(snapshot)
  },
  catch: (cause) => new SchemaValidationError({
    message: "Invalid tool output JSON Schema",
    cause
  })
}) as Effect.Effect<Exclude<JsonSchema, boolean>, SchemaValidationError>

const freezeJson = <A extends JsonValue>(value: A): A => {
  if (typeof value !== "object" || value === null || Object.isFrozen(value)) return value
  for (const child of Array.isArray(value) ? value : Object.values(value)) freezeJson(child)
  return Object.freeze(value)
}

const inspectOptionalOutputSchema = (
  options: object
): Effect.Effect<Readonly<Record<string, unknown>> | undefined, SchemaValidationError> => Effect.try({
  try: () => {
    const descriptor = Object.getOwnPropertyDescriptor(options, "outputSchema")
    if (descriptor === undefined) return undefined
    if (!("value" in descriptor)) throw new TypeError("Tool output schema must be a data property")
    if (descriptor.value === undefined) return undefined
    if (typeof descriptor.value !== "object" || descriptor.value === null || Array.isArray(descriptor.value)) {
      throw new TypeError("Tool output schema must be an object")
    }
    return descriptor.value as Readonly<Record<string, unknown>>
  },
  catch: (cause) => new SchemaValidationError({
    message: "Invalid tool output JSON Schema",
    cause
  })
})

const validateToolOutput = (
  validator: CompiledJsonSchema,
  result: CallToolResult
): Effect.Effect<void, SchemaValidationError> => {
  const property = Object.getOwnPropertyDescriptor(result, "structuredContent")
  if (property === undefined || !("value" in property) || property.value === undefined) {
    return Effect.fail(toolOutputValidationError())
  }
  return validator.validate(property.value).pipe(
    Effect.catchAllCause((cause) => Effect.failCause(mapSchemaCause(
      cause,
      cause,
      (error) => toolOutputValidationError(error),
      (_defect, original) => toolOutputValidationError(
        localSchemaError("JSON Schema validator validate failed", original)
      )
    )))
  )
}

const toolOutputValidationError = (cause?: SchemaValidationError): SchemaValidationError => {
  const error = new SchemaValidationError({
    message: "Tool output failed JSON Schema validation",
    ...(cause === undefined ? {} : { cause })
  })
  if (cause !== undefined) {
    Object.defineProperty(error, "cause", {
      configurable: true,
      enumerable: false,
      value: cause,
      writable: false
    })
  }
  return error
}

export function tool<F extends Fields = {}, R = never>(
  options: RegisterToolWithOutput<F, R>
): Layer.Layer<never, SchemaValidationError, McpServer | StableContext<R | Schema.Struct.Context<F>>>
export function tool<F extends Fields = {}, R = never>(
  options: RegisterToolWithParameters<F, R>
): Layer.Layer<never, SchemaValidationError, McpServer | StableContext<R | Schema.Struct.Context<F>>>
export function tool<R = never>(
  options: RegisterToolWithoutSchemas<R>
): Layer.Layer<never, SchemaValidationError, McpServer | StableContext<R>>
export function tool<F extends Fields = {}, R = never>(
  options: RegisterToolOptions<F, R>
): Layer.Layer<never, SchemaValidationError, McpServer | StableContext<R | Schema.Struct.Context<F>>> {
  return Layer.effectDiscard(registerTool(options as RegisterToolWithOutput<F, R>))
}

interface ResourceOptions<R> {
  readonly uri: string
  readonly name: string
  readonly title?: string
  readonly description?: string
  readonly mimeType?: string
  readonly audience?: ReadonlyArray<"user" | "assistant">
  readonly priority?: number
  readonly annotations?: VisibilityAnnotations
  readonly content: Effect.Effect<unknown, unknown, R>
}

const protocolAnnotations = (
  audience: ReadonlyArray<"user" | "assistant"> | undefined,
  priority: number | undefined
): Annotations | undefined => audience === undefined && priority === undefined
  ? undefined
  : new Annotations({ audience: audience === undefined ? undefined : [...audience], priority })

type TemplateParams = ReadonlyArray<Param<string, Schema.Schema.Any>>
type TemplateValues<Params extends TemplateParams> = {
  readonly [K in keyof Params]: Params[K] extends Param<string, infer S> ? Schema.Schema.Type<S> : never
}
type TemplateSchemaContext<Params extends TemplateParams> = Schema.Schema.Context<Params[number]["schema"]>
type TemplateCompletions<Params extends TemplateParams> = {
  readonly [P in Params[number] as P["name"]]: (
    input: string
  ) => Effect.Effect<ReadonlyArray<Schema.Schema.Type<P["schema"]>>, unknown, unknown>
}
type EffectContextOf<Handler> = Handler extends (...args: never[]) => Effect.Effect<unknown, unknown, infer R>
  ? R
  : never
type TemplateRequirements<
  Params extends TemplateParams,
  R,
  Completions extends Partial<TemplateCompletions<Params>>
> = StableContext<R | TemplateSchemaContext<Params> | EffectContextOf<Completions[keyof Completions]>>

interface TemplateOptions<
  Params extends TemplateParams,
  R,
  Completions extends Partial<TemplateCompletions<Params>> = {}
> {
  readonly name: string
  readonly title?: string
  readonly description?: string
  readonly mimeType?: string
  readonly audience?: ReadonlyArray<"user" | "assistant">
  readonly priority?: number
  readonly annotations?: VisibilityAnnotations
  readonly completion?: Completions & Partial<TemplateCompletions<Params>>
  readonly content: (uri: string, ...values: TemplateValues<Params>) => Effect.Effect<unknown, unknown, R>
}

export function registerResource<R>(options: ResourceOptions<R>): Effect.Effect<void, SchemaValidationError, McpServer | StableContext<R>>
export function registerResource<const Params extends TemplateParams>(
  strings: TemplateStringsArray,
  ...params: Params
): <R, const Completions extends Partial<TemplateCompletions<Params>> = {}>(
  options: TemplateOptions<Params, R, Completions>
) => Effect.Effect<
  void,
  SchemaValidationError,
  McpServer | TemplateRequirements<Params, R, Completions>
>
export function registerResource<R>(
  first: ResourceOptions<R> | TemplateStringsArray,
  ...params: TemplateParams
): Effect.Effect<void, SchemaValidationError, McpServer | StableContext<R>> | (<
  R2,
  const Completions extends Partial<TemplateCompletions<TemplateParams>> = {}
>(options: TemplateOptions<TemplateParams, R2, Completions>) => Effect.Effect<
  void,
  SchemaValidationError,
  McpServer | TemplateRequirements<TemplateParams, R2, Completions>
>) {
  if (!Array.isArray(first) || !Object.hasOwn(first, "raw")) {
    const options = first as ResourceOptions<R>
    return Effect.gen(function*() {
      const server = yield* McpServer
      const captured = Context.omit(McpServerClient, McpServer, McpRequestContext)(
        yield* Effect.context<StableContext<R>>()
      )
      yield* server.addResource({
        resource: new Resource({
          uri: options.uri, name: options.name, title: options.title,
          description: options.description, mimeType: options.mimeType,
          annotations: protocolAnnotations(options.audience, options.priority)
        }),
        annotations: options.annotations ?? Context.empty(),
        read: ((uri) => options.content.pipe(
          Effect.provide(captured),
          Effect.map((value) => normalizeReadResult(uri, value)),
          Effect.mapError(preserveRequestInputError)
        )) as RegisteredResource["read"]
      })
    })
  }
  const strings = first as unknown as TemplateStringsArray
  return <
    R2,
    const Completions extends Partial<TemplateCompletions<TemplateParams>> = {}
  >(options: TemplateOptions<TemplateParams, R2, Completions>) => Effect.gen(function*() {
    const server = yield* McpServer
    type Captured = TemplateRequirements<TemplateParams, R2, Completions>
    const captured = Context.omit(McpServerClient, McpServer, McpRequestContext)(yield* Effect.context<Captured>())
    const source = strings.reduce((result, part, index) => result + part + (index < params.length ? `{${params[index].name}}` : ""), "")
    const pattern = new RegExp(`^${strings.map(escapeRegex).join("(.+)")}$`)
    yield* server.addResourceTemplate({
      template: new ResourceTemplate({
        uriTemplate: source, name: options.name, title: options.title,
        description: options.description, mimeType: options.mimeType,
        annotations: protocolAnnotations(options.audience, options.priority)
      }),
      annotations: options.annotations ?? Context.empty(),
      match: (uri) => pattern.exec(uri)?.slice(1),
      read: ((uri, values) => Effect.forEach(values, (value, index) =>
        Schema.decodeUnknown(params[index].schema)(value)
      ).pipe(
        Effect.mapError((error) => new InvalidParams({ message: String(error) })),
        Effect.flatMap((decoded) => options.content(uri, ...decoded as TemplateValues<TemplateParams>).pipe(
          Effect.map((value) => normalizeReadResult(uri, value)),
          Effect.mapError((error) => new InternalError({ message: String(error) }))
        )),
        Effect.provide(captured)
      )) as RegisteredTemplate["read"],
      completions: Object.fromEntries(Object.entries(options.completion ?? {}).map(([name, completion]) => {
        const parameter = params.find((candidate) => candidate.name === name)
        const handler = completion as (
          input: string
        ) => Effect.Effect<ReadonlyArray<unknown>, unknown, Captured>
        return [
          name,
          (input: string) => handler(input).pipe(
            Effect.flatMap((values) => parameter === undefined
              ? Effect.succeed(values)
              : Schema.encodeUnknown(Schema.Array(parameter.schema))(values)),
            Effect.provide(captured),
            Effect.map((values) => new CompleteResult({
              resultType: "complete",
              completion: { values: values.map(String) }
            })),
            Effect.mapError((error) => new InternalError({ message: String(error) }))
          )
        ]
      })) as RegisteredTemplate["completions"]
    })
  })
}

const escapeRegex = (value: string): string => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")

export const registerPrompt = <F extends Fields = {}, A = unknown, E = never, R = never>(options: {
  readonly name: string
  readonly title?: string
  readonly description?: string
  readonly parameters?: F
  readonly annotations?: VisibilityAnnotations
  readonly completion?: Readonly<Record<string, (input: string) => Effect.Effect<ReadonlyArray<string>, unknown, R>>>
  readonly content: (params: FieldValues<F>) => Effect.Effect<unknown, unknown, R>
}): Effect.Effect<void, SchemaValidationError, McpServer | StableContext<R | Schema.Struct.Context<F>>> => Effect.gen(function*() {
  const server = yield* McpServer
  type Captured = StableContext<R | Schema.Struct.Context<F>>
  const captured = Context.omit(McpServerClient, McpServer, McpRequestContext)(yield* Effect.context<Captured>())
  const parameterSchema = Schema.Struct(options.parameters ?? {} as F)
  const encodedAst = SchemaAST.encodedAST(parameterSchema.ast)
  const encodedProperties = SchemaAST.isTypeLiteral(encodedAst) ? encodedAst.propertySignatures : []
  yield* server.addPrompt({
    prompt: new Prompt({
      name: options.name,
      title: options.title,
      description: options.description,
      arguments: Object.entries(options.parameters ?? {}).map(([name, field]) => {
        const encodedProperty = encodedProperties.find((property) => property.name === name)
        const description = promptFieldDescription(field, encodedProperty)
        return new PromptArgument({
          name,
          ...(description === undefined ? {} : { description }),
          required: encodedProperty === undefined ? true : !encodedProperty.isOptional
        })
      })
    }),
    annotations: options.annotations ?? Context.empty(),
    get: (args) => Schema.decodeUnknown(parameterSchema)(args).pipe(
      Effect.mapError((error) => new InvalidParams({ message: String(error) })),
      Effect.flatMap((params) => options.content(params as FieldValues<F>).pipe(Effect.provide(captured))),
      Effect.map(normalizePromptResult),
      Effect.mapError(preserveRequestInputError)
    ) as Effect.Effect<GetPromptResult, McpError, McpServerClient>,
    completions: Object.fromEntries(Object.entries(options.completion ?? {}).map(([name, handler]) => [
      name,
      (input: string) => handler(input).pipe(
        Effect.provide(captured),
        Effect.map((values) => new CompleteResult({ resultType: "complete", completion: { values: [...values] } })),
        Effect.mapError((error) => new InternalError({ message: String(error) }))
      )
    ])) as RegisteredPrompt["completions"]
  })
})

const promptFieldDescription = (
  field: Schema.Struct.Field,
  encodedProperty: SchemaAST.PropertySignature | undefined
): string | undefined => {
  const ast = field.ast
  const description = ast._tag === "PropertySignatureTransformation"
    ? SchemaAST.getDescriptionAnnotation(ast.to).pipe(
      Option.orElse(() => SchemaAST.getDescriptionAnnotation(ast.from))
    )
    : SchemaAST.getDescriptionAnnotation(ast)
  const value = Option.getOrUndefined(description.pipe(
    Option.orElse(() => encodedProperty === undefined
      ? Option.none()
      : SchemaAST.getDescriptionAnnotation(encodedProperty).pipe(
        Option.orElse(() => SchemaAST.getDescriptionAnnotation(encodedProperty.type))
      ))
  ))
  return value === "a string" ? undefined : value
}

export function resource<R>(options: ResourceOptions<R>): Layer.Layer<never, SchemaValidationError, McpServer | StableContext<R>>
export function resource<const Params extends TemplateParams>(
  strings: TemplateStringsArray,
  ...params: Params
): <R, const Completions extends Partial<TemplateCompletions<Params>> = {}>(
  options: TemplateOptions<Params, R, Completions>
) => Layer.Layer<
  never,
  SchemaValidationError,
  McpServer | TemplateRequirements<Params, R, Completions>
>
export function resource<R>(first: ResourceOptions<R> | TemplateStringsArray, ...params: TemplateParams) {
  if (Array.isArray(first) && Object.hasOwn(first, "raw")) {
    const registerTemplate = registerResource as (
      strings: TemplateStringsArray,
      ...parameters: TemplateParams
    ) => <R2, const Completions extends Partial<TemplateCompletions<TemplateParams>> = {}>(
      options: TemplateOptions<TemplateParams, R2, Completions>
    ) => Effect.Effect<
      void,
      SchemaValidationError,
      McpServer | TemplateRequirements<TemplateParams, R2, Completions>
    >
    const registered = registerTemplate(first as unknown as TemplateStringsArray, ...params)
    return <R2, const Completions extends Partial<TemplateCompletions<TemplateParams>> = {}>(
      options: TemplateOptions<TemplateParams, R2, Completions>
    ) => Layer.effectDiscard(registered(options))
  }
  return Layer.effectDiscard(registerResource(first as ResourceOptions<R>))
}

export const prompt = <F extends Fields = {}, R = never>(
  options: Parameters<typeof registerPrompt<F, unknown, unknown, R>>[0]
): Layer.Layer<never, SchemaValidationError, McpServer | StableContext<R | Schema.Struct.Context<F>>> =>
  Layer.effectDiscard(registerPrompt(options))

const sendNotification = (tag: string, payload: unknown): Effect.Effect<void, SchemaValidationError, McpServer> =>
  McpServer.pipe(Effect.flatMap((server) => server.publish({ tag, payload })), Effect.asVoid)

const someOptionPrototype = Object.getPrototypeOf(Option.some(null))
const noneOptionPrototype = Object.getPrototypeOf(Option.none())

const progressTokenFromOption = (value: unknown): Effect.Effect<typeof ProgressToken.Type, SchemaValidationError> =>
  Effect.try({
    try: () => {
      if ((typeof value !== "object" && typeof value !== "function") || value === null) {
        throw new TypeError("Invalid progress token option")
      }
      const prototype = Reflect.getPrototypeOf(value)
      if (prototype !== Object.prototype && prototype !== null &&
        prototype !== someOptionPrototype && prototype !== noneOptionPrototype) {
        throw new TypeError("Invalid progress token option prototype")
      }
      const allowed = prototype === someOptionPrototype || prototype === noneOptionPrototype
        ? new Set<PropertyKey>(["value"])
        : new Set<PropertyKey>(["_tag", "value"])
      for (const key of Reflect.ownKeys(value)) {
        if (!allowed.has(key)) throw new TypeError(`Unknown progress token option property: ${String(key)}`)
      }
      const ownTag = Reflect.getOwnPropertyDescriptor(value, "_tag")
      const tag = ownTag !== undefined && "value" in ownTag
        ? ownTag.value
        : prototype === someOptionPrototype
          ? "Some"
          : prototype === noneOptionPrototype
            ? "None"
            : undefined
      if (tag !== "Some") {
        throw new TypeError(tag === "None" ? "Missing progress token" : "Invalid progress token option")
      }
      const token = Reflect.getOwnPropertyDescriptor(value, "value")
      if (token === undefined || !("value" in token)) {
        throw new TypeError("Progress token must be an own data property")
      }
      const decoded = Schema.decodeUnknownEither(ProgressToken)(token.value)
      if (Either.isLeft(decoded)) throw decoded.left
      return decoded.right
    },
    catch: (cause) => localSchemaError("Invalid request progress token", cause)
  })

const snapshotProgressUpdate = (value: unknown): Effect.Effect<ProgressUpdate, SchemaValidationError> =>
  Effect.try({
    try: () => {
      if ((typeof value !== "object" && typeof value !== "function") || value === null) {
        throw new TypeError("Progress update must be an object")
      }
      const prototype = Reflect.getPrototypeOf(value)
      if (prototype !== Object.prototype && prototype !== null) {
        throw new TypeError("Progress update must have a plain prototype")
      }
      const allowed = new Set<PropertyKey>(["progress", "total", "message"])
      for (const key of Reflect.ownKeys(value)) {
        if (!allowed.has(key)) throw new TypeError(`Unknown progress update property: ${String(key)}`)
      }
      const read = (key: "progress" | "total" | "message") => {
        const descriptor = Reflect.getOwnPropertyDescriptor(value, key)
        if (descriptor === undefined) return { found: false } as const
        if (!("value" in descriptor)) throw new TypeError(`Progress ${key} must be an own data property`)
        return { found: true, value: descriptor.value } as const
      }
      const progress = read("progress")
      const total = read("total")
      const message = read("message")
      if (!progress.found) throw new TypeError("Missing progress value")
      const snapshot = {
        progress: progress.value,
        ...(total.found ? { total: total.value } : {}),
        ...(message.found ? { message: message.value } : {})
      }
      const decoded = Schema.decodeUnknownEither(Schema.Struct({
        progress: Schema.Finite,
        total: Schema.optional(Schema.Finite),
        message: Schema.optional(Schema.String)
      }))(snapshot)
      if (Either.isLeft(decoded)) throw decoded.left
      return decoded.right
    },
    catch: (cause) => localSchemaError("Invalid progress update", cause)
  })

const progressParamsForToken = (
  progressToken: typeof ProgressToken.Type,
  update: unknown
): Effect.Effect<typeof ProgressNotificationParams.Type, SchemaValidationError> => Effect.gen(function*() {
  const snapshot = yield* snapshotProgressUpdate(update)
  const decoded = Schema.decodeUnknownEither(ProgressNotificationParams)({ progressToken, ...snapshot })
  if (Either.isLeft(decoded)) return yield* localSchemaError("Invalid progress notification", decoded.left)
  return decoded.right
})

const progressParams = (
  tokenOption: unknown,
  update: unknown
): Effect.Effect<typeof ProgressNotificationParams.Type, SchemaValidationError> => Effect.gen(function*() {
  const progressToken = yield* progressTokenFromOption(tokenOption)
  return yield* progressParamsForToken(progressToken, update)
})

const snapshotProgressContext = (context: unknown): Effect.Effect<{
  readonly progressToken: unknown
  readonly reportProgress: Function
}, SchemaValidationError> => Effect.try({
  try: () => {
    if ((typeof context !== "object" && typeof context !== "function") || context === null) {
      throw new TypeError("Request progress context must be an object")
    }
    const prototype = Reflect.getPrototypeOf(context)
    if (prototype !== Object.prototype && prototype !== null) {
      throw new TypeError("Request progress context must have a plain prototype")
    }
    const token = Reflect.getOwnPropertyDescriptor(context, "progressToken")
    if (token === undefined || !("value" in token)) {
      throw new TypeError("Progress token must be an own data property")
    }
    const report = Reflect.getOwnPropertyDescriptor(context, "reportProgress")
    if (report === undefined || !("value" in report) || typeof report.value !== "function") {
      throw new TypeError("Progress reporter must be an own data function")
    }
    if (Reflect.get(context, "progressToken", context) !== token.value ||
      Reflect.get(context, "reportProgress", context) !== report.value) {
      throw new TypeError("Request progress context data changed during inspection")
    }
    return { progressToken: token.value, reportProgress: report.value }
  },
  catch: (cause) => localSchemaError("Invalid request progress context", cause)
})

export const sendProgress = (update: ProgressUpdate): Effect.Effect<
  void,
  SchemaValidationError,
  McpRequestContext
> => McpRequestContext.pipe(
  Effect.flatMap((context) => snapshotProgressContext(context).pipe(
    Effect.flatMap(({ progressToken, reportProgress }) => progressParams(progressToken, update).pipe(
      Effect.flatMap((params) => {
      const normalized: ProgressUpdate = {
        progress: params.progress,
        ...(params.total === undefined ? {} : { total: params.total }),
        ...(params.message === undefined ? {} : { message: params.message })
      }
      return containSchemaCallback(
        () => Reflect.apply(reportProgress, context, [normalized]) as Effect.Effect<void, unknown>,
        "Request progress reporter failed"
      )
      })
    ))
  )))
export const sendResourceUpdated = (payload: unknown) => sendNotification(
  SERVER_NOTIFICATION_METHOD_BY_TYPE.ResourceUpdatedNotification,
  payload
)
export const sendResourceListChanged = sendNotification(
  SERVER_NOTIFICATION_METHOD_BY_TYPE.ResourceListChangedNotification,
  {}
)
export const sendToolListChanged = sendNotification(
  SERVER_NOTIFICATION_METHOD_BY_TYPE.ToolListChangedNotification,
  {}
)
export const sendPromptListChanged = sendNotification(
  SERVER_NOTIFICATION_METHOD_BY_TYPE.PromptListChangedNotification,
  {}
)

export const clientCapabilities = McpServerClient.pipe(
  Effect.map((client) => client.requestContext.capabilities ?? {})
)

export interface RequestInputOptions {
  readonly inputRequests?: Readonly<Record<string, typeof InputRequest.Type>>
  readonly requestState?: string
}

/** Build an exact generated MRTR result under the active request's capability policy. */
export const requestInput = (
  options: RequestInputOptions
): Effect.Effect<InputRequiredResult, McpError, McpRequestContext> => Effect.gen(function*() {
  const context = yield* McpRequestContext
  if (context.request.method !== "prompts/get" &&
    context.request.method !== "resources/read" &&
    context.request.method !== "tools/call") {
    return yield* Effect.fail(new InvalidParams({
      message: `input_required is not permitted for ${context.request.method}`
    }))
  }
  const snapshot = yield* Effect.try({
    try: () => {
      const copied = cloneStrictJson(options)
      if (copied === invalidStrictJson || !isRecord(copied)) {
        throw new TypeError("Input-required options must be canonical JSON")
      }
      return copied
    },
    catch: (cause) => new InvalidParams({
      message: "Invalid input-required options",
      cause
    })
  })
  const inputRequests = snapshot["inputRequests"]
  const requestState = snapshot["requestState"]
  if (inputRequests === undefined && requestState === undefined) {
    return yield* Effect.fail(new InvalidParams({
      message: "input_required needs inputRequests or requestState"
    }))
  }
  const entries = inputRequestEntries(inputRequests)
  if (entries === undefined) {
    return yield* Effect.fail(new InvalidParams({ message: "Invalid inputRequests map" }))
  }
  if (entries.length > 32) {
    return yield* Effect.fail(new InvalidParams({ message: "inputRequests exceeds 32 entries" }))
  }
  const capabilities = isRecord(context.clientCapabilities) ? context.clientCapabilities : {}
  const required: Record<string, unknown> = {}
  const decodedInputRequests: Record<string, typeof InputRequest.Type> = Object.create(null)
  for (const [key, raw] of entries) {
    const decoded = Schema.decodeUnknownEither(InputRequest)(raw)
    if (Either.isLeft(decoded)) {
      return yield* Effect.fail(new InvalidParams({
        message: `Invalid input request at key ${key}`,
        cause: decoded.left
      }))
    }
    Object.defineProperty(decodedInputRequests, key, {
      configurable: true,
      enumerable: true,
      value: decoded.right,
      writable: true
    })
    if (decoded.right.method === "roots/list") {
      if (!isRecord(capabilities["roots"])) required["roots"] = {}
      continue
    }
    if (decoded.right.method === "sampling/createMessage") {
      const sampling = isRecord(capabilities["sampling"]) ? capabilities["sampling"] : undefined
      if (sampling === undefined) {
        required["sampling"] = {}
      } else {
        const needed: Record<string, unknown> = {}
        if ((decoded.right.params.tools !== undefined || decoded.right.params.toolChoice !== undefined) &&
          !isRecord(sampling["tools"])) needed["tools"] = {}
        if (decoded.right.params.includeContext !== undefined && decoded.right.params.includeContext !== "none" &&
          !isRecord(sampling["context"])) needed["context"] = {}
        if (Object.keys(needed).length > 0) required["sampling"] = needed
      }
      continue
    }
    const elicitation = isRecord(capabilities["elicitation"]) ? capabilities["elicitation"] : undefined
    const mode = decoded.right.params.mode === "url" ? "url" : "form"
    if (elicitation === undefined || !isRecord(elicitation[mode])) {
      required["elicitation"] = { [mode]: {} }
    }
  }
  if (Object.keys(required).length > 0) {
    return yield* Effect.fail(new MissingRequiredClientCapabilityError({
      message: "Client does not support required input capabilities",
      data: { requiredCapabilities: required }
    }))
  }
  const result = new InputRequiredResult({
    resultType: "input_required",
    requestState: requestState === undefined ? "" : requestState as string
  })
  if (requestState === undefined) Reflect.deleteProperty(result, "requestState")
  if (inputRequests !== undefined) {
    Object.defineProperty(result, "inputRequests", {
      configurable: true,
      enumerable: true,
      value: decodedInputRequests,
      writable: true
    })
  }
  return result
})

const inputRequestEntries = (
  value: unknown
): ReadonlyArray<readonly [string, unknown]> | undefined => {
  if (value === undefined) return []
  if (!isRecord(value)) return undefined
  try {
    const keys = Reflect.ownKeys(value)
    if (keys.some((key) => typeof key !== "string")) return undefined
    const descriptors = Object.getOwnPropertyDescriptors(value)
    const output: Array<readonly [string, unknown]> = []
    for (const key of keys as string[]) {
      const descriptor = descriptors[key]
      if (descriptor === undefined || !("value" in descriptor) || !descriptor.enumerable) return undefined
      output.push([key, descriptor.value])
    }
    return output
  } catch {
    return undefined
  }
}

const clientForParams = (params: Record<string, unknown>, clientId: number | string = 0) => {
  const meta = isRecord(params._meta) ? params._meta : {}
  return McpServerClient.of({
    clientId,
    requestContext: {
      protocolVersion: typeof meta["io.modelcontextprotocol/protocolVersion"] === "string"
        ? meta["io.modelcontextprotocol/protocolVersion"]
        : undefined,
      capabilities: isRecord(meta["io.modelcontextprotocol/clientCapabilities"])
        ? meta["io.modelcontextprotocol/clientCapabilities"]
        : undefined,
      clientInfo: isRecord(meta["io.modelcontextprotocol/clientInfo"])
        ? meta["io.modelcontextprotocol/clientInfo"] as { name: string; version: string }
        : undefined,
      traceparent: typeof meta.traceparent === "string" ? meta.traceparent : undefined,
      tracestate: typeof meta.tracestate === "string" ? meta.tracestate : undefined,
      baggage: typeof meta.baggage === "string" ? meta.baggage : undefined
    }
  })
}

const stableRequestContext = (
  context: McpDispatcher.McpRequestContextValue
): McpRequestContextService => {
  const params = isRecord(context.request.params) ? context.request.params : {}
  const metaProperty = findDataProperty(params, "_meta")
  const meta = metaProperty.found && isRecord(metaProperty.value) ? metaProperty.value : {}
  const tokenProperty = findDataProperty(meta, "progressToken")
  const decodedToken = tokenProperty.found
    ? Schema.decodeUnknownEither(ProgressToken)(tokenProperty.value)
    : Either.left(undefined)
  const authoritativeProgressToken = Either.isRight(decodedToken) ? decodedToken.right : undefined
  const progressToken = Object.freeze(authoritativeProgressToken === undefined
    ? Option.none<typeof ProgressToken.Type>()
    : Option.some(authoritativeProgressToken))
  const facade: McpRequestContextService = {
    request: context.request,
    id: context.id,
    protocolVersion: context.protocolVersion,
    clientCapabilities: context.clientCapabilities,
    extensions: context.extensions,
    clientInfo: context.clientInfo,
    authorizationPrincipal: context.authorizationPrincipal,
    progressToken,
    cancelled: context.cancelled,
    isCancelled: context.isCancelled,
    reportProgress: (update) => authoritativeProgressToken === undefined
      ? Effect.fail(localSchemaError("The active request has no progress token", new TypeError("Missing progress token")))
      : progressParamsForToken(authoritativeProgressToken, update).pipe(
      Effect.flatMap((payload) => containSchemaCallback(
        () => context.notificationSink({
          _tag: "Notification",
          jsonrpc: "2.0",
          method: SERVER_NOTIFICATION_METHOD_BY_TYPE.ProgressNotification,
          params: payload
        }),
        "Request-owned progress send failed"
      ))),
    annotations: context.annotations
  }
  return Object.freeze(facade)
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value)

const invalidHandlerResult = Symbol("InvalidHandlerResult")
type HandlerResultLocation = "result" | "metadata" | "nested"

const sanitizeHandlerResult = (
  value: unknown,
  seen: Set<object>,
  location: HandlerResultLocation = "result"
): unknown | typeof invalidHandlerResult => {
  if (value === null || typeof value === "string" || typeof value === "boolean") return value
  if (typeof value === "number") return Number.isFinite(value) ? value : invalidHandlerResult
  if (typeof value !== "object" || seen.has(value)) return invalidHandlerResult

  const bytes = cloneExactUint8Array(value)
  if (bytes !== notArrayBufferView) {
    return bytes === invalidExactUint8Array ? invalidHandlerResult : bytes
  }
  const prototype = Object.getPrototypeOf(value)
  if (Array.isArray(value)) {
    if (prototype !== Array.prototype) return invalidHandlerResult
    const keys = Reflect.ownKeys(value)
    const elementKeys = keys.filter((key) => key !== "length")
    if (elementKeys.some((key) => typeof key !== "string") || elementKeys.length !== value.length) {
      return invalidHandlerResult
    }
    const descriptors = Object.getOwnPropertyDescriptors(value)
    seen.add(value)
    try {
      const output: unknown[] = []
      for (let index = 0; index < value.length; index++) {
        const descriptor = descriptors[String(index)]
        if (descriptor === undefined || !("value" in descriptor) || !descriptor.enumerable) {
          return invalidHandlerResult
        }
        const item = sanitizeHandlerResult(descriptor.value, seen, "nested")
        if (item === invalidHandlerResult) return invalidHandlerResult
        output.push(item)
      }
      return output
    } finally {
      seen.delete(value)
    }
  }

  if (prototype !== Object.prototype && prototype !== null) {
    const constructor = Object.getOwnPropertyDescriptor(prototype, "constructor")
    if (constructor === undefined || !("value" in constructor) || !Schema.isSchema(constructor.value)) {
      return invalidHandlerResult
    }
  }
  const keys = Reflect.ownKeys(value)
  if (keys.some((key) => typeof key !== "string")) return invalidHandlerResult
  seen.add(value)
  try {
    const output: Record<string, unknown> = {}
    for (const key of keys as string[]) {
      if (location === "result" && key === "serverInfo") continue
      if (location === "metadata" && key === MCP_SERVER_INFO_META_KEY) continue
      const descriptor = Object.getOwnPropertyDescriptor(value, key)
      if (descriptor === undefined || !("value" in descriptor) || !descriptor.enumerable) {
        return invalidHandlerResult
      }
      if (descriptor.value === undefined) continue
      const nextLocation = location === "result" && key === "_meta" ? "metadata" : "nested"
      const item = sanitizeHandlerResult(descriptor.value, seen, nextLocation)
      if (item === invalidHandlerResult) return invalidHandlerResult
      defineHandlerProperty(output, key, item)
    }
    return output
  } finally {
    seen.delete(value)
  }
}

const resultEncodingError = (cause?: unknown): InternalError => new InternalError({
  message: "Could not encode server result",
  ...(cause === undefined ? {} : { cause })
})

const encodeInputRequiredWireResult = (
  value: unknown
): Effect.Effect<JsonValue, InternalError> => Effect.gen(function*() {
  const decoded = yield* Schema.decodeUnknown(InputRequiredResult)(value).pipe(
    Effect.catchAllCause((cause) => Effect.fail(resultEncodingError(cause)))
  )
  const encoded = yield* Schema.encodeUnknown(InputRequiredResult)(decoded).pipe(
    Effect.catchAllCause((cause) => Effect.fail(resultEncodingError(cause)))
  )
  const normalized = cloneStrictJson(encoded)
  if (normalized === invalidStrictJson || !isRecord(normalized)) {
    return yield* Effect.fail(resultEncodingError())
  }
  const sourceRequests = isRecord(value) ? value["inputRequests"] : undefined
  const entries = inputRequestEntries(sourceRequests)
  if (entries === undefined) return yield* Effect.fail(resultEncodingError())
  if (sourceRequests !== undefined) {
    const exactRequests: Record<string, JsonValue> = Object.create(null)
    for (const [key, raw] of entries) {
      const request = yield* Schema.decodeUnknown(InputRequest)(raw).pipe(
        Effect.catchAllCause((cause) => Effect.fail(resultEncodingError(cause)))
      )
      const wire = yield* Schema.encodeUnknown(InputRequest)(request).pipe(
        Effect.catchAllCause((cause) => Effect.fail(resultEncodingError(cause)))
      )
      const exact = cloneStrictJson(wire)
      if (exact === invalidStrictJson) return yield* Effect.fail(resultEncodingError())
      defineHandlerProperty(exactRequests, key, exact)
    }
    defineHandlerProperty(normalized, "inputRequests", exactRequests)
  }
  return normalized
})

const encodeWireResult = (
  method: string,
  result: unknown,
  serverInfo: { readonly name: string; readonly version: string }
): Effect.Effect<JsonValue, InternalError> => Effect.gen(function*() {
  const sanitized = yield* Effect.try({
    try: () => sanitizeHandlerResult(result, new Set()),
    catch: (cause) => resultEncodingError(cause)
  })
  if (sanitized === invalidHandlerResult) return yield* Effect.fail(resultEncodingError())

  const inputRequired = inputRequiredValue(sanitized)
  if (inputRequired && method !== "prompts/get" && method !== "resources/read" && method !== "tools/call") {
    return yield* Effect.fail(resultEncodingError())
  }
  const codec = Object.hasOwn(CLIENT_REQUEST_RESULT_CODEC_BY_METHOD, method)
    ? CLIENT_REQUEST_RESULT_CODEC_BY_METHOD[
        method as keyof typeof CLIENT_REQUEST_RESULT_CODEC_BY_METHOD
      ]
    : undefined
  const encoded: unknown = inputRequired
    ? yield* encodeInputRequiredWireResult(sanitized)
    : codec === undefined
      ? sanitized
      : yield* Schema.encodeUnknown(codec as Schema.Schema.AnyNoContext)(sanitized).pipe(
          Effect.catchAllCause((cause) => Effect.fail(resultEncodingError(cause)))
        )

  const normalized = yield* Effect.try({
    try: () => cloneStrictJson(encoded),
    catch: (cause) => resultEncodingError(cause)
  })
  if (normalized === invalidStrictJson) return yield* Effect.fail(resultEncodingError())

  const encodedServerInfo = yield* Schema.encodeUnknown(Implementation)(serverInfo).pipe(
    Effect.catchAllCause((cause) => Effect.fail(resultEncodingError(cause)))
  )
  const normalizedServerInfo = yield* Effect.try({
    try: () => cloneStrictJson(encodedServerInfo),
    catch: (cause) => resultEncodingError(cause)
  })
  if (normalizedServerInfo === invalidStrictJson) return yield* Effect.fail(resultEncodingError())

  const wireResult = withServerOwnedResultMetadata(normalized, sanitized, normalizedServerInfo)
  return wireResult === invalidStrictJson
    ? yield* Effect.fail(resultEncodingError())
    : wireResult
})

const withServerOwnedResultMetadata = (
  value: JsonValue,
  sanitized: unknown,
  serverInfo: JsonValue
): JsonValue | typeof invalidStrictJson => {
  if (!isRecord(value) || Array.isArray(value) || value.resultType !== "complete") return value
  const output: Record<string, JsonValue> = {}
  for (const [key, item] of Object.entries(value)) {
    if (key !== "serverInfo" && key !== "_meta") defineJsonProperty(output, key, item)
  }
  if (isRecord(sanitized) && !Array.isArray(sanitized)) {
    for (const [key, item] of Object.entries(sanitized)) {
      if (key !== "serverInfo" && key !== "_meta" && !Object.hasOwn(output, key)) {
        const normalizedItem = cloneStrictJson(item)
        if (normalizedItem === invalidStrictJson) return invalidStrictJson
        defineJsonProperty(output, key, normalizedItem)
      }
    }
  }
  const metadata: Record<string, JsonValue> = {}
  if (isRecord(value._meta) && !Array.isArray(value._meta)) {
    for (const [key, item] of Object.entries(value._meta)) {
      defineJsonProperty(metadata, key, item as JsonValue)
    }
  }
  if (isRecord(sanitized) && isRecord(sanitized._meta) && !Array.isArray(sanitized._meta)) {
    for (const [key, item] of Object.entries(sanitized._meta)) {
      if (key !== MCP_SERVER_INFO_META_KEY) {
        const normalizedItem = cloneStrictJson(item)
        if (normalizedItem === invalidStrictJson) return invalidStrictJson
        defineJsonProperty(metadata, key, normalizedItem)
      }
    }
  }
  defineJsonProperty(metadata, MCP_SERVER_INFO_META_KEY, serverInfo)
  defineJsonProperty(output, "_meta", metadata)
  return output
}

const defineHandlerProperty = (
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

const discoverResult = (server: McpServerService) => {
  const capabilities: Record<string, unknown> = {}
  capabilities.extensions = normalizeExtensionCapabilities(server.options.extensions) ?? {}
  if (server.tools.length > 0) {
    capabilities.tools = { listChanged: true }
  }
  if (server.resources.length > 0 || server.resourceTemplates.length > 0) {
    capabilities.resources = { listChanged: true, subscribe: true }
  }
  if (server.prompts.length > 0) {
    capabilities.prompts = { listChanged: true }
  }
  if (
    server.resourceTemplates.some(({ completions }) => Object.keys(completions).length > 0) ||
    server.prompts.some(({ completions }) => Object.keys(completions).length > 0)
  ) {
    capabilities.completions = {}
  }
  return makeDiscoverResult({
    supportedVersions: server.options.supportedProtocolVersions ?? [MODERN_PROTOCOL_VERSION],
    capabilities: capabilities as never,
    instructions: server.options.instructions,
    ttlMs: 0,
    cacheScope: "private"
  })
}

const filterByClient = <
  Entry extends { readonly annotations: VisibilityAnnotations },
  Property extends keyof Entry
>(
  client: ClientContext,
  entries: ReadonlyArray<Entry>,
  property: Property
): Array<Entry[Property]> => entries.flatMap((entry) => {
  const enabledWhen = Context.getOption(entry.annotations, EnabledWhen)
  return Option.isNone(enabledWhen) || enabledWhen.value(client) ? [entry[property]] : []
})

const codeUnitCompare = (left: string, right: string): number =>
  left < right ? -1 : left > right ? 1 : 0

const cursorStateSnapshot = (value: unknown): PaginationCursorState | undefined => {
  try {
    if ((typeof value !== "object" && typeof value !== "function") || value === null) return undefined
    const descriptors = Object.getOwnPropertyDescriptors(value)
    if (Object.getOwnPropertySymbols(descriptors).length > 0) return undefined
    const data = (name: string): unknown => {
      const descriptor = descriptors[name]
      return descriptor !== undefined && "value" in descriptor ? descriptor.value : undefined
    }
    const owner = data("owner")
    const collection = data("collection")
    const revision = data("revision")
    const offset = data("offset")
    const rawView = data("view")
    if (typeof owner !== "string" ||
      (collection !== "tools" && collection !== "resources" &&
        collection !== "resourceTemplates" && collection !== "prompts") ||
      typeof revision !== "number" || !Number.isSafeInteger(revision) || revision < 0 ||
      typeof offset !== "number" || !Number.isSafeInteger(offset) || offset < 0 ||
      !Array.isArray(rawView)) return undefined
    const viewDescriptors = Object.getOwnPropertyDescriptors(rawView) as Record<string, PropertyDescriptor>
    const lengthDescriptor = viewDescriptors.length
    if (lengthDescriptor === undefined || !("value" in lengthDescriptor) ||
      typeof lengthDescriptor.value !== "number" || !Number.isSafeInteger(lengthDescriptor.value)) return undefined
    const view: Array<string> = []
    for (let index = 0; index < lengthDescriptor.value; index++) {
      const descriptor = viewDescriptors[String(index)]
      if (descriptor === undefined || !("value" in descriptor) || typeof descriptor.value !== "string") return undefined
      view.push(descriptor.value)
    }
    return Object.freeze({ owner, collection, revision, offset, view: Object.freeze(view) })
  } catch {
    return undefined
  }
}

const exactView = (left: ReadonlyArray<string>, right: ReadonlyArray<string>): boolean =>
  left.length === right.length && left.every((value, index) => value === right[index])

const paginate = <A>(
  server: McpServerService,
  collection: PaginatedCollection,
  entries: ReadonlyArray<A>,
  key: (entry: A) => string,
  cursorValue: unknown,
  hasCursor: boolean,
  compare?: (left: A, right: A) => number
): Effect.Effect<{ readonly page: ReadonlyArray<A>; readonly nextCursor?: string }, SchemaValidationError> =>
  Effect.gen(function*() {
    const runtime = paginationRuntime(server)
    const ordered = [...entries].sort(compare ?? ((left, right) => codeUnitCompare(key(left), key(right))))
    const view = Object.freeze(ordered.map(key))
    const revision = runtime.revisions[collection]
    let offset = 0
    if (hasCursor) {
      if (typeof cursorValue !== "string") {
        return yield* Effect.fail(new SchemaValidationError({ message: "Invalid pagination cursor" }))
      }
      const state = cursorStateSnapshot(yield* runtime.cursor.resolve(cursorValue))
      if (state === undefined || state.owner !== runtime.owner || state.collection !== collection ||
        state.revision !== revision || state.offset <= 0 || state.offset >= view.length ||
        !exactView(state.view, view)) {
        return yield* Effect.fail(new SchemaValidationError({ message: "Invalid or expired pagination cursor" }))
      }
      offset = state.offset
    }
    const end = Math.min(ordered.length, offset + server.options.pagination.pageSize)
    const page = ordered.slice(offset, end)
    if (end >= ordered.length) return { page }
    const nextCursor = yield* runtime.cursor.issue(Object.freeze({
      owner: runtime.owner,
      collection,
      revision,
      offset: end,
      view
    }))
    if (typeof nextCursor !== "string") {
      return yield* Effect.fail(new SchemaValidationError({ message: "Pagination cursor issue failed" }))
    }
    return { page, nextCursor }
  })

const cursorParameter = (params: Record<string, unknown>): { readonly present: boolean; readonly value?: unknown } => {
  try {
    const descriptor = Object.getOwnPropertyDescriptor(params, "cursor")
    if (descriptor === undefined) return { present: false }
    return "value" in descriptor ? { present: true, value: descriptor.value } : { present: true }
  } catch {
    return { present: true }
  }
}

const normalizeClientContext = (
  payload: McpSchemaClientPayload
): ClientContext => payload instanceof ClientContext
  ? payload
  : { ...payload, capabilities: payload.capabilities ?? {} } as ClientContext

type McpSchemaClientPayload = McpServerClientService["requestContext"]

export const dispatch = (method: string, params: Record<string, unknown>): Effect.Effect<unknown, McpError, McpServer | McpServerClient> =>
  withRequestAnnotations(isRecord(params._meta) ? params._meta : {}, McpServer.pipe(Effect.flatMap((server): Effect.Effect<unknown, McpError, McpServerClient> => {
    switch (method) {
      case CLIENT_REQUEST_METHOD_BY_TYPE.DiscoverRequest:
        return Effect.succeed(discoverResult(server))
      case CLIENT_REQUEST_METHOD_BY_TYPE.ListToolsRequest:
        return McpServerClient.pipe(Effect.flatMap((client) => {
          const cursor = cursorParameter(params)
          return paginate(
            server, "tools",
            filterByClient(normalizeClientContext(client.requestContext), server.tools, "tool"),
            (tool) => tool.name, cursor.value, cursor.present
          ).pipe(Effect.map(({ page, nextCursor }) => new ListToolsResult({
            resultType: "complete", ttlMs: server.options.pagination.ttlMs,
            cacheScope: server.options.pagination.cacheScope, tools: [...page],
            ...(nextCursor === undefined ? {} : { nextCursor })
          })))
        }))
      case CLIENT_REQUEST_METHOD_BY_TYPE.CallToolRequest:
        return server.callTool(params as { name: string; arguments?: Record<string, unknown> })
      case CLIENT_REQUEST_METHOD_BY_TYPE.ListResourcesRequest:
        return McpServerClient.pipe(Effect.flatMap((client) => {
          const cursor = cursorParameter(params)
          return paginate(
            server, "resources",
            filterByClient(normalizeClientContext(client.requestContext), server.resources, "resource"),
            (resource) => resource.uri, cursor.value, cursor.present
          ).pipe(Effect.map(({ page, nextCursor }) => new ListResourcesResult({
            resultType: "complete", ttlMs: server.options.pagination.ttlMs,
            cacheScope: server.options.pagination.cacheScope, resources: [...page],
            ...(nextCursor === undefined ? {} : { nextCursor })
          })))
        }))
      case CLIENT_REQUEST_METHOD_BY_TYPE.ListResourceTemplatesRequest:
        return McpServerClient.pipe(Effect.flatMap((client) => {
          const cursor = cursorParameter(params)
          return paginate(
            server, "resourceTemplates",
            filterByClient(normalizeClientContext(client.requestContext), server.resourceTemplates, "template"),
            (template) => template.uriTemplate, cursor.value, cursor.present,
            (left, right) => codeUnitCompare(left.uriTemplate, right.uriTemplate) ||
              codeUnitCompare(left.name, right.name)
          ).pipe(Effect.map(({ page, nextCursor }) => new ListResourceTemplatesResult({
            resultType: "complete", ttlMs: server.options.pagination.ttlMs,
            cacheScope: server.options.pagination.cacheScope, resourceTemplates: [...page],
            ...(nextCursor === undefined ? {} : { nextCursor })
          })))
        }))
      case CLIENT_REQUEST_METHOD_BY_TYPE.ReadResourceRequest:
        return server.findResource(String(params.uri))
      case CLIENT_REQUEST_METHOD_BY_TYPE.ListPromptsRequest:
        return McpServerClient.pipe(Effect.flatMap((client) => {
          const cursor = cursorParameter(params)
          return paginate(
            server, "prompts",
            filterByClient(normalizeClientContext(client.requestContext), server.prompts, "prompt"),
            (prompt) => prompt.name, cursor.value, cursor.present
          ).pipe(Effect.map(({ page, nextCursor }) => new ListPromptsResult({
            resultType: "complete", ttlMs: server.options.pagination.ttlMs,
            cacheScope: server.options.pagination.cacheScope, prompts: [...page],
            ...(nextCursor === undefined ? {} : { nextCursor })
          })))
        }))
      case CLIENT_REQUEST_METHOD_BY_TYPE.GetPromptRequest:
        return server.getPromptResult(params as { name: string; arguments?: Record<string, string> })
      case CLIENT_REQUEST_METHOD_BY_TYPE.CompleteRequest:
        return server.completion(params as {
          ref: { type: "ref/resource"; uri: string } | { type: "ref/prompt"; name: string }
          argument: { name: string; value: string }
        })
      case CLIENT_REQUEST_METHOD_BY_TYPE.SubscriptionsListenRequest:
        return McpServerClient.pipe(Effect.map((client) => ({
          resultType: "complete",
          _meta: { "io.modelcontextprotocol/subscriptionId": client.clientId }
        })))
      default:
        return Effect.fail(new MethodNotFound({ message: `Method '${method}' not found` }))
    }
  })))

/** Bind one existing server registry service to the transport-neutral dispatcher. */
export const makeDispatcher = <SendError>(options: {
  readonly send: (
    message: JsonRpcSuccessResponse | JsonRpcErrorResponse | JsonRpcNotification
  ) => Effect.Effect<void, SendError>
}): Effect.Effect<
  McpDispatcher.ServerDispatcher,
  never,
  Scope.Scope | McpServer
> => Effect.gen(function*() {
  const server = yield* McpServer
  return yield* McpDispatcher.makeServerDispatcher({
    send: options.send,
    handle: (request) => request.method === CLIENT_REQUEST_METHOD_BY_TYPE.SubscriptionsListenRequest
      ? Effect.never
      : McpDispatcher.McpRequestContext.pipe(
        Effect.flatMap((context) => {
          const stable = stableRequestContext(context)
          return dispatch(
            request.method,
            isRecord(request.params) ? request.params : {}
          ).pipe(
            Effect.flatMap((result) => encodeWireResult(
              request.method,
              result,
              server.options.serverInfo
            )),
            Effect.provideService(McpServer, server),
            Effect.provideService(McpServerClient, clientForParams(
              isRecord(request.params) ? request.params : {},
              context.id
            )),
            Effect.provideService(McpRequestContext, stable)
          )
        })
      )
  })
})

// Keep generated routing metadata visible at the server boundary.
void CLIENT_NOTIFICATION_METHOD_BY_TYPE
void SERVER_REQUEST_METHOD_BY_TYPE

export type ServerScope = Scope.Scope
