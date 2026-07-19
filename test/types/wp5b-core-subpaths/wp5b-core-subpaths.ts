import { Effect, Layer, Option, Scope, Stream } from "effect"
import * as Root from "mcp-effect-sdk"
import {
  McpClientError,
  make as makeClient,
  serverInfoFromResult,
  type ClientCapabilitiesProvider,
  type ClientExtensionCapabilities,
  type ClientExtensionsProvider,
  type ClientRequestProfileContext,
  type ClientResultForMethod,
  type CoreClientCapabilities,
  type McpClient,
  type McpClientErrorReason,
  type McpClientOptions,
  type McpTransport,
  type SubscriptionFilter
} from "mcp-effect-sdk/client"
import {
  JsonSchemaResolver,
  JsonSchemaValidator,
  McpServer,
  clientCapabilities,
  layer as serverLayer,
  make as makeServer,
  makeDispatcher,
  prompt,
  registerPrompt,
  registerResource,
  registerTool,
  resource,
  sendProgress,
  sendPromptListChanged,
  sendResourceListChanged,
  sendResourceUpdated,
  sendToolListChanged,
  tool,
  type ExtensionCapabilities,
  type McpServerOptions,
  type McpServerService,
  type ServerNotification,
  type ServerScope
} from "mcp-effect-sdk/server"
import {
  FIRST_MODERN_PROTOCOL_VERSION,
  HEADER_MISMATCH_ERROR_CODE,
  MCP_BAGGAGE_META_KEY,
  MCP_CLIENT_CAPABILITIES_META_KEY,
  MCP_CLIENT_INFO_META_KEY,
  MCP_LOG_LEVEL_META_KEY,
  MCP_METHOD_HEADER,
  MCP_NAME_HEADER,
  MCP_PROTOCOL_VERSION_HEADER,
  MCP_PROTOCOL_VERSION_META_KEY,
  MCP_SERVER_INFO_META_KEY,
  MCP_SUBSCRIPTION_ID_META_KEY,
  MCP_TRACEPARENT_META_KEY,
  MCP_TRACESTATE_META_KEY,
  MISSING_REQUIRED_CLIENT_CAPABILITY_ERROR_CODE,
  MODERN_PROTOCOL_VERSION,
  McpErrors,
  McpProtocol,
  McpSchema,
  McpWire,
  SERVER_DISCOVER_METHOD,
  SUBSCRIPTIONS_LISTEN_METHOD,
  UNSUPPORTED_PROTOCOL_VERSION_ERROR_CODE,
  serverInfoFromResult as protocolServerInfoFromResult
} from "mcp-effect-sdk/protocol/2026-07-28"

type Equal<A, B> = (<T>() => T extends A ? 1 : 2) extends
  (<T>() => T extends B ? 1 : 2) ? true : false
type Assert<T extends true> = T

type ClientRuntimeKeys = keyof typeof import("mcp-effect-sdk/client")
type ServerRuntimeKeys = keyof typeof import("mcp-effect-sdk/server")
type ProtocolRuntimeKeys = keyof typeof import("mcp-effect-sdk/protocol/2026-07-28")

type _ExactClientRuntime = Assert<Equal<
  ClientRuntimeKeys,
  "McpClientError" | "make" | "serverInfoFromResult"
>>
type _ExactServerRuntime = Assert<Equal<ServerRuntimeKeys,
  | "JsonSchemaResolver"
  | "JsonSchemaValidator"
  | "McpServer"
  | "clientCapabilities"
  | "layer"
  | "make"
  | "makeDispatcher"
  | "prompt"
  | "registerPrompt"
  | "registerResource"
  | "registerTool"
  | "resource"
  | "sendProgress"
  | "sendPromptListChanged"
  | "sendResourceListChanged"
  | "sendResourceUpdated"
  | "sendToolListChanged"
  | "tool"
>>
type _ExactProtocolRuntime = Assert<Equal<ProtocolRuntimeKeys,
  | "FIRST_MODERN_PROTOCOL_VERSION"
  | "HEADER_MISMATCH_ERROR_CODE"
  | "MCP_BAGGAGE_META_KEY"
  | "MCP_CLIENT_CAPABILITIES_META_KEY"
  | "MCP_CLIENT_INFO_META_KEY"
  | "MCP_LOG_LEVEL_META_KEY"
  | "MCP_METHOD_HEADER"
  | "MCP_NAME_HEADER"
  | "MCP_PROTOCOL_VERSION_HEADER"
  | "MCP_PROTOCOL_VERSION_META_KEY"
  | "MCP_SERVER_INFO_META_KEY"
  | "MCP_SUBSCRIPTION_ID_META_KEY"
  | "MCP_TRACEPARENT_META_KEY"
  | "MCP_TRACESTATE_META_KEY"
  | "MISSING_REQUIRED_CLIENT_CAPABILITY_ERROR_CODE"
  | "MODERN_PROTOCOL_VERSION"
  | "McpErrors"
  | "McpProtocol"
  | "McpSchema"
  | "McpWire"
  | "SERVER_DISCOVER_METHOD"
  | "SUBSCRIPTIONS_LISTEN_METHOD"
  | "UNSUPPORTED_PROTOCOL_VERSION_ERROR_CODE"
  | "serverInfoFromResult"
>>

const transport: McpTransport<never> = {
  request: () => Stream.never
}
const clientOptions: McpClientOptions<never> = { transport }
const clientEffect: Effect.Effect<McpClient, McpClientError, Scope.Scope> = makeClient(clientOptions)
const options: McpServerOptions = {
  serverInfo: { name: "typed-core-subpath", version: "1" },
  handlers: Effect.void
}
const constructed: Effect.Effect<McpServerService, McpErrors.SchemaValidationError> = makeServer(options)
const constructedLayer: Layer.Layer<McpServer, McpErrors.SchemaValidationError> = serverLayer(options)
const profile: ClientRequestProfileContext = { method: "tools/list", id: "id" }
const capabilities: CoreClientCapabilities = {}
const extensions: ClientExtensionCapabilities = { "example.com/demo": {} }
const capabilityProvider: ClientCapabilitiesProvider = () => Effect.succeed(capabilities)
const extensionProvider: ClientExtensionsProvider = () => Effect.succeed(extensions)
const reason: McpClientErrorReason = "Protocol"
const filter: SubscriptionFilter = {}
const result: ClientResultForMethod<"tools/list"> | undefined = undefined
const notification: ServerNotification = { tag: "test", payload: {} }
const serverExtensions: ExtensionCapabilities = { "example.com/demo": {} }

const serverIdentity: Option.Option<McpSchema.Implementation> = serverInfoFromResult({})
const protocolIdentity: Option.Option<McpSchema.Implementation> = protocolServerInfoFromResult({})
const rootClient: typeof import("mcp-effect-sdk/client") = Root.McpClient
const rootServer: typeof import("mcp-effect-sdk/server") = Root.McpServer

void McpServer
void JsonSchemaResolver
void JsonSchemaValidator
void clientCapabilities
void makeDispatcher
void prompt
void registerPrompt
void registerResource
void registerTool
void resource
void sendProgress
void sendPromptListChanged
void sendResourceListChanged
void sendResourceUpdated
void sendToolListChanged
void tool
void McpProtocol
void McpWire
void MODERN_PROTOCOL_VERSION
void FIRST_MODERN_PROTOCOL_VERSION
void MCP_PROTOCOL_VERSION_META_KEY
void MCP_CLIENT_INFO_META_KEY
void MCP_CLIENT_CAPABILITIES_META_KEY
void MCP_LOG_LEVEL_META_KEY
void MCP_SUBSCRIPTION_ID_META_KEY
void MCP_TRACEPARENT_META_KEY
void MCP_TRACESTATE_META_KEY
void MCP_BAGGAGE_META_KEY
void MCP_SERVER_INFO_META_KEY
void MCP_PROTOCOL_VERSION_HEADER
void MCP_METHOD_HEADER
void MCP_NAME_HEADER
void SERVER_DISCOVER_METHOD
void SUBSCRIPTIONS_LISTEN_METHOD
void HEADER_MISMATCH_ERROR_CODE
void MISSING_REQUIRED_CLIENT_CAPABILITY_ERROR_CODE
void UNSUPPORTED_PROTOCOL_VERSION_ERROR_CODE
void clientEffect
void constructed
void constructedLayer
void profile
void capabilityProvider
void extensionProvider
void reason
void filter
void result
void notification
void serverExtensions
void serverIdentity
void protocolIdentity
void rootClient
void rootServer
void (null as unknown as _ExactClientRuntime)
void (null as unknown as _ExactServerRuntime)
void (null as unknown as _ExactProtocolRuntime)

// @ts-expect-error the client barrel does not expose raw dispatcher internals
type _NoClientDispatcher = typeof import("mcp-effect-sdk/client").McpDispatcher
// @ts-expect-error the server barrel does not expose raw dispatch
type _NoRawServerDispatch = typeof import("mcp-effect-sdk/server").dispatch
// @ts-expect-error the revisioned protocol barrel does not expose handwritten compatibility result types
type _NoCompatibilityResult = import("mcp-effect-sdk/protocol/2026-07-28").ModernResult
