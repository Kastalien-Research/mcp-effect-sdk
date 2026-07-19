import * as Schema from "effect/Schema"
import {
  AuthorizationScopeSet,
  isSanitizedAuthorizationIdentifier,
  SanitizedAuthorizationIdentifier
} from "../common.js"

const defineFixedMessage = (error: Error, message: string): void => {
  Object.defineProperty(error, "message", {
    configurable: false,
    enumerable: false,
    value: message,
    writable: false
  })
}

const invalidAuthorizationErrorProperties = (): never => {
  throw new TypeError("Authorization error properties are invalid")
}

const decodeKnownErrorProperties = <A>(
  source: object,
  keys: ReadonlyArray<string>,
  decode: (input: unknown) => A,
  prepare: (snapshot: Record<string, unknown>) => unknown = (snapshot) => snapshot
): A => {
  try {
    const snapshot: Record<string, unknown> = {}
    for (const key of keys) {
      const descriptor = Reflect.getOwnPropertyDescriptor(source, key)
      if (descriptor === undefined) continue
      if (!("value" in descriptor)) return invalidAuthorizationErrorProperties()
      snapshot[key] = descriptor.value
    }
    return decode(prepare(snapshot))
  } catch {
    return invalidAuthorizationErrorProperties()
  }
}

const sanitizedIdentifierFrom = (source: object, key: "issuer" | "resource"): string | undefined => {
  try {
    const descriptor = Reflect.getOwnPropertyDescriptor(source, key)
    const value = descriptor !== undefined && "value" in descriptor ? descriptor.value : undefined
    return isSanitizedAuthorizationIdentifier(value) ? value : undefined
  } catch {
    return undefined
  }
}

export type TokenVerificationReason =
  | "Invalid"
  | "Expired"
  | "AudienceMismatch"
  | "VerifierUnavailable"
  | "VerifierFailure"

const TokenVerificationErrorFields = {
  reason: Schema.Union(
    Schema.Literal("Invalid"),
    Schema.Literal("Expired"),
    Schema.Literal("AudienceMismatch"),
    Schema.Literal("VerifierUnavailable"),
    Schema.Literal("VerifierFailure")
  ),
  issuer: Schema.optional(SanitizedAuthorizationIdentifier),
  resource: Schema.optional(SanitizedAuthorizationIdentifier)
}

const decodeTokenVerificationErrorProperties = Schema.decodeUnknownSync(
  Schema.Struct(TokenVerificationErrorFields)
)

export class TokenVerificationError extends Schema.TaggedError<TokenVerificationError>(
  "mcp-effect-sdk/auth/protected-resource/TokenVerificationError"
)("TokenVerificationError", TokenVerificationErrorFields) {
  constructor(props: {
    readonly reason: TokenVerificationReason
    readonly issuer?: string
    readonly resource?: string
  }) {
    const decoded = decodeKnownErrorProperties(
      props,
      ["reason", "issuer", "resource"],
      decodeTokenVerificationErrorProperties,
      (snapshot) => {
        const issuer = sanitizedIdentifierFrom(snapshot, "issuer")
        const resource = sanitizedIdentifierFrom(snapshot, "resource")
        return {
          reason: snapshot.reason,
          ...(issuer === undefined ? {} : { issuer }),
          ...(resource === undefined ? {} : { resource })
        }
      }
    )
    super(decoded)
    defineFixedMessage(this, `Token verification ${decoded.reason}`)
  }
}

const AuthorizationPolicyErrorFields = {
  reason: Schema.Literal("InsufficientScope"),
  required: AuthorizationScopeSet,
  granted: AuthorizationScopeSet
}

const decodeAuthorizationPolicyErrorProperties = Schema.decodeUnknownSync(
  Schema.Struct(AuthorizationPolicyErrorFields)
)

export class AuthorizationPolicyError extends Schema.TaggedError<AuthorizationPolicyError>(
  "mcp-effect-sdk/auth/protected-resource/AuthorizationPolicyError"
)("AuthorizationPolicyError", AuthorizationPolicyErrorFields) {
  constructor(props: {
    readonly reason: "InsufficientScope"
    readonly required: typeof AuthorizationScopeSet.Type
    readonly granted: typeof AuthorizationScopeSet.Type
  }) {
    const decoded = decodeKnownErrorProperties(
      props,
      ["reason", "required", "granted"],
      decodeAuthorizationPolicyErrorProperties
    )
    super(decoded)
    defineFixedMessage(this, "Authorization policy requires additional scope")
  }
}
