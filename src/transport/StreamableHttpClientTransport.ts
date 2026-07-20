/** Dispatcher-native MCP 2026-07-28 Streamable HTTP client transport. */
import * as Effect from "effect/Effect"
import * as Either from "effect/Either"
import * as Option from "effect/Option"
import * as Redacted from "effect/Redacted"
import * as Ref from "effect/Ref"
import * as Schema from "effect/Schema"
import * as Scope from "effect/Scope"
import * as Stream from "effect/Stream"
import type { ClientFrame } from "../McpDispatcher.js"
import {
  HEADER_MISMATCH_ERROR_CODE,
  InvalidRequest,
  TransportError,
  type McpWireError
} from "../McpErrors.js"
import { validateSubscriptionTerminal } from "../internal/SubscriptionValidation.js"
import type { McpTransport } from "../McpTransport.js"
import {
  decodeJsonRpcBytes,
  encodeJsonRpcText,
  type JsonRpcId,
  type JsonRpcMessage,
  type JsonRpcRequest
} from "../McpWire.js"
import {
  AuthorizationChallenge,
  AuthorizationScopeSet
} from "../auth/common.js"
import type {
  AuthorizationClientService,
  AuthorizationClientStoreService
} from "../auth/client/models.js"
import {
  CLIENT_REQUEST_RESULT_CODEC_BY_METHOD,
  SERVER_NOTIFICATION_PAYLOAD_CODEC_BY_METHOD
} from "../generated/mcp/2026-07-28/McpProtocol.generated.js"
import {
  extractToolHeaders,
  filterHttpTools,
  standardRequestHeaders,
  type HttpToolDefinition,
  type HttpToolHeaderPlan,
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

type FetchLike = (input: string | URL, init?: RequestInit) => Promise<Response>

export interface StreamableHttpClientTransportOptions {
  readonly url: string | URL
  readonly headers?: Readonly<Record<string, string>>
  readonly fetch?: FetchLike | undefined
  readonly authorization?: StreamableHttpClientAuthorization | undefined
  readonly warningSink?: HttpToolWarningSink | undefined
  readonly maxLineBytes?: number | undefined
  readonly maxEventBytes?: number | undefined
  readonly maxJsonBytes?: number | undefined
}

export interface StreamableHttpClientAuthorization {
  readonly client: AuthorizationClientService
  readonly store: Pick<AuthorizationClientStoreService, "readGrant">
  readonly protectedResource: string
  readonly requestedScopes: typeof AuthorizationScopeSet.Type
}

export type StreamableHttpClientTransportError = McpWireError

interface ValidatedOptions {
  readonly url: string
  readonly callerHeaders: ReadonlyArray<readonly [string, string]>
  readonly fetch: FetchLike
  readonly authorization?: StreamableHttpClientAuthorization | undefined
  readonly warningSink: HttpToolWarningSink
  readonly toolPlans: Ref.Ref<Readonly<Record<string, HttpToolHeaderPlan>>>
  readonly internalNamespace: string
  readonly internalCounter: Ref.Ref<number>
  readonly maxLineBytes: number
  readonly maxEventBytes: number
  readonly maxJsonBytes: number
}

interface RequestContext {
  readonly authRetried: Ref.Ref<boolean>
  readonly authorizationGrant: Ref.Ref<Option.Option<import("../auth/common.js").AuthorizationGrantHandle>>
  readonly latestToolPlans: Ref.Ref<Readonly<Record<string, HttpToolHeaderPlan>>>
}

interface RequestAttempt {
  mode: "unknown" | "json" | "sse"
  cleanEof: boolean
  stagedCatalog: {
    readonly listedNames: ReadonlyArray<string>
    readonly plans: Readonly<Record<string, HttpToolHeaderPlan>>
  } | undefined
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
  request: JsonRpcRequest,
  context: RequestContext
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
  if (options.authorization !== undefined) {
    headers.delete("Authorization")
    const selected = yield* Ref.get(context.authorizationGrant)
    if (Option.isSome(selected)) {
      const stored = yield* options.authorization.store.readGrant(selected.value).pipe(
        Effect.mapError((cause) => failure("Could not read authorization grant", cause))
      )
      if (stored.resource !== options.authorization.protectedResource ||
        stored.tokenType.toLowerCase() !== "bearer" ||
        !Redacted.isRedacted(stored.accessToken)) {
        return yield* Effect.fail(failure("Authorization grant is not valid for the protected resource"))
      }
      headers.set("Authorization", `Bearer ${Redacted.value(stored.accessToken)}`)
    }
  }
  if (request.method === "tools/call" && isRecord(request.params)) {
    const nameDescriptor = Object.getOwnPropertyDescriptor(request.params, "name")
    const argumentsDescriptor = Object.getOwnPropertyDescriptor(request.params, "arguments")
    const toolName = nameDescriptor !== undefined && "value" in nameDescriptor
      ? nameDescriptor.value
      : undefined
    if (typeof toolName === "string") {
      const localPlans = yield* Ref.get(context.latestToolPlans)
      const localDescriptor = Object.getOwnPropertyDescriptor(localPlans, toolName)
      const localPlan = localDescriptor !== undefined && "value" in localDescriptor
        ? localDescriptor.value
        : undefined
      const plans = localPlan === undefined ? yield* Ref.get(options.toolPlans) : localPlans
      const planDescriptor = localPlan === undefined
        ? Object.getOwnPropertyDescriptor(plans, toolName)
        : localDescriptor
      const plan = planDescriptor !== undefined && "value" in planDescriptor ? planDescriptor.value : undefined
      if (plan !== undefined) {
        const toolHeaders = yield* extractToolHeaders(
          plan,
          argumentsDescriptor !== undefined && "value" in argumentsDescriptor
            ? argumentsDescriptor.value
            : undefined
        )
        for (const [name, value] of Object.entries(toolHeaders)) headers.set(name, value)
      }
    }
  }
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
    }).pipe(
      Effect.ensuring(Effect.sync(() => reader.releaseLock())),
      Effect.ignore
    )
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

const splitAuthenticationChallenges = (header: string): ReadonlyArray<string> => {
  const boundaries = [0]
  let quoted = false
  let escaped = false
  for (let offset = 0; offset < header.length; offset += 1) {
    const character = header[offset]!
    if (quoted) {
      if (escaped) escaped = false
      else if (character === "\\") escaped = true
      else if (character === "\"") quoted = false
      continue
    }
    if (character === "\"") {
      quoted = true
      continue
    }
    if (character !== ",") continue
    let candidate = offset + 1
    while (header[candidate] === " " || header[candidate] === "\t") candidate += 1
    const token = /^[!#$%&'*+\-.^_`|~0-9A-Za-z]+/.exec(header.slice(candidate))
    if (token === null) continue
    let after = candidate + token[0].length
    while (header[after] === " " || header[after] === "\t") after += 1
    if (header[after] !== "=") boundaries.push(candidate)
  }
  const output: Array<string> = []
  for (let index = 0; index < boundaries.length; index += 1) {
    const start = boundaries[index]!
    const end = index + 1 < boundaries.length
      ? header.lastIndexOf(",", boundaries[index + 1]! - 1)
      : header.length
    const challenge = header.slice(start, end).trim()
    if (challenge.length > 0) output.push(challenge)
  }
  return output
}

const parseBearerChallengeValue = (
  status: 401 | 403,
  header: string
): typeof AuthorizationChallenge.Type | undefined => {
  const scheme = /^Bearer(?:[\t ]+|$)/i.exec(header)
  if (scheme === null || scheme.index !== 0) return undefined
  const input = header.slice(scheme[0].length)
  const parameters = new Map<string, string>()
  let offset = 0
  const skipWhitespace = () => {
    while (input[offset] === " " || input[offset] === "\t") offset += 1
  }
  skipWhitespace()
  while (offset < input.length) {
    const nameMatch = /^[!#$%&'*+\-.^_`|~0-9A-Za-z]+/.exec(input.slice(offset))
    if (nameMatch === null) return undefined
    const name = nameMatch[0].toLowerCase()
    if (parameters.has(name)) return undefined
    offset += nameMatch[0].length
    skipWhitespace()
    if (input[offset] !== "=") return undefined
    offset += 1
    skipWhitespace()
    let value = ""
    if (input[offset] === "\"") {
      offset += 1
      let closed = false
      while (offset < input.length) {
        const character = input[offset++]!
        if (character === "\"") {
          closed = true
          break
        }
        if (character === "\\") {
          if (offset >= input.length) return undefined
          const escaped = input[offset++]!
          if (escaped !== "\\" && escaped !== "\"") return undefined
          value += escaped
          continue
        }
        if (character < " " || character === "\u007f") return undefined
        value += character
      }
      if (!closed) return undefined
    } else {
      const valueMatch = /^[!#$%&'*+\-.^_`|~0-9A-Za-z:/.]+/.exec(input.slice(offset))
      if (valueMatch === null) return undefined
      value = valueMatch[0]
      offset += value.length
    }
    parameters.set(name, value)
    skipWhitespace()
    if (offset === input.length) break
    if (input[offset] !== ",") return undefined
    offset += 1
    skipWhitespace()
    if (offset === input.length) return undefined
  }

  const error = parameters.get("error")
  if (status === 403 && error !== "insufficient_scope") return undefined
  if (status === 401 && error !== undefined && error !== "invalid_token") return undefined
  const rawScope = parameters.get("scope")
  const rawScopes = rawScope === undefined || rawScope.length === 0 ? [] : rawScope.split(" ")
  const decoded = Schema.decodeUnknownEither(AuthorizationChallenge)({
    scheme: "Bearer",
    status,
    scopes: rawScopes,
    ...(error === undefined ? {} : { error }),
    ...(parameters.has("error_description")
      ? { errorDescription: parameters.get("error_description") }
      : {}),
    ...(parameters.has("resource_metadata")
      ? { resourceMetadata: parameters.get("resource_metadata") }
      : {})
  })
  return Either.isRight(decoded) ? decoded.right : undefined
}

const parseBearerChallenge = (
  response: Response
): typeof AuthorizationChallenge.Type | undefined => {
  if (response.status !== 401 && response.status !== 403) return undefined
  const header = response.headers.get("www-authenticate")
  if (header === null) return undefined
  for (const challenge of splitAuthenticationChallenges(header)) {
    const decoded = parseBearerChallengeValue(response.status, challenge)
    if (decoded !== undefined) return decoded
  }
  return undefined
}

interface SseState {
  readonly reader: ReadableStreamDefaultReader<Uint8Array>
  readonly request: JsonRpcRequest
  readonly response: Response
  readonly maxLineBytes: number
  readonly maxEventBytes: number
  chunk: Uint8Array
  chunkOffset: number
  bomChecked: boolean
  bomPrefix: Array<number>
  line: Array<number>
  data: Array<Uint8Array>
  eventType: string | undefined
  eventWireBytes: number
  terminal: boolean
  acknowledged: boolean
  acknowledgedFilter: Readonly<Record<string, unknown>> | undefined
  readonly onCleanEof: () => void
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
    if (next.done) {
      if (!state.bomChecked && state.bomPrefix.length > 0) {
        state.bomChecked = true
        state.chunk = Uint8Array.from(state.bomPrefix)
        state.bomPrefix = []
        state.chunkOffset = 0
        return true
      }
      return false
    }
    let chunk = next.value
    if (!state.bomChecked) {
      const combined = new Uint8Array(state.bomPrefix.length + chunk.byteLength)
      combined.set(state.bomPrefix)
      combined.set(chunk, state.bomPrefix.length)
      if (combined.byteLength < 3) {
        state.bomPrefix = Array.from(combined)
        continue
      }
      state.bomChecked = true
      state.bomPrefix = []
      chunk = combined[0] === 0xef && combined[1] === 0xbb && combined[2] === 0xbf
        ? combined.subarray(3)
        : combined
    }
    state.chunk = chunk
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
      if (state.line.length > state.maxLineBytes ||
        (state.line.length === state.maxLineBytes && byte !== 0x0d)) {
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
      return validateGeneratedNotification(message).pipe(
        Effect.as({ _tag: "Notification" as const, notification: message })
      )
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

  if (message._tag !== "SuccessResponse") {
    return Effect.fail(new InvalidRequest({ message: "Subscription SSE terminal does not match its request" }))
  }
  const validation = validateSubscriptionTerminal(state.request.id, message)
  if (validation._tag === "Mismatch") {
    return Effect.fail(new InvalidRequest({ message: "Subscription SSE terminal does not match its request" }))
  }
  if (validation._tag === "Invalid") {
    return Effect.fail(new InvalidRequest({ message: "Subscription SSE terminal is invalid", cause: validation.cause }))
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
    state.onCleanEof()
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
  response: Response,
  attempt: RequestAttempt
): Stream.Stream<ClientFrame, McpWireError> => Stream.unwrapScoped(Effect.gen(function*() {
  if (response.body === null) {
    return yield* Effect.fail(failure("SSE response has no body", undefined, response.status))
  }
  const reader = yield* Effect.acquireRelease(
    Effect.sync(() => response.body!.getReader()),
    (reader) => Effect.tryPromise({
      try: () => reader.cancel(),
      catch: (cause) => failure("Could not release SSE response body", cause, response.status)
    }).pipe(
      Effect.ensuring(Effect.sync(() => reader.releaseLock())),
      Effect.ignore
    )
  )
  const state: SseState = {
    reader,
    request,
    response,
    maxLineBytes: options.maxLineBytes,
    maxEventBytes: options.maxEventBytes,
    chunk: new Uint8Array(),
    chunkOffset: 0,
    bomChecked: false,
    bomPrefix: [],
    line: [],
    data: [],
    eventType: undefined,
    eventWireBytes: 0,
    terminal: false,
    acknowledged: false,
    acknowledgedFilter: undefined,
    onCleanEof: () => {
      attempt.cleanEof = true
    }
  }
  return Stream.unfoldEffect(state, nextSseFrame)
}))

const jsonRequest = (
  options: ValidatedOptions,
  request: JsonRpcRequest,
  context: RequestContext,
  attempt: RequestAttempt
): Stream.Stream<ClientFrame, StreamableHttpClientTransportError> => Stream.unwrapScoped(
  Effect.gen(function*() {
    const controller = yield* Effect.acquireRelease(
      Effect.sync(() => new AbortController()),
      (controller) => Effect.sync(() => controller.abort())
    )
    const encoded = encodeJsonRpcText(request)
    if (Either.isLeft(encoded)) return yield* Effect.fail(encoded.left)
    const post = Effect.gen(function*() {
      const headers = yield* buildHeaders(options, request, context)
      const containsAuthorization = headers.has("Authorization")
      return yield* Effect.tryPromise({
        try: (signal) => options.fetch(options.url, {
          method: "POST",
          headers,
          body: encoded.right,
          signal: AbortSignal.any([signal, controller.signal])
        }),
        catch: (cause) => containsAuthorization
          ? failure("HTTP POST failed")
          : failure("HTTP POST failed", cause)
      })
    })
    let response = yield* post
    const challenge = parseBearerChallenge(response)
    const authRetryAvailable = challenge !== undefined && options.authorization !== undefined
      ? yield* Ref.modify(context.authRetried, (used) => [!used, true] as const)
      : false
    if (authRetryAvailable && options.authorization !== undefined && challenge !== undefined) {
      const prior = yield* Ref.get(context.authorizationGrant)
      const next = yield* options.authorization.client.respondToChallenge({
        protectedResource: options.authorization.protectedResource,
        challenge,
        ...(Option.isSome(prior) ? { priorGrant: prior.value } : {})
      }).pipe(
        Effect.mapError((cause) => failure("HTTP authorization failed", cause, response.status))
      )
      yield* Ref.set(context.authorizationGrant, Option.some(next))
      response = yield* post
    }
    if (response.status === 401 || response.status === 403) {
      const authRetried = yield* Ref.get(context.authRetried)
      return yield* Effect.fail(failure(
        authRetried ? "HTTP authorization failed after one retry" : "HTTP authorization failed",
        undefined,
        response.status
      ))
    }
    const type = mediaType(response)
    if (type !== CONTENT_TYPE && type !== EVENT_STREAM) {
      return yield* Effect.fail(failure("HTTP response has unsupported content type", undefined, response.status))
    }
    if (request.method === "subscriptions/listen" && type !== EVENT_STREAM) {
      return yield* Effect.fail(failure("Subscription responses require text/event-stream", undefined, response.status))
    }
    if (type === EVENT_STREAM) {
      attempt.mode = "sse"
      if (!response.ok) {
        return yield* Effect.fail(failure("Non-success HTTP response cannot use SSE", undefined, response.status))
      }
      return sseResponseStream(options, request, response, attempt)
    }
    attempt.mode = "json"
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

const nonFailingWarningSink = (
  sink: HttpToolWarningSink
): HttpToolWarningSink => (warning) => Effect.suspend(() => sink(warning)).pipe(
  Effect.catchAll(() => Effect.void),
  Effect.catchAllDefect(() => Effect.void)
)

const mutableToolPlans = (
  source: Readonly<Record<string, HttpToolHeaderPlan>>
): Record<string, HttpToolHeaderPlan> => {
  const copied = Object.create(null) as Record<string, HttpToolHeaderPlan>
  for (const key of Reflect.ownKeys(source)) {
    if (typeof key !== "string") continue
    const descriptor = Object.getOwnPropertyDescriptor(source, key)
    if (descriptor !== undefined && "value" in descriptor) copied[key] = descriptor.value
  }
  return copied
}

const emptyToolPlans = (): Readonly<Record<string, HttpToolHeaderPlan>> =>
  Object.freeze(Object.create(null) as Record<string, HttpToolHeaderPlan>)

const updateToolPlans = (
  options: ValidatedOptions,
  request: JsonRpcRequest,
  listedNames: ReadonlyArray<string>,
  nextPlans: Readonly<Record<string, HttpToolHeaderPlan>>
): Effect.Effect<void> => Ref.update(options.toolPlans, (current) => {
  const cursorDescriptor = isRecord(request.params)
    ? Object.getOwnPropertyDescriptor(request.params, "cursor")
    : undefined
  const paginated = cursorDescriptor !== undefined && "value" in cursorDescriptor &&
    cursorDescriptor.value !== undefined
  const updated = paginated
    ? mutableToolPlans(current)
    : Object.create(null) as Record<string, HttpToolHeaderPlan>
  for (const name of listedNames) delete updated[name]
  for (const key of Reflect.ownKeys(nextPlans)) {
    if (typeof key !== "string") continue
    const descriptor = Object.getOwnPropertyDescriptor(nextPlans, key)
    if (descriptor !== undefined && "value" in descriptor) updated[key] = descriptor.value
  }
  return Object.freeze(updated)
})

const processFrame = (
  options: ValidatedOptions,
  request: JsonRpcRequest,
  context: RequestContext,
  attempt: RequestAttempt,
  frame: ClientFrame
): Effect.Effect<ClientFrame, McpWireError> => {
  if (frame._tag === "Notification" && frame.notification.method === "notifications/tools/list_changed") {
    return Effect.all([
      Ref.set(options.toolPlans, emptyToolPlans()),
      Ref.set(context.latestToolPlans, emptyToolPlans())
    ], { discard: true }).pipe(Effect.as(frame))
  }
  if (request.method !== "tools/list" || frame._tag !== "Success") return Effect.succeed(frame)
  const decoded = Schema.decodeUnknownEither(
    CLIENT_REQUEST_RESULT_CODEC_BY_METHOD["tools/list"]
  )(frame.response.result)
  if (Either.isLeft(decoded)) {
    return Effect.fail(new InvalidRequest({
      message: "tools/list response result is invalid",
      cause: decoded.left
    }))
  }
  const result = frame.response.result as Readonly<Record<string, unknown>>
  const rawTools = result["tools"] as ReadonlyArray<HttpToolDefinition>
  return Effect.gen(function*() {
    const catalog = yield* filterHttpTools(
      rawTools,
      nonFailingWarningSink(options.warningSink)
    )
    const listedNames = rawTools.map((tool) => tool.name)
    if (attempt.mode === "sse") {
      attempt.stagedCatalog = { listedNames, plans: catalog.plans }
    } else {
      yield* updateToolPlans(options, request, listedNames, catalog.plans)
      yield* Ref.set(context.latestToolPlans, catalog.plans)
    }
    return {
      _tag: "Success" as const,
      response: {
        ...frame.response,
        result: { ...result, tools: catalog.tools } as unknown as typeof frame.response.result
      }
    }
  })
}

const commitStagedCatalog = (
  options: ValidatedOptions,
  request: JsonRpcRequest,
  context: RequestContext,
  attempt: RequestAttempt
): Effect.Effect<void> => {
  const staged = attempt.stagedCatalog
  if (staged === undefined || (attempt.mode === "sse" && !attempt.cleanEof)) return Effect.void
  return updateToolPlans(options, request, staged.listedNames, staged.plans).pipe(
    Effect.andThen(Ref.set(context.latestToolPlans, staged.plans))
  )
}

const toolCallName = (request: JsonRpcRequest): string | undefined => {
  if (request.method !== "tools/call" || !isRecord(request.params)) return undefined
  const descriptor = Object.getOwnPropertyDescriptor(request.params, "name")
  return descriptor !== undefined && "value" in descriptor && typeof descriptor.value === "string"
    ? descriptor.value
    : undefined
}

const invalidateToolPlan = (
  options: ValidatedOptions,
  toolName: string
): Effect.Effect<void> => Ref.update(options.toolPlans, (current) => {
  const updated = mutableToolPlans(current)
  delete updated[toolName]
  return Object.freeze(updated)
})

const copyRequestMetadata = (
  request: JsonRpcRequest
): Effect.Effect<Readonly<Record<string, unknown>>, TransportError> => Effect.try({
  try: () => {
    const copied = Object.create(null) as Record<string, unknown>
    if (!isRecord(request.params)) return Object.freeze(copied)
    const metaDescriptor = Object.getOwnPropertyDescriptor(request.params, "_meta")
    if (metaDescriptor === undefined || !("value" in metaDescriptor) || !isRecord(metaDescriptor.value)) {
      return Object.freeze(copied)
    }
    const descriptors = Object.getOwnPropertyDescriptors(metaDescriptor.value)
    for (const key of Reflect.ownKeys(descriptors)) {
      const descriptor = Object.getOwnPropertyDescriptor(metaDescriptor.value, key)
      if (typeof key !== "string" || descriptor === undefined || !descriptor.enumerable || !("value" in descriptor)) {
        continue
      }
      Object.defineProperty(copied, key, {
        configurable: false,
        enumerable: true,
        writable: false,
        value: descriptor.value
      })
    }
    return Object.freeze(copied)
  },
  catch: (cause) => failure("Could not copy request metadata for tools/list refresh", cause)
})

const isHeaderMismatchFrame = (
  request: JsonRpcRequest,
  frame: ClientFrame
): frame is Extract<ClientFrame, { readonly _tag: "Error" }> =>
  request.method === "tools/call" && frame._tag === "Error" &&
  frame.response.error.code === HEADER_MISMATCH_ERROR_CODE

const preserveOriginalRetryFailure = (
  retry: Stream.Stream<ClientFrame, StreamableHttpClientTransportError>,
  original: Extract<ClientFrame, { readonly _tag: "Error" }>
): Stream.Stream<ClientFrame, StreamableHttpClientTransportError> => Stream.suspend(() => {
  let terminal: "none" | "original" | "success" = "none"
  return retry.pipe(
    Stream.map((frame) => {
      if (frame._tag === "Success") {
        terminal = "success"
        return frame
      }
      if (frame._tag === "Error") {
        terminal = "original"
        return original
      }
      return frame
    }),
    Stream.catchAll((error) => terminal === "success"
      ? Stream.fail(error)
      : terminal === "original"
        ? Stream.empty
        : Stream.succeed(original))
  )
})

function requestWithPolicy(
  options: ValidatedOptions,
  request: JsonRpcRequest,
  context: RequestContext,
  allowRecovery: boolean
): Stream.Stream<ClientFrame, StreamableHttpClientTransportError> {
  return Stream.suspend(() => {
    const attempt: RequestAttempt = { mode: "unknown", cleanEof: false, stagedCatalog: undefined }
    return jsonRequest(options, request, context, attempt).pipe(
      Stream.mapEffect((frame) => processFrame(options, request, context, attempt, frame)),
      Stream.onDone(() => commitStagedCatalog(options, request, context, attempt)),
      Stream.flatMap((frame) => {
        if (!allowRecovery || !isHeaderMismatchFrame(request, frame)) return Stream.succeed(frame)
        const toolName = toolCallName(request)
        if (toolName === undefined) return Stream.succeed(frame)
        return Stream.unwrap(Effect.gen(function*() {
          yield* invalidateToolPlan(options, toolName)
          const metadata = yield* copyRequestMetadata(request)
          const counter = yield* Ref.getAndUpdate(options.internalCounter, (value) => value + 1)
          const refresh: JsonRpcRequest = {
            _tag: "Request",
            jsonrpc: "2.0",
            id: `${options.internalNamespace}:${counter}`,
            method: "tools/list",
            params: { _meta: metadata }
          }
          const terminal = yield* requestWithPolicy(options, refresh, context, false).pipe(Stream.runLast)
          const localPlans = yield* Ref.get(context.latestToolPlans)
          const localPlan = Object.getOwnPropertyDescriptor(localPlans, toolName)
          if (Option.isNone(terminal) || terminal.value._tag !== "Success" ||
            localPlan === undefined || !("value" in localPlan)) {
            return Stream.succeed(frame)
          }
          return preserveOriginalRetryFailure(
            requestWithPolicy(options, request, context, false),
            frame
          )
        }).pipe(
          Effect.catchAll(() => Effect.succeed(Stream.succeed(frame)))
        ))
      })
    )
  })
}

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
  const toolPlans = yield* Ref.make<Readonly<Record<string, HttpToolHeaderPlan>>>(emptyToolPlans())
  const internalCounter = yield* Ref.make(0)
  const internalNamespace = yield* Effect.try({
    try: () => crypto.randomUUID(),
    catch: (cause) => failure("Could not create HTTP refresh request namespace", cause)
  })
  const validated: ValidatedOptions = {
    url,
    callerHeaders,
    fetch: options.fetch ?? fetch,
    authorization: options.authorization,
    warningSink: options.warningSink ?? ((warning) => Effect.logWarning(warning)),
    toolPlans,
    internalNamespace,
    internalCounter,
    maxLineBytes,
    maxEventBytes,
    maxJsonBytes
  }
  return {
    request: (request) => Stream.unwrapScoped(Effect.gen(function*() {
      const authRetried = yield* Ref.make(false)
      const initialGrant = validated.authorization === undefined
        ? Option.none()
        : yield* validated.authorization.client.currentGrant({
          protectedResource: validated.authorization.protectedResource,
          requestedScopes: validated.authorization.requestedScopes
        }).pipe(
          Effect.mapError((cause) => failure("Could not resolve current authorization grant", cause))
        )
      const authorizationGrant = yield* Ref.make(initialGrant)
      const latestToolPlans = yield* Ref.make<Readonly<Record<string, HttpToolHeaderPlan>>>(
        emptyToolPlans()
      )
      return requestWithPolicy(validated, request, {
        authRetried,
        authorizationGrant,
        latestToolPlans
      }, true)
    }))
  }
})
