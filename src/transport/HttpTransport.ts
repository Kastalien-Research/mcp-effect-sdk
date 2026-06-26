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
import {
  auth,
  extractWWWAuthenticateParams,
  UnauthorizedError,
  type FetchLike,
  type OAuthClientProvider
} from "../auth/auth.js"
import type {
  RawMcpProtocol,
  RawMcpProtocolMessage
} from "../McpClientProtocol.js"
import {
  MCP_METHOD_HEADER,
  MCP_NAME_HEADER,
  MCP_PROTOCOL_VERSION_HEADER,
  MODERN_PROTOCOL_VERSION
} from "../McpModern.js"

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export interface HttpTransportOptions {
  readonly url: string
  readonly headers?: Record<string, string>
  readonly fetch?: FetchLike | undefined
  readonly authProvider?: OAuthClientProvider | undefined
  /**
   * Opt into draft/modern (`2026-07-28`) stateless HTTP headers.
   *
   * When enabled, POST requests always carry `MCP-Protocol-Version` and the
   * routable `Mcp-Method` / `Mcp-Name` headers required by the draft HTTP
   * binding. Legacy `MCP-Session-Id` is no longer emitted.
   */
  readonly modern?: boolean | undefined
  readonly protocolVersion?: string | undefined
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
    const { url, headers: extraHeaders = {}, authProvider } = options
    const modern = options.modern === true
    const protocolVersion = options.protocolVersion ?? MODERN_PROTOCOL_VERSION
    const fetchFn = options.fetch ?? fetch

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
    const buildHeaders = async (msg?: RawMcpProtocolMessage): Promise<Record<string, string>> => {
      const h: Record<string, string> = {
        "Content-Type": "application/json",
        Accept: "application/json, text/event-stream",
        ...extraHeaders
      }
      const tokens = await authProvider?.tokens()
      if (tokens) {
        h.Authorization = `Bearer ${tokens.access_token}`
      }
      const messageRecord = msg as unknown as { readonly _tag?: string; readonly tag?: string; readonly payload?: unknown } | undefined
      const method = messageRecord?._tag === "Request" ? messageRecord.tag : undefined
      if (modern) {
        h[MCP_PROTOCOL_VERSION_HEADER] = protocolVersion
        if (method) {
          h[MCP_METHOD_HEADER] = method
          const name = (messageRecord?.payload as { readonly name?: unknown } | undefined)?.name
          if (typeof name === "string") {
            h[MCP_NAME_HEADER] = name
          }
        }
      } else if (sessionId) {
        h["MCP-Session-Id"] = sessionId
        h["MCP-Protocol-Version"] = "2026-07-28"
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

        const requestOnce = async (): Promise<Response> => {
          const reqHeaders = await buildHeaders(msg)
          return fetchFn(url, {
            method: "POST",
            headers: reqHeaders,
            body
          })
        }

        requestOnce()
          .then(async (response) => {
            if ((response.status === 401 || response.status === 403) && authProvider) {
              const { resourceMetadataUrl, scope } = extractWWWAuthenticateParams(response)
              const result = await auth(authProvider, {
                serverUrl: url,
                resourceMetadataUrl,
                scope,
                fetchFn
              })
              if (result === "REDIRECT") {
                const authCode = await (
                  authProvider as { readonly getAuthCode?: () => Promise<string> | string }
                ).getAuthCode?.()
                if (!authCode) {
                  throw new UnauthorizedError("OAuth redirect completed without an authorization code")
                }
                await auth(authProvider, {
                  serverUrl: url,
                  resourceMetadataUrl,
                  scope,
                  authorizationCode: authCode,
                  fetchFn
                })
              }
              response = await requestOnce()
            }

            // The 2026-07-28 draft is sessionless: a 404 is just a transport
            // error (no session to expire). Broken streams require retrying
            // the original request with a new request id, not session recovery.
            if (response.status === 404) {
              reject(
                new McpClientError({
                  reason: "Transport",
                  message:
                    "Server returned 404 for the MCP endpoint"
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
              if (response.status === 401 || response.status === 403) {
                reject(new UnauthorizedError(text))
                return
              }
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
            if (!modern && newSessionId) {
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
