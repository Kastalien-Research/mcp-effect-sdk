/**
 * MCP notification channels — inbound and outbound.
 *
 * **Inbound** (server→client): Handler-based dispatch matching
 * the pattern used by all three official MCP SDKs (TypeScript,
 * Rust, Python). Handlers are registered by method name and
 * invoked fire-and-forget when a matching notification arrives.
 *
 */
import { Effect, HashMap, Option, Ref } from "effect"
import type { JsonRpcNotification } from "./McpWire.js"
import {
  isServerNotificationMethod,
  SERVER_NOTIFICATION_METHOD_BY_TYPE
} from "./generated/mcp/2026-07-28/McpProtocol.generated.js"
import type {
  ServerNotificationMethod,
  ServerNotificationType
} from "./generated/mcp/2026-07-28/McpProtocol.generated.js"

// ---------------------------------------------------------------------------
// Inbound: server → client notification dispatch
// ---------------------------------------------------------------------------

/** Handler for a single notification method's payload. */
export type NotificationHandler = (
  payload: unknown
) => Effect.Effect<void>

/** Catch-all handler receiving the full notification. */
export type FallbackHandler = (
  notification: JsonRpcNotification
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
    notification: JsonRpcNotification
  ) => Effect.Effect<void>
}

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
          if (!isServerNotificationMethod(notification.method)) {
            const fb = yield* Ref.get(fallbackRef)
            if (Option.isSome(fb)) {
              yield* fb.value(notification)
            }
            return
          }
          const map = yield* Ref.get(handlers)
          const handler = HashMap.get(
            map,
            notification.method
          )
          if (Option.isSome(handler)) {
            yield* handler.value(notification.params)
          } else {
            const fb = yield* Ref.get(fallbackRef)
            if (Option.isSome(fb)) {
              yield* fb.value(notification)
            }
          }
        })

      return { on, off, onFallback, dispatch }
    })
