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
import * as JSONSchema from "effect/JSONSchema"
import * as Layer from "effect/Layer"
import * as Option from "effect/Option"
import * as Queue from "effect/Queue"
import * as Schema from "effect/Schema"
import * as SchemaAST from "effect/SchemaAST"
import type * as Scope from "effect/Scope"
import * as McpDispatcher from "./McpDispatcher.js"
import type { JsonValue } from "./McpErrors.js"
import type {
  JsonRpcErrorResponse,
  JsonRpcNotification,
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
  InternalError,
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
import { makeDiscoverResult, MODERN_PROTOCOL_VERSION } from "./McpModern.js"
import {
  CLIENT_NOTIFICATION_METHOD_BY_TYPE,
  CLIENT_REQUEST_METHOD_BY_TYPE,
  CLIENT_REQUEST_RESULT_CODEC_BY_METHOD,
  SERVER_NOTIFICATION_METHOD_BY_TYPE,
  SERVER_REQUEST_METHOD_BY_TYPE
} from "./generated/mcp/2026-07-28/McpProtocol.generated.js"
import { withRequestAnnotations } from "./internal/RuntimeContext.js"

export type ExtensionCapabilities = Readonly<Record<string, unknown>>

export const normalizeExtensionCapabilities = (
  extensions: ExtensionCapabilities | undefined
): ExtensionCapabilities | undefined => {
  if (extensions === undefined) return undefined
  for (const name of Object.keys(extensions)) {
    const [namespace, member, ...extra] = name.split("/")
    if (!namespace || !member || extra.length > 0 || !namespace.includes(".")) {
      throw new Error(`Invalid extension capability name: ${name}`)
    }
  }
  return { ...extensions }
}

export interface ServerNotification {
  readonly tag: string
  readonly payload: unknown
}

export interface ServerLayerOptions {
  readonly name: string
  readonly version: string
  readonly instructions?: string
  readonly extensions?: ExtensionCapabilities
  readonly supportedProtocolVersions?: ReadonlyArray<string>
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
type StableContext<R> = Exclude<R, McpServerClient | McpServer>
interface RegisteredTool {
  readonly tool: Tool
  readonly annotations: VisibilityAnnotations
  readonly handler: (request: { readonly name: string; readonly arguments?: Record<string, unknown>; readonly _meta?: Record<string, unknown> }) => Effect.Effect<CallToolResult, never, McpServerClient>
}

interface RegisteredResource {
  readonly resource: Resource
  readonly annotations: VisibilityAnnotations
  readonly read: (uri: string) => Effect.Effect<ReadResourceResult, McpError, McpServerClient>
}

interface RegisteredTemplate {
  readonly template: ResourceTemplate
  readonly annotations: VisibilityAnnotations
  readonly match: (uri: string) => ReadonlyArray<string> | undefined
  readonly read: (uri: string, values: ReadonlyArray<string>) => Effect.Effect<ReadResourceResult, McpError, McpServerClient>
  readonly completions: Readonly<Record<string, (input: string) => Effect.Effect<CompleteResult, McpError, McpServerClient>>>
}

interface RegisteredPrompt {
  readonly prompt: Prompt
  readonly annotations: VisibilityAnnotations
  readonly get: (args: Record<string, string>) => Effect.Effect<GetPromptResult, McpError, McpServerClient>
  readonly completions: Readonly<Record<string, (input: string) => Effect.Effect<CompleteResult, McpError, McpServerClient>>>
}

export interface McpServerService {
  readonly tools: Array<RegisteredTool>
  readonly resources: Array<RegisteredResource>
  readonly resourceTemplates: Array<RegisteredTemplate>
  readonly prompts: Array<RegisteredPrompt>
  readonly notificationsQueue: Queue.Queue<ServerNotification>
  readonly options: ServerLayerOptions
  readonly publish: (notification: ServerNotification) => Effect.Effect<void>
  readonly openSubscription: (
    id: RequestId,
    filter: SubscriptionFilter,
    sink: SubscriptionSink
  ) => () => void
  readonly addTool: (entry: RegisteredTool) => Effect.Effect<void>
  readonly addResource: (entry: RegisteredResource) => Effect.Effect<void>
  readonly addResourceTemplate: (entry: RegisteredTemplate) => Effect.Effect<void>
  readonly addPrompt: (entry: RegisteredPrompt) => Effect.Effect<void>
  readonly callTool: (request: { readonly name: string; readonly arguments?: Record<string, unknown>; readonly _meta?: Record<string, unknown> }) => Effect.Effect<CallToolResult, McpError, McpServerClient>
  readonly findResource: (uri: string) => Effect.Effect<ReadResourceResult, McpError, McpServerClient>
  readonly getPromptResult: (request: { readonly name: string; readonly arguments?: Record<string, string> }) => Effect.Effect<GetPromptResult, McpError, McpServerClient>
  readonly completion: (request: {
    readonly ref: { readonly type: "ref/resource"; readonly uri: string } | { readonly type: "ref/prompt"; readonly name: string }
    readonly argument: { readonly name: string; readonly value: string }
  }) => Effect.Effect<CompleteResult, McpError, McpServerClient>
}

export class McpServer extends Context.Tag("mcp/McpServer")<McpServer, McpServerService>() {
  static readonly makeWithOptions = (options: ServerLayerOptions): Effect.Effect<McpServerService> => Effect.gen(function*() {
    const notificationsQueue = yield* Queue.sliding<ServerNotification>(64)
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

    const publish = (notification: ServerNotification): Effect.Effect<void> => Effect.all([
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

    const openSubscription: McpServerService["openSubscription"] = (id, filter, sink) => {
      const key = Symbol()
      subscriptions.set(key, { id, filter, sink })
      return () => {
        subscriptions.delete(key)
      }
    }

    const addTool = (entry: RegisteredTool) => Effect.sync(() => {
      const current = tools.findIndex(({ tool }) => tool.name === entry.tool.name)
      if (current >= 0) tools.splice(current, 1)
      tools.push(entry)
      tools.sort((left, right) => left.tool.name.localeCompare(right.tool.name))
    }).pipe(Effect.zipRight(publish({
      tag: SERVER_NOTIFICATION_METHOD_BY_TYPE.ToolListChangedNotification,
      payload: {}
    })), Effect.asVoid)
    const addResource = (entry: RegisteredResource) => Effect.sync(() => {
      const current = resources.findIndex(({ resource }) => resource.uri === entry.resource.uri)
      if (current >= 0) resources.splice(current, 1)
      resources.push(entry)
      resources.sort((left, right) => left.resource.uri.localeCompare(right.resource.uri))
    }).pipe(Effect.zipRight(publish({
      tag: SERVER_NOTIFICATION_METHOD_BY_TYPE.ResourceListChangedNotification,
      payload: {}
    })), Effect.asVoid)
    const addResourceTemplate = (entry: RegisteredTemplate) => Effect.sync(() => {
      resourceTemplates.push(entry)
      resourceTemplates.sort((left, right) => left.template.uriTemplate.localeCompare(right.template.uriTemplate))
      for (const [name, handler] of Object.entries(entry.completions)) {
        completions.set(`ref/resource/${entry.template.uriTemplate}/${name}`, handler)
      }
    }).pipe(Effect.zipRight(publish({
      tag: SERVER_NOTIFICATION_METHOD_BY_TYPE.ResourceListChangedNotification,
      payload: {}
    })), Effect.asVoid)
    const addPrompt = (entry: RegisteredPrompt) => Effect.sync(() => {
      const current = prompts.findIndex(({ prompt }) => prompt.name === entry.prompt.name)
      if (current >= 0) prompts.splice(current, 1)
      prompts.push(entry)
      prompts.sort((left, right) => left.prompt.name.localeCompare(right.prompt.name))
      for (const [name, handler] of Object.entries(entry.completions)) {
        completions.set(`ref/prompt/${entry.prompt.name}/${name}`, handler)
      }
    }).pipe(Effect.zipRight(publish({
      tag: SERVER_NOTIFICATION_METHOD_BY_TYPE.PromptListChangedNotification,
      payload: {}
    })), Effect.asVoid)

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

    return {
      tools, resources, resourceTemplates, prompts, notificationsQueue, options, publish, openSubscription,
      addTool, addResource, addResourceTemplate, addPrompt,
      callTool, findResource, getPromptResult, completion
    }
  })

  static readonly make: Effect.Effect<McpServerService> = McpServer.makeWithOptions({
    name: "mcp-effect-sdk",
    version: "1.0.0"
  })

  static readonly layer = Layer.effect(McpServer, McpServer.make)
}

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

const normalizeToolResult = (value: unknown): CallToolResult => {
  if (value instanceof CallToolResult) return value
  if (typeof value === "string") {
    return new CallToolResult({ resultType: "complete", content: [new TextContent({ type: "text", text: value })] })
  }
  if (Array.isArray(value)) return new CallToolResult({ resultType: "complete", content: value as Array<ContentBlock> })
  if (value && typeof value === "object" && Array.isArray((value as { content?: unknown }).content)) {
    return new CallToolResult({ ...value, resultType: "complete" } as ConstructorParameters<typeof CallToolResult>[0])
  }
  return new CallToolResult({
    resultType: "complete",
    content: [new TextContent({ type: "text", text: JSON.stringify(value) })],
    structuredContent: value
  })
}

const normalizeReadResult = (uri: string, value: unknown): ReadResourceResult => {
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

const normalizePromptResult = (value: unknown): GetPromptResult => {
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

export const registerTool = <F extends Fields = {}, R = never>(options: {
  readonly name: string
  readonly title?: string
  readonly description?: string
  readonly parameters?: F
  readonly outputSchema?: Readonly<Record<string, unknown>>
  readonly annotations?: VisibilityAnnotations
  readonly content: (params: FieldValues<F>, request: { readonly name: string; readonly arguments?: Record<string, unknown>; readonly _meta?: Record<string, unknown> }) => Effect.Effect<unknown, unknown, R>
}): Effect.Effect<void, never, McpServer | StableContext<R | Schema.Struct.Context<F>>> => Effect.gen(function*() {
  const server = yield* McpServer
  type Captured = StableContext<R | Schema.Struct.Context<F>>
  const captured = Context.omit(McpServerClient, McpServer)(yield* Effect.context<Captured>())
  const parameterSchema = Schema.Struct(options.parameters ?? {} as F)
  const inputSchema = {
    ...JSONSchema.make(parameterSchema),
    type: "object" as const
  }
  const entry: RegisteredTool = {
    tool: new Tool({
      name: options.name,
      title: options.title,
      description: options.description,
      inputSchema: inputSchema as unknown as ConstructorParameters<typeof Tool>[0]["inputSchema"],
      outputSchema: options.outputSchema
    }),
    annotations: options.annotations ?? Context.empty(),
    handler: (request) => Schema.decodeUnknown(parameterSchema)(request.arguments ?? {}).pipe(
      Effect.mapError((error) => new InvalidParams({ message: String(error) })),
      Effect.flatMap((params) => options.content(params as FieldValues<F>, request).pipe(Effect.provide(captured))),
      Effect.map(normalizeToolResult),
      Effect.catchAll((error) => Effect.succeed(new CallToolResult({
        resultType: "complete",
        isError: true,
        content: [new TextContent({ type: "text", text: error instanceof Error ? error.message : String(error) })]
      })))
    ) as Effect.Effect<CallToolResult, never, McpServerClient>
  }
  yield* server.addTool(entry)
})

export const tool = <F extends Fields = {}, R = never>(
  options: Parameters<typeof registerTool<F, R>>[0]
): Layer.Layer<never, never, McpServer | StableContext<R | Schema.Struct.Context<F>>> =>
  Layer.effectDiscard(registerTool(options))

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

export function registerResource<R>(options: ResourceOptions<R>): Effect.Effect<void, never, McpServer | StableContext<R>>
export function registerResource<const Params extends TemplateParams>(
  strings: TemplateStringsArray,
  ...params: Params
): <R, const Completions extends Partial<TemplateCompletions<Params>> = {}>(
  options: TemplateOptions<Params, R, Completions>
) => Effect.Effect<
  void,
  never,
  McpServer | TemplateRequirements<Params, R, Completions>
>
export function registerResource<R>(
  first: ResourceOptions<R> | TemplateStringsArray,
  ...params: TemplateParams
): Effect.Effect<void, never, McpServer | StableContext<R>> | (<
  R2,
  const Completions extends Partial<TemplateCompletions<TemplateParams>> = {}
>(options: TemplateOptions<TemplateParams, R2, Completions>) => Effect.Effect<
  void,
  never,
  McpServer | TemplateRequirements<TemplateParams, R2, Completions>
>) {
  if (!Array.isArray(first) || !Object.hasOwn(first, "raw")) {
    const options = first as ResourceOptions<R>
    return Effect.gen(function*() {
      const server = yield* McpServer
      const captured = Context.omit(McpServerClient, McpServer)(yield* Effect.context<StableContext<R>>())
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
          Effect.mapError((error) => new InternalError({ message: String(error) }))
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
    const captured = Context.omit(McpServerClient, McpServer)(yield* Effect.context<Captured>())
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
}): Effect.Effect<void, never, McpServer | StableContext<R | Schema.Struct.Context<F>>> => Effect.gen(function*() {
  const server = yield* McpServer
  type Captured = StableContext<R | Schema.Struct.Context<F>>
  const captured = Context.omit(McpServerClient, McpServer)(yield* Effect.context<Captured>())
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
      Effect.mapError((error) => new InternalError({ message: String(error) }))
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

export function resource<R>(options: ResourceOptions<R>): Layer.Layer<never, never, McpServer | StableContext<R>>
export function resource<const Params extends TemplateParams>(
  strings: TemplateStringsArray,
  ...params: Params
): <R, const Completions extends Partial<TemplateCompletions<Params>> = {}>(
  options: TemplateOptions<Params, R, Completions>
) => Layer.Layer<
  never,
  never,
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
      never,
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
): Layer.Layer<never, never, McpServer | StableContext<R | Schema.Struct.Context<F>>> =>
  Layer.effectDiscard(registerPrompt(options))

const sendNotification = (tag: string, payload: unknown): Effect.Effect<void, never, McpServer> =>
  McpServer.pipe(Effect.flatMap((server) => server.publish({ tag, payload })), Effect.asVoid)

export const sendLoggingMessage = (payload: unknown) => sendNotification(
  SERVER_NOTIFICATION_METHOD_BY_TYPE.LoggingMessageNotification,
  payload
)
export const sendProgress = (payload: unknown) => sendNotification(
  SERVER_NOTIFICATION_METHOD_BY_TYPE.ProgressNotification,
  payload
)
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
  Effect.map((client) => client.initializePayload.capabilities ?? {})
)

/** @deprecated Server-initiated requests moved to MRTR in the modern draft. */
export const sample = (): Effect.Effect<never, InternalError> => Effect.fail(InternalError.notImplemented)
/** @deprecated Server-initiated requests moved to MRTR in the modern draft. */
export const listRoots = (): Effect.Effect<never, InternalError> => Effect.fail(InternalError.notImplemented)
/** @deprecated Server-initiated requests moved to MRTR in the modern draft. */
export const elicit = (): Effect.Effect<never, InternalError> => Effect.fail(InternalError.notImplemented)
/** @deprecated Server-initiated requests moved to MRTR in the modern draft. */
export const elicitRaw = elicit

const clientForParams = (params: Record<string, unknown>, clientId: number | string = 0) => {
  const meta = isRecord(params._meta) ? params._meta : {}
  return McpServerClient.of({
    clientId,
    initializePayload: {
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

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value)

const invalidEncodedResult = Symbol("InvalidEncodedResult")

const defineJsonProperty = (
  target: Record<string, JsonValue>,
  key: string,
  value: JsonValue
): void => {
  Object.defineProperty(target, key, {
    value,
    enumerable: true,
    configurable: true,
    writable: true
  })
}

const normalizeEncodedResult = (
  value: unknown,
  seen: Set<object>
): JsonValue | typeof invalidEncodedResult => {
  if (value === null || typeof value === "string" || typeof value === "boolean") return value
  if (typeof value === "number") return Number.isFinite(value) ? value : invalidEncodedResult
  if (typeof value !== "object" || seen.has(value)) return invalidEncodedResult

  const prototype = Object.getPrototypeOf(value)
  if (Array.isArray(value)) {
    if (prototype !== Array.prototype) return invalidEncodedResult
    const keys = Reflect.ownKeys(value)
    const elementKeys = keys.filter((key) => key !== "length")
    if (elementKeys.some((key) => typeof key !== "string") || elementKeys.length !== value.length) {
      return invalidEncodedResult
    }
    const descriptors = Object.getOwnPropertyDescriptors(value)
    seen.add(value)
    try {
      const output: JsonValue[] = []
      for (let index = 0; index < value.length; index++) {
        const descriptor = descriptors[String(index)]
        if (descriptor === undefined || !("value" in descriptor) || !descriptor.enumerable) {
          return invalidEncodedResult
        }
        const item = normalizeEncodedResult(descriptor.value, seen)
        if (item === invalidEncodedResult) return invalidEncodedResult
        output.push(item)
      }
      return output
    } finally {
      seen.delete(value)
    }
  }

  if (prototype !== Object.prototype && prototype !== null) return invalidEncodedResult
  const keys = Reflect.ownKeys(value)
  if (keys.some((key) => typeof key !== "string")) return invalidEncodedResult
  const descriptors = Object.getOwnPropertyDescriptors(value)
  seen.add(value)
  try {
    const output: Record<string, JsonValue> = {}
    for (const key of keys as string[]) {
      const descriptor = descriptors[key]
      if (descriptor === undefined || !("value" in descriptor) || !descriptor.enumerable) {
        return invalidEncodedResult
      }
      if (descriptor.value === undefined) continue
      const item = normalizeEncodedResult(descriptor.value, seen)
      if (item === invalidEncodedResult) return invalidEncodedResult
      defineJsonProperty(output, key, item)
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

const encodeWireResult = (method: string, result: unknown): Effect.Effect<JsonValue, InternalError> => {
  const codec = Object.hasOwn(CLIENT_REQUEST_RESULT_CODEC_BY_METHOD, method)
    ? CLIENT_REQUEST_RESULT_CODEC_BY_METHOD[
      method as keyof typeof CLIENT_REQUEST_RESULT_CODEC_BY_METHOD
    ]
    : undefined
  const encoded = codec === undefined
    ? Effect.succeed(result)
    : Schema.encodeUnknown(codec as Schema.Schema.AnyNoContext)(result)
  return encoded.pipe(
    Effect.catchAllCause((cause) => Effect.fail(resultEncodingError(cause))),
    Effect.flatMap((value) => {
      const normalized = normalizeEncodedResult(value, new Set())
      return normalized === invalidEncodedResult
        ? Effect.fail(resultEncodingError())
        : Effect.succeed(normalized)
    })
  )
}

const discoverResult = (server: McpServerService) => {
  const capabilities: { extensions?: ExtensionCapabilities } = {}
  capabilities.extensions = normalizeExtensionCapabilities(server.options.extensions)
  return makeDiscoverResult({
    supportedVersions: server.options.supportedProtocolVersions ?? [MODERN_PROTOCOL_VERSION],
    capabilities: { ...capabilities, extensions: capabilities.extensions ?? {} } as never,
    serverInfo: { name: server.options.name, version: server.options.version },
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

const normalizeClientContext = (
  payload: McpSchemaClientPayload
): ClientContext => payload instanceof ClientContext
  ? payload
  : { ...payload, capabilities: payload.capabilities ?? {} } as ClientContext

type McpSchemaClientPayload = McpServerClientService["initializePayload"]

export const dispatch = (method: string, params: Record<string, unknown>): Effect.Effect<unknown, McpError, McpServer | McpServerClient> =>
  withRequestAnnotations(isRecord(params._meta) ? params._meta : {}, McpServer.pipe(Effect.flatMap((server): Effect.Effect<unknown, McpError, McpServerClient> => {
    switch (method) {
      case CLIENT_REQUEST_METHOD_BY_TYPE.DiscoverRequest:
        return Effect.succeed(discoverResult(server))
      case CLIENT_REQUEST_METHOD_BY_TYPE.ListToolsRequest:
        return McpServerClient.pipe(Effect.map((client) => new ListToolsResult({
          resultType: "complete", ttlMs: 0, cacheScope: "private",
          tools: filterByClient(normalizeClientContext(client.initializePayload), server.tools, "tool")
        })))
      case CLIENT_REQUEST_METHOD_BY_TYPE.CallToolRequest:
        return server.callTool(params as { name: string; arguments?: Record<string, unknown> })
      case CLIENT_REQUEST_METHOD_BY_TYPE.ListResourcesRequest:
        return McpServerClient.pipe(Effect.map((client) => new ListResourcesResult({
          resultType: "complete", ttlMs: 0, cacheScope: "private",
          resources: filterByClient(normalizeClientContext(client.initializePayload), server.resources, "resource")
        })))
      case CLIENT_REQUEST_METHOD_BY_TYPE.ListResourceTemplatesRequest:
        return McpServerClient.pipe(Effect.map((client) => new ListResourceTemplatesResult({
          resultType: "complete", ttlMs: 0, cacheScope: "private",
          resourceTemplates: filterByClient(normalizeClientContext(client.initializePayload), server.resourceTemplates, "template")
        })))
      case CLIENT_REQUEST_METHOD_BY_TYPE.ReadResourceRequest:
        return server.findResource(String(params.uri))
      case CLIENT_REQUEST_METHOD_BY_TYPE.ListPromptsRequest:
        return McpServerClient.pipe(Effect.map((client) => new ListPromptsResult({
          resultType: "complete", ttlMs: 0, cacheScope: "private",
          prompts: filterByClient(normalizeClientContext(client.initializePayload), server.prompts, "prompt")
        })))
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
        Effect.flatMap((context) => dispatch(
          request.method,
          isRecord(request.params) ? request.params : {}
        ).pipe(
          Effect.flatMap((result) => encodeWireResult(request.method, result)),
          Effect.provideService(McpServer, server),
          Effect.provideService(McpServerClient, clientForParams(
            isRecord(request.params) ? request.params : {},
            context.id
          ))
        ))
      )
  })
})

// Keep generated routing metadata visible at the server boundary.
void CLIENT_NOTIFICATION_METHOD_BY_TYPE
void SERVER_REQUEST_METHOD_BY_TYPE

export type ServerScope = Scope.Scope
