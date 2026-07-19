import * as Redacted from "effect/Redacted"
import type { AuthorizationHttpResponse } from "./models.js"

export const MAX_AUTHORIZATION_JSON_BYTES = 1024 * 1024

type DecodeResult =
  | { readonly _tag: "Success"; readonly value: Record<string, unknown> }
  | { readonly _tag: "Failure" }

type EncodeResult =
  | { readonly _tag: "Success"; readonly value: Redacted.Redacted<Uint8Array> }
  | { readonly _tag: "Failure" }

export type HttpReplySnapshotResult =
  | {
    readonly _tag: "Success"
    readonly value: {
      readonly status: number
      readonly body: Redacted.Redacted<Uint8Array>
    }
  }
  | { readonly _tag: "Failure" }

const decodeFailure: DecodeResult = Object.freeze({ _tag: "Failure" })
const encodeFailure: EncodeResult = Object.freeze({ _tag: "Failure" })
const replyFailure: HttpReplySnapshotResult = Object.freeze({ _tag: "Failure" })

const ownDataValue = (source: object, key: PropertyKey): unknown => {
  const descriptor = Reflect.getOwnPropertyDescriptor(source, key)
  if (descriptor === undefined || !("value" in descriptor)) throw new TypeError("Invalid reply")
  return descriptor.value
}

export const snapshotHttpReply = (input: AuthorizationHttpResponse): HttpReplySnapshotResult => {
  try {
    if ((typeof input !== "object" && typeof input !== "function") || input === null) return replyFailure
    Reflect.ownKeys(input)
    const status = ownDataValue(input, "status")
    const body = ownDataValue(input, "body")
    if (typeof status !== "number" || !Number.isInteger(status) || status < 100 || status > 599 ||
      !Redacted.isRedacted(body)) return replyFailure
    return {
      _tag: "Success",
      value: Object.freeze({ status, body: body as Redacted.Redacted<Uint8Array> })
    }
  } catch {
    return replyFailure
  }
}

const snapshotBytes = (body: Redacted.Redacted<Uint8Array>): Uint8Array | undefined => {
  try {
    const bytes = Redacted.value(body)
    if (!(bytes instanceof Uint8Array) || Object.getPrototypeOf(bytes) !== Uint8Array.prototype) {
      return undefined
    }
    const length = bytes.length
    if (!Number.isSafeInteger(length) || length > MAX_AUTHORIZATION_JSON_BYTES) return undefined
    const output = new Uint8Array(length)
    for (let index = 0; index < length; index += 1) output[index] = bytes[index]!
    return output
  } catch {
    return undefined
  }
}

const decodeUtf8 = (bytes: Uint8Array): string | undefined => {
  try {
    let output = ""
    for (let index = 0; index < bytes.length;) {
      const first = bytes[index]!
      if (first <= 0x7f) {
        output += String.fromCharCode(first)
        index += 1
        continue
      }
      if (first >= 0xc2 && first <= 0xdf) {
        if (index + 1 >= bytes.length) return undefined
        const second = bytes[index + 1]!
        if ((second & 0xc0) !== 0x80) return undefined
        output += String.fromCharCode((first & 0x1f) << 6 | second & 0x3f)
        index += 2
        continue
      }
      if (first >= 0xe0 && first <= 0xef) {
        if (index + 2 >= bytes.length) return undefined
        const second = bytes[index + 1]!
        const third = bytes[index + 2]!
        if ((second & 0xc0) !== 0x80 || (third & 0xc0) !== 0x80 ||
          first === 0xe0 && second < 0xa0 || first === 0xed && second >= 0xa0) return undefined
        output += String.fromCharCode(
          (first & 0x0f) << 12 | (second & 0x3f) << 6 | third & 0x3f
        )
        index += 3
        continue
      }
      if (first >= 0xf0 && first <= 0xf4) {
        if (index + 3 >= bytes.length) return undefined
        const second = bytes[index + 1]!
        const third = bytes[index + 2]!
        const fourth = bytes[index + 3]!
        if ((second & 0xc0) !== 0x80 || (third & 0xc0) !== 0x80 ||
          (fourth & 0xc0) !== 0x80 || first === 0xf0 && second < 0x90 ||
          first === 0xf4 && second >= 0x90) return undefined
        const codePoint = (first & 0x07) << 18 | (second & 0x3f) << 12 |
          (third & 0x3f) << 6 | fourth & 0x3f
        output += String.fromCodePoint(codePoint)
        index += 4
        continue
      }
      return undefined
    }
    return output
  } catch {
    return undefined
  }
}

const encodeUtf8 = (value: string): Uint8Array | undefined => {
  try {
    const output: Array<number> = []
    for (let index = 0; index < value.length; index += 1) {
      const first = value.charCodeAt(index)
      let codePoint = first
      if (first >= 0xd800 && first <= 0xdbff) {
        if (index + 1 >= value.length) return undefined
        const second = value.charCodeAt(index + 1)
        if (second < 0xdc00 || second > 0xdfff) return undefined
        codePoint = 0x10000 + (first - 0xd800) * 0x400 + second - 0xdc00
        index += 1
      } else if (first >= 0xdc00 && first <= 0xdfff) {
        return undefined
      }
      if (codePoint <= 0x7f) {
        output.push(codePoint)
      } else if (codePoint <= 0x7ff) {
        output.push(0xc0 | codePoint >> 6, 0x80 | codePoint & 0x3f)
      } else if (codePoint <= 0xffff) {
        output.push(
          0xe0 | codePoint >> 12,
          0x80 | codePoint >> 6 & 0x3f,
          0x80 | codePoint & 0x3f
        )
      } else {
        output.push(
          0xf0 | codePoint >> 18,
          0x80 | codePoint >> 12 & 0x3f,
          0x80 | codePoint >> 6 & 0x3f,
          0x80 | codePoint & 0x3f
        )
      }
      if (output.length > MAX_AUTHORIZATION_JSON_BYTES) return undefined
    }
    return Uint8Array.from(output)
  } catch {
    return undefined
  }
}

export const decodeJsonObject = (body: Redacted.Redacted<Uint8Array>): DecodeResult => {
  const bytes = snapshotBytes(body)
  if (bytes === undefined) return decodeFailure
  const text = decodeUtf8(bytes)
  if (text === undefined) return decodeFailure
  try {
    const value: unknown = JSON.parse(text)
    if (typeof value !== "object" || value === null || Array.isArray(value) ||
      Object.getPrototypeOf(value) !== Object.prototype) return decodeFailure
    return { _tag: "Success", value: value as Record<string, unknown> }
  } catch {
    return decodeFailure
  }
}

export const encodeJsonObject = (value: Record<string, unknown>): EncodeResult => {
  try {
    const text = JSON.stringify(value)
    const bytes = encodeUtf8(text)
    return bytes === undefined
      ? encodeFailure
      : { _tag: "Success", value: Redacted.make(bytes) }
  } catch {
    return encodeFailure
  }
}
