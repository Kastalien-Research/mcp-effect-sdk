/** Stateful Streamable HTTP server boundary for MCP 2025-11-25. */
import { randomUUID } from "node:crypto"
import * as Data from "effect/Data"
import * as Effect from "effect/Effect"
import * as Either from "effect/Either"
import * as Exit from "effect/Exit"
import * as Queue from "effect/Queue"
import * as Scope from "effect/Scope"
import * as Stream from "effect/Stream"
import type { JsonRpcId, JsonRpcMessage } from "../McpWire.js"
import { decodeJsonRpc, encodeJsonRpcText } from "./LegacyWire.js"
import type { LegacyDuplexTransport } from "./Connection.js"
import { MCP_PROTOCOL_VERSION_HEADER, MCP_SESSION_ID_HEADER } from "./LegacyHttpClient.js"
import { LEGACY_PROTOCOL_VERSION } from "./LegacyClient.js"
import { make as makeServer, type LegacyServer, type LegacyServerOptions } from "./LegacyServer.js"

export class LegacyHttpServerError extends Data.TaggedError("LegacyHttpServerError")<{
  readonly stage: "Configuration" | "Decode" | "Session" | "Runtime"
  readonly message: string
  readonly cause?: unknown
}> {}

export interface LegacyHttpServerOptions extends Omit<LegacyServerOptions<never>, "transport"> {
  readonly path?: string
  readonly allowedOrigins?: ReadonlyArray<string>
  readonly allowedHosts?: ReadonlyArray<string>
  readonly maxBodyBytes?: number
  readonly sessionTtlMs?: number
  readonly sessionId?: () => string
  readonly onSession?: (server: LegacyServer, sessionId: string) => Effect.Effect<void>
  readonly onMessage?: (
    direction: "inbound" | "outbound",
    message: JsonRpcMessage,
    sessionId: string
  ) => Effect.Effect<void>
}

export interface LegacyHttpServer {
  readonly handle: (request: Request) => Effect.Effect<Response, LegacyHttpServerError>
  readonly close: Effect.Effect<void>
  readonly sessionCount: Effect.Effect<number>
}

interface Session {
  readonly id: string
  readonly scope: Scope.CloseableScope
  readonly server: LegacyServer
  readonly inbound: Queue.Queue<JsonRpcMessage>
  readonly outbound: Queue.Queue<JsonRpcMessage>
  readonly responses: Map<JsonRpcId, Queue.Queue<JsonRpcMessage>>
  readonly events: Array<{ readonly id: string; readonly message: JsonRpcMessage }>
  nextEventId: number
  lastAccess: number
}

const bodyless = (status: number, headers?: HeadersInit) => new Response(null, { status, headers })
const isJson = (value: string | null) => value?.toLowerCase().split(";", 1)[0].trim() === "application/json"
const accepts = (request: Request, type: string) =>
  (request.headers.get("accept") ?? "")
    .toLowerCase()
    .split(",")
    .some((part) => part.trim().split(";", 1)[0] === type)

const sseResponse = (session: Session, lastEventId?: string, onClose?: () => void): Response => {
  const encoder = new TextEncoder()
  const replay =
    lastEventId === undefined
      ? []
      : (() => {
          const index = session.events.findIndex(({ id }) => id === lastEventId)
          return index === -1 ? [] : session.events.slice(index + 1)
        })()
  let closed = false
  return new Response(
    new ReadableStream<Uint8Array>({
      start(controller) {
        const id = `${session.id}:${session.nextEventId++}`
        controller.enqueue(encoder.encode(`id: ${id}\nretry: 1000\ndata:\n\n`))
      },
      async pull(controller) {
        if (closed) return
        try {
          const replayEvent = replay.shift()
          const message = replayEvent?.message ?? (await Effect.runPromise(Queue.take(session.outbound)))
          const encoded = encodeJsonRpcText(message)
          if (Either.isLeft(encoded)) throw encoded.left
          const id = replayEvent?.id ?? `${session.id}:${session.nextEventId++}`
          if (replayEvent === undefined) {
            session.events.push({ id, message })
            if (session.events.length > 1000) session.events.shift()
          }
          controller.enqueue(encoder.encode(`id: ${id}\ndata: ${encoded.right}\n\n`))
        } catch (cause) {
          closed = true
          controller.error(cause)
          onClose?.()
        }
      },
      cancel() {
        closed = true
        onClose?.()
      }
    }),
    {
      status: 200,
      headers: {
        "Cache-Control": "no-cache, no-transform",
        Connection: "keep-alive",
        "Content-Type": "text/event-stream"
      }
    }
  )
}

export const make = (
  options: LegacyHttpServerOptions
): Effect.Effect<LegacyHttpServer, LegacyHttpServerError, Scope.Scope> =>
  Effect.gen(function* () {
    const path = options.path ?? "/mcp"
    const maxBodyBytes = options.maxBodyBytes ?? 1024 * 1024
    const sessionTtlMs = options.sessionTtlMs ?? 30 * 60 * 1000
    const makeSessionId = options.sessionId ?? randomUUID
    const sessions = new Map<string, Session>()

    if (!path.startsWith("/")) {
      return yield* Effect.fail(
        new LegacyHttpServerError({ stage: "Configuration", message: "HTTP path must be absolute" })
      )
    }

    const destroy = (id: string): Effect.Effect<void> => {
      const session = sessions.get(id)
      if (session === undefined) return Effect.void
      sessions.delete(id)
      return Scope.close(session.scope, Exit.void).pipe(Effect.catchAllCause(() => Effect.void))
    }

    const prune = Effect.forEach(
      [...sessions.values()].filter((session) => Date.now() - session.lastAccess >= sessionTtlMs),
      (session) => destroy(session.id),
      { discard: true }
    )

    const createSession = (): Effect.Effect<Session, LegacyHttpServerError> =>
      Effect.gen(function* () {
        let id = makeSessionId()
        while (sessions.has(id)) id = makeSessionId()
        if (!/^[\x21-\x7e]+$/.test(id)) {
          return yield* Effect.fail(
            new LegacyHttpServerError({
              stage: "Configuration",
              message: "Session IDs must contain visible ASCII characters only"
            })
          )
        }
        const scope = yield* Scope.make()
        const inbound = yield* Queue.unbounded<JsonRpcMessage>()
        const outbound = yield* Queue.unbounded<JsonRpcMessage>()
        const responses = new Map<JsonRpcId, Queue.Queue<JsonRpcMessage>>()
        const transport: LegacyDuplexTransport<never> = {
          messages: Stream.fromQueue(inbound),
          send: (message) => {
            const publish =
              message._tag === "SuccessResponse" || message._tag === "ErrorResponse"
                ? (responses.get(message.id) ?? outbound)
                : outbound
            return (options.onMessage === undefined ? Effect.void : options.onMessage("outbound", message, id)).pipe(
              Effect.zipRight(Queue.offer(publish, message)),
              Effect.asVoid
            )
          }
        }
        const server = yield* makeServer({
          ...options,
          transport
        }).pipe(Effect.provideService(Scope.Scope, scope))
        const session: Session = {
          id,
          scope,
          server,
          inbound,
          outbound,
          responses,
          events: [],
          nextEventId: 1,
          lastAccess: Date.now()
        }
        sessions.set(id, session)
        if (options.onSession !== undefined) yield* options.onSession(server, id)
        return session
      })

    const readMessage = (request: Request): Effect.Effect<JsonRpcMessage, LegacyHttpServerError> =>
      Effect.gen(function* () {
        const bytes = new Uint8Array(
          yield* Effect.tryPromise({
            try: () => request.arrayBuffer(),
            catch: (cause) => new LegacyHttpServerError({ stage: "Decode", message: "Could not read body", cause })
          })
        )
        if (bytes.byteLength > maxBodyBytes) {
          return yield* Effect.fail(new LegacyHttpServerError({ stage: "Decode", message: "Request body too large" }))
        }
        let input: unknown
        try {
          input = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes))
        } catch (cause) {
          return yield* Effect.fail(new LegacyHttpServerError({ stage: "Decode", message: "Invalid JSON", cause }))
        }
        const decoded = decodeJsonRpc(input)
        return yield* Either.isLeft(decoded)
          ? Effect.fail(
              new LegacyHttpServerError({ stage: "Decode", message: "Invalid JSON-RPC", cause: decoded.left })
            )
          : Effect.succeed(decoded.right)
      })

    const handle = (request: Request): Effect.Effect<Response, LegacyHttpServerError> =>
      Effect.gen(function* () {
        yield* prune
        const url = new URL(request.url)
        if (url.pathname !== path) return bodyless(404)
        const origin = request.headers.get("origin")
        if (origin !== null && options.allowedOrigins !== undefined && !options.allowedOrigins.includes(origin)) {
          return bodyless(403)
        }
        const host = request.headers.get("host") ?? url.host
        if (options.allowedHosts !== undefined && !options.allowedHosts.includes(host)) return bodyless(403)

        const requestedSession = request.headers.get(MCP_SESSION_ID_HEADER) ?? undefined
        let session = requestedSession === undefined ? undefined : sessions.get(requestedSession)
        if (requestedSession !== undefined && session === undefined) return bodyless(404)
        if (session !== undefined) {
          session.lastAccess = Date.now()
          const requestedVersion = request.headers.get(MCP_PROTOCOL_VERSION_HEADER)
          if (requestedVersion !== LEGACY_PROTOCOL_VERSION && requestedVersion !== "2025-03-26") return bodyless(400)
        }

        if (request.method === "DELETE") {
          if (session === undefined) return bodyless(400)
          yield* destroy(session.id)
          return bodyless(200)
        }
        if (request.method === "GET") {
          if (session === undefined) return bodyless(400)
          if (!accepts(request, "text/event-stream")) return bodyless(406)
          const lastEventId = request.headers.get("last-event-id") ?? undefined
          if (lastEventId !== undefined && !lastEventId.startsWith(`${session.id}:`)) return bodyless(400)
          const response = sseResponse(session, lastEventId)
          response.headers.set(MCP_SESSION_ID_HEADER, session.id)
          return response
        }
        if (request.method !== "POST") return bodyless(405, { Allow: "GET, POST, DELETE" })
        if (!isJson(request.headers.get("content-type"))) return bodyless(415)
        if (!accepts(request, "application/json") || !accepts(request, "text/event-stream")) return bodyless(406)

        const message = yield* readMessage(request).pipe(Effect.either)
        if (Either.isLeft(message)) return bodyless(message.left.message === "Request body too large" ? 413 : 400)
        const initializing = message.right._tag === "Request" && message.right.method === "initialize"
        if (initializing) {
          if (session !== undefined || requestedSession !== undefined) return bodyless(400)
          session = yield* createSession()
        } else if (session === undefined) {
          return bodyless(400)
        }
        if (options.onMessage !== undefined) yield* options.onMessage("inbound", message.right, session.id)

        if (message.right._tag === "Request") {
          const requestMessage = message.right
          const responseQueue = yield* Queue.bounded<JsonRpcMessage>(1)
          session.responses.set(requestMessage.id, responseQueue)
          yield* Queue.offer(session.inbound, requestMessage)
          const responseMessage = yield* Queue.take(responseQueue).pipe(
            Effect.ensuring(Effect.sync(() => session?.responses.delete(requestMessage.id)))
          )
          const encoded = encodeJsonRpcText(responseMessage)
          if (Either.isLeft(encoded)) {
            return yield* Effect.fail(
              new LegacyHttpServerError({ stage: "Runtime", message: "Could not encode response", cause: encoded.left })
            )
          }
          return new Response(encoded.right, {
            status: 200,
            headers: {
              "Content-Type": "application/json",
              [MCP_SESSION_ID_HEADER]: session.id,
              [MCP_PROTOCOL_VERSION_HEADER]: LEGACY_PROTOCOL_VERSION
            }
          })
        }

        yield* Queue.offer(session.inbound, message.right)
        return bodyless(202, {
          [MCP_SESSION_ID_HEADER]: session.id,
          [MCP_PROTOCOL_VERSION_HEADER]: LEGACY_PROTOCOL_VERSION
        })
      })

    const close = Effect.forEach([...sessions.keys()], destroy, { discard: true })
    yield* Effect.addFinalizer(() => close)
    return { handle, close, sessionCount: Effect.sync(() => sessions.size) }
  })
