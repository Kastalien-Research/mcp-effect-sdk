/**
 * MCP Streamable HTTP transport.
 *
 * Sends JSON-RPC messages via POST to a single endpoint.
 * Handles both application/json and text/event-stream (SSE)
 * responses. Manages MCP-Session-Id and MCP-Protocol-Version
 * headers automatically.
 *
 * Provides an RpcClient.Protocol — same slot as StdioTransport.
 */
import { Effect, Queue, Scope } from "effect"
import { McpClientError } from "../McpClientError.js"
import { mcpJson } from "../McpSerialization.js"
import type {
  RawMcpProtocol,
  RawMcpProtocolMessage
} from "../McpClientProtocol.js"

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export interface HttpTransportOptions {
  readonly url: string
  readonly headers?: Record<string, string>
}

/**
 * Connect to an MCP server over Streamable HTTP and return an
 * RpcClient.Protocol.
 *
 * Requires `Scope` — the transport is shut down on scope exit.
 */
export const make = (
  options: HttpTransportOptions
): Effect.Effect<
  RawMcpProtocol,
  McpClientError,
  Scope.Scope
> =>
  Effect.gen(function* () {
    const { url, headers: extraHeaders = {} } = options

    const parser = mcpJson.unsafeMake()
    const incoming = yield* Queue.unbounded<unknown>()

    // Mutable session state — accessed from async
    // fetch callbacks, same pattern as StdioTransport's
    // mutable buffer.
    let sessionId: string | undefined

    // Clean up on scope exit
    yield* Effect.addFinalizer(() =>
      Queue.shutdown(incoming)
    )

    // -- Build headers for each request --
    const buildHeaders = (): Record<string, string> => {
      const h: Record<string, string> = {
        "Content-Type": "application/json",
        Accept: "application/json, text/event-stream",
        ...extraHeaders
      }
      if (sessionId) {
        h["MCP-Session-Id"] = sessionId
        h["MCP-Protocol-Version"] = "2025-11-25"
      }
      return h
    }

    // -- SSE parsing (inline, no external dep) --
    // Per the SSE spec, consecutive `data:` lines within
    // a single block are concatenated with "\n". Each
    // double-newline-delimited block produces one event.
    const parseSseText = (
      text: string
    ): Array<string> => {
      const events: Array<string> = []
      const blocks = text.split("\n\n")
      for (const block of blocks) {
        if (!block.trim()) continue
        const dataParts: Array<string> = []
        for (const line of block.split("\n")) {
          if (line.startsWith("data: ")) {
            dataParts.push(line.slice(6))
          } else if (line.startsWith("data:")) {
            dataParts.push(line.slice(5))
          }
        }
        if (dataParts.length > 0) {
          events.push(dataParts.join("\n"))
        }
      }
      return events
    }

    // -- POST sender --
    // Uses Effect.die for errors (matching StdioTransport)
    // so the error channel stays `never`, satisfying
    // RpcClient.Protocol's `send` signature.
    const send: RawMcpProtocol["send"] = (msg) =>
      Effect.promise(() => new Promise<void>((resolve, reject) => {
        const encoded = parser.encode(msg)
        if (!encoded) {
          resolve()
          return
        }

        const body =
          typeof encoded === "string"
            ? encoded
            : new TextDecoder().decode(
                encoded as Uint8Array
              )

        const reqHeaders = buildHeaders()

        fetch(url, {
          method: "POST",
          headers: reqHeaders,
          body
        })
          .then(async (response) => {
            // Session expired
            if (response.status === 404) {
              reject(
                new McpClientError({
                  reason: "SessionExpired",
                  message:
                    "Server returned 404 — session expired"
                })
              )
              return
            }

            // 202 — notification accepted, no body
            if (response.status === 202) {
              resolve()
              return
            }

            // Non-success
            if (!response.ok) {
              const text = await response.text()
              reject(
                new McpClientError({
                  reason: "Transport",
                  message: `HTTP ${response.status}: ${text}`
                })
              )
              return
            }

            // Capture session ID
            const newSessionId =
              response.headers.get("mcp-session-id")
            if (newSessionId) {
              sessionId = newSessionId
            }

            const contentType =
              response.headers.get("content-type") ?? ""
            const text = await response.text()

            if (
              contentType.includes("text/event-stream")
            ) {
              for (const data of parseSseText(text)) {
                try {
                  for (const decoded of parser.decode(
                    data
                  )) {
                    Effect.runSync(Queue.offer(incoming, decoded))
                  }
                } catch {
                  // Skip malformed SSE data
                }
              }
            } else if (text.trim()) {
              try {
                for (const decoded of parser.decode(
                  text
                )) {
                  Effect.runSync(Queue.offer(incoming, decoded))
                }
              } catch {
                // Skip malformed JSON
              }
            }

            resolve()
          })
          .catch((err) => {
            reject(
              new McpClientError({
                reason: "Transport",
                message: `POST failed: ${err}`,
                cause: err
              })
            )
          })
      }))

    const run: RawMcpProtocol["run"] = (f) =>
      Effect.gen(function* () {
        return yield* Queue.take(incoming).pipe(
          Effect.flatMap((decoded) => {
            if (decoded === undefined) {
              return Effect.interrupt
            }
            return f(decoded as RawMcpProtocolMessage)
          }),
          Effect.forever
        )
      })

    return {
      send,
      run,
      supportsAck: false,
      supportsTransferables: false
    }
  })
