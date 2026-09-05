import * as Effect from "effect/Effect"
import * as Schema from "effect/Schema"
import * as SchemaIssue from "effect/SchemaIssue"
import * as SchemaParser from "effect/SchemaParser"

// Bound inspectable routing identifiers with a platform-neutral URI parser.
const MAX_SAFE_AUTHORIZATION_URI_LENGTH = 2048
const URI_SCHEME = /^[A-Za-z][A-Za-z0-9+.-]*$/
const URI_PATH = /^(?:[A-Za-z0-9._~!$&'()*+,;=:@/-]|%[0-9A-Fa-f]{2})*$/
const URI_QUERY_OR_FRAGMENT = /^(?:[A-Za-z0-9._~!$&'()*+,;=:@/?-]|%[0-9A-Fa-f]{2})*$/
const UNSAFE_URI_CHARACTER = /[\p{C}\p{Z}\\]/u
const SENSITIVE_NAME_FAMILY =
  /^(?:keys?|privates?|signings?|encryptions?|secrets?|credentials?|passwords?|assertions?|tokens?|codes?|verifiers?|states?|cookies?|bearers?|authori[sz]ations?)$/

const normalizeUriEncoding = (value: string): string | undefined => {
  let normalized = value
  try {
    while (true) {
      const next = decodeURIComponent(normalized)
      if (UNSAFE_URI_CHARACTER.test(next)) return undefined
      if (next === normalized) return normalized
      normalized = next
    }
  } catch {
    return undefined
  }
}

const isSensitiveComponentName = (value: string): boolean => {
  const words = value
    .replace(/([a-z0-9])([A-Z])/g, "$1-$2")
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((word) => word.length > 0)
  return (
    words.some((word) => SENSITIVE_NAME_FAMILY.test(word)) ||
    words.some((word, index) => word === "api" && words[index + 1] === "key") ||
    words.includes("apikey")
  )
}

const hasSensitiveUriComponent = (value: string): boolean => {
  for (let assignment = value.indexOf("="); assignment >= 0; assignment = value.indexOf("=", assignment + 1)) {
    let start = assignment
    while (start > 0 && !"/?#&;".includes(value[start - 1]!)) start -= 1
    if (isSensitiveComponentName(value.slice(start, assignment))) return true
  }

  const queryOrFragmentStart = value.search(/[?#]/)
  const path = queryOrFragmentStart < 0 ? value : value.slice(0, queryOrFragmentStart)
  for (const component of path.split("/")) {
    const assignment = component.indexOf("=")
    if (assignment >= 0 && isSensitiveComponentName(component.slice(0, assignment))) return true
  }
  if (queryOrFragmentStart < 0) return false
  for (const parameter of value.slice(queryOrFragmentStart + 1).split(/[?&;#]/)) {
    const assignment = parameter.indexOf("=")
    const name = assignment < 0 ? parameter : parameter.slice(0, assignment)
    if (isSensitiveComponentName(name)) return true
  }
  return false
}

const isValidIpv4 = (value: string): boolean => {
  const parts = value.split(".")
  return parts.length === 4 && parts.every((part) => /^(?:0|[1-9][0-9]{0,2})$/.test(part) && Number(part) <= 255)
}

const isValidIpv6 = (value: string): boolean => {
  const halves = value.split("::")
  if (halves.length > 2) return false
  const segments = halves.flatMap((half) => (half.length === 0 ? [] : half.split(":")))
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
  return value
    .split(".")
    .every(
      (label) => label.length > 0 && label.length <= 63 && /^[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?$/.test(label)
    )
}

const isValidPort = (value: string): boolean => /^[0-9]{1,5}$/.test(value) && Number(value) <= 65535

const hasValidAuthority = (authority: string): boolean => {
  if (authority.length === 0 || authority.includes("@")) return false
  if (authority.startsWith("[")) {
    const close = authority.indexOf("]")
    if (close < 0 || !isValidIpv6(authority.slice(1, close))) return false
    const port = authority.slice(close + 1)
    return port.length === 0 || (port.startsWith(":") && isValidPort(port.slice(1)))
  }
  if (authority.includes("[") || authority.includes("]")) return false
  const separator = authority.lastIndexOf(":")
  if (separator < 0) return isValidHost(authority)
  if (authority.indexOf(":") !== separator) return false
  return isValidHost(authority.slice(0, separator)) && isValidPort(authority.slice(separator + 1))
}

const hasSafeAuthority = (value: string): boolean => {
  if (value.length === 0 || value.length > MAX_SAFE_AUTHORIZATION_URI_LENGTH || UNSAFE_URI_CHARACTER.test(value))
    return false
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
  if (!URI_PATH.test(path) || !URI_QUERY_OR_FRAGMENT.test(query) || !URI_QUERY_OR_FRAGMENT.test(fragment)) return false

  const normalized = normalizeUriEncoding(remainder)
  return normalized !== undefined && !hasSensitiveUriComponent(normalized)
}

export const SafeAuthorizationUri = Schema.String.pipe(
  Schema.check(Schema.makeFilter(hasSafeAuthority, { message: "Expected a safe absolute authorization identifier" }))
)

export const SafeRedirectUri = SafeAuthorizationUri.pipe(
  Schema.check(
    Schema.makeFilter(
      (value) => {
        const normalized = normalizeUriEncoding(value)
        return normalized !== undefined && !normalized.includes("#")
      },
      { message: "Expected a redirect identifier without a fragment" }
    )
  )
)

export const isSanitizedAuthorizationIdentifier = (value: unknown): value is string =>
  typeof value === "string" &&
  hasSafeAuthority(value) &&
  (() => {
    const normalized = normalizeUriEncoding(value)
    return normalized !== undefined && !/[?#]/.test(normalized)
  })()

export const SanitizedAuthorizationIdentifier = Schema.String.pipe(
  Schema.check(
    Schema.makeFilter(isSanitizedAuthorizationIdentifier, {
      message: "Expected a sanitized authorization identifier without userinfo, query, or fragment"
    })
  )
)

export const AuthorizationScope = Schema.NonEmptyString.pipe(
  Schema.check(
    Schema.makeFilter((value) => /^[\x21\x23-\x5B\x5D-\x7E]+$/.test(value), {
      message: "Expected an RFC 6750 scope-token"
    })
  ),
  Schema.brand("mcp-effect-sdk/auth/AuthorizationScope")
)
export type AuthorizationScope = typeof AuthorizationScope.Type

const MAX_PUBLIC_AUTHORIZATION_ARRAY_LENGTH = 4096

type DenseArraySnapshot =
  | { readonly _tag: "Success"; readonly values: ReadonlyArray<unknown> }
  | { readonly _tag: "Failure" }

const invalidDenseArraySnapshot: DenseArraySnapshot = { _tag: "Failure" }

export const snapshotDenseAuthorizationArray = (
  value: unknown,
  minimumLength = 0,
  maximumLength = MAX_PUBLIC_AUTHORIZATION_ARRAY_LENGTH
): DenseArraySnapshot => {
  try {
    if (!Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype) {
      return invalidDenseArraySnapshot
    }
    const keys: Array<string> = []
    for (const key of Reflect.ownKeys(value)) {
      if (typeof key !== "string") return invalidDenseArraySnapshot
      keys.push(key)
    }
    const descriptors = new Map<string, PropertyDescriptor>()
    for (const key of keys) {
      const descriptor = Reflect.getOwnPropertyDescriptor(value, key)
      if (descriptor === undefined) return invalidDenseArraySnapshot
      descriptors.set(key, descriptor)
    }
    const lengthDescriptor = descriptors.get("length")
    if (
      lengthDescriptor === undefined ||
      !("value" in lengthDescriptor) ||
      lengthDescriptor.enumerable ||
      lengthDescriptor.configurable ||
      !Number.isSafeInteger(lengthDescriptor.value) ||
      lengthDescriptor.value < minimumLength ||
      lengthDescriptor.value > maximumLength ||
      keys.length !== lengthDescriptor.value + 1
    ) {
      return invalidDenseArraySnapshot
    }
    const output: Array<unknown> = new Array(lengthDescriptor.value)
    for (const key of keys) {
      if (key === "length") continue
      const index = Number(key)
      const descriptor = descriptors.get(key)
      if (
        !Number.isSafeInteger(index) ||
        index < 0 ||
        index >= lengthDescriptor.value ||
        String(index) !== key ||
        descriptor === undefined ||
        !("value" in descriptor) ||
        !descriptor.enumerable
      )
        return invalidDenseArraySnapshot
      output[index] = descriptor.value
    }
    return { _tag: "Success", values: output }
  } catch {
    return invalidDenseArraySnapshot
  }
}

interface SafeAuthorizationArrayOptions {
  readonly minimumLength?: number
  readonly maximumLength?: number
  readonly description?: string
}

// Avoid the union dispatch used by Schema.optional: its shape inspection can
// throw on revoked proxies before an authorization codec snapshots the input.
export const safeOptionalAuthorizationField = <Item extends Schema.Constraint>(item: Item) =>
  Schema.optionalKey(
    Schema.declareConstructor<Item["Type"] | undefined, Item["Encoded"] | undefined>()(
      [item],
      ([codec]) =>
        (input, _ast, options) =>
          input === undefined ? Effect.succeed(undefined) : SchemaParser.decodeUnknownEffect(codec)(input, options)
    )
  )

const makeSafeAuthorizationArray = <
  Item extends Schema.Constraint,
  Decoded extends ReadonlyArray<Item["Type"]>,
  Encoded extends ReadonlyArray<Item["Encoded"]>
>(
  item: Item,
  options: SafeAuthorizationArrayOptions | undefined,
  finalize: (values: Array<Item["Type"]>) => Decoded
) => {
  const minimumLength = options?.minimumLength ?? 0
  const maximumLength = options?.maximumLength ?? MAX_PUBLIC_AUTHORIZATION_ARRAY_LENGTH
  const failureMessage = options?.description ?? "Expected a bounded dense authorization array"
  return Schema.declareConstructor<Decoded, Encoded>()(
    [item],
    ([element]) =>
      (input, _ast, parseOptions) => {
        const snapshot = snapshotDenseAuthorizationArray(input, minimumLength, maximumLength)
        if (snapshot._tag === "Failure") {
          return Effect.fail(new SchemaIssue.InvalidValue({ message: failureMessage }))
        }
        // v4 resolves each parameter codec in the current parsing direction.
        // Snapshot before traversal in both directions, including Schema.toType.
        return Effect.forEach(snapshot.values, (value) =>
          SchemaParser.decodeUnknownEffect(element)(value, parseOptions)
        ).pipe(Effect.map(finalize))
      },
    { expected: failureMessage }
  )
}

// A declaration receives unknown input before any array traversal, so hostile
// inputs reach the caught descriptor snapshot rather than Schema.Array.
export const safeAuthorizationArray = <Item extends Schema.Constraint>(
  item: Item,
  options?: SafeAuthorizationArrayOptions
) =>
  makeSafeAuthorizationArray<Item, ReadonlyArray<Item["Type"]>, ReadonlyArray<Item["Encoded"]>>(
    item,
    options,
    (values) => Object.freeze(values)
  )

export const safeNonEmptyAuthorizationArray = <Item extends Schema.Constraint>(
  item: Item,
  options?: Omit<SafeAuthorizationArrayOptions, "minimumLength">
) =>
  makeSafeAuthorizationArray<
    Item,
    readonly [Item["Type"], ...Array<Item["Type"]>],
    readonly [Item["Encoded"], ...Array<Item["Encoded"]>]
  >(item, { ...options, minimumLength: 1 }, (values) => Object.freeze([values[0]!, ...values.slice(1)]))

export const AuthorizationScopeSet = safeAuthorizationArray(AuthorizationScope, {
  description: "An immutable authorization scope array"
})
export type AuthorizationScopeSet = typeof AuthorizationScopeSet.Type

const opaqueHandle = <Name extends string>(name: Name) =>
  Schema.NonEmptyString.pipe(Schema.brand(`mcp-effect-sdk/auth/${name}`))

export const AuthorizationCredentialHandle = opaqueHandle("AuthorizationCredentialHandle")
export const AuthorizationGrantHandle = opaqueHandle("AuthorizationGrantHandle")
export const AuthorizationTransactionHandle = opaqueHandle("AuthorizationTransactionHandle")
export const AuthorizationSigningKeyHandle = opaqueHandle("AuthorizationSigningKeyHandle")
export type AuthorizationCredentialHandle = typeof AuthorizationCredentialHandle.Type
export type AuthorizationGrantHandle = typeof AuthorizationGrantHandle.Type
export type AuthorizationTransactionHandle = typeof AuthorizationTransactionHandle.Type
export type AuthorizationSigningKeyHandle = typeof AuthorizationSigningKeyHandle.Type

export const ProtectedResourceMetadata = Schema.Struct({
  resource: SafeAuthorizationUri,
  authorizationServers: safeNonEmptyAuthorizationArray(SafeAuthorizationUri, {
    description: "A non-empty authorization server array"
  }),
  scopesSupported: safeOptionalAuthorizationField(AuthorizationScopeSet),
  bearerMethodsSupported: safeOptionalAuthorizationField(safeAuthorizationArray(Schema.String))
}).pipe(
  Schema.encodeKeys({
    authorizationServers: "authorization_servers",
    scopesSupported: "scopes_supported",
    bearerMethodsSupported: "bearer_methods_supported"
  })
)
export type ProtectedResourceMetadata = typeof ProtectedResourceMetadata.Type

export const AuthorizationServerMetadata = Schema.Struct({
  issuer: SafeAuthorizationUri,
  authorizationEndpoint: safeOptionalAuthorizationField(SafeAuthorizationUri),
  tokenEndpoint: SafeAuthorizationUri,
  registrationEndpoint: safeOptionalAuthorizationField(SafeAuthorizationUri),
  scopesSupported: safeOptionalAuthorizationField(AuthorizationScopeSet),
  responseTypesSupported: safeOptionalAuthorizationField(safeAuthorizationArray(Schema.String)),
  grantTypesSupported: safeOptionalAuthorizationField(safeAuthorizationArray(Schema.String)),
  tokenEndpointAuthMethodsSupported: safeOptionalAuthorizationField(safeAuthorizationArray(Schema.String)),
  codeChallengeMethodsSupported: safeOptionalAuthorizationField(safeAuthorizationArray(Schema.String)),
  clientIdMetadataDocumentSupported: safeOptionalAuthorizationField(Schema.Boolean),
  authorizationResponseIssParameterSupported: safeOptionalAuthorizationField(Schema.Boolean)
}).pipe(
  Schema.encodeKeys({
    authorizationEndpoint: "authorization_endpoint",
    tokenEndpoint: "token_endpoint",
    registrationEndpoint: "registration_endpoint",
    scopesSupported: "scopes_supported",
    responseTypesSupported: "response_types_supported",
    grantTypesSupported: "grant_types_supported",
    tokenEndpointAuthMethodsSupported: "token_endpoint_auth_methods_supported",
    codeChallengeMethodsSupported: "code_challenge_methods_supported",
    clientIdMetadataDocumentSupported: "client_id_metadata_document_supported",
    authorizationResponseIssParameterSupported: "authorization_response_iss_parameter_supported"
  })
)
export type AuthorizationServerMetadata = typeof AuthorizationServerMetadata.Type

const BoundedDescription = Schema.String.pipe(
  Schema.check(Schema.isMaxLength(512)),
  Schema.check(
    Schema.makeFilter((value) => !/[\u0000-\u001f\u007f-\u009f]/.test(value), {
      message: "Expected bounded text without control characters"
    })
  )
)

export class AuthorizationChallenge extends Schema.Class<AuthorizationChallenge>(
  "mcp-effect-sdk/auth/AuthorizationChallenge"
)({
  scheme: Schema.Literal("Bearer"),
  status: Schema.Union([Schema.Literal(401), Schema.Literal(403)]),
  error: safeOptionalAuthorizationField(
    Schema.Union([Schema.Literal("invalid_token"), Schema.Literal("insufficient_scope")])
  ),
  errorDescription: safeOptionalAuthorizationField(BoundedDescription),
  scopes: safeOptionalAuthorizationField(AuthorizationScopeSet),
  resourceMetadata: safeOptionalAuthorizationField(SafeAuthorizationUri)
}) {}

export class AuthorizationCallbackInput extends Schema.Class<AuthorizationCallbackInput>(
  "mcp-effect-sdk/auth/client/AuthorizationCallbackInput"
)({
  transaction: AuthorizationTransactionHandle,
  redirectUri: SafeRedirectUri,
  parameters: Schema.Redacted(Schema.String)
}) {}
