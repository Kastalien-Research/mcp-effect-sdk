/**
 * MCP client protocol message router.
 *
 * Wraps a raw transport Protocol and demuxes incoming messages:
 * - Exit (responses) → forwarded to RpcClient handler
 * - Request (server-initiated) → serverRequests queue
 * - Notification (server→client) → notifications queue
 */
import * as RpcClient from "@effect/rpc/RpcClient"
import type { RpcClientError } from "@effect/rpc/RpcClientError"
import { Effect, Queue } from "effect"
import { ServerRequestRpcs } from "./McpSchema.js"

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface IncomingServerRequest {
  readonly id: string
  readonly tag: string
  readonly payload: unknown
}

export interface IncomingNotification {
  readonly tag: string
  readonly payload: unknown
}

export interface McpClientProtocol {
  /** Protocol for RpcClient — only forwards response messages. */
  readonly clientProtocol: RpcClient.Protocol["Type"]

  /** Queue of incoming server-initiated requests. */
  readonly serverRequests: Queue.Dequeue<IncomingServerRequest>

  /** Queue of incoming server notifications. */
  readonly notifications: Queue.Dequeue<IncomingNotification>

  /** Send a success response to a server-initiated request. */
  readonly respond: (
    requestId: string,
    value: unknown
  ) => Effect.Effect<void, RpcClientError>

  /** Send an error response to a server-initiated request. */
  readonly respondError: (
    requestId: string,
    error: {
      readonly code: number
      readonly message: string
      readonly data?: unknown
    }
  ) => Effect.Effect<void, RpcClientError>
}

// ---------------------------------------------------------------------------
// Internals
// ---------------------------------------------------------------------------

const serverRequestTags: ReadonlySet<string> = new Set(
  Array.from(ServerRequestRpcs.requests.keys())
)

function isNotification(tag: string): boolean {
  return tag.startsWith("notifications/")
}

// ---------------------------------------------------------------------------
// Constructor
// ---------------------------------------------------------------------------

/**
 * Wrap a raw transport Protocol and produce a routed McpClientProtocol.
 *
 * The raw protocol is typically provided by StdioTransport or HttpTransport.
 */
export const make = (
  rawProtocol: RpcClient.Protocol["Type"]
): Effect.Effect<McpClientProtocol, never, never> =>
  Effect.gen(function* () {
    const serverRequestQueue =
      yield* Queue.unbounded<IncomingServerRequest>()
    const notificationQueue =
      yield* Queue.unbounded<IncomingNotification>()

    const clientProtocol: RpcClient.Protocol["Type"] = {
      send: rawProtocol.send,
      supportsAck: false,
      supportsTransferables: false,
      run: (f) =>
        rawProtocol.run((message) => {
          // The serialization bridge produces mixed types;
          // cast to access _tag uniformly.
          const msg = message as unknown as Record<string, unknown>
          const _tag = msg["_tag"] as string

          switch (_tag) {
            // Responses to our outbound requests
            case "Exit":
            case "Chunk":
            case "Defect":
            case "Pong":
            case "ClientProtocolError":
              return f(message)

            // Server-initiated request or notification
            case "Request": {
              const method = msg["tag"] as string
              if (isNotification(method)) {
                return Queue.offer(notificationQueue, {
                  tag: method,
                  payload: msg["payload"]
                }).pipe(Effect.asVoid)
              }
              if (serverRequestTags.has(method)) {
                return Queue.offer(serverRequestQueue, {
                  id: msg["id"] as string,
                  tag: method,
                  payload: msg["payload"]
                }).pipe(Effect.asVoid)
              }
              // Unknown method — ignore
              return Effect.void
            }

            default:
              return f(message)
          }
        })
    }

    // Response helpers — send Exit messages through the raw
    // transport. The serialization bridge encodes them as
    // JSON-RPC responses.
    const respond = (
      requestId: string,
      value: unknown
    ): Effect.Effect<void, RpcClientError> =>
      rawProtocol.send({
        _tag: "Exit",
        requestId,
        exit: { _tag: "Success", value }
      } as never)

    const respondError = (
      requestId: string,
      error: {
        readonly code: number
        readonly message: string
        readonly data?: unknown
      }
    ): Effect.Effect<void, RpcClientError> =>
      rawProtocol.send({
        _tag: "Exit",
        requestId,
        exit: {
          _tag: "Failure",
          cause: { _tag: "Fail", error }
        }
      } as never)

    return {
      clientProtocol,
      serverRequests: serverRequestQueue,
      notifications: notificationQueue,
      respond,
      respondError
    }
  })
