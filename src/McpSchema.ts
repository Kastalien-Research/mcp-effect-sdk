/**
 * @since 4.0.0
 */
import type * as Effect from "effect/Effect"
import * as Option from "effect/Option"
import * as Predicate from "effect/Predicate"
import * as Schema from "effect/Schema"
import * as Getter from "effect/SchemaGetter"
import type * as Scope from "effect/Scope"
import * as ServiceMap from "effect/ServiceMap"
import * as Rpc from "effect/unstable/rpc/Rpc"
import type * as RpcClient from "effect/unstable/rpc/RpcClient"
import type { RpcClientError } from "effect/unstable/rpc/RpcClientError"
import * as RpcGroup from "effect/unstable/rpc/RpcGroup"
import * as RpcMiddleware from "effect/unstable/rpc/RpcMiddleware"
import * as Generated from "./generated/mcp/McpSchema.generated.js"

// =============================================================================
// Generated Stable Schema Facade
// =============================================================================

/**
 * Stable MCP schema artifact version used by the generated schema facade.
 *
 * @since 4.0.0
 * @category generated
 */
export const MCP_SCHEMA_VERSION = Generated.MCP_SCHEMA_VERSION

/**
 * Names of every stable MCP JSON Schema `$defs` entry.
 *
 * @since 4.0.0
 * @category generated
 */
export const MCP_SCHEMA_DEFINITION_NAMES = Generated.MCP_SCHEMA_DEFINITION_NAMES

/**
 * Stable MCP JSON Schema `$defs` entry name.
 *
 * @since 4.0.0
 * @category generated
 */
export type McpSchemaDefinitionName = Generated.McpSchemaDefinitionName

/**
 * Runtime-neutral raw JSON Schema registry for stable MCP `$defs`.
 *
 * This is the documented raw JSON boundary for generator and conformance
 * tooling. Ergonomic Effect schemas are exported separately below.
 *
 * @since 4.0.0
 * @category generated
 */
export const MCP_SCHEMA_DEFINITIONS = Generated.MCP_SCHEMA_DEFINITIONS

/**
 * Runtime-neutral raw JSON Schema value from the stable MCP schema artifact.
 *
 * @since 4.0.0
 * @category generated
 */
export type McpRawJsonSchema = Generated.McpRawJsonSchema

/**
 * @since 4.0.0
 */
export interface optionalWithDefault<S extends Schema.Top & Schema.WithoutConstructorDefault>
  extends Schema.withConstructorDefault<Schema.decodeTo<Schema.toType<Schema.optionalKey<S>>, Schema.optionalKey<S>>>
{}

/**
 * @since 4.0.0
 */
export const optionalWithDefault = <S extends Schema.Top & Schema.WithoutConstructorDefault>(
  schema: S,
  defaultValue: () => Schema.optionalKey<S>["Type"]
): optionalWithDefault<S> =>
  Schema.optionalKey(schema).pipe(
    Schema.decode<Schema.optionalKey<S>>({
      decode: Getter.withDefault(defaultValue),
      encode: Getter.passthrough()
    }),
    Schema.withConstructorDefault<
      Schema.decodeTo<Schema.toType<Schema.optionalKey<S>>, Schema.optionalKey<S>>
    >(() => Option.some(defaultValue()))
  )

/**
 * @since 4.0.0
 */
export const optional = <S extends Schema.Top>(schema: S): Schema.decodeTo<Schema.optional<S>, Schema.optionalKey<S>> =>
  Schema.optionalKey(schema).pipe(
    Schema.decodeTo(Schema.optional(schema), {
      decode: Getter.passthrough() as never,
      encode: Getter.transformOptional(Option.flatMap(Option.fromUndefinedOr))
    })
  )

// =============================================================================
// Common
// =============================================================================

export const RequestId = Generated.RequestId
export type RequestId = typeof RequestId.Type
export const ProgressToken = Generated.ProgressToken
export type ProgressToken = typeof ProgressToken.Type
export const RequestMeta = Generated.RequestMeta
export type RequestMeta = typeof RequestMeta.Type
export const ResultMeta = Generated.ResultMeta
export type ResultMeta = typeof ResultMeta.Type
export const NotificationMeta = Generated.NotificationMeta
export type NotificationMeta = typeof NotificationMeta.Type
export const Cursor = Generated.Cursor
export type Cursor = typeof Cursor.Type
export const PaginatedRequestMeta = Generated.PaginatedRequestMeta
export type PaginatedRequestMeta = typeof PaginatedRequestMeta.Type
export const PaginatedResultMeta = Generated.PaginatedResultMeta
export type PaginatedResultMeta = typeof PaginatedResultMeta.Type
export const Role = Generated.Role
export type Role = typeof Role.Type
export const Annotations = Generated.Annotations
export type Annotations = typeof Annotations.Type
export const Implementation = Generated.Implementation
export type Implementation = typeof Implementation.Type
export const ClientCapabilities = Generated.ClientCapabilities
export type ClientCapabilities = typeof ClientCapabilities.Type
export const ServerCapabilities = Generated.ServerCapabilities
export type ServerCapabilities = typeof ServerCapabilities.Type

// =============================================================================
// Errors
// =============================================================================

/**
 * @since 4.0.0
 * @category errors
 */
export class McpErrorBase extends Schema.Class<McpErrorBase>(
  "@effect/ai/McpSchema/McpErrorBase"
)({
  /**
   * The error type that occurred.
   */
  code: Schema.Number,
  /**
   * A short description of the error. The message SHOULD be limited to a
   * concise single sentence.
   */
  message: Schema.String,
  /**
   * Additional information about the error. The value of this member is
   * defined by the sender (e.g. detailed error information, nested errors etc.).
   */
  data: optional(Schema.Unknown)
}) {}

/**
 * @since 4.0.0
 * @category errors
 */
export const INVALID_REQUEST_ERROR_CODE = -32600 as const
/**
 * @since 4.0.0
 * @category errors
 */
export const METHOD_NOT_FOUND_ERROR_CODE = -32601 as const
/**
 * @since 4.0.0
 * @category errors
 */
export const INVALID_PARAMS_ERROR_CODE = -32602 as const
/**
 * @since 4.0.0
 * @category errors
 */
export const INTERNAL_ERROR_CODE = -32603 as const
/**
 * @since 4.0.0
 * @category errors
 */
export const PARSE_ERROR_CODE = -32700 as const

/**
 * @since 4.0.0
 * @category errors
 */
export class ParseError extends Schema.ErrorClass<ParseError>("effect/ai/McpSchema/ParseError")({
  ...McpErrorBase.fields,
  _tag: Schema.tag("ParseError"),
  code: Schema.tag(PARSE_ERROR_CODE)
}) {}

/**
 * @since 4.0.0
 * @category errors
 */
export class InvalidRequest extends Schema.ErrorClass<InvalidRequest>("effect/ai/McpSchema/InvalidRequest")({
  ...McpErrorBase.fields,
  _tag: Schema.tag("InvalidRequest"),
  code: Schema.tag(INVALID_REQUEST_ERROR_CODE)
}) {}

/**
 * @since 4.0.0
 * @category errors
 */
export class MethodNotFound extends Schema.ErrorClass<MethodNotFound>("effect/ai/McpSchema/MethodNotFound")({
  ...McpErrorBase.fields,
  _tag: Schema.tag("MethodNotFound"),
  code: Schema.tag(METHOD_NOT_FOUND_ERROR_CODE)
}) {}

/**
 * @since 4.0.0
 * @category errors
 */
export class InvalidParams extends Schema.ErrorClass<InvalidParams>("effect/ai/McpSchema/InvalidParams")({
  ...McpErrorBase.fields,
  _tag: Schema.tag("InvalidParams"),
  code: Schema.tag(INVALID_PARAMS_ERROR_CODE)
}) {}

/**
 * @since 4.0.0
 * @category errors
 */
export class InternalError extends Schema.ErrorClass<InternalError>("effect/ai/McpSchema/InternalError")({
  ...McpErrorBase.fields,
  _tag: Schema.tag("InternalError"),
  code: Schema.tag(INTERNAL_ERROR_CODE)
}) {
  static readonly notImplemented = new InternalError({ message: "Not implemented" })
}

/**
 * @since 4.0.0
 * @category errors
 */
export const McpError = Schema.Union([
  ParseError,
  InvalidRequest,
  MethodNotFound,
  InvalidParams,
  InternalError,
  McpErrorBase
])

// =============================================================================
// Ping
// =============================================================================

/**
 * A ping, issued by either the server or the client, to check that the other
 * party is still alive. The receiver must promptly respond, or else may be
 * disconnected.
 *
 * @since 4.0.0
 * @category ping
 */
export class Ping extends Rpc.make("ping", {
  success: Schema.Struct({}),
  error: McpError,
  payload: Schema.UndefinedOr(RequestMeta)
}) {}

// =============================================================================
// Initialization
// =============================================================================

/**
 * After receiving an initialize request from the client, the server sends this
 * response.
 *
 * @since 4.0.0
 * @category initialization
 */
export class InitializeResult extends Schema.Opaque<InitializeResult>()(Schema.Struct({
  ...ResultMeta.fields,
  /**
   * The version of the Model Context Protocol that the server wants to use.
   * This may not match the version that the client requested. If the client
   * cannot support this version, it MUST disconnect.
   */
  protocolVersion: Schema.String,
  capabilities: ServerCapabilities,
  serverInfo: Implementation,
  /**
   * Instructions describing how to use the server and its features.
   *
   * This can be used by clients to improve the LLM's understanding of available
   * tools, resources, etc. It can be thought of like a "hint" to the model.
   * For example, this information MAY be added to the system prompt.
   */
  instructions: optional(Schema.String)
})) {}

/**
 * This request is sent from the client to the server when it first connects,
 * asking it to begin initialization.
 *
 * @since 4.0.0
 * @category initialization
 */
export class Initialize extends Rpc.make("initialize", {
  success: InitializeResult,
  error: McpError,
  payload: {
    ...RequestMeta.fields,
    /**
     * The latest version of the Model Context Protocol that the client
     * supports. The client MAY decide to support older versions as well.
     */
    protocolVersion: Schema.String,
    /**
     * Capabilities a client may support. Known capabilities are defined here,
     * in this schema, but this is not a closed set: any client can define its
     * own, additional capabilities.
     */
    capabilities: ClientCapabilities,
    /**
     * Describes the name and version of an MCP implementation.
     */
    clientInfo: Implementation
  }
}) {}

/**
 * This notification is sent from the client to the server after initialization
 * has finished.
 *
 * @since 4.0.0
 * @category initialization
 */
export class InitializedNotification extends Rpc.make("notifications/initialized", {
  payload: Schema.UndefinedOr(NotificationMeta)
}) {}

// =============================================================================
// Cancellation
// =============================================================================

/**
 * @since 4.0.0
 * @category cancellation
 */
export class CancelledNotification extends Rpc.make("notifications/cancelled", {
  payload: {
    ...NotificationMeta.fields,
    /**
     * The ID of the request to cancel.
     *
     * This MUST correspond to the ID of a request previously issued in the
     * same direction.
     */
    requestId: RequestId,
    /**
     * An optional string describing the reason for the cancellation. This MAY
     * be logged or presented to the user.
     */
    reason: optional(Schema.String)
  }
}) {}

// =============================================================================
// Progress
// =============================================================================

/**
 * An out-of-band notification used to inform the receiver of a progress update
 * for a long-running request.
 *
 * @since 4.0.0
 * @category progress
 */
export class ProgressNotification extends Rpc.make("notifications/progress", {
  payload: {
    ...NotificationMeta.fields,
    /**
     * The progress token which was given in the initial request, used to
     * associate this notification with the request that is proceeding.
     */
    progressToken: ProgressToken,
    /**
     * The progress thus far. This should increase every time progress is made,
     * even if the total is unknown.
     */
    progress: optional(Schema.Number),
    /**
     * Total number of items to process (or total progress required), if known.
     */
    total: optional(Schema.Number),
    /**
     * An optional message describing the current progress.
     */
    message: optional(Schema.String)
  }
}) {}

// =============================================================================
// Resources
// =============================================================================

/**
 * A known resource that the server is capable of reading.
 *
 * @since 4.0.0
 * @category resources
 */
export const Resource = Generated.Resource
export type Resource = typeof Resource.Type

/**
 * A template description for resources available on the server.
 *
 * @since 4.0.0
 * @category resources
 */
export const ResourceTemplate = Generated.ResourceTemplate
export type ResourceTemplate = typeof ResourceTemplate.Type

/**
 * The contents of a specific resource or sub-resource.
 *
 * @since 4.0.0
 * @category resources
 */
export const ResourceContents = Generated.ResourceContents
export type ResourceContents = typeof ResourceContents.Type

/**
 * The contents of a text resource, which can be represented as a string.
 *
 * @since 4.0.0
 * @category resources
 */
export const TextResourceContents = Generated.TextResourceContents
export type TextResourceContents = typeof TextResourceContents.Type

/**
 * The contents of a binary resource, which can be represented as an Uint8Array
 *
 * @since 4.0.0
 * @category resources
 */
export const BlobResourceContents = Generated.BlobResourceContents
export type BlobResourceContents = typeof BlobResourceContents.Type

/**
 * The server's response to a resources/list request from the client.
 *
 * @since 4.0.0
 * @category resources
 */
export const ListResourcesResult = Generated.ListResourcesResult
export type ListResourcesResult = typeof ListResourcesResult.Type

/**
 * Sent from the client to request a list of resources the server has.
 *
 * @since 4.0.0
 * @category resources
 */
export class ListResources extends Rpc.make("resources/list", {
  success: ListResourcesResult,
  error: McpError,
  payload: Schema.UndefinedOr(PaginatedRequestMeta)
}) {}

/**
 * The server's response to a resources/templates/list request from the client.
 *
 * @since 4.0.0
 * @category resources
 */
export const ListResourceTemplatesResult = Generated.ListResourceTemplatesResult
export type ListResourceTemplatesResult = typeof ListResourceTemplatesResult.Type

/**
 * Sent from the client to request a list of resource templates the server has.
 *
 * @since 4.0.0
 * @category resources
 */
export class ListResourceTemplates extends Rpc.make("resources/templates/list", {
  success: ListResourceTemplatesResult,
  error: McpError,
  payload: Schema.UndefinedOr(PaginatedRequestMeta)
}) {}

/**
 * The server's response to a resources/read request from the client.
 *
 * @since 4.0.0
 * @category resources
 */
export const ReadResourceResult = Generated.ReadResourceResult
export type ReadResourceResult = typeof ReadResourceResult.Type

/**
 * Sent from the client to the server, to read a specific resource URI.
 *
 * @since 4.0.0
 * @category resources
 */
export class ReadResource extends Rpc.make("resources/read", {
  success: ReadResourceResult,
  error: McpError,
  payload: {
    ...RequestMeta.fields,
    /**
     * The URI of the resource to read. The URI can use any protocol; it is up
     * to the server how to interpret it.
     */
    uri: Schema.String
  }
}) {}

/**
 * An optional notification from the server to the client, informing it that the
 * list of resources it can read from has changed. This may be issued by servers
 * without any previous subscription from the client.
 *
 * @since 4.0.0
 * @category resources
 */
export class ResourceListChangedNotification extends Rpc.make("notifications/resources/list_changed", {
  payload: Schema.UndefinedOr(NotificationMeta)
}) {}

/**
 * Sent from the client to request resources/updated notifications from the
 * server whenever a particular resource changes.
 *
 * @since 4.0.0
 * @category resources
 */
export class Subscribe extends Rpc.make("resources/subscribe", {
  success: Schema.Struct({}),
  error: McpError,
  payload: {
    ...RequestMeta.fields,
    /**
     * The URI of the resource to subscribe to. The URI can use any protocol;
     * it is up to the server how to interpret it.
     */
    uri: Schema.String
  }
}) {}

/**
 * Sent from the client to request cancellation of resources/updated
 * notifications from the server. This should follow a previous
 * resources/subscribe request.
 *
 * @since 4.0.0
 * @category resources
 */
export class Unsubscribe extends Rpc.make("resources/unsubscribe", {
  success: Schema.Struct({}),
  error: McpError,
  payload: {
    ...RequestMeta.fields,
    /**
     * The URI of the resource to subscribe to. The URI can use any protocol;
     * it is up to the server how to interpret it.
     */
    uri: Schema.String
  }
}) {}

/**
 * @since 4.0.0
 * @category resources
 */
export class ResourceUpdatedNotification extends Rpc.make("notifications/resources/updated", {
  payload: {
    ...NotificationMeta.fields,
    /**
     * The URI of the resource that has been updated. This might be a sub-resource of the one that the client actually subscribed to.
     */
    uri: Schema.String
  }
}) {}

// =============================================================================
// Prompts
// =============================================================================

/**
 * Describes an argument that a prompt can accept.
 *
 * @since 4.0.0
 * @category prompts
 */
export const PromptArgument = Generated.PromptArgument
export type PromptArgument = typeof PromptArgument.Type

/**
 * A prompt or prompt template that the server offers.
 *
 * @since 4.0.0
 * @category prompts
 */
export const Prompt = Generated.Prompt
export type Prompt = typeof Prompt.Type

/**
 * Text provided to or from an LLM.
 *
 * @since 4.0.0
 * @category prompts
 */
export const TextContent = Generated.TextContent
export type TextContent = typeof TextContent.Type

/**
 * An image provided to or from an LLM.
 *
 * @since 4.0.0
 * @category prompts
 */
export const ImageContent = Generated.ImageContent
export type ImageContent = typeof ImageContent.Type

/**
 * Audio provided to or from an LLM.
 *
 * @since 4.0.0
 * @category prompts
 */
export const AudioContent = Generated.AudioContent
export type AudioContent = typeof AudioContent.Type

/**
 * The contents of a resource, embedded into a prompt or tool call result.
 *
 * It is up to the client how best to render embedded resources for the benefit
 * of the LLM and/or the user.
 *
 * @since 4.0.0
 * @category prompts
 */
export const EmbeddedResource = Generated.EmbeddedResource
export type EmbeddedResource = typeof EmbeddedResource.Type

/**
 * A resource that the server is capable of reading, included in a prompt or tool call result.
 *
 * Note: resource links returned by tools are not guaranteed to appear in the results of `resources/list` requests.
 *
 * @since 4.0.0
 * @category prompts
 */
export const ResourceLink = Generated.ResourceLink
export type ResourceLink = typeof ResourceLink.Type

/**
 * @since 4.0.0
 * @category prompts
 */
export const ContentBlock = Generated.ContentBlock
export type ContentBlock = typeof ContentBlock.Type

/**
 * Describes a message returned as part of a prompt.
 *
 * This is similar to `SamplingMessage`, but also supports the embedding of
 * resources from the MCP server.
 *
 * @since 4.0.0
 * @category prompts
 */
export const PromptMessage = Generated.PromptMessage
export type PromptMessage = typeof PromptMessage.Type

/**
 * The server's response to a prompts/list request from the client.
 *
 * @since 4.0.0
 * @category prompts
 */
export const ListPromptsResult = Generated.ListPromptsResult
export type ListPromptsResult = typeof ListPromptsResult.Type

/**
 * Sent from the client to request a list of prompts and prompt templates the
 * server has.
 *
 * @since 4.0.0
 * @category prompts
 */
export class ListPrompts extends Rpc.make("prompts/list", {
  success: ListPromptsResult,
  error: McpError,
  payload: Schema.UndefinedOr(PaginatedRequestMeta)
}) {}

/**
 * The server's response to a prompts/get request from the client.
 *
 * @since 4.0.0
 * @category prompts
 */
export const GetPromptResult = Generated.GetPromptResult
export type GetPromptResult = typeof GetPromptResult.Type

/**
 * Used by the client to get a prompt provided by the server.
 *
 * @since 4.0.0
 * @category prompts
 */
export class GetPrompt extends Rpc.make("prompts/get", {
  success: GetPromptResult,
  error: McpError,
  payload: {
    ...RequestMeta.fields,
    /**
     * The name of the prompt or prompt template.
     */
    name: Schema.String,
    title: optional(Schema.String),
    /**
     * Arguments to use for templating the prompt.
     */
    arguments: optional(Schema.Record(Schema.String, Schema.String))
  }
}) {}

/**
 * An optional notification from the server to the client, informing it that
 * the list of prompts it offers has changed. This may be issued by servers
 * without any previous subscription from the client.
 *
 * @since 4.0.0
 * @category prompts
 */
export class PromptListChangedNotification extends Rpc.make("notifications/prompts/list_changed", {
  payload: Schema.UndefinedOr(NotificationMeta)
}) {}

// =============================================================================
// Tools
// =============================================================================

/**
 * Additional properties describing a Tool to clients.
 *
 * NOTE: all properties in ToolAnnotations are **hints**. They are not
 * guaranteed to provide a faithful description of tool behavior (including
 * descriptive properties like `title`).
 *
 * Clients should never make tool use decisions based on ToolAnnotations
 * received from untrusted servers.
 *
 * @since 4.0.0
 * @category tools
 */
export const ToolAnnotations = Generated.ToolAnnotations
export type ToolAnnotations = typeof ToolAnnotations.Type

/**
 * Execution-related properties for a tool.
 *
 * @since 4.0.0
 * @category tools
 */
export const ToolExecution = Generated.ToolExecution
export type ToolExecution = typeof ToolExecution.Type

/**
 * Definition for a tool the client can call.
 *
 * @since 4.0.0
 * @category tools
 */
export const Tool = Generated.Tool
export type Tool = typeof Tool.Type

/**
 * The server's response to a tools/list request from the client.
 *
 * @since 4.0.0
 * @category tools
 */
export const ListToolsResult = Generated.ListToolsResult
export type ListToolsResult = typeof ListToolsResult.Type

/**
 * Sent from the client to request a list of tools the server has.
 *
 * @since 4.0.0
 * @category tools
 */
export class ListTools extends Rpc.make("tools/list", {
  success: ListToolsResult,
  error: McpError,
  payload: Schema.UndefinedOr(PaginatedRequestMeta)
}) {}

/**
 * The server's response to a tool call.
 *
 * Any errors that originate from the tool SHOULD be reported inside the result
 * object, with `isError` set to true, _not_ as an MCP protocol-level error
 * response. Otherwise, the LLM would not be able to see that an error occurred
 * and self-correct.
 *
 * However, any errors in _finding_ the tool, an error indicating that the
 * server does not support tool calls, or any other exceptional conditions,
 * should be reported as an MCP error response.
 *
 * @since 4.0.0
 * @category tools
 */
export const CallToolResult = Generated.CallToolResult
export type CallToolResult = typeof CallToolResult.Type

/**
 * Used by the client to invoke a tool provided by the server.
 *
 * @since 4.0.0
 * @category tools
 */
export class CallTool extends Rpc.make("tools/call", {
  success: Schema.Union([CallToolResult, Generated.CreateTaskResult]),
  error: McpError,
  payload: {
    ...RequestMeta.fields,
    name: Schema.String,
    arguments: optional(Schema.Record(
      Schema.String,
      Schema.Unknown
    )),
    task: optional(Generated.TaskMetadata)
  }
}) {}

/**
 * An optional notification from the server to the client, informing it that
 * the list of tools it offers has changed. This may be issued by servers
 * without any previous subscription from the client.
 *
 * @since 4.0.0
 * @category tools
 */
export class ToolListChangedNotification extends Rpc.make("notifications/tools/list_changed", {
  payload: Schema.UndefinedOr(NotificationMeta)
}) {}

// =============================================================================
// Logging
// =============================================================================

/**
 * The severity of a log message.
 *
 * These map to syslog message severities, as specified in RFC-5424:
 * https://datatracker.ietf.org/doc/html/rfc5424#section-6.2.1
 *
 * @since 4.0.0
 * @category logging
 */
export const LoggingLevel = Generated.LoggingLevel
export type LoggingLevel = typeof LoggingLevel.Type

/**
 * A request from the client to the server, to enable or adjust logging.
 *
 * @since 4.0.0
 * @category logging
 */
export class SetLevel extends Rpc.make("logging/setLevel", {
  success: Schema.Struct({}),
  payload: {
    ...RequestMeta.fields,
    /**
     * The level of logging that the client wants to receive from the server.
     * The server should send all logs at this level and higher (i.e., more
     * severe) to the client as notifications/message.
     */
    level: LoggingLevel
  },
  error: McpError
}) {}

/**
 * @since 4.0.0
 * @category logging
 */
export class LoggingMessageNotification extends Rpc.make("notifications/message", {
  payload: Schema.Struct({
    ...NotificationMeta.fields,
    /**
     * The severity of this log message.
     */
    level: LoggingLevel,
    /**
     * An optional name of the logger issuing this message.
     */
    logger: optional(Schema.String),
    /**
     * The data to be logged, such as a string message or an object. Any JSON
     * serializable type is allowed here.
     */
    data: Schema.Unknown
  })
}) {}

// =============================================================================
// Sampling
// =============================================================================

/**
 * Describes a message issued to or received from an LLM API.
 *
 * @since 4.0.0
 * @category sampling
 */
export const SamplingMessage = Generated.SamplingMessage
export type SamplingMessage = typeof SamplingMessage.Type

/**
 * Hints to use for model selection.
 *
 * Keys not declared here are currently left unspecified by the spec and are up
 * to the client to interpret.
 *
 * @since 4.0.0
 * @category sampling
 */
export const ModelHint = Generated.ModelHint
export type ModelHint = typeof ModelHint.Type

/**
 * The server's preferences for model selection, requested of the client during sampling.
 *
 * Because LLMs can vary along multiple dimensions, choosing the "best" model is
 * rarely straightforward.  Different models excel in different areas—some are
 * faster but less capable, others are more capable but more expensive, and so
 * on. This interface allows servers to express their priorities across multiple
 * dimensions to help clients make an appropriate selection for their use case.
 *
 * These preferences are always advisory. The client MAY ignore them. It is also
 * up to the client to decide how to interpret these preferences and how to
 * balance them against other considerations.
 *
 * @since 4.0.0
 * @category sampling
 */
export const ModelPreferences = Generated.ModelPreferences
export type ModelPreferences = typeof ModelPreferences.Type

/**
 * The client's response to a sampling/create_message request from the server.
 * The client should inform the user before returning the sampled message, to
 * allow them to inspect the response (human in the loop) and decide whether to
 * allow the server to see it.
 *
 * @since 4.0.0
 * @category sampling
 */
export const CreateMessageResult = Generated.CreateMessageResult
export type CreateMessageResult = typeof CreateMessageResult.Type

/**
 * A request from the server to sample an LLM via the client. The client has
 * full discretion over which model to select. The client should also inform the
 * user before beginning sampling, to allow them to inspect the request (human
 * in the loop) and decide whether to approve it.
 *
 * @since 4.0.0
 * @category sampling
 */
export class CreateMessage extends Rpc.make("sampling/createMessage", {
  success: CreateMessageResult,
  error: McpError,
  payload: {
    messages: Schema.Array(SamplingMessage),
    /**
     * The server's preferences for which model to select. The client MAY ignore
     * these preferences.
     */
    modelPreferences: optional(ModelPreferences),
    /**
     * An optional system prompt the server wants to use for sampling. The
     * client MAY modify or omit this prompt.
     */
    systemPrompt: optional(Schema.String),
    /**
     * A request to include context from one or more MCP servers (including the
     * caller), to be attached to the prompt. The client MAY ignore this request.
     */
    includeContext: optional(Schema.Literals(["none", "thisServer", "allServers"])),
    temperature: optional(Schema.Number),
    /**
     * The maximum number of tokens to sample, as requested by the server. The
     * client MAY choose to sample fewer tokens than requested.
     */
    maxTokens: Schema.Number,
    stopSequences: optional(Schema.Array(Schema.String)),
    /**
     * Optional metadata to pass through to the LLM provider. The format of
     * this metadata is provider-specific.
     */
    metadata: Schema.Unknown
  }
}) {}

// =============================================================================
// Autocomplete
// =============================================================================

/**
 * A reference to a resource or resource template definition.
 *
 * @since 4.0.0
 * @category autocomplete
 */
export const ResourceReference = Generated.ResourceReference
export type ResourceReference = typeof ResourceReference.Type

/**
 * Identifies a prompt.
 *
 * @since 4.0.0
 * @category autocomplete
 */
export const PromptReference = Generated.PromptReference
export type PromptReference = typeof PromptReference.Type

/**
 * The server's response to a completion/complete request
 *
 * @since 4.0.0
 * @category autocomplete
 */
export const CompleteResult = Generated.CompleteResult
export type CompleteResult = typeof CompleteResult.Type

/**
 * A request from the client to the server, to ask for completion options.
 *
 * @since 4.0.0
 * @category autocomplete
 */
export class Complete extends Rpc.make("completion/complete", {
  success: CompleteResult,
  error: McpError,
  payload: Schema.Struct({
    ref: Schema.Union([PromptReference, ResourceReference]),
    /**
     * The argument's information
     */
    argument: Schema.Struct({
      /**
       * The name of the argument
       */
      name: Schema.String,
      /**
       * The value of the argument to use for completion matching.
       */
      value: Schema.String
    }),
    /**
     * Additional, optional context for completions
     */
    context: optionalWithDefault(
      Schema.Struct({
        /**
         * Previously-resolved variables in a URI template or prompt.
         */
        arguments: optionalWithDefault(
          Schema.Record(Schema.String, Schema.String),
          () => ({})
        )
      }),
      () => ({ arguments: {} })
    )
  })
}) {}

// =============================================================================
// Roots
// =============================================================================

/**
 * Represents a root directory or file that the server can operate on.
 *
 * @since 4.0.0
 * @category roots
 */
export const Root = Generated.Root
export type Root = typeof Root.Type

/**
 * The client's response to a roots/list request from the server. This result
 * contains an array of Root objects, each representing a root directory or file
 * that the server can operate on.
 *
 * @since 4.0.0
 * @category roots
 */
export const ListRootsResult = Generated.ListRootsResult
export type ListRootsResult = typeof ListRootsResult.Type

/**
 * Sent from the server to request a list of root URIs from the client. Roots
 * allow servers to ask for specific directories or files to operate on. A
 * common example for roots is providing a set of repositories or directories a
 * server should operate
 * on.
 *
 * This request is typically used when the server needs to understand the file
 * system structure or access specific locations that the client has permission
 * to read from.
 *
 * @since 4.0.0
 * @category roots
 */
export class ListRoots extends Rpc.make("roots/list", {
  success: ListRootsResult,
  error: McpError,
  payload: Schema.UndefinedOr(RequestMeta)
}) {}

/**
 * A notification from the client to the server, informing it that the list of
 * roots has changed. This notification should be sent whenever the client adds,
 * removes, or modifies any root. The server should then request an updated list
 * of roots using the ListRootsRequest.
 *
 * @since 4.0.0
 * @category roots
 */
export class RootsListChangedNotification extends Rpc.make("notifications/roots/list_changed", {
  payload: Schema.UndefinedOr(NotificationMeta)
}) {}

// =============================================================================
// Elicitation
// =============================================================================

/**
 * The client's response to an elicitation request
 *
 * @since 4.0.0
 * @category elicitation
 */
export const ElicitAcceptResult = Generated.ElicitAcceptResult
export type ElicitAcceptResult = typeof ElicitAcceptResult.Type

/**
 * The client's response to an elicitation request
 *
 * @since 4.0.0
 * @category elicitation
 */
export const ElicitDeclineResult = Generated.ElicitDeclineResult
export type ElicitDeclineResult = typeof ElicitDeclineResult.Type

/**
 * The client's response to an elicitation request
 *
 * @since 4.0.0
 * @category elicitation
 */
export const ElicitResult = Generated.ElicitResult
export type ElicitResult = typeof ElicitResult.Type

/**
 * @since 4.0.0
 * @category elicitation
 */
export class Elicit extends Rpc.make("elicitation/create", {
  success: ElicitResult,
  error: McpError,
  payload: Schema.Struct({
    /**
     * A message to display to the user, explaining what they are being
     * elicited for.
     */
    message: Schema.String,
    /**
     * A restricted subset of JSON Schema.
     * Only top-level properties are allowed, without nesting.
     */
    requestedSchema: Schema.Unknown
  })
}) {}

/**
 * @since 4.0.0
 * @category elicitation
 */
export class ElicitationDeclined
  extends Schema.ErrorClass<ElicitationDeclined>("@effect/ai/McpSchema/ElicitationDeclined")({
    _tag: Schema.tag("ElicitationDeclined"),
    request: Elicit.payloadSchema,
    cause: optional(Schema.Defect)
  })
{}

// =============================================================================
// Tasks
// =============================================================================

/**
 * @since 4.0.0
 * @category tasks
 */
export const TaskStatus = Generated.TaskStatus

/**
 * @since 4.0.0
 * @category tasks
 */
export type TaskStatus = typeof TaskStatus.Type

/**
 * @since 4.0.0
 * @category tasks
 */
export const TaskMetadata = Generated.TaskMetadata
export type TaskMetadata = typeof TaskMetadata.Type

/**
 * @since 4.0.0
 * @category tasks
 */
export const RelatedTaskMetadata = Generated.RelatedTaskMetadata
export type RelatedTaskMetadata = typeof RelatedTaskMetadata.Type

/**
 * @since 4.0.0
 * @category tasks
 */
export const Task = Generated.Task
export type Task = typeof Task.Type

/**
 * @since 4.0.0
 * @category tasks
 */
export const CreateTaskResult = Generated.CreateTaskResult
export type CreateTaskResult = typeof CreateTaskResult.Type

/**
 * @since 4.0.0
 * @category `tasks/get`
 */
export class GetTask extends Rpc.make("tasks/get", {
  success: Generated.GetTaskResult,
  error: McpError,
  payload: Generated.GetTaskParams
}) {}

/**
 * @since 4.0.0
 * @category `tasks/get`
 */
export type GetTaskRequest = typeof GetTask.payloadSchema.Type

/**
 * @since 4.0.0
 * @category `tasks/get`
 */
export const GetTaskResult = Generated.GetTaskResult
export type GetTaskResult = typeof GetTaskResult.Type

/**
 * @since 4.0.0
 * @category `tasks/result`
 */
export class GetTaskPayload extends Rpc.make("tasks/result", {
  success: Generated.GetTaskPayloadResult,
  error: McpError,
  payload: Generated.GetTaskPayloadParams
}) {}

/**
 * @since 4.0.0
 * @category `tasks/result`
 */
export type GetTaskPayloadRequest = typeof GetTaskPayload.payloadSchema.Type

/**
 * @since 4.0.0
 * @category `tasks/result`
 */
export const GetTaskPayloadResult = Generated.GetTaskPayloadResult

/**
 * @since 4.0.0
 * @category `tasks/result`
 */
export type GetTaskPayloadResult = typeof Generated.GetTaskPayloadResult.Type

/**
 * @since 4.0.0
 * @category `tasks/cancel`
 */
export class CancelTask extends Rpc.make("tasks/cancel", {
  success: Generated.CancelTaskResult,
  error: McpError,
  payload: Generated.CancelTaskParams
}) {}

/**
 * @since 4.0.0
 * @category `tasks/cancel`
 */
export type CancelTaskRequest = typeof CancelTask.payloadSchema.Type

/**
 * @since 4.0.0
 * @category `tasks/cancel`
 */
export const CancelTaskResult = Generated.CancelTaskResult
export type CancelTaskResult = typeof CancelTaskResult.Type

/**
 * @since 4.0.0
 * @category `tasks/list`
 */
export class ListTasks extends Rpc.make("tasks/list", {
  success: Generated.ListTasksResult,
  error: McpError,
  payload: Schema.UndefinedOr(Generated.ListTasksParams)
}) {}

/**
 * @since 4.0.0
 * @category `tasks/list`
 */
export type ListTasksRequest = typeof ListTasks.payloadSchema.Type

/**
 * @since 4.0.0
 * @category `tasks/list`
 */
export const ListTasksResult = Generated.ListTasksResult
export type ListTasksResult = typeof ListTasksResult.Type

/**
 * @since 4.0.0
 * @category `notifications/tasks/status`
 */
export const TaskStatusNotificationParams = Generated.TaskStatusNotificationParams
export type TaskStatusNotificationParams = typeof TaskStatusNotificationParams.Type

/**
 * @since 4.0.0
 * @category `notifications/tasks/status`
 */
export class TaskStatusNotification extends Rpc.make("notifications/tasks/status", {
  payload: Generated.TaskStatusNotificationParams
}) {}

/**
 * @since 4.0.0
 * @category `notifications/elicitation/complete`
 */
export const ElicitationCompleteNotificationParams = Generated.ElicitationCompleteNotificationParams
export type ElicitationCompleteNotificationParams = typeof ElicitationCompleteNotificationParams.Type

/**
 * @since 4.0.0
 * @category `notifications/elicitation/complete`
 */
export class ElicitationCompleteNotification extends Rpc.make("notifications/elicitation/complete", {
  payload: Generated.ElicitationCompleteNotificationParams
}) {}

// =============================================================================
// McpServerClient
// =============================================================================

/**
 * @since 4.0.0
 * @category client
 */
export class McpServerClient extends ServiceMap.Service<McpServerClient, {
  readonly clientId: number
  readonly initializePayload: typeof Initialize.payloadSchema["Type"]
  readonly getClient: Effect.Effect<
    RpcClient.RpcClient<RpcGroup.Rpcs<typeof ServerRequestRpcs>, RpcClientError>,
    never,
    Scope.Scope
  >
  readonly elicit: (
    params: typeof Elicit.payloadSchema["Type"]
  ) => Effect.Effect<
    typeof Elicit.successSchema["Type"],
    RpcClientError | typeof Elicit.errorSchema["Type"],
    never
  >
  readonly sample: (
    params: typeof CreateMessage.payloadSchema["Type"]
  ) => Effect.Effect<
    typeof CreateMessage.successSchema["Type"],
    RpcClientError | typeof CreateMessage.errorSchema["Type"],
    never
  >
  readonly listRoots: () => Effect.Effect<
    typeof ListRoots.successSchema["Type"],
    RpcClientError | typeof ListRoots.errorSchema["Type"],
    never
  >
}>()("effect/ai/McpSchema/McpServerClient") {}

/**
 * @since 4.0.0
 * @category middleware
 */
export class McpServerClientMiddleware extends RpcMiddleware.Service<McpServerClientMiddleware, {
  provides: McpServerClient
}>()("effect/ai/McpSchema/McpServerClientMiddleware") {}

// =============================================================================
// Protocol
// =============================================================================

/**
 * @since 4.0.0
 * @category protocol
 */
export type RequestEncoded<Group extends RpcGroup.Any> = RpcGroup.Rpcs<
  Group
> extends infer Rpc ? Rpc extends Rpc.Rpc<
    infer _Tag,
    infer _Payload,
    infer _Success,
    infer _Error,
    infer _Middleware
  > ? {
      readonly _tag: "Request"
      readonly id: string | number
      readonly method: _Tag
      readonly payload: _Payload["Encoded"]
    }
  : never
  : never

/**
 * @since 4.0.0
 * @category protocol
 */
export type NotificationEncoded<Group extends RpcGroup.Any> = RpcGroup.Rpcs<
  Group
> extends infer Rpc ? Rpc extends Rpc.Rpc<
    infer _Tag,
    infer _Payload,
    infer _Success,
    infer _Error,
    infer _Middleware
  > ? {
      readonly _tag: "Notification"
      readonly method: _Tag
      readonly payload: _Payload["Encoded"]
    }
  : never
  : never

/**
 * @since 4.0.0
 * @category protocol
 */
export type SuccessEncoded<Group extends RpcGroup.Any> = RpcGroup.Rpcs<
  Group
> extends infer Rpc ? Rpc extends Rpc.Rpc<
    infer _Tag,
    infer _Payload,
    infer _Success,
    infer _Error,
    infer _Middleware
  > ? {
      readonly _tag: "Success"
      readonly id: string | number
      readonly result: _Success["Encoded"]
    }
  : never
  : never

/**
 * @since 4.0.0
 * @category protocol
 */
export type FailureEncoded<Group extends RpcGroup.Any> = RpcGroup.Rpcs<
  Group
> extends infer Rpc ? Rpc extends Rpc.Rpc<
    infer _Tag,
    infer _Payload,
    infer _Success,
    infer _Error,
    infer _Middleware
  > ? {
      readonly _tag: "Failure"
      readonly id: string | number
      readonly error: _Error["Encoded"]
    }
  : never
  : never

/**
 * @since 4.0.0
 * @category protocol
 */
export class ClientRequestRpcs extends RpcGroup.make(
  Ping,
  Initialize,
  Complete,
  SetLevel,
  GetPrompt,
  ListPrompts,
  ListResources,
  ListResourceTemplates,
  ReadResource,
  Subscribe,
  Unsubscribe,
  CallTool,
  ListTools,
  GetTask,
  GetTaskPayload,
  ListTasks,
  CancelTask
).middleware(McpServerClientMiddleware) {}

/**
 * @since 4.0.0
 * @category protocol
 */
export type ClientRequestEncoded = RequestEncoded<typeof ClientRequestRpcs>

/**
 * @since 4.0.0
 * @category protocol
 */
export class ClientNotificationRpcs extends RpcGroup.make(
  CancelledNotification,
  ProgressNotification,
  InitializedNotification,
  RootsListChangedNotification,
  TaskStatusNotification
) {}

/**
 * @since 4.0.0
 * @category protocol
 */
export type ClientNotificationEncoded = NotificationEncoded<typeof ClientNotificationRpcs>

/**
 * @since 4.0.0
 * @category protocol
 */
export class ClientRpcs extends ClientRequestRpcs.merge(ClientNotificationRpcs) {}

/**
 * @since 4.0.0
 * @category protocol
 */
export type ClientSuccessEncoded = SuccessEncoded<typeof ServerRequestRpcs>

/**
 * @since 4.0.0
 * @category protocol
 */
export type ClientFailureEncoded = FailureEncoded<typeof ServerRequestRpcs>

/**
 * @since 4.0.0
 * @category protocol
 */
export class ServerRequestRpcs extends RpcGroup.make(
  Ping,
  CreateMessage,
  ListRoots,
  Elicit,
  GetTask,
  GetTaskPayload,
  ListTasks,
  CancelTask
) {}

/**
 * @since 4.0.0
 * @category protocol
 */
export type ServerRequestEncoded = RequestEncoded<typeof ServerRequestRpcs>

/**
 * @since 4.0.0
 * @category protocol
 */
export class ServerNotificationRpcs extends RpcGroup.make(
  CancelledNotification,
  ProgressNotification,
  LoggingMessageNotification,
  ResourceUpdatedNotification,
  ResourceListChangedNotification,
  ToolListChangedNotification,
  PromptListChangedNotification,
  ElicitationCompleteNotification,
  TaskStatusNotification
) {}

/**
 * @since 4.0.0
 * @category protocol
 */
export type ServerNotificationEncoded = NotificationEncoded<typeof ServerNotificationRpcs>

/**
 * @since 4.0.0
 * @category protocol
 */
export type ServerSuccessEncoded = SuccessEncoded<typeof ClientRequestRpcs>

/**
 * @since 4.0.0
 * @category protocol
 */
export type ServerFailureEncoded = FailureEncoded<typeof ClientRequestRpcs>

/**
 * @since 4.0.0
 * @category protocol
 */
export type ServerResultEncoded = ServerSuccessEncoded | ServerFailureEncoded

/**
 * @since 4.0.0
 * @category protocol
 */
export type FromClientEncoded = ClientRequestEncoded | ClientNotificationEncoded

/**
 * @since 4.0.0
 * @category protocol
 */
export type FromServerEncoded = ServerResultEncoded | ServerNotificationEncoded

const ParamSchemaTypeId = "~effect/ai/McpSchema/ParamSchema"

/**
 * @since 4.0.0
 * @category parameters
 */
export function isParam(schema: Schema.Top): schema is Param<string, Schema.Top> {
  return Predicate.hasProperty(schema, ParamSchemaTypeId)
}

/**
 * @since 4.0.0
 * @category parameters
 */
export interface Param<Name extends string, S extends Schema.Top> extends
  Schema.Bottom<
    S["Type"],
    S["Encoded"],
    S["DecodingServices"],
    S["EncodingServices"],
    S["ast"],
    Param<Name, S>,
    S["~type.make.in"],
    S["Iso"],
    S["~type.parameters"],
    S["~type.make"],
    S["~type.mutability"],
    S["~type.optionality"],
    S["~type.constructor.default"],
    S["~encoded.mutability"],
    S["~encoded.optionality"]
  >
{
  readonly "~rebuild.out": this
  readonly [ParamSchemaTypeId]: typeof ParamSchemaTypeId
  readonly name: Name
  readonly schema: S
}

/**
 * Helper to create a param for a resource URI template.
 *
 * @since 4.0.0
 * @category parameters
 */
export function param<const Name extends string, S extends Schema.Top>(
  name: Name,
  schema: S
): Param<Name, S> {
  return Schema.make(schema.ast, { [ParamSchemaTypeId]: ParamSchemaTypeId, name, schema })
}

/**
 * Annotation to conditionally enable or disable tools based on client
 * information.
 *
 * @since 4.0.0
 * @category annotations
 */
export class EnabledWhen
  extends ServiceMap.Service<EnabledWhen, Predicate.Predicate<typeof Initialize.payloadSchema.Type>>()(
    "effect/unstable/ai/McpSchema/EnabledWhen"
  )
{}
