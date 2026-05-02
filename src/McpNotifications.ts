/**
 * MCP notification channels — inbound and outbound.
 *
 * **Inbound** (server→client): Handler-based dispatch matching
 * the pattern used by all three official MCP SDKs (TypeScript,
 * Rust, Python). Handlers are registered by method name and
 * invoked fire-and-forget when a matching notification arrives.
 *
 * **Outbound** (client→server): Send functions for client
 * notifications (cancelled, progress, rootsListChanged).
 */
import type { RpcClientError } from "@effect/rpc/RpcClientError"
import type * as RpcMessage from "@effect/rpc/RpcMessage"
import { Effect, HashMap, Option, Ref } from "effect"
import type { IncomingNotification } from "./McpClientProtocol.js"
import {
  CLIENT_NOTIFICATION_METHOD_BY_TYPE,
  isServerNotificationMethod,
  SERVER_NOTIFICATION_METHOD_BY_TYPE
} from "./generated/mcp/McpProtocol.generated.js"
import type {
  ClientNotificationMethod,
  ClientNotificationType,
  ServerNotificationMethod,
  ServerNotificationType
} from "./generated/mcp/McpProtocol.generated.js"

// ---------------------------------------------------------------------------
// Inbound: server → client notification dispatch
// ---------------------------------------------------------------------------

/** Handler for a single notification method's payload. */
export type NotificationHandler = (
  payload: unknown
) => Effect.Effect<void>

/** Catch-all handler receiving the full notification. */
export type FallbackHandler = (
  notification: IncomingNotification
) => Effect.Effect<void>

export interface InboundDispatcher {
  /** Register a handler for a notification method. */
  readonly on: (
    method: string,
    handler: NotificationHandler
  ) => Effect.Effect<void>

  /** Remove the handler for a notification method. */
  readonly off: (method: string) => Effect.Effect<void>

  /** Set a fallback handler for unhandled notifications. */
  readonly onFallback: (
    handler: FallbackHandler
  ) => Effect.Effect<void>

  /** Dispatch a notification to the matching handler. */
  readonly dispatch: (
    notification: IncomingNotification
  ) => Effect.Effect<void>
}

export const clientNotificationMethod = (
  type: ClientNotificationType
): ClientNotificationMethod => CLIENT_NOTIFICATION_METHOD_BY_TYPE[type]

export const serverNotificationMethod = (
  type: ServerNotificationType
): ServerNotificationMethod => SERVER_NOTIFICATION_METHOD_BY_TYPE[type]

/**
 * Create an inbound notification dispatcher.
 *
 * Register handlers by method name with `on()`. When `dispatch()`
 * is called (by the message loop in McpClient), the matching
 * handler fires. Unhandled notifications go to the fallback
 * handler if set, otherwise they are silently dropped.
 */
export const makeInboundDispatcher =
  (): Effect.Effect<InboundDispatcher> =>
    Effect.gen(function* () {
      const handlers = yield* Ref.make(
        HashMap.empty<string, NotificationHandler>()
      )
      const fallbackRef = yield* Ref.make(
        Option.none<FallbackHandler>()
      )

      const on: InboundDispatcher["on"] = (method, handler) =>
        Ref.update(handlers, HashMap.set(method, handler))

      const off: InboundDispatcher["off"] = (method) =>
        Ref.update(handlers, HashMap.remove(method))

      const onFallback: InboundDispatcher["onFallback"] = (
        handler
      ) => Ref.set(fallbackRef, Option.some(handler))

      const dispatch: InboundDispatcher["dispatch"] = (
        notification
      ) =>
        Effect.gen(function* () {
          if (!isServerNotificationMethod(notification.tag)) {
            const fb = yield* Ref.get(fallbackRef)
            if (Option.isSome(fb)) {
              yield* fb.value(notification)
            }
            return
          }
          const map = yield* Ref.get(handlers)
          const handler = HashMap.get(
            map,
            notification.tag
          )
          if (Option.isSome(handler)) {
            yield* handler.value(notification.payload)
          } else {
            const fb = yield* Ref.get(fallbackRef)
            if (Option.isSome(fb)) {
              yield* fb.value(notification)
            }
          }
        })

      return { on, off, onFallback, dispatch }
    })

// ---------------------------------------------------------------------------
// Outbound: client → server notifications
// ---------------------------------------------------------------------------

interface OutboundNotificationProtocol {
  readonly send: (
    request: RpcMessage.FromClientEncoded
  ) => Effect.Effect<void, RpcClientError>
}

/**
 * Create outbound notification senders that use the transport
 * Protocol to send client→server notifications.
 */
export function outbound(protocol: OutboundNotificationProtocol) {
  const sendNotification = (
    method: ClientNotificationMethod,
    payload?: unknown
  ): Effect.Effect<void, RpcClientError> =>
    protocol.send({
      _tag: "Request",
      id: "",
      tag: method,
      payload: payload ?? {},
      headers: []
    } as never)

  return {
    sendCancelled: (params: {
      readonly requestId: string | number
      readonly reason?: string
    }): Effect.Effect<void, RpcClientError> =>
      sendNotification(
        clientNotificationMethod("CancelledNotification"),
        params
      ),

    sendProgress: (params: {
      readonly progressToken: string | number
      readonly progress: number
      readonly total?: number
      readonly message?: string
    }): Effect.Effect<void, RpcClientError> =>
      sendNotification(
        clientNotificationMethod("ProgressNotification"),
        params
      ),

    sendRootsListChanged: (): Effect.Effect<
      void,
      RpcClientError
    > =>
      sendNotification(
        clientNotificationMethod("RootsListChangedNotification")
      ),

    sendInitialized: (): Effect.Effect<
      void,
      RpcClientError
    > =>
      sendNotification(
        clientNotificationMethod("InitializedNotification")
      ),

    sendTaskStatus: (params: unknown): Effect.Effect<
      void,
      RpcClientError
    > =>
      sendNotification(
        clientNotificationMethod("TaskStatusNotification"),
        params
      )
  }
}
