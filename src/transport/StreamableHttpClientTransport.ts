/** Dispatcher-native MCP 2026-07-28 Streamable HTTP client transport. */
import * as Effect from "effect/Effect"
import * as Either from "effect/Either"
import * as Option from "effect/Option"
import * as Schema from "effect/Schema"
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
  CLIENT_REQUEST_RESULT_CODEC_BY_METHOD,
  SERVER_NOTIFICATION_PAYLOAD_CODEC_BY_METHOD
} from "../generated/mcp/2026-07-28/McpProtocol.generated.js"
import {
  standardRequestHeaders,
  type HttpToolWarningSink
} from "./HttpMetadata.js"

const DEFAULT_MAX_BYTES = 1024 * 1024
const CONTENT_TYPE = "application/json"
const ACCEPT = "application/json, text/event-stream"
const EVENT_STREAM = "text/event-stream"
const SUBSCRIPTION_ID = "io.modelcontextprotocol/subscriptionId"
const textDecoder = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true })
const subscriptionNotificationMethods = new Set([
  "notifications/subscriptions/acknowledged",
  "notifications/tools/list_changed",
  "notifications/prompts/list_changed",
  "notifications/resources/list_changed",
  "notifications/resources/updated"
])

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
  readonly url: string
  readonly callerHeaders: ReadonlyArray<readonly [string, string]>
  readonly fetch: FetchLike
  readonly authProvider?: OAuthClientProvider | undefined
  readonly warningSink: HttpToolWarningSink
  readonly maxLineBytes: number
  readonly maxEventBytes: number
  readonly maxJsonBytes: number
}

const normalizeEndpoint = (input: string | URL): Effect.Effect<string, TransportError> => Effect.try({
  try: () => {
    const raw = typeof input === "string"
      ? input
      : input instanceof URL
        ? URL.prototype.toString.call(input)
        : (() => { throw new Error("Invalid endpoint type") })()
    const endpoint = new URL(raw)
    if (endpoint.protocol !== "http:" && endpoint.protocol !== "https:") {
      throw new Error("Unsupported endpoint scheme")
    }
    return endpoint.href
  },
  catch: (cause) => failure("Invalid Streamable HTTP endpoint", cause)
})

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

interface SseState {
  readonly reader: ReadableStreamDefaultReader<Uint8Array>
  readonly request: JsonRpcRequest
  readonly response: Response
  readonly maxLineBytes: number
  readonly maxEventBytes: number
  chunk: Uint8Array
  chunkOffset: number
  line: Array<number>
  data: Array<Uint8Array>
  eventType: string | undefined
  eventWireBytes: number
  terminal: boolean
  acknowledged: boolean
  acknowledgedFilter: Readonly<Record<string, unknown>> | undefined
}

type SseInput =
  | { readonly _tag: "Event"; readonly bytes: Uint8Array }
  | { readonly _tag: "Eof" }

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value)

const dataProperty = (value: object, key: string): unknown => {
  const descriptor = Object.getOwnPropertyDescriptor(value, key)
  return descriptor !== undefined && "value" in descriptor ? descriptor.value : undefined
}

const notificationSubscriptionId = (message: JsonRpcMessage): unknown => {
  if (message._tag !== "Notification" || !isRecord(message.params)) return undefined
  const meta = dataProperty(message.params, "_meta")
  return isRecord(meta) ? dataProperty(meta, SUBSCRIPTION_ID) : undefined
}

const terminalSubscriptionId = (message: JsonRpcMessage): unknown => {
  if (message._tag !== "SuccessResponse" || !isRecord(message.result)) return undefined
  const meta = dataProperty(message.result, "_meta")
  return isRecord(meta) ? dataProperty(meta, SUBSCRIPTION_ID) : undefined
}

const resetEvent = (state: SseState): void => {
  state.data = []
  state.eventType = undefined
  state.eventWireBytes = 0
}

const decodeLine = (
  bytes: Uint8Array,
  state: SseState
): Effect.Effect<void, McpWireError> => Effect.try({
  try: () => {
    state.eventWireBytes += bytes.byteLength + 1
    if (state.eventWireBytes > state.maxEventBytes) {
      throw failure("SSE event exceeds maxEventBytes", undefined, state.response.status)
    }
    if (bytes.byteLength === 0) return
    if (bytes[0] === 0x3a) {
      textDecoder.decode(bytes)
      return
    }
    let colon = bytes.indexOf(0x3a)
    if (colon < 0) colon = bytes.byteLength
    const field = textDecoder.decode(bytes.subarray(0, colon))
    let valueOffset = colon < bytes.byteLength ? colon + 1 : colon
    if (bytes[valueOffset] === 0x20) valueOffset += 1
    const value = bytes.subarray(valueOffset)
    if (field === "data") {
      textDecoder.decode(value)
      state.data.push(value)
    } else if (field === "event") {
      state.eventType = textDecoder.decode(value)
    } else {
      textDecoder.decode(value)
    }
  },
  catch: (cause) => cause instanceof TransportError
    ? cause
    : failure("SSE line contains invalid UTF-8", cause, state.response.status)
})

const eventBytes = (state: SseState): Uint8Array => {
  const length = state.data.reduce((total, part) => total + part.byteLength, 0) +
    Math.max(0, state.data.length - 1)
  const bytes = new Uint8Array(length)
  let offset = 0
  for (let index = 0; index < state.data.length; index++) {
    if (index > 0) bytes[offset++] = 0x0a
    const part = state.data[index]!
    bytes.set(part, offset)
    offset += part.byteLength
  }
  return bytes
}

const readChunk = (state: SseState): Effect.Effect<boolean, TransportError> => Effect.gen(function*() {
  while (state.chunkOffset >= state.chunk.byteLength) {
    const next = yield* Effect.tryPromise({
      try: () => state.reader.read(),
      catch: (cause) => failure("Could not read SSE response body", cause, state.response.status)
    })
    if (next.done) return false
    state.chunk = next.value
    state.chunkOffset = 0
    if (state.chunk.byteLength > 0) return true
  }
  return true
})

const nextSseInput = (state: SseState): Effect.Effect<SseInput, McpWireError> => Effect.gen(function*() {
  while (true) {
    if (!(yield* readChunk(state))) {
      if (state.line.length > 0 || state.data.length > 0 || state.eventType !== undefined ||
        state.eventWireBytes > 0) {
        return yield* Effect.fail(failure("SSE response ended with a partial event", undefined, state.response.status))
      }
      return { _tag: "Eof" }
    }
    const byte = state.chunk[state.chunkOffset++]!
    if (byte !== 0x0a) {
      if (state.line.length >= state.maxLineBytes) {
        return yield* Effect.fail(failure("SSE line exceeds maxLineBytes", undefined, state.response.status))
      }
      state.line.push(byte)
      continue
    }
    if (state.line[state.line.length - 1] === 0x0d) state.line.pop()
    if (state.line.includes(0x0d)) {
      return yield* Effect.fail(failure("SSE response contains a bare carriage return", undefined, state.response.status))
    }
    const line = Uint8Array.from(state.line)
    state.line = []
    if (line.byteLength > 0) {
      yield* decodeLine(line, state)
      continue
    }
    const type = state.eventType
    if (type !== undefined && type !== "" && type !== "message") {
      return yield* Effect.fail(failure("SSE response contains a non-message event", undefined, state.response.status))
    }
    if (state.data.length === 0) {
      resetEvent(state)
      continue
    }
    const bytes = eventBytes(state)
    resetEvent(state)
    return { _tag: "Event", bytes }
  }
})

const subscriptionFilter = (request: JsonRpcRequest): Readonly<Record<string, unknown>> => {
  if (!isRecord(request.params)) return {}
  const notifications = dataProperty(request.params, "notifications")
  return isRecord(notifications) ? notifications : {}
}

const isFilterSubset = (
  acknowledged: Readonly<Record<string, unknown>>,
  requested: Readonly<Record<string, unknown>>
): boolean => {
  for (const key of ["toolsListChanged", "promptsListChanged", "resourcesListChanged"] as const) {
    if (acknowledged[key] === true && requested[key] !== true) return false
  }
  const acknowledgedUris = acknowledged["resourceSubscriptions"]
  if (Array.isArray(acknowledgedUris)) {
    const requestedUris = requested["resourceSubscriptions"]
    if (!Array.isArray(requestedUris) || acknowledgedUris.some((uri) =>
      typeof uri !== "string" || !requestedUris.includes(uri))) return false
  }
  return true
}

const selectedSubscriptionNotification = (
  message: Extract<JsonRpcMessage, { readonly _tag: "Notification" }>,
  filter: Readonly<Record<string, unknown>>
): boolean => {
  if (message.method === "notifications/tools/list_changed") return filter["toolsListChanged"] === true
  if (message.method === "notifications/prompts/list_changed") return filter["promptsListChanged"] === true
  if (message.method === "notifications/resources/list_changed") return filter["resourcesListChanged"] === true
  if (message.method === "notifications/resources/updated") {
    const selected = filter["resourceSubscriptions"]
    const uri = isRecord(message.params) ? dataProperty(message.params, "uri") : undefined
    return Array.isArray(selected) && typeof uri === "string" && selected.includes(uri)
  }
  return false
}

const validateGeneratedNotification = (
  message: Extract<JsonRpcMessage, { readonly _tag: "Notification" }>
): Effect.Effect<void, InvalidRequest> => {
  if (!Object.hasOwn(SERVER_NOTIFICATION_PAYLOAD_CODEC_BY_METHOD, message.method)) return Effect.void
  const codec = SERVER_NOTIFICATION_PAYLOAD_CODEC_BY_METHOD[
    message.method as keyof typeof SERVER_NOTIFICATION_PAYLOAD_CODEC_BY_METHOD
  ]
  const decoded = Schema.decodeUnknownEither(codec as Schema.Schema.AnyNoContext)(message.params)
  return Either.isLeft(decoded)
    ? Effect.fail(new InvalidRequest({ message: "SSE notification payload is invalid", cause: decoded.left }))
    : Effect.void
}

const validateSseMessage = (
  state: SseState,
  message: JsonRpcMessage
): Effect.Effect<ClientFrame, McpWireError> => {
  if (message._tag === "Request") {
    return Effect.fail(new InvalidRequest({ message: "SSE response cannot contain a JSON-RPC request" }))
  }
  if (state.terminal) {
    return Effect.fail(new InvalidRequest({ message: "SSE response contains data after its terminal response" }))
  }

  const subscription = state.request.method === "subscriptions/listen"
  if (!subscription) {
    if (message._tag === "Notification") {
      if (message.method === "notifications/cancelled" || subscriptionNotificationMethods.has(message.method)) {
        return Effect.fail(new InvalidRequest({ message: "HTTP response contains a transport-incompatible notification" }))
      }
      if (notificationSubscriptionId(message) !== undefined) {
        return Effect.fail(new InvalidRequest({ message: "Ordinary SSE response contains a subscription notification" }))
      }
      return Effect.succeed({ _tag: "Notification", notification: message })
    }
    if (!exactId(state.request.id, message.id)) {
      return Effect.fail(new InvalidRequest({ message: "SSE response id does not match request id" }))
    }
    state.terminal = true
    return Effect.succeed(message._tag === "SuccessResponse"
      ? { _tag: "Success", response: message }
      : { _tag: "Error", response: message })
  }

  if (!state.acknowledged) {
    if (message._tag !== "Notification" ||
      message.method !== "notifications/subscriptions/acknowledged" ||
      !exactId(state.request.id, notificationSubscriptionId(message) as JsonRpcId)) {
      return Effect.fail(new InvalidRequest({ message: "Subscription SSE must begin with its exact acknowledgement" }))
    }
    const validPayload = validateGeneratedNotification(message)
    return validPayload.pipe(Effect.flatMap(() => {
    const acknowledged = isRecord(message.params)
      ? dataProperty(message.params, "notifications")
      : undefined
    if (!isRecord(acknowledged) || !isFilterSubset(acknowledged, subscriptionFilter(state.request))) {
      return Effect.fail(new InvalidRequest({ message: "Subscription acknowledgement exceeds the requested filter" }))
    }
    state.acknowledged = true
    state.acknowledgedFilter = acknowledged
    return Effect.succeed({ _tag: "Notification", notification: message })
    }))
  }

  if (message._tag === "Notification") {
    if (!exactId(state.request.id, notificationSubscriptionId(message) as JsonRpcId) ||
      message.method === "notifications/subscriptions/acknowledged" ||
      message.method === "notifications/cancelled" ||
      state.acknowledgedFilter === undefined ||
      !selectedSubscriptionNotification(message, state.acknowledgedFilter)) {
      return Effect.fail(new InvalidRequest({ message: "Subscription SSE notification is not selected for this request" }))
    }
    return validateGeneratedNotification(message).pipe(
      Effect.as({ _tag: "Notification" as const, notification: message })
    )
  }

  if (message._tag !== "SuccessResponse" || !exactId(state.request.id, message.id) ||
    !exactId(state.request.id, terminalSubscriptionId(message) as JsonRpcId)) {
    return Effect.fail(new InvalidRequest({ message: "Subscription SSE terminal does not match its request" }))
  }
  const decoded = Schema.decodeUnknownEither(
    CLIENT_REQUEST_RESULT_CODEC_BY_METHOD["subscriptions/listen"]
  )(message.result)
  if (Either.isLeft(decoded)) {
    return Effect.fail(new InvalidRequest({ message: "Subscription SSE terminal is invalid", cause: decoded.left }))
  }
  state.terminal = true
  return Effect.succeed({ _tag: "Success", response: message })
}

const nextSseFrame = (
  state: SseState
): Effect.Effect<Option.Option<readonly [ClientFrame, SseState]>, McpWireError> => Effect.gen(function*() {
  const input = yield* nextSseInput(state)
  if (input._tag === "Eof") {
    if (!state.terminal) {
      return yield* Effect.fail(failure(
        state.request.method === "subscriptions/listen" && state.acknowledged
          ? "Subscription SSE response closed abruptly"
          : "SSE response ended before its terminal response",
        undefined,
        state.response.status
      ))
    }
    return Option.none()
  }
  const decoded = decodeJsonRpcBytes(input.bytes)
  if (Either.isLeft(decoded)) return yield* Effect.fail(decoded.left)
  const frame = yield* validateSseMessage(state, decoded.right)
  return Option.some([frame, state] as const)
})

const sseResponseStream = (
  options: ValidatedOptions,
  request: JsonRpcRequest,
  response: Response
): Stream.Stream<ClientFrame, McpWireError> => Stream.unwrapScoped(Effect.gen(function*() {
  if (response.body === null) {
    return yield* Effect.fail(failure("SSE response has no body", undefined, response.status))
  }
  const reader = yield* Effect.acquireRelease(
    Effect.sync(() => response.body!.getReader()),
    (reader) => Effect.tryPromise({
      try: () => reader.cancel(),
      catch: (cause) => failure("Could not release SSE response body", cause, response.status)
    }).pipe(Effect.ignore)
  )
  const state: SseState = {
    reader,
    request,
    response,
    maxLineBytes: options.maxLineBytes,
    maxEventBytes: options.maxEventBytes,
    chunk: new Uint8Array(),
    chunkOffset: 0,
    line: [],
    data: [],
    eventType: undefined,
    eventWireBytes: 0,
    terminal: false,
    acknowledged: false,
    acknowledgedFilter: undefined
  }
  return Stream.unfoldEffect(state, nextSseFrame)
}))

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
    const type = mediaType(response)
    if (type !== CONTENT_TYPE && type !== EVENT_STREAM) {
      return yield* Effect.fail(failure("HTTP response has unsupported content type", undefined, response.status))
    }
    if (request.method === "subscriptions/listen" && type !== EVENT_STREAM) {
      return yield* Effect.fail(failure("Subscription responses require text/event-stream", undefined, response.status))
    }
    if (type === EVENT_STREAM) {
      if (!response.ok) {
        return yield* Effect.fail(failure("Non-success HTTP response cannot use SSE", undefined, response.status))
      }
      return sseResponseStream(options, request, response)
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
  const url = yield* normalizeEndpoint(options.url)
  const callerHeaders = yield* copyCallerHeaders(options.headers)
  const maxLineBytes = yield* positiveBound(options.maxLineBytes, "maxLineBytes")
  const maxEventBytes = yield* positiveBound(options.maxEventBytes, "maxEventBytes")
  const maxJsonBytes = yield* positiveBound(options.maxJsonBytes, "maxJsonBytes")
  const validated: ValidatedOptions = {
    url,
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
