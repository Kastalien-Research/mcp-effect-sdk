/**
 * MCP WebSocket client transport.
 */
import * as Effect from "effect/Effect"
import * as Queue from "effect/Queue"
import * as Scope from "effect/Scope"
import * as Stream from "effect/Stream"
import { McpClientError } from "../McpClientError.js"
import type {
  RawMcpProtocol,
  RawMcpProtocolMessage
} from "../McpClientProtocol.js"
import { mcpJson } from "../McpSerialization.js"

const subprotocol = "mcp"

export interface WebSocketClientTransportOptions {
  readonly url: string | URL
  readonly protocols?: string | ReadonlyArray<string> | undefined
}

export const make = (
  options: WebSocketClientTransportOptions
): Effect.Effect<RawMcpProtocol, McpClientError, Scope.Scope> =>
  Effect.gen(function*() {
    const parser = mcpJson.unsafeMake()
    const incoming = yield* Queue.unbounded<RawMcpProtocolMessage>()
    const protocols: string | Array<string> = typeof options.protocols === "string"
      ? options.protocols
      : options.protocols
      ? Array.from(options.protocols)
      : subprotocol
    const socket = yield* Effect.tryPromise({
      try: () =>
        new Promise<WebSocket>((resolve, reject) => {
          const ws = new WebSocket(options.url, protocols)
          ws.onopen = () => resolve(ws)
          ws.onerror = (event) => {
            reject(
              new Error(
                "error" in event
                  ? String(event.error)
                  : `WebSocket error: ${JSON.stringify(event)}`
              )
            )
          }
        }),
      catch: (cause) =>
        new McpClientError({
          reason: "Transport",
          message: `WebSocket connection failed: ${cause}`,
          cause
        })
    })

    yield* Effect.addFinalizer(() =>
      Effect.sync(() => {
        socket.close()
      }).pipe(Effect.andThen(Queue.shutdown(incoming)))
    )

    socket.onclose = () => {
      Effect.runFork(Queue.shutdown(incoming))
    }
    socket.onerror = (event) => {
      Effect.runFork(
        Queue.shutdown(incoming).pipe(
          Effect.andThen(Effect.logDebug(`WebSocket error: ${JSON.stringify(event)}`))
        )
      )
    }
    socket.onmessage = (event) => {
      try {
        const data = typeof event.data === "string"
          ? event.data
          : String(event.data)
        for (const message of parser.decode(data)) {
          Effect.runSync(Queue.offer(incoming, message))
        }
      } catch (cause) {
        Effect.runFork(Effect.logDebug(`Invalid WebSocket MCP message: ${String(cause)}`))
      }
    }

    return {
      send: (message) =>
        Effect.promise(() =>
          new Promise<void>((resolve, reject) => {
            const encoded = parser.encode(message)
            if (encoded === undefined) {
              resolve()
              return
            }
            try {
              socket.send(encoded)
              resolve()
            } catch (cause) {
              reject(cause)
            }
          })
        ),
      run: (f) =>
        Stream.fromQueue(incoming).pipe(
          Stream.runForEach(f),
          Effect.andThen(Effect.never)
        ) as Effect.Effect<never>,
      supportsAck: false,
      supportsTransferables: false
    }
  })
