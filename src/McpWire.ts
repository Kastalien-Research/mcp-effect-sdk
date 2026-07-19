/** Exact MCP 2026-07-28 JSON-RPC wire boundary. */
import * as Either from "effect/Either"
import * as Schema from "effect/Schema"
import * as Generated from "./generated/mcp/2026-07-28/McpSchema.generated.js"
export * from "./McpErrors.js"
import {
  InvalidRequest,
  ParseError,
  SchemaValidationError,
  type McpWireError,
  type JsonValue,
  type JsonRpcErrorObject,
  toJsonValue
} from "./McpErrors.js"

export const JsonRpcId = Generated.RequestId
export type JsonRpcId = typeof JsonRpcId.Type

export const JsonRpcRequestCodec = Generated.JSONRPCRequest
export const JsonRpcNotificationCodec = Generated.JSONRPCNotification
export const JsonRpcSuccessResponseCodec = Generated.JSONRPCResultResponse
const StrictJsonValueCodec = Schema.Unknown.pipe(Schema.filter(
  (value): value is JsonValue => isStrictJsonValue(value),
  { message: () => "Expected a plain JSON value" }
))
const JsonRpcErrorObjectCodec = Schema.Struct({
  code: Schema.Int,
  message: Schema.String,
  data: Schema.optional(StrictJsonValueCodec)
}).annotations({ parseOptions: { onExcessProperty: "error" } })
export const JsonRpcErrorResponseCodec = Schema.Struct({
  jsonrpc: Schema.Literal("2.0"),
  id: JsonRpcId,
  error: JsonRpcErrorObjectCodec
}).annotations({ parseOptions: { onExcessProperty: "error" } })

export type JsonRpcRequest = Readonly<
  Pick<Generated.JSONRPCRequest, "jsonrpc" | "method" | "id" | "params">
  & { readonly _tag: "Request" }
>
export type JsonRpcNotification = Readonly<
  Pick<Generated.JSONRPCNotification, "jsonrpc" | "method" | "params">
  & { readonly _tag: "Notification" }
>
export type JsonRpcSuccessResponse = Readonly<
  Pick<Generated.JSONRPCResultResponse, "jsonrpc" | "id" | "result">
  & { readonly _tag: "SuccessResponse" }
>
export type JsonRpcErrorResponse = Readonly<{
  readonly _tag: "ErrorResponse"
  readonly jsonrpc: "2.0"
  readonly id: JsonRpcId
  readonly error: JsonRpcErrorObject
}>
export type JsonRpcMessage =
  | JsonRpcRequest
  | JsonRpcNotification
  | JsonRpcSuccessResponse
  | JsonRpcErrorResponse

const textDecoder = new TextDecoder("utf-8", { fatal: true })
const textEncoder = new TextEncoder()

export const decodeJsonRpc = (
  input: unknown
): Either.Either<JsonRpcMessage, McpWireError> => {
  try {
    const normalized = cloneStrictJsonValue(input, new Set())
    if (normalized === invalidJsonValue || !isRecord(normalized)) {
      return invalidRequest("JSON-RPC messages must be single JSON objects")
    }
    return decodeNormalizedJsonRpc(normalized)
  } catch (cause) {
    return invalidRequest("Could not inspect JSON-RPC message", cause)
  }
}

const decodeNormalizedJsonRpc = (
  input: Record<string, unknown>
): Either.Either<JsonRpcMessage, McpWireError> => {
  if (!isRecord(input)) {
    return invalidRequest("JSON-RPC messages must be single JSON objects")
  }
  if (input.jsonrpc !== "2.0") return invalidRequest("jsonrpc must equal 2.0")

  const hasMethod = Object.hasOwn(input, "method")
  const hasId = Object.hasOwn(input, "id")
  const hasResult = Object.hasOwn(input, "result")
  const hasError = Object.hasOwn(input, "error")

  if (hasMethod) {
    if (hasResult || hasError) return invalidRequest("method messages cannot contain result or error")
    return hasId
      ? decodeWithCodec(Generated.JSONRPCRequest, input, "Request")
      : decodeWithCodec(Generated.JSONRPCNotification, input, "Notification")
  }

  if (hasResult === hasError || !hasId) {
    return invalidRequest("responses require an id and exactly one of result or error")
  }
  if (hasResult) {
    return decodeWithCodec(Generated.JSONRPCResultResponse, input, "SuccessResponse")
  }
  if (!isExactErrorObject(input.error)) {
    return invalidRequest("error must contain exactly integer code, string message, and optional JSON data")
  }
  return decodeWithCodec(JsonRpcErrorResponseCodec, input, "ErrorResponse")
}

export const decodeJsonRpcText = (
  input: string
): Either.Either<JsonRpcMessage, McpWireError> => {
  try {
    return decodeJsonRpc(JSON.parse(input))
  } catch (cause) {
    return Either.left(new ParseError({ message: "Invalid JSON text", cause }))
  }
}

export const decodeJsonRpcBytes = (
  input: Uint8Array
): Either.Either<JsonRpcMessage, McpWireError> => {
  try {
    return decodeJsonRpcText(textDecoder.decode(input))
  } catch (cause) {
    return Either.left(new ParseError({ message: "Invalid UTF-8 JSON bytes", cause }))
  }
}

export const encodeJsonRpcText = (
  input: unknown
): Either.Either<string, McpWireError> => {
  try {
    const normalized = cloneStrictJsonValue(input, new Set())
    if (normalized === invalidJsonValue || !isRecord(normalized)) {
      return Either.left(new SchemaValidationError({ message: "Cannot encode a non-JSON message" }))
    }
    const declaredTag = Object.hasOwn(normalized, "_tag") ? normalized["_tag"] : undefined
    const decoded = decodeJsonRpc(stripTag(normalized))
    if (Either.isLeft(decoded)) {
      return Either.left(new SchemaValidationError({
        message: "Cannot encode an invalid JSON-RPC message",
        cause: decoded.left
      }))
    }
    if (declaredTag !== undefined && declaredTag !== decoded.right._tag) {
      return Either.left(new SchemaValidationError({
        message: "JSON-RPC discriminant does not match the wire envelope"
      }))
    }
    return Either.right(JSON.stringify(stripTag(decoded.right)))
  } catch (cause) {
    return Either.left(new SchemaValidationError({ message: "Could not encode JSON-RPC message", cause }))
  }
}

export const encodeJsonRpcBytes = (
  input: unknown
): Either.Either<Uint8Array, McpWireError> => {
  const encoded = encodeJsonRpcText(input)
  return Either.isLeft(encoded)
    ? Either.left(encoded.left)
    : Either.right(textEncoder.encode(encoded.right))
}

const decodeWithCodec = <Tag extends JsonRpcMessage["_tag"]>(
  codec: Schema.Schema.AnyNoContext,
  input: unknown,
  tag: Tag
): Either.Either<JsonRpcMessage, McpWireError> => {
  const decoded = Schema.decodeUnknownEither(codec)(input)
  return Either.isLeft(decoded)
    ? invalidRequest(`Invalid JSON-RPC ${tag}`, decoded.left)
    : Either.right({ ...decoded.right, _tag: tag } as unknown as JsonRpcMessage)
}

const invalidRequest = (
  message: string,
  cause?: unknown
): Either.Either<never, McpWireError> =>
  Either.left(new InvalidRequest({ message, cause }))

const isExactErrorObject = (value: unknown): value is JsonRpcErrorObject => {
  if (!isRecord(value)) return false
  const keys = Object.keys(value)
  if (keys.some((key) => key !== "code" && key !== "message" && key !== "data")) return false
  if (!Number.isInteger(value.code) || typeof value.message !== "string") return false
  return !Object.hasOwn(value, "data") || toJsonValue(value.data) !== undefined
}

const invalidJsonValue = Symbol("InvalidJsonValue")

const isStrictJsonValue = (value: unknown): value is JsonValue => {
  try {
    return cloneStrictJsonValue(value, new Set()) !== invalidJsonValue
  } catch {
    return false
  }
}

const cloneStrictJsonValue = (
  value: unknown,
  seen: Set<object>
): JsonValue | typeof invalidJsonValue => {
  if (value === null || typeof value === "string" || typeof value === "boolean") return value
  if (typeof value === "number") return Number.isFinite(value) ? value : invalidJsonValue
  if (typeof value !== "object" || seen.has(value)) return invalidJsonValue

  const prototype = Object.getPrototypeOf(value)
  if (Array.isArray(value)) {
    if (prototype !== Array.prototype) return invalidJsonValue
    const keys = Reflect.ownKeys(value)
    const elementKeys = keys.filter((key) => key !== "length")
    if (elementKeys.some((key) => typeof key !== "string") || elementKeys.length !== value.length) {
      return invalidJsonValue
    }
    const descriptors = Object.getOwnPropertyDescriptors(value)
    seen.add(value)
    try {
      const output: JsonValue[] = []
      for (let index = 0; index < value.length; index++) {
        const descriptor = descriptors[String(index)]
        if (descriptor === undefined || !("value" in descriptor) || !descriptor.enumerable) {
          return invalidJsonValue
        }
        const item = cloneStrictJsonValue(descriptor.value, seen)
        if (item === invalidJsonValue) return invalidJsonValue
        output.push(item)
      }
      return output
    } finally {
      seen.delete(value)
    }
  }
  if (prototype !== Object.prototype && prototype !== null) return invalidJsonValue

  const keys = Reflect.ownKeys(value)
  if (keys.some((key) => typeof key !== "string")) return invalidJsonValue
  const descriptors = Object.getOwnPropertyDescriptors(value)
  seen.add(value)
  try {
    const output: Record<string, JsonValue> = {}
    for (const key of keys as string[]) {
      const descriptor = descriptors[key]
      if (descriptor === undefined || !("value" in descriptor) || !descriptor.enumerable) {
        return invalidJsonValue
      }
      const item = cloneStrictJsonValue(descriptor.value, seen)
      if (item === invalidJsonValue) return invalidJsonValue
      defineJsonProperty(output, key, item)
    }
    return output
  } finally {
    seen.delete(value)
  }
}

const defineJsonProperty = (target: Record<string, JsonValue>, key: string, value: JsonValue): void => {
  Object.defineProperty(target, key, { value, enumerable: true, configurable: true, writable: true })
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value)

const stripTag = (input: unknown): unknown => {
  if (!isRecord(input) || !Object.hasOwn(input, "_tag")) return input
  const { _tag: _, ...wire } = input
  return wire
}
