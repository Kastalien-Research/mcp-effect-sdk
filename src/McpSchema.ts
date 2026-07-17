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
import * as Generated from "./generated/mcp/2026-07-28/McpSchema.generated.js"
import {
  CLIENT_NOTIFICATION_DESCRIPTORS,
  CLIENT_REQUEST_DESCRIPTORS,
  SERVER_NOTIFICATION_DESCRIPTORS
} from "./generated/mcp/McpProtocol.generated.js"

export const MCP_SCHEMA_VERSION = Generated.MCP_SCHEMA_VERSION
export const MCP_SCHEMA_DEFINITION_NAMES = Generated.MCP_SCHEMA_DEFINITION_NAMES
export type McpSchemaDefinitionName = Generated.McpSchemaDefinitionName
export const MCP_SCHEMA_CODECS = Generated.MCP_SCHEMA_CODECS

export const optional = Schema.optional
export const optionalWithDefault = <S extends Schema.Schema.Any>(
  schema: S,
  defaultValue: () => Schema.Schema.Type<S>
) => Schema.optionalWith(schema, { default: defaultValue })

const Meta = Generated.MetaObject

export const RequestId = Generated.RequestId
export type RequestId = typeof RequestId.Type
export const ProgressToken = Generated.ProgressToken
export type ProgressToken = typeof ProgressToken.Type
export const Cursor = Generated.Cursor
export type Cursor = typeof Cursor.Type
export const Role = Generated.Role
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
export const Annotations = Generated.Annotations
export type Annotations = Generated.Annotations
export const Implementation = Generated.Implementation
export type Implementation = Generated.Implementation

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

export const DiscoverResult = Generated.DiscoverResult
export type DiscoverResult = Generated.DiscoverResult
export const Resource = Generated.Resource
export type Resource = Generated.Resource
export const ResourceTemplate = Generated.ResourceTemplate
export type ResourceTemplate = Generated.ResourceTemplate
export const ResourceContents = Generated.ResourceContents
export type ResourceContents = Generated.ResourceContents
export const TextResourceContents = Generated.TextResourceContents
export type TextResourceContents = Generated.TextResourceContents
export const BlobResourceContents = Generated.BlobResourceContents
export type BlobResourceContents = Generated.BlobResourceContents
export const PromptArgument = Generated.PromptArgument
export type PromptArgument = Generated.PromptArgument
export const Prompt = Generated.Prompt
export type Prompt = Generated.Prompt
export const TextContent = Generated.TextContent
export type TextContent = Generated.TextContent
export const ImageContent = Generated.ImageContent
export type ImageContent = Generated.ImageContent
export const AudioContent = Generated.AudioContent
export type AudioContent = Generated.AudioContent
export const EmbeddedResource = Generated.EmbeddedResource
export type EmbeddedResource = Generated.EmbeddedResource
export const ResourceLink = Generated.ResourceLink
export type ResourceLink = Generated.ResourceLink
export const ContentBlock = Generated.ContentBlock
export type ContentBlock = typeof ContentBlock.Type
export const PromptMessage = Generated.PromptMessage
export type PromptMessage = Generated.PromptMessage
export const ToolAnnotations = Generated.ToolAnnotations
export type ToolAnnotations = Generated.ToolAnnotations
export const Tool = Generated.Tool
export type Tool = Generated.Tool
export const ListToolsResult = Generated.ListToolsResult
export type ListToolsResult = Generated.ListToolsResult
export const CallToolResult = Generated.CallToolResult
export type CallToolResult = Generated.CallToolResult
export const ListResourcesResult = Generated.ListResourcesResult
export type ListResourcesResult = Generated.ListResourcesResult
export const ListResourceTemplatesResult = Generated.ListResourceTemplatesResult
export type ListResourceTemplatesResult = Generated.ListResourceTemplatesResult
export const ReadResourceResult = Generated.ReadResourceResult
export type ReadResourceResult = Generated.ReadResourceResult
export const ListPromptsResult = Generated.ListPromptsResult
export type ListPromptsResult = Generated.ListPromptsResult
export const GetPromptResult = Generated.GetPromptResult
export type GetPromptResult = Generated.GetPromptResult
export const LoggingLevel = Generated.LoggingLevel
export type LoggingLevel = typeof LoggingLevel.Type
export const SamplingMessage = Generated.SamplingMessage
export type SamplingMessage = Generated.SamplingMessage
export const ModelHint = Generated.ModelHint
export type ModelHint = Generated.ModelHint
export const ModelPreferences = Generated.ModelPreferences
export type ModelPreferences = Generated.ModelPreferences
export const CreateMessageResult = Generated.CreateMessageResult
export type CreateMessageResult = Generated.CreateMessageResult
export const ResourceReference = Generated.ResourceTemplateReference
export type ResourceReference = Generated.ResourceTemplateReference
export const PromptReference = Generated.PromptReference
export type PromptReference = Generated.PromptReference
export const CompleteResult = Generated.CompleteResult
export type CompleteResult = Generated.CompleteResult
export const Root = Generated.Root
export type Root = Generated.Root
export const ListRootsResult = Generated.ListRootsResult
export type ListRootsResult = Generated.ListRootsResult
export const ElicitResult = Generated.ElicitResult
export type ElicitResult = Generated.ElicitResult
export const ResultType = Generated.ResultType
export type ResultType = typeof ResultType.Type
export const InputRequest = Generated.InputRequest
export type InputRequest = typeof InputRequest.Type
export const InputRequests = Generated.InputRequests
export type InputRequests = typeof InputRequests.Type
export const InputResponses = Generated.InputResponses
export type InputResponses = typeof InputResponses.Type
export const InputRequiredResult = Generated.InputRequiredResult
export type InputRequiredResult = Generated.InputRequiredResult
export const InputResponseRequestParams = Generated.InputResponseRequestParams
export type InputResponseRequestParams = Generated.InputResponseRequestParams

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

export const SubscriptionFilter = Generated.SubscriptionFilter
export type SubscriptionFilter = typeof SubscriptionFilter.Type
export const SubscriptionsListenResult = Generated.SubscriptionsListenResult
export type SubscriptionsListenResult = Generated.SubscriptionsListenResult

export const Discover = rpc("server/discover", Generated.RequestParams, DiscoverResult)
export const ListTools = rpc("tools/list", Generated.PaginatedRequestParams, ListToolsResult)
export const CallTool = rpc("tools/call", Generated.CallToolRequestParams, CallToolResult)
export const ListResources = rpc("resources/list", Generated.PaginatedRequestParams, ListResourcesResult)
export const ListResourceTemplates = rpc("resources/templates/list", Generated.PaginatedRequestParams, ListResourceTemplatesResult)
export const ReadResource = rpc("resources/read", Generated.ReadResourceRequestParams, ReadResourceResult)
export const ListPrompts = rpc("prompts/list", Generated.PaginatedRequestParams, ListPromptsResult)
export const GetPrompt = rpc("prompts/get", Generated.GetPromptRequestParams, GetPromptResult)
export const Complete = rpc("completion/complete", Generated.CompleteRequestParams, CompleteResult)
export const SubscriptionsListen = rpc("subscriptions/listen", Generated.SubscriptionsListenRequestParams, SubscriptionsListenResult)
export const CancelledNotification = notification("notifications/cancelled", Generated.CancelledNotificationParams)
export const ToolListChangedNotification = notification("notifications/tools/list_changed", Schema.UndefinedOr(Generated.NotificationParams))
export const ResourceListChangedNotification = notification("notifications/resources/list_changed", Schema.UndefinedOr(Generated.NotificationParams))
export const ResourceUpdatedNotification = notification("notifications/resources/updated", Generated.ResourceUpdatedNotificationParams)
export const PromptListChangedNotification = notification("notifications/prompts/list_changed", Schema.UndefinedOr(Generated.NotificationParams))
export const LoggingMessageNotification = notification("notifications/message", Generated.LoggingMessageNotificationParams)
export const ProgressNotification = notification("notifications/progress", Generated.ProgressNotificationParams)
export const SubscriptionsAcknowledgedNotification = notification("notifications/subscriptions/acknowledged", Generated.SubscriptionsAcknowledgedNotificationParams)
export const CreateMessage = rpc("sampling/createMessage", Generated.CreateMessageRequestParams, CreateMessageResult)
export const ListRoots = rpc("roots/list", Schema.UndefinedOr(Generated.ListRootsRequestParams), ListRootsResult)
export const Elicit = rpc("elicitation/create", Generated.ElicitRequestParams, ElicitResult)
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
