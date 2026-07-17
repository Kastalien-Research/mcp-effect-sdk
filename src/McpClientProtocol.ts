/**
 * MCP client protocol message router.
 *
 * Wraps a raw transport Protocol and demuxes incoming messages:
 * - Exit (responses) → forwarded to RpcClient handler
 * - Request (server-initiated) → serverRequests queue
 * - Notification (server→client) → notifications queue
 */
import { Effect, Queue } from "effect"
import type { McpClientError } from "./McpClientError.js"
import {
  isServerNotificationMethod,
  isServerRequestMethod
} from "./generated/mcp/McpProtocol.generated.js"

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
  readonly clientProtocol: ClientRpcProtocol

  /** Queue of incoming server-initiated requests. */
  readonly serverRequests: Queue.Dequeue<IncomingServerRequest>

  /** Queue of incoming server notifications. */
  readonly notifications: Queue.Dequeue<IncomingNotification>

  /** Send a success response to a server-initiated request. */
  readonly respond: (
    requestId: string,
    value: unknown
  ) => Effect.Effect<void, McpClientError>

  /** Send an error response to a server-initiated request. */
  readonly respondError: (
    requestId: string,
    error: {
      readonly code: number
      readonly message: string
      readonly data?: unknown
    }
  ) => Effect.Effect<void, McpClientError>
}

interface ClientRpcProtocol {
  readonly run: (
    f: (message: RawMcpProtocolMessage) => Effect.Effect<void>
  ) => Effect.Effect<never>
  readonly send: (
    request: RawMcpProtocolMessage,
    transferables?: ReadonlyArray<unknown>
  ) => Effect.Effect<void, McpClientError>
  readonly supportsAck: boolean
  readonly supportsTransferables: boolean
}

export type RawMcpProtocolMessage =
  Record<string, unknown>

export interface RawMcpProtocol {
  readonly send: (
    message: RawMcpProtocolMessage
  ) => Effect.Effect<void, McpClientError>
  readonly run: (
    f: (message: RawMcpProtocolMessage) => Effect.Effect<void>
  ) => Effect.Effect<never>
}

const isFromServerMessage = (
  message: RawMcpProtocolMessage
): message is RawMcpProtocolMessage => {
  switch (message._tag) {
    case "Exit":
    case "Chunk":
    case "Defect":
    case "Pong":
    case "ClientProtocolError":
      return true
    case "Request":
    case "Ack":
    case "Interrupt":
    case "Ping":
    case "Eof":
      return false
    default:
      return false
  }
}

// ---------------------------------------------------------------------------
// Internals
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Constructor
// ---------------------------------------------------------------------------

/**
 * Wrap a raw transport Protocol and produce a routed McpClientProtocol.
 *
 * The raw protocol is typically provided by StdioTransport or HttpTransport.
 */
export const make = (
  rawProtocol: RawMcpProtocol
): Effect.Effect<McpClientProtocol, never, never> =>
  Effect.gen(function* () {
    const serverRequestQueue =
      yield* Queue.unbounded<IncomingServerRequest>()
    const notificationQueue =
      yield* Queue.unbounded<IncomingNotification>()

    const clientProtocol: ClientRpcProtocol = {
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
              return isFromServerMessage(message) ? f(message) : Effect.void

            // Server-initiated request or notification
            case "Request": {
              const method = msg["tag"] as string
              if (isServerNotificationMethod(method)) {
                return Queue.offer(notificationQueue, {
                  tag: method,
                  payload: msg["payload"]
                }).pipe(Effect.asVoid)
              }
              if (isServerRequestMethod(method)) {
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
              return isFromServerMessage(message) ? f(message) : Effect.void
          }
        })
    }

    // Response helpers — send Exit messages through the raw
    // transport. The serialization bridge encodes them as
    // JSON-RPC responses.
    const respond = (
      requestId: string,
      value: unknown
    ): Effect.Effect<void, McpClientError> =>
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
    ): Effect.Effect<void, McpClientError> =>
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
