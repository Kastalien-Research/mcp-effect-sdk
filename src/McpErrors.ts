/** Effect-native MCP and JSON-RPC errors plus their wire/status mapping. */
import * as Schema from "effect/Schema"
import * as Generated from "./generated/mcp/2026-07-28/McpSchema.generated.js"

export const PARSE_ERROR_CODE = -32700 as const
export const INVALID_REQUEST_ERROR_CODE = -32600 as const
export const METHOD_NOT_FOUND_ERROR_CODE = -32601 as const
export const INVALID_PARAMS_ERROR_CODE = -32602 as const
export const INTERNAL_ERROR_CODE = -32603 as const
export const HEADER_MISMATCH_ERROR_CODE = -32020 as const
export const MISSING_REQUIRED_CLIENT_CAPABILITY_ERROR_CODE = -32021 as const
export const UNSUPPORTED_PROTOCOL_VERSION_ERROR_CODE = -32022 as const

const errorFields = <Code extends number>(code: Code) => ({
  code: Schema.optionalWith(Schema.Literal(code), { default: () => code }),
  message: Schema.String,
  data: Schema.optional(Schema.Unknown),
  cause: Schema.optional(Schema.Unknown)
})

export class McpErrorBase extends Schema.Class<McpErrorBase>("mcp/McpErrorBase")({
  code: Schema.Int,
  message: Schema.String,
  data: Schema.optional(Schema.Unknown),
  cause: Schema.optional(Schema.Unknown)
}) {}

export class ParseError extends Schema.TaggedError<ParseError>("mcp/ParseError")(
  "ParseError",
  errorFields(PARSE_ERROR_CODE)
) {}

export class InvalidRequest extends Schema.TaggedError<InvalidRequest>("mcp/InvalidRequest")(
  "InvalidRequest",
  errorFields(INVALID_REQUEST_ERROR_CODE)
) {}

export class MethodNotFound extends Schema.TaggedError<MethodNotFound>("mcp/MethodNotFound")(
  "MethodNotFound",
  errorFields(METHOD_NOT_FOUND_ERROR_CODE)
) {}

export class InvalidParams extends Schema.TaggedError<InvalidParams>("mcp/InvalidParams")(
  "InvalidParams",
  errorFields(INVALID_PARAMS_ERROR_CODE)
) {}

export class InternalError extends Schema.TaggedError<InternalError>("mcp/InternalError")(
  "InternalError",
  errorFields(INTERNAL_ERROR_CODE)
) {
  static readonly notImplemented = new InternalError({ message: "Not implemented" })
}

export class HeaderMismatchError extends Schema.TaggedError<HeaderMismatchError>("mcp/HeaderMismatchError")(
  "HeaderMismatchError",
  errorFields(HEADER_MISMATCH_ERROR_CODE)
) {}

const MissingCapabilityData = Schema.Struct({
  requiredCapabilities: Schema.encodedSchema(Generated.ClientCapabilities)
})

export class MissingRequiredClientCapabilityError extends Schema.TaggedError<MissingRequiredClientCapabilityError>(
  "mcp/MissingRequiredClientCapabilityError"
)("MissingRequiredClientCapabilityError", {
  ...errorFields(MISSING_REQUIRED_CLIENT_CAPABILITY_ERROR_CODE),
  data: MissingCapabilityData
}) {}

const UnsupportedVersionData = Schema.Struct({
  requested: Schema.String,
  supported: Schema.Array(Schema.String)
})

export class UnsupportedProtocolVersionError extends Schema.TaggedError<UnsupportedProtocolVersionError>(
  "mcp/UnsupportedProtocolVersionError"
)("UnsupportedProtocolVersionError", {
  ...errorFields(UNSUPPORTED_PROTOCOL_VERSION_ERROR_CODE),
  data: UnsupportedVersionData
}) {}

export class SchemaValidationError extends Schema.TaggedError<SchemaValidationError>(
  "mcp/SchemaValidationError"
)("SchemaValidationError", errorFields(INVALID_PARAMS_ERROR_CODE)) {}

export class TransportError extends Schema.TaggedError<TransportError>("mcp/TransportError")(
  "TransportError",
  {
    ...errorFields(INTERNAL_ERROR_CODE),
    status: Schema.optional(Schema.Int)
  }
) {}

export class HttpError extends Schema.TaggedError<HttpError>("mcp/HttpError")(
  "HttpError",
  {
    ...errorFields(INTERNAL_ERROR_CODE),
    status: Schema.Int
  }
) {}

export const McpError = Schema.Union(
  ParseError,
  InvalidRequest,
  MethodNotFound,
  InvalidParams,
  InternalError,
  HeaderMismatchError,
  MissingRequiredClientCapabilityError,
  UnsupportedProtocolVersionError,
  SchemaValidationError,
  TransportError,
  HttpError,
  McpErrorBase
)
export type McpError = typeof McpError.Type
export type McpWireError =
  | ParseError
  | InvalidRequest
  | MethodNotFound
  | InvalidParams
  | InternalError
  | HeaderMismatchError
  | MissingRequiredClientCapabilityError
  | UnsupportedProtocolVersionError
  | SchemaValidationError
  | TransportError
  | HttpError

export type JsonValue = string | number | boolean | null | JsonObject | ReadonlyArray<JsonValue>
export interface JsonObject {
  readonly [key: string]: JsonValue
}

export interface JsonRpcErrorObject {
  readonly code: number
  readonly message: string
  readonly data?: JsonValue
}

export const defaultHttpStatus = (error: McpError): number => {
  if (error instanceof HttpError) return error.status
  if (error instanceof TransportError && error.status !== undefined) return error.status
  if (error.code === METHOD_NOT_FOUND_ERROR_CODE) return 404
  if (error.code === INTERNAL_ERROR_CODE) return 500
  return 400
}

export const toJsonRpcErrorObject = (error: McpError): JsonRpcErrorObject => {
  try {
    const code = readDataProperty(error, "code")
    const message = readDataProperty(error, "message")
    if (!code.found || !Number.isInteger(code.value) || !message.found || typeof message.value !== "string") {
      return { code: INTERNAL_ERROR_CODE, message: "Internal error" }
    }
    const rawData = readDataProperty(error, "data")
    const rawCause = readDataProperty(error, "cause")
    const data = rawData.found ? toJsonValue(rawData.value) : undefined
    const cause = rawCause.found ? toJsonCause(rawCause.value) : undefined
    const wireData = data !== undefined && cause !== undefined
      ? { data, cause }
      : data !== undefined
        ? data
        : cause !== undefined
          ? { cause }
          : undefined
    return {
      code: code.value as number,
      message: message.value,
      ...(wireData === undefined ? {} : { data: wireData })
    }
  } catch {
    return { code: INTERNAL_ERROR_CODE, message: "Internal error" }
  }
}

type DataProperty =
  | { readonly found: true; readonly value: unknown }
  | { readonly found: false }

const readDataProperty = (target: object, key: PropertyKey): DataProperty => {
  let current: object | null = target
  const seen = new Set<object>()
  while (current !== null && !seen.has(current)) {
    seen.add(current)
    const descriptor = Object.getOwnPropertyDescriptor(current, key)
    if (descriptor !== undefined) {
      return "value" in descriptor
        ? { found: true, value: descriptor.value }
        : { found: false }
    }
    current = Object.getPrototypeOf(current)
  }
  return { found: false }
}

const toJsonCause = (value: unknown): JsonValue | undefined => toJsonValue(value)

export const toJsonValue = (value: unknown): JsonValue | undefined => {
  try {
    return sanitizeJsonValue(value, new Set())
  } catch {
    return undefined
  }
}

const sanitizeJsonValue = (value: unknown, seen: Set<object>): JsonValue | undefined => {
  if (value === null || typeof value === "string" || typeof value === "boolean") return value
  if (typeof value === "number") return Number.isFinite(value) ? value : undefined
  if (typeof value !== "object") return undefined
  if (value instanceof Error) return sanitizeError(value)
  if (seen.has(value)) return undefined
  if (Array.isArray(value)) {
    if (Object.getPrototypeOf(value) !== Array.prototype) return undefined
    const descriptors = Object.getOwnPropertyDescriptors(value)
    seen.add(value)
    try {
      const output: JsonValue[] = []
      for (let index = 0; index < value.length; index++) {
        const descriptor = descriptors[String(index)]
        output.push(
          descriptor !== undefined && "value" in descriptor
            ? sanitizeJsonValue(descriptor.value, seen) ?? null
            : null
        )
      }
      return output
    } finally {
      seen.delete(value)
    }
  }
  const prototype = Object.getPrototypeOf(value)
  if (prototype !== Object.prototype && prototype !== null) return undefined
  const keys = Reflect.ownKeys(value)
  const descriptors = Object.getOwnPropertyDescriptors(value)
  seen.add(value)
  const output: Record<string, JsonValue> = {}
  try {
    for (const key of keys) {
      if (typeof key !== "string") continue
      const descriptor = descriptors[key]
      if (descriptor === undefined || !descriptor.enumerable || !("value" in descriptor)) continue
      const sanitized = sanitizeJsonValue(descriptor.value, seen)
      if (sanitized !== undefined) defineJsonProperty(output, key, sanitized)
    }
    return output
  } finally {
    seen.delete(value)
  }
}

const sanitizeError = (error: Error): JsonObject | undefined => {
  try {
    const name = Object.getOwnPropertyDescriptor(error, "name")
    const message = Object.getOwnPropertyDescriptor(error, "message")
    const safeName = name !== undefined && "value" in name && typeof name.value === "string"
      ? name.value
      : intrinsicErrorName(Object.getPrototypeOf(error))
    const safeMessage = message !== undefined && "value" in message && typeof message.value === "string"
      ? message.value
      : undefined
    return safeMessage === undefined ? { name: safeName } : { name: safeName, message: safeMessage }
  } catch {
    return undefined
  }
}

const intrinsicErrorName = (prototype: object | null): string => {
  if (prototype === EvalError.prototype) return "EvalError"
  if (prototype === RangeError.prototype) return "RangeError"
  if (prototype === ReferenceError.prototype) return "ReferenceError"
  if (prototype === SyntaxError.prototype) return "SyntaxError"
  if (prototype === TypeError.prototype) return "TypeError"
  if (prototype === URIError.prototype) return "URIError"
  if (prototype === AggregateError.prototype) return "AggregateError"
  return "Error"
}

const defineJsonProperty = (target: Record<string, JsonValue>, key: string, value: JsonValue): void => {
  Object.defineProperty(target, key, { value, enumerable: true, configurable: true, writable: true })
}
