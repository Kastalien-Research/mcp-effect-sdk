/** Pure metadata and header-value rules for MCP 2026-07-28 Streamable HTTP. */
import * as Effect from "effect/Effect"
import { HeaderMismatchError } from "../McpErrors.js"
import type { JsonRpcRequest } from "../McpWire.js"
import {
  CLIENT_REQUEST_DESCRIPTOR_BY_METHOD,
  type ClientRequestMethod
} from "../generated/mcp/2026-07-28/McpProtocol.generated.js"
import {
  MCP_METHOD_HEADER,
  MCP_NAME_HEADER,
  MCP_PROTOCOL_VERSION_HEADER,
  MCP_PROTOCOL_VERSION_META_KEY
} from "../McpModern.js"

export type HttpHeaderSource = Headers | Readonly<Record<string, string>>

const sentinelPrefix = "=?base64?"
const sentinelSuffix = "?="
const textEncoder = new TextEncoder()
const textDecoder = new TextDecoder("utf-8", { fatal: true })

const mismatch = (message: string, cause?: unknown): HeaderMismatchError =>
  new HeaderMismatchError({
    message,
    ...(cause === undefined ? {} : { cause })
  })

const isPlainHeaderValue = (value: string): boolean => {
  if (value.length === 0) return true
  if (value[0] === " " || value[0] === "\t" ||
    value[value.length - 1] === " " || value[value.length - 1] === "\t") {
    return false
  }
  for (let index = 0; index < value.length; index++) {
    const code = value.charCodeAt(index)
    if (code !== 0x09 && (code < 0x20 || code > 0x7e)) return false
  }
  return true
}

const bytesToBase64 = (bytes: Uint8Array): string => {
  let binary = ""
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary)
}

const base64ToBytes = (value: string): Uint8Array => {
  const binary = atob(value)
  const bytes = new Uint8Array(binary.length)
  for (let index = 0; index < binary.length; index++) bytes[index] = binary.charCodeAt(index)
  return bytes
}

const isSentinel = (value: string): boolean =>
  value.startsWith(sentinelPrefix) && value.endsWith(sentinelSuffix)

export const encodeHeaderValue = (value: string): string =>
  isPlainHeaderValue(value) && !isSentinel(value)
    ? value
    : `${sentinelPrefix}${bytesToBase64(textEncoder.encode(value))}${sentinelSuffix}`

export const decodeHeaderValue = (
  value: string
): Effect.Effect<string, HeaderMismatchError> => {
  if (!isSentinel(value)) {
    return isPlainHeaderValue(value)
      ? Effect.succeed(value)
      : Effect.fail(mismatch("HTTP metadata header value is not safe ASCII"))
  }

  const payload = value.slice(sentinelPrefix.length, -sentinelSuffix.length)
  if (payload.length % 4 !== 0 ||
    !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(payload)) {
    return Effect.fail(mismatch("HTTP metadata header contains invalid base64"))
  }

  return Effect.try({
    try: () => {
      const bytes = base64ToBytes(payload)
      if (bytesToBase64(bytes) !== payload) throw new Error("Non-canonical base64")
      return textDecoder.decode(bytes)
    },
    catch: (cause) => mismatch("HTTP metadata header contains invalid UTF-8", cause)
  })
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value)

const requestDescriptor = (method: string) => Object.hasOwn(CLIENT_REQUEST_DESCRIPTOR_BY_METHOD, method)
  ? CLIENT_REQUEST_DESCRIPTOR_BY_METHOD[method as ClientRequestMethod]
  : undefined

const nameValue = (request: JsonRpcRequest): string | undefined => {
  const descriptor = requestDescriptor(request.method)
  const source = descriptor?.http.nameSource
  if (source === null || source === undefined || !isRecord(request.params)) return undefined
  const key = source === "params.uri" ? "uri" : "name"
  const value = request.params[key]
  return typeof value === "string" ? value : undefined
}

const protocolVersion = (request: JsonRpcRequest): string | undefined => {
  if (!isRecord(request.params) || !isRecord(request.params._meta)) return undefined
  const value = request.params._meta[MCP_PROTOCOL_VERSION_META_KEY]
  return typeof value === "string" ? value : undefined
}

export const standardRequestHeaders = (
  request: JsonRpcRequest
): Effect.Effect<Readonly<Record<string, string>>, HeaderMismatchError> => {
  const version = protocolVersion(request)
  if (version === undefined) {
    return Effect.fail(mismatch("Request metadata is missing its protocol version"))
  }
  const descriptor = requestDescriptor(request.method)
  const requiresName = descriptor?.http.nameSource !== null && descriptor?.http.nameSource !== undefined
  const name = nameValue(request)
  if (requiresName && name === undefined) {
    return Effect.fail(mismatch("Request metadata is missing its required name value"))
  }
  return Effect.succeed({
    [MCP_PROTOCOL_VERSION_HEADER]: version,
    [MCP_METHOD_HEADER]: request.method,
    ...(name === undefined ? {} : { [MCP_NAME_HEADER]: encodeHeaderValue(name) })
  })
}

const headerValue = (headers: HttpHeaderSource, name: string): string | undefined => {
  if (headers instanceof Headers) return headers.get(name) ?? undefined
  const wanted = name.toLowerCase()
  const descriptors = Object.getOwnPropertyDescriptors(headers)
  for (const key of Reflect.ownKeys(descriptors)) {
    if (typeof key !== "string" || key.toLowerCase() !== wanted) continue
    const descriptor = descriptors[key]
    if (descriptor !== undefined && "value" in descriptor && typeof descriptor.value === "string") {
      return descriptor.value
    }
  }
  return undefined
}

export const validateStandardRequestHeaders = (
  request: JsonRpcRequest,
  headers: HttpHeaderSource
): Effect.Effect<void, HeaderMismatchError> => standardRequestHeaders(request).pipe(
  Effect.flatMap((expected) => {
    if (headerValue(headers, MCP_PROTOCOL_VERSION_HEADER) !== expected[MCP_PROTOCOL_VERSION_HEADER]) {
      return Effect.fail(mismatch("MCP protocol version header does not match request metadata"))
    }
    if (headerValue(headers, MCP_METHOD_HEADER) !== expected[MCP_METHOD_HEADER]) {
      return Effect.fail(mismatch("MCP method header does not match the request method"))
    }
    const expectedName = nameValue(request)
    const actualName = headerValue(headers, MCP_NAME_HEADER)
    if (expectedName === undefined) {
      return actualName === undefined
        ? Effect.void
        : Effect.fail(mismatch("Unexpected MCP name header"))
    }
    if (actualName === undefined) return Effect.fail(mismatch("Missing required MCP name header"))
    return decodeHeaderValue(actualName).pipe(
      Effect.flatMap((decoded) => decoded === expectedName
        ? Effect.void
        : Effect.fail(mismatch("MCP name header does not match the request body")))
    )
  })
)
