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

export class TokenVerificationError extends Schema.TaggedError<TokenVerificationError>(
  "mcp-effect-sdk/auth/protected-resource/TokenVerificationError"
)("TokenVerificationError", {
  reason: Schema.Union(
    Schema.Literal("Invalid"),
    Schema.Literal("Expired"),
    Schema.Literal("AudienceMismatch"),
    Schema.Literal("VerifierUnavailable"),
    Schema.Literal("VerifierFailure")
  ),
  issuer: Schema.optional(SanitizedAuthorizationIdentifier),
  resource: Schema.optional(SanitizedAuthorizationIdentifier)
}) {
  constructor(props: {
    readonly reason: TokenVerificationReason
    readonly issuer?: string
    readonly resource?: string
  }) {
    const issuer = sanitizedIdentifierFrom(props, "issuer")
    const resource = sanitizedIdentifierFrom(props, "resource")
    super({
      reason: props.reason,
      ...(issuer === undefined ? {} : { issuer }),
      ...(resource === undefined ? {} : { resource })
    })
    defineFixedMessage(this, `Token verification ${props.reason}`)
  }
}

export class AuthorizationPolicyError extends Schema.TaggedError<AuthorizationPolicyError>(
  "mcp-effect-sdk/auth/protected-resource/AuthorizationPolicyError"
)("AuthorizationPolicyError", {
  reason: Schema.Literal("InsufficientScope"),
  required: AuthorizationScopeSet,
  granted: AuthorizationScopeSet
}) {
  constructor(props: {
    readonly reason: "InsufficientScope"
    readonly required: typeof AuthorizationScopeSet.Type
    readonly granted: typeof AuthorizationScopeSet.Type
  }) {
    super({ reason: props.reason, required: props.required, granted: props.granted })
    defineFixedMessage(this, "Authorization policy requires additional scope")
  }
}
