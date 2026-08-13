/** Stateful Streamable HTTP client transport for MCP 2025-11-25. */
import * as Data from "effect/Data"
import * as Effect from "effect/Effect"
import * as Either from "effect/Either"
import * as Fiber from "effect/Fiber"
import * as Queue from "effect/Queue"
import * as Ref from "effect/Ref"
import type * as Scope from "effect/Scope"
import * as Stream from "effect/Stream"
import type { JsonRpcMessage } from "../McpWire.js"
import { decodeJsonRpc, encodeJsonRpcText } from "./LegacyWire.js"
import type { LegacyDuplexTransport } from "./Connection.js"
import { LEGACY_PROTOCOL_VERSION } from "./LegacyClient.js"

export const MCP_SESSION_ID_HEADER = "Mcp-Session-Id" as const
export const MCP_PROTOCOL_VERSION_HEADER = "MCP-Protocol-Version" as const

export class LegacyHttpClientError extends Data.TaggedError("LegacyHttpClientError")<{
  readonly stage: "Encode" | "Fetch" | "Http" | "Decode" | "Closed"
  readonly message: string
  readonly status?: number
  readonly cause?: unknown
}> {}

export interface LegacyHttpClientOptions {
  readonly url: string | URL
  readonly fetch?: typeof globalThis.fetch
  readonly headers?: Readonly<Record<string, string>>
  readonly signal?: AbortSignal
  readonly reconnectDelayMs?: number
  readonly openListenerAfterInitialize?: boolean
  readonly onMessage?: (direction: "inbound" | "outbound", message: JsonRpcMessage) => Effect.Effect<void>
}

export interface LegacyHttpClientTransport extends LegacyDuplexTransport<LegacyHttpClientError> {
  readonly sessionId: Effect.Effect<string | undefined>
  readonly selectProtocolVersion: (version: string) => Effect.Effect<void>
}

const error = (
  stage: LegacyHttpClientError["stage"],
  message: string,
  options: { readonly status?: number; readonly cause?: unknown } = {}
) => new LegacyHttpClientError({ stage, message, ...options })

const decodeAndOffer = (
  queue: Queue.Queue<JsonRpcMessage>,
  input: unknown,
  onMessage?: LegacyHttpClientOptions["onMessage"]
): Effect.Effect<void, LegacyHttpClientError> => {
  const decoded = decodeJsonRpc(input)
  return Either.isLeft(decoded)
    ? Effect.fail(error("Decode", "Invalid JSON-RPC message from HTTP server", { cause: decoded.left }))
    : (onMessage === undefined ? Effect.void : onMessage("inbound", decoded.right)).pipe(
        Effect.zipRight(Queue.offer(queue, decoded.right)),
        Effect.asVoid
      )
}

const parseSseBlock = (block: string): { readonly data?: string; readonly id?: string; readonly retry?: number } => {
  const data: string[] = []
  let id: string | undefined
  let retry: number | undefined
  for (const line of block.split(/\r?\n/)) {
    if (line.startsWith("data:")) data.push(line.slice(5).replace(/^ /, ""))
    else if (line.startsWith("id:")) id = line.slice(3).replace(/^ /, "")
    else if (line.startsWith("retry:")) {
      const value = Number(line.slice(6).trim())
      if (Number.isSafeInteger(value) && value >= 0) retry = value
    }
  }
  return {
    ...(data.length === 0 ? {} : { data: data.join("\n") }),
    ...(id === undefined ? {} : { id }),
    ...(retry === undefined ? {} : { retry })
  }
}

const consumeSse = (
  response: Response,
  queue: Queue.Queue<JsonRpcMessage>,
  lastEventId: Ref.Ref<string | undefined>,
  retryDelay: Ref.Ref<number>,
  onMessage?: LegacyHttpClientOptions["onMessage"]
): Effect.Effect<void, LegacyHttpClientError> =>
  Effect.gen(function* () {
    if (response.body === null) return yield* Effect.fail(error("Decode", "SSE response has no body"))
    const reader = response.body.getReader()
    const decoder = new TextDecoder()
    let buffered = ""
    while (true) {
      const chunk = yield* Effect.async<ReadableStreamReadResult<Uint8Array>, LegacyHttpClientError>((resume) => {
        reader.read().then(
          (result) => resume(Effect.succeed(result)),
          (cause) => resume(Effect.fail(error("Fetch", "Could not read SSE response", { cause })))
        )
        return Effect.promise(() => reader.cancel("SSE consumer interrupted")).pipe(Effect.ignore)
      })
      buffered += decoder.decode(chunk.value ?? new Uint8Array(), { stream: !chunk.done })
      const blocks = buffered.split(/\r?\n\r?\n/)
      buffered = blocks.pop() ?? ""
      for (const block of blocks) {
        const event = parseSseBlock(block)
        if (event.id !== undefined) yield* Ref.set(lastEventId, event.id)
        if (event.retry !== undefined) yield* Ref.set(retryDelay, event.retry)
        if (event.data !== undefined && event.data !== "") {
          let json: unknown
          try {
            json = JSON.parse(event.data)
          } catch (cause) {
            return yield* Effect.fail(error("Decode", "Invalid JSON in SSE data", { cause }))
          }
          yield* decodeAndOffer(queue, json, onMessage)
        }
      }
      if (chunk.done) break
    }
  })

export const make = (options: LegacyHttpClientOptions): Effect.Effect<LegacyHttpClientTransport, never, Scope.Scope> =>
  Effect.gen(function* () {
    const fetch = options.fetch ?? globalThis.fetch
    const url = String(options.url)
    const queue = yield* Queue.unbounded<JsonRpcMessage>()
    const sessionId = yield* Ref.make<string | undefined>(undefined)
    const lastEventId = yield* Ref.make<string | undefined>(undefined)
    const retryDelay = yield* Ref.make(options.reconnectDelayMs ?? 1000)
    const protocolVersion = yield* Ref.make<string>(LEGACY_PROTOCOL_VERSION)
    const closed = yield* Ref.make(false)
    const listener = yield* Ref.make<Fiber.RuntimeFiber<void, never> | undefined>(undefined)

    const headers = (accept: string, includeVersion: boolean): Headers => {
      const value = new Headers(options.headers)
      value.set("Accept", accept)
      const session = Ref.get(sessionId).pipe(Effect.runSync)
      if (session !== undefined) value.set(MCP_SESSION_ID_HEADER, session)
      if (includeVersion) value.set(MCP_PROTOCOL_VERSION_HEADER, Ref.get(protocolVersion).pipe(Effect.runSync))
      const eventId = Ref.get(lastEventId).pipe(Effect.runSync)
      if (eventId !== undefined && accept === "text/event-stream") value.set("Last-Event-ID", eventId)
      return value
    }

    const fetchResponse = (input: RequestInit): Effect.Effect<Response, LegacyHttpClientError> =>
      Effect.async((resume) => {
        const controller = new AbortController()
        const onAbort = () => controller.abort(options.signal?.reason)
        options.signal?.addEventListener("abort", onAbort, { once: true })
        fetch(url, { ...input, signal: controller.signal }).then(
          (response) => resume(Effect.succeed(response)),
          (cause) => resume(Effect.fail(error("Fetch", "Streamable HTTP request failed", { cause })))
        )
        return Effect.sync(() => {
          options.signal?.removeEventListener("abort", onAbort)
          controller.abort("request interrupted")
        })
      })

    const listenLoop: Effect.Effect<void, never> = Effect.forever(
      Effect.gen(function* () {
        if (yield* Ref.get(closed)) return yield* Effect.interrupt
        const response = yield* fetchResponse({ method: "GET", headers: headers("text/event-stream", true) }).pipe(
          Effect.either
        )
        if (Either.isRight(response) && response.right.status === 200) {
          yield* consumeSse(response.right, queue, lastEventId, retryDelay, options.onMessage).pipe(
            Effect.catchAll(() => Effect.void)
          )
        } else if (Either.isRight(response) && response.right.status === 405) {
          return yield* Effect.interrupt
        }
        yield* Effect.sleep(`${yield* Ref.get(retryDelay)} millis`)
      })
    ).pipe(Effect.catchAllCause(() => Effect.void))

    const startListener = Effect.gen(function* () {
      if ((yield* Ref.get(listener)) !== undefined) return
      const fiber = yield* Effect.forkDaemon(listenLoop)
      yield* Ref.set(listener, fiber)
    })

    const send = (message: JsonRpcMessage): Effect.Effect<void, LegacyHttpClientError> =>
      Effect.gen(function* () {
        if (yield* Ref.get(closed)) return yield* Effect.fail(error("Closed", "HTTP transport is closed"))
        const encoded = encodeJsonRpcText(message)
        if (Either.isLeft(encoded))
          return yield* Effect.fail(error("Encode", "Invalid JSON-RPC message", { cause: encoded.left }))
        if (options.onMessage !== undefined) yield* options.onMessage("outbound", message)
        const initializing = message._tag === "Request" && message.method === "initialize"
        const response = yield* fetchResponse({
          method: "POST",
          headers: (() => {
            const value = headers("application/json, text/event-stream", !initializing)
            value.set("Content-Type", "application/json")
            return value
          })(),
          body: encoded.right
        })
        if (initializing && response.ok) {
          const assigned = response.headers.get(MCP_SESSION_ID_HEADER)
          if (assigned !== null) yield* Ref.set(sessionId, assigned)
        }
        if (response.status === 404 && (yield* Ref.get(sessionId)) !== undefined) {
          yield* Ref.set(sessionId, undefined)
          return yield* Effect.fail(error("Http", "MCP session expired; reinitialize", { status: 404 }))
        }
        if (message._tag === "Notification" || message._tag === "SuccessResponse" || message._tag === "ErrorResponse") {
          if (response.status < 200 || response.status >= 300)
            return yield* Effect.fail(error("Http", "HTTP server rejected message", { status: response.status }))
          if (
            message._tag === "Notification" &&
            message.method === "notifications/initialized" &&
            (yield* Ref.get(sessionId)) !== undefined
          ) {
            if (options.openListenerAfterInitialize !== false) {
              yield* startListener
              // Let the GET/SSE listener reach the server before the caller can
              // issue work that triggers an immediate server-initiated request.
              yield* Effect.sleep("25 millis")
            }
          }
          return
        }
        if (!response.ok)
          return yield* Effect.fail(error("Http", "HTTP server rejected request", { status: response.status }))
        const contentType = response.headers.get("content-type")?.toLowerCase() ?? ""
        if (contentType.includes("text/event-stream")) {
          yield* consumeSse(response, queue, lastEventId, retryDelay, options.onMessage)
          if ((yield* Ref.get(listener)) === undefined) {
            yield* Effect.sleep(`${yield* Ref.get(retryDelay)} millis`)
            yield* startListener
          }
          return
        }
        if (!contentType.includes("application/json")) {
          return yield* Effect.fail(error("Decode", "Request response must be JSON or SSE"))
        }
        const json = yield* Effect.tryPromise({
          try: () => response.json(),
          catch: (cause) => error("Decode", "Invalid JSON response", { cause })
        })
        yield* decodeAndOffer(queue, json, options.onMessage)
      })

    const close = Ref.getAndSet(closed, true).pipe(
      Effect.flatMap((wasClosed) => {
        if (wasClosed) return Effect.void
        return Effect.gen(function* () {
          const fiber = yield* Ref.get(listener)
          if (fiber !== undefined) yield* Fiber.interrupt(fiber)
          const session = yield* Ref.get(sessionId)
          if (session !== undefined) {
            yield* fetchResponse({ method: "DELETE", headers: headers("application/json", true) }).pipe(
              Effect.catchAll(() => Effect.void),
              Effect.asVoid
            )
          }
          yield* Queue.shutdown(queue)
        })
      })
    )
    yield* Effect.addFinalizer(() => close)
    return {
      messages: Stream.fromQueue(queue),
      send,
      close,
      sessionId: Ref.get(sessionId),
      selectProtocolVersion: (version) => Ref.set(protocolVersion, version)
    }
  })
