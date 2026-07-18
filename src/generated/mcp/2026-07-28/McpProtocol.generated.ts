/**
 * Generated from vendored modelcontextprotocol schema.ts for MCP draft 2026-07-28.
 * Do not edit manually.
 */

import * as Schema from "effect/Schema"
import * as Generated from "./McpSchema.generated.js"

export const LATEST_PROTOCOL_VERSION = "2026-07-28" as const

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
    "type": "DiscoverRequest",
    "method": "server/discover",
    "paramsType": "RequestParams",
    "paramsOptional": false,
    "direction": "client-to-server",
    "http": {
      "methodHeader": "server/discover",
      "nameSource": null
    },
    "resultType": "DiscoverResult"
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
    "paramsOptional": false,
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
    "paramsOptional": false,
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
    "paramsOptional": false,
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
    "type": "SubscriptionsListenRequest",
    "method": "subscriptions/listen",
    "paramsType": "SubscriptionsListenRequestParams",
    "paramsOptional": false,
    "direction": "client-to-server",
    "http": {
      "methodHeader": "subscriptions/listen",
      "nameSource": null
    },
    "resultType": "SubscriptionsListenResult"
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
    "paramsOptional": false,
    "direction": "client-to-server",
    "http": {
      "methodHeader": "tools/list",
      "nameSource": null
    },
    "resultType": "ListToolsResult"
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
  }
] as const
export type ClientNotificationDescriptor = typeof CLIENT_NOTIFICATION_DESCRIPTORS[number]
export type ClientNotificationType = ClientNotificationDescriptor["type"]
export type ClientNotificationMethod = ClientNotificationDescriptor["method"]

export const SERVER_REQUEST_DESCRIPTORS = [] as const
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
    "type": "SubscriptionsAcknowledgedNotification",
    "method": "notifications/subscriptions/acknowledged",
    "paramsType": "SubscriptionsAcknowledgedNotificationParams",
    "paramsOptional": false,
    "direction": "server-to-client",
    "http": {
      "methodHeader": "notifications/subscriptions/acknowledged",
      "nameSource": null
    }
  }
] as const
export type ServerNotificationDescriptor = typeof SERVER_NOTIFICATION_DESCRIPTORS[number]
export type ServerNotificationType = ServerNotificationDescriptor["type"]
export type ServerNotificationMethod = ServerNotificationDescriptor["method"]

export const CLIENT_REQUEST_TYPES = [
  "DiscoverRequest",
  "CompleteRequest",
  "GetPromptRequest",
  "ListPromptsRequest",
  "ListResourcesRequest",
  "ListResourceTemplatesRequest",
  "ReadResourceRequest",
  "SubscriptionsListenRequest",
  "CallToolRequest",
  "ListToolsRequest"
] as const
export const CLIENT_NOTIFICATION_TYPES = [
  "CancelledNotification"
] as const
export const SERVER_REQUEST_TYPES = [] as const
export const SERVER_NOTIFICATION_TYPES = [
  "CancelledNotification",
  "ProgressNotification",
  "LoggingMessageNotification",
  "ResourceUpdatedNotification",
  "ResourceListChangedNotification",
  "ToolListChangedNotification",
  "PromptListChangedNotification",
  "SubscriptionsAcknowledgedNotification"
] as const

export const CLIENT_REQUEST_METHODS = [
  "server/discover",
  "completion/complete",
  "prompts/get",
  "prompts/list",
  "resources/list",
  "resources/templates/list",
  "resources/read",
  "subscriptions/listen",
  "tools/call",
  "tools/list"
] as const
export const CLIENT_NOTIFICATION_METHODS = [
  "notifications/cancelled"
] as const
export const SERVER_REQUEST_METHODS = [] as const
export const SERVER_NOTIFICATION_METHODS = [
  "notifications/cancelled",
  "notifications/progress",
  "notifications/message",
  "notifications/resources/updated",
  "notifications/resources/list_changed",
  "notifications/tools/list_changed",
  "notifications/prompts/list_changed",
  "notifications/subscriptions/acknowledged"
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
  "DiscoverRequest": CLIENT_REQUEST_DESCRIPTORS[0],
  "CompleteRequest": CLIENT_REQUEST_DESCRIPTORS[1],
  "GetPromptRequest": CLIENT_REQUEST_DESCRIPTORS[2],
  "ListPromptsRequest": CLIENT_REQUEST_DESCRIPTORS[3],
  "ListResourcesRequest": CLIENT_REQUEST_DESCRIPTORS[4],
  "ListResourceTemplatesRequest": CLIENT_REQUEST_DESCRIPTORS[5],
  "ReadResourceRequest": CLIENT_REQUEST_DESCRIPTORS[6],
  "SubscriptionsListenRequest": CLIENT_REQUEST_DESCRIPTORS[7],
  "CallToolRequest": CLIENT_REQUEST_DESCRIPTORS[8],
  "ListToolsRequest": CLIENT_REQUEST_DESCRIPTORS[9]
} as const
export const CLIENT_REQUEST_DESCRIPTOR_BY_METHOD = {
  "server/discover": CLIENT_REQUEST_DESCRIPTORS[0],
  "completion/complete": CLIENT_REQUEST_DESCRIPTORS[1],
  "prompts/get": CLIENT_REQUEST_DESCRIPTORS[2],
  "prompts/list": CLIENT_REQUEST_DESCRIPTORS[3],
  "resources/list": CLIENT_REQUEST_DESCRIPTORS[4],
  "resources/templates/list": CLIENT_REQUEST_DESCRIPTORS[5],
  "resources/read": CLIENT_REQUEST_DESCRIPTORS[6],
  "subscriptions/listen": CLIENT_REQUEST_DESCRIPTORS[7],
  "tools/call": CLIENT_REQUEST_DESCRIPTORS[8],
  "tools/list": CLIENT_REQUEST_DESCRIPTORS[9]
} as const
export const CLIENT_REQUEST_CODEC_BY_TYPE = {
  "DiscoverRequest": Generated.DiscoverRequest,
  "CompleteRequest": Generated.CompleteRequest,
  "GetPromptRequest": Generated.GetPromptRequest,
  "ListPromptsRequest": Generated.ListPromptsRequest,
  "ListResourcesRequest": Generated.ListResourcesRequest,
  "ListResourceTemplatesRequest": Generated.ListResourceTemplatesRequest,
  "ReadResourceRequest": Generated.ReadResourceRequest,
  "SubscriptionsListenRequest": Generated.SubscriptionsListenRequest,
  "CallToolRequest": Generated.CallToolRequest,
  "ListToolsRequest": Generated.ListToolsRequest
} as const
export const CLIENT_REQUEST_CODEC_BY_METHOD = {
  "server/discover": Generated.DiscoverRequest,
  "completion/complete": Generated.CompleteRequest,
  "prompts/get": Generated.GetPromptRequest,
  "prompts/list": Generated.ListPromptsRequest,
  "resources/list": Generated.ListResourcesRequest,
  "resources/templates/list": Generated.ListResourceTemplatesRequest,
  "resources/read": Generated.ReadResourceRequest,
  "subscriptions/listen": Generated.SubscriptionsListenRequest,
  "tools/call": Generated.CallToolRequest,
  "tools/list": Generated.ListToolsRequest
} as const
export const CLIENT_REQUEST_PARAMS_CODEC_BY_TYPE = {
  "DiscoverRequest": Generated.RequestParams,
  "CompleteRequest": Generated.CompleteRequestParams,
  "GetPromptRequest": Generated.GetPromptRequestParams,
  "ListPromptsRequest": Generated.PaginatedRequestParams,
  "ListResourcesRequest": Generated.PaginatedRequestParams,
  "ListResourceTemplatesRequest": Generated.PaginatedRequestParams,
  "ReadResourceRequest": Generated.ReadResourceRequestParams,
  "SubscriptionsListenRequest": Generated.SubscriptionsListenRequestParams,
  "CallToolRequest": Generated.CallToolRequestParams,
  "ListToolsRequest": Generated.PaginatedRequestParams
} as const
export const CLIENT_REQUEST_PARAMS_CODEC_BY_METHOD = {
  "server/discover": Generated.RequestParams,
  "completion/complete": Generated.CompleteRequestParams,
  "prompts/get": Generated.GetPromptRequestParams,
  "prompts/list": Generated.PaginatedRequestParams,
  "resources/list": Generated.PaginatedRequestParams,
  "resources/templates/list": Generated.PaginatedRequestParams,
  "resources/read": Generated.ReadResourceRequestParams,
  "subscriptions/listen": Generated.SubscriptionsListenRequestParams,
  "tools/call": Generated.CallToolRequestParams,
  "tools/list": Generated.PaginatedRequestParams
} as const
export const CLIENT_REQUEST_PAYLOAD_CODEC_BY_TYPE = {
  "DiscoverRequest": Generated.RequestParams,
  "CompleteRequest": Generated.CompleteRequestParams,
  "GetPromptRequest": Generated.GetPromptRequestParams,
  "ListPromptsRequest": Generated.PaginatedRequestParams,
  "ListResourcesRequest": Generated.PaginatedRequestParams,
  "ListResourceTemplatesRequest": Generated.PaginatedRequestParams,
  "ReadResourceRequest": Generated.ReadResourceRequestParams,
  "SubscriptionsListenRequest": Generated.SubscriptionsListenRequestParams,
  "CallToolRequest": Generated.CallToolRequestParams,
  "ListToolsRequest": Generated.PaginatedRequestParams
} as const
export const CLIENT_REQUEST_PAYLOAD_CODEC_BY_METHOD = {
  "server/discover": Generated.RequestParams,
  "completion/complete": Generated.CompleteRequestParams,
  "prompts/get": Generated.GetPromptRequestParams,
  "prompts/list": Generated.PaginatedRequestParams,
  "resources/list": Generated.PaginatedRequestParams,
  "resources/templates/list": Generated.PaginatedRequestParams,
  "resources/read": Generated.ReadResourceRequestParams,
  "subscriptions/listen": Generated.SubscriptionsListenRequestParams,
  "tools/call": Generated.CallToolRequestParams,
  "tools/list": Generated.PaginatedRequestParams
} as const
export const CLIENT_REQUEST_RESULT_CODEC_BY_TYPE = {
  "DiscoverRequest": Generated.DiscoverResult,
  "CompleteRequest": Generated.CompleteResult,
  "GetPromptRequest": Generated.GetPromptResult,
  "ListPromptsRequest": Generated.ListPromptsResult,
  "ListResourcesRequest": Generated.ListResourcesResult,
  "ListResourceTemplatesRequest": Generated.ListResourceTemplatesResult,
  "ReadResourceRequest": Generated.ReadResourceResult,
  "SubscriptionsListenRequest": Generated.SubscriptionsListenResult,
  "CallToolRequest": Generated.CallToolResult,
  "ListToolsRequest": Generated.ListToolsResult
} as const
export const CLIENT_REQUEST_RESULT_CODEC_BY_METHOD = {
  "server/discover": Generated.DiscoverResult,
  "completion/complete": Generated.CompleteResult,
  "prompts/get": Generated.GetPromptResult,
  "prompts/list": Generated.ListPromptsResult,
  "resources/list": Generated.ListResourcesResult,
  "resources/templates/list": Generated.ListResourceTemplatesResult,
  "resources/read": Generated.ReadResourceResult,
  "subscriptions/listen": Generated.SubscriptionsListenResult,
  "tools/call": Generated.CallToolResult,
  "tools/list": Generated.ListToolsResult
} as const

export const CLIENT_NOTIFICATION_DESCRIPTOR_BY_TYPE = {
  "CancelledNotification": CLIENT_NOTIFICATION_DESCRIPTORS[0]
} as const
export const CLIENT_NOTIFICATION_DESCRIPTOR_BY_METHOD = {
  "notifications/cancelled": CLIENT_NOTIFICATION_DESCRIPTORS[0]
} as const
export const CLIENT_NOTIFICATION_CODEC_BY_TYPE = {
  "CancelledNotification": Generated.CancelledNotification
} as const
export const CLIENT_NOTIFICATION_CODEC_BY_METHOD = {
  "notifications/cancelled": Generated.CancelledNotification
} as const
export const CLIENT_NOTIFICATION_PARAMS_CODEC_BY_TYPE = {
  "CancelledNotification": Generated.CancelledNotificationParams
} as const
export const CLIENT_NOTIFICATION_PARAMS_CODEC_BY_METHOD = {
  "notifications/cancelled": Generated.CancelledNotificationParams
} as const
export const CLIENT_NOTIFICATION_PAYLOAD_CODEC_BY_TYPE = {
  "CancelledNotification": Generated.CancelledNotificationParams
} as const
export const CLIENT_NOTIFICATION_PAYLOAD_CODEC_BY_METHOD = {
  "notifications/cancelled": Generated.CancelledNotificationParams
} as const

export const SERVER_REQUEST_DESCRIPTOR_BY_TYPE = {} as const
export const SERVER_REQUEST_DESCRIPTOR_BY_METHOD = {} as const
export const SERVER_REQUEST_CODEC_BY_TYPE = {} as const
export const SERVER_REQUEST_CODEC_BY_METHOD = {} as const
export const SERVER_REQUEST_PARAMS_CODEC_BY_TYPE = {} as const
export const SERVER_REQUEST_PARAMS_CODEC_BY_METHOD = {} as const
export const SERVER_REQUEST_PAYLOAD_CODEC_BY_TYPE = {} as const
export const SERVER_REQUEST_PAYLOAD_CODEC_BY_METHOD = {} as const
export const SERVER_REQUEST_RESULT_CODEC_BY_TYPE = {} as const
export const SERVER_REQUEST_RESULT_CODEC_BY_METHOD = {} as const

export const SERVER_NOTIFICATION_DESCRIPTOR_BY_TYPE = {
  "CancelledNotification": SERVER_NOTIFICATION_DESCRIPTORS[0],
  "ProgressNotification": SERVER_NOTIFICATION_DESCRIPTORS[1],
  "LoggingMessageNotification": SERVER_NOTIFICATION_DESCRIPTORS[2],
  "ResourceUpdatedNotification": SERVER_NOTIFICATION_DESCRIPTORS[3],
  "ResourceListChangedNotification": SERVER_NOTIFICATION_DESCRIPTORS[4],
  "ToolListChangedNotification": SERVER_NOTIFICATION_DESCRIPTORS[5],
  "PromptListChangedNotification": SERVER_NOTIFICATION_DESCRIPTORS[6],
  "SubscriptionsAcknowledgedNotification": SERVER_NOTIFICATION_DESCRIPTORS[7]
} as const
export const SERVER_NOTIFICATION_DESCRIPTOR_BY_METHOD = {
  "notifications/cancelled": SERVER_NOTIFICATION_DESCRIPTORS[0],
  "notifications/progress": SERVER_NOTIFICATION_DESCRIPTORS[1],
  "notifications/message": SERVER_NOTIFICATION_DESCRIPTORS[2],
  "notifications/resources/updated": SERVER_NOTIFICATION_DESCRIPTORS[3],
  "notifications/resources/list_changed": SERVER_NOTIFICATION_DESCRIPTORS[4],
  "notifications/tools/list_changed": SERVER_NOTIFICATION_DESCRIPTORS[5],
  "notifications/prompts/list_changed": SERVER_NOTIFICATION_DESCRIPTORS[6],
  "notifications/subscriptions/acknowledged": SERVER_NOTIFICATION_DESCRIPTORS[7]
} as const
export const SERVER_NOTIFICATION_CODEC_BY_TYPE = {
  "CancelledNotification": Generated.CancelledNotification,
  "ProgressNotification": Generated.ProgressNotification,
  "LoggingMessageNotification": Generated.LoggingMessageNotification,
  "ResourceUpdatedNotification": Generated.ResourceUpdatedNotification,
  "ResourceListChangedNotification": Generated.ResourceListChangedNotification,
  "ToolListChangedNotification": Generated.ToolListChangedNotification,
  "PromptListChangedNotification": Generated.PromptListChangedNotification,
  "SubscriptionsAcknowledgedNotification": Generated.SubscriptionsAcknowledgedNotification
} as const
export const SERVER_NOTIFICATION_CODEC_BY_METHOD = {
  "notifications/cancelled": Generated.CancelledNotification,
  "notifications/progress": Generated.ProgressNotification,
  "notifications/message": Generated.LoggingMessageNotification,
  "notifications/resources/updated": Generated.ResourceUpdatedNotification,
  "notifications/resources/list_changed": Generated.ResourceListChangedNotification,
  "notifications/tools/list_changed": Generated.ToolListChangedNotification,
  "notifications/prompts/list_changed": Generated.PromptListChangedNotification,
  "notifications/subscriptions/acknowledged": Generated.SubscriptionsAcknowledgedNotification
} as const
export const SERVER_NOTIFICATION_PARAMS_CODEC_BY_TYPE = {
  "CancelledNotification": Generated.CancelledNotificationParams,
  "ProgressNotification": Generated.ProgressNotificationParams,
  "LoggingMessageNotification": Generated.LoggingMessageNotificationParams,
  "ResourceUpdatedNotification": Generated.ResourceUpdatedNotificationParams,
  "ResourceListChangedNotification": Generated.NotificationParams,
  "ToolListChangedNotification": Generated.NotificationParams,
  "PromptListChangedNotification": Generated.NotificationParams,
  "SubscriptionsAcknowledgedNotification": Generated.SubscriptionsAcknowledgedNotificationParams
} as const
export const SERVER_NOTIFICATION_PARAMS_CODEC_BY_METHOD = {
  "notifications/cancelled": Generated.CancelledNotificationParams,
  "notifications/progress": Generated.ProgressNotificationParams,
  "notifications/message": Generated.LoggingMessageNotificationParams,
  "notifications/resources/updated": Generated.ResourceUpdatedNotificationParams,
  "notifications/resources/list_changed": Generated.NotificationParams,
  "notifications/tools/list_changed": Generated.NotificationParams,
  "notifications/prompts/list_changed": Generated.NotificationParams,
  "notifications/subscriptions/acknowledged": Generated.SubscriptionsAcknowledgedNotificationParams
} as const
export const SERVER_NOTIFICATION_PAYLOAD_CODEC_BY_TYPE = {
  "CancelledNotification": Generated.CancelledNotificationParams,
  "ProgressNotification": Generated.ProgressNotificationParams,
  "LoggingMessageNotification": Generated.LoggingMessageNotificationParams,
  "ResourceUpdatedNotification": Generated.ResourceUpdatedNotificationParams,
  "ResourceListChangedNotification": Schema.UndefinedOr(Generated.NotificationParams),
  "ToolListChangedNotification": Schema.UndefinedOr(Generated.NotificationParams),
  "PromptListChangedNotification": Schema.UndefinedOr(Generated.NotificationParams),
  "SubscriptionsAcknowledgedNotification": Generated.SubscriptionsAcknowledgedNotificationParams
} as const
export const SERVER_NOTIFICATION_PAYLOAD_CODEC_BY_METHOD = {
  "notifications/cancelled": Generated.CancelledNotificationParams,
  "notifications/progress": Generated.ProgressNotificationParams,
  "notifications/message": Generated.LoggingMessageNotificationParams,
  "notifications/resources/updated": Generated.ResourceUpdatedNotificationParams,
  "notifications/resources/list_changed": Schema.UndefinedOr(Generated.NotificationParams),
  "notifications/tools/list_changed": Schema.UndefinedOr(Generated.NotificationParams),
  "notifications/prompts/list_changed": Schema.UndefinedOr(Generated.NotificationParams),
  "notifications/subscriptions/acknowledged": Generated.SubscriptionsAcknowledgedNotificationParams
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

export const TASK_REQUEST_METHODS = [] as const
export const TASK_NOTIFICATION_METHODS = [] as const
export const ELICITATION_NOTIFICATION_METHODS = [] as const
