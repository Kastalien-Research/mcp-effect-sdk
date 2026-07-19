/** Transport-neutral JSON-RPC request ownership and cancellation. */
import * as Cause from "effect/Cause"
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
import {
  CLIENT_NOTIFICATION_PAYLOAD_CODEC_BY_METHOD,
  CLIENT_REQUEST_PAYLOAD_CODEC_BY_METHOD,
  SERVER_NOTIFICATION_PAYLOAD_CODEC_BY_METHOD
} from "./generated/mcp/2026-07-28/McpProtocol.generated.js"
import { validateSubscriptionTerminal } from "./internal/SubscriptionValidation.js"
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

type ClientEvent =
  | { readonly _tag: "Notification"; readonly frame: Extract<ClientFrame, { readonly _tag: "Notification" }> }
  | { readonly _tag: "Terminal"; readonly frame: Exclude<ClientFrame, { readonly _tag: "Notification" }> }
  | { readonly _tag: "Failure"; readonly failure: ClientFailure }

const CLIENT_OWNER_BUFFER_CAPACITY = 16
const SERVER_FAILURE_BUFFER_CAPACITY = 16

interface ClientOwner {
  readonly queue: Queue.Queue<ClientEvent>
  readonly request: JsonRpcRequest
  readonly progressToken: unknown
  readonly sent: Ref.Ref<boolean>
  readonly subscription: {
    acknowledgedFilter: Readonly<Record<string, unknown>> | undefined
  } | undefined
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
}

export const makeClientDispatcher = <SendError>(options: {
  readonly send: (message: JsonRpcRequest) => Effect.Effect<void, SendError>
  readonly onRequestAbandoned?: (message: JsonRpcRequest) => Effect.Effect<void, unknown>
}): Effect.Effect<ClientDispatcher, never, Scope.Scope> =>
  Effect.gen(function*() {
    const scope = yield* Effect.scope
    const state = yield* Ref.make<ClientState>({
      active: HashMap.empty<JsonRpcId, ClientOwner>(),
      closed: undefined
    })

    const removeOwner = (id: JsonRpcId, owner: ClientOwner): Effect.Effect<boolean> =>
      Ref.modify(state, (current) => Option.match(HashMap.get(current.active, id), {
        onNone: () => [false, current] as const,
        onSome: (currentOwner) => currentOwner !== owner
          ? [false, current] as const
          : [true, { ...current, active: HashMap.remove(current.active, id) }] as const
      }))

    const enqueueFinal = (owner: ClientOwner, event: Exclude<ClientEvent, { readonly _tag: "Notification" }>) =>
      Queue.offer(owner.queue, event).pipe(
        Effect.forkIn(scope),
        Effect.asVoid
      )

    const eventFrame = (event: ClientEvent): Effect.Effect<ClientFrame, ClientFailure> =>
      event._tag === "Failure" ? Effect.fail(event.failure) : Effect.succeed(event.frame)

    const abandonOwner = (owner: ClientOwner): Effect.Effect<void> => Ref.get(owner.sent).pipe(
      Effect.flatMap((wasSent) => wasSent && options.onRequestAbandoned !== undefined
        ? Effect.suspend(() => options.onRequestAbandoned!(owner.request)).pipe(
          Effect.catchAllCause(() => Effect.void),
          Effect.forkIn(scope),
          Effect.asVoid
        )
        : Effect.void)
    )

    const request = (message: JsonRpcRequest): Stream.Stream<ClientFrame, ClientFailure> =>
      Stream.unwrapScoped(Effect.gen(function*() {
        const sent = yield* Ref.make(false)
        const owner: ClientOwner = {
          queue: yield* Queue.bounded<ClientEvent>(CLIENT_OWNER_BUFFER_CAPACITY),
          request: message,
          progressToken: requestProgressToken(message),
          sent,
          subscription: message.method === "subscriptions/listen"
            ? { acknowledgedFilter: undefined }
            : undefined
        }
        yield* Effect.addFinalizer(() => removeOwner(message.id, owner).pipe(
          Effect.flatMap((removed) => removed
            ? abandonOwner(owner)
            : Effect.void),
          Effect.ensuring(Queue.shutdown(owner.queue))
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

        yield* Effect.uninterruptibleMask((restore) => restore(options.send(message)).pipe(
          Effect.catchAllCause((cause): Effect.Effect<never, TransportError> =>
            Cause.isInterruptedOnly(cause)
              ? Effect.failCause(cause as Cause.Cause<TransportError>)
              : Effect.fail(asTransportError("Could not send request", cause))),
          Effect.zipRight(Ref.set(sent, true))
        ))
        return Stream.fromQueue(owner.queue).pipe(
          Stream.takeUntil((event) => event._tag !== "Notification"),
          Stream.mapEffect(eventFrame)
        )
      }))

    const failOwner = (
      id: JsonRpcId,
      owner: ClientOwner,
      failure: ClientFailure
    ): Effect.Effect<void> => removeOwner(id, owner).pipe(
      Effect.flatMap((removed) => removed
        ? enqueueFinal(owner, { _tag: "Failure", failure }).pipe(
          Effect.zipRight(abandonOwner(owner))
        )
        : Effect.void)
    )

    const cancelOwner = (
      id: JsonRpcId,
      owner: ClientOwner,
      failure: RequestCancelledError
    ): Effect.Effect<void> => removeOwner(id, owner).pipe(
      Effect.flatMap((removed) => removed
        ? enqueueFinal(owner, { _tag: "Failure", failure })
        : Effect.void)
    )

    const offerNotification = (
      id: JsonRpcId,
      owner: ClientOwner,
      message: JsonRpcNotification
    ): Effect.Effect<void> => Effect.sync(() => owner.queue.unsafeOffer({
      _tag: "Notification",
      frame: { _tag: "Notification", notification: message }
    })).pipe(Effect.flatMap((offered) => offered
      ? Effect.void
      : failOwner(id, owner, new TransportError({
        message: `Request ${formatId(id)} exceeded notification buffer capacity ${CLIENT_OWNER_BUFFER_CAPACITY}`
      }))))

    const routeNotification = (
      id: JsonRpcId,
      owner: ClientOwner,
      message: JsonRpcNotification
    ): Effect.Effect<void> => {
      const subscription = owner.subscription
      if (subscription === undefined) {
        if (message.method === "notifications/cancelled") return Effect.void
        const invalid = message.method === "notifications/progress"
          ? generatedNotificationFailure(message)
          : undefined
        return invalid === undefined ? offerNotification(id, owner, message) : failOwner(id, owner, invalid)
      }

      const invalid = generatedNotificationFailure(message)
      if (invalid !== undefined) return failOwner(id, owner, invalid)
      if (message.method === "notifications/cancelled") {
        const reason = isRecord(message.params) ? dataProperty(message.params, "reason") : undefined
        return cancelOwner(id, owner, new RequestCancelledError({
          requestId: id,
          ...(typeof reason === "string" ? { reason } : {})
        }))
      }

      if (subscription.acknowledgedFilter === undefined) {
        if (message.method !== "notifications/subscriptions/acknowledged" ||
          !exactId(id, subscriptionOwner(message))) {
          return failOwner(id, owner, new InvalidRequest({
            message: "Subscription must begin with its exact acknowledgement"
          }))
        }
        const acknowledged = isRecord(message.params)
          ? dataProperty(message.params, "notifications")
          : undefined
        if (!isRecord(acknowledged) || !isFilterSubset(acknowledged, subscriptionFilter(owner.request))) {
          return failOwner(id, owner, new InvalidRequest({
            message: "Subscription acknowledgement exceeds the requested filter"
          }))
        }
        subscription.acknowledgedFilter = acknowledged
        return offerNotification(id, owner, message)
      }

      if (!exactId(id, subscriptionOwner(message)) ||
        message.method === "notifications/subscriptions/acknowledged" ||
        !selectedSubscriptionNotification(message, subscription.acknowledgedFilter)) {
        return failOwner(id, owner, new InvalidRequest({
          message: "Subscription notification is not selected for this request"
        }))
      }
      return offerNotification(id, owner, message)
    }

    const accept: ClientDispatcher["accept"] = (message, acceptOptions) => {
      if (message._tag === "Request") {
        return Effect.fail(new InvalidRequest({ message: "Standalone inbound requests require a server-request handler" }))
      }
      if (message._tag === "Notification") {
        if (message.method === "notifications/cancelled") {
          const invalid = generatedNotificationFailure(message)
          if (invalid !== undefined) return Effect.fail(invalid)
          const ownerId = cancellationRequestId(message)
          if (ownerId === undefined) {
            return Effect.fail(new InvalidRequest({
              message: "Invalid params for notifications/cancelled"
            }))
          }
          return Ref.get(state).pipe(
            Effect.flatMap((current) => Option.match(HashMap.get(current.active, ownerId), {
              onNone: () => Effect.void,
              onSome: (owner) => routeNotification(ownerId, owner, message)
            }))
          )
        }
        return Ref.get(state).pipe(
          Effect.flatMap((current) => {
            const ownerId = acceptOptions?.ownerId ??
              subscriptionOwner(message) ??
              progressOwner(current, message)
            if (ownerId === undefined) return Effect.void
            return Option.match(HashMap.get(current.active, ownerId), {
              onNone: () => Effect.void,
              onSome: (owner) => routeNotification(ownerId, owner, message)
            })
          })
        )
      }

      return Ref.get(state).pipe(
        Effect.flatMap((current) => Option.match(HashMap.get(current.active, message.id), {
          onNone: () => Effect.void,
          onSome: (owner) => {
            if (owner.subscription !== undefined) {
              if (owner.subscription.acknowledgedFilter === undefined) {
                return failOwner(message.id, owner, new InvalidRequest({
                  message: "Subscription must be acknowledged before its terminal response"
                }))
              }
              const validation = validateSubscriptionTerminal(message.id, message)
              if (validation._tag !== "Valid") {
                return failOwner(message.id, owner, new InvalidRequest({
                  message: validation._tag === "Mismatch"
                    ? "Subscription terminal does not match its request"
                    : "Subscription terminal result is invalid",
                  ...(validation._tag === "Invalid" ? { cause: validation.cause } : {})
                }))
              }
            }
            return removeOwner(message.id, owner).pipe(
              Effect.flatMap((removed) => removed
                ? enqueueFinal(owner, {
                  _tag: "Terminal",
                  frame: message._tag === "SuccessResponse"
                    ? { _tag: "Success", response: message }
                    : { _tag: "Error", response: message }
                })
                : Effect.void)
            )
          }
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
            enqueueFinal(owner, { _tag: "Failure", failure }), { discard: true }))
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
          onSome: (owner) => enqueueFinal(owner, {
            _tag: "Failure",
            failure: new RequestCancelledError({
              requestId: id,
              ...(reason === undefined ? {} : { reason })
            })
          })
        }))
      )

    yield* Effect.addFinalizer(() => close())
    return { request, accept, cancel, close }
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
  readonly withGate: <A, E, R>(effect: Effect.Effect<A, E, R>) => Effect.Effect<A, E, R>
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
    const failures = yield* Queue.bounded<ServerDispatchFailure>(SERVER_FAILURE_BUFFER_CAPACITY)

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
    ): Effect.Effect<void, SendError> => owner.withGate(beginTerminal(request.id, owner).pipe(
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
    ))

    const sendOwnedNotification = (
      request: JsonRpcRequest,
      owner: ServerOwner,
      notification: JsonRpcNotification
    ): Effect.Effect<void, SendError | InvalidRequest> => owner.withGate(
      Effect.gen(function*() {
        const entry = HashMap.get(yield* Ref.get(active), request.id)
        if (Option.isNone(entry)) {
          return yield* new InvalidRequest({
            message: `Request id ${formatId(request.id)} is no longer active`
          })
        }
        if (entry.value.owner !== owner || entry.value.phase !== "Running") {
          return yield* new InvalidRequest({
            message: `Request id ${formatId(request.id)} no longer accepts notifications`
          })
        }
        yield* options.send(notification)
      })
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
      const context = requestContext(
        validatedRequest,
        owner,
        metadata,
        (notification) => sendOwnedNotification(request, owner, notification)
      )
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
      const gate = yield* Effect.makeSemaphore(1)
      const owner: ServerOwner = {
        cancelled: yield* Deferred.make<void>(),
        fiberReady: yield* Deferred.make<Fiber.RuntimeFiber<void, unknown>>(),
        withGate: gate.withPermits(1)
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
  send: (notification: JsonRpcNotification) => Effect.Effect<void, SendError | InvalidRequest>
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

const requestProgressToken = (request: JsonRpcRequest): unknown => {
  if (!isRecord(request.params)) return undefined
  const meta = dataProperty(request.params, "_meta")
  return isRecord(meta) ? dataProperty(meta, "progressToken") : undefined
}

const progressOwner = (
  state: ClientState,
  notification: JsonRpcNotification
): JsonRpcId | undefined => {
  if (notification.method !== "notifications/progress" || !isRecord(notification.params)) return undefined
  const token = dataProperty(notification.params, "progressToken")
  if (token === undefined) return undefined
  let matched: JsonRpcId | undefined
  for (const [id, owner] of HashMap.entries(state.active)) {
    if (!exactValue(owner.progressToken, token)) continue
    if (matched !== undefined) return undefined
    matched = id
  }
  return matched
}

const generatedNotificationFailure = (
  notification: JsonRpcNotification
): InvalidRequest | undefined => {
  if (!Object.hasOwn(SERVER_NOTIFICATION_PAYLOAD_CODEC_BY_METHOD, notification.method)) return undefined
  const codec = SERVER_NOTIFICATION_PAYLOAD_CODEC_BY_METHOD[
    notification.method as keyof typeof SERVER_NOTIFICATION_PAYLOAD_CODEC_BY_METHOD
  ]
  const decoded = Schema.decodeUnknownEither(codec as Schema.Schema.AnyNoContext)(notification.params)
  return Either.isLeft(decoded)
    ? new InvalidRequest({
      message: `Invalid params for ${notification.method}`,
      cause: decoded.left
    })
    : undefined
}

const subscriptionFilter = (request: JsonRpcRequest): Readonly<Record<string, unknown>> => {
  if (!isRecord(request.params)) return {}
  const notifications = dataProperty(request.params, "notifications")
  return isRecord(notifications) ? notifications : {}
}

const isFilterSubset = (
  acknowledged: Readonly<Record<string, unknown>>,
  requested: Readonly<Record<string, unknown>>
): boolean => {
  for (const key of ["toolsListChanged", "promptsListChanged", "resourcesListChanged"] as const) {
    if (acknowledged[key] === true && requested[key] !== true) return false
  }
  const acknowledgedUris = acknowledged["resourceSubscriptions"]
  if (!Array.isArray(acknowledgedUris)) return true
  const requestedUris = requested["resourceSubscriptions"]
  return Array.isArray(requestedUris) && acknowledgedUris.every((uri) =>
    typeof uri === "string" && requestedUris.includes(uri))
}

const selectedSubscriptionNotification = (
  notification: JsonRpcNotification,
  filter: Readonly<Record<string, unknown>>
): boolean => {
  if (notification.method === "notifications/tools/list_changed") return filter["toolsListChanged"] === true
  if (notification.method === "notifications/prompts/list_changed") return filter["promptsListChanged"] === true
  if (notification.method === "notifications/resources/list_changed") return filter["resourcesListChanged"] === true
  if (notification.method !== "notifications/resources/updated" || !isRecord(notification.params)) return false
  const selected = filter["resourceSubscriptions"]
  const uri = dataProperty(notification.params, "uri")
  return Array.isArray(selected) && typeof uri === "string" && selected.includes(uri)
}

const exactId = (left: JsonRpcId, right: unknown): boolean =>
  isJsonRpcId(right) && typeof left === typeof right && left === right

const exactValue = (left: unknown, right: unknown): boolean =>
  typeof left === typeof right && left === right

const dataProperty = (value: object, key: string): unknown => {
  const descriptor = Object.getOwnPropertyDescriptor(value, key)
  return descriptor !== undefined && "value" in descriptor ? descriptor.value : undefined
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
