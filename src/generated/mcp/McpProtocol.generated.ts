/**
 * Generated from vendored modelcontextprotocol schema.ts for stable 2025-11-25.
 * Do not edit manually.
 */

export const LATEST_PROTOCOL_VERSION = "2025-11-25" as const

export const CLIENT_REQUEST_TYPES = ["PingRequest", "InitializeRequest", "CompleteRequest", "SetLevelRequest", "GetPromptRequest", "ListPromptsRequest", "ListResourcesRequest", "ListResourceTemplatesRequest", "ReadResourceRequest", "SubscribeRequest", "UnsubscribeRequest", "CallToolRequest", "ListToolsRequest", "GetTaskRequest", "GetTaskPayloadRequest", "ListTasksRequest", "CancelTaskRequest"] as const
export const CLIENT_NOTIFICATION_TYPES = ["CancelledNotification", "ProgressNotification", "InitializedNotification", "RootsListChangedNotification", "TaskStatusNotification"] as const
export const SERVER_REQUEST_TYPES = ["PingRequest", "CreateMessageRequest", "ListRootsRequest", "ElicitRequest", "GetTaskRequest", "GetTaskPayloadRequest", "ListTasksRequest", "CancelTaskRequest"] as const
export const SERVER_NOTIFICATION_TYPES = ["CancelledNotification", "ProgressNotification", "LoggingMessageNotification", "ResourceUpdatedNotification", "ResourceListChangedNotification", "ToolListChangedNotification", "PromptListChangedNotification", "ElicitationCompleteNotification", "TaskStatusNotification"] as const

export const CLIENT_REQUEST_METHODS = ["ping", "initialize", "completion/complete", "logging/setLevel", "prompts/get", "prompts/list", "resources/list", "resources/templates/list", "resources/read", "resources/subscribe", "resources/unsubscribe", "tools/call", "tools/list", "tasks/get", "tasks/result", "tasks/list", "tasks/cancel"] as const
export const CLIENT_NOTIFICATION_METHODS = ["notifications/cancelled", "notifications/progress", "notifications/initialized", "notifications/roots/list_changed", "notifications/tasks/status"] as const
export const SERVER_REQUEST_METHODS = ["ping", "sampling/createMessage", "roots/list", "elicitation/create", "tasks/get", "tasks/result", "tasks/list", "tasks/cancel"] as const
export const SERVER_NOTIFICATION_METHODS = ["notifications/cancelled", "notifications/progress", "notifications/message", "notifications/resources/updated", "notifications/resources/list_changed", "notifications/tools/list_changed", "notifications/prompts/list_changed", "notifications/elicitation/complete", "notifications/tasks/status"] as const

export const CLIENT_REQUEST_METHOD_BY_TYPE = {
  "PingRequest": "ping",
  "InitializeRequest": "initialize",
  "CompleteRequest": "completion/complete",
  "SetLevelRequest": "logging/setLevel",
  "GetPromptRequest": "prompts/get",
  "ListPromptsRequest": "prompts/list",
  "ListResourcesRequest": "resources/list",
  "ListResourceTemplatesRequest": "resources/templates/list",
  "ReadResourceRequest": "resources/read",
  "SubscribeRequest": "resources/subscribe",
  "UnsubscribeRequest": "resources/unsubscribe",
  "CallToolRequest": "tools/call",
  "ListToolsRequest": "tools/list",
  "GetTaskRequest": "tasks/get",
  "GetTaskPayloadRequest": "tasks/result",
  "ListTasksRequest": "tasks/list",
  "CancelTaskRequest": "tasks/cancel"
} as const
export const CLIENT_NOTIFICATION_METHOD_BY_TYPE = {
  "CancelledNotification": "notifications/cancelled",
  "ProgressNotification": "notifications/progress",
  "InitializedNotification": "notifications/initialized",
  "RootsListChangedNotification": "notifications/roots/list_changed",
  "TaskStatusNotification": "notifications/tasks/status"
} as const
export const SERVER_REQUEST_METHOD_BY_TYPE = {
  "PingRequest": "ping",
  "CreateMessageRequest": "sampling/createMessage",
  "ListRootsRequest": "roots/list",
  "ElicitRequest": "elicitation/create",
  "GetTaskRequest": "tasks/get",
  "GetTaskPayloadRequest": "tasks/result",
  "ListTasksRequest": "tasks/list",
  "CancelTaskRequest": "tasks/cancel"
} as const
export const SERVER_NOTIFICATION_METHOD_BY_TYPE = {
  "CancelledNotification": "notifications/cancelled",
  "ProgressNotification": "notifications/progress",
  "LoggingMessageNotification": "notifications/message",
  "ResourceUpdatedNotification": "notifications/resources/updated",
  "ResourceListChangedNotification": "notifications/resources/list_changed",
  "ToolListChangedNotification": "notifications/tools/list_changed",
  "PromptListChangedNotification": "notifications/prompts/list_changed",
  "ElicitationCompleteNotification": "notifications/elicitation/complete",
  "TaskStatusNotification": "notifications/tasks/status"
} as const

export const TASK_REQUEST_METHODS = ["tasks/get", "tasks/result", "tasks/list", "tasks/cancel"] as const
export const TASK_NOTIFICATION_METHODS = ["notifications/tasks/status"] as const
export const ELICITATION_NOTIFICATION_METHODS = ["notifications/elicitation/complete"] as const
