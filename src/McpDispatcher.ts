/** Transport-neutral JSON-RPC request ownership and cancellation. */
import * as Cause from "effect/Cause"
import * as Chunk from "effect/Chunk"
import * as Context from "effect/Context"
import * as Data from "effect/Data"
import * as Deferred from "effect/Deferred"
import * as Effect from "effect/Effect"
import * as Either from "effect/Either"
import * as Exit from "effect/Exit"
import * as Fiber from "effect/Fiber"
import * as HashMap from "effect/HashMap"
import * as Option from "effect/Option"
import * as Queue from "effect/Queue"
import * as Ref from "effect/Ref"
import * as Schema from "effect/Schema"
import * as Scope from "effect/Scope"
import * as Stream from "effect/Stream"
import * as Take from "effect/Take"
import {
  CLIENT_NOTIFICATION_PAYLOAD_CODEC_BY_METHOD,
  CLIENT_REQUEST_PAYLOAD_CODEC_BY_METHOD
} from "./generated/mcp/2026-07-28/McpProtocol.generated.js"
import {
  InternalError,
  InvalidParams,
  InvalidRequest,
  MethodNotFound,
  RequestCancelledError,
  TransportError,
  toJsonRpcErrorObject,
  type McpError
} from "./McpErrors.js"
import { JsonRpcId as JsonRpcIdCodec } from "./McpWire.js"
import type {
  JsonRpcErrorResponse,
  JsonRpcId,
  JsonRpcMessage,
  JsonRpcNotification,
  JsonRpcRequest,
  JsonRpcSuccessResponse
} from "./McpWire.js"

export {
  InternalError,
  InvalidParams,
  InvalidRequest,
  MethodNotFound,
  RequestCancelledError,
  TransportError
}

export type ClientFrame =
  | { readonly _tag: "Notification"; readonly notification: JsonRpcNotification }
  | { readonly _tag: "Success"; readonly response: JsonRpcSuccessResponse }
  | { readonly _tag: "Error"; readonly response: JsonRpcErrorResponse }

type ClientFailure = InvalidRequest | RequestCancelledError | TransportError
type ClientTake = Take.Take<ClientFrame, ClientFailure>

interface ClientOwner {
  readonly queue: Queue.Queue<ClientTake>
}

interface ClientState {
  readonly active: HashMap.HashMap<JsonRpcId, ClientOwner>
  readonly closed: TransportError | undefined
}

export interface ClientDispatcher {
  readonly request: (request: JsonRpcRequest) => Stream.Stream<ClientFrame, ClientFailure>
  readonly accept: (
    message: JsonRpcMessage,
    options?: { readonly ownerId?: JsonRpcId }
  ) => Effect.Effect<void, InvalidRequest>
  readonly close: (cause?: unknown) => Effect.Effect<void>
  readonly cancel: (id: JsonRpcId, reason?: string) => Effect.Effect<void>
  readonly notifications: Queue.Dequeue<JsonRpcNotification>
}

export const makeClientDispatcher = <SendError>(options: {
  readonly send: (message: JsonRpcRequest) => Effect.Effect<void, SendError>
}): Effect.Effect<ClientDispatcher, never, Scope.Scope> =>
  Effect.gen(function*() {
    const state = yield* Ref.make<ClientState>({
      active: HashMap.empty<JsonRpcId, ClientOwner>(),
      closed: undefined
    })
    const notifications = yield* Queue.unbounded<JsonRpcNotification>()

    const removeOwner = (id: JsonRpcId, owner: ClientOwner): Effect.Effect<void> =>
      Ref.update(state, (current) => Option.match(HashMap.get(current.active, id), {
        onNone: () => current,
        onSome: (currentOwner) => currentOwner !== owner
          ? current
          : { ...current, active: HashMap.remove(current.active, id) }
      }))

    const request = (message: JsonRpcRequest): Stream.Stream<ClientFrame, ClientFailure> =>
      Stream.unwrapScoped(Effect.gen(function*() {
        const owner: ClientOwner = { queue: yield* Queue.unbounded<ClientTake>() }
        yield* Effect.addFinalizer(() => removeOwner(message.id, owner).pipe(
          Effect.zipRight(Queue.shutdown(owner.queue))
        ))
        const registration = yield* Ref.modify(state, (current): readonly [
          { readonly ok: true } | { readonly ok: false; readonly error: ClientFailure },
          ClientState
        ] => {
          if (current.closed !== undefined) return [{ ok: false, error: current.closed }, current]
          if (HashMap.has(current.active, message.id)) {
            return [{
              ok: false,
              error: new InvalidRequest({ message: `Request id ${formatId(message.id)} is already active` })
            }, current]
          }
          return [{ ok: true }, {
            ...current,
            active: HashMap.set(current.active, message.id, owner)
          }]
        })
        if (!registration.ok) return yield* Effect.fail(registration.error)

        yield* options.send(message).pipe(
          Effect.catchAllCause((cause): Effect.Effect<never, TransportError> =>
            Cause.isInterruptedOnly(cause)
              ? Effect.failCause(cause as Cause.Cause<TransportError>)
              : Effect.fail(asTransportError("Could not send request", cause)))
        )
        return Stream.fromQueue(owner.queue).pipe(Stream.flattenTake)
      }))

    const accept: ClientDispatcher["accept"] = (message, acceptOptions) => {
      if (message._tag === "Request") {
        return Effect.fail(new InvalidRequest({ message: "Standalone inbound requests require a server-request handler" }))
      }
      if (message._tag === "Notification") {
        const ownerId = acceptOptions?.ownerId ?? subscriptionOwner(message)
        if (ownerId === undefined) return Queue.offer(notifications, message).pipe(Effect.asVoid)
        return Ref.get(state).pipe(
          Effect.flatMap((current) => Option.match(HashMap.get(current.active, ownerId), {
            onNone: () => Effect.void,
            onSome: (owner) => Queue.offer(owner.queue, Take.chunk(Chunk.of({
              _tag: "Notification" as const,
              notification: message
            }))).pipe(Effect.asVoid)
          }))
        )
      }

      return Ref.modify(state, (current) => Option.match(HashMap.get(current.active, message.id), {
        onNone: () => [Option.none<ClientOwner>(), current] as const,
        onSome: (owner) => [Option.some(owner), {
          ...current,
          active: HashMap.remove(current.active, message.id)
        }] as const
      })).pipe(
        Effect.flatMap(Option.match({
          onNone: () => Effect.void,
          onSome: (owner) => Queue.offerAll(owner.queue, [
            Take.chunk(Chunk.of(message._tag === "SuccessResponse"
              ? { _tag: "Success" as const, response: message }
              : { _tag: "Error" as const, response: message })),
            Take.end
          ]).pipe(Effect.asVoid)
        }))
      )
    }

    const close = (cause?: unknown): Effect.Effect<void> => {
      const failure = asTransportError("Dispatcher closed", cause)
      return Ref.modify(state, (current) => current.closed === undefined
        ? [[...HashMap.values(current.active)], {
          active: HashMap.empty<JsonRpcId, ClientOwner>(),
          closed: failure
        }] as const
        : [[], current] as const).pipe(
          Effect.flatMap((owners) => Effect.forEach(owners, (owner) =>
            Queue.offer(owner.queue, Take.fail(failure)), { discard: true }))
        )
    }

    const cancel = (id: JsonRpcId, reason?: string): Effect.Effect<void> =>
      Ref.modify(state, (current) => Option.match(HashMap.get(current.active, id), {
        onNone: () => [Option.none<ClientOwner>(), current] as const,
        onSome: (owner) => [Option.some(owner), {
          ...current,
          active: HashMap.remove(current.active, id)
        }] as const
      })).pipe(
        Effect.flatMap(Option.match({
          onNone: () => Effect.void,
          onSome: (owner) => Queue.offer(owner.queue, Take.fail(new RequestCancelledError({
            requestId: id,
            ...(reason === undefined ? {} : { reason })
          }))).pipe(Effect.asVoid)
        }))
      )

    yield* Effect.addFinalizer(() => close().pipe(
      Effect.zipRight(Queue.shutdown(notifications))
    ))
    return { request, accept, cancel, close, notifications }
  })

export interface McpRequestContextValue {
  readonly request: JsonRpcRequest
  readonly id: JsonRpcId
  readonly protocolVersion: string
  readonly clientCapabilities: unknown
  readonly extensions: unknown
  readonly clientInfo: unknown
  readonly authorizationPrincipal: unknown
  readonly cancelled: Effect.Effect<void>
  readonly isCancelled: Effect.Effect<boolean>
  readonly notificationSink: (notification: JsonRpcNotification) => Effect.Effect<void, unknown>
  readonly annotations: Context.Context<never>
}

export const McpRequestContext = Context.GenericTag<McpRequestContextValue>(
  "mcp-effect-sdk/McpRequestContext"
)

export interface ServerRequestMetadata {
  readonly authorizationPrincipal?: unknown
  readonly annotations?: Context.Context<never>
}

export interface ServerDispatcher {
  readonly accept: (
    message: JsonRpcRequest | JsonRpcNotification,
    metadata?: ServerRequestMetadata
  ) => Effect.Effect<void, InvalidRequest>
  readonly failures: Queue.Dequeue<ServerDispatchFailure>
}

export class ServerDispatchFailure extends Data.TaggedClass("ServerDispatchFailure")<{
  readonly requestId: JsonRpcId
  readonly method: string
  readonly terminalTag: JsonRpcSuccessResponse["_tag"] | JsonRpcErrorResponse["_tag"]
  readonly message: string
  readonly request: JsonRpcRequest
  readonly terminal: JsonRpcSuccessResponse | JsonRpcErrorResponse
  readonly cause: Cause.Cause<unknown>
}> {}

interface ServerOwner {
  readonly cancelled: Deferred.Deferred<void>
  readonly fiberReady: Deferred.Deferred<Fiber.RuntimeFiber<void, unknown>>
}

interface ServerEntry {
  readonly owner: ServerOwner
  readonly phase: "Running" | "TerminalWriting" | "Cancelling"
}

export const makeServerDispatcher = <SendError, HandleError>(options: {
  readonly send: (message: JsonRpcSuccessResponse | JsonRpcErrorResponse | JsonRpcNotification) => Effect.Effect<void, SendError>
  readonly handle: (request: JsonRpcRequest) => Effect.Effect<unknown, HandleError, McpRequestContextValue>
}): Effect.Effect<ServerDispatcher, never, Scope.Scope> =>
  Effect.gen(function*() {
    const scope = yield* Effect.scope
    const active = yield* Ref.make(HashMap.empty<JsonRpcId, ServerEntry>())
    const failures = yield* Queue.unbounded<ServerDispatchFailure>()

    const beginTerminal = (id: JsonRpcId, owner: ServerOwner): Effect.Effect<boolean> =>
      Ref.modify(active, (current) => Option.match(HashMap.get(current, id), {
        onNone: () => [false, current] as const,
        onSome: (entry) => entry.owner !== owner || entry.phase !== "Running"
          ? [false, current] as const
          : [true, HashMap.set(current, id, { owner, phase: "TerminalWriting" })] as const
      }))

    const releaseOwner = (id: JsonRpcId, owner: ServerOwner): Effect.Effect<void> =>
      Ref.update(active, (current) => Option.match(HashMap.get(current, id), {
        onNone: () => current,
        onSome: (entry) => entry.owner === owner ? HashMap.remove(current, id) : current
      }))

    const complete = (
      request: JsonRpcRequest,
      owner: ServerOwner,
      terminal: JsonRpcSuccessResponse | JsonRpcErrorResponse
    ): Effect.Effect<void, SendError> => beginTerminal(request.id, owner).pipe(
      Effect.flatMap((owned) => owned
        ? options.send(terminal).pipe(
          Effect.onExit((exit) => Exit.match(exit, {
            onFailure: (cause) => releaseOwner(request.id, owner).pipe(
              Effect.zipRight(Queue.offer(failures, new ServerDispatchFailure({
                requestId: request.id,
                method: request.method,
                terminalTag: terminal._tag,
                message: "Terminal send failed",
                request,
                terminal,
                cause
              })))
            ),
            onSuccess: () => releaseOwner(request.id, owner)
          }))
        )
        : Effect.void)
    )

    const runRequest = (
      request: JsonRpcRequest,
      owner: ServerOwner,
      metadata: ServerRequestMetadata | undefined
    ): Effect.Effect<void, SendError> => {
      const codec = requestCodec(request.method)
      if (codec === undefined) {
        return complete(request, owner, errorTerminal(request.id,
          new MethodNotFound({ message: `Unknown method: ${request.method}` })))
      }
      const decoded = Schema.decodeUnknownEither(codec)(request.params)
      if (Either.isLeft(decoded)) {
        return complete(request, owner, errorTerminal(request.id,
          new InvalidParams({ message: `Invalid params for ${request.method}`, cause: decoded.left })))
      }

      const validatedRequest = {
        ...request,
        params: decoded.right
      } as JsonRpcRequest
      const context = requestContext(validatedRequest, owner, metadata, options.send)
      return options.handle(validatedRequest).pipe(
        Effect.provideService(McpRequestContext, context),
        Effect.matchCauseEffect({
          onFailure: (cause) => {
            if (Cause.isInterruptedOnly(cause)) return Effect.interrupt
            const failure = Cause.failureOption(cause)
            const error = Option.isSome(failure)
              ? handlerError(failure.value)
              : new InternalError({ message: "Request handler defect", cause })
            return complete(request, owner, errorTerminal(request.id, error))
          },
          onSuccess: (result) => complete(request, owner, {
            _tag: "SuccessResponse",
            jsonrpc: "2.0",
            id: request.id,
            result: result as JsonRpcSuccessResponse["result"]
          })
        })
      )
    }

    const acceptRequest = (
      request: JsonRpcRequest,
      metadata: ServerRequestMetadata | undefined
    ): Effect.Effect<void, InvalidRequest> => Effect.gen(function*() {
      const owner: ServerOwner = {
        cancelled: yield* Deferred.make<void>(),
        fiberReady: yield* Deferred.make<Fiber.RuntimeFiber<void, unknown>>()
      }
      const registered = yield* Ref.modify(active, (current) => HashMap.has(current, request.id)
        ? [false, current] as const
        : [true, HashMap.set(current, request.id, { owner, phase: "Running" })] as const)
      if (!registered) {
        return yield* new InvalidRequest({ message: `Request id ${formatId(request.id)} is already active` })
      }
      const fiber = yield* runRequest(request, owner, metadata).pipe(
        Effect.ensuring(releaseOwner(request.id, owner)),
        Effect.forkIn(scope)
      )
      yield* Deferred.succeed(owner.fiberReady, fiber)
    })

    const cancelRequest = (id: JsonRpcId): Effect.Effect<void> =>
      Ref.modify(active, (current) => Option.match(HashMap.get(current, id), {
        onNone: () => [Option.none<ServerOwner>(), current] as const,
        onSome: (entry) => entry.phase !== "Running"
          ? [Option.none<ServerOwner>(), current] as const
          : [Option.some(entry.owner), HashMap.set(current, id, {
            owner: entry.owner,
            phase: "Cancelling"
          })] as const
      })).pipe(
        Effect.flatMap(Option.match({
          onNone: () => Effect.void,
          onSome: (owner) => Deferred.succeed(owner.cancelled, undefined).pipe(
            Effect.zipRight(Deferred.await(owner.fiberReady)),
            Effect.flatMap(Fiber.interruptFork),
            Effect.asVoid
          )
        }))
      )

    const accept: ServerDispatcher["accept"] = (message, metadata) => {
      if (message._tag === "Request") return acceptRequest(message, metadata)
      const codec = clientNotificationCodec(message.method)
      if (codec === undefined) return Effect.void
      const decoded = Schema.decodeUnknownEither(codec)(message.params)
      if (Either.isLeft(decoded)) {
        return Effect.fail(new InvalidRequest({
          message: `Invalid params for ${message.method}`,
          cause: decoded.left
        }))
      }
      const validated = { ...message, params: decoded.right } as JsonRpcNotification
      const cancellationId = cancellationRequestId(validated)
      return cancellationId === undefined ? Effect.void : cancelRequest(cancellationId)
    }

    yield* Effect.addFinalizer(() => Ref.getAndSet(active, HashMap.empty<JsonRpcId, ServerEntry>()).pipe(
      Effect.flatMap((entries) => Effect.forEach(HashMap.values(entries), (entry) =>
        Deferred.await(entry.owner.fiberReady).pipe(Effect.flatMap(Fiber.interrupt)), { discard: true })),
      Effect.zipRight(Queue.shutdown(failures)),
      Effect.asVoid
    ))
    return { accept, failures }
  })

const requestCodec = (method: string): Schema.Schema.AnyNoContext | undefined =>
  Object.hasOwn(CLIENT_REQUEST_PAYLOAD_CODEC_BY_METHOD, method)
    ? CLIENT_REQUEST_PAYLOAD_CODEC_BY_METHOD[
      method as keyof typeof CLIENT_REQUEST_PAYLOAD_CODEC_BY_METHOD
    ]
    : undefined

const clientNotificationCodec = (method: string): Schema.Schema.AnyNoContext | undefined =>
  Object.hasOwn(CLIENT_NOTIFICATION_PAYLOAD_CODEC_BY_METHOD, method)
    ? CLIENT_NOTIFICATION_PAYLOAD_CODEC_BY_METHOD[
      method as keyof typeof CLIENT_NOTIFICATION_PAYLOAD_CODEC_BY_METHOD
    ]
    : undefined

const requestContext = <SendError>(
  request: JsonRpcRequest,
  owner: ServerOwner,
  metadata: ServerRequestMetadata | undefined,
  send: (message: JsonRpcSuccessResponse | JsonRpcErrorResponse | JsonRpcNotification) => Effect.Effect<void, SendError>
): McpRequestContextValue => {
  const params = isRecord(request.params) ? request.params : {}
  const meta = isRecord(params["_meta"]) ? params["_meta"] : {}
  const capabilities = meta["io.modelcontextprotocol/clientCapabilities"]
  return {
    request,
    id: request.id,
    protocolVersion: typeof meta["io.modelcontextprotocol/protocolVersion"] === "string"
      ? meta["io.modelcontextprotocol/protocolVersion"]
      : "",
    clientCapabilities: capabilities,
    extensions: isRecord(capabilities) ? capabilities["extensions"] : undefined,
    clientInfo: meta["io.modelcontextprotocol/clientInfo"],
    authorizationPrincipal: metadata?.authorizationPrincipal,
    cancelled: Deferred.await(owner.cancelled),
    isCancelled: Deferred.isDone(owner.cancelled),
    notificationSink: (notification) => send(notification),
    annotations: metadata?.annotations ?? Context.empty()
  }
}

const cancellationRequestId = (notification: JsonRpcNotification): JsonRpcId | undefined => {
  if (notification.method !== "notifications/cancelled" || !isRecord(notification.params)) return undefined
  const id = notification.params["requestId"]
  return isJsonRpcId(id) ? id : undefined
}

const subscriptionOwner = (notification: JsonRpcNotification): JsonRpcId | undefined => {
  if (!isRecord(notification.params) || !isRecord(notification.params["_meta"])) return undefined
  const id = notification.params["_meta"]["io.modelcontextprotocol/subscriptionId"]
  return isJsonRpcId(id) ? id : undefined
}

const isJsonRpcId = (value: unknown): value is JsonRpcId =>
  Either.isRight(Schema.decodeUnknownEither(JsonRpcIdCodec)(value))

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value)

const asTransportError = (message: string, cause?: unknown): TransportError =>
  cause instanceof TransportError ? cause : new TransportError({ message, cause })

const handlerError = (failure: unknown): McpError => {
  if (isRecord(failure) && Number.isInteger(failure["code"]) && typeof failure["message"] === "string") {
    return failure as unknown as McpError
  }
  return new InternalError({ message: "Request handler failed", cause: failure })
}

const errorTerminal = (id: JsonRpcId, error: McpError): JsonRpcErrorResponse => ({
  _tag: "ErrorResponse",
  jsonrpc: "2.0",
  id,
  error: toJsonRpcErrorObject(error)
})

const formatId = (id: JsonRpcId): string => `${typeof id}:${JSON.stringify(id)}`
