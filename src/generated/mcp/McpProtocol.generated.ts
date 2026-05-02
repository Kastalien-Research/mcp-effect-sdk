/**
 * Generated from vendored modelcontextprotocol schema.ts for stable 2025-11-25.
 * Do not edit manually.
 */

export const LATEST_PROTOCOL_VERSION = "2025-11-25" as const

const methodByType = <
  Descriptors extends ReadonlyArray<{ readonly type: string; readonly method: string }>
>(
  descriptors: Descriptors
): { readonly [Descriptor in Descriptors[number] as Descriptor["type"]]: Descriptor["method"] } =>
  Object.fromEntries(descriptors.map(({ type, method }) => [type, method])) as {
    readonly [Descriptor in Descriptors[number] as Descriptor["type"]]: Descriptor["method"]
  }

const resultTypeByType = <
  Descriptors extends ReadonlyArray<{ readonly type: string; readonly resultType: string }>
>(
  descriptors: Descriptors
): {
  readonly [Descriptor in Descriptors[number] as Descriptor["type"]]: Descriptor["resultType"]
} =>
  Object.fromEntries(descriptors.map(({ type, resultType }) => [type, resultType])) as {
    readonly [Descriptor in Descriptors[number] as Descriptor["type"]]: Descriptor["resultType"]
  }

const resultTypeByMethod = <
  Descriptors extends ReadonlyArray<{ readonly method: string; readonly resultType: string }>
>(
  descriptors: Descriptors
): {
  readonly [Descriptor in Descriptors[number] as Descriptor["method"]]: Descriptor["resultType"]
} =>
  Object.fromEntries(descriptors.map(({ method, resultType }) => [method, resultType])) as {
    readonly [Descriptor in Descriptors[number] as Descriptor["method"]]: Descriptor["resultType"]
  }

const methodSet = <Methods extends ReadonlyArray<string>>(
  methods: Methods
): ReadonlySet<Methods[number]> => new Set(methods)

export const CLIENT_REQUEST_DESCRIPTORS = [
  {
    "type": "PingRequest",
    "method": "ping",
    "resultType": "EmptyResult"
  },
  {
    "type": "InitializeRequest",
    "method": "initialize",
    "resultType": "InitializeResult"
  },
  {
    "type": "CompleteRequest",
    "method": "completion/complete",
    "resultType": "CompleteResult"
  },
  {
    "type": "SetLevelRequest",
    "method": "logging/setLevel",
    "resultType": "EmptyResult"
  },
  {
    "type": "GetPromptRequest",
    "method": "prompts/get",
    "resultType": "GetPromptResult"
  },
  {
    "type": "ListPromptsRequest",
    "method": "prompts/list",
    "resultType": "ListPromptsResult"
  },
  {
    "type": "ListResourcesRequest",
    "method": "resources/list",
    "resultType": "ListResourcesResult"
  },
  {
    "type": "ListResourceTemplatesRequest",
    "method": "resources/templates/list",
    "resultType": "ListResourceTemplatesResult"
  },
  {
    "type": "ReadResourceRequest",
    "method": "resources/read",
    "resultType": "ReadResourceResult"
  },
  {
    "type": "SubscribeRequest",
    "method": "resources/subscribe",
    "resultType": "EmptyResult"
  },
  {
    "type": "UnsubscribeRequest",
    "method": "resources/unsubscribe",
    "resultType": "EmptyResult"
  },
  {
    "type": "CallToolRequest",
    "method": "tools/call",
    "resultType": "CallToolResult"
  },
  {
    "type": "ListToolsRequest",
    "method": "tools/list",
    "resultType": "ListToolsResult"
  },
  {
    "type": "GetTaskRequest",
    "method": "tasks/get",
    "resultType": "GetTaskResult"
  },
  {
    "type": "GetTaskPayloadRequest",
    "method": "tasks/result",
    "resultType": "GetTaskPayloadResult"
  },
  {
    "type": "ListTasksRequest",
    "method": "tasks/list",
    "resultType": "ListTasksResult"
  },
  {
    "type": "CancelTaskRequest",
    "method": "tasks/cancel",
    "resultType": "CancelTaskResult"
  }
] as const
export type ClientRequestDescriptor = typeof CLIENT_REQUEST_DESCRIPTORS[number]
export type ClientRequestType = ClientRequestDescriptor["type"]
export type ClientRequestMethod = ClientRequestDescriptor["method"]
export type ClientRequestResultType = ClientRequestDescriptor["resultType"]
export type ClientResultTypeForMethod<Method extends ClientRequestMethod> =
  Extract<ClientRequestDescriptor, { readonly method: Method }>["resultType"]
export type ClientResultTypeForType<Type extends ClientRequestType> =
  Extract<ClientRequestDescriptor, { readonly type: Type }>["resultType"]

export const CLIENT_NOTIFICATION_DESCRIPTORS = [
  {
    "type": "CancelledNotification",
    "method": "notifications/cancelled"
  },
  {
    "type": "ProgressNotification",
    "method": "notifications/progress"
  },
  {
    "type": "InitializedNotification",
    "method": "notifications/initialized"
  },
  {
    "type": "RootsListChangedNotification",
    "method": "notifications/roots/list_changed"
  },
  {
    "type": "TaskStatusNotification",
    "method": "notifications/tasks/status"
  }
] as const
export type ClientNotificationDescriptor = typeof CLIENT_NOTIFICATION_DESCRIPTORS[number]
export type ClientNotificationType = ClientNotificationDescriptor["type"]
export type ClientNotificationMethod = ClientNotificationDescriptor["method"]

export const SERVER_REQUEST_DESCRIPTORS = [
  {
    "type": "PingRequest",
    "method": "ping",
    "resultType": "EmptyResult"
  },
  {
    "type": "CreateMessageRequest",
    "method": "sampling/createMessage",
    "resultType": "CreateMessageResult"
  },
  {
    "type": "ListRootsRequest",
    "method": "roots/list",
    "resultType": "ListRootsResult"
  },
  {
    "type": "ElicitRequest",
    "method": "elicitation/create",
    "resultType": "ElicitResult"
  },
  {
    "type": "GetTaskRequest",
    "method": "tasks/get",
    "resultType": "GetTaskResult"
  },
  {
    "type": "GetTaskPayloadRequest",
    "method": "tasks/result",
    "resultType": "GetTaskPayloadResult"
  },
  {
    "type": "ListTasksRequest",
    "method": "tasks/list",
    "resultType": "ListTasksResult"
  },
  {
    "type": "CancelTaskRequest",
    "method": "tasks/cancel",
    "resultType": "CancelTaskResult"
  }
] as const
export type ServerRequestDescriptor = typeof SERVER_REQUEST_DESCRIPTORS[number]
export type ServerRequestType = ServerRequestDescriptor["type"]
export type ServerRequestMethod = ServerRequestDescriptor["method"]
export type ServerRequestResultType = ServerRequestDescriptor["resultType"]
export type ServerResultTypeForMethod<Method extends ServerRequestMethod> =
  Extract<ServerRequestDescriptor, { readonly method: Method }>["resultType"]
export type ServerResultTypeForType<Type extends ServerRequestType> =
  Extract<ServerRequestDescriptor, { readonly type: Type }>["resultType"]

export const SERVER_NOTIFICATION_DESCRIPTORS = [
  {
    "type": "CancelledNotification",
    "method": "notifications/cancelled"
  },
  {
    "type": "ProgressNotification",
    "method": "notifications/progress"
  },
  {
    "type": "LoggingMessageNotification",
    "method": "notifications/message"
  },
  {
    "type": "ResourceUpdatedNotification",
    "method": "notifications/resources/updated"
  },
  {
    "type": "ResourceListChangedNotification",
    "method": "notifications/resources/list_changed"
  },
  {
    "type": "ToolListChangedNotification",
    "method": "notifications/tools/list_changed"
  },
  {
    "type": "PromptListChangedNotification",
    "method": "notifications/prompts/list_changed"
  },
  {
    "type": "ElicitationCompleteNotification",
    "method": "notifications/elicitation/complete"
  },
  {
    "type": "TaskStatusNotification",
    "method": "notifications/tasks/status"
  }
] as const
export type ServerNotificationDescriptor = typeof SERVER_NOTIFICATION_DESCRIPTORS[number]
export type ServerNotificationType = ServerNotificationDescriptor["type"]
export type ServerNotificationMethod = ServerNotificationDescriptor["method"]

export const CLIENT_REQUEST_TYPES = [
  "PingRequest",
  "InitializeRequest",
  "CompleteRequest",
  "SetLevelRequest",
  "GetPromptRequest",
  "ListPromptsRequest",
  "ListResourcesRequest",
  "ListResourceTemplatesRequest",
  "ReadResourceRequest",
  "SubscribeRequest",
  "UnsubscribeRequest",
  "CallToolRequest",
  "ListToolsRequest",
  "GetTaskRequest",
  "GetTaskPayloadRequest",
  "ListTasksRequest",
  "CancelTaskRequest"
] as const
export const CLIENT_NOTIFICATION_TYPES = [
  "CancelledNotification",
  "ProgressNotification",
  "InitializedNotification",
  "RootsListChangedNotification",
  "TaskStatusNotification"
] as const
export const SERVER_REQUEST_TYPES = [
  "PingRequest",
  "CreateMessageRequest",
  "ListRootsRequest",
  "ElicitRequest",
  "GetTaskRequest",
  "GetTaskPayloadRequest",
  "ListTasksRequest",
  "CancelTaskRequest"
] as const
export const SERVER_NOTIFICATION_TYPES = [
  "CancelledNotification",
  "ProgressNotification",
  "LoggingMessageNotification",
  "ResourceUpdatedNotification",
  "ResourceListChangedNotification",
  "ToolListChangedNotification",
  "PromptListChangedNotification",
  "ElicitationCompleteNotification",
  "TaskStatusNotification"
] as const

export const CLIENT_REQUEST_METHODS = [
  "ping",
  "initialize",
  "completion/complete",
  "logging/setLevel",
  "prompts/get",
  "prompts/list",
  "resources/list",
  "resources/templates/list",
  "resources/read",
  "resources/subscribe",
  "resources/unsubscribe",
  "tools/call",
  "tools/list",
  "tasks/get",
  "tasks/result",
  "tasks/list",
  "tasks/cancel"
] as const
export const CLIENT_NOTIFICATION_METHODS = [
  "notifications/cancelled",
  "notifications/progress",
  "notifications/initialized",
  "notifications/roots/list_changed",
  "notifications/tasks/status"
] as const
export const SERVER_REQUEST_METHODS = [
  "ping",
  "sampling/createMessage",
  "roots/list",
  "elicitation/create",
  "tasks/get",
  "tasks/result",
  "tasks/list",
  "tasks/cancel"
] as const
export const SERVER_NOTIFICATION_METHODS = [
  "notifications/cancelled",
  "notifications/progress",
  "notifications/message",
  "notifications/resources/updated",
  "notifications/resources/list_changed",
  "notifications/tools/list_changed",
  "notifications/prompts/list_changed",
  "notifications/elicitation/complete",
  "notifications/tasks/status"
] as const

export const CLIENT_REQUEST_METHOD_BY_TYPE = methodByType(CLIENT_REQUEST_DESCRIPTORS)
export const CLIENT_NOTIFICATION_METHOD_BY_TYPE = methodByType(CLIENT_NOTIFICATION_DESCRIPTORS)
export const SERVER_REQUEST_METHOD_BY_TYPE = methodByType(SERVER_REQUEST_DESCRIPTORS)
export const SERVER_NOTIFICATION_METHOD_BY_TYPE = methodByType(SERVER_NOTIFICATION_DESCRIPTORS)

export const CLIENT_REQUEST_RESULT_TYPE_BY_TYPE = resultTypeByType(CLIENT_REQUEST_DESCRIPTORS)
export const CLIENT_REQUEST_RESULT_TYPE_BY_METHOD = resultTypeByMethod(CLIENT_REQUEST_DESCRIPTORS)
export const SERVER_REQUEST_RESULT_TYPE_BY_TYPE = resultTypeByType(SERVER_REQUEST_DESCRIPTORS)
export const SERVER_REQUEST_RESULT_TYPE_BY_METHOD = resultTypeByMethod(SERVER_REQUEST_DESCRIPTORS)

export const CLIENT_REQUEST_METHOD_SET = methodSet(CLIENT_REQUEST_METHODS)
export const CLIENT_NOTIFICATION_METHOD_SET = methodSet(CLIENT_NOTIFICATION_METHODS)
export const SERVER_REQUEST_METHOD_SET = methodSet(SERVER_REQUEST_METHODS)
export const SERVER_NOTIFICATION_METHOD_SET = methodSet(SERVER_NOTIFICATION_METHODS)

export const isClientRequestMethod = (method: string): method is ClientRequestMethod =>
  CLIENT_REQUEST_METHOD_SET.has(method as ClientRequestMethod)

export const isClientNotificationMethod = (method: string): method is ClientNotificationMethod =>
  CLIENT_NOTIFICATION_METHOD_SET.has(method as ClientNotificationMethod)

export const isServerRequestMethod = (method: string): method is ServerRequestMethod =>
  SERVER_REQUEST_METHOD_SET.has(method as ServerRequestMethod)

export const isServerNotificationMethod = (method: string): method is ServerNotificationMethod =>
  SERVER_NOTIFICATION_METHOD_SET.has(method as ServerNotificationMethod)

export const TASK_REQUEST_METHODS = [
  "tasks/get",
  "tasks/result",
  "tasks/list",
  "tasks/cancel"
] as const
export const TASK_NOTIFICATION_METHODS = [
  "notifications/tasks/status"
] as const
export const ELICITATION_NOTIFICATION_METHODS = [
  "notifications/elicitation/complete"
] as const
