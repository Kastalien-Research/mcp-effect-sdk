import { Effect } from "effect"
import * as Root from "../../../src/index.js"
import * as Http from "mcp-effect-sdk/transport/http"
import * as Stdio from "mcp-effect-sdk/transport/stdio"
import {
  ElicitationHandler,
  RootsProvider,
  SamplingHandler,
  sendLoggingMessage
} from "../../../src/deprecated.js"

type AssertFalse<Value extends false> = Value
type Has<Name extends PropertyKey> = Name extends keyof typeof Root ? true : false

type _NoHttp = AssertFalse<Has<"HttpTransport">>
type _NoStdioKernel = AssertFalse<Has<"StdioTransport">>
type _NoSse = AssertFalse<Has<"SseClientTransport">>
type _NoWebSocket = AssertFalse<Has<"WebSocketClientTransport">>
type _NoProtocol = AssertFalse<Has<"McpClientProtocol">>
type _NoSamplingRoot = AssertFalse<Has<"SamplingHandler">>
type _NoElicitationRoot = AssertFalse<Has<"ElicitationHandler">>
type _NoRootsRoot = AssertFalse<Has<"RootsProvider">>

const client: Root.McpSchema.McpServerClientService = {
  clientId: "request-id",
  requestContext: {
    protocolVersion: "2026-07-28",
    capabilities: {},
    clientInfo: { name: "fixture", version: "1.0.0" }
  }
}

const logging: Effect.Effect<void, never, Root.McpServer.McpServer> = sendLoggingMessage({
  level: "info",
  logger: "fixture",
  data: "hello"
})

void ElicitationHandler
void RootsProvider
void SamplingHandler
void client
void logging
void Stdio.StdioClientTransport.make
void Stdio.StdioServerTransport.run
void Http.StreamableHttpClientTransport.make
void Http.StreamableHttpServerTransport.toWebHandler
void (null as unknown as _NoHttp)
void (null as unknown as _NoStdioKernel)
void (null as unknown as _NoSse)
void (null as unknown as _NoWebSocket)
void (null as unknown as _NoProtocol)
void (null as unknown as _NoSamplingRoot)
void (null as unknown as _NoElicitationRoot)
void (null as unknown as _NoRootsRoot)
