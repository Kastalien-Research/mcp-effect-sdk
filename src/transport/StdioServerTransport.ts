/** Dispatcher-native MCP stdio server transport. */
import type { Buffer } from "node:buffer"
import * as Effect from "effect/Effect"
import * as Result from "effect/Result"
import * as Exit from "effect/Exit"
import * as Layer from "effect/Layer"
import * as Queue from "effect/Queue"
import * as Schema from "effect/Schema"
import type * as Scope from "effect/Scope"
import * as Stream from "effect/Stream"
import * as McpServer from "../McpServer.js"
import type {
  JsonRpcId,
  JsonRpcMessage,
  JsonRpcNotification,
  JsonRpcRequest,
  JsonRpcSuccessResponse
} from "../McpWire.js"
import {
  CLIENT_NOTIFICATION_METHOD_BY_TYPE,
  CLIENT_REQUEST_PAYLOAD_CODEC_BY_METHOD,
  CLIENT_REQUEST_METHOD_BY_TYPE,
  SERVER_NOTIFICATION_METHOD_BY_TYPE
} from "../generated/mcp/2026-07-28/McpProtocol.generated.js"
import {
  Implementation,
  SubscriptionsListenResult,
  SubscriptionsListenResultResponse
} from "../generated/mcp/2026-07-28/McpSchema.generated.js"
import * as StdioTransport from "./StdioTransport.js"

export type StdioServerTransportError = StdioTransport.StdioTransportError

export interface StdioServerRunOptions extends StdioTransport.StdioFramingOptions {
  readonly input?: Stream.Stream<Uint8Array, unknown>
  readonly write?: (bytes: Uint8Array) => Effect.Effect<void, unknown>
}

export interface StdioServerTransportOptions extends StdioServerRunOptions {
  readonly stderrSink?: (bytes: Uint8Array) => Effect.Effect<void, unknown>
}

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
): StdioTransport.StdioTransportError =>
  new StdioTransport.StdioTransportError({
    stage,
    message,
    ...(cause === undefined ? {} : { cause })
  })

interface ErrorEmitter {
  readonly on: (event: "error", listener: (cause: Error) => void) => unknown
  readonly off: (event: "error", listener: (cause: Error) => void) => unknown
}

const scopedErrorEvents = (
  emitter: ErrorEmitter,
  makeError: (cause: Error) => StdioTransport.StdioTransportError
): Stream.Stream<StdioTransport.StdioTransportError> =>
  Stream.callback<StdioTransport.StdioTransportError>(
    (queue) => {
      const onError = (cause: Error) => {
        Queue.offerUnsafe(queue, makeError(cause))
      }
      return Effect.acquireRelease(
        Effect.sync(() => emitter.on("error", onError)),
        () => Effect.sync(() => emitter.off("error", onError))
      )
    },
    { bufferSize: 1, strategy: "dropping" }
  )

const processInput = (): Stream.Stream<Uint8Array, StdioTransport.StdioTransportError> =>
  Stream.callback<Uint8Array, StdioTransport.StdioTransportError>(
    (queue) => {
      let active = true
      const settle = (pending: Promise<unknown>) => {
        pending.catch(() => {})
      }
      const onData = (chunk: Buffer | string) => {
        process.stdin.pause()
        settle(
          Effect.runPromise(
            Queue.offer(queue, typeof chunk === "string" ? new TextEncoder().encode(chunk) : new Uint8Array(chunk))
          ).then(() => {
            if (active) process.stdin.resume()
          })
        )
      }
      const onEnd = () => {
        Queue.endUnsafe(queue)
      }
      const onError = (cause: Error) =>
        settle(Effect.runPromise(Queue.fail(queue, transportError("Child", "Could not read process stdin", cause))))
      return Effect.acquireRelease(
        Effect.sync(() => {
          process.stdin.on("data", onData)
          process.stdin.once("end", onEnd)
          process.stdin.once("error", onError)
        }),
        () =>
          Effect.sync(() => {
            active = false
            process.stdin.off("data", onData)
            process.stdin.off("end", onEnd)
            process.stdin.off("error", onError)
            process.stdin.pause()
          })
      )
    },
    { bufferSize: 16, strategy: "suspend" }
  )

const processWrite = (bytes: Uint8Array): Effect.Effect<void, StdioTransport.StdioTransportError> =>
  Effect.callback((resume) => {
    try {
      process.stdout.write(bytes, (cause) =>
        resume(cause ? Effect.fail(transportError("Write", "Could not write process stdout", cause)) : Effect.void)
      )
    } catch (cause) {
      resume(Effect.fail(transportError("Write", "Could not write process stdout", cause)))
    }
  })

const terminationDiagnostics: Record<StdioTransport.StdioTransportStage, Uint8Array> = Object.fromEntries(
  (
    [
      "Spawn",
      "Write",
      "Decode",
      "Protocol",
      "FrameTooLarge",
      "Stdout",
      "Child",
      "Exit",
      "Eof",
      "Closed"
    ] satisfies ReadonlyArray<StdioTransport.StdioTransportStage>
  ).map((stage) => [stage, new TextEncoder().encode(`mcp-effect-sdk: stdio server transport terminated at ${stage}\n`)])
) as Record<StdioTransport.StdioTransportStage, Uint8Array>

const processStderrWrite = (bytes: Uint8Array): Effect.Effect<void, unknown> =>
  Effect.callback((resume) => {
    try {
      process.stderr.write(bytes, (cause) => resume(cause ? Effect.fail(cause) : Effect.void))
    } catch (cause) {
      resume(Effect.fail(cause))
    }
  })

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value)

const decodeSubscriptionFilter = (request: JsonRpcRequest): Result.Result<SubscriptionFilter, unknown> | undefined => {
  if (request.method !== CLIENT_REQUEST_METHOD_BY_TYPE.SubscriptionsListenRequest) return undefined
  return Result.map(
    Schema.decodeUnknownResult(
      CLIENT_REQUEST_PAYLOAD_CODEC_BY_METHOD[CLIENT_REQUEST_METHOD_BY_TYPE.SubscriptionsListenRequest]
    )(request.params),
    () => (request.params as Record<string, unknown>)["notifications"] as SubscriptionFilter
  )
}

const subscriptionAcknowledged = (id: JsonRpcId, filter: SubscriptionFilter): JsonRpcNotification => ({
  _tag: "Notification",
  jsonrpc: "2.0",
  method: SERVER_NOTIFICATION_METHOD_BY_TYPE.SubscriptionsAcknowledgedNotification,
  params: {
    notifications: filter,
    _meta: { "io.modelcontextprotocol/subscriptionId": id }
  }
})

const subscriptionCompleted = (
  id: JsonRpcId,
  serverInfo: McpServer.McpServerService["options"]["serverInfo"]
): JsonRpcSuccessResponse => {
  const response = new SubscriptionsListenResultResponse({
    jsonrpc: "2.0",
    id,
    result: new SubscriptionsListenResult({
      resultType: "complete",
      _meta: {
        "io.modelcontextprotocol/serverInfo": new Implementation(serverInfo),
        "io.modelcontextprotocol/subscriptionId": id
      }
    })
  })
  const encoded = Schema.encodeSync(SubscriptionsListenResultResponse)(response)
  return {
    _tag: "SuccessResponse",
    jsonrpc: encoded.jsonrpc,
    id: encoded.id,
    result: encoded.result
  }
}

const subscriptionNotification = (notification: McpServer.ServerNotification): JsonRpcNotification => ({
  _tag: "Notification",
  jsonrpc: "2.0",
  method: notification.tag,
  params: isRecord(notification.payload) ? notification.payload : {}
})

/** Run one scoped byte-framed stdio server over the shared MCP dispatcher. */
export const run = (
  options: StdioServerRunOptions = {}
): Effect.Effect<void, StdioTransport.StdioTransportError, Scope.Scope | McpServer.McpServer> =>
  Effect.gen(function* () {
    const server = yield* McpServer.McpServer
    const input = (options.input ?? processInput()).pipe(
      Stream.mapError((cause) =>
        cause instanceof StdioTransport.StdioTransportError
          ? cause
          : transportError("Child", "Stdio input stream failed", cause)
      )
    )
    const transportFailures = yield* Queue.make<StdioTransport.StdioTransportError>({
      capacity: 1,
      strategy: "sliding"
    })
    if (options.write === undefined) {
      yield* scopedErrorEvents(process.stdout, (cause) => transportError("Write", "Process stdout error", cause)).pipe(
        Stream.runForEach((error) => Queue.offer(transportFailures, error)),
        Effect.forkScoped
      )
      yield* Effect.yieldNow
    }
    const writer = yield* StdioTransport.makeWriter({
      write: options.write ?? processWrite
    })
    const dispatcher = yield* McpServer.makeDispatcher({
      send: writer.send,
      transport: "stdio"
    })
    const subscriptions = new Map<JsonRpcId, () => void>()

    yield* Effect.addFinalizer(() =>
      Effect.sync(() => {
        for (const close of subscriptions.values()) close()
        subscriptions.clear()
      })
    )

    const accept = (message: JsonRpcMessage): Effect.Effect<void, StdioTransport.StdioTransportError> => {
      if (message._tag === "SuccessResponse" || message._tag === "ErrorResponse") {
        return Effect.fail(transportError("Protocol", "Server received a JSON-RPC response"))
      }

      if (message._tag === "Request") {
        const decodedFilter = decodeSubscriptionFilter(message)
        if (decodedFilter !== undefined) {
          if (Result.isFailure(decodedFilter)) {
            return dispatcher.accept(message).pipe(Effect.catch(() => Effect.void))
          }
          return dispatcher.accept(message).pipe(
            Effect.result,
            Effect.flatMap((accepted) => {
              if (Result.isFailure(accepted)) return Effect.void
              const filter = decodedFilter.success
              subscriptions.set(
                message.id,
                server.openSubscription(
                  message.id,
                  filter,
                  (notification) =>
                    writer.send(subscriptionNotification(notification)).pipe(
                      Effect.catchCause((cause) =>
                        Queue.offer(
                          transportFailures,
                          transportError("Write", "Stdio subscription write failed", cause)
                        )
                      ),
                      Effect.asVoid
                    ),
                  () => writer.send(subscriptionCompleted(message.id, server.options.serverInfo))
                )
              )
              return writer.send(subscriptionAcknowledged(message.id, filter))
            })
          )
        }
      }

      if (
        message._tag === "Notification" &&
        message.method === CLIENT_NOTIFICATION_METHOD_BY_TYPE.CancelledNotification &&
        isRecord(message.params)
      ) {
        const id = message.params["requestId"]
        if (typeof id === "string" || typeof id === "number") {
          subscriptions.get(id)?.()
          subscriptions.delete(id)
        }
      }

      return dispatcher
        .accept(message)
        .pipe(Effect.mapError((cause) => transportError("Protocol", "Stdio server rejected inbound message", cause)))
    }

    const incoming = StdioTransport.decode(input, {
      maxLineBytes: options.maxLineBytes
    }).pipe(Stream.runForEach(accept))
    const terminalFailure = Queue.take(dispatcher.failures).pipe(
      Effect.flatMap((failure) => Effect.fail(transportError("Write", "Stdio server terminal write failed", failure)))
    )
    const transportFailure = Queue.take(transportFailures).pipe(Effect.flatMap(Effect.fail))
    // Fail-closed framing (malformed input, transport/terminal write failure)
    // must not write anything further to the wire, so subscription-complete
    // notifications only go out when the run loop ends gracefully.
    yield* Effect.raceFirst(incoming, Effect.raceFirst(terminalFailure, transportFailure)).pipe(
      Effect.onExit((exit) => (Exit.isSuccess(exit) ? server.closeSubscriptions : Effect.void))
    )
  })

/** Run the modern stdio transport for an explicitly constructed server. */
export const layer = (options: StdioServerTransportOptions = {}): Layer.Layer<never, never, McpServer.McpServer> =>
  Layer.effectDiscard(
    Effect.gen(function* () {
      if (options.stderrSink === undefined) {
        yield* scopedErrorEvents(process.stderr, (cause) =>
          transportError("Write", "Process stderr error", cause)
        ).pipe(Stream.runDrain, Effect.forkScoped)
        yield* Effect.yieldNow
      }
      yield* run(options).pipe(
        Effect.catch((error) =>
          (options.stderrSink ?? processStderrWrite)(terminationDiagnostics[error.stage]).pipe(
            Effect.catchCause(() => Effect.void)
          )
        ),
        Effect.forkScoped
      )
    })
  )
