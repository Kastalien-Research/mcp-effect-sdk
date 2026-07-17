/**
 * Effect 3-native MCP server registry for the frozen modern draft surface.
 *
 * The JSON-RPC and transport rewrite remains WP4. This module establishes the
 * stable Context/Layer substrate and preserves the existing modern registry
 * behavior without Effect RPC, unstable imports, or Effect AI coupling.
 */
import * as Context from "effect/Context"
import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"
import * as Queue from "effect/Queue"
import * as Schema from "effect/Schema"
import type * as Scope from "effect/Scope"
import {
  CallToolResult,
  ClientContext,
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
  type Param
} from "./McpSchema.js"
import {
  CLIENT_NOTIFICATION_METHOD_BY_TYPE,
  CLIENT_REQUEST_METHOD_BY_TYPE,
  SERVER_NOTIFICATION_METHOD_BY_TYPE,
  SERVER_REQUEST_METHOD_BY_TYPE
} from "./generated/mcp/McpProtocol.generated.js"

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

type Fields = Schema.Struct.Fields
type FieldValues<F extends Fields> = { readonly [K in keyof F]: Schema.Schema.Type<F[K]> }
interface RegisteredTool {
  readonly tool: Tool
  readonly annotations: Context.Context<never>
  readonly handler: (request: { readonly name: string; readonly arguments?: Record<string, unknown>; readonly _meta?: Record<string, unknown> }) => Effect.Effect<CallToolResult, never, McpServerClient>
}

interface RegisteredResource {
  readonly resource: Resource
  readonly annotations: Context.Context<never>
  readonly read: (uri: string) => Effect.Effect<ReadResourceResult, McpError>
}

interface RegisteredTemplate {
  readonly template: ResourceTemplate
  readonly annotations: Context.Context<never>
  readonly match: (uri: string) => ReadonlyArray<string> | undefined
  readonly read: (uri: string, values: ReadonlyArray<string>) => Effect.Effect<ReadResourceResult, McpError>
}

interface RegisteredPrompt {
  readonly prompt: Prompt
  readonly annotations: Context.Context<never>
  readonly get: (args: Record<string, string>) => Effect.Effect<GetPromptResult, McpError>
}

export interface McpServerService {
  readonly tools: Array<RegisteredTool>
  readonly resources: Array<RegisteredResource>
  readonly resourceTemplates: Array<RegisteredTemplate>
  readonly prompts: Array<RegisteredPrompt>
  readonly notificationsQueue: Queue.Queue<ServerNotification>
  readonly addTool: (entry: RegisteredTool) => Effect.Effect<void>
  readonly addResource: (entry: RegisteredResource) => Effect.Effect<void>
  readonly addResourceTemplate: (entry: RegisteredTemplate) => Effect.Effect<void>
  readonly addPrompt: (entry: RegisteredPrompt) => Effect.Effect<void>
  readonly callTool: (request: { readonly name: string; readonly arguments?: Record<string, unknown>; readonly _meta?: Record<string, unknown> }) => Effect.Effect<CallToolResult, McpError, McpServerClient>
  readonly findResource: (uri: string) => Effect.Effect<ReadResourceResult, McpError>
  readonly getPromptResult: (request: { readonly name: string; readonly arguments?: Record<string, string> }) => Effect.Effect<GetPromptResult, McpError>
}

export class McpServer extends Context.Tag("mcp/McpServer")<McpServer, McpServerService>() {
  static readonly make: Effect.Effect<McpServerService> = Effect.gen(function*() {
    const notificationsQueue = yield* Queue.unbounded<ServerNotification>()
    const tools: Array<RegisteredTool> = []
    const resources: Array<RegisteredResource> = []
    const resourceTemplates: Array<RegisteredTemplate> = []
    const prompts: Array<RegisteredPrompt> = []

    const addTool = (entry: RegisteredTool) => Effect.sync(() => {
      const current = tools.findIndex(({ tool }) => tool.name === entry.tool.name)
      if (current >= 0) tools.splice(current, 1)
      tools.push(entry)
      tools.sort((left, right) => left.tool.name.localeCompare(right.tool.name))
    })
    const addResource = (entry: RegisteredResource) => Effect.sync(() => {
      const current = resources.findIndex(({ resource }) => resource.uri === entry.resource.uri)
      if (current >= 0) resources.splice(current, 1)
      resources.push(entry)
      resources.sort((left, right) => left.resource.uri.localeCompare(right.resource.uri))
    })
    const addResourceTemplate = (entry: RegisteredTemplate) => Effect.sync(() => {
      resourceTemplates.push(entry)
      resourceTemplates.sort((left, right) => left.template.uriTemplate.localeCompare(right.template.uriTemplate))
    })
    const addPrompt = (entry: RegisteredPrompt) => Effect.sync(() => {
      const current = prompts.findIndex(({ prompt }) => prompt.name === entry.prompt.name)
      if (current >= 0) prompts.splice(current, 1)
      prompts.push(entry)
      prompts.sort((left, right) => left.prompt.name.localeCompare(right.prompt.name))
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

    return {
      tools, resources, resourceTemplates, prompts, notificationsQueue,
      addTool, addResource, addResourceTemplate, addPrompt,
      callTool, findResource, getPromptResult
    }
  })

  static readonly layer = Layer.effect(McpServer, McpServer.make)
}

const normalizeToolResult = (value: unknown): CallToolResult => {
  if (value instanceof CallToolResult) return value
  if (typeof value === "string") {
    return new CallToolResult({ content: [new TextContent({ type: "text", text: value })] })
  }
  if (Array.isArray(value)) return new CallToolResult({ content: value as Array<ContentBlock> })
  if (value && typeof value === "object" && Array.isArray((value as { content?: unknown }).content)) {
    return new CallToolResult(value as ConstructorParameters<typeof CallToolResult>[0])
  }
  return new CallToolResult({
    content: [new TextContent({ type: "text", text: JSON.stringify(value) })],
    structuredContent: value
  })
}

const normalizeReadResult = (uri: string, value: unknown): ReadResourceResult => {
  if (value instanceof ReadResourceResult) return value
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
          return new TextResourceContents({
            uri: String(item.uri ?? uri),
            mimeType: typeof item.mimeType === "string" ? item.mimeType : undefined,
            text: typeof item.text === "string" ? item.text : String(item.blob ?? "")
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
  return new GetPromptResult(value as ConstructorParameters<typeof GetPromptResult>[0])
}

export const registerTool = <F extends Fields = {}, R = never>(options: {
  readonly name: string
  readonly title?: string
  readonly description?: string
  readonly parameters?: F
  readonly outputSchema?: unknown
  readonly content: (params: FieldValues<F>, request: { readonly name: string; readonly arguments?: Record<string, unknown>; readonly _meta?: Record<string, unknown> }) => Effect.Effect<unknown, unknown, R>
}): Effect.Effect<void, never, McpServer | R> => Effect.gen(function*() {
  const server = yield* McpServer
  const captured = yield* Effect.context<R>()
  const parameterSchema = Schema.Struct(options.parameters ?? {} as F)
  const entry: RegisteredTool = {
    tool: new Tool({
      name: options.name,
      title: options.title,
      description: options.description,
      inputSchema: { type: "object" },
      outputSchema: options.outputSchema
    }),
    annotations: Context.empty(),
    handler: (request) => Schema.decodeUnknown(parameterSchema)(request.arguments ?? {}).pipe(
      Effect.mapError((error) => new InvalidParams({ message: String(error) })),
      Effect.flatMap((params) => options.content(params as FieldValues<F>, request).pipe(Effect.provide(captured))),
      Effect.map(normalizeToolResult),
      Effect.catchAll((error) => Effect.succeed(new CallToolResult({
        isError: true,
        content: [new TextContent({ type: "text", text: error instanceof Error ? error.message : String(error) })]
      })))
    ) as Effect.Effect<CallToolResult, never, McpServerClient>
  }
  yield* server.addTool(entry)
})

export const tool = <F extends Fields = {}, R = never>(options: Parameters<typeof registerTool<F, R>>[0]) =>
  Layer.effectDiscard(registerTool(options))

interface ResourceOptions<R> {
  readonly uri: string
  readonly name: string
  readonly title?: string
  readonly description?: string
  readonly mimeType?: string
  readonly audience?: ReadonlyArray<"user" | "assistant">
  readonly priority?: number
  readonly content: Effect.Effect<unknown, unknown, R>
}

interface TemplateOptions<R> {
  readonly name: string
  readonly title?: string
  readonly description?: string
  readonly mimeType?: string
  readonly completion?: Readonly<Record<string, (input: string) => Effect.Effect<ReadonlyArray<string>, unknown, R>>>
  readonly content: (uri: string, ...values: ReadonlyArray<string>) => Effect.Effect<unknown, unknown, R>
}

export function registerResource<R>(options: ResourceOptions<R>): Effect.Effect<void, never, McpServer | R>
export function registerResource(strings: TemplateStringsArray, ...params: ReadonlyArray<Param<string, Schema.Schema.Any>>): <R>(options: TemplateOptions<R>) => Effect.Effect<void, never, McpServer | R>
export function registerResource<R>(
  first: ResourceOptions<R> | TemplateStringsArray,
  ...params: ReadonlyArray<Param<string, Schema.Schema.Any>>
): Effect.Effect<void, never, McpServer | R> | (<R2>(options: TemplateOptions<R2>) => Effect.Effect<void, never, McpServer | R2>) {
  if (!Array.isArray(first) || !Object.hasOwn(first, "raw")) {
    const options = first as ResourceOptions<R>
    return Effect.gen(function*() {
      const server = yield* McpServer
      const captured = yield* Effect.context<R>()
      yield* server.addResource({
        resource: new Resource({
          uri: options.uri, name: options.name, title: options.title,
          description: options.description, mimeType: options.mimeType
        }),
        annotations: Context.empty(),
        read: (uri) => options.content.pipe(
          Effect.provide(captured),
          Effect.map((value) => normalizeReadResult(uri, value)),
          Effect.mapError((error) => new InternalError({ message: String(error) }))
        )
      })
    })
  }
  const strings = first as unknown as TemplateStringsArray
  return <R2>(options: TemplateOptions<R2>) => Effect.gen(function*() {
    const server = yield* McpServer
    const captured = yield* Effect.context<R2>()
    const source = strings.reduce((result, part, index) => result + part + (index < params.length ? `{${params[index].name}}` : ""), "")
    const pattern = new RegExp(`^${strings.map(escapeRegex).join("(.+)")}$`)
    yield* server.addResourceTemplate({
      template: new ResourceTemplate({
        uriTemplate: source, name: options.name, title: options.title,
        description: options.description, mimeType: options.mimeType
      }),
      annotations: Context.empty(),
      match: (uri) => pattern.exec(uri)?.slice(1),
      read: (uri, values) => options.content(uri, ...values).pipe(
        Effect.provide(captured),
        Effect.map((value) => normalizeReadResult(uri, value)),
        Effect.mapError((error) => new InternalError({ message: String(error) }))
      )
    })
  })
}

const escapeRegex = (value: string): string => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")

export const registerPrompt = <F extends Fields = {}, A = unknown, E = never, R = never>(options: {
  readonly name: string
  readonly title?: string
  readonly description?: string
  readonly parameters?: F
  readonly completion?: Readonly<Record<string, (input: string) => Effect.Effect<ReadonlyArray<string>, unknown, R>>>
  readonly content: (params: FieldValues<F>) => Effect.Effect<unknown, unknown, R>
}): Effect.Effect<void, never, McpServer | R> => Effect.gen(function*() {
  const server = yield* McpServer
  const captured = yield* Effect.context<R>()
  const parameterSchema = Schema.Struct(options.parameters ?? {} as F)
  yield* server.addPrompt({
    prompt: new Prompt({
      name: options.name,
      title: options.title,
      description: options.description,
      arguments: Object.entries(options.parameters ?? {}).map(([name]) => new PromptArgument({ name, required: true }))
    }),
    annotations: Context.empty(),
    get: (args) => Schema.decodeUnknown(parameterSchema)(args).pipe(
      Effect.mapError((error) => new InvalidParams({ message: String(error) })),
      Effect.flatMap((params) => options.content(params as FieldValues<F>).pipe(Effect.provide(captured))),
      Effect.map(normalizePromptResult),
      Effect.mapError((error) => new InternalError({ message: String(error) }))
    ) as Effect.Effect<GetPromptResult, McpError>
  })
})

export function resource<R>(options: ResourceOptions<R>): Layer.Layer<never, never, McpServer | R>
export function resource(strings: TemplateStringsArray, ...params: ReadonlyArray<Param<string, Schema.Schema.Any>>): <R>(options: TemplateOptions<R>) => Layer.Layer<never, never, McpServer | R>
export function resource<R>(first: ResourceOptions<R> | TemplateStringsArray, ...params: ReadonlyArray<Param<string, Schema.Schema.Any>>) {
  if (Array.isArray(first) && Object.hasOwn(first, "raw")) {
    const registerTemplate = registerResource as (
      strings: TemplateStringsArray,
      ...parameters: ReadonlyArray<Param<string, Schema.Schema.Any>>
    ) => <R2>(options: TemplateOptions<R2>) => Effect.Effect<void, never, McpServer | R2>
    const registered = registerTemplate(first as unknown as TemplateStringsArray, ...params)
    return <R2>(options: TemplateOptions<R2>) => Layer.effectDiscard(registered(options))
  }
  return Layer.effectDiscard(registerResource(first as ResourceOptions<R>))
}

export const prompt = <F extends Fields = {}, R = never>(options: Parameters<typeof registerPrompt<F, unknown, unknown, R>>[0]) =>
  Layer.effectDiscard(registerPrompt(options))

const sendNotification = (tag: string, payload: unknown): Effect.Effect<void, never, McpServer> =>
  McpServer.pipe(Effect.flatMap((server) => Queue.offer(server.notificationsQueue, { tag, payload })), Effect.asVoid)

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

/** @deprecated Server-initiated requests moved to MRTR in the modern draft. */
export const sample = (): Effect.Effect<never, InternalError> => Effect.fail(InternalError.notImplemented)
/** @deprecated Server-initiated requests moved to MRTR in the modern draft. */
export const listRoots = (): Effect.Effect<never, InternalError> => Effect.fail(InternalError.notImplemented)
/** @deprecated Server-initiated requests moved to MRTR in the modern draft. */
export const elicit = (): Effect.Effect<never, InternalError> => Effect.fail(InternalError.notImplemented)
/** @deprecated Server-initiated requests moved to MRTR in the modern draft. */
export const elicitRaw = elicit

export interface ServerLayerOptions {
  readonly name: string
  readonly version: string
  readonly extensions?: ExtensionCapabilities
}

export const layerHttp = (options: ServerLayerOptions & { readonly path: string; readonly instructions?: string; readonly supportedProtocolVersions?: ReadonlyArray<string> }) => {
  const capabilities: { extensions?: ExtensionCapabilities } = {}
  capabilities.extensions = normalizeExtensionCapabilities(options.extensions)
  return McpServer.layer
}
export const layerStdio = (options: ServerLayerOptions) => {
  const capabilities: { extensions?: ExtensionCapabilities } = {}
  capabilities.extensions = normalizeExtensionCapabilities(options.extensions)
  return McpServer.layer
}

export const dispatch = (method: string, params: Record<string, unknown>): Effect.Effect<unknown, McpError, McpServer | McpServerClient> =>
  McpServer.pipe(Effect.flatMap((server): Effect.Effect<unknown, McpError, McpServerClient> => {
    switch (method) {
      case CLIENT_REQUEST_METHOD_BY_TYPE.ListToolsRequest:
        return Effect.succeed(new ListToolsResult({
          resultType: "complete", ttlMs: 0, cacheScope: "private",
          tools: server.tools.map(({ tool }) => tool)
        }))
      case CLIENT_REQUEST_METHOD_BY_TYPE.CallToolRequest:
        return server.callTool(params as { name: string; arguments?: Record<string, unknown> })
      case CLIENT_REQUEST_METHOD_BY_TYPE.ListResourcesRequest:
        return Effect.succeed(new ListResourcesResult({
          resultType: "complete", ttlMs: 0, cacheScope: "private",
          resources: server.resources.map(({ resource }) => resource)
        }))
      case CLIENT_REQUEST_METHOD_BY_TYPE.ListResourceTemplatesRequest:
        return Effect.succeed(new ListResourceTemplatesResult({
          resultType: "complete", ttlMs: 0, cacheScope: "private",
          resourceTemplates: server.resourceTemplates.map(({ template }) => template)
        }))
      case CLIENT_REQUEST_METHOD_BY_TYPE.ReadResourceRequest:
        return server.findResource(String(params.uri))
      case CLIENT_REQUEST_METHOD_BY_TYPE.ListPromptsRequest:
        return Effect.succeed(new ListPromptsResult({
          resultType: "complete", ttlMs: 0, cacheScope: "private",
          prompts: server.prompts.map(({ prompt }) => prompt)
        }))
      case CLIENT_REQUEST_METHOD_BY_TYPE.GetPromptRequest:
        return server.getPromptResult(params as { name: string; arguments?: Record<string, string> })
      default:
        return Effect.fail(new MethodNotFound({ message: `Method '${method}' not found` }))
    }
  }))

// Keep generated routing metadata visible at the server boundary.
void CLIENT_NOTIFICATION_METHOD_BY_TYPE
void SERVER_REQUEST_METHOD_BY_TYPE

export type ServerScope = Scope.Scope
