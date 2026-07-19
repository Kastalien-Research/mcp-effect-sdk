import * as Schema from "effect/Schema"

// Bound inspectable routing identifiers with a platform-neutral URI parser.
const MAX_SAFE_AUTHORIZATION_URI_LENGTH = 2048
const URI_SCHEME = /^[A-Za-z][A-Za-z0-9+.-]*$/
const URI_PATH = /^(?:[A-Za-z0-9._~!$&'()*+,;=:@/-]|%[0-9A-Fa-f]{2})*$/
const URI_QUERY_OR_FRAGMENT = /^(?:[A-Za-z0-9._~!$&'()*+,;=:@/?-]|%[0-9A-Fa-f]{2})*$/
const UNSAFE_URI_CHARACTER = /[\u0000-\u0020\u007f-\u009f\\]/
const SECRET_COMPONENT = /(?:^|[/?&#;])(?:authorization|bearer|client_secret|code|code_verifier|cookie|state|token|access_token|refresh_token|id_token)=/i

const normalizeEncodedAscii = (value: string): string | undefined => {
  let normalized = value
  for (let pass = 0; pass < 3; pass += 1) {
    const next = normalized.replace(/%([0-9A-Fa-f]{2})/g, (match, digits: string) => {
      const code = Number.parseInt(digits, 16)
      return code <= 0x7f ? String.fromCharCode(code) : match.toUpperCase()
    })
    if (UNSAFE_URI_CHARACTER.test(next)) return undefined
    if (next === normalized) break
    normalized = next
  }
  return normalized
}

const isValidIpv4 = (value: string): boolean => {
  const parts = value.split(".")
  return parts.length === 4 && parts.every((part) =>
    /^(?:0|[1-9][0-9]{0,2})$/.test(part) && Number(part) <= 255)
}

const isValidIpv6 = (value: string): boolean => {
  const halves = value.split("::")
  if (halves.length > 2) return false
  const segments = halves.flatMap((half) => half.length === 0 ? [] : half.split(":"))
  let units = 0
  for (let index = 0; index < segments.length; index += 1) {
    const segment = segments[index]
    if (segment.includes(".")) {
      if (index !== segments.length - 1 || !isValidIpv4(segment)) return false
      units += 2
    } else {
      if (!/^[0-9A-Fa-f]{1,4}$/.test(segment)) return false
      units += 1
    }
  }
  return halves.length === 2 ? units < 8 : units === 8
}

const isValidHost = (value: string): boolean => {
  if (value.length === 0 || value.length > 253) return false
  if (/^[0-9.]+$/.test(value)) return isValidIpv4(value)
  return value.split(".").every((label) =>
    label.length > 0 && label.length <= 63 &&
    /^[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?$/.test(label))
}

const isValidPort = (value: string): boolean =>
  /^[0-9]{1,5}$/.test(value) && Number(value) <= 65535

const hasValidAuthority = (authority: string): boolean => {
  if (authority.length === 0 || authority.includes("@")) return false
  if (authority.startsWith("[")) {
    const close = authority.indexOf("]")
    if (close < 0 || !isValidIpv6(authority.slice(1, close))) return false
    const port = authority.slice(close + 1)
    return port.length === 0 || port.startsWith(":") && isValidPort(port.slice(1))
  }
  if (authority.includes("[") || authority.includes("]")) return false
  const separator = authority.lastIndexOf(":")
  if (separator < 0) return isValidHost(authority)
  if (authority.indexOf(":") !== separator) return false
  return isValidHost(authority.slice(0, separator)) && isValidPort(authority.slice(separator + 1))
}

const hasSafeAuthority = (value: string): boolean => {
  if (value.length === 0 || value.length > MAX_SAFE_AUTHORIZATION_URI_LENGTH ||
    UNSAFE_URI_CHARACTER.test(value)) return false
  const schemeEnd = value.indexOf("://")
  if (schemeEnd <= 0 || !URI_SCHEME.test(value.slice(0, schemeEnd))) return false
  const suffix = value.slice(schemeEnd + 3)
  const boundary = suffix.search(/[/?#]/)
  const authority = boundary < 0 ? suffix : suffix.slice(0, boundary)
  if (!hasValidAuthority(authority)) return false

  const remainder = boundary < 0 ? "" : suffix.slice(boundary)
  const fragmentIndex = remainder.indexOf("#")
  if (fragmentIndex !== remainder.lastIndexOf("#")) return false
  const beforeFragment = fragmentIndex < 0 ? remainder : remainder.slice(0, fragmentIndex)
  const fragment = fragmentIndex < 0 ? "" : remainder.slice(fragmentIndex + 1)
  const queryIndex = beforeFragment.indexOf("?")
  const path = queryIndex < 0 ? beforeFragment : beforeFragment.slice(0, queryIndex)
  const query = queryIndex < 0 ? "" : beforeFragment.slice(queryIndex + 1)
  if (path.length > 0 && !path.startsWith("/")) return false
  if (!URI_PATH.test(path) || !URI_QUERY_OR_FRAGMENT.test(query) ||
    !URI_QUERY_OR_FRAGMENT.test(fragment)) return false

  const normalized = normalizeEncodedAscii(remainder)
  return normalized !== undefined && !SECRET_COMPONENT.test(normalized)
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
const FrozenAuthorizationScopeArray = Schema.declare<ReadonlyArray<AuthorizationScope>>(
  (value): value is ReadonlyArray<AuthorizationScope> => Array.isArray(value) && Object.isFrozen(value),
  { description: "An immutable authorization scope array" }
)

export const AuthorizationScopeSet = Schema.transform(
  AuthorizationScopeArray,
  FrozenAuthorizationScopeArray,
  {
    strict: true,
    decode: (values) => Object.freeze([...values]),
    encode: (_encoded, values) => [...values]
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
