import * as Redacted from "effect/Redacted"
import * as Schema from "effect/Schema"
import * as Effect from "effect/Effect"
import * as ParseResult from "effect/ParseResult"
import {
  AuthorizationScopeSet,
  safeAuthorizationArray,
  SafeAuthorizationUri,
  snapshotDenseAuthorizationArray
} from "../common.js"
import type { TokenVerificationError } from "./errors.js"

export type AuthorizationPrincipalJson =
  | null
  | boolean
  | number
  | string
  | ReadonlyArray<AuthorizationPrincipalJson>
  | { readonly [key: string]: AuthorizationPrincipalJson }

type JsonSnapshot =
  | { readonly _tag: "Success"; readonly value: AuthorizationPrincipalJson }
  | { readonly _tag: "Failure" }

const invalidJsonSnapshot: JsonSnapshot = { _tag: "Failure" }

const snapshotStrictJson = (
  input: unknown,
  seen: Set<object> = new Set()
): JsonSnapshot => {
  try {
    if (input === null || typeof input === "string" || typeof input === "boolean") {
      return { _tag: "Success", value: input }
    }
    if (typeof input === "number") {
      return Number.isFinite(input) ? { _tag: "Success", value: input } : invalidJsonSnapshot
    }
    if (typeof input !== "object" || seen.has(input)) return invalidJsonSnapshot

    const array = Array.isArray(input)
    const prototype = Object.getPrototypeOf(input)
    if (array ? prototype !== Array.prototype : prototype !== Object.prototype && prototype !== null) {
      return invalidJsonSnapshot
    }

    if (array) {
      const snapshot = snapshotDenseAuthorizationArray(input)
      if (snapshot._tag === "Failure") return invalidJsonSnapshot
      seen.add(input)
      try {
        const output: Array<AuthorizationPrincipalJson> = new Array(snapshot.values.length)
        for (let index = 0; index < snapshot.values.length; index += 1) {
          const item = snapshotStrictJson(snapshot.values[index], seen)
          if (item._tag === "Failure") return item
          output[index] = item.value
        }
        return { _tag: "Success", value: Object.freeze(output) }
      } finally {
        seen.delete(input)
      }
    }

    const keys: Array<string> = []
    for (const key of Reflect.ownKeys(input)) {
      if (typeof key !== "string") return invalidJsonSnapshot
      keys.push(key)
    }
    const descriptors = new Map<string, PropertyDescriptor>()
    for (const key of keys) {
      const descriptor = Reflect.getOwnPropertyDescriptor(input, key)
      if (descriptor === undefined) return invalidJsonSnapshot
      descriptors.set(key, descriptor)
    }

    seen.add(input)
    try {
      const output: Record<string, AuthorizationPrincipalJson> = Object.create(null)
      for (const key of keys) {
        const descriptor = descriptors.get(key)
        if (descriptor === undefined || !("value" in descriptor) || !descriptor.enumerable) {
          return invalidJsonSnapshot
        }
        const item = snapshotStrictJson(descriptor.value, seen)
        if (item._tag === "Failure") return item
        Object.defineProperty(output, key, {
          configurable: true,
          enumerable: true,
          value: item.value,
          writable: true
        })
      }
      return { _tag: "Success", value: Object.freeze(output) }
    } finally {
      seen.delete(input)
    }
  } catch {
    return invalidJsonSnapshot
  }
}

const isStrictJson = (value: unknown): value is AuthorizationPrincipalJson =>
  snapshotStrictJson(value)._tag === "Success"

const StrictJsonSelf = Schema.declare<AuthorizationPrincipalJson>(isStrictJson)

const snapshotJsonOrFail = (value: unknown, ast: ConstructorParameters<typeof ParseResult.Type>[0]) => {
  const snapshot = snapshotStrictJson(value)
  return snapshot._tag === "Success"
    ? Effect.succeed(snapshot.value)
    : Effect.fail(new ParseResult.Type(ast, undefined, "claims must contain only strict JSON data"))
}

export const AuthorizationPrincipalClaims = Schema.transformOrFail(
  Schema.Unknown,
  StrictJsonSelf,
  {
    strict: true,
    decode: (value, _options, ast) => snapshotJsonOrFail(value, ast),
    encode: (value, _options, ast) => snapshotJsonOrFail(value, ast)
  }
)

const snapshotTrustedJson = (value: AuthorizationPrincipalJson): AuthorizationPrincipalJson => {
  const snapshot = snapshotStrictJson(value)
  if (snapshot._tag === "Failure") throw new TypeError("claims must contain only strict JSON data")
  return snapshot.value
}

const FrozenStringArray = safeAuthorizationArray(Schema.String)

export class AuthorizationPrincipal extends Schema.Class<AuthorizationPrincipal>(
  "mcp-effect-sdk/auth/protected-resource/AuthorizationPrincipal"
)({
  subject: Schema.String,
  clientId: Schema.optional(Schema.String),
  issuer: Schema.optional(SafeAuthorizationUri),
  audiences: FrozenStringArray,
  scopes: AuthorizationScopeSet,
  claims: Schema.optional(AuthorizationPrincipalClaims)
}) {
  constructor(props: {
    readonly subject: string
    readonly clientId?: string
    readonly issuer?: string
    readonly audiences: ReadonlyArray<string>
    readonly scopes: typeof AuthorizationScopeSet.Type
    readonly claims?: AuthorizationPrincipalJson
  }, options?: Schema.MakeOptions) {
    super({
      subject: props.subject,
      ...(props.clientId === undefined ? {} : { clientId: props.clientId }),
      ...(props.issuer === undefined ? {} : { issuer: props.issuer }),
      audiences: Object.freeze([...props.audiences]),
      scopes: Object.freeze([...props.scopes]),
      ...(props.claims === undefined ? {} : { claims: snapshotTrustedJson(props.claims) })
    }, options)
  }
}

export interface TokenVerificationRequest {
  readonly bearerToken: Redacted.Redacted<string>
  readonly protectedResource: string
}

export interface TokenVerifierService {
  readonly verify: (
    request: TokenVerificationRequest
  ) => Effect.Effect<AuthorizationPrincipal, TokenVerificationError>
}
