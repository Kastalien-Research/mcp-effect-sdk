/**
 * Effect 3 schema facade for the frozen MCP 2026-07-28 draft.
 *
 * WP2 establishes the stable Effect substrate and preserves the current modern
 * surface. WP3 replaces these maintained codecs with authoritative generated
 * codecs from the frozen schema registry.
 */
import * as Context from "effect/Context"
import type * as Effect from "effect/Effect"
import * as Schema from "effect/Schema"
import * as Generated from "./generated/mcp/McpSchema.generated.js"
import {
  CLIENT_NOTIFICATION_DESCRIPTORS,
  CLIENT_REQUEST_DESCRIPTORS,
  SERVER_NOTIFICATION_DESCRIPTORS
} from "./generated/mcp/McpProtocol.generated.js"

export const MCP_SCHEMA_VERSION = Generated.MCP_SCHEMA_VERSION
export const MCP_SCHEMA_DEFINITION_NAMES = Generated.MCP_SCHEMA_DEFINITION_NAMES
export type McpSchemaDefinitionName = Generated.McpSchemaDefinitionName
export const MCP_SCHEMA_DEFINITIONS = Generated.MCP_SCHEMA_DEFINITIONS
export type McpRawJsonSchema = Generated.McpRawJsonSchema

export const optional = Schema.optional
export const optionalWithDefault = <S extends Schema.Schema.Any>(
  schema: S,
  defaultValue: () => Schema.Schema.Type<S>
) => Schema.optionalWith(schema, { default: defaultValue })

const Meta = Schema.Record({ key: Schema.String, value: Schema.Unknown })
const JsonSchema = Meta
const CompleteFields = {
  resultType: Schema.Literal("complete")
}
const CacheFields = {
  ttlMs: Schema.NonNegativeInt,
  cacheScope: Schema.Literal("public", "private")
}

export const RequestId = Schema.Union(Schema.String, Schema.Number)
export type RequestId = typeof RequestId.Type
export const ProgressToken = RequestId
export type ProgressToken = RequestId
export const Cursor = Schema.String
export type Cursor = string
export const Role = Schema.Literal("user", "assistant")
export type Role = typeof Role.Type

export class RequestMeta extends Schema.Class<RequestMeta>("mcp/RequestMeta")({
  _meta: Schema.optional(Meta)
}) {}
export class ResultMeta extends Schema.Class<ResultMeta>("mcp/ResultMeta")({
  _meta: Schema.optional(Meta)
}) {}
export class NotificationMeta extends Schema.Class<NotificationMeta>("mcp/NotificationMeta")({
  _meta: Schema.optional(Meta)
}) {}
export class PaginatedRequestMeta extends Schema.Class<PaginatedRequestMeta>("mcp/PaginatedRequestMeta")({
  ...RequestMeta.fields,
  cursor: Schema.optional(Cursor)
}) {}
export class PaginatedResultMeta extends Schema.Class<PaginatedResultMeta>("mcp/PaginatedResultMeta")({
  ...ResultMeta.fields,
  nextCursor: Schema.optional(Cursor)
}) {}
export class Annotations extends Schema.Class<Annotations>("mcp/Annotations")({
  audience: Schema.optional(Schema.Array(Role)),
  priority: Schema.optional(Schema.Number.pipe(Schema.between(0, 1))),
  lastModified: Schema.optional(Schema.String)
}) {}
export class Implementation extends Schema.Class<Implementation>("mcp/Implementation")({
  name: Schema.String,
  title: Schema.optional(Schema.String),
  version: Schema.String
}) {}

export const ClientCapabilities = Generated.ClientCapabilities
export type ClientCapabilities = typeof ClientCapabilities.Type
export const ServerCapabilities = Generated.ServerCapabilities
export type ServerCapabilities = typeof ServerCapabilities.Type

export const INVALID_REQUEST_ERROR_CODE = -32600 as const
export const METHOD_NOT_FOUND_ERROR_CODE = -32601 as const
export const INVALID_PARAMS_ERROR_CODE = -32602 as const
export const INTERNAL_ERROR_CODE = -32603 as const
export const PARSE_ERROR_CODE = -32700 as const

const errorFields = <Code extends number>(code: Code) => ({
  code: Schema.optionalWith(Schema.Literal(code), { default: () => code }),
  message: Schema.String,
  data: Schema.optional(Schema.Unknown)
})
export class McpErrorBase extends Schema.Class<McpErrorBase>("mcp/McpErrorBase")({
  code: Schema.Number,
  message: Schema.String,
  data: Schema.optional(Schema.Unknown)
}) {}
export class ParseError extends Schema.TaggedError<ParseError>("mcp/ParseError")("ParseError", errorFields(PARSE_ERROR_CODE)) {}
export class InvalidRequest extends Schema.TaggedError<InvalidRequest>("mcp/InvalidRequest")("InvalidRequest", errorFields(INVALID_REQUEST_ERROR_CODE)) {}
export class MethodNotFound extends Schema.TaggedError<MethodNotFound>("mcp/MethodNotFound")("MethodNotFound", errorFields(METHOD_NOT_FOUND_ERROR_CODE)) {}
export class InvalidParams extends Schema.TaggedError<InvalidParams>("mcp/InvalidParams")("InvalidParams", errorFields(INVALID_PARAMS_ERROR_CODE)) {}
export class InternalError extends Schema.TaggedError<InternalError>("mcp/InternalError")("InternalError", errorFields(INTERNAL_ERROR_CODE)) {
  static readonly notImplemented = new InternalError({ message: "Not implemented" })
}
export const McpError = Schema.Union(ParseError, InvalidRequest, MethodNotFound, InvalidParams, InternalError, McpErrorBase)
export type McpError = typeof McpError.Type

export class ClientContext extends Schema.Class<ClientContext>("mcp/ClientContext")({
  protocolVersion: Schema.optional(Schema.String),
  capabilities: Schema.optionalWith(ClientCapabilities, { default: () => new ClientCapabilities({}) }),
  clientInfo: Schema.optional(Implementation),
  traceparent: Schema.optional(Schema.String),
  tracestate: Schema.optional(Schema.String),
  baggage: Schema.optional(Schema.String)
}) {}

export class DiscoverResult extends Schema.Class<DiscoverResult>("mcp/DiscoverResult")({
  ...ResultMeta.fields,
  resultType: Schema.Literal("complete"),
  supportedVersions: Schema.Array(Schema.String),
  capabilities: ServerCapabilities,
  serverInfo: Implementation,
  instructions: Schema.optional(Schema.String),
  ...CacheFields
}) {}

export class Resource extends Schema.Class<Resource>("mcp/Resource")({
  uri: Schema.String,
  name: Schema.String,
  title: Schema.optional(Schema.String),
  description: Schema.optional(Schema.String),
  mimeType: Schema.optional(Schema.String),
  annotations: Schema.optional(Annotations),
  size: Schema.optional(Schema.Number),
  _meta: Schema.optional(Meta)
}) {}
export class ResourceTemplate extends Schema.Class<ResourceTemplate>("mcp/ResourceTemplate")({
  uriTemplate: Schema.String,
  name: Schema.String,
  title: Schema.optional(Schema.String),
  description: Schema.optional(Schema.String),
  mimeType: Schema.optional(Schema.String),
  annotations: Schema.optional(Annotations),
  _meta: Schema.optional(Meta)
}) {}
export class ResourceContents extends Schema.Class<ResourceContents>("mcp/ResourceContents")({
  uri: Schema.String,
  mimeType: Schema.optional(Schema.String),
  _meta: Schema.optional(Meta)
}) {}
export class TextResourceContents extends Schema.Class<TextResourceContents>("mcp/TextResourceContents")({
  ...ResourceContents.fields,
  text: Schema.String
}) {}
export class BlobResourceContents extends Schema.Class<BlobResourceContents>("mcp/BlobResourceContents")({
  ...ResourceContents.fields,
  blob: Schema.Uint8ArrayFromBase64
}) {}

export class PromptArgument extends Schema.Class<PromptArgument>("mcp/PromptArgument")({
  name: Schema.String,
  title: Schema.optional(Schema.String),
  description: Schema.optional(Schema.String),
  required: Schema.optional(Schema.Boolean)
}) {}
export class Prompt extends Schema.Class<Prompt>("mcp/Prompt")({
  name: Schema.String,
  title: Schema.optional(Schema.String),
  description: Schema.optional(Schema.String),
  arguments: Schema.optional(Schema.Array(PromptArgument)),
  _meta: Schema.optional(Meta)
}) {}
export class TextContent extends Schema.Class<TextContent>("mcp/TextContent")({
  type: Schema.Literal("text"),
  text: Schema.String,
  annotations: Schema.optional(Annotations),
  _meta: Schema.optional(Meta)
}) {}
export class ImageContent extends Schema.Class<ImageContent>("mcp/ImageContent")({
  type: Schema.Literal("image"),
  data: Schema.Uint8Array,
  mimeType: Schema.String,
  annotations: Schema.optional(Annotations),
  _meta: Schema.optional(Meta)
}) {}
export class AudioContent extends Schema.Class<AudioContent>("mcp/AudioContent")({
  type: Schema.Literal("audio"),
  data: Schema.Uint8Array,
  mimeType: Schema.String,
  annotations: Schema.optional(Annotations),
  _meta: Schema.optional(Meta)
}) {}
export class EmbeddedResource extends Schema.Class<EmbeddedResource>("mcp/EmbeddedResource")({
  type: Schema.Literal("resource"),
  resource: Schema.Union(TextResourceContents, BlobResourceContents),
  annotations: Schema.optional(Annotations),
  _meta: Schema.optional(Meta)
}) {}
export class ResourceLink extends Schema.Class<ResourceLink>("mcp/ResourceLink")({
  type: Schema.Literal("resource_link"),
  uri: Schema.String,
  name: Schema.String,
  title: Schema.optional(Schema.String),
  description: Schema.optional(Schema.String),
  mimeType: Schema.optional(Schema.String),
  annotations: Schema.optional(Annotations),
  size: Schema.optional(Schema.Number),
  _meta: Schema.optional(Meta)
}) {}
export const ContentBlock = Schema.Union(TextContent, ImageContent, AudioContent, EmbeddedResource, ResourceLink)
export type ContentBlock = typeof ContentBlock.Type
export class PromptMessage extends Schema.Class<PromptMessage>("mcp/PromptMessage")({
  role: Role,
  content: ContentBlock
}) {}

export class ToolAnnotations extends Schema.Class<ToolAnnotations>("mcp/ToolAnnotations")({
  title: Schema.optional(Schema.String),
  readOnlyHint: Schema.optional(Schema.Boolean),
  destructiveHint: Schema.optional(Schema.Boolean),
  idempotentHint: Schema.optional(Schema.Boolean),
  openWorldHint: Schema.optional(Schema.Boolean)
}) {}
export class ToolExecution extends Schema.Class<ToolExecution>("mcp/ToolExecution")({
  taskSupport: Schema.optional(Schema.String)
}) {}
export class Tool extends Schema.Class<Tool>("mcp/Tool")({
  name: Schema.String,
  title: Schema.optional(Schema.String),
  description: Schema.optional(Schema.String),
  inputSchema: JsonSchema,
  outputSchema: Schema.optional(JsonSchema),
  annotations: Schema.optional(ToolAnnotations),
  execution: Schema.optional(ToolExecution),
  _meta: Schema.optional(Meta)
}) {}

export class ListToolsResult extends Schema.Class<ListToolsResult>("mcp/ListToolsResult")({
  ...ResultMeta.fields,
  ...CompleteFields,
  ...CacheFields,
  nextCursor: Schema.optional(Cursor),
  tools: Schema.Array(Tool)
}) {}
export class CallToolResult extends Schema.Class<CallToolResult>("mcp/CallToolResult")({
  ...ResultMeta.fields,
  ...CompleteFields,
  content: Schema.Array(ContentBlock),
  structuredContent: Schema.optional(Schema.Unknown),
  isError: Schema.optional(Schema.Boolean)
}) {}
export class ListResourcesResult extends Schema.Class<ListResourcesResult>("mcp/ListResourcesResult")({
  ...ResultMeta.fields,
  ...CompleteFields,
  ...CacheFields,
  nextCursor: Schema.optional(Cursor),
  resources: Schema.Array(Resource)
}) {}
export class ListResourceTemplatesResult extends Schema.Class<ListResourceTemplatesResult>("mcp/ListResourceTemplatesResult")({
  ...ResultMeta.fields,
  ...CompleteFields,
  ...CacheFields,
  nextCursor: Schema.optional(Cursor),
  resourceTemplates: Schema.Array(ResourceTemplate)
}) {}
export class ReadResourceResult extends Schema.Class<ReadResourceResult>("mcp/ReadResourceResult")({
  ...ResultMeta.fields,
  ...CompleteFields,
  ...CacheFields,
  contents: Schema.Array(Schema.Union(TextResourceContents, BlobResourceContents))
}) {}
export class ListPromptsResult extends Schema.Class<ListPromptsResult>("mcp/ListPromptsResult")({
  ...ResultMeta.fields,
  ...CompleteFields,
  ...CacheFields,
  nextCursor: Schema.optional(Cursor),
  prompts: Schema.Array(Prompt)
}) {}
export class GetPromptResult extends Schema.Class<GetPromptResult>("mcp/GetPromptResult")({
  ...ResultMeta.fields,
  ...CompleteFields,
  description: Schema.optional(Schema.String),
  messages: Schema.Array(PromptMessage)
}) {}

export const LoggingLevel = Schema.Literal("debug", "info", "notice", "warning", "error", "critical", "alert", "emergency")
export type LoggingLevel = typeof LoggingLevel.Type
export class SamplingMessage extends Schema.Class<SamplingMessage>("mcp/SamplingMessage")({
  role: Role,
  content: ContentBlock
}) {}
export class ModelHint extends Schema.Class<ModelHint>("mcp/ModelHint")({ name: Schema.optional(Schema.String) }) {}
export class ModelPreferences extends Schema.Class<ModelPreferences>("mcp/ModelPreferences")({
  hints: Schema.optional(Schema.Array(ModelHint)),
  costPriority: Schema.optional(Schema.Number),
  speedPriority: Schema.optional(Schema.Number),
  intelligencePriority: Schema.optional(Schema.Number)
}) {}
export class CreateMessageResult extends Schema.Class<CreateMessageResult>("mcp/CreateMessageResult")({
  ...ResultMeta.fields,
  ...CompleteFields,
  role: Role,
  content: ContentBlock,
  model: Schema.String,
  stopReason: Schema.optional(Schema.String)
}) {}
export class ResourceReference extends Schema.Class<ResourceReference>("mcp/ResourceReference")({
  type: Schema.Literal("ref/resource"), uri: Schema.String
}) {}
export class PromptReference extends Schema.Class<PromptReference>("mcp/PromptReference")({
  type: Schema.Literal("ref/prompt"), name: Schema.String
}) {}
export class CompleteResult extends Schema.Class<CompleteResult>("mcp/CompleteResult")({
  ...ResultMeta.fields,
  ...CompleteFields,
  completion: Schema.Struct({
    values: Schema.Array(Schema.String).pipe(Schema.maxItems(100)),
    total: Schema.optional(Schema.NonNegativeInt),
    hasMore: Schema.optional(Schema.Boolean)
  })
}) {}
export class Root extends Schema.Class<Root>("mcp/Root")({ uri: Schema.String, name: Schema.optional(Schema.String) }) {}
export class ListRootsResult extends Schema.Class<ListRootsResult>("mcp/ListRootsResult")({
  ...ResultMeta.fields,
  ...CompleteFields,
  roots: Schema.Array(Root)
}) {}

export class ElicitAcceptResult extends Schema.Class<ElicitAcceptResult>("mcp/ElicitAcceptResult")({
  action: Schema.Literal("accept"), content: Meta
}) {}
export class ElicitDeclineResult extends Schema.Class<ElicitDeclineResult>("mcp/ElicitDeclineResult")({
  action: Schema.Literal("decline", "cancel")
}) {}
export const ElicitResult = Schema.Union(ElicitAcceptResult, ElicitDeclineResult)
export type ElicitResult = typeof ElicitResult.Type

export const ResultType = Schema.String
export type ResultType = string
export const InputRequest = Schema.Struct({ method: Schema.String, params: Schema.optional(Schema.Unknown) })
export type InputRequest = typeof InputRequest.Type
export const InputRequests = Schema.Record({ key: Schema.String, value: InputRequest })
export type InputRequests = typeof InputRequests.Type
export const InputResponses = Schema.Record({ key: Schema.String, value: Schema.Unknown })
export type InputResponses = typeof InputResponses.Type
export class InputRequiredResult extends Schema.Class<InputRequiredResult>("mcp/InputRequiredResult")({
  ...ResultMeta.fields,
  resultType: Schema.Literal("input_required"),
  inputRequests: InputRequests,
  requestState: Schema.optional(Schema.Unknown)
}) {}
export const InputResponseRequestParams = Schema.Struct({
  inputResponses: Schema.optional(InputResponses),
  requestState: Schema.optional(Schema.Unknown)
})
export type InputResponseRequestParams = typeof InputResponseRequestParams.Type

// Tasks remain excluded from the core export/runtime until WP7; these wire
// placeholders keep the pre-WP7 source tree compiling without claiming support.
export const TaskStatus = Schema.Literal("working", "input_required", "completed", "failed", "cancelled")
export type TaskStatus = typeof TaskStatus.Type
export const TaskMetadata = Meta
export type TaskMetadata = typeof TaskMetadata.Type
export const RelatedTaskMetadata = Meta
export type RelatedTaskMetadata = typeof RelatedTaskMetadata.Type
export const Task = Schema.Unknown
export type Task = unknown
export const CreateTaskResult = Schema.Unknown
export type CreateTaskResult = unknown
export const GetTaskResult = Schema.Unknown
export type GetTaskResult = unknown
export const GetTaskPayloadResult = Schema.Unknown
export type GetTaskPayloadResult = unknown
export const CancelTaskResult = Schema.Unknown
export type CancelTaskResult = unknown
export const ListTasksResult = Schema.Unknown
export type ListTasksResult = unknown
export const TaskStatusNotificationParams = Schema.Unknown
export type TaskStatusNotificationParams = unknown
export const ElicitationCompleteNotificationParams = Schema.Unknown
export type ElicitationCompleteNotificationParams = unknown

interface RpcDescriptor<P extends Schema.Schema.Any = typeof Schema.Unknown, S extends Schema.Schema.Any = typeof Schema.Unknown> {
  readonly tag: string
  readonly payloadSchema: P
  readonly successSchema: S
  readonly errorSchema: typeof McpError
}
const rpc = <P extends Schema.Schema.Any, S extends Schema.Schema.Any>(tag: string, payloadSchema: P, successSchema: S): RpcDescriptor<P, S> => ({
  tag, payloadSchema, successSchema, errorSchema: McpError
})
const notification = <P extends Schema.Schema.Any>(tag: string, payloadSchema: P) => rpc(tag, payloadSchema, Schema.Void)
const UnsupportedSchema = Schema.Struct({}).pipe(Schema.filter(() => false))

export const SubscriptionFilter = Schema.Struct({
  toolsListChanged: Schema.optional(Schema.Boolean),
  promptsListChanged: Schema.optional(Schema.Boolean),
  resourcesListChanged: Schema.optional(Schema.Boolean),
  resourceSubscriptions: Schema.optional(Schema.Array(Schema.String))
})
export type SubscriptionFilter = typeof SubscriptionFilter.Type
export const SubscriptionsListenResult = Schema.Struct({
  ...ResultMeta.fields,
  ...CompleteFields,
  _meta: Schema.Struct({
    "io.modelcontextprotocol/subscriptionId": RequestId
  })
})
export type SubscriptionsListenResult = typeof SubscriptionsListenResult.Type

const EmptyRequestPayload = Schema.UndefinedOr(RequestMeta)
const PaginatedRequestPayload = PaginatedRequestMeta

export const Discover = rpc("server/discover", EmptyRequestPayload, DiscoverResult)
export const ListTools = rpc("tools/list", PaginatedRequestPayload, ListToolsResult)
export const CallTool = rpc("tools/call", Schema.Struct({ name: Schema.String, arguments: Schema.optional(Meta), ...RequestMeta.fields }), CallToolResult)
export const ListResources = rpc("resources/list", PaginatedRequestPayload, ListResourcesResult)
export const ListResourceTemplates = rpc("resources/templates/list", PaginatedRequestPayload, ListResourceTemplatesResult)
export const ReadResource = rpc("resources/read", Schema.Struct({ uri: Schema.String, ...InputResponseRequestParams.fields, ...RequestMeta.fields }), ReadResourceResult)
export const ListPrompts = rpc("prompts/list", PaginatedRequestPayload, ListPromptsResult)
export const GetPrompt = rpc("prompts/get", Schema.Struct({ name: Schema.String, arguments: Schema.optional(Meta), ...RequestMeta.fields }), GetPromptResult)
export const Complete = rpc("completion/complete", Schema.Struct({
  ref: Schema.Union(PromptReference, ResourceReference),
  argument: Schema.Struct({ name: Schema.String, value: Schema.String }),
  context: Schema.optional(Schema.Struct({
    arguments: Schema.optional(Schema.Record({ key: Schema.String, value: Schema.String }))
  })),
  ...RequestMeta.fields
}), CompleteResult)
export const SubscriptionsListen = rpc("subscriptions/listen", Schema.Struct({ notifications: SubscriptionFilter, ...RequestMeta.fields }), SubscriptionsListenResult)
export const CancelledNotification = notification("notifications/cancelled", Schema.Struct({ requestId: RequestId, reason: Schema.optional(Schema.String), ...NotificationMeta.fields }))
export const ToolListChangedNotification = notification("notifications/tools/list_changed", Schema.UndefinedOr(NotificationMeta))
export const ResourceListChangedNotification = notification("notifications/resources/list_changed", Schema.UndefinedOr(NotificationMeta))
export const ResourceUpdatedNotification = notification("notifications/resources/updated", Schema.Struct({ uri: Schema.String, ...NotificationMeta.fields }))
export const PromptListChangedNotification = notification("notifications/prompts/list_changed", Schema.UndefinedOr(NotificationMeta))
export const LoggingMessageNotification = notification("notifications/message", Schema.Struct({
  level: LoggingLevel,
  logger: Schema.optional(Schema.String),
  data: Schema.Unknown,
  ...NotificationMeta.fields
}))
export const ProgressNotification = notification("notifications/progress", Schema.Struct({
  progressToken: ProgressToken,
  progress: Schema.Number,
  total: Schema.optional(Schema.Number),
  message: Schema.optional(Schema.String),
  ...NotificationMeta.fields
}))
export const SubscriptionsAcknowledgedNotification = notification("notifications/subscriptions/acknowledged", Schema.Struct({ notifications: SubscriptionFilter, ...NotificationMeta.fields }))
export const CreateMessage = rpc("sampling/createMessage", Schema.Struct({
  messages: Schema.Array(SamplingMessage),
  modelPreferences: Schema.optional(ModelPreferences),
  systemPrompt: Schema.optional(Schema.String),
  includeContext: Schema.optional(Schema.Literal("none", "thisServer", "allServers")),
  temperature: Schema.optional(Schema.Number),
  maxTokens: Schema.NonNegativeInt,
  stopSequences: Schema.optional(Schema.Array(Schema.String)),
  metadata: Schema.optional(Meta),
  tools: Schema.optional(Schema.Array(Tool)),
  toolChoice: Schema.optional(Schema.Struct({ mode: Schema.optional(Schema.Literal("auto", "required", "none")) }))
}), CreateMessageResult)
export const ListRoots = rpc("roots/list", EmptyRequestPayload, ListRootsResult)
export const RootsListChangedNotification = notification("notifications/roots/list_changed", Schema.UndefinedOr(NotificationMeta))
export const Elicit = rpc("elicitation/create", Schema.Union(
  Schema.Struct({
    mode: Schema.optional(Schema.Literal("form")),
    message: Schema.String,
    requestedSchema: Schema.Struct({
      $schema: Schema.optional(Schema.String),
      type: Schema.Literal("object"),
      properties: Schema.Record({ key: Schema.String, value: Meta }),
      required: Schema.optional(Schema.Array(Schema.String))
    })
  }),
  Schema.Struct({ mode: Schema.Literal("url"), message: Schema.String, url: Schema.String })
), ElicitResult)
export const Ping = rpc("ping", EmptyRequestPayload, Schema.Struct({ ...ResultMeta.fields, ...CompleteFields }))
export const Initialize = rpc("initialize", Schema.Struct({
  protocolVersion: Schema.String,
  capabilities: ClientCapabilities,
  clientInfo: Implementation,
  ...RequestMeta.fields
}), Schema.Struct({
  resultType: Schema.Literal("complete"),
  protocolVersion: Schema.String,
  capabilities: ServerCapabilities,
  serverInfo: Implementation,
  instructions: Schema.optional(Schema.String)
}))
export const InitializedNotification = notification("notifications/initialized", Schema.UndefinedOr(NotificationMeta))
export const Subscribe = rpc("resources/subscribe", Schema.Struct({ uri: Schema.String, ...RequestMeta.fields }), Schema.Struct({ ...ResultMeta.fields, ...CompleteFields }))
export const Unsubscribe = rpc("resources/unsubscribe", Schema.Struct({ uri: Schema.String, ...RequestMeta.fields }), Schema.Struct({ ...ResultMeta.fields, ...CompleteFields }))
export const SetLevel = rpc("logging/setLevel", Schema.Struct({ level: LoggingLevel, ...RequestMeta.fields }), Schema.Struct({ ...ResultMeta.fields, ...CompleteFields }))
export const GetTask = rpc("tasks/get", Schema.Unknown, GetTaskResult)
export type GetTaskRequest = typeof GetTask.payloadSchema.Type
export const GetTaskPayload = rpc("tasks/result", Schema.Unknown, GetTaskPayloadResult)
export type GetTaskPayloadRequest = typeof GetTaskPayload.payloadSchema.Type
export const CancelTask = rpc("tasks/cancel", Schema.Unknown, CancelTaskResult)
export type CancelTaskRequest = typeof CancelTask.payloadSchema.Type
export const ListTasks = rpc("tasks/list", Schema.Unknown, ListTasksResult)
export type ListTasksRequest = typeof ListTasks.payloadSchema.Type
export const TaskStatusNotification = notification("notifications/tasks/status", Schema.Unknown)
export const ElicitationCompleteNotification = notification("notifications/elicitation/complete", Schema.Unknown)

const descriptorsByMethod = new Map<string, RpcDescriptor<Schema.Schema.Any, Schema.Schema.Any>>(([
  Discover, ListTools, CallTool, ListResources, ListResourceTemplates, ReadResource,
  ListPrompts, GetPrompt, Complete, SubscriptionsListen, CancelledNotification,
  ToolListChangedNotification, ResourceListChangedNotification, ResourceUpdatedNotification,
  PromptListChangedNotification, LoggingMessageNotification, ProgressNotification,
  SubscriptionsAcknowledgedNotification
].map((descriptor) => [descriptor.tag, descriptor])) as Array<[
  string,
  RpcDescriptor<Schema.Schema.Any, Schema.Schema.Any>
]>)
const group = (descriptors: ReadonlyArray<{ readonly method: string }>) => ({
  requests: new Map(descriptors.map(({ method }) => [method, descriptorsByMethod.get(method) ?? rpc(method, UnsupportedSchema, UnsupportedSchema)]))
})
export const ClientRequestRpcs = group(CLIENT_REQUEST_DESCRIPTORS)
export const ClientNotificationRpcs = group(CLIENT_NOTIFICATION_DESCRIPTORS)
export const ServerNotificationRpcs = group(SERVER_NOTIFICATION_DESCRIPTORS)
export const ServerRequestRpcs = undefined
export const ClientRpcs = { requests: new Map([...ClientRequestRpcs.requests, ...ClientNotificationRpcs.requests]) }

export interface McpServerClientService {
  readonly clientId: string | number
  readonly initializePayload: ClientContext | {
    readonly protocolVersion?: string
    readonly capabilities?: Record<string, unknown>
    readonly clientInfo?: { readonly name: string; readonly version: string }
  }
}
export class McpServerClient extends Context.Tag("mcp/McpServerClient")<McpServerClient, McpServerClientService>() {}

export interface Param<Name extends string, S extends Schema.Schema.Any> {
  readonly _tag: "McpParam"
  readonly name: Name
  readonly schema: S
}
export const param = <Name extends string, S extends Schema.Schema.Any>(name: Name, schema: S): Param<Name, S> => ({
  _tag: "McpParam", name, schema
})

export class EnabledWhen extends Context.Tag("mcp/EnabledWhen")<EnabledWhen, (client: ClientContext) => boolean>() {}

export type HandlerEffect<A, E = McpError, R = never> = Effect.Effect<A, E, R>
