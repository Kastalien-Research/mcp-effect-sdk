import { Effect, Layer, Scope, Stream } from "effect"
import {
  McpDispatcher,
  McpServer,
  McpTransport,
  McpWire,
  StdioClientTransport,
  StdioServerTransport
} from "../../../src/index.js"
import * as StdioTransport from "../../../src/transport/StdioTransport.js"

const chunks: Stream.Stream<Uint8Array> = Stream.fromIterable([])
const decoded: Stream.Stream<
  McpWire.JsonRpcMessage,
  StdioTransport.StdioTransportError
> = StdioTransport.decode(chunks, { maxLineBytes: 1024 })

const writerProgram: Effect.Effect<
  StdioTransport.StdioWriter,
  never,
  Scope.Scope
> = StdioTransport.makeWriter({ write: () => Effect.void })

const clientProgram: Effect.Effect<
  McpTransport.McpTransport<StdioClientTransport.StdioClientTransportError>,
  StdioClientTransport.StdioClientTransportError,
  Scope.Scope
> = StdioClientTransport.make({
  command: process.execPath,
  args: [],
  maxLineBytes: 1024,
  stderrSink: (_chunk: Uint8Array) => Effect.void,
  gracefulShutdownTimeoutMs: 100,
  forceKillTimeoutMs: 100
})

const useClient = Effect.gen(function*() {
  const client = yield* clientProgram
  const frames: Stream.Stream<
    McpDispatcher.ClientFrame,
    StdioClientTransport.StdioClientTransportError
  > = client.request({
    _tag: "Request",
    jsonrpc: "2.0",
    id: "exact-id",
    method: "tools/list",
    params: {}
  })
  return frames
})

const serverRun: Effect.Effect<
  void,
  StdioServerTransport.StdioServerTransportError,
  Scope.Scope | McpServer.McpServer
> = StdioServerTransport.run()

const serverLayer: Layer.Layer<
  McpServer.McpServer,
  never
> = StdioServerTransport.layer({
  name: "typed-stdio",
  version: "1.0.0"
})

void decoded
void writerProgram
void useClient
void serverRun
void serverLayer
