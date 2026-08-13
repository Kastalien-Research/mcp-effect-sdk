/** Stateful, bidirectional JSON-RPC connection for MCP 2025-11-25. */
import * as Data from "effect/Data"
import * as Deferred from "effect/Deferred"
import * as Effect from "effect/Effect"
import * as Either from "effect/Either"
import * as Ref from "effect/Ref"
import * as Schema from "effect/Schema"
import type * as Scope from "effect/Scope"
import * as Stream from "effect/Stream"
import type { JsonRpcId, JsonRpcMessage, JsonRpcRequest } from "../McpWire.js"
import {
  CLIENT_NOTIFICATION_PAYLOAD_CODEC_BY_METHOD,
  CLIENT_REQUEST_PAYLOAD_CODEC_BY_METHOD,
  CLIENT_REQUEST_RESULT_CODEC_BY_METHOD,
  SERVER_NOTIFICATION_PAYLOAD_CODEC_BY_METHOD,
  SERVER_REQUEST_PAYLOAD_CODEC_BY_METHOD,
  SERVER_REQUEST_RESULT_CODEC_BY_METHOD,
  isClientNotificationMethod,
  isClientRequestMethod,
  isServerNotificationMethod,
  isServerRequestMethod,
  type ClientNotificationMethod,
  type ClientRequestMethod,
  type ServerNotificationMethod,
  type ServerRequestMethod
} from "../generated/mcp/2025-11-25/McpProtocol.generated.js"

export type LegacyRole = "client" | "server"
export type LegacyRequestMethod = ClientRequestMethod | ServerRequestMethod
export type LegacyNotificationMethod = ClientNotificationMethod | ServerNotificationMethod

export class LegacyConnectionError extends Data.TaggedError("LegacyConnectionError")<{
  readonly stage: "Closed" | "Decode" | "Encode" | "Protocol" | "Remote" | "Transport"
  readonly message: string
  readonly code?: number
  readonly data?: unknown
  readonly cause?: unknown
}> {}

export interface LegacyDuplexTransport<E = unknown> {
  readonly messages: Stream.Stream<JsonRpcMessage, E>
  readonly send: (message: JsonRpcMessage) => Effect.Effect<void, E>
  readonly close?: Effect.Effect<void, E>
}

export interface LegacyRequestContext {
  readonly id: JsonRpcId
  readonly method: LegacyRequestMethod
  readonly signal: AbortSignal
}

export type LegacyRequestHandler = (
  params: unknown,
  context: LegacyRequestContext
) => Effect.Effect<unknown, LegacyConnectionError>
export type LegacyNotificationHandler = (
  params: unknown,
  method: LegacyNotificationMethod
) => Effect.Effect<void, LegacyConnectionError>

export interface LegacyConnectionOptions<E> {
  readonly role: LegacyRole
  readonly transport: LegacyDuplexTransport<E>
  readonly requestHandlers?: Readonly<Record<string, LegacyRequestHandler>>
  readonly notificationHandlers?: Readonly<Record<string, LegacyNotificationHandler>>
  readonly onUnhandledNotification?: LegacyNotificationHandler
}

interface PendingRequest {
  readonly method: LegacyRequestMethod
  readonly deferred: Deferred.Deferred<unknown, LegacyConnectionError>
}

export interface LegacyConnection {
  readonly role: LegacyRole
  readonly request: (method: LegacyRequestMethod, params?: unknown) => Effect.Effect<unknown, LegacyConnectionError>
  readonly notify: (method: LegacyNotificationMethod, params?: unknown) => Effect.Effect<void, LegacyConnectionError>
  readonly close: Effect.Effect<void>
}

const failure = (
  stage: LegacyConnectionError["stage"],
  message: string,
  options: { readonly code?: number; readonly data?: unknown; readonly cause?: unknown } = {}
): LegacyConnectionError => new LegacyConnectionError({ stage, message, ...options })

const codecsFor = (role: LegacyRole, outbound: boolean) => {
  const clientSide = (role === "client") === outbound
  return clientSide
    ? {
        isRequest: isClientRequestMethod,
        isNotification: isClientNotificationMethod,
        requestPayloads: CLIENT_REQUEST_PAYLOAD_CODEC_BY_METHOD,
        requestResults: CLIENT_REQUEST_RESULT_CODEC_BY_METHOD,
        notificationPayloads: CLIENT_NOTIFICATION_PAYLOAD_CODEC_BY_METHOD
      }
    : {
        isRequest: isServerRequestMethod,
        isNotification: isServerNotificationMethod,
        requestPayloads: SERVER_REQUEST_PAYLOAD_CODEC_BY_METHOD,
        requestResults: SERVER_REQUEST_RESULT_CODEC_BY_METHOD,
        notificationPayloads: SERVER_NOTIFICATION_PAYLOAD_CODEC_BY_METHOD
      }
}

const decode = (
  codec: Schema.Schema.AnyNoContext,
  value: unknown,
  label: string
): Effect.Effect<unknown, LegacyConnectionError> =>
  Schema.decodeUnknown(codec)(value).pipe(Effect.mapError((cause) => failure("Decode", `Invalid ${label}`, { cause })))

const encode = (
  codec: Schema.Schema.AnyNoContext,
  value: unknown,
  label: string
): Effect.Effect<unknown, LegacyConnectionError> =>
  Schema.encodeUnknown(codec)(value).pipe(Effect.mapError((cause) => failure("Encode", `Invalid ${label}`, { cause })))

export const make = <E>(options: LegacyConnectionOptions<E>): Effect.Effect<LegacyConnection, never, Scope.Scope> =>
  Effect.gen(function* () {
    const nextId = yield* Ref.make(1)
    const closed = yield* Ref.make(false)
    const pending = new Map<JsonRpcId, PendingRequest>()
    const running = new Map<JsonRpcId, AbortController>()
    const outbound = codecsFor(options.role, true)
    const inbound = codecsFor(options.role, false)

    const send = (message: JsonRpcMessage): Effect.Effect<void, LegacyConnectionError> =>
      options.transport
        .send(message)
        .pipe(Effect.mapError((cause) => failure("Transport", "Could not send JSON-RPC message", { cause })))

    const settleAll = (error: LegacyConnectionError): Effect.Effect<void> =>
      Effect.forEach([...pending.values()], ({ deferred }) => Deferred.fail(deferred, error), {
        discard: true
      }).pipe(Effect.tap(() => Effect.sync(() => pending.clear())))

    const close = Ref.getAndSet(closed, true).pipe(
      Effect.flatMap((wasClosed) => {
        if (wasClosed) return Effect.void
        for (const controller of running.values()) controller.abort("connection closed")
        running.clear()
        return settleAll(failure("Closed", "MCP connection closed")).pipe(
          Effect.zipRight(
            options.transport.close === undefined
              ? Effect.void
              : options.transport.close.pipe(Effect.catchAllCause(() => Effect.void))
          )
        )
      })
    )

    const acceptResponse = (message: Extract<JsonRpcMessage, { readonly _tag: "SuccessResponse" | "ErrorResponse" }>) =>
      Effect.gen(function* () {
        const item = pending.get(message.id)
        if (item === undefined) return yield* Effect.fail(failure("Protocol", "Response for unknown request ID"))
        pending.delete(message.id)
        if (message._tag === "ErrorResponse") {
          yield* Deferred.fail(
            item.deferred,
            failure("Remote", message.error.message, {
              code: message.error.code,
              ...(message.error.data === undefined ? {} : { data: message.error.data })
            })
          )
          return
        }
        const codec = outbound.requestResults[item.method as keyof typeof outbound.requestResults]
        if (codec === undefined) {
          yield* Deferred.fail(item.deferred, failure("Protocol", `No result codec for ${item.method}`))
          return
        }
        const result = yield* decode(codec, message.result, `${item.method} result`).pipe(Effect.either)
        yield* Either.isLeft(result)
          ? Deferred.fail(item.deferred, result.left)
          : Deferred.succeed(item.deferred, result.right)
      })

    const acceptRequest = (message: JsonRpcRequest): Effect.Effect<void, LegacyConnectionError> =>
      Effect.gen(function* () {
        if (!inbound.isRequest(message.method)) {
          yield* send({
            _tag: "ErrorResponse",
            jsonrpc: "2.0",
            id: message.id,
            error: { code: -32601, message: "Method not found" }
          })
          return
        }
        const codec = inbound.requestPayloads[message.method as keyof typeof inbound.requestPayloads]
        const params = yield* decode(codec, message.params, `${message.method} params`).pipe(Effect.either)
        if (Either.isLeft(params)) {
          yield* send({
            _tag: "ErrorResponse",
            jsonrpc: "2.0",
            id: message.id,
            error: { code: -32602, message: "Invalid params" }
          })
          return
        }
        const handler = options.requestHandlers?.[message.method]
        if (handler === undefined) {
          yield* send({
            _tag: "ErrorResponse",
            jsonrpc: "2.0",
            id: message.id,
            error: { code: -32601, message: "Method not found" }
          })
          return
        }
        const controller = new AbortController()
        running.set(message.id, controller)
        const aborted = Effect.async<void>((resume) => {
          const onAbort = () => resume(Effect.void)
          controller.signal.addEventListener("abort", onAbort, { once: true })
          return Effect.sync(() => controller.signal.removeEventListener("abort", onAbort))
        }).pipe(Effect.zipRight(Effect.interrupt))
        const handled = yield* handler(params.right, {
          id: message.id,
          method: message.method,
          signal: controller.signal
        }).pipe(
          Effect.raceFirst(aborted),
          Effect.either,
          Effect.ensuring(Effect.sync(() => running.delete(message.id)))
        )
        if (controller.signal.aborted) return
        if (Either.isLeft(handled)) {
          yield* send({
            _tag: "ErrorResponse",
            jsonrpc: "2.0",
            id: message.id,
            error: {
              code: handled.left.code ?? -32603,
              message: handled.left.message,
              ...(handled.left.data === undefined ? {} : { data: handled.left.data as never })
            }
          })
          return
        }
        const resultCodec = inbound.requestResults[message.method as keyof typeof inbound.requestResults]
        const result = yield* encode(resultCodec, handled.right, `${message.method} result`).pipe(Effect.either)
        if (Either.isLeft(result)) {
          yield* send({
            _tag: "ErrorResponse",
            jsonrpc: "2.0",
            id: message.id,
            error: { code: -32603, message: "Could not encode handler result" }
          })
          return
        }
        yield* send({ _tag: "SuccessResponse", jsonrpc: "2.0", id: message.id, result: result.right as never })
      })

    const acceptNotification = (message: Extract<JsonRpcMessage, { readonly _tag: "Notification" }>) =>
      Effect.gen(function* () {
        if (!inbound.isNotification(message.method)) {
          return yield* Effect.fail(failure("Protocol", `Notification not permitted from peer: ${message.method}`))
        }
        const codec = inbound.notificationPayloads[message.method as keyof typeof inbound.notificationPayloads]
        const params = yield* decode(codec, message.params, `${message.method} params`)
        if (message.method === "notifications/cancelled") {
          const requestId = (params as { readonly requestId?: JsonRpcId }).requestId
          if (requestId !== undefined) running.get(requestId)?.abort("peer cancellation")
        }
        const handler = options.notificationHandlers?.[message.method] ?? options.onUnhandledNotification
        if (handler !== undefined) yield* handler(params, message.method)
      })

    const accept = (message: JsonRpcMessage): Effect.Effect<void, LegacyConnectionError> => {
      switch (message._tag) {
        case "SuccessResponse":
        case "ErrorResponse":
          return acceptResponse(message)
        case "Request":
          return acceptRequest(message)
        case "Notification":
          return acceptNotification(message)
      }
    }

    yield* options.transport.messages.pipe(
      Stream.runForEach((message) =>
        message._tag === "Request"
          ? accept(message).pipe(
              Effect.catchAll(() => Effect.void),
              Effect.forkScoped,
              Effect.asVoid
            )
          : accept(message)
      ),
      Effect.matchCauseEffect({
        onFailure: (cause) => settleAll(failure("Transport", "Inbound transport failed", { cause })),
        onSuccess: () => settleAll(failure("Closed", "Inbound transport ended"))
      }),
      Effect.forkScoped
    )

    const request = (method: LegacyRequestMethod, params?: unknown): Effect.Effect<unknown, LegacyConnectionError> =>
      Effect.gen(function* () {
        if (yield* Ref.get(closed)) return yield* Effect.fail(failure("Closed", "MCP connection is closed"))
        if (!outbound.isRequest(method)) {
          return yield* Effect.fail(failure("Protocol", `Request not permitted for ${options.role}: ${method}`))
        }
        const payloadCodec = outbound.requestPayloads[method as keyof typeof outbound.requestPayloads]
        const payload = yield* encode(payloadCodec, params, `${method} params`)
        // Direction-qualified IDs prevent collisions when both peers issue
        // requests concurrently (a normal operation in the stateful profile).
        const sequence = yield* Ref.getAndUpdate(nextId, (value) => value + 1)
        const id = `${options.role}-${sequence}`
        const deferred = yield* Deferred.make<unknown, LegacyConnectionError>()
        pending.set(id, { method, deferred })
        yield* send({
          _tag: "Request",
          jsonrpc: "2.0",
          id,
          method,
          ...(payload === undefined ? {} : { params: payload as never })
        }).pipe(Effect.tapError(() => Effect.sync(() => pending.delete(id))))
        return yield* Deferred.await(deferred).pipe(
          Effect.onInterrupt(() =>
            Effect.sync(() => pending.delete(id)).pipe(
              Effect.zipRight(
                method === "initialize"
                  ? Effect.void
                  : send({
                      _tag: "Notification",
                      jsonrpc: "2.0",
                      method: "notifications/cancelled",
                      params: { requestId: id }
                    }).pipe(Effect.catchAll(() => Effect.void))
              )
            )
          )
        )
      })

    const notify = (method: LegacyNotificationMethod, params?: unknown): Effect.Effect<void, LegacyConnectionError> =>
      Effect.gen(function* () {
        if (yield* Ref.get(closed)) return yield* Effect.fail(failure("Closed", "MCP connection is closed"))
        if (!outbound.isNotification(method)) {
          return yield* Effect.fail(failure("Protocol", `Notification not permitted for ${options.role}: ${method}`))
        }
        const codec = outbound.notificationPayloads[method as keyof typeof outbound.notificationPayloads]
        const payload = yield* encode(codec, params, `${method} params`)
        yield* send({
          _tag: "Notification",
          jsonrpc: "2.0",
          method,
          ...(payload === undefined ? {} : { params: payload as never })
        })
      })

    yield* Effect.addFinalizer(() => close)
    return { role: options.role, request, notify, close }
  })
