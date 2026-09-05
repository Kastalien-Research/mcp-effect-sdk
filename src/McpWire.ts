/** Exact MCP 2026-07-28 JSON-RPC wire boundary. */
import * as Result from "effect/Result"
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
import { cloneStrictJson, invalidStrictJson } from "./internal/StrictJson.js"

export const JsonRpcId = Generated.RequestId
export type JsonRpcId = typeof JsonRpcId.Type

export const JsonRpcRequestCodec = Generated.JSONRPCRequest
export const JsonRpcNotificationCodec = Generated.JSONRPCNotification
export const JsonRpcSuccessResponseCodec = Generated.JSONRPCResultResponse
const StrictJsonValueCodec = Schema.Unknown.pipe(
  Schema.refine((value): value is JsonValue => isStrictJsonValue(value), {
    message: "Expected a plain JSON value"
  })
)
const JsonRpcErrorObjectCodec = Schema.Struct({
  code: Schema.Int,
  message: Schema.String,
  data: Schema.optional(StrictJsonValueCodec)
}).annotate({ parseOptions: { onExcessProperty: "error" } })
export const JsonRpcErrorResponseCodec = Schema.Struct({
  jsonrpc: Schema.Literal("2.0"),
  id: JsonRpcId,
  error: JsonRpcErrorObjectCodec
}).annotate({ parseOptions: { onExcessProperty: "error" } })

export type JsonRpcRequest = Readonly<
  Pick<Generated.JSONRPCRequest, "jsonrpc" | "method" | "id" | "params"> & { readonly _tag: "Request" }
>
export type JsonRpcNotification = Readonly<
  Pick<Generated.JSONRPCNotification, "jsonrpc" | "method" | "params"> & { readonly _tag: "Notification" }
>
export type JsonRpcSuccessResponse = Readonly<
  Pick<Generated.JSONRPCResultResponse, "jsonrpc" | "id" | "result"> & { readonly _tag: "SuccessResponse" }
>
export type JsonRpcErrorResponse = Readonly<{
  readonly _tag: "ErrorResponse"
  readonly jsonrpc: "2.0"
  readonly id: JsonRpcId
  readonly error: JsonRpcErrorObject
}>
export type JsonRpcMessage = JsonRpcRequest | JsonRpcNotification | JsonRpcSuccessResponse | JsonRpcErrorResponse

const textDecoder = new TextDecoder("utf-8", { fatal: true })
const textEncoder = new TextEncoder()

export const decodeJsonRpc = (input: unknown): Result.Result<JsonRpcMessage, McpWireError> => {
  try {
    const normalized = cloneStrictJson(input)
    if (normalized === invalidStrictJson || !isRecord(normalized)) {
      return invalidRequest("JSON-RPC messages must be single JSON objects")
    }
    return decodeNormalizedJsonRpc(normalized)
  } catch (cause) {
    return invalidRequest("Could not inspect JSON-RPC message", cause)
  }
}

const decodeNormalizedJsonRpc = (input: Record<string, unknown>): Result.Result<JsonRpcMessage, McpWireError> => {
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

export const decodeJsonRpcText = (input: string): Result.Result<JsonRpcMessage, McpWireError> => {
  try {
    return decodeJsonRpc(JSON.parse(input))
  } catch (cause) {
    return Result.fail(new ParseError({ message: "Invalid JSON text", cause }))
  }
}

export const decodeJsonRpcBytes = (input: Uint8Array): Result.Result<JsonRpcMessage, McpWireError> => {
  try {
    return decodeJsonRpcText(textDecoder.decode(input))
  } catch (cause) {
    return Result.fail(new ParseError({ message: "Invalid UTF-8 JSON bytes", cause }))
  }
}

export const encodeJsonRpcText = (input: unknown): Result.Result<string, McpWireError> => {
  try {
    const normalized = cloneStrictJson(input)
    if (normalized === invalidStrictJson || !isRecord(normalized)) {
      return Result.fail(new SchemaValidationError({ message: "Cannot encode a non-JSON message" }))
    }
    const declaredTag = Object.hasOwn(normalized, "_tag") ? normalized["_tag"] : undefined
    const decoded = decodeJsonRpc(stripTag(normalized))
    if (Result.isFailure(decoded)) {
      return Result.fail(
        new SchemaValidationError({
          message: "Cannot encode an invalid JSON-RPC message",
          cause: decoded.failure
        })
      )
    }
    if (declaredTag !== undefined && declaredTag !== decoded.success._tag) {
      return Result.fail(
        new SchemaValidationError({
          message: "JSON-RPC discriminant does not match the wire envelope"
        })
      )
    }
    return Result.succeed(JSON.stringify(stripTag(decoded.success)))
  } catch (cause) {
    return Result.fail(new SchemaValidationError({ message: "Could not encode JSON-RPC message", cause }))
  }
}

export const encodeJsonRpcBytes = (input: unknown): Result.Result<Uint8Array, McpWireError> => {
  const encoded = encodeJsonRpcText(input)
  return Result.isFailure(encoded) ? Result.fail(encoded.failure) : Result.succeed(textEncoder.encode(encoded.success))
}

const decodeWithCodec = <Tag extends JsonRpcMessage["_tag"]>(
  codec: Schema.Codec<unknown, unknown>,
  input: unknown,
  tag: Tag
): Result.Result<JsonRpcMessage, McpWireError> => {
  const decoded = Schema.decodeUnknownResult(codec)(input)
  return Result.isFailure(decoded)
    ? invalidRequest(`Invalid JSON-RPC ${tag}`, decoded.failure)
    : Result.succeed({ ...(decoded.success as Record<string, unknown>), _tag: tag } as unknown as JsonRpcMessage)
}

const invalidRequest = (message: string, cause?: unknown): Result.Result<never, McpWireError> =>
  Result.fail(new InvalidRequest({ message, cause }))

const isExactErrorObject = (value: unknown): value is JsonRpcErrorObject => {
  if (!isRecord(value)) return false
  const keys = Object.keys(value)
  if (keys.some((key) => key !== "code" && key !== "message" && key !== "data")) return false
  if (!Number.isInteger(value.code) || typeof value.message !== "string") return false
  return !Object.hasOwn(value, "data") || toJsonValue(value.data) !== undefined
}

const isStrictJsonValue = (value: unknown): value is JsonValue => {
  try {
    return cloneStrictJson(value) !== invalidStrictJson
  } catch {
    return false
  }
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value)

const stripTag = (input: unknown): unknown => {
  if (!isRecord(input) || !Object.hasOwn(input, "_tag")) return input
  const { _tag: _, ...wire } = input
  return wire
}
