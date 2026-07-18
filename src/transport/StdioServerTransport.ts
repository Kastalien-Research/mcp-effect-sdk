/** Dispatcher-native MCP stdio server transport. */
import type { Buffer } from "node:buffer"
import * as Effect from "effect/Effect"
import * as Fiber from "effect/Fiber"
import * as Layer from "effect/Layer"
import * as Queue from "effect/Queue"
import * as Scope from "effect/Scope"
import * as Stream from "effect/Stream"
import * as McpServer from "../McpServer.js"
import type {
  JsonRpcId,
  JsonRpcMessage,
  JsonRpcNotification,
  JsonRpcRequest
} from "../McpWire.js"
import {
  CLIENT_NOTIFICATION_METHOD_BY_TYPE,
  CLIENT_REQUEST_METHOD_BY_TYPE,
  SERVER_NOTIFICATION_METHOD_BY_TYPE
} from "../generated/mcp/2026-07-28/McpProtocol.generated.js"
import * as StdioTransport from "./StdioTransport.js"

export interface StdioServerRunOptions extends StdioTransport.StdioFramingOptions {
  readonly input?: Stream.Stream<Uint8Array, unknown>
  readonly write?: (bytes: Uint8Array) => Effect.Effect<void, unknown>
}

export interface StdioServerTransportOptions
  extends McpServer.ServerLayerOptions,
  StdioServerRunOptions {}

type SubscriptionFilter = {
  readonly toolsListChanged?: boolean
  readonly promptsListChanged?: boolean
  readonly resourcesListChanged?: boolean
  readonly resourceSubscriptions?: ReadonlyArray<string>
}

const transportError = (
  stage: StdioTransport.StdioTransportStage,
  message: string,
  cause?: unknown
): StdioTransport.StdioTransportError => new StdioTransport.StdioTransportError({
  stage,
  message,
  ...(cause === undefined ? {} : { cause })
})

const processInput = (): Stream.Stream<Uint8Array, StdioTransport.StdioTransportError> =>
  Stream.asyncPush<Uint8Array, StdioTransport.StdioTransportError>((emit) => {
    const onData = (chunk: Buffer | string) => emit.single(typeof chunk === "string"
      ? new TextEncoder().encode(chunk)
      : new Uint8Array(chunk))
    const onEnd = () => emit.end()
    const onError = (cause: Error) => emit.fail(transportError(
      "Child",
      "Could not read process stdin",
      cause
    ))
    return Effect.acquireRelease(
      Effect.sync(() => {
        process.stdin.on("data", onData)
        process.stdin.once("end", onEnd)
        process.stdin.once("error", onError)
      }),
      () => Effect.sync(() => {
        process.stdin.off("data", onData)
        process.stdin.off("end", onEnd)
        process.stdin.off("error", onError)
      })
    )
  }, { bufferSize: "unbounded" })

const processWrite = (bytes: Uint8Array): Effect.Effect<void, StdioTransport.StdioTransportError> =>
  Effect.async((resume) => {
    try {
      process.stdout.write(bytes, (cause) => resume(cause
        ? Effect.fail(transportError("Write", "Could not write process stdout", cause))
        : Effect.void))
    } catch (cause) {
      resume(Effect.fail(transportError("Write", "Could not write process stdout", cause)))
    }
  })

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value)

const subscriptionFilter = (request: JsonRpcRequest): SubscriptionFilter | undefined => {
  if (request.method !== CLIENT_REQUEST_METHOD_BY_TYPE.SubscriptionsListenRequest ||
    !isRecord(request.params) || !isRecord(request.params["notifications"])) return undefined
  return request.params["notifications"] as SubscriptionFilter
}

const subscriptionAcknowledged = (
  id: JsonRpcId,
  filter: SubscriptionFilter
): JsonRpcNotification => ({
  _tag: "Notification",
  jsonrpc: "2.0",
  method: SERVER_NOTIFICATION_METHOD_BY_TYPE.SubscriptionsAcknowledgedNotification,
  params: {
    notifications: filter,
    _meta: { "io.modelcontextprotocol/subscriptionId": id }
  }
})

const subscriptionNotification = (notification: McpServer.ServerNotification): JsonRpcNotification => ({
  _tag: "Notification",
  jsonrpc: "2.0",
  method: notification.tag,
  params: isRecord(notification.payload) ? notification.payload : {}
})

/** Run one scoped byte-framed stdio server over the shared MCP dispatcher. */
export const run = (
  options: StdioServerRunOptions = {}
): Effect.Effect<
  void,
  StdioTransport.StdioTransportError,
  Scope.Scope | McpServer.McpServer
> => Effect.gen(function*() {
  const server = yield* McpServer.McpServer
  const input = (options.input ?? processInput()).pipe(
    Stream.mapError((cause) => cause instanceof StdioTransport.StdioTransportError
      ? cause
      : transportError("Child", "Stdio input stream failed", cause))
  )
  const writer = yield* StdioTransport.makeWriter({
    write: options.write ?? processWrite
  })
  const dispatcher = yield* McpServer.makeDispatcher({ send: writer.send })
  const transportFailures = yield* Queue.unbounded<StdioTransport.StdioTransportError>()
  const subscriptions = new Map<JsonRpcId, () => void>()

  yield* Effect.addFinalizer(() => Effect.sync(() => {
    for (const close of subscriptions.values()) close()
    subscriptions.clear()
  }))

  const accept = (message: JsonRpcMessage): Effect.Effect<void, StdioTransport.StdioTransportError> => {
    if (message._tag === "SuccessResponse" || message._tag === "ErrorResponse") {
      return Effect.fail(transportError("Protocol", "Server received a JSON-RPC response"))
    }

    if (message._tag === "Request") {
      const filter = subscriptionFilter(message)
      if (filter !== undefined) {
        subscriptions.get(message.id)?.()
        subscriptions.set(message.id, server.openSubscription(
          message.id,
          filter,
          (notification) => writer.send(subscriptionNotification(notification)).pipe(
            Effect.catchAllCause((cause) => Queue.offer(
              transportFailures,
              transportError("Write", "Stdio subscription write failed", cause)
            )),
            Effect.asVoid
          )
        ))
        return writer.send(subscriptionAcknowledged(message.id, filter)).pipe(
          Effect.zipRight(dispatcher.accept(message)),
          Effect.mapError((cause) => cause instanceof StdioTransport.StdioTransportError
            ? cause
            : transportError("Protocol", "Stdio server rejected inbound request", cause))
        )
      }
    }

    if (message._tag === "Notification" &&
      message.method === CLIENT_NOTIFICATION_METHOD_BY_TYPE.CancelledNotification &&
      isRecord(message.params)) {
      const id = message.params["requestId"]
      if (typeof id === "string" || typeof id === "number") {
        subscriptions.get(id)?.()
        subscriptions.delete(id)
      }
    }

    return dispatcher.accept(message).pipe(
      Effect.mapError((cause) => transportError(
        "Protocol",
        "Stdio server rejected inbound message",
        cause
      ))
    )
  }

  const incoming = StdioTransport.decode(input, {
    maxLineBytes: options.maxLineBytes
  }).pipe(Stream.runForEach(accept))
  const terminalFailure = Queue.take(dispatcher.failures).pipe(
    Effect.flatMap((failure) => Effect.fail(transportError(
      "Write",
      "Stdio server terminal write failed",
      failure
    )))
  )
  const transportFailure = Queue.take(transportFailures).pipe(
    Effect.flatMap(Effect.fail)
  )
  yield* Effect.raceFirst(incoming, Effect.raceFirst(terminalFailure, transportFailure))
})

/** Build a server registry layer and run the modern stdio transport in its scope. */
export const layer = (
  options: StdioServerTransportOptions
): Layer.Layer<McpServer.McpServer, StdioTransport.StdioTransportError> =>
  Layer.scoped(McpServer.McpServer, Effect.gen(function*() {
    const server = yield* McpServer.McpServer.makeWithOptions(options)
    const transport = yield* run(options).pipe(
      Effect.provideService(McpServer.McpServer, server),
      Effect.forkScoped
    )
    yield* Effect.addFinalizer(() => Fiber.interrupt(transport).pipe(Effect.asVoid))
    return server
  }))
