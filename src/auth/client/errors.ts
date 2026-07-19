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

const IssueSegment = Schema.Union(
  Schema.String.pipe(Schema.maxLength(128)),
  Schema.Number.pipe(Schema.int(), Schema.nonNegative())
)
const IssuePath = Schema.Array(IssueSegment).pipe(Schema.maxItems(16))
const IssuePaths = Schema.Array(IssuePath).pipe(Schema.maxItems(16))

export type AuthorizationDecodeModel =
  | "ProtectedResourceMetadata"
  | "AuthorizationServerMetadata"
  | "AuthorizationChallenge"
  | "AuthorizationCallbackInput"
  | "AuthorizationPrincipal"

export class AuthorizationDecodeError extends Schema.TaggedError<AuthorizationDecodeError>(
  "mcp-effect-sdk/auth/client/AuthorizationDecodeError"
)("AuthorizationDecodeError", {
  model: Schema.Union(
    Schema.Literal("ProtectedResourceMetadata"),
    Schema.Literal("AuthorizationServerMetadata"),
    Schema.Literal("AuthorizationChallenge"),
    Schema.Literal("AuthorizationCallbackInput"),
    Schema.Literal("AuthorizationPrincipal")
  ),
  issues: IssuePaths
}) {
  constructor(props: {
    readonly model: AuthorizationDecodeModel
    readonly issues: ReadonlyArray<ReadonlyArray<string | number>>
  }) {
    super({ model: props.model, issues: props.issues })
    defineFixedMessage(this, "Authorization input could not be decoded")
  }
}

export class AuthorizationHttpError extends Schema.TaggedError<AuthorizationHttpError>(
  "mcp-effect-sdk/auth/client/AuthorizationHttpError"
)("AuthorizationHttpError", {
  operation: Schema.Literal("request"),
  status: Schema.optional(Schema.Number),
  retryable: Schema.Boolean
}) {
  constructor(props: {
    readonly operation: "request"
    readonly status?: number
    readonly retryable: boolean
  }) {
    super({
      operation: props.operation,
      retryable: props.retryable,
      ...(props.status === undefined ? {} : { status: props.status })
    })
    defineFixedMessage(this, "Authorization HTTP request failed")
  }
}

export type AuthorizationCryptoOperation = "randomBytes" | "sha256" | "sign"
export type AuthorizationCryptoReason = "Unavailable" | "Failed"

export class AuthorizationCryptoError extends Schema.TaggedError<AuthorizationCryptoError>(
  "mcp-effect-sdk/auth/client/AuthorizationCryptoError"
)("AuthorizationCryptoError", {
  operation: Schema.Union(
    Schema.Literal("randomBytes"),
    Schema.Literal("sha256"),
    Schema.Literal("sign")
  ),
  reason: Schema.Union(Schema.Literal("Unavailable"), Schema.Literal("Failed"))
}) {
  constructor(props: {
    readonly operation: AuthorizationCryptoOperation
    readonly reason: AuthorizationCryptoReason
  }) {
    super({ operation: props.operation, reason: props.reason })
    defineFixedMessage(this, `Authorization cryptography ${props.reason.toLowerCase()}`)
  }
}

export type AuthorizationInteractionOperation = "open" | "waitForCallback"
export type AuthorizationInteractionReason = "Unavailable" | "Rejected" | "CancelledByUser" | "Failed"

export class AuthorizationInteractionError extends Schema.TaggedError<AuthorizationInteractionError>(
  "mcp-effect-sdk/auth/client/AuthorizationInteractionError"
)("AuthorizationInteractionError", {
  operation: Schema.Union(Schema.Literal("open"), Schema.Literal("waitForCallback")),
  reason: Schema.Union(
    Schema.Literal("Unavailable"),
    Schema.Literal("Rejected"),
    Schema.Literal("CancelledByUser"),
    Schema.Literal("Failed")
  )
}) {
  constructor(props: {
    readonly operation: AuthorizationInteractionOperation
    readonly reason: AuthorizationInteractionReason
  }) {
    super({ operation: props.operation, reason: props.reason })
    defineFixedMessage(this, `Authorization interaction ${props.reason}`)
  }
}

export type AuthorizationStoreOperation =
  | "findCredential"
  | "saveCredential"
  | "readCredential"
  | "findGrant"
  | "saveGrant"
  | "readGrant"
  | "removeGrant"
  | "saveTransaction"
  | "takeTransaction"
export type AuthorizationStoreReason = "NotFound" | "Conflict" | "Unavailable" | "Failed"

export class AuthorizationStoreError extends Schema.TaggedError<AuthorizationStoreError>(
  "mcp-effect-sdk/auth/client/AuthorizationStoreError"
)("AuthorizationStoreError", {
  operation: Schema.Union(
    Schema.Literal("findCredential"),
    Schema.Literal("saveCredential"),
    Schema.Literal("readCredential"),
    Schema.Literal("findGrant"),
    Schema.Literal("saveGrant"),
    Schema.Literal("readGrant"),
    Schema.Literal("removeGrant"),
    Schema.Literal("saveTransaction"),
    Schema.Literal("takeTransaction")
  ),
  reason: Schema.Union(
    Schema.Literal("NotFound"),
    Schema.Literal("Conflict"),
    Schema.Literal("Unavailable"),
    Schema.Literal("Failed")
  )
}) {
  constructor(props: {
    readonly operation: AuthorizationStoreOperation
    readonly reason: AuthorizationStoreReason
  }) {
    super({ operation: props.operation, reason: props.reason })
    defineFixedMessage(this, `Authorization store ${props.reason}`)
  }
}

export type AuthorizationProtocolReason =
  | "InvalidConfiguration"
  | "DiscoveryFailed"
  | "IssuerMismatch"
  | "UnsupportedAuthorizationServer"
  | "InvalidChallenge"
  | "UnsupportedRegistration"
  | "CredentialMissing"
  | "CredentialIssuerMismatch"
  | "RegistrationFailed"
  | "StateMismatch"
  | "StateReplay"
  | "RedirectMismatch"
  | "ResponseIssuerMismatch"
  | "AuthorizationDenied"
  | "TokenExchangeFailed"
  | "TokenRefreshFailed"
  | "ResourceMismatch"
  | "AudienceMismatch"

const ProtocolReason = Schema.Union(
  Schema.Literal("InvalidConfiguration"),
  Schema.Literal("DiscoveryFailed"),
  Schema.Literal("IssuerMismatch"),
  Schema.Literal("UnsupportedAuthorizationServer"),
  Schema.Literal("InvalidChallenge"),
  Schema.Literal("UnsupportedRegistration"),
  Schema.Literal("CredentialMissing"),
  Schema.Literal("CredentialIssuerMismatch"),
  Schema.Literal("RegistrationFailed"),
  Schema.Literal("StateMismatch"),
  Schema.Literal("StateReplay"),
  Schema.Literal("RedirectMismatch"),
  Schema.Literal("ResponseIssuerMismatch"),
  Schema.Literal("AuthorizationDenied"),
  Schema.Literal("TokenExchangeFailed"),
  Schema.Literal("TokenRefreshFailed"),
  Schema.Literal("ResourceMismatch"),
  Schema.Literal("AudienceMismatch")
)

export class AuthorizationProtocolError extends Schema.TaggedError<AuthorizationProtocolError>(
  "mcp-effect-sdk/auth/client/AuthorizationProtocolError"
)("AuthorizationProtocolError", {
  reason: ProtocolReason,
  issuer: Schema.optional(SanitizedAuthorizationIdentifier),
  resource: Schema.optional(SanitizedAuthorizationIdentifier),
  scopes: Schema.optional(AuthorizationScopeSet),
  status: Schema.optional(Schema.Number)
}) {
  constructor(props: {
    readonly reason: AuthorizationProtocolReason
    readonly issuer?: string
    readonly resource?: string
    readonly scopes?: typeof AuthorizationScopeSet.Type
    readonly status?: number
  }) {
    super({
      reason: props.reason,
      ...(props.issuer === undefined ? {} : { issuer: props.issuer }),
      ...(props.resource === undefined ? {} : { resource: props.resource }),
      ...(props.scopes === undefined ? {} : { scopes: props.scopes }),
      ...(props.status === undefined ? {} : { status: props.status })
    })
    defineFixedMessage(this, `Authorization protocol ${props.reason}`)
  }
}

export type AuthorizationClientError =
  | AuthorizationDecodeError
  | AuthorizationHttpError
  | AuthorizationCryptoError
  | AuthorizationInteractionError
  | AuthorizationStoreError
  | AuthorizationProtocolError
