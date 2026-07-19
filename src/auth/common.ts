import * as Schema from "effect/Schema"

const SECRET_COMPONENT = /(?:^|[?&#;])(?:authorization|bearer|client_secret|code|code_verifier|cookie|state|token|access_token|refresh_token|id_token)=/i
const ABSOLUTE_IDENTIFIER = /^[A-Za-z][A-Za-z0-9+.-]*:\/\//

const hasSafeAuthority = (value: string): boolean => {
  if (!ABSOLUTE_IDENTIFIER.test(value) || SECRET_COMPONENT.test(value)) return false
  const authorityStart = value.indexOf("://") + 3
  const suffix = value.slice(authorityStart)
  const boundary = suffix.search(/[/?#]/)
  const authority = boundary < 0 ? suffix : suffix.slice(0, boundary)
  return authority.length > 0 && !authority.includes("@")
}

export const SafeAuthorizationUri = Schema.String.pipe(Schema.filter(
  hasSafeAuthority,
  { message: () => "Expected a safe absolute authorization identifier" }
))

export const SafeRedirectUri = SafeAuthorizationUri.pipe(Schema.filter(
  (value) => !value.includes("#"),
  { message: () => "Expected a redirect identifier without a fragment" }
))

export const isSanitizedAuthorizationIdentifier = (value: unknown): value is string =>
  typeof value === "string" && hasSafeAuthority(value) && !/[?#]/.test(value)

export const SanitizedAuthorizationIdentifier = Schema.String.pipe(Schema.filter(
  isSanitizedAuthorizationIdentifier,
  { message: () => "Expected a sanitized authorization identifier without userinfo, query, or fragment" }
))

export const AuthorizationScope = Schema.NonEmptyString.pipe(
  Schema.filter((value) => !/[\u0009-\u000d\u0020]/.test(value), {
    message: () => "Expected an authorization scope without separator whitespace"
  }),
  Schema.brand("mcp-effect-sdk/auth/AuthorizationScope")
)
export type AuthorizationScope = typeof AuthorizationScope.Type

const AuthorizationScopeArray = Schema.Array(AuthorizationScope)

export const AuthorizationScopeSet = Schema.transform(
  AuthorizationScopeArray,
  AuthorizationScopeArray,
  {
    strict: true,
    decode: (values) => Object.freeze([...values]),
    encode: (_encoded, values) => Object.freeze([...values])
  }
)
export type AuthorizationScopeSet = typeof AuthorizationScopeSet.Type

const opaqueHandle = <Name extends string>(name: Name) => Schema.NonEmptyString.pipe(
  Schema.brand(`mcp-effect-sdk/auth/${name}`)
)

export const AuthorizationCredentialHandle = opaqueHandle("AuthorizationCredentialHandle")
export const AuthorizationGrantHandle = opaqueHandle("AuthorizationGrantHandle")
export const AuthorizationTransactionHandle = opaqueHandle("AuthorizationTransactionHandle")
export const AuthorizationSigningKeyHandle = opaqueHandle("AuthorizationSigningKeyHandle")
export type AuthorizationCredentialHandle = typeof AuthorizationCredentialHandle.Type
export type AuthorizationGrantHandle = typeof AuthorizationGrantHandle.Type
export type AuthorizationTransactionHandle = typeof AuthorizationTransactionHandle.Type
export type AuthorizationSigningKeyHandle = typeof AuthorizationSigningKeyHandle.Type

const optionalFrom = <Codec extends Schema.Schema.All>(codec: Codec, key: string) =>
  Schema.optional(codec).pipe(Schema.fromKey(key))

export class ProtectedResourceMetadata extends Schema.Class<ProtectedResourceMetadata>(
  "mcp-effect-sdk/auth/ProtectedResourceMetadata"
)({
  resource: SafeAuthorizationUri,
  authorizationServers: Schema.NonEmptyArray(SafeAuthorizationUri).pipe(
    Schema.propertySignature,
    Schema.fromKey("authorization_servers")
  ),
  scopesSupported: optionalFrom(AuthorizationScopeSet, "scopes_supported"),
  bearerMethodsSupported: optionalFrom(Schema.Array(Schema.String), "bearer_methods_supported")
}) {}

export class AuthorizationServerMetadata extends Schema.Class<AuthorizationServerMetadata>(
  "mcp-effect-sdk/auth/AuthorizationServerMetadata"
)({
  issuer: SafeAuthorizationUri,
  authorizationEndpoint: optionalFrom(SafeAuthorizationUri, "authorization_endpoint"),
  tokenEndpoint: SafeAuthorizationUri.pipe(
    Schema.propertySignature,
    Schema.fromKey("token_endpoint")
  ),
  registrationEndpoint: optionalFrom(SafeAuthorizationUri, "registration_endpoint"),
  scopesSupported: optionalFrom(AuthorizationScopeSet, "scopes_supported"),
  responseTypesSupported: optionalFrom(Schema.Array(Schema.String), "response_types_supported"),
  grantTypesSupported: optionalFrom(Schema.Array(Schema.String), "grant_types_supported"),
  tokenEndpointAuthMethodsSupported: optionalFrom(
    Schema.Array(Schema.String),
    "token_endpoint_auth_methods_supported"
  ),
  codeChallengeMethodsSupported: optionalFrom(
    Schema.Array(Schema.String),
    "code_challenge_methods_supported"
  ),
  clientIdMetadataDocumentSupported: optionalFrom(
    Schema.Boolean,
    "client_id_metadata_document_supported"
  ),
  authorizationResponseIssParameterSupported: optionalFrom(
    Schema.Boolean,
    "authorization_response_iss_parameter_supported"
  )
}) {}

const BoundedDescription = Schema.String.pipe(
  Schema.maxLength(512),
  Schema.filter((value) => !/[\u0000-\u001f\u007f-\u009f]/.test(value), {
    message: () => "Expected bounded text without control characters"
  })
)

export class AuthorizationChallenge extends Schema.Class<AuthorizationChallenge>(
  "mcp-effect-sdk/auth/AuthorizationChallenge"
)({
  scheme: Schema.Literal("Bearer"),
  status: Schema.Union(Schema.Literal(401), Schema.Literal(403)),
  error: Schema.optional(Schema.Union(
    Schema.Literal("invalid_token"),
    Schema.Literal("insufficient_scope")
  )),
  errorDescription: Schema.optional(BoundedDescription),
  scopes: AuthorizationScopeSet,
  resourceMetadata: Schema.optional(SafeAuthorizationUri)
}) {}

export class AuthorizationCallbackInput extends Schema.Class<AuthorizationCallbackInput>(
  "mcp-effect-sdk/auth/client/AuthorizationCallbackInput"
)({
  transaction: AuthorizationTransactionHandle,
  redirectUri: SafeRedirectUri,
  parameters: Schema.RedactedFromSelf(Schema.String)
}) {}
