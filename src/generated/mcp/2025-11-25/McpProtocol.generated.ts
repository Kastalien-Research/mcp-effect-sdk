/**
 * Generated from vendored modelcontextprotocol schema.ts for MCP 2025-11-25.
 * Do not edit manually.
 */

import * as Schema from "effect/Schema"
import * as Generated from "./McpSchema.generated.js"

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

const paramsTypeByType = <
  Descriptors extends ReadonlyArray<{ readonly type: string; readonly paramsType: string }>
>(descriptors: Descriptors): {
  readonly [Descriptor in Descriptors[number] as Descriptor["type"]]: Descriptor["paramsType"]
} => Object.fromEntries(descriptors.map(({ type, paramsType }) => [type, paramsType])) as {
  readonly [Descriptor in Descriptors[number] as Descriptor["type"]]: Descriptor["paramsType"]
}

const paramsTypeByMethod = <
  Descriptors extends ReadonlyArray<{ readonly method: string; readonly paramsType: string }>
>(descriptors: Descriptors): {
  readonly [Descriptor in Descriptors[number] as Descriptor["method"]]: Descriptor["paramsType"]
} => Object.fromEntries(descriptors.map(({ method, paramsType }) => [method, paramsType])) as {
  readonly [Descriptor in Descriptors[number] as Descriptor["method"]]: Descriptor["paramsType"]
}

const methodSet = <Methods extends ReadonlyArray<string>>(
  methods: Methods
): ReadonlySet<Methods[number]> => new Set(methods)

export const CLIENT_REQUEST_DESCRIPTORS = [
  {
    "type": "PingRequest",
    "method": "ping",
    "paramsType": "RequestParams",
    "paramsOptional": true,
    "direction": "client-to-server",
    "http": {
      "methodHeader": "ping",
      "nameSource": null
    },
    "resultType": "EmptyResult"
  },
  {
    "type": "InitializeRequest",
    "method": "initialize",
    "paramsType": "InitializeRequestParams",
    "paramsOptional": false,
    "direction": "client-to-server",
    "http": {
      "methodHeader": "initialize",
      "nameSource": null
    },
    "resultType": "InitializeResult"
  },
  {
    "type": "CompleteRequest",
    "method": "completion/complete",
    "paramsType": "CompleteRequestParams",
    "paramsOptional": false,
    "direction": "client-to-server",
    "http": {
      "methodHeader": "completion/complete",
      "nameSource": null
    },
    "resultType": "CompleteResult"
  },
  {
    "type": "SetLevelRequest",
    "method": "logging/setLevel",
    "paramsType": "SetLevelRequestParams",
    "paramsOptional": false,
    "direction": "client-to-server",
    "http": {
      "methodHeader": "logging/setLevel",
      "nameSource": null
    },
    "resultType": "EmptyResult"
  },
  {
    "type": "GetPromptRequest",
    "method": "prompts/get",
    "paramsType": "GetPromptRequestParams",
    "paramsOptional": false,
    "direction": "client-to-server",
    "http": {
      "methodHeader": "prompts/get",
      "nameSource": "params.name"
    },
    "resultType": "GetPromptResult"
  },
  {
    "type": "ListPromptsRequest",
    "method": "prompts/list",
    "paramsType": "PaginatedRequestParams",
    "paramsOptional": true,
    "direction": "client-to-server",
    "http": {
      "methodHeader": "prompts/list",
      "nameSource": null
    },
    "resultType": "ListPromptsResult"
  },
  {
    "type": "ListResourcesRequest",
    "method": "resources/list",
    "paramsType": "PaginatedRequestParams",
    "paramsOptional": true,
    "direction": "client-to-server",
    "http": {
      "methodHeader": "resources/list",
      "nameSource": null
    },
    "resultType": "ListResourcesResult"
  },
  {
    "type": "ListResourceTemplatesRequest",
    "method": "resources/templates/list",
    "paramsType": "PaginatedRequestParams",
    "paramsOptional": true,
    "direction": "client-to-server",
    "http": {
      "methodHeader": "resources/templates/list",
      "nameSource": null
    },
    "resultType": "ListResourceTemplatesResult"
  },
  {
    "type": "ReadResourceRequest",
    "method": "resources/read",
    "paramsType": "ReadResourceRequestParams",
    "paramsOptional": false,
    "direction": "client-to-server",
    "http": {
      "methodHeader": "resources/read",
      "nameSource": "params.uri"
    },
    "resultType": "ReadResourceResult"
  },
  {
    "type": "SubscribeRequest",
    "method": "resources/subscribe",
    "paramsType": "SubscribeRequestParams",
    "paramsOptional": false,
    "direction": "client-to-server",
    "http": {
      "methodHeader": "resources/subscribe",
      "nameSource": null
    },
    "resultType": "EmptyResult"
  },
  {
    "type": "UnsubscribeRequest",
    "method": "resources/unsubscribe",
    "paramsType": "UnsubscribeRequestParams",
    "paramsOptional": false,
    "direction": "client-to-server",
    "http": {
      "methodHeader": "resources/unsubscribe",
      "nameSource": null
    },
    "resultType": "EmptyResult"
  },
  {
    "type": "CallToolRequest",
    "method": "tools/call",
    "paramsType": "CallToolRequestParams",
    "paramsOptional": false,
    "direction": "client-to-server",
    "http": {
      "methodHeader": "tools/call",
      "nameSource": "params.name"
    },
    "resultType": "CallToolResult"
  },
  {
    "type": "ListToolsRequest",
    "method": "tools/list",
    "paramsType": "PaginatedRequestParams",
    "paramsOptional": true,
    "direction": "client-to-server",
    "http": {
      "methodHeader": "tools/list",
      "nameSource": null
    },
    "resultType": "ListToolsResult"
  },
  {
    "type": "GetTaskRequest",
    "method": "tasks/get",
    "paramsType": "GetTaskRequestParams",
    "paramsOptional": false,
    "direction": "client-to-server",
    "http": {
      "methodHeader": "tasks/get",
      "nameSource": null
    },
    "resultType": "GetTaskResult"
  },
  {
    "type": "GetTaskPayloadRequest",
    "method": "tasks/result",
    "paramsType": "GetTaskPayloadRequestParams",
    "paramsOptional": false,
    "direction": "client-to-server",
    "http": {
      "methodHeader": "tasks/result",
      "nameSource": null
    },
    "resultType": "GetTaskPayloadResult"
  },
  {
    "type": "ListTasksRequest",
    "method": "tasks/list",
    "paramsType": "PaginatedRequestParams",
    "paramsOptional": true,
    "direction": "client-to-server",
    "http": {
      "methodHeader": "tasks/list",
      "nameSource": null
    },
    "resultType": "ListTasksResult"
  },
  {
    "type": "CancelTaskRequest",
    "method": "tasks/cancel",
    "paramsType": "CancelTaskRequestParams",
    "paramsOptional": false,
    "direction": "client-to-server",
    "http": {
      "methodHeader": "tasks/cancel",
      "nameSource": null
    },
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
    "method": "notifications/cancelled",
    "paramsType": "CancelledNotificationParams",
    "paramsOptional": false,
    "direction": "client-to-server",
    "http": {
      "methodHeader": "notifications/cancelled",
      "nameSource": null
    }
  },
  {
    "type": "ProgressNotification",
    "method": "notifications/progress",
    "paramsType": "ProgressNotificationParams",
    "paramsOptional": false,
    "direction": "client-to-server",
    "http": {
      "methodHeader": "notifications/progress",
      "nameSource": null
    }
  },
  {
    "type": "InitializedNotification",
    "method": "notifications/initialized",
    "paramsType": "NotificationParams",
    "paramsOptional": true,
    "direction": "client-to-server",
    "http": {
      "methodHeader": "notifications/initialized",
      "nameSource": null
    }
  },
  {
    "type": "RootsListChangedNotification",
    "method": "notifications/roots/list_changed",
    "paramsType": "NotificationParams",
    "paramsOptional": true,
    "direction": "client-to-server",
    "http": {
      "methodHeader": "notifications/roots/list_changed",
      "nameSource": null
    }
  },
  {
    "type": "TaskStatusNotification",
    "method": "notifications/tasks/status",
    "paramsType": "TaskStatusNotificationParams",
    "paramsOptional": false,
    "direction": "client-to-server",
    "http": {
      "methodHeader": "notifications/tasks/status",
      "nameSource": null
    }
  }
] as const
export type ClientNotificationDescriptor = typeof CLIENT_NOTIFICATION_DESCRIPTORS[number]
export type ClientNotificationType = ClientNotificationDescriptor["type"]
export type ClientNotificationMethod = ClientNotificationDescriptor["method"]

export const SERVER_REQUEST_DESCRIPTORS = [
  {
    "type": "PingRequest",
    "method": "ping",
    "paramsType": "RequestParams",
    "paramsOptional": true,
    "direction": "server-to-client",
    "http": {
      "methodHeader": "ping",
      "nameSource": null
    },
    "resultType": "EmptyResult"
  },
  {
    "type": "CreateMessageRequest",
    "method": "sampling/createMessage",
    "paramsType": "CreateMessageRequestParams",
    "paramsOptional": false,
    "direction": "server-to-client",
    "http": {
      "methodHeader": "sampling/createMessage",
      "nameSource": null
    },
    "resultType": "CreateMessageResult"
  },
  {
    "type": "ListRootsRequest",
    "method": "roots/list",
    "paramsType": "RequestParams",
    "paramsOptional": true,
    "direction": "server-to-client",
    "http": {
      "methodHeader": "roots/list",
      "nameSource": null
    },
    "resultType": "ListRootsResult"
  },
  {
    "type": "ElicitRequest",
    "method": "elicitation/create",
    "paramsType": "ElicitRequestParams",
    "paramsOptional": false,
    "direction": "server-to-client",
    "http": {
      "methodHeader": "elicitation/create",
      "nameSource": null
    },
    "resultType": "ElicitResult"
  },
  {
    "type": "GetTaskRequest",
    "method": "tasks/get",
    "paramsType": "GetTaskRequestParams",
    "paramsOptional": false,
    "direction": "server-to-client",
    "http": {
      "methodHeader": "tasks/get",
      "nameSource": null
    },
    "resultType": "GetTaskResult"
  },
  {
    "type": "GetTaskPayloadRequest",
    "method": "tasks/result",
    "paramsType": "GetTaskPayloadRequestParams",
    "paramsOptional": false,
    "direction": "server-to-client",
    "http": {
      "methodHeader": "tasks/result",
      "nameSource": null
    },
    "resultType": "GetTaskPayloadResult"
  },
  {
    "type": "ListTasksRequest",
    "method": "tasks/list",
    "paramsType": "PaginatedRequestParams",
    "paramsOptional": true,
    "direction": "server-to-client",
    "http": {
      "methodHeader": "tasks/list",
      "nameSource": null
    },
    "resultType": "ListTasksResult"
  },
  {
    "type": "CancelTaskRequest",
    "method": "tasks/cancel",
    "paramsType": "CancelTaskRequestParams",
    "paramsOptional": false,
    "direction": "server-to-client",
    "http": {
      "methodHeader": "tasks/cancel",
      "nameSource": null
    },
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
    "method": "notifications/cancelled",
    "paramsType": "CancelledNotificationParams",
    "paramsOptional": false,
    "direction": "server-to-client",
    "http": {
      "methodHeader": "notifications/cancelled",
      "nameSource": null
    }
  },
  {
    "type": "ProgressNotification",
    "method": "notifications/progress",
    "paramsType": "ProgressNotificationParams",
    "paramsOptional": false,
    "direction": "server-to-client",
    "http": {
      "methodHeader": "notifications/progress",
      "nameSource": null
    }
  },
  {
    "type": "LoggingMessageNotification",
    "method": "notifications/message",
    "paramsType": "LoggingMessageNotificationParams",
    "paramsOptional": false,
    "direction": "server-to-client",
    "http": {
      "methodHeader": "notifications/message",
      "nameSource": null
    }
  },
  {
    "type": "ResourceUpdatedNotification",
    "method": "notifications/resources/updated",
    "paramsType": "ResourceUpdatedNotificationParams",
    "paramsOptional": false,
    "direction": "server-to-client",
    "http": {
      "methodHeader": "notifications/resources/updated",
      "nameSource": null
    }
  },
  {
    "type": "ResourceListChangedNotification",
    "method": "notifications/resources/list_changed",
    "paramsType": "NotificationParams",
    "paramsOptional": true,
    "direction": "server-to-client",
    "http": {
      "methodHeader": "notifications/resources/list_changed",
      "nameSource": null
    }
  },
  {
    "type": "ToolListChangedNotification",
    "method": "notifications/tools/list_changed",
    "paramsType": "NotificationParams",
    "paramsOptional": true,
    "direction": "server-to-client",
    "http": {
      "methodHeader": "notifications/tools/list_changed",
      "nameSource": null
    }
  },
  {
    "type": "PromptListChangedNotification",
    "method": "notifications/prompts/list_changed",
    "paramsType": "NotificationParams",
    "paramsOptional": true,
    "direction": "server-to-client",
    "http": {
      "methodHeader": "notifications/prompts/list_changed",
      "nameSource": null
    }
  },
  {
    "type": "ElicitationCompleteNotification",
    "method": "notifications/elicitation/complete",
    "paramsType": "ElicitationCompleteNotificationParams",
    "paramsOptional": false,
    "direction": "server-to-client",
    "http": {
      "methodHeader": "notifications/elicitation/complete",
      "nameSource": null
    }
  },
  {
    "type": "TaskStatusNotification",
    "method": "notifications/tasks/status",
    "paramsType": "TaskStatusNotificationParams",
    "paramsOptional": false,
    "direction": "server-to-client",
    "http": {
      "methodHeader": "notifications/tasks/status",
      "nameSource": null
    }
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

export const CLIENT_REQUEST_PARAMS_TYPE_BY_TYPE = paramsTypeByType(CLIENT_REQUEST_DESCRIPTORS)
export const CLIENT_REQUEST_PARAMS_TYPE_BY_METHOD = paramsTypeByMethod(CLIENT_REQUEST_DESCRIPTORS)
export const CLIENT_NOTIFICATION_PARAMS_TYPE_BY_TYPE = paramsTypeByType(CLIENT_NOTIFICATION_DESCRIPTORS)
export const CLIENT_NOTIFICATION_PARAMS_TYPE_BY_METHOD = paramsTypeByMethod(CLIENT_NOTIFICATION_DESCRIPTORS)
export const SERVER_REQUEST_PARAMS_TYPE_BY_TYPE = paramsTypeByType(SERVER_REQUEST_DESCRIPTORS)
export const SERVER_REQUEST_PARAMS_TYPE_BY_METHOD = paramsTypeByMethod(SERVER_REQUEST_DESCRIPTORS)
export const SERVER_NOTIFICATION_PARAMS_TYPE_BY_TYPE = paramsTypeByType(SERVER_NOTIFICATION_DESCRIPTORS)
export const SERVER_NOTIFICATION_PARAMS_TYPE_BY_METHOD = paramsTypeByMethod(SERVER_NOTIFICATION_DESCRIPTORS)

export const CLIENT_REQUEST_DESCRIPTOR_BY_TYPE = {
  "PingRequest": CLIENT_REQUEST_DESCRIPTORS[0],
  "InitializeRequest": CLIENT_REQUEST_DESCRIPTORS[1],
  "CompleteRequest": CLIENT_REQUEST_DESCRIPTORS[2],
  "SetLevelRequest": CLIENT_REQUEST_DESCRIPTORS[3],
  "GetPromptRequest": CLIENT_REQUEST_DESCRIPTORS[4],
  "ListPromptsRequest": CLIENT_REQUEST_DESCRIPTORS[5],
  "ListResourcesRequest": CLIENT_REQUEST_DESCRIPTORS[6],
  "ListResourceTemplatesRequest": CLIENT_REQUEST_DESCRIPTORS[7],
  "ReadResourceRequest": CLIENT_REQUEST_DESCRIPTORS[8],
  "SubscribeRequest": CLIENT_REQUEST_DESCRIPTORS[9],
  "UnsubscribeRequest": CLIENT_REQUEST_DESCRIPTORS[10],
  "CallToolRequest": CLIENT_REQUEST_DESCRIPTORS[11],
  "ListToolsRequest": CLIENT_REQUEST_DESCRIPTORS[12],
  "GetTaskRequest": CLIENT_REQUEST_DESCRIPTORS[13],
  "GetTaskPayloadRequest": CLIENT_REQUEST_DESCRIPTORS[14],
  "ListTasksRequest": CLIENT_REQUEST_DESCRIPTORS[15],
  "CancelTaskRequest": CLIENT_REQUEST_DESCRIPTORS[16]
} as const
export const CLIENT_REQUEST_DESCRIPTOR_BY_METHOD = {
  "ping": CLIENT_REQUEST_DESCRIPTORS[0],
  "initialize": CLIENT_REQUEST_DESCRIPTORS[1],
  "completion/complete": CLIENT_REQUEST_DESCRIPTORS[2],
  "logging/setLevel": CLIENT_REQUEST_DESCRIPTORS[3],
  "prompts/get": CLIENT_REQUEST_DESCRIPTORS[4],
  "prompts/list": CLIENT_REQUEST_DESCRIPTORS[5],
  "resources/list": CLIENT_REQUEST_DESCRIPTORS[6],
  "resources/templates/list": CLIENT_REQUEST_DESCRIPTORS[7],
  "resources/read": CLIENT_REQUEST_DESCRIPTORS[8],
  "resources/subscribe": CLIENT_REQUEST_DESCRIPTORS[9],
  "resources/unsubscribe": CLIENT_REQUEST_DESCRIPTORS[10],
  "tools/call": CLIENT_REQUEST_DESCRIPTORS[11],
  "tools/list": CLIENT_REQUEST_DESCRIPTORS[12],
  "tasks/get": CLIENT_REQUEST_DESCRIPTORS[13],
  "tasks/result": CLIENT_REQUEST_DESCRIPTORS[14],
  "tasks/list": CLIENT_REQUEST_DESCRIPTORS[15],
  "tasks/cancel": CLIENT_REQUEST_DESCRIPTORS[16]
} as const
export const CLIENT_REQUEST_CODEC_BY_TYPE = {
  "PingRequest": Generated.PingRequest,
  "InitializeRequest": Generated.InitializeRequest,
  "CompleteRequest": Generated.CompleteRequest,
  "SetLevelRequest": Generated.SetLevelRequest,
  "GetPromptRequest": Generated.GetPromptRequest,
  "ListPromptsRequest": Generated.ListPromptsRequest,
  "ListResourcesRequest": Generated.ListResourcesRequest,
  "ListResourceTemplatesRequest": Generated.ListResourceTemplatesRequest,
  "ReadResourceRequest": Generated.ReadResourceRequest,
  "SubscribeRequest": Generated.SubscribeRequest,
  "UnsubscribeRequest": Generated.UnsubscribeRequest,
  "CallToolRequest": Generated.CallToolRequest,
  "ListToolsRequest": Generated.ListToolsRequest,
  "GetTaskRequest": Generated.GetTaskRequest,
  "GetTaskPayloadRequest": Generated.GetTaskPayloadRequest,
  "ListTasksRequest": Generated.ListTasksRequest,
  "CancelTaskRequest": Generated.CancelTaskRequest
} as const
export const CLIENT_REQUEST_CODEC_BY_METHOD = {
  "ping": Generated.PingRequest,
  "initialize": Generated.InitializeRequest,
  "completion/complete": Generated.CompleteRequest,
  "logging/setLevel": Generated.SetLevelRequest,
  "prompts/get": Generated.GetPromptRequest,
  "prompts/list": Generated.ListPromptsRequest,
  "resources/list": Generated.ListResourcesRequest,
  "resources/templates/list": Generated.ListResourceTemplatesRequest,
  "resources/read": Generated.ReadResourceRequest,
  "resources/subscribe": Generated.SubscribeRequest,
  "resources/unsubscribe": Generated.UnsubscribeRequest,
  "tools/call": Generated.CallToolRequest,
  "tools/list": Generated.ListToolsRequest,
  "tasks/get": Generated.GetTaskRequest,
  "tasks/result": Generated.GetTaskPayloadRequest,
  "tasks/list": Generated.ListTasksRequest,
  "tasks/cancel": Generated.CancelTaskRequest
} as const
export const CLIENT_REQUEST_PARAMS_CODEC_BY_TYPE = {
  "PingRequest": Generated.RequestParams,
  "InitializeRequest": Generated.InitializeRequestParams,
  "CompleteRequest": Generated.CompleteRequestParams,
  "SetLevelRequest": Generated.SetLevelRequestParams,
  "GetPromptRequest": Generated.GetPromptRequestParams,
  "ListPromptsRequest": Generated.PaginatedRequestParams,
  "ListResourcesRequest": Generated.PaginatedRequestParams,
  "ListResourceTemplatesRequest": Generated.PaginatedRequestParams,
  "ReadResourceRequest": Generated.ReadResourceRequestParams,
  "SubscribeRequest": Generated.SubscribeRequestParams,
  "UnsubscribeRequest": Generated.UnsubscribeRequestParams,
  "CallToolRequest": Generated.CallToolRequestParams,
  "ListToolsRequest": Generated.PaginatedRequestParams,
  "GetTaskRequest": Generated.GetTaskRequestParams,
  "GetTaskPayloadRequest": Generated.GetTaskPayloadRequestParams,
  "ListTasksRequest": Generated.PaginatedRequestParams,
  "CancelTaskRequest": Generated.CancelTaskRequestParams
} as const
export const CLIENT_REQUEST_PARAMS_CODEC_BY_METHOD = {
  "ping": Generated.RequestParams,
  "initialize": Generated.InitializeRequestParams,
  "completion/complete": Generated.CompleteRequestParams,
  "logging/setLevel": Generated.SetLevelRequestParams,
  "prompts/get": Generated.GetPromptRequestParams,
  "prompts/list": Generated.PaginatedRequestParams,
  "resources/list": Generated.PaginatedRequestParams,
  "resources/templates/list": Generated.PaginatedRequestParams,
  "resources/read": Generated.ReadResourceRequestParams,
  "resources/subscribe": Generated.SubscribeRequestParams,
  "resources/unsubscribe": Generated.UnsubscribeRequestParams,
  "tools/call": Generated.CallToolRequestParams,
  "tools/list": Generated.PaginatedRequestParams,
  "tasks/get": Generated.GetTaskRequestParams,
  "tasks/result": Generated.GetTaskPayloadRequestParams,
  "tasks/list": Generated.PaginatedRequestParams,
  "tasks/cancel": Generated.CancelTaskRequestParams
} as const
export const CLIENT_REQUEST_PAYLOAD_CODEC_BY_TYPE = {
  "PingRequest": Schema.UndefinedOr(Generated.RequestParams),
  "InitializeRequest": Generated.InitializeRequestParams,
  "CompleteRequest": Generated.CompleteRequestParams,
  "SetLevelRequest": Generated.SetLevelRequestParams,
  "GetPromptRequest": Generated.GetPromptRequestParams,
  "ListPromptsRequest": Schema.UndefinedOr(Generated.PaginatedRequestParams),
  "ListResourcesRequest": Schema.UndefinedOr(Generated.PaginatedRequestParams),
  "ListResourceTemplatesRequest": Schema.UndefinedOr(Generated.PaginatedRequestParams),
  "ReadResourceRequest": Generated.ReadResourceRequestParams,
  "SubscribeRequest": Generated.SubscribeRequestParams,
  "UnsubscribeRequest": Generated.UnsubscribeRequestParams,
  "CallToolRequest": Generated.CallToolRequestParams,
  "ListToolsRequest": Schema.UndefinedOr(Generated.PaginatedRequestParams),
  "GetTaskRequest": Generated.GetTaskRequestParams,
  "GetTaskPayloadRequest": Generated.GetTaskPayloadRequestParams,
  "ListTasksRequest": Schema.UndefinedOr(Generated.PaginatedRequestParams),
  "CancelTaskRequest": Generated.CancelTaskRequestParams
} as const
export const CLIENT_REQUEST_PAYLOAD_CODEC_BY_METHOD = {
  "ping": CLIENT_REQUEST_PAYLOAD_CODEC_BY_TYPE["PingRequest"],
  "initialize": CLIENT_REQUEST_PAYLOAD_CODEC_BY_TYPE["InitializeRequest"],
  "completion/complete": CLIENT_REQUEST_PAYLOAD_CODEC_BY_TYPE["CompleteRequest"],
  "logging/setLevel": CLIENT_REQUEST_PAYLOAD_CODEC_BY_TYPE["SetLevelRequest"],
  "prompts/get": CLIENT_REQUEST_PAYLOAD_CODEC_BY_TYPE["GetPromptRequest"],
  "prompts/list": CLIENT_REQUEST_PAYLOAD_CODEC_BY_TYPE["ListPromptsRequest"],
  "resources/list": CLIENT_REQUEST_PAYLOAD_CODEC_BY_TYPE["ListResourcesRequest"],
  "resources/templates/list": CLIENT_REQUEST_PAYLOAD_CODEC_BY_TYPE["ListResourceTemplatesRequest"],
  "resources/read": CLIENT_REQUEST_PAYLOAD_CODEC_BY_TYPE["ReadResourceRequest"],
  "resources/subscribe": CLIENT_REQUEST_PAYLOAD_CODEC_BY_TYPE["SubscribeRequest"],
  "resources/unsubscribe": CLIENT_REQUEST_PAYLOAD_CODEC_BY_TYPE["UnsubscribeRequest"],
  "tools/call": CLIENT_REQUEST_PAYLOAD_CODEC_BY_TYPE["CallToolRequest"],
  "tools/list": CLIENT_REQUEST_PAYLOAD_CODEC_BY_TYPE["ListToolsRequest"],
  "tasks/get": CLIENT_REQUEST_PAYLOAD_CODEC_BY_TYPE["GetTaskRequest"],
  "tasks/result": CLIENT_REQUEST_PAYLOAD_CODEC_BY_TYPE["GetTaskPayloadRequest"],
  "tasks/list": CLIENT_REQUEST_PAYLOAD_CODEC_BY_TYPE["ListTasksRequest"],
  "tasks/cancel": CLIENT_REQUEST_PAYLOAD_CODEC_BY_TYPE["CancelTaskRequest"]
} as const
export const CLIENT_REQUEST_RESULT_CODEC_BY_TYPE = {
  "PingRequest": Generated.EmptyResult,
  "InitializeRequest": Generated.InitializeResult,
  "CompleteRequest": Generated.CompleteResult,
  "SetLevelRequest": Generated.EmptyResult,
  "GetPromptRequest": Generated.GetPromptResult,
  "ListPromptsRequest": Generated.ListPromptsResult,
  "ListResourcesRequest": Generated.ListResourcesResult,
  "ListResourceTemplatesRequest": Generated.ListResourceTemplatesResult,
  "ReadResourceRequest": Generated.ReadResourceResult,
  "SubscribeRequest": Generated.EmptyResult,
  "UnsubscribeRequest": Generated.EmptyResult,
  "CallToolRequest": Generated.CallToolResult,
  "ListToolsRequest": Generated.ListToolsResult,
  "GetTaskRequest": Generated.GetTaskResult,
  "GetTaskPayloadRequest": Generated.GetTaskPayloadResult,
  "ListTasksRequest": Generated.ListTasksResult,
  "CancelTaskRequest": Generated.CancelTaskResult
} as const
export const CLIENT_REQUEST_RESULT_CODEC_BY_METHOD = {
  "ping": Generated.EmptyResult,
  "initialize": Generated.InitializeResult,
  "completion/complete": Generated.CompleteResult,
  "logging/setLevel": Generated.EmptyResult,
  "prompts/get": Generated.GetPromptResult,
  "prompts/list": Generated.ListPromptsResult,
  "resources/list": Generated.ListResourcesResult,
  "resources/templates/list": Generated.ListResourceTemplatesResult,
  "resources/read": Generated.ReadResourceResult,
  "resources/subscribe": Generated.EmptyResult,
  "resources/unsubscribe": Generated.EmptyResult,
  "tools/call": Generated.CallToolResult,
  "tools/list": Generated.ListToolsResult,
  "tasks/get": Generated.GetTaskResult,
  "tasks/result": Generated.GetTaskPayloadResult,
  "tasks/list": Generated.ListTasksResult,
  "tasks/cancel": Generated.CancelTaskResult
} as const

export const CLIENT_NOTIFICATION_DESCRIPTOR_BY_TYPE = {
  "CancelledNotification": CLIENT_NOTIFICATION_DESCRIPTORS[0],
  "ProgressNotification": CLIENT_NOTIFICATION_DESCRIPTORS[1],
  "InitializedNotification": CLIENT_NOTIFICATION_DESCRIPTORS[2],
  "RootsListChangedNotification": CLIENT_NOTIFICATION_DESCRIPTORS[3],
  "TaskStatusNotification": CLIENT_NOTIFICATION_DESCRIPTORS[4]
} as const
export const CLIENT_NOTIFICATION_DESCRIPTOR_BY_METHOD = {
  "notifications/cancelled": CLIENT_NOTIFICATION_DESCRIPTORS[0],
  "notifications/progress": CLIENT_NOTIFICATION_DESCRIPTORS[1],
  "notifications/initialized": CLIENT_NOTIFICATION_DESCRIPTORS[2],
  "notifications/roots/list_changed": CLIENT_NOTIFICATION_DESCRIPTORS[3],
  "notifications/tasks/status": CLIENT_NOTIFICATION_DESCRIPTORS[4]
} as const
export const CLIENT_NOTIFICATION_CODEC_BY_TYPE = {
  "CancelledNotification": Generated.CancelledNotification,
  "ProgressNotification": Generated.ProgressNotification,
  "InitializedNotification": Generated.InitializedNotification,
  "RootsListChangedNotification": Generated.RootsListChangedNotification,
  "TaskStatusNotification": Generated.TaskStatusNotification
} as const
export const CLIENT_NOTIFICATION_CODEC_BY_METHOD = {
  "notifications/cancelled": Generated.CancelledNotification,
  "notifications/progress": Generated.ProgressNotification,
  "notifications/initialized": Generated.InitializedNotification,
  "notifications/roots/list_changed": Generated.RootsListChangedNotification,
  "notifications/tasks/status": Generated.TaskStatusNotification
} as const
export const CLIENT_NOTIFICATION_PARAMS_CODEC_BY_TYPE = {
  "CancelledNotification": Generated.CancelledNotificationParams,
  "ProgressNotification": Generated.ProgressNotificationParams,
  "InitializedNotification": Generated.NotificationParams,
  "RootsListChangedNotification": Generated.NotificationParams,
  "TaskStatusNotification": Generated.TaskStatusNotificationParams
} as const
export const CLIENT_NOTIFICATION_PARAMS_CODEC_BY_METHOD = {
  "notifications/cancelled": Generated.CancelledNotificationParams,
  "notifications/progress": Generated.ProgressNotificationParams,
  "notifications/initialized": Generated.NotificationParams,
  "notifications/roots/list_changed": Generated.NotificationParams,
  "notifications/tasks/status": Generated.TaskStatusNotificationParams
} as const
export const CLIENT_NOTIFICATION_PAYLOAD_CODEC_BY_TYPE = {
  "CancelledNotification": Generated.CancelledNotificationParams,
  "ProgressNotification": Generated.ProgressNotificationParams,
  "InitializedNotification": Schema.UndefinedOr(Generated.NotificationParams),
  "RootsListChangedNotification": Schema.UndefinedOr(Generated.NotificationParams),
  "TaskStatusNotification": Generated.TaskStatusNotificationParams
} as const
export const CLIENT_NOTIFICATION_PAYLOAD_CODEC_BY_METHOD = {
  "notifications/cancelled": CLIENT_NOTIFICATION_PAYLOAD_CODEC_BY_TYPE["CancelledNotification"],
  "notifications/progress": CLIENT_NOTIFICATION_PAYLOAD_CODEC_BY_TYPE["ProgressNotification"],
  "notifications/initialized": CLIENT_NOTIFICATION_PAYLOAD_CODEC_BY_TYPE["InitializedNotification"],
  "notifications/roots/list_changed": CLIENT_NOTIFICATION_PAYLOAD_CODEC_BY_TYPE["RootsListChangedNotification"],
  "notifications/tasks/status": CLIENT_NOTIFICATION_PAYLOAD_CODEC_BY_TYPE["TaskStatusNotification"]
} as const

export const SERVER_REQUEST_DESCRIPTOR_BY_TYPE = {
  "PingRequest": SERVER_REQUEST_DESCRIPTORS[0],
  "CreateMessageRequest": SERVER_REQUEST_DESCRIPTORS[1],
  "ListRootsRequest": SERVER_REQUEST_DESCRIPTORS[2],
  "ElicitRequest": SERVER_REQUEST_DESCRIPTORS[3],
  "GetTaskRequest": SERVER_REQUEST_DESCRIPTORS[4],
  "GetTaskPayloadRequest": SERVER_REQUEST_DESCRIPTORS[5],
  "ListTasksRequest": SERVER_REQUEST_DESCRIPTORS[6],
  "CancelTaskRequest": SERVER_REQUEST_DESCRIPTORS[7]
} as const
export const SERVER_REQUEST_DESCRIPTOR_BY_METHOD = {
  "ping": SERVER_REQUEST_DESCRIPTORS[0],
  "sampling/createMessage": SERVER_REQUEST_DESCRIPTORS[1],
  "roots/list": SERVER_REQUEST_DESCRIPTORS[2],
  "elicitation/create": SERVER_REQUEST_DESCRIPTORS[3],
  "tasks/get": SERVER_REQUEST_DESCRIPTORS[4],
  "tasks/result": SERVER_REQUEST_DESCRIPTORS[5],
  "tasks/list": SERVER_REQUEST_DESCRIPTORS[6],
  "tasks/cancel": SERVER_REQUEST_DESCRIPTORS[7]
} as const
export const SERVER_REQUEST_CODEC_BY_TYPE = {
  "PingRequest": Generated.PingRequest,
  "CreateMessageRequest": Generated.CreateMessageRequest,
  "ListRootsRequest": Generated.ListRootsRequest,
  "ElicitRequest": Generated.ElicitRequest,
  "GetTaskRequest": Generated.GetTaskRequest,
  "GetTaskPayloadRequest": Generated.GetTaskPayloadRequest,
  "ListTasksRequest": Generated.ListTasksRequest,
  "CancelTaskRequest": Generated.CancelTaskRequest
} as const
export const SERVER_REQUEST_CODEC_BY_METHOD = {
  "ping": Generated.PingRequest,
  "sampling/createMessage": Generated.CreateMessageRequest,
  "roots/list": Generated.ListRootsRequest,
  "elicitation/create": Generated.ElicitRequest,
  "tasks/get": Generated.GetTaskRequest,
  "tasks/result": Generated.GetTaskPayloadRequest,
  "tasks/list": Generated.ListTasksRequest,
  "tasks/cancel": Generated.CancelTaskRequest
} as const
export const SERVER_REQUEST_PARAMS_CODEC_BY_TYPE = {
  "PingRequest": Generated.RequestParams,
  "CreateMessageRequest": Generated.CreateMessageRequestParams,
  "ListRootsRequest": Generated.RequestParams,
  "ElicitRequest": Generated.ElicitRequestParams,
  "GetTaskRequest": Generated.GetTaskRequestParams,
  "GetTaskPayloadRequest": Generated.GetTaskPayloadRequestParams,
  "ListTasksRequest": Generated.PaginatedRequestParams,
  "CancelTaskRequest": Generated.CancelTaskRequestParams
} as const
export const SERVER_REQUEST_PARAMS_CODEC_BY_METHOD = {
  "ping": Generated.RequestParams,
  "sampling/createMessage": Generated.CreateMessageRequestParams,
  "roots/list": Generated.RequestParams,
  "elicitation/create": Generated.ElicitRequestParams,
  "tasks/get": Generated.GetTaskRequestParams,
  "tasks/result": Generated.GetTaskPayloadRequestParams,
  "tasks/list": Generated.PaginatedRequestParams,
  "tasks/cancel": Generated.CancelTaskRequestParams
} as const
export const SERVER_REQUEST_PAYLOAD_CODEC_BY_TYPE = {
  "PingRequest": Schema.UndefinedOr(Generated.RequestParams),
  "CreateMessageRequest": Generated.CreateMessageRequestParams,
  "ListRootsRequest": Schema.UndefinedOr(Generated.RequestParams),
  "ElicitRequest": Generated.ElicitRequestParams,
  "GetTaskRequest": Generated.GetTaskRequestParams,
  "GetTaskPayloadRequest": Generated.GetTaskPayloadRequestParams,
  "ListTasksRequest": Schema.UndefinedOr(Generated.PaginatedRequestParams),
  "CancelTaskRequest": Generated.CancelTaskRequestParams
} as const
export const SERVER_REQUEST_PAYLOAD_CODEC_BY_METHOD = {
  "ping": SERVER_REQUEST_PAYLOAD_CODEC_BY_TYPE["PingRequest"],
  "sampling/createMessage": SERVER_REQUEST_PAYLOAD_CODEC_BY_TYPE["CreateMessageRequest"],
  "roots/list": SERVER_REQUEST_PAYLOAD_CODEC_BY_TYPE["ListRootsRequest"],
  "elicitation/create": SERVER_REQUEST_PAYLOAD_CODEC_BY_TYPE["ElicitRequest"],
  "tasks/get": SERVER_REQUEST_PAYLOAD_CODEC_BY_TYPE["GetTaskRequest"],
  "tasks/result": SERVER_REQUEST_PAYLOAD_CODEC_BY_TYPE["GetTaskPayloadRequest"],
  "tasks/list": SERVER_REQUEST_PAYLOAD_CODEC_BY_TYPE["ListTasksRequest"],
  "tasks/cancel": SERVER_REQUEST_PAYLOAD_CODEC_BY_TYPE["CancelTaskRequest"]
} as const
export const SERVER_REQUEST_RESULT_CODEC_BY_TYPE = {
  "PingRequest": Generated.EmptyResult,
  "CreateMessageRequest": Generated.CreateMessageResult,
  "ListRootsRequest": Generated.ListRootsResult,
  "ElicitRequest": Generated.ElicitResult,
  "GetTaskRequest": Generated.GetTaskResult,
  "GetTaskPayloadRequest": Generated.GetTaskPayloadResult,
  "ListTasksRequest": Generated.ListTasksResult,
  "CancelTaskRequest": Generated.CancelTaskResult
} as const
export const SERVER_REQUEST_RESULT_CODEC_BY_METHOD = {
  "ping": Generated.EmptyResult,
  "sampling/createMessage": Generated.CreateMessageResult,
  "roots/list": Generated.ListRootsResult,
  "elicitation/create": Generated.ElicitResult,
  "tasks/get": Generated.GetTaskResult,
  "tasks/result": Generated.GetTaskPayloadResult,
  "tasks/list": Generated.ListTasksResult,
  "tasks/cancel": Generated.CancelTaskResult
} as const

export const SERVER_NOTIFICATION_DESCRIPTOR_BY_TYPE = {
  "CancelledNotification": SERVER_NOTIFICATION_DESCRIPTORS[0],
  "ProgressNotification": SERVER_NOTIFICATION_DESCRIPTORS[1],
  "LoggingMessageNotification": SERVER_NOTIFICATION_DESCRIPTORS[2],
  "ResourceUpdatedNotification": SERVER_NOTIFICATION_DESCRIPTORS[3],
  "ResourceListChangedNotification": SERVER_NOTIFICATION_DESCRIPTORS[4],
  "ToolListChangedNotification": SERVER_NOTIFICATION_DESCRIPTORS[5],
  "PromptListChangedNotification": SERVER_NOTIFICATION_DESCRIPTORS[6],
  "ElicitationCompleteNotification": SERVER_NOTIFICATION_DESCRIPTORS[7],
  "TaskStatusNotification": SERVER_NOTIFICATION_DESCRIPTORS[8]
} as const
export const SERVER_NOTIFICATION_DESCRIPTOR_BY_METHOD = {
  "notifications/cancelled": SERVER_NOTIFICATION_DESCRIPTORS[0],
  "notifications/progress": SERVER_NOTIFICATION_DESCRIPTORS[1],
  "notifications/message": SERVER_NOTIFICATION_DESCRIPTORS[2],
  "notifications/resources/updated": SERVER_NOTIFICATION_DESCRIPTORS[3],
  "notifications/resources/list_changed": SERVER_NOTIFICATION_DESCRIPTORS[4],
  "notifications/tools/list_changed": SERVER_NOTIFICATION_DESCRIPTORS[5],
  "notifications/prompts/list_changed": SERVER_NOTIFICATION_DESCRIPTORS[6],
  "notifications/elicitation/complete": SERVER_NOTIFICATION_DESCRIPTORS[7],
  "notifications/tasks/status": SERVER_NOTIFICATION_DESCRIPTORS[8]
} as const
export const SERVER_NOTIFICATION_CODEC_BY_TYPE = {
  "CancelledNotification": Generated.CancelledNotification,
  "ProgressNotification": Generated.ProgressNotification,
  "LoggingMessageNotification": Generated.LoggingMessageNotification,
  "ResourceUpdatedNotification": Generated.ResourceUpdatedNotification,
  "ResourceListChangedNotification": Generated.ResourceListChangedNotification,
  "ToolListChangedNotification": Generated.ToolListChangedNotification,
  "PromptListChangedNotification": Generated.PromptListChangedNotification,
  "ElicitationCompleteNotification": Generated.ElicitationCompleteNotification,
  "TaskStatusNotification": Generated.TaskStatusNotification
} as const
export const SERVER_NOTIFICATION_CODEC_BY_METHOD = {
  "notifications/cancelled": Generated.CancelledNotification,
  "notifications/progress": Generated.ProgressNotification,
  "notifications/message": Generated.LoggingMessageNotification,
  "notifications/resources/updated": Generated.ResourceUpdatedNotification,
  "notifications/resources/list_changed": Generated.ResourceListChangedNotification,
  "notifications/tools/list_changed": Generated.ToolListChangedNotification,
  "notifications/prompts/list_changed": Generated.PromptListChangedNotification,
  "notifications/elicitation/complete": Generated.ElicitationCompleteNotification,
  "notifications/tasks/status": Generated.TaskStatusNotification
} as const
export const SERVER_NOTIFICATION_PARAMS_CODEC_BY_TYPE = {
  "CancelledNotification": Generated.CancelledNotificationParams,
  "ProgressNotification": Generated.ProgressNotificationParams,
  "LoggingMessageNotification": Generated.LoggingMessageNotificationParams,
  "ResourceUpdatedNotification": Generated.ResourceUpdatedNotificationParams,
  "ResourceListChangedNotification": Generated.NotificationParams,
  "ToolListChangedNotification": Generated.NotificationParams,
  "PromptListChangedNotification": Generated.NotificationParams,
  "ElicitationCompleteNotification": Generated.ElicitationCompleteNotificationParams,
  "TaskStatusNotification": Generated.TaskStatusNotificationParams
} as const
export const SERVER_NOTIFICATION_PARAMS_CODEC_BY_METHOD = {
  "notifications/cancelled": Generated.CancelledNotificationParams,
  "notifications/progress": Generated.ProgressNotificationParams,
  "notifications/message": Generated.LoggingMessageNotificationParams,
  "notifications/resources/updated": Generated.ResourceUpdatedNotificationParams,
  "notifications/resources/list_changed": Generated.NotificationParams,
  "notifications/tools/list_changed": Generated.NotificationParams,
  "notifications/prompts/list_changed": Generated.NotificationParams,
  "notifications/elicitation/complete": Generated.ElicitationCompleteNotificationParams,
  "notifications/tasks/status": Generated.TaskStatusNotificationParams
} as const
export const SERVER_NOTIFICATION_PAYLOAD_CODEC_BY_TYPE = {
  "CancelledNotification": Generated.CancelledNotificationParams,
  "ProgressNotification": Generated.ProgressNotificationParams,
  "LoggingMessageNotification": Generated.LoggingMessageNotificationParams,
  "ResourceUpdatedNotification": Generated.ResourceUpdatedNotificationParams,
  "ResourceListChangedNotification": Schema.UndefinedOr(Generated.NotificationParams),
  "ToolListChangedNotification": Schema.UndefinedOr(Generated.NotificationParams),
  "PromptListChangedNotification": Schema.UndefinedOr(Generated.NotificationParams),
  "ElicitationCompleteNotification": Generated.ElicitationCompleteNotificationParams,
  "TaskStatusNotification": Generated.TaskStatusNotificationParams
} as const
export const SERVER_NOTIFICATION_PAYLOAD_CODEC_BY_METHOD = {
  "notifications/cancelled": SERVER_NOTIFICATION_PAYLOAD_CODEC_BY_TYPE["CancelledNotification"],
  "notifications/progress": SERVER_NOTIFICATION_PAYLOAD_CODEC_BY_TYPE["ProgressNotification"],
  "notifications/message": SERVER_NOTIFICATION_PAYLOAD_CODEC_BY_TYPE["LoggingMessageNotification"],
  "notifications/resources/updated": SERVER_NOTIFICATION_PAYLOAD_CODEC_BY_TYPE["ResourceUpdatedNotification"],
  "notifications/resources/list_changed": SERVER_NOTIFICATION_PAYLOAD_CODEC_BY_TYPE["ResourceListChangedNotification"],
  "notifications/tools/list_changed": SERVER_NOTIFICATION_PAYLOAD_CODEC_BY_TYPE["ToolListChangedNotification"],
  "notifications/prompts/list_changed": SERVER_NOTIFICATION_PAYLOAD_CODEC_BY_TYPE["PromptListChangedNotification"],
  "notifications/elicitation/complete": SERVER_NOTIFICATION_PAYLOAD_CODEC_BY_TYPE["ElicitationCompleteNotification"],
  "notifications/tasks/status": SERVER_NOTIFICATION_PAYLOAD_CODEC_BY_TYPE["TaskStatusNotification"]
} as const

export const CLIENT_REQUEST_CODEC = Generated.ClientRequest
export const CLIENT_NOTIFICATION_CODEC = Generated.ClientNotification
export const SERVER_NOTIFICATION_CODEC = Generated.ServerNotification
export const JSONRPC_REQUEST_CODEC = Generated.JSONRPCRequest
export const JSONRPC_NOTIFICATION_CODEC = Generated.JSONRPCNotification
export const JSONRPC_RESULT_RESPONSE_CODEC = Generated.JSONRPCResultResponse
export const JSONRPC_ERROR_RESPONSE_CODEC = Generated.JSONRPCErrorResponse
export const JSONRPC_RESPONSE_CODEC = Generated.JSONRPCResponse
export const JSONRPC_MESSAGE_CODEC = Generated.JSONRPCMessage

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
