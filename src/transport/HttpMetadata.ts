/** Pure metadata and header-value rules for MCP 2026-07-28 Streamable HTTP. */
import * as Data from "effect/Data"
import * as Effect from "effect/Effect"
import * as Either from "effect/Either"
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

export type HttpToolHeaderValueType = "string" | "boolean" | "integer"

export interface HttpToolHeaderBinding {
  readonly path: ReadonlyArray<string>
  readonly name: string
  readonly headerName: string
  readonly valueType: HttpToolHeaderValueType
}

export interface HttpToolHeaderPlan {
  readonly toolName: string
  readonly bindings: ReadonlyArray<HttpToolHeaderBinding>
}

export interface HttpToolDefinition {
  readonly name: string
  readonly inputSchema: unknown
}

export type InvalidToolHeaderReason =
  | "annotation-outside-properties"
  | "invalid-header-name"
  | "duplicate-header-name"
  | "unsupported-property-type"
  | "invalid-schema"

export class InvalidToolHeaderDefinition extends Data.TaggedError(
  "InvalidToolHeaderDefinition"
)<{
  readonly toolName: string
  readonly reason: InvalidToolHeaderReason
}> {}

export interface HttpToolWarning {
  readonly _tag: "InvalidHttpToolHeader"
  readonly toolName: string
  readonly reason: InvalidToolHeaderReason
}

export type HttpToolWarningSink<Error = never, Requirements = never> = (
  warning: HttpToolWarning
) => Effect.Effect<void, Error, Requirements>

export interface HttpToolCatalog<Tool extends HttpToolDefinition> {
  readonly tools: ReadonlyArray<Tool>
  readonly plans: Readonly<Record<string, HttpToolHeaderPlan>>
}

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

const dataProperty = (
  value: Readonly<Record<string, unknown>>,
  key: string
): { readonly present: boolean; readonly value?: unknown } => {
  const descriptor = Object.getOwnPropertyDescriptor(value, key)
  return descriptor === undefined
    ? { present: false }
    : "value" in descriptor
      ? { present: true, value: descriptor.value }
      : { present: true }
}

const tchar = /^[!#$%&'*+\-.^_`|~0-9A-Za-z]+$/
const impurePathKeywords = new Set([
  "$ref",
  "items",
  "prefixItems",
  "contains",
  "oneOf",
  "anyOf",
  "allOf",
  "not",
  "if",
  "then",
  "else"
])

export const analyzeToolHeaders = (
  tool: HttpToolDefinition
): Effect.Effect<HttpToolHeaderPlan, InvalidToolHeaderDefinition> => {
  const bindings: Array<HttpToolHeaderBinding> = []
  const names = new Set<string>()
  const visited = new WeakSet<object>()
  let reason: InvalidToolHeaderReason | undefined

  const reject = (next: InvalidToolHeaderReason): void => {
    if (reason === undefined) reason = next
  }

  const visit = (value: unknown, path: ReadonlyArray<string> | undefined): void => {
    if (reason !== undefined || !isRecord(value)) return
    if (visited.has(value)) {
      reject("invalid-schema")
      return
    }
    visited.add(value)

    const descriptors = Object.getOwnPropertyDescriptors(value)
    if (Reflect.ownKeys(descriptors).some((key) => {
      const descriptor = Object.getOwnPropertyDescriptor(value, key)
      return descriptor !== undefined && !("value" in descriptor)
    })) {
      reject("invalid-schema")
      return
    }
    const annotation = dataProperty(value, "x-mcp-header")
    if (annotation.present) {
      if (path === undefined || path.length === 0) {
        reject("annotation-outside-properties")
        return
      }
      if (typeof annotation.value !== "string" || !tchar.test(annotation.value)) {
        reject("invalid-header-name")
        return
      }
      const type = dataProperty(value, "type").value
      if (type !== "string" && type !== "boolean" && type !== "integer") {
        reject("unsupported-property-type")
        return
      }
      if (Reflect.ownKeys(descriptors).some((key) =>
        typeof key === "string" && impurePathKeywords.has(key))) {
        reject("annotation-outside-properties")
        return
      }
      const folded = annotation.value.toLowerCase()
      if (names.has(folded)) {
        reject("duplicate-header-name")
        return
      }
      names.add(folded)
      bindings.push(Object.freeze({
        path: Object.freeze([...path]),
        name: annotation.value,
        headerName: `Mcp-Param-${annotation.value}`,
        valueType: type
      }))
    }

    const type = dataProperty(value, "type").value
    const pureObject = type === "object" && !Reflect.ownKeys(descriptors).some((key) =>
      typeof key === "string" && impurePathKeywords.has(key))
    const properties = dataProperty(value, "properties")
    if (isRecord(properties.value)) {
      const propertyDescriptors = Object.getOwnPropertyDescriptors(properties.value)
      for (const key of Reflect.ownKeys(propertyDescriptors)) {
        if (typeof key !== "string") continue
        const descriptor = propertyDescriptors[key]
        if (descriptor === undefined || !("value" in descriptor)) {
          reject("invalid-schema")
          return
        }
        visit(descriptor.value, pureObject && path !== undefined ? [...path, key] : undefined)
      }
    }

    for (const key of Reflect.ownKeys(descriptors)) {
      if (reason !== undefined) return
      if (key === "properties" || key === "x-mcp-header") continue
      const descriptor = Object.getOwnPropertyDescriptor(value, key)
      if (descriptor === undefined || !("value" in descriptor)) continue
      if (isRecord(descriptor.value)) {
        visit(descriptor.value, undefined)
      } else if (Array.isArray(descriptor.value)) {
        for (const member of descriptor.value) visit(member, undefined)
      }
    }
  }

  visit(tool.inputSchema, [])
  return reason === undefined
    ? Effect.succeed(Object.freeze({
      toolName: tool.name,
      bindings: Object.freeze(bindings)
    }))
    : Effect.fail(new InvalidToolHeaderDefinition({ toolName: tool.name, reason }))
}

export const filterHttpTools = <
  Tool extends HttpToolDefinition,
  Error = never,
  Requirements = never
>(
  tools: ReadonlyArray<Tool>,
  warningSink: HttpToolWarningSink<Error, Requirements>
): Effect.Effect<HttpToolCatalog<Tool>, Error, Requirements> => Effect.gen(function*() {
  const visible: Array<Tool> = []
  const plans = Object.create(null) as Record<string, HttpToolHeaderPlan>

  for (const tool of tools) {
    const analysis = yield* analyzeToolHeaders(tool).pipe(Effect.either)
    if (Either.isLeft(analysis)) {
      yield* warningSink(Object.freeze({
        _tag: "InvalidHttpToolHeader" as const,
        toolName: analysis.left.toolName,
        reason: analysis.left.reason
      }))
      continue
    }
    visible.push(tool)
    plans[tool.name] = analysis.right
  }

  return Object.freeze({
    tools: Object.freeze(visible),
    plans: Object.freeze(plans)
  })
})

interface PathValue {
  readonly present: boolean
  readonly value?: unknown
}

const valueAtPath = (root: unknown, path: ReadonlyArray<string>): PathValue => {
  let current = root
  for (const key of path) {
    if (!isRecord(current)) return { present: false }
    const property = dataProperty(current, key)
    if (!property.present) return { present: false }
    current = property.value
  }
  return { present: true, value: current }
}

const encodedToolValue = (
  binding: HttpToolHeaderBinding,
  value: unknown
): string | undefined => {
  if (value === null || value === undefined) return undefined
  if (binding.valueType === "string") {
    return typeof value === "string" ? encodeHeaderValue(value) : undefined
  }
  if (binding.valueType === "boolean") {
    return typeof value === "boolean" ? String(value) : undefined
  }
  return typeof value === "number" && Number.isSafeInteger(value)
    ? String(value)
    : undefined
}

export const extractToolHeaders = (
  plan: HttpToolHeaderPlan,
  argumentsValue: unknown
): Effect.Effect<Readonly<Record<string, string>>, HeaderMismatchError> => {
  const headers: Record<string, string> = {}
  for (const binding of plan.bindings) {
    const body = valueAtPath(argumentsValue, binding.path)
    if (!body.present || body.value === null || body.value === undefined) continue
    const encoded = encodedToolValue(binding, body.value)
    if (encoded === undefined) {
      return Effect.fail(mismatch("Tool argument cannot be represented by its HTTP metadata header"))
    }
    headers[binding.headerName] = encoded
  }
  return Effect.succeed(headers)
}

const integerHeaderPattern = /^(-?)(0|[1-9]\d*)(?:\.(\d+))?(?:[eE]([+-]?)(\d+))?$/

const boundedExponent = (
  sign: string | undefined,
  digits: string | undefined,
  limit: number
): number => {
  if (digits === undefined) return 0
  const significant = digits.replace(/^0+/, "") || "0"
  const boundary = String(limit)
  const magnitude = significant.length > boundary.length ||
      (significant.length === boundary.length && significant > boundary)
    ? limit
    : Number(significant)
  return sign === "-" ? -magnitude : magnitude
}

const exactIntegerHeaderMatches = (body: number, decoded: string): boolean => {
  const match = integerHeaderPattern.exec(decoded)
  if (match === null) return false
  const [, sign, integer = "", fraction = "", exponentSign, exponentDigits] = match
  const coefficient = `${integer}${fraction}`
  const significant = coefficient.replace(/^0+/, "")
  if (significant.length === 0) return body === 0

  if ((sign === "-") !== (body < 0)) return false
  const target = String(Math.abs(body))
  const limit = coefficient.length + target.length + 1
  const exponent = boundedExponent(exponentSign, exponentDigits, limit)
  const scale = exponent - fraction.length

  if (scale >= 0) {
    if (significant.length + scale !== target.length || !target.startsWith(significant)) {
      return false
    }
    for (let index = significant.length; index < target.length; index++) {
      if (target[index] !== "0") return false
    }
    return true
  }

  const fractionalDigits = -scale
  if (fractionalDigits >= significant.length) return false
  for (let index = significant.length - fractionalDigits; index < significant.length; index++) {
    if (significant[index] !== "0") return false
  }
  return significant.slice(0, -fractionalDigits) === target
}

const headerMatchesBody = (
  binding: HttpToolHeaderBinding,
  body: unknown,
  decoded: string
): boolean => {
  if (binding.valueType === "string") return typeof body === "string" && decoded === body
  if (binding.valueType === "boolean") return typeof body === "boolean" && decoded === String(body)
  return typeof body === "number" && Number.isSafeInteger(body) &&
    exactIntegerHeaderMatches(body, decoded)
}

export const validateToolHeaders = (
  plan: HttpToolHeaderPlan,
  argumentsValue: unknown,
  headers: HttpHeaderSource
): Effect.Effect<void, HeaderMismatchError> => Effect.gen(function*() {
  for (const binding of plan.bindings) {
    const body = valueAtPath(argumentsValue, binding.path)
    const actual = headerValue(headers, binding.headerName)
    if (!body.present || body.value === null || body.value === undefined) {
      if (actual !== undefined) {
        return yield* Effect.fail(mismatch("Unexpected HTTP metadata header for an omitted tool argument"))
      }
      continue
    }
    if (actual === undefined) {
      return yield* Effect.fail(mismatch("Missing required HTTP metadata header for a tool argument"))
    }
    const decoded = yield* decodeHeaderValue(actual)
    if (!headerMatchesBody(binding, body.value, decoded)) {
      return yield* Effect.fail(mismatch("HTTP metadata header does not match the tool argument"))
    }
  }
})

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
