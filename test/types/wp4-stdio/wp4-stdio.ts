import { Effect, Layer, Queue, Scope, Stream } from "effect"
import {
  McpClientProtocol,
  McpDispatcher,
  McpServer,
  McpWire,
  StdioClientTransport,
  StdioServerTransport,
  StdioTransport
} from "../../../src/index.js"

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
  StdioClientTransport.StdioClient,
  StdioTransport.StdioTransportError,
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
    McpDispatcher.InvalidRequest | McpDispatcher.RequestCancelledError | McpDispatcher.TransportError
  > = client.request({
    _tag: "Request",
    jsonrpc: "2.0",
    id: "exact-id",
    method: "tools/list",
    params: {}
  })
  const notifications: Queue.Dequeue<McpWire.JsonRpcNotification> = client.notifications
  const closed: Effect.Effect<StdioTransport.StdioTransportClose> = client.closed
  yield* client.sendNotification({
    _tag: "Notification",
    jsonrpc: "2.0",
    method: "notifications/cancelled",
    params: { requestId: "exact-id" }
  })
  yield* client.cancel("exact-id", "operator stopped")
  return { frames, notifications, closed }
})

const compatibility: Effect.Effect<
  McpClientProtocol.McpClientProtocol,
  StdioTransport.StdioTransportError,
  Scope.Scope
> = StdioClientTransport.makeCompatibilityProtocol({
  command: process.execPath,
  args: []
})

const serverRun: Effect.Effect<
  void,
  StdioTransport.StdioTransportError,
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
void compatibility
void serverRun
void serverLayer
