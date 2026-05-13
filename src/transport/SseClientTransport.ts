/**
 * Legacy MCP SSE client transport.
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

export interface SseClientTransportOptions {
  readonly url: string | URL
  readonly headers?: Record<string, string> | undefined
  readonly fetch?: typeof fetch | undefined
}

interface SseEvent {
  readonly event: string
  readonly data: string
}

export const make = (
  options: SseClientTransportOptions
): Effect.Effect<RawMcpProtocol, McpClientError, Scope.Scope> =>
  Effect.gen(function*() {
    const parser = mcpJson.unsafeMake()
    const incoming = yield* Queue.unbounded<RawMcpProtocolMessage>()
    const abortController = new AbortController()
    const fetchImpl = options.fetch ?? fetch
    const baseUrl = new URL(options.url)
    let endpoint: URL | undefined

    yield* Effect.addFinalizer(() =>
      Effect.sync(() => abortController.abort()).pipe(
        Effect.andThen(Queue.shutdown(incoming))
      )
    )

    yield* Effect.tryPromise({
      try: async () => {
        const response = await fetchImpl(baseUrl, {
          headers: {
            Accept: "text/event-stream",
            ...options.headers
          },
          signal: abortController.signal
        })
        if (!response.ok || response.body === null) {
          throw new Error(`SSE connection failed with HTTP ${response.status}`)
        }

        const reader = response.body.getReader()
        const decoder = new TextDecoder()
        let buffer = ""
        let endpointResolved = false

        const processBlock = (block: string) => {
          const event = parseSseEvent(block)
          if (!event) return
          if (event.event === "endpoint") {
            endpoint = new URL(event.data, baseUrl)
            if (endpoint.origin !== baseUrl.origin) {
              throw new Error(`SSE endpoint origin mismatch: ${endpoint.origin}`)
            }
            endpointResolved = true
            return
          }
          if (event.event === "message" || event.event === "") {
            for (const message of parser.decode(event.data)) {
              Effect.runSync(Queue.offer(incoming, message))
            }
          }
        }

        while (!endpointResolved) {
          const { done, value } = await reader.read()
          if (done) {
            throw new Error("SSE stream ended before endpoint event")
          }
          buffer += decoder.decode(value, { stream: true })
          const blocks = buffer.split("\n\n")
          buffer = blocks.pop() ?? ""
          for (const block of blocks) {
            processBlock(block)
            if (endpointResolved) break
          }
        }

        void (async () => {
          try {
            while (true) {
              const { done, value } = await reader.read()
              if (done) break
              buffer += decoder.decode(value, { stream: true })
              const blocks = buffer.split("\n\n")
              buffer = blocks.pop() ?? ""
              for (const block of blocks) {
                processBlock(block)
              }
            }
          } catch (cause) {
            if (!abortController.signal.aborted) {
              Effect.runFork(Effect.logDebug(`SSE stream failed: ${String(cause)}`))
            }
          } finally {
            Effect.runFork(Queue.shutdown(incoming))
          }
        })()
      },
      catch: (cause) =>
        new McpClientError({
          reason: "Transport",
          message: `SSE connection failed: ${cause}`,
          cause
        })
    })

    return {
      send: (message) =>
        Effect.promise(async () => {
            if (!endpoint) {
              throw new Error("SSE endpoint is not established")
            }
            const encoded = parser.encode(message)
            if (encoded === undefined) return
            const body = typeof encoded === "string"
              ? encoded
              : new TextDecoder().decode(encoded)
            const response = await fetchImpl(endpoint, {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
                ...options.headers
              },
              body,
              signal: abortController.signal
            })
            if (!response.ok) {
              throw new Error(`SSE POST failed with HTTP ${response.status}`)
            }
          }),
      run: (f) =>
        Stream.fromQueue(incoming).pipe(
          Stream.runForEach(f),
          Effect.andThen(Effect.never)
        ) as Effect.Effect<never>,
      supportsAck: false,
      supportsTransferables: false
    }
  })

const parseSseEvent = (block: string): SseEvent | undefined => {
  const data: Array<string> = []
  let event = ""
  for (const line of block.split("\n")) {
    if (line.startsWith("event:")) {
      event = line.slice("event:".length).trim()
    } else if (line.startsWith("data:")) {
      data.push(line.slice("data:".length).trimStart())
    }
  }
  if (data.length === 0) {
    return undefined
  }
  return { event, data: data.join("\n") }
}
