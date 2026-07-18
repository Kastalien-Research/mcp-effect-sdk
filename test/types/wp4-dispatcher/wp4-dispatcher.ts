import { Cause, Context, Effect, Queue, Scope, Stream } from "effect"
import { McpDispatcher, McpWire } from "../../../src/index.js"

const request: McpWire.JsonRpcRequest = {
  _tag: "Request",
  jsonrpc: "2.0",
  id: "001",
  method: "tools/list",
  params: {}
}

const clientProgram: Effect.Effect<
  McpDispatcher.ClientDispatcher,
  never,
  Scope.Scope
> = McpDispatcher.makeClientDispatcher({
  send: (_message) => Effect.void
})

const useClient = Effect.gen(function*() {
  const client = yield* clientProgram
  const responses: Stream.Stream<
    McpDispatcher.ClientFrame,
    McpWire.InvalidRequest | McpWire.TransportError | McpWire.RequestCancelledError
  > = client.request(request)
  const notifications: Queue.Dequeue<McpWire.JsonRpcNotification> = client.notifications
  yield* client.accept({
    _tag: "Notification",
    jsonrpc: "2.0",
    method: "notifications/message",
    params: {}
  }, { ownerId: "001" })
  yield* client.cancel("001", "operator stopped")
  yield* client.close()
  return { responses, notifications }
})

const Annotation = Context.GenericTag<string>("test/DispatcherAnnotation")
const annotations = Context.make(Annotation, "request-one")

const serverProgram: Effect.Effect<
  McpDispatcher.ServerDispatcher,
  never,
  Scope.Scope
> = McpDispatcher.makeServerDispatcher({
  send: (_message) => Effect.void,
  handle: (_request) => Effect.succeed({ resultType: "complete" })
})

const useServer = Effect.gen(function*() {
  const server = yield* serverProgram
  const failures: Queue.Dequeue<McpDispatcher.ServerDispatchFailure> = server.failures
  const dispatchFailure = yield* Queue.take(failures)
  const cause: Cause.Cause<unknown> = dispatchFailure.cause
  yield* server.accept(request, {
    authorizationPrincipal: { subject: "alice" },
    annotations
  })
  const context = yield* McpDispatcher.McpRequestContext
  const id: McpWire.JsonRpcId = context.id
  const cancelled: Effect.Effect<void> = context.cancelled
  const isCancelled: Effect.Effect<boolean> = context.isCancelled
  return { id, cancelled, isCancelled, failures, cause, useClient }
})

void useServer

// @ts-expect-error JSON-RPC IDs cannot be null.
const invalidId: McpWire.JsonRpcId = null

// @ts-expect-error Dispatcher requests require an exact JsonRpcId.
clientProgram.pipe(Effect.flatMap((client) => client.request({ ...request, id: 1.5 })))

void invalidId
