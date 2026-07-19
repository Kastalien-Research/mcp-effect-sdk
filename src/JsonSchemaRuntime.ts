import { Ajv2020, type ErrorObject, type ValidateFunction } from "ajv/dist/2020.js"
import * as Cause from "effect/Cause"
import * as Context from "effect/Context"
import * as Duration from "effect/Duration"
import * as Effect from "effect/Effect"
import { SchemaValidationError, type JsonObject, type JsonValue } from "./McpErrors.js"
import {
  cloneExactUint8Array,
  invalidExactUint8Array,
  notArrayBufferView
} from "./internal/ExactUint8Array.js"
import { cloneStrictJson, invalidStrictJson } from "./internal/StrictJson.js"
import { snapshotConstructorOptions } from "./internal/ConstructorOptions.js"

const DIALECT = "https://json-schema.org/draft/2020-12/schema"
const ROOT_URI = "urn:mcp-effect-sdk:json-schema:root"
const textEncoder = new TextEncoder()
const textDecoder = new TextDecoder("utf-8", { fatal: true })

export type JsonSchema = boolean | JsonObject

export interface CompiledJsonSchema {
  readonly validate: (value: unknown) => Effect.Effect<void, SchemaValidationError>
}

export interface JsonSchemaValidatorService {
  readonly compile: (options: {
    readonly schema: JsonSchema
    readonly resolver?: JsonSchemaResolverService
  }) => Effect.Effect<CompiledJsonSchema, SchemaValidationError>
}

export interface JsonSchemaResolverPolicy {
  readonly allowedSchemes: ReadonlyArray<string>
  readonly allowedHosts: ReadonlyArray<string>
  readonly maxDepth: number
  readonly maxBytes: number
  readonly maxRedirects: number
  readonly timeoutMs: number
}

export interface ResolvedJsonSchemaBytes {
  readonly bytes: Uint8Array
  readonly finalUri: string
  readonly redirects: ReadonlyArray<string>
}

export interface JsonSchemaResolverService {
  readonly policy: JsonSchemaResolverPolicy
  readonly resolve: (uri: string) => Effect.Effect<ResolvedJsonSchemaBytes, SchemaValidationError>
}

export interface JsonSchemaResolverOptions<R = never, E = unknown> {
  readonly allowedSchemes: ReadonlyArray<string>
  readonly allowedHosts: ReadonlyArray<string>
  readonly maxDepth?: number
  readonly maxBytes?: number
  readonly maxRedirects?: number
  readonly timeoutMs?: number
  readonly load: (uri: string) => Effect.Effect<ResolvedJsonSchemaBytes, E, R>
}

const DEFAULT_BUDGET = {
  maxDepth: 8,
  maxBytes: 1_048_576,
  maxRedirects: 3,
  timeoutMs: 5_000
} as const

const schemaError = (
  message: string,
  phase: "schema" | "resolution" | "instance",
  cause?: unknown,
  data?: JsonObject
): SchemaValidationError => {
  const error = new SchemaValidationError({
    message,
    data: { phase, ...(data ?? {}) },
    ...(cause === undefined ? {} : { cause })
  })
  if (cause !== undefined) {
    Object.defineProperty(error, "cause", {
      configurable: true,
      enumerable: false,
      value: cause,
      writable: false
    })
  }
  return error
}

const makeResolver = <R, E>(
  options: JsonSchemaResolverOptions<R, E>
): Effect.Effect<JsonSchemaResolverService, SchemaValidationError, R> => Effect.gen(function*() {
  const snapshot = yield* Effect.try({
    try: () => snapshotConstructorOptions(options),
    catch: (cause) => schemaError("Invalid JSON Schema resolver configuration", "resolution", cause)
  })
  const policy = yield* Effect.try({
    try: () => normalizeResolverPolicy(snapshot),
    catch: (cause) => schemaError("Invalid JSON Schema resolver configuration", "resolution", cause)
  })
  const load = snapshot.load
  if (typeof load !== "function") {
    return yield* Effect.fail(schemaError("Invalid JSON Schema resolver configuration", "resolution"))
  }
  const captured = yield* Effect.context<R>()
  const runLoad = (uri: string): Effect.Effect<ResolvedJsonSchemaBytes, SchemaValidationError> =>
    Effect.matchCauseEffect(
      Effect.provide(
        (load as JsonSchemaResolverOptions<R, E>["load"])(uri),
        captured
      ) as Effect.Effect<ResolvedJsonSchemaBytes, E>,
      {
        onFailure: (cause) => Cause.isInterruptedOnly(cause)
          ? Effect.interrupt
          : Effect.fail(schemaError("JSON Schema resolver failed", "resolution", cause)),
        onSuccess: (response) => Effect.try({
          try: () => normalizeResolvedBytes(response),
          catch: (cause) => schemaError("Invalid JSON Schema resolver response", "resolution", cause)
        })
      }
    )

  return Object.freeze({
    policy,
    resolve: runLoad
  })
})

export class JsonSchemaResolver extends Context.Tag("mcp/JsonSchemaResolver")<
  JsonSchemaResolver,
  JsonSchemaResolverService
>() {
  static readonly make = makeResolver
}

const compileSchema = (options: {
  readonly schema: JsonSchema
  readonly resolver?: JsonSchemaResolverService
}): Effect.Effect<CompiledJsonSchema, SchemaValidationError> => Effect.gen(function*() {
  const root = yield* inspectSchema(options.schema, "schema")
  const resolver = options.resolver === undefined
    ? undefined
    : yield* resolutionTry(() => snapshotJsonSchemaResolverService(options.resolver))
  const policy = resolver?.policy ?? {
    allowedSchemes: [],
    allowedHosts: [],
    ...DEFAULT_BUDGET
  }
  const rootBytes = canonicalByteLength(root)
  if (rootBytes > policy.maxBytes) {
    return yield* Effect.fail(schemaError("JSON Schema byte budget exceeded", "resolution"))
  }

  const resolved = yield* resolveDocuments(root, rootBytes, policy, resolver).pipe(
    Effect.timeoutFail({
      // Resolver budgets are inclusive integer milliseconds; one nanosecond
      // places the deadline immediately after the exact boundary.
      duration: Duration.sum(Duration.millis(policy.timeoutMs), Duration.nanos(1n)),
      onTimeout: () => schemaError("JSON Schema resolution timed out", "resolution")
    })
  )

  const validate = yield* Effect.try({
    try: () => compileAjv(root, resolved),
    catch: (cause) => schemaError("Invalid JSON Schema", "schema", cause)
  })
  return {
    validate: (value) => validateValue(validate, value)
  }
})

export class JsonSchemaValidator extends Context.Tag("mcp/JsonSchemaValidator")<
  JsonSchemaValidator,
  JsonSchemaValidatorService
>() {
  static readonly default: JsonSchemaValidatorService = { compile: compileSchema }
}

const normalizeResolverPolicy = (
  value: Readonly<Record<string, unknown>>
): JsonSchemaResolverPolicy => {
  const allowedSchemes = stringArray(value.allowedSchemes, "allowedSchemes")
  const allowedHosts = stringArray(value.allowedHosts, "allowedHosts")
  if (allowedSchemes.length === 0 || allowedHosts.length === 0) {
    throw new TypeError("Resolver allowlists must not be empty")
  }
  for (const scheme of allowedSchemes) {
    if (!/^[a-z][a-z0-9+.-]*$/.test(scheme) || scheme !== scheme.toLowerCase()) {
      throw new TypeError("Resolver schemes must be canonical lower-case names")
    }
  }
  for (const host of allowedHosts) {
    if (host !== host.toLowerCase() || host.length === 0 || /[/?#@]/.test(host)) {
      throw new TypeError("Resolver hosts must be exact lower-case authorities")
    }
  }
  return Object.freeze({
    allowedSchemes: Object.freeze([...new Set(allowedSchemes)]),
    allowedHosts: Object.freeze([...new Set(allowedHosts)]),
    maxDepth: positiveInteger(value.maxDepth ?? DEFAULT_BUDGET.maxDepth, "maxDepth"),
    maxBytes: positiveInteger(value.maxBytes ?? DEFAULT_BUDGET.maxBytes, "maxBytes"),
    maxRedirects: nonNegativeInteger(
      value.maxRedirects ?? DEFAULT_BUDGET.maxRedirects,
      "maxRedirects"
    ),
    timeoutMs: positiveInteger(value.timeoutMs ?? DEFAULT_BUDGET.timeoutMs, "timeoutMs")
  })
}

const dataProperty = (target: unknown, key: PropertyKey): unknown => {
  if ((typeof target !== "object" && typeof target !== "function") || target === null) {
    throw new TypeError("Service must be an object")
  }
  let current: object | null = target
  const seen = new Set<object>()
  while (current !== null && !seen.has(current)) {
    seen.add(current)
    const descriptor = Object.getOwnPropertyDescriptor(current, key)
    if (descriptor !== undefined) {
      if (!("value" in descriptor)) throw new TypeError(`${String(key)} must be a data property`)
      return descriptor.value
    }
    current = Object.getPrototypeOf(current)
  }
  throw new TypeError(`${String(key)} is required`)
}

/** @internal Snapshots a resolver service without retaining live method/policy lookups. */
export const snapshotJsonSchemaResolverService = (value: unknown): JsonSchemaResolverService => {
  const policyValue = dataProperty(value, "policy")
  const resolve = dataProperty(value, "resolve")
  if (typeof resolve !== "function") throw new TypeError("resolve must be a data method")
  const policy = normalizeResolverPolicy(snapshotConstructorOptions(policyValue))
  return Object.freeze({
    policy,
    resolve: (uri: string) => Reflect.apply(resolve, value, [uri]) as Effect.Effect<
      ResolvedJsonSchemaBytes,
      SchemaValidationError
    >
  })
}

const stringArray = (value: unknown, name: string): Array<string> => {
  const snapshot = cloneStrictJson(value)
  if (snapshot === invalidStrictJson || !Array.isArray(snapshot) ||
    snapshot.some((item) => typeof item !== "string")) {
    throw new TypeError(`${name} must be an array of strings`)
  }
  return snapshot as Array<string>
}

const positiveInteger = (value: unknown, name: string): number => {
  if (!Number.isSafeInteger(value) || (value as number) <= 0) {
    throw new TypeError(`${name} must be a positive safe integer`)
  }
  return value as number
}

const nonNegativeInteger = (value: unknown, name: string): number => {
  if (!Number.isSafeInteger(value) || (value as number) < 0) {
    throw new TypeError(`${name} must be a non-negative safe integer`)
  }
  return value as number
}

const normalizeResolvedBytes = (value: unknown): ResolvedJsonSchemaBytes => {
  const snapshot = snapshotConstructorOptions(value)
  const bytes = typeof snapshot.bytes === "object" && snapshot.bytes !== null
    ? cloneExactUint8Array(snapshot.bytes)
    : notArrayBufferView
  if (bytes === invalidExactUint8Array || bytes === notArrayBufferView) {
    throw new TypeError("Resolver bytes must be stable exact Uint8Array")
  }
  if (typeof snapshot.finalUri !== "string") throw new TypeError("Resolver finalUri must be a string")
  const redirects = stringArray(snapshot.redirects, "redirects")
  return Object.freeze({ bytes, finalUri: snapshot.finalUri, redirects: Object.freeze(redirects) })
}

const inspectSchema = (
  value: unknown,
  phase: "schema" | "resolution"
): Effect.Effect<JsonSchema, SchemaValidationError> => Effect.try({
  try: () => {
    const snapshot = cloneStrictJson(value)
    if (snapshot === invalidStrictJson ||
      (typeof snapshot !== "boolean" && (!isObject(snapshot) || Array.isArray(snapshot)))) {
      throw new TypeError("Schema must be a boolean or plain JSON object")
    }
    validateAndNormalizeDialects(snapshot)
    return snapshot as JsonSchema
  },
  catch: (cause) => schemaError("Invalid JSON Schema", phase, cause)
})

const validateAndNormalizeDialects = (schema: JsonSchema): void => {
  if (typeof schema === "boolean") return
  walkSchemaObjects(schema, (value) => {
    if (!Object.hasOwn(value, "$schema")) return
    const dialect = value.$schema
    if (dialect !== DIALECT && dialect !== `${DIALECT}#`) {
      throw new TypeError("Unsupported JSON Schema dialect")
    }
    if (dialect.endsWith("#")) {
      Object.defineProperty(value, "$schema", {
        configurable: true,
        enumerable: true,
        value: DIALECT,
        writable: true
      })
    }
  })
}

interface ResolvedDocument {
  readonly requestUri: string
  readonly aliases: ReadonlyArray<string>
  readonly schema: JsonSchema
}

interface PendingReference {
  readonly uri: string
  readonly depth: number
}

const resolveDocuments = (
  root: JsonSchema,
  rootBytes: number,
  policy: JsonSchemaResolverPolicy,
  resolver: JsonSchemaResolverService | undefined
): Effect.Effect<ReadonlyArray<ResolvedDocument>, SchemaValidationError> => Effect.gen(function*() {
  const rootBase = yield* resolutionTry(() => schemaBase(root, undefined))
  const rootDocument = rootBase === undefined ? ROOT_URI : documentUri(rootBase)
  const initial = yield* resolutionTry(() => referencesIn(root, rootBase, rootDocument))
  const queue: Array<PendingReference> = initial.map((uri) => ({ uri, depth: 1 }))
  const seen = new Set<string>()
  const documents: ResolvedDocument[] = []
  let totalBytes = rootBytes
  let totalRedirects = 0

  while (queue.length > 0) {
    const next = queue.shift() as PendingReference
    if (seen.has(next.uri)) continue
    if (next.depth > policy.maxDepth) {
      return yield* Effect.fail(schemaError("JSON Schema reference depth exceeded", "resolution"))
    }
    if (resolver === undefined) {
      return yield* Effect.fail(schemaError("External JSON Schema resolution is disabled", "resolution"))
    }
    yield* resolutionTry(() => validateAllowedUri(next.uri, policy))
    seen.add(next.uri)
    const response = yield* resolver.resolve(next.uri).pipe(
      Effect.matchCauseEffect({
        onFailure: (cause) => {
          if (Cause.isInterruptedOnly(cause)) return Effect.interrupt
          const failure = Cause.failureOption(cause)
          return failure._tag === "Some" && failure.value instanceof SchemaValidationError
            ? Effect.fail(failure.value)
            : Effect.fail(schemaError("JSON Schema resolver failed", "resolution", cause))
        },
        onSuccess: (value) => resolutionTry(() => normalizeResolvedBytes(value))
      })
    )
    yield* resolutionTry(() => {
      for (const redirect of response.redirects) validateAllowedUri(redirect, policy)
      validateAllowedUri(response.finalUri, policy)
    })
    totalRedirects += response.redirects.length
    if (totalRedirects > policy.maxRedirects) {
      return yield* Effect.fail(schemaError("JSON Schema redirect budget exceeded", "resolution"))
    }
    totalBytes += response.bytes.byteLength
    if (totalBytes > policy.maxBytes) {
      return yield* Effect.fail(schemaError("JSON Schema byte budget exceeded", "resolution"))
    }
    const decoded = yield* decodeResolvedSchema(response.bytes)
    const aliases = [...response.redirects, response.finalUri]
      .map(documentUri)
      .filter((uri, index, all) => uri !== next.uri && all.indexOf(uri) === index)
    documents.push({ requestUri: next.uri, aliases, schema: decoded })
    for (const alias of aliases) seen.add(alias)
    const base = yield* resolutionTry(() => schemaBase(decoded, response.finalUri))
    const currentDocument = base === undefined ? documentUri(response.finalUri) : documentUri(base)
    const references = yield* resolutionTry(() => referencesIn(decoded, base, currentDocument))
    for (const uri of references) {
      if (!seen.has(uri)) queue.push({ uri, depth: next.depth + 1 })
    }
  }
  return documents
})

const resolutionTry = <A>(thunk: () => A): Effect.Effect<A, SchemaValidationError> => Effect.try({
  try: thunk,
  catch: (cause) => cause instanceof SchemaValidationError
    ? cause
    : schemaError("JSON Schema resolution failed", "resolution", cause)
})

const decodeResolvedSchema = (
  bytes: Uint8Array
): Effect.Effect<JsonSchema, SchemaValidationError> => Effect.try({
  try: () => JSON.parse(textDecoder.decode(bytes)),
  catch: (cause) => schemaError("Invalid resolved JSON Schema", "resolution", cause)
}).pipe(Effect.flatMap((value) => inspectSchema(value, "resolution")))

const canonicalByteLength = (schema: JsonSchema): number =>
  textEncoder.encode(JSON.stringify(schema)).byteLength

const validateAllowedUri = (uri: string, policy: JsonSchemaResolverPolicy): void => {
  let parsed: URL
  try {
    parsed = new URL(uri)
  } catch {
    throw schemaError("JSON Schema resolver URI is not absolute", "resolution")
  }
  if (parsed.username !== "" || parsed.password !== "" || parsed.hash !== "" ||
    !policy.allowedSchemes.includes(parsed.protocol.slice(0, -1).toLowerCase()) ||
    !policy.allowedHosts.includes(parsed.host.toLowerCase())) {
    throw schemaError("JSON Schema resolver URI is not allowed", "resolution")
  }
}

const schemaBase = (schema: JsonSchema, fallback: string | undefined): string | undefined => {
  if (typeof schema === "boolean" || typeof schema.$id !== "string") return fallback
  return resolveUri(schema.$id, fallback)
}

const resolveUri = (reference: string, base: string | undefined): string => {
  try {
    return base === undefined ? new URL(reference).href : new URL(reference, base).href
  } catch {
    throw schemaError("JSON Schema reference URI is invalid", "schema")
  }
}

const referencesIn = (
  schema: JsonSchema,
  base: string | undefined,
  currentDocument: string
): Array<string> => {
  const references: string[] = []
  const visit = (
    value: JsonSchema,
    inheritedBase: string | undefined,
    inheritedDocument: string
  ) => {
    if (typeof value === "boolean") return
    const nextBase = schemaBase(value, inheritedBase)
    const nextDocument = nextBase === undefined ? inheritedDocument : documentUri(nextBase)
    for (const keyword of ["$ref", "$dynamicRef"] as const) {
      const reference = value[keyword]
      if (typeof reference !== "string" || reference.startsWith("#")) continue
      const absolute = resolveUri(reference, nextBase)
      const document = documentUri(absolute)
      if (document !== nextDocument && !references.includes(document)) references.push(document)
    }
    forEachSubschema(value, (child) => visit(child, nextBase, nextDocument))
  }
  visit(schema, base, currentDocument)
  return references
}

const documentUri = (uri: string): string => {
  const parsed = new URL(uri)
  parsed.hash = ""
  return parsed.href
}

const singleSchemaKeywords = [
  "additionalProperties",
  "unevaluatedProperties",
  "propertyNames",
  "items",
  "contains",
  "unevaluatedItems",
  "not",
  "if",
  "then",
  "else",
  "contentSchema"
] as const
const schemaMapKeywords = [
  "$defs",
  "definitions",
  "properties",
  "patternProperties",
  "dependentSchemas"
] as const
const schemaArrayKeywords = ["prefixItems", "allOf", "anyOf", "oneOf"] as const

const forEachSubschema = (schema: JsonObject, f: (schema: JsonSchema) => void): void => {
  for (const keyword of singleSchemaKeywords) {
    const value = schema[keyword]
    if (isSchema(value)) f(value)
  }
  for (const keyword of schemaMapKeywords) {
    const value = schema[keyword]
    if (!isObject(value) || Array.isArray(value)) continue
    for (const child of Object.values(value)) if (isSchema(child)) f(child)
  }
  for (const keyword of schemaArrayKeywords) {
    const value = schema[keyword]
    if (Array.isArray(value)) for (const child of value) if (isSchema(child)) f(child)
  }
}

const walkSchemaObjects = (schema: JsonSchema, f: (schema: JsonObject) => void): void => {
  if (typeof schema === "boolean") return
  f(schema)
  forEachSubschema(schema, (child) => walkSchemaObjects(child, f))
}

const isSchema = (value: JsonValue | undefined): value is JsonSchema =>
  typeof value === "boolean" || (isObject(value) && !Array.isArray(value))

const isObject = (value: unknown): value is JsonObject =>
  typeof value === "object" && value !== null && !Array.isArray(value)

const compileAjv = (
  root: JsonSchema,
  documents: ReadonlyArray<ResolvedDocument>
): ValidateFunction => {
  const ajv = new Ajv2020({
    allErrors: true,
    strict: false,
    validateFormats: false,
    ownProperties: true,
    coerceTypes: false,
    removeAdditional: false,
    useDefaults: false,
    messages: false
  })
  for (const document of documents) {
    ajv.addSchema(document.schema, document.requestUri)
    for (const alias of document.aliases) {
      if (ajv.getSchema(alias) === undefined) ajv.addSchema({ $ref: document.requestUri }, alias)
    }
  }
  return ajv.compile(root)
}

const validateValue = (
  validate: ValidateFunction,
  value: unknown
): Effect.Effect<void, SchemaValidationError> => Effect.gen(function*() {
  const snapshot = yield* Effect.try({
    try: () => cloneStrictJson(value),
    catch: (cause) => schemaError("JSON Schema instance is not JSON", "instance", cause)
  })
  if (snapshot === invalidStrictJson) {
    return yield* Effect.fail(schemaError("JSON Schema instance is not JSON", "instance"))
  }
  const valid = yield* Effect.try({
    try: () => validate(snapshot),
    catch: (cause) => schemaError("JSON Schema validation failed", "instance", cause)
  })
  if (valid) return
  return yield* Effect.fail(schemaError(
    "JSON Schema validation failed",
    "instance",
    undefined,
    { issues: normalizeIssues(validate.errors) }
  ))
})

const normalizeIssues = (errors: ReadonlyArray<ErrorObject> | null | undefined): ReadonlyArray<JsonObject> =>
  (errors ?? []).map((error) => ({
    instancePath: error.instancePath,
    schemaPath: error.schemaPath,
    keyword: error.keyword
  })).sort((left, right) => issueKey(left).localeCompare(issueKey(right)))

const issueKey = (issue: JsonObject): string =>
  `${issue.instancePath ?? ""}\u0000${issue.schemaPath ?? ""}\u0000${issue.keyword ?? ""}`
