import type * as Scope from "effect/Scope"
import type * as Stream from "effect/Stream"
import * as Effect from "effect/Effect"
import type { McpWireError, TransportError } from "../../../src/McpErrors.js"
import type { ClientFrame } from "../../../src/McpDispatcher.js"
import type { JsonRpcRequest } from "../../../src/McpWire.js"
import type { McpTransport } from "../../../src/McpTransport.js"
import * as StreamableHttpClientTransport from "../../../src/transport/StreamableHttpClientTransport.js"

declare const request: JsonRpcRequest
declare const transport: McpTransport<McpWireError>

const response: Stream.Stream<ClientFrame, McpWireError> = transport.request(request)
const made: Effect.Effect<
  McpTransport<StreamableHttpClientTransport.StreamableHttpClientTransportError>,
  TransportError,
  Scope.Scope
> = StreamableHttpClientTransport.make({
  url: new URL("https://mcp.example.test/endpoint"),
  headers: { "x-caller": "value" },
  fetch: async () => new Response(null, { status: 204 }),
  warningSink: () => Effect.succeed(undefined),
  maxLineBytes: 1024,
  maxEventBytes: 2048,
  maxJsonBytes: 4096
})

void response
void made
