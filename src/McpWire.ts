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
  type JsonRpcErrorObject,
  toJsonValue
} from "./McpErrors.js"

export const JsonRpcId = Generated.RequestId
export type JsonRpcId = typeof JsonRpcId.Type

export const JsonRpcRequestCodec = Generated.JSONRPCRequest
export const JsonRpcNotificationCodec = Generated.JSONRPCNotification
export const JsonRpcSuccessResponseCodec = Generated.JSONRPCResultResponse
export const JsonRpcErrorResponseCodec = Generated.JSONRPCErrorResponse

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
  if (!isJsonValue(input, new Set()) || !isRecord(input)) {
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
  return decodeWithCodec(Generated.JSONRPCErrorResponse, input, "ErrorResponse")
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
  const decoded = decodeJsonRpc(stripTag(input))
  if (Either.isLeft(decoded)) {
    return Either.left(new SchemaValidationError({
      message: "Cannot encode an invalid JSON-RPC message",
      cause: decoded.left
    }))
  }
  try {
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
    : Either.right({ _tag: tag, ...decoded.right } as unknown as JsonRpcMessage)
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

const isJsonValue = (value: unknown, seen: Set<object>): boolean => {
  if (value === null || typeof value === "string" || typeof value === "boolean") return true
  if (typeof value === "number") return Number.isFinite(value)
  if (typeof value !== "object" || value === null) return false
  if (seen.has(value)) return false
  seen.add(value)
  const valid = Array.isArray(value)
    ? value.every((item) => isJsonValue(item, seen))
    : isRecord(value) && Object.values(value).every((item) => isJsonValue(item, seen))
  seen.delete(value)
  return valid
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value)

const stripTag = (input: unknown): unknown => {
  if (!isRecord(input) || !Object.hasOwn(input, "_tag")) return input
  const { _tag: _, ...wire } = input
  return wire
}
