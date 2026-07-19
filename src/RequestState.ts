import * as Cause from "effect/Cause"
import * as Chunk from "effect/Chunk"
import * as Context from "effect/Context"
import * as Data from "effect/Data"
import * as Effect from "effect/Effect"
import * as HashSet from "effect/HashSet"
import * as Ref from "effect/Ref"
import {
  cloneExactUint8Array,
  invalidExactUint8Array,
  notArrayBufferView
} from "./internal/ExactUint8Array.js"

const VERSION = 1
const IV_BYTES = 12
const NONCE_BYTES = 16
const TAG_BITS = 128
const MAX_TTL_MS = 300_000
const MAX_STATE_BYTES = 8_192
const MAX_BINDING_BYTES = 256
const MAX_TOKEN_BYTES = 16_384
const MAX_REPLAY_CAPACITY = 1_024
const encoder = new TextEncoder()
const decoder = new TextDecoder("utf-8", { fatal: true })

export type RequestStateErrorReason =
  | "InvalidConfiguration"
  | "InvalidInput"
  | "CryptoUnavailable"
  | "InvalidToken"
  | "AuthenticationFailed"
  | "FutureIssued"
  | "Expired"
  | "Replay"
  | "ReplayStoreFull"
  | "ReplayStoreFailure"

export class RequestStateError extends Data.TaggedError("RequestStateError")<{
  readonly reason: RequestStateErrorReason
  readonly message: string
  readonly cause?: unknown
}> {}

export interface RequestStateReplayStoreService {
  readonly consume: (entry: {
    readonly nonce: string
    readonly expiresAt: number
    readonly now: number
  }) => Effect.Effect<void, RequestStateError>
}

export class RequestStateReplayStore extends Context.Tag("mcp/RequestStateReplayStore")<
  RequestStateReplayStore,
  RequestStateReplayStoreService
>() {
  static memory(options: { readonly capacity?: number } = {}): Effect.Effect<RequestStateReplayStoreService, RequestStateError> {
    return Effect.gen(function*() {
      const capacity = options.capacity ?? MAX_REPLAY_CAPACITY
      if (!Number.isSafeInteger(capacity) || capacity <= 0 || capacity > MAX_REPLAY_CAPACITY) {
        return yield* requestStateFailure("InvalidConfiguration", "Replay-store capacity must be 1..1024")
      }
      const entries = yield* Ref.make<ReadonlyMap<string, number>>(new Map())
      return RequestStateReplayStore.of({
        consume: ({ nonce, expiresAt, now }) => Ref.modify(entries, (current) => {
          const live = new Map<string, number>()
          for (const [key, expiry] of current) {
            if (expiry > now) live.set(key, expiry)
          }
          if (live.has(nonce)) {
            return [new RequestStateError({
              reason: "Replay", message: "Request-state token was already consumed"
            }), live] as const
          }
          if (live.size >= capacity) {
            return [new RequestStateError({
              reason: "ReplayStoreFull", message: "Replay store is full"
            }), live] as const
          }
          live.set(nonce, expiresAt)
          return [undefined, live] as const
        }).pipe(Effect.flatMap((error) => error === undefined ? Effect.void : Effect.fail(error)))
      })
    })
  }
}

export interface SecureRequestStateOptions {
  readonly key: Uint8Array
  readonly ttlMs: number
  readonly now?: () => number
}

export interface SecureRequestStateService {
  readonly seal: (input: {
    readonly state: string
    readonly principal: string
    readonly purpose: string
  }) => Effect.Effect<string, RequestStateError>
  readonly open: (input: {
    readonly token: string
    readonly principal: string
    readonly purpose: string
  }) => Effect.Effect<string, RequestStateError>
}

export class SecureRequestState extends Context.Tag("mcp/SecureRequestState")<
  SecureRequestState,
  SecureRequestStateService
>() {
  static make(
    options: SecureRequestStateOptions
  ): Effect.Effect<SecureRequestStateService, RequestStateError, RequestStateReplayStore> {
    return Effect.gen(function*() {
      const replayStore = yield* RequestStateReplayStore
      const ttlMs = options.ttlMs
      if (!Number.isSafeInteger(ttlMs) || ttlMs <= 0 || ttlMs > MAX_TTL_MS) {
        return yield* requestStateFailure("InvalidConfiguration", "Request-state TTL must be 1..300000ms")
      }
      const copied = cloneExactUint8Array(options.key)
      if (copied === notArrayBufferView || copied === invalidExactUint8Array || copied.byteLength !== 32) {
        return yield* requestStateFailure("InvalidConfiguration", "Request-state key must be exactly 32 bytes")
      }
      const crypto = yield* webCrypto()
      const cryptoKey = yield* Effect.tryPromise({
        try: () => crypto.subtle.importKey(
          "raw", copied, { name: "AES-GCM" }, false, ["encrypt", "decrypt"]
        ),
        catch: (cause) => requestStateError(
          "InvalidConfiguration", "Could not import request-state key", cause
        )
      }).pipe(Effect.ensuring(Effect.sync(() => copied.fill(0))))
      const now = options.now ?? Date.now

      const seal: SecureRequestStateService["seal"] = (input) => Effect.gen(function*() {
        const principal = yield* binding(input.principal, "principal")
        const purpose = yield* binding(input.purpose, "purpose")
        if (typeof input.state !== "string" || encoder.encode(input.state).byteLength > MAX_STATE_BYTES) {
          return yield* requestStateFailure("InvalidInput", "Request state must be a string of at most 8192 UTF-8 bytes")
        }
        const issuedAt = yield* currentTime(now)
        const expiresAt = issuedAt + ttlMs
        if (!Number.isSafeInteger(expiresAt)) {
          return yield* requestStateFailure("InvalidInput", "Request-state timestamp is out of range")
        }
        const iv = yield* randomBytes(crypto, IV_BYTES)
        const nonce = yield* randomBytes(crypto, NONCE_BYTES)
        const envelope = JSON.stringify({
          v: VERSION,
          iat: issuedAt,
          exp: expiresAt,
          n: encodeBase64Url(nonce),
          state: input.state
        })
        const plaintext = encoder.encode(envelope)
        const aad = additionalData(principal, purpose)
        const encrypted = yield* Effect.tryPromise({
          try: () => crypto.subtle.encrypt({
            name: "AES-GCM", iv, additionalData: aad, tagLength: TAG_BITS
          }, cryptoKey, plaintext),
          catch: (cause) => requestStateError("AuthenticationFailed", "Could not seal request state", cause)
        })
        const ciphertext = new Uint8Array(encrypted)
        const tokenBytes = new Uint8Array(1 + iv.byteLength + ciphertext.byteLength)
        tokenBytes[0] = VERSION
        tokenBytes.set(iv, 1)
        tokenBytes.set(ciphertext, 1 + iv.byteLength)
        return encodeBase64Url(tokenBytes)
      })

      const open: SecureRequestStateService["open"] = (input) => Effect.gen(function*() {
        const principal = yield* binding(input.principal, "principal")
        const purpose = yield* binding(input.purpose, "purpose")
        if (typeof input.token !== "string" || input.token.length === 0 || input.token.length > MAX_TOKEN_BYTES) {
          return yield* requestStateFailure("InvalidToken", "Invalid request-state token")
        }
        const tokenBytes = decodeBase64Url(input.token)
        if (tokenBytes === undefined || tokenBytes.byteLength <= 1 + IV_BYTES + 16 || tokenBytes[0] !== VERSION) {
          return yield* requestStateFailure("InvalidToken", "Invalid request-state token")
        }
        const iv = tokenBytes.slice(1, 1 + IV_BYTES)
        const ciphertext = tokenBytes.slice(1 + IV_BYTES)
        const aad = additionalData(principal, purpose)
        const plaintext = yield* Effect.tryPromise({
          try: () => crypto.subtle.decrypt({
            name: "AES-GCM", iv, additionalData: aad, tagLength: TAG_BITS
          }, cryptoKey, ciphertext),
          catch: (cause) => requestStateError(
            "AuthenticationFailed", "Request-state authentication failed", cause
          )
        })
        const envelope = yield* parseEnvelope(new Uint8Array(plaintext))
        const instant = yield* currentTime(now)
        if (envelope.iat > instant) {
          return yield* requestStateFailure("FutureIssued", "Request-state token was issued in the future")
        }
        if (instant >= envelope.exp) {
          return yield* requestStateFailure("Expired", "Request-state token has expired")
        }
        yield* Effect.suspend(() => replayStore.consume({
          nonce: envelope.n,
          expiresAt: envelope.exp,
          now: instant
        })).pipe(Effect.catchAllCause((cause) => {
          const failures = Cause.failures(cause)
          if (Chunk.size(failures) === 1 && Chunk.unsafeGet(failures, 0) instanceof RequestStateError &&
            Chunk.size(Cause.defects(cause)) === 0 && HashSet.size(Cause.interruptors(cause)) === 0) {
            return Effect.fail(Chunk.unsafeGet(failures, 0))
          }
          return Effect.fail(requestStateError(
            "ReplayStoreFailure", "Replay-store operation failed", cause
          ))
        }))
        return envelope.state
      })

      return SecureRequestState.of({ seal, open })
    })
  }
}

export interface HarmlessRawRequestState {
  readonly _tag: "HarmlessRawRequestState"
  readonly value: string
}

export const HarmlessRawRequestState = Object.freeze({
  make: (value: string): Effect.Effect<HarmlessRawRequestState, RequestStateError> =>
    typeof value !== "string" || encoder.encode(value).byteLength > MAX_STATE_BYTES
      ? requestStateFailure("InvalidInput", "Raw harmless state must be a string of at most 8192 UTF-8 bytes")
      : Effect.succeed(Object.freeze({ _tag: "HarmlessRawRequestState" as const, value }))
})

interface CryptoLike {
  readonly getRandomValues: (value: Uint8Array) => Uint8Array
  readonly subtle: {
    readonly importKey: (
      format: "raw",
      key: Uint8Array,
      algorithm: { readonly name: "AES-GCM" },
      extractable: false,
      usages: ReadonlyArray<"encrypt" | "decrypt">
    ) => Promise<unknown>
    readonly encrypt: (
      algorithm: AesGcmAlgorithm,
      key: unknown,
      data: Uint8Array
    ) => Promise<ArrayBuffer>
    readonly decrypt: (
      algorithm: AesGcmAlgorithm,
      key: unknown,
      data: Uint8Array
    ) => Promise<ArrayBuffer>
  }
}

interface AesGcmAlgorithm {
  readonly name: "AES-GCM"
  readonly iv: Uint8Array
  readonly additionalData: Uint8Array
  readonly tagLength: 128
}

const webCrypto = (): Effect.Effect<CryptoLike, RequestStateError> => Effect.try({
  try: () => {
    const crypto = (globalThis as unknown as { readonly crypto?: unknown }).crypto
    if (typeof crypto !== "object" || crypto === null) throw new TypeError("Missing WebCrypto")
    const candidate = crypto as Partial<CryptoLike>
    if (typeof candidate.getRandomValues !== "function" || typeof candidate.subtle !== "object" ||
      candidate.subtle === null || typeof candidate.subtle.importKey !== "function" ||
      typeof candidate.subtle.encrypt !== "function" || typeof candidate.subtle.decrypt !== "function") {
      throw new TypeError("Incomplete WebCrypto")
    }
    return candidate as CryptoLike
  },
  catch: (cause) => requestStateError("CryptoUnavailable", "WebCrypto AES-GCM is unavailable", cause)
})

const randomBytes = (crypto: CryptoLike, length: number): Effect.Effect<Uint8Array, RequestStateError> =>
  Effect.try({
    try: () => crypto.getRandomValues(new Uint8Array(length)),
    catch: (cause) => requestStateError("CryptoUnavailable", "WebCrypto randomness is unavailable", cause)
  })

const currentTime = (now: () => number): Effect.Effect<number, RequestStateError> => Effect.try({
  try: () => {
    const value = now()
    if (!Number.isSafeInteger(value) || value < 0) throw new TypeError("Invalid clock")
    return value
  },
  catch: (cause) => requestStateError("InvalidInput", "Request-state clock returned an invalid timestamp", cause)
})

const binding = (value: unknown, label: string): Effect.Effect<Uint8Array, RequestStateError> => {
  if (typeof value !== "string" || value.length === 0) {
    return requestStateFailure("InvalidInput", `${label} must be a non-empty string`)
  }
  const encoded = encoder.encode(value)
  return encoded.byteLength > MAX_BINDING_BYTES
    ? requestStateFailure("InvalidInput", `${label} exceeds 256 UTF-8 bytes`)
    : Effect.succeed(encoded)
}

const additionalData = (principal: Uint8Array, purpose: Uint8Array): Uint8Array => {
  const output = new Uint8Array(5 + principal.byteLength + purpose.byteLength)
  const view = new DataView(output.buffer)
  output[0] = VERSION
  view.setUint16(1, principal.byteLength, false)
  output.set(principal, 3)
  view.setUint16(3 + principal.byteLength, purpose.byteLength, false)
  output.set(purpose, 5 + principal.byteLength)
  return output
}

interface Envelope {
  readonly v: 1
  readonly iat: number
  readonly exp: number
  readonly n: string
  readonly state: string
}

const parseEnvelope = (bytes: Uint8Array): Effect.Effect<Envelope, RequestStateError> => Effect.try({
  try: () => {
    const text = decoder.decode(bytes)
    const value: unknown = JSON.parse(text)
    if (typeof value !== "object" || value === null || Array.isArray(value)) throw new TypeError("Invalid envelope")
    const record = value as Record<string, unknown>
    if (Reflect.ownKeys(record).length !== 5 || record.v !== VERSION ||
      !Number.isSafeInteger(record.iat) || !Number.isSafeInteger(record.exp) ||
      typeof record.n !== "string" || decodeBase64Url(record.n)?.byteLength !== NONCE_BYTES ||
      typeof record.state !== "string" || encoder.encode(record.state).byteLength > MAX_STATE_BYTES) {
      throw new TypeError("Invalid envelope")
    }
    const envelope = record as unknown as Envelope
    if (envelope.iat < 0 || envelope.exp <= envelope.iat ||
      JSON.stringify({ v: envelope.v, iat: envelope.iat, exp: envelope.exp, n: envelope.n, state: envelope.state }) !== text) {
      throw new TypeError("Non-canonical envelope")
    }
    return envelope
  },
  catch: (cause) => requestStateError("InvalidToken", "Invalid request-state token", cause)
})

const BASE64URL = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_"

const encodeBase64Url = (bytes: Uint8Array): string => {
  let output = ""
  for (let index = 0; index < bytes.length; index += 3) {
    const a = bytes[index]
    const b = index + 1 < bytes.length ? bytes[index + 1] : 0
    const c = index + 2 < bytes.length ? bytes[index + 2] : 0
    output += BASE64URL[a >>> 2]
    output += BASE64URL[((a & 3) << 4) | (b >>> 4)]
    if (index + 1 < bytes.length) output += BASE64URL[((b & 15) << 2) | (c >>> 6)]
    if (index + 2 < bytes.length) output += BASE64URL[c & 63]
  }
  return output
}

const decodeBase64Url = (value: string): Uint8Array | undefined => {
  if (!/^[A-Za-z0-9_-]*$/.test(value) || value.length % 4 === 1) return undefined
  const output: number[] = []
  for (let index = 0; index < value.length; index += 4) {
    const a = BASE64URL.indexOf(value[index] ?? "")
    const b = BASE64URL.indexOf(value[index + 1] ?? "")
    const c = index + 2 < value.length ? BASE64URL.indexOf(value[index + 2]) : 0
    const d = index + 3 < value.length ? BASE64URL.indexOf(value[index + 3]) : 0
    if (a < 0 || b < 0 || c < 0 || d < 0) return undefined
    output.push((a << 2) | (b >>> 4))
    if (index + 2 < value.length) output.push(((b & 15) << 4) | (c >>> 2))
    if (index + 3 < value.length) output.push(((c & 3) << 6) | d)
  }
  const bytes = Uint8Array.from(output)
  return encodeBase64Url(bytes) === value ? bytes : undefined
}

const requestStateError = (
  reason: RequestStateErrorReason,
  message: string,
  cause: unknown
): RequestStateError => {
  const error = new RequestStateError({ reason, message })
  Object.defineProperty(error, "cause", {
    configurable: true,
    enumerable: false,
    value: cause,
    writable: false
  })
  return error
}

const requestStateFailure = (
  reason: RequestStateErrorReason,
  message: string
): Effect.Effect<never, RequestStateError> => Effect.fail(new RequestStateError({ reason, message }))
