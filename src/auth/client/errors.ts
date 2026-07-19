import * as Schema from "effect/Schema"
import {
  AuthorizationScopeSet,
  isSanitizedAuthorizationIdentifier,
  safeAuthorizationArray,
  SanitizedAuthorizationIdentifier,
  snapshotDenseAuthorizationArray
} from "../common.js"

const defineFixedMessage = (error: Error, message: string): void => {
  Object.defineProperty(error, "message", {
    configurable: false,
    enumerable: false,
    value: message,
    writable: false
  })
}

const AUTHORIZATION_DECODE_ISSUE_FIELDS = [
  "resource",
  "authorizationServers",
  "authorization_servers",
  "scopesSupported",
  "scopes_supported",
  "bearerMethodsSupported",
  "bearer_methods_supported",
  "issuer",
  "authorizationEndpoint",
  "authorization_endpoint",
  "tokenEndpoint",
  "token_endpoint",
  "registrationEndpoint",
  "registration_endpoint",
  "responseTypesSupported",
  "response_types_supported",
  "grantTypesSupported",
  "grant_types_supported",
  "tokenEndpointAuthMethodsSupported",
  "token_endpoint_auth_methods_supported",
  "codeChallengeMethodsSupported",
  "code_challenge_methods_supported",
  "clientIdMetadataDocumentSupported",
  "client_id_metadata_document_supported",
  "authorizationResponseIssParameterSupported",
  "authorization_response_iss_parameter_supported",
  "scheme",
  "status",
  "error",
  "errorDescription",
  "scopes",
  "resourceMetadata",
  "transaction",
  "redirectUri",
  "parameters",
  "subject",
  "clientId",
  "audiences",
  "claims"
] as const

type AuthorizationDecodeIssueField = typeof AUTHORIZATION_DECODE_ISSUE_FIELDS[number]
type AuthorizationDecodeIssueSegment = AuthorizationDecodeIssueField | number

const authorizationDecodeIssueFields: ReadonlySet<string> = new Set(AUTHORIZATION_DECODE_ISSUE_FIELDS)
const MAX_ISSUE_INDEX = 0xffff_fffe

const isAuthorizationDecodeIssueSegment = (
  value: string | number
): value is AuthorizationDecodeIssueSegment => typeof value === "string"
  ? authorizationDecodeIssueFields.has(value)
  : Number.isSafeInteger(value) && value >= 0 && value <= MAX_ISSUE_INDEX

const IssueSegment = Schema.Union(Schema.String, Schema.Number).pipe(Schema.filter(
  isAuthorizationDecodeIssueSegment,
  { message: () => "Expected a known authorization model field or bounded numeric index" }
))
const IssuePath = safeAuthorizationArray(IssueSegment, { maximumLength: 16 })
const IssuePaths = safeAuthorizationArray(IssuePath, { maximumLength: 16 })

const ownDataValue = (source: object, key: PropertyKey): unknown => {
  try {
    const descriptor = Reflect.getOwnPropertyDescriptor(source, key)
    return descriptor !== undefined && "value" in descriptor ? descriptor.value : undefined
  } catch {
    return undefined
  }
}

const snapshotIssuePaths = (source: object): ReadonlyArray<ReadonlyArray<AuthorizationDecodeIssueSegment>> => {
  const rawPaths = snapshotDenseAuthorizationArray(ownDataValue(source, "issues"), 0, 16)
  if (rawPaths._tag === "Failure") return Object.freeze([])
  const paths: Array<ReadonlyArray<AuthorizationDecodeIssueSegment>> = []
  for (const rawPath of rawPaths.values) {
    const rawSegments = snapshotDenseAuthorizationArray(rawPath, 0, 16)
    if (rawSegments._tag === "Failure") continue
    const segments: Array<AuthorizationDecodeIssueSegment> = []
    let valid = true
    for (const segment of rawSegments.values) {
      if ((typeof segment !== "string" && typeof segment !== "number") ||
        !isAuthorizationDecodeIssueSegment(segment)) {
        valid = false
        break
      }
      segments.push(segment)
    }
    if (valid) paths.push(Object.freeze(segments))
  }
  return Object.freeze(paths)
}

const sanitizedIdentifierFrom = (source: object, key: "issuer" | "resource"): string | undefined => {
  const value = ownDataValue(source, key)
  return isSanitizedAuthorizationIdentifier(value) ? value : undefined
}

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
    readonly issues: ReadonlyArray<ReadonlyArray<AuthorizationDecodeIssueSegment>>
  }) {
    super({ model: props.model, issues: snapshotIssuePaths(props) })
    for (const path of this.issues) Object.freeze(path)
    Object.freeze(this.issues)
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
    const issuer = sanitizedIdentifierFrom(props, "issuer")
    const resource = sanitizedIdentifierFrom(props, "resource")
    super({
      reason: props.reason,
      ...(issuer === undefined ? {} : { issuer }),
      ...(resource === undefined ? {} : { resource }),
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
