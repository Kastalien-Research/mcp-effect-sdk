/** JSON-RPC 2.0 envelope codec for the MCP 2025-11-25 profile. */
import * as Data from "effect/Data"
import * as Either from "effect/Either"
import type { JsonRpcMessage } from "../McpWire.js"
import { cloneStrictJson, invalidStrictJson } from "../internal/StrictJson.js"

export class LegacyWireError extends Data.TaggedError("LegacyWireError")<{
  readonly message: string
  readonly cause?: unknown
}> {}

const wireError = (message: string, cause?: unknown) =>
  new LegacyWireError({ message, ...(cause === undefined ? {} : { cause }) })
const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value)
const isId = (value: unknown): value is string | number =>
  typeof value === "string" || (typeof value === "number" && Number.isFinite(value))

export const decodeJsonRpc = (input: unknown): Either.Either<JsonRpcMessage, LegacyWireError> => {
  try {
    const value = cloneStrictJson(input)
    if (value === invalidStrictJson || !isRecord(value) || value.jsonrpc !== "2.0") {
      return Either.left(wireError("Expected one JSON-RPC 2.0 object"))
    }
    const hasMethod = Object.hasOwn(value, "method")
    const hasId = Object.hasOwn(value, "id")
    const hasResult = Object.hasOwn(value, "result")
    const hasError = Object.hasOwn(value, "error")
    if (hasMethod) {
      if (typeof value.method !== "string" || hasResult || hasError || (hasId && !isId(value.id))) {
        return Either.left(wireError("Invalid JSON-RPC method envelope"))
      }
      if (value.params !== undefined && !isRecord(value.params))
        return Either.left(wireError("params must be an object"))
      return Either.right({
        _tag: hasId ? "Request" : "Notification",
        jsonrpc: "2.0",
        ...(hasId ? { id: value.id as string | number } : {}),
        method: value.method,
        ...(value.params === undefined ? {} : { params: value.params })
      } as JsonRpcMessage)
    }
    if (!hasId || !isId(value.id) || hasResult === hasError)
      return Either.left(wireError("Invalid JSON-RPC response envelope"))
    if (hasResult) {
      if (!isRecord(value.result)) return Either.left(wireError("result must be an object"))
      return Either.right({
        _tag: "SuccessResponse",
        jsonrpc: "2.0",
        id: value.id,
        result: value.result
      } as unknown as JsonRpcMessage)
    }
    if (!isRecord(value.error) || !Number.isInteger(value.error.code) || typeof value.error.message !== "string") {
      return Either.left(wireError("Invalid JSON-RPC error object"))
    }
    return Either.right({
      _tag: "ErrorResponse",
      jsonrpc: "2.0",
      id: value.id,
      error: {
        code: value.error.code as number,
        message: value.error.message,
        ...(value.error.data === undefined ? {} : { data: value.error.data as never })
      }
    })
  } catch (cause) {
    return Either.left(wireError("Could not inspect JSON-RPC message", cause))
  }
}

export const decodeJsonRpcText = (text: string): Either.Either<JsonRpcMessage, LegacyWireError> => {
  try {
    return decodeJsonRpc(JSON.parse(text))
  } catch (cause) {
    return Either.left(wireError("Invalid JSON text", cause))
  }
}

export const encodeJsonRpcText = (message: unknown): Either.Either<string, LegacyWireError> => {
  try {
    if (!isRecord(message)) return Either.left(wireError("Expected a JSON-RPC object"))
    const { _tag: _, ...wire } = message
    const decoded = decodeJsonRpc(wire)
    return Either.isLeft(decoded) ? Either.left(decoded.left) : Either.right(JSON.stringify(wire))
  } catch (cause) {
    return Either.left(wireError("Could not encode JSON-RPC message", cause))
  }
}
