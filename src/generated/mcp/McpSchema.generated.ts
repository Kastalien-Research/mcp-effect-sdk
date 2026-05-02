/**
 * Generated from vendored modelcontextprotocol schema artifacts for stable 2025-11-25.
 * Do not edit manually.
 */
import { constFalse, constTrue } from "effect/Function"
import * as Option from "effect/Option"
import * as Schema from "effect/Schema"
import * as Getter from "effect/SchemaGetter"

export interface optionalWithDefault<S extends Schema.Top & Schema.WithoutConstructorDefault>
  extends Schema.withConstructorDefault<Schema.decodeTo<Schema.toType<Schema.optionalKey<S>>, Schema.optionalKey<S>>> {}

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

export const optional = <S extends Schema.Top>(schema: S): Schema.decodeTo<Schema.optional<S>, Schema.optionalKey<S>> =>
  Schema.optionalKey(schema).pipe(
    Schema.decodeTo(Schema.optional(schema), {
      decode: Getter.passthrough() as any,
      encode: Getter.transformOptional(Option.flatMap(Option.fromUndefinedOr))
    })
  )


// =============================================================================
// Common
// =============================================================================

export const RequestId = Schema.Union([Schema.String, Schema.Number])
export type RequestId = typeof RequestId.Type

export const ProgressToken = Schema.Union([Schema.String, Schema.Number])
export type ProgressToken = typeof ProgressToken.Type

export class RequestMeta extends Schema.Opaque<RequestMeta>()(Schema.Struct({
  _meta: optional(Schema.Struct({
    progressToken: optional(ProgressToken)
  }))
})) {}

export class ResultMeta extends Schema.Opaque<ResultMeta>()(Schema.Struct({
  _meta: optional(Schema.Record(Schema.String, Schema.Json))
})) {}

export class NotificationMeta extends Schema.Opaque<NotificationMeta>()(Schema.Struct({
  _meta: optional(Schema.Record(Schema.String, Schema.Json))
})) {}

export const Cursor = Schema.String
export type Cursor = typeof Cursor.Type

export class PaginatedRequestMeta extends Schema.Opaque<PaginatedRequestMeta>()(Schema.Struct({
  ...RequestMeta.fields,
  cursor: optional(Cursor)
})) {}

export class PaginatedResultMeta extends Schema.Opaque<PaginatedResultMeta>()(Schema.Struct({
  ...ResultMeta.fields,
  nextCursor: optional(Cursor)
})) {}

export const Role = Schema.Literals(["user", "assistant"])
export type Role = typeof Role.Type

export class Annotations extends Schema.Opaque<Annotations>()(Schema.Struct({
  audience: optional(Schema.Array(Role)),
  priority: optional(Schema.Number.check(Schema.isBetween({ minimum: 0, maximum: 1 }))),
  lastModified: optional(Schema.String)
})) {}

export class Implementation extends Schema.Opaque<Implementation>()(Schema.Struct({
  name: Schema.String,
  title: optional(Schema.String),
  version: Schema.String
})) {}

// =============================================================================
// Capabilities
// =============================================================================

export class ClientCapabilities extends Schema.Class<ClientCapabilities>(
  "@effect/ai/McpSchema/ClientCapabilities"
)({
  experimental: optional(Schema.Record(Schema.String, Schema.Struct({}))),
  extensions: optional(Schema.Record(Schema.TemplateLiteral([Schema.String, "/", Schema.String]), Schema.Json)),
  roots: optional(Schema.Struct({
    listChanged: optional(Schema.Boolean)
  })),
  sampling: optional(Schema.Struct({
    context: optional(Schema.Struct({})),
    tools: optional(Schema.Struct({}))
  })),
  elicitation: optional(Schema.Struct({
    form: optional(Schema.Struct({})),
    url: optional(Schema.Struct({}))
  })),
  tasks: optional(Schema.Struct({
    list: optional(Schema.Struct({})),
    cancel: optional(Schema.Struct({})),
    requests: optional(Schema.Struct({
      elicitation: optional(Schema.Struct({
        create: optional(Schema.Struct({}))
      })),
      sampling: optional(Schema.Struct({
        createMessage: optional(Schema.Struct({}))
      }))
    }))
  }))
}) {}

export class ServerCapabilities extends Schema.Opaque<ServerCapabilities>()(Schema.Struct({
  experimental: optional(Schema.Record(Schema.String, Schema.Struct({}))),
  extensions: optional(Schema.Record(Schema.TemplateLiteral([Schema.String, "/", Schema.String]), Schema.Json)),
  logging: optional(Schema.Struct({})),
  completions: optional(Schema.Struct({})),
  prompts: optional(Schema.Struct({
    listChanged: optional(Schema.Boolean)
  })),
  resources: optional(Schema.Struct({
    subscribe: optional(Schema.Boolean),
    listChanged: optional(Schema.Boolean)
  })),
  tools: optional(Schema.Struct({
    listChanged: optional(Schema.Boolean)
  })),
  elicitation: optional(Schema.Struct({})),
  tasks: optional(Schema.Struct({
    list: optional(Schema.Struct({})),
    cancel: optional(Schema.Struct({}))
  }))
})) {}

// =============================================================================
// Resources
// =============================================================================

export class Resource extends Schema.Class<Resource>(
  "@effect/ai/McpSchema/Resource"
)({
  uri: Schema.String,
  name: Schema.String,
  title: optional(Schema.String),
  description: optional(Schema.String),
  mimeType: optional(Schema.String),
  annotations: optional(Annotations),
  size: optional(Schema.Number),
  _meta: optional(Schema.Record(Schema.String, Schema.Json))
}) {}

export class ResourceTemplate extends Schema.Class<ResourceTemplate>(
  "@effect/ai/McpSchema/ResourceTemplate"
)({
  uriTemplate: Schema.String,
  name: Schema.String,
  title: optional(Schema.String),
  description: optional(Schema.String),
  mimeType: optional(Schema.String),
  annotations: optional(Annotations),
  _meta: optional(Schema.Record(Schema.String, Schema.Json))
}) {}

export class ResourceContents extends Schema.Opaque<ResourceContents>()(Schema.Struct({
  uri: Schema.String,
  mimeType: optional(Schema.String),
  _meta: optional(Schema.Record(Schema.String, Schema.Json))
})) {}

export class TextResourceContents extends Schema.Opaque<TextResourceContents>()(Schema.Struct({
  ...ResourceContents.fields,
  text: Schema.String
})) {}

export class BlobResourceContents extends Schema.Opaque<BlobResourceContents>()(Schema.Struct({
  ...ResourceContents.fields,
  blob: Schema.Uint8Array
})) {}

export class ListResourcesResult extends Schema.Class<ListResourcesResult>(
  "@effect/ai/McpSchema/ListResourcesResult"
)({
  ...PaginatedResultMeta.fields,
  resources: Schema.Array(Resource)
}) {}

export class ListResourceTemplatesResult extends Schema.Class<ListResourceTemplatesResult>(
  "@effect/ai/McpSchema/ListResourceTemplatesResult"
)({
  ...PaginatedResultMeta.fields,
  resourceTemplates: Schema.Array(ResourceTemplate)
}) {}

export class ReadResourceResult extends Schema.Opaque<ReadResourceResult>()(Schema.Struct({
  ...ResultMeta.fields,
  contents: Schema.Array(Schema.Union([TextResourceContents, BlobResourceContents]))
})) {}

// =============================================================================
// Prompts
// =============================================================================

export class PromptArgument extends Schema.Opaque<PromptArgument>()(Schema.Struct({
  name: Schema.String,
  title: optional(Schema.String),
  description: optional(Schema.String),
  required: optional(Schema.Boolean)
})) {}

export class Prompt extends Schema.Class<Prompt>(
  "@effect/ai/McpSchema/Prompt"
)({
  name: Schema.String,
  title: optional(Schema.String),
  description: optional(Schema.String),
  arguments: optional(Schema.Array(PromptArgument))
}) {}

export class TextContent extends Schema.Opaque<TextContent>()(Schema.Struct({
  type: Schema.tag("text"),
  text: Schema.String,
  annotations: optional(Annotations)
})) {}

export class ImageContent extends Schema.Opaque<ImageContent>()(Schema.Struct({
  type: Schema.tag("image"),
  data: Schema.Uint8Array,
  mimeType: Schema.String,
  annotations: optional(Annotations)
})) {}

export class AudioContent extends Schema.Opaque<AudioContent>()(Schema.Struct({
  type: Schema.tag("audio"),
  data: Schema.Uint8Array,
  mimeType: Schema.String,
  annotations: optional(Annotations)
})) {}

export class EmbeddedResource extends Schema.Opaque<EmbeddedResource>()(Schema.Struct({
  type: Schema.tag("resource"),
  resource: Schema.Union([TextResourceContents, BlobResourceContents]),
  annotations: optional(Annotations)
})) {}

export class ResourceLink extends Schema.Opaque<ResourceLink>()(Schema.Struct({
  ...Resource.fields,
  type: Schema.tag("resource_link")
})) {}

export const ContentBlock = Schema.Union([
  TextContent,
  ImageContent,
  AudioContent,
  EmbeddedResource,
  ResourceLink
])
export type ContentBlock = typeof ContentBlock.Type

export class PromptMessage extends Schema.Opaque<PromptMessage>()(Schema.Struct({
  role: Role,
  content: ContentBlock
})) {}

export class ListPromptsResult extends Schema.Class<ListPromptsResult>(
  "@effect/ai/McpSchema/ListPromptsResult"
)({
  ...PaginatedResultMeta.fields,
  prompts: Schema.Array(Prompt)
}) {}

export class GetPromptResult extends Schema.Class<GetPromptResult>(
  "@effect/ai/McpSchema/GetPromptResult"
)({
  ...ResultMeta.fields,
  messages: Schema.Array(PromptMessage),
  description: optional(Schema.String)
}) {}

// =============================================================================
// Tools
// =============================================================================

export class ToolAnnotations extends Schema.Opaque<ToolAnnotations>()(Schema.Struct({
  title: optional(Schema.String),
  readOnlyHint: optionalWithDefault(Schema.Boolean, constFalse),
  destructiveHint: optionalWithDefault(Schema.Boolean, constTrue),
  idempotentHint: optionalWithDefault(Schema.Boolean, constFalse),
  openWorldHint: optionalWithDefault(Schema.Boolean, constTrue)
})) {}

export class Tool extends Schema.Class<Tool>(
  "@effect/ai/McpSchema/Tool"
)({
  name: Schema.String,
  title: optional(Schema.String),
  description: optional(Schema.String),
  inputSchema: Schema.Any,
  annotations: optional(ToolAnnotations),
  _meta: optional(Schema.Record(Schema.String, Schema.Json))
}) {}

export class ListToolsResult extends Schema.Class<ListToolsResult>(
  "@effect/ai/McpSchema/ListToolsResult"
)({
  ...PaginatedResultMeta.fields,
  tools: Schema.Array(Tool)
}) {}

export class CallToolResult extends Schema.Class<CallToolResult>(
  "@effect/ai/McpSchema/CallToolResult"
)({
  ...ResultMeta.fields,
  content: Schema.Array(ContentBlock),
  structuredContent: optional(Schema.Any),
  isError: optional(Schema.Boolean)
}) {}

// =============================================================================
// Logging
// =============================================================================

export const LoggingLevel = Schema.Literals(["debug", "info", "notice", "warning", "error", "critical", "alert", "emergency"])
export type LoggingLevel = typeof LoggingLevel.Type

// =============================================================================
// Sampling
// =============================================================================

export class SamplingMessage extends Schema.Opaque<SamplingMessage>()(Schema.Struct({
  role: Role,
  content: Schema.Union([TextContent, ImageContent, AudioContent])
})) {}

export class ModelHint extends Schema.Opaque<ModelHint>()(Schema.Struct({
  name: optional(Schema.String)
})) {}

export class ModelPreferences extends Schema.Class<ModelPreferences>(
  "@effect/ai/McpSchema/ModelPreferences"
)({
  hints: optional(Schema.Array(ModelHint)),
  costPriority: optional(Schema.Number.check(Schema.isBetween({ minimum: 0, maximum: 1 }))),
  speedPriority: optional(Schema.Number.check(Schema.isBetween({ minimum: 0, maximum: 1 }))),
  intelligencePriority: optional(Schema.Number.check(Schema.isBetween({ minimum: 0, maximum: 1 })))
}) {}

export class CreateMessageResult extends Schema.Class<CreateMessageResult>(
  "@effect/ai/McpSchema/CreateMessageResult"
)({
  model: Schema.String,
  stopReason: optional(Schema.String)
}) {}

// =============================================================================
// Completion
// =============================================================================

export class ResourceReference extends Schema.Opaque<ResourceReference>()(Schema.Struct({
  type: Schema.tag("ref/resource"),
  uri: Schema.String
})) {}

export class PromptReference extends Schema.Opaque<PromptReference>()(Schema.Struct({
  type: Schema.tag("ref/prompt"),
  name: Schema.String,
  title: optional(Schema.String)
})) {}

export class CompleteResult extends Schema.Opaque<CompleteResult>()(Schema.Struct({
  completion: Schema.Struct({
    values: Schema.Array(Schema.String),
    total: optional(Schema.Number),
    hasMore: optional(Schema.Boolean)
  })
})) {
  static readonly empty = CompleteResult.makeUnsafe({
    completion: {
      values: [],
      total: 0,
      hasMore: false
    }
  })
}

// =============================================================================
// Roots
// =============================================================================

export class Root extends Schema.Class<Root>(
  "@effect/ai/McpSchema/Root"
)({
  uri: Schema.String,
  name: optional(Schema.String)
}) {}

export class ListRootsResult extends Schema.Class<ListRootsResult>(
  "@effect/ai/McpSchema/ListRootsResult"
)({
  roots: Schema.Array(Root)
}) {}

// =============================================================================
// Elicitation
// =============================================================================

export class ElicitAcceptResult extends Schema.Class<ElicitAcceptResult>(
  "@effect/ai/McpSchema/ElicitAcceptResult"
)({
  ...ResultMeta.fields,
  action: Schema.Literal("accept"),
  content: Schema.Any
}) {}

export class ElicitDeclineResult extends Schema.Class<ElicitDeclineResult>(
  "@effect/ai/McpSchema/ElicitDeclineResult"
)({
  ...ResultMeta.fields,
  action: Schema.Literals(["cancel", "decline"])
}) {}

export const ElicitResult = Schema.Union([
  ElicitAcceptResult,
  ElicitDeclineResult
])
export type ElicitResult = typeof ElicitResult.Type

export class ElicitationCompleteNotificationParams extends Schema.Class<ElicitationCompleteNotificationParams>(
  "@effect/ai/McpSchema/ElicitationCompleteNotificationParams"
)({
  elicitationId: Schema.String
}) {}

// =============================================================================
// Tasks
// =============================================================================

export const TaskStatus = Schema.Literals(["working", "input_required", "completed", "failed", "cancelled"])
export type TaskStatus = typeof TaskStatus.Type

export class TaskMetadata extends Schema.Class<TaskMetadata>(
  "@effect/ai/McpSchema/TaskMetadata"
)({
  ttl: optional(Schema.Number)
}) {}

export class RelatedTaskMetadata extends Schema.Class<RelatedTaskMetadata>(
  "@effect/ai/McpSchema/RelatedTaskMetadata"
)({
  taskId: Schema.String
}) {}

export class Task extends Schema.Class<Task>(
  "@effect/ai/McpSchema/Task"
)({
  taskId: Schema.String,
  status: TaskStatus,
  statusMessage: optional(Schema.String),
  createdAt: Schema.String,
  lastUpdatedAt: Schema.String,
  ttl: Schema.NullOr(Schema.Number),
  pollInterval: optional(Schema.Number)
}) {}

export class CreateTaskResult extends Schema.Class<CreateTaskResult>(
  "@effect/ai/McpSchema/CreateTaskResult"
)({
  ...ResultMeta.fields,
  task: Task
}) {}

export class GetTaskParams extends Schema.Class<GetTaskParams>(
  "@effect/ai/McpSchema/GetTaskParams"
)({
  ...RequestMeta.fields,
  taskId: Schema.String
}) {}

export class GetTaskResult extends Schema.Class<GetTaskResult>(
  "@effect/ai/McpSchema/GetTaskResult"
)({
  ...ResultMeta.fields,
  ...Task.fields
}) {}

export class GetTaskPayloadParams extends Schema.Class<GetTaskPayloadParams>(
  "@effect/ai/McpSchema/GetTaskPayloadParams"
)({
  ...RequestMeta.fields,
  taskId: Schema.String
}) {}

export const GetTaskPayloadResult = Schema.Record(Schema.String, Schema.Unknown)
export type GetTaskPayloadResult = typeof GetTaskPayloadResult.Type

export class CancelTaskParams extends Schema.Class<CancelTaskParams>(
  "@effect/ai/McpSchema/CancelTaskParams"
)({
  ...RequestMeta.fields,
  taskId: Schema.String
}) {}

export class CancelTaskResult extends Schema.Class<CancelTaskResult>(
  "@effect/ai/McpSchema/CancelTaskResult"
)({
  ...ResultMeta.fields,
  ...Task.fields
}) {}

export class ListTasksParams extends Schema.Class<ListTasksParams>(
  "@effect/ai/McpSchema/ListTasksParams"
)({
  ...PaginatedRequestMeta.fields
}) {}

export class ListTasksResult extends Schema.Class<ListTasksResult>(
  "@effect/ai/McpSchema/ListTasksResult"
)({
  ...PaginatedResultMeta.fields,
  tasks: Schema.Array(Task)
}) {}

export class TaskStatusNotificationParams extends Schema.Class<TaskStatusNotificationParams>(
  "@effect/ai/McpSchema/TaskStatusNotificationParams"
)({
  ...NotificationMeta.fields,
  ...Task.fields
}) {}
