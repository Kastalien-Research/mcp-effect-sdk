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
import {
  INTERNAL_ERROR_CODE,
  INVALID_PARAMS_ERROR_CODE,
  INVALID_REQUEST_ERROR_CODE,
  InternalError,
  InvalidParams,
  InvalidRequest,
  McpError as McpErrorSchema,
  type McpError as McpErrorType,
  McpErrorBase,
  METHOD_NOT_FOUND_ERROR_CODE,
  MethodNotFound,
  PARSE_ERROR_CODE,
  ParseError
} from "./McpErrors.js"
import * as Generated from "./generated/mcp/2026-07-28/McpSchema.generated.js"
import {
  CLIENT_NOTIFICATION_DESCRIPTORS,
  CLIENT_NOTIFICATION_DESCRIPTOR_BY_TYPE,
  CLIENT_NOTIFICATION_PAYLOAD_CODEC_BY_METHOD,
  CLIENT_NOTIFICATION_PAYLOAD_CODEC_BY_TYPE,
  CLIENT_REQUEST_DESCRIPTORS,
  CLIENT_REQUEST_DESCRIPTOR_BY_TYPE,
  CLIENT_REQUEST_PAYLOAD_CODEC_BY_METHOD,
  CLIENT_REQUEST_PAYLOAD_CODEC_BY_TYPE,
  CLIENT_REQUEST_RESULT_CODEC_BY_METHOD,
  CLIENT_REQUEST_RESULT_CODEC_BY_TYPE,
  SERVER_NOTIFICATION_DESCRIPTORS,
  SERVER_NOTIFICATION_DESCRIPTOR_BY_TYPE,
  SERVER_NOTIFICATION_PAYLOAD_CODEC_BY_METHOD,
  SERVER_NOTIFICATION_PAYLOAD_CODEC_BY_TYPE
} from "./generated/mcp/2026-07-28/McpProtocol.generated.js"

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

export {
  INTERNAL_ERROR_CODE,
  INVALID_PARAMS_ERROR_CODE,
  INVALID_REQUEST_ERROR_CODE,
  InternalError,
  InvalidParams,
  InvalidRequest,
  McpErrorBase,
  METHOD_NOT_FOUND_ERROR_CODE,
  MethodNotFound,
  PARSE_ERROR_CODE,
  ParseError
}
export const McpError = McpErrorSchema
export type McpError = McpErrorType

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
  readonly errorSchema: typeof McpErrorSchema
}
const rpc = <P extends Schema.Schema.Any, S extends Schema.Schema.Any>(tag: string, payloadSchema: P, successSchema: S): RpcDescriptor<P, S> => ({
  tag, payloadSchema, successSchema, errorSchema: McpErrorSchema
})
const notification = <P extends Schema.Schema.Any>(tag: string, payloadSchema: P) => rpc(tag, payloadSchema, Schema.Void)

export const SubscriptionFilter = Generated.SubscriptionFilter
export type SubscriptionFilter = typeof SubscriptionFilter.Type
export const SubscriptionsListenResult = Generated.SubscriptionsListenResult
export type SubscriptionsListenResult = Generated.SubscriptionsListenResult

const requestGroup = (
  descriptors: ReadonlyArray<{ readonly method: string }>,
  payloadByMethod: Readonly<Record<string, Schema.Schema.Any>>,
  resultByMethod: Readonly<Record<string, Schema.Schema.Any>>
) => ({
  requests: new Map(descriptors.map(({ method }) => [
    method,
    rpc(method, payloadByMethod[method], resultByMethod[method])
  ]))
})
const notificationGroup = (
  descriptors: ReadonlyArray<{ readonly method: string }>,
  payloadByMethod: Readonly<Record<string, Schema.Schema.Any>>
) => ({
  requests: new Map(descriptors.map(({ method }) => [
    method,
    notification(method, payloadByMethod[method])
  ]))
})

export const ClientRequestRpcs = requestGroup(
  CLIENT_REQUEST_DESCRIPTORS,
  CLIENT_REQUEST_PAYLOAD_CODEC_BY_METHOD,
  CLIENT_REQUEST_RESULT_CODEC_BY_METHOD
)
export const ClientNotificationRpcs = notificationGroup(
  CLIENT_NOTIFICATION_DESCRIPTORS,
  CLIENT_NOTIFICATION_PAYLOAD_CODEC_BY_METHOD
)
export const ServerNotificationRpcs = notificationGroup(
  SERVER_NOTIFICATION_DESCRIPTORS,
  SERVER_NOTIFICATION_PAYLOAD_CODEC_BY_METHOD
)
export const ServerRequestRpcs = undefined
export const ClientRpcs = {
  requests: new Map([...ClientRequestRpcs.requests, ...ClientNotificationRpcs.requests])
}

const generatedRequest = <Type extends keyof typeof CLIENT_REQUEST_DESCRIPTOR_BY_TYPE>(type: Type) => {
  const descriptor = CLIENT_REQUEST_DESCRIPTOR_BY_TYPE[type]
  return rpc(
    descriptor.method,
    CLIENT_REQUEST_PAYLOAD_CODEC_BY_TYPE[type],
    CLIENT_REQUEST_RESULT_CODEC_BY_TYPE[type]
  )
}
const generatedClientNotification = <Type extends keyof typeof CLIENT_NOTIFICATION_DESCRIPTOR_BY_TYPE>(type: Type) => {
  const descriptor = CLIENT_NOTIFICATION_DESCRIPTOR_BY_TYPE[type]
  return notification(descriptor.method, CLIENT_NOTIFICATION_PAYLOAD_CODEC_BY_TYPE[type])
}
const generatedServerNotification = <Type extends keyof typeof SERVER_NOTIFICATION_DESCRIPTOR_BY_TYPE>(type: Type) => {
  const descriptor = SERVER_NOTIFICATION_DESCRIPTOR_BY_TYPE[type]
  return notification(descriptor.method, SERVER_NOTIFICATION_PAYLOAD_CODEC_BY_TYPE[type])
}

export const Discover = generatedRequest("DiscoverRequest")
export const ListTools = generatedRequest("ListToolsRequest")
export const CallTool = generatedRequest("CallToolRequest")
export const ListResources = generatedRequest("ListResourcesRequest")
export const ListResourceTemplates = generatedRequest("ListResourceTemplatesRequest")
export const ReadResource = generatedRequest("ReadResourceRequest")
export const ListPrompts = generatedRequest("ListPromptsRequest")
export const GetPrompt = generatedRequest("GetPromptRequest")
export const Complete = generatedRequest("CompleteRequest")
export const SubscriptionsListen = generatedRequest("SubscriptionsListenRequest")
export const CancelledNotification = generatedClientNotification("CancelledNotification")
export const ToolListChangedNotification = generatedServerNotification("ToolListChangedNotification")
export const ResourceListChangedNotification = generatedServerNotification("ResourceListChangedNotification")
export const ResourceUpdatedNotification = generatedServerNotification("ResourceUpdatedNotification")
export const PromptListChangedNotification = generatedServerNotification("PromptListChangedNotification")
export const LoggingMessageNotification = generatedServerNotification("LoggingMessageNotification")
export const ProgressNotification = generatedServerNotification("ProgressNotification")
export const SubscriptionsAcknowledgedNotification = generatedServerNotification("SubscriptionsAcknowledgedNotification")
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
