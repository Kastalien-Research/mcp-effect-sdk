import * as Schema from "effect/Schema"
import {
  AuthorizationScopeSet,
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
    super({
      reason: props.reason,
      ...(props.issuer === undefined ? {} : { issuer: props.issuer }),
      ...(props.resource === undefined ? {} : { resource: props.resource })
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
