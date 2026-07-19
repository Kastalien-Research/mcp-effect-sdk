import * as Redacted from "effect/Redacted"
import * as Schema from "effect/Schema"
import type * as Effect from "effect/Effect"
import {
  AuthorizationScopeSet,
  SafeAuthorizationUri
} from "../common.js"
import type { TokenVerificationError } from "./errors.js"

export type AuthorizationPrincipalJson =
  | null
  | boolean
  | number
  | string
  | ReadonlyArray<AuthorizationPrincipalJson>
  | { readonly [key: string]: AuthorizationPrincipalJson }

const isStrictJson = (
  value: unknown,
  seen: Set<object> = new Set()
): value is AuthorizationPrincipalJson => {
  if (value === null || typeof value === "string" || typeof value === "boolean") return true
  if (typeof value === "number") return Number.isFinite(value)
  if (typeof value !== "object" || seen.has(value)) return false
  const prototype = Object.getPrototypeOf(value)
  if (Array.isArray(value)) {
    if (prototype !== Array.prototype) return false
  } else if (prototype !== Object.prototype && prototype !== null) {
    return false
  }
  const keys = Reflect.ownKeys(value)
  if (keys.some((key) => typeof key !== "string")) return false
  const descriptors = Object.getOwnPropertyDescriptors(value)
  if (Array.isArray(value)) {
    const elementKeys = keys.filter((key) => key !== "length")
    if (elementKeys.length !== value.length) return false
  }
  seen.add(value)
  try {
    for (const key of keys) {
      if (typeof key !== "string") return false
      if (key === "length" && Array.isArray(value)) continue
      const descriptor = descriptors[key]
      if (descriptor === undefined || !("value" in descriptor) || !descriptor.enumerable ||
        !isStrictJson(descriptor.value, seen)) return false
    }
    return true
  } finally {
    seen.delete(value)
  }
}

const freezeJson = (value: AuthorizationPrincipalJson): AuthorizationPrincipalJson => {
  if (value === null || typeof value !== "object") return value
  if (Array.isArray(value)) return Object.freeze(value.map(freezeJson))
  const output: Record<string, AuthorizationPrincipalJson> = Object.create(null)
  for (const [key, item] of Object.entries(value)) output[key] = freezeJson(item)
  return Object.freeze(output)
}

const StrictJsonSelf = Schema.declare<AuthorizationPrincipalJson>(isStrictJson)

export const AuthorizationPrincipalClaims = Schema.transform(
  StrictJsonSelf,
  StrictJsonSelf,
  {
    strict: true,
    decode: freezeJson,
    encode: freezeJson
  }
)

const FrozenStringArray = Schema.transform(
  Schema.Array(Schema.String),
  Schema.Array(Schema.String),
  {
    strict: true,
    decode: (values) => Object.freeze([...values]),
    encode: (values) => [...values]
  }
)

export class AuthorizationPrincipal extends Schema.Class<AuthorizationPrincipal>(
  "mcp-effect-sdk/auth/protected-resource/AuthorizationPrincipal"
)({
  subject: Schema.NonEmptyString,
  clientId: Schema.optional(Schema.String),
  issuer: Schema.optional(SafeAuthorizationUri),
  audiences: FrozenStringArray,
  scopes: AuthorizationScopeSet,
  claims: Schema.optional(AuthorizationPrincipalClaims)
}) {}

export interface TokenVerificationRequest {
  readonly bearerToken: Redacted.Redacted<string>
  readonly protectedResource: string
}

export interface TokenVerifierService {
  readonly verify: (
    request: TokenVerificationRequest
  ) => Effect.Effect<AuthorizationPrincipal, TokenVerificationError>
}
