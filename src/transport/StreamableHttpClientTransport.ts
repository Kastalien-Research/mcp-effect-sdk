/** Dispatcher-native MCP 2026-07-28 Streamable HTTP client transport. */
import * as Effect from "effect/Effect"
import * as Either from "effect/Either"
import * as Scope from "effect/Scope"
import * as Stream from "effect/Stream"
import type { ClientFrame } from "../McpDispatcher.js"
import {
  InvalidRequest,
  TransportError,
  type McpWireError
} from "../McpErrors.js"
import type { McpTransport } from "../McpTransport.js"
import {
  decodeJsonRpcBytes,
  encodeJsonRpcText,
  type JsonRpcId,
  type JsonRpcMessage,
  type JsonRpcRequest
} from "../McpWire.js"
import type { FetchLike, OAuthClientProvider } from "../auth/auth.js"
import {
  standardRequestHeaders,
  type HttpToolWarningSink
} from "./HttpMetadata.js"

const DEFAULT_MAX_BYTES = 1024 * 1024
const CONTENT_TYPE = "application/json"
const ACCEPT = "application/json, text/event-stream"

export interface StreamableHttpClientTransportOptions {
  readonly url: string | URL
  readonly headers?: Readonly<Record<string, string>>
  readonly fetch?: FetchLike | undefined
  readonly authProvider?: OAuthClientProvider | undefined
  readonly warningSink?: HttpToolWarningSink | undefined
  readonly maxLineBytes?: number | undefined
  readonly maxEventBytes?: number | undefined
  readonly maxJsonBytes?: number | undefined
}

export type StreamableHttpClientTransportError = McpWireError

interface ValidatedOptions {
  readonly url: string | URL
  readonly callerHeaders: ReadonlyArray<readonly [string, string]>
  readonly fetch: FetchLike
  readonly authProvider?: OAuthClientProvider | undefined
  readonly warningSink: HttpToolWarningSink
  readonly maxLineBytes: number
  readonly maxEventBytes: number
  readonly maxJsonBytes: number
}

const failure = (
  message: string,
  cause?: unknown,
  status?: number
): TransportError => new TransportError({
  message,
  ...(cause === undefined ? {} : { cause }),
  ...(status === undefined ? {} : { status })
})

const positiveBound = (
  value: number | undefined,
  name: string
): Effect.Effect<number, TransportError> => {
  const candidate = value ?? DEFAULT_MAX_BYTES
  return Number.isSafeInteger(candidate) && candidate > 0
    ? Effect.succeed(candidate)
    : Effect.fail(failure(`Invalid ${name}`))
}

const copyCallerHeaders = (
  source: Readonly<Record<string, string>> | undefined
): Effect.Effect<ReadonlyArray<readonly [string, string]>, TransportError> => Effect.try({
  try: () => {
    if (source === undefined) return []
    const descriptors = Object.getOwnPropertyDescriptors(source)
    const entries: Array<readonly [string, string]> = []
    for (const key of Reflect.ownKeys(descriptors)) {
      const descriptor = Object.getOwnPropertyDescriptor(source, key)
      if (descriptor === undefined || !("value" in descriptor)) {
        throw new Error("Accessor header")
      }
      if (!descriptor.enumerable) continue
      if (typeof key !== "string" || typeof descriptor.value !== "string") {
        throw new Error("Invalid header")
      }
      const checked = new Headers()
      checked.set(key, descriptor.value)
      entries.push([key, descriptor.value])
    }
    return Object.freeze(entries)
  },
  catch: (cause) => failure("Invalid caller headers", cause)
})

const buildHeaders = (
  options: ValidatedOptions,
  request: JsonRpcRequest
): Effect.Effect<Headers, McpWireError> => Effect.gen(function*() {
  const headers = yield* Effect.try({
    try: () => new Headers(options.callerHeaders.map(([name, value]) => [name, value])),
    catch: (cause) => failure("Could not construct request headers", cause)
  })
  headers.delete("MCP-Session-Id")
  headers.delete("Last-Event-ID")
  headers.set("Content-Type", CONTENT_TYPE)
  headers.set("Accept", ACCEPT)
  const standard = yield* standardRequestHeaders(request)
  for (const [name, value] of Object.entries(standard)) headers.set(name, value)
  return headers
})

const exactId = (left: JsonRpcId, right: JsonRpcId): boolean =>
  typeof left === typeof right && left === right

const responseFrame = (
  request: JsonRpcRequest,
  message: JsonRpcMessage,
  response: Response
): Effect.Effect<ClientFrame, McpWireError> => {
  if (message._tag !== "SuccessResponse" && message._tag !== "ErrorResponse") {
    return Effect.fail(new InvalidRequest({
      message: "HTTP response must contain one terminal JSON-RPC response"
    }))
  }
  if (!exactId(request.id, message.id)) {
    return Effect.fail(new InvalidRequest({ message: "HTTP response id does not match request id" }))
  }
  if (!response.ok && message._tag !== "ErrorResponse") {
    return Effect.fail(failure("Non-success HTTP response did not contain an error terminal", undefined, response.status))
  }
  return Effect.succeed(message._tag === "SuccessResponse"
    ? { _tag: "Success", response: message }
    : { _tag: "Error", response: message })
}

const readBoundedBody = (
  response: Response,
  maxBytes: number
): Effect.Effect<Uint8Array, TransportError> => Effect.scoped(Effect.gen(function*() {
  if (response.body === null) return new Uint8Array()
  const reader = yield* Effect.acquireRelease(
    Effect.sync(() => response.body!.getReader()),
    (reader) => Effect.tryPromise({
      try: () => reader.cancel(),
      catch: (cause) => failure("Could not release HTTP response body", cause, response.status)
    }).pipe(Effect.ignore)
  )
  const chunks: Array<Uint8Array> = []
  let total = 0
  while (true) {
    const next = yield* Effect.tryPromise({
      try: () => reader.read(),
      catch: (cause) => failure("Could not read HTTP response body", cause, response.status)
    })
    if (next.done) break
    total += next.value.byteLength
    if (total > maxBytes) {
      return yield* Effect.fail(failure("HTTP JSON response exceeds maxJsonBytes", undefined, response.status))
    }
    chunks.push(next.value)
  }
  const bytes = new Uint8Array(total)
  let offset = 0
  for (const chunk of chunks) {
    bytes.set(chunk, offset)
    offset += chunk.byteLength
  }
  return bytes
}))

const mediaType = (response: Response): string | undefined => {
  const value = response.headers.get("Content-Type")
  if (value === null) return undefined
  return value.split(";", 1)[0]?.trim().toLowerCase()
}

const jsonRequest = (
  options: ValidatedOptions,
  request: JsonRpcRequest
): Stream.Stream<ClientFrame, StreamableHttpClientTransportError> => Stream.unwrapScoped(
  Effect.gen(function*() {
    const encoded = encodeJsonRpcText(request)
    if (Either.isLeft(encoded)) return yield* Effect.fail(encoded.left)
    const headers = yield* buildHeaders(options, request)
    const response = yield* Effect.tryPromise({
      try: (signal) => options.fetch(options.url, {
        method: "POST",
        headers,
        body: encoded.right,
        signal
      }),
      catch: (cause) => failure("HTTP POST failed", cause)
    })
    if (response.status === 401 || response.status === 403) {
      return yield* Effect.fail(failure("HTTP authorization failed", undefined, response.status))
    }
    if (mediaType(response) !== CONTENT_TYPE) {
      return yield* Effect.fail(failure("HTTP response has unsupported content type", undefined, response.status))
    }
    const bytes = yield* readBoundedBody(response, options.maxJsonBytes)
    const decoded = decodeJsonRpcBytes(bytes)
    if (Either.isLeft(decoded)) {
      return yield* response.ok
        ? Effect.fail(decoded.left)
        : Effect.fail(failure("HTTP error response is not a valid JSON-RPC error", decoded.left, response.status))
    }
    const frame = yield* responseFrame(request, decoded.right, response)
    return Stream.succeed(frame)
  })
)

export const make = (
  options: StreamableHttpClientTransportOptions
): Effect.Effect<
  McpTransport<StreamableHttpClientTransportError>,
  TransportError,
  Scope.Scope
> => Effect.gen(function*() {
  yield* Effect.scope
  const callerHeaders = yield* copyCallerHeaders(options.headers)
  const maxLineBytes = yield* positiveBound(options.maxLineBytes, "maxLineBytes")
  const maxEventBytes = yield* positiveBound(options.maxEventBytes, "maxEventBytes")
  const maxJsonBytes = yield* positiveBound(options.maxJsonBytes, "maxJsonBytes")
  const validated: ValidatedOptions = {
    url: options.url,
    callerHeaders,
    fetch: options.fetch ?? fetch,
    authProvider: options.authProvider,
    warningSink: options.warningSink ?? (() => Effect.logWarning("Invalid HTTP tool header definition")),
    maxLineBytes,
    maxEventBytes,
    maxJsonBytes
  }
  return { request: (request) => jsonRequest(validated, request) }
})
