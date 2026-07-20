import * as Clock from "effect/Clock"
import * as Effect from "effect/Effect"
import * as Option from "effect/Option"
import * as Redacted from "effect/Redacted"
import type {
  AuthorizationCredentialHandle,
  AuthorizationGrantHandle,
  AuthorizationScope,
  AuthorizationScopeSet,
  AuthorizationServerMetadata
} from "../common.js"
import { snapshotDenseAuthorizationArray } from "../common.js"
import { encodeForm, encodeUtf8 } from "./encoding.js"
import type { AuthorizationClientError } from "./errors.js"
import { AuthorizationProtocolError } from "./errors.js"
import { decodeJsonObject, snapshotHttpReply } from "./json.js"
import type {
  StoredAuthorizationCredential,
  StoredAuthorizationGrant
} from "./models.js"
import {
  AuthorizationClientStore,
  AuthorizationHttpClient
} from "./services.js"
import {
  type CompleteAuthorizationCallbackInput,
  type CompletedAuthorizationCode,
  completeAuthorizationCallback
} from "./transaction.js"
import {
  isSafeHttpsEndpoint,
  isSafeHttpsIssuer,
  isSafeRedirectIdentifier,
  parseAuthorizationUri
} from "./uri.js"

export interface TokenAudienceValidationInput {
  readonly token: Redacted.Redacted<string>
  readonly issuer: string
  readonly resource: string
}

export type TokenAudienceValidator = (
  input: TokenAudienceValidationInput
) => Effect.Effect<ReadonlyArray<string>, AuthorizationClientError>

export interface ExchangeAuthorizationCodeInput {
  readonly authorization: CompletedAuthorizationCode
  readonly authorizationServerMetadata: AuthorizationServerMetadata
  readonly validateAudience: TokenAudienceValidator
  readonly receivedAt?: number
}

export interface ExchangeAuthorizationCallbackInput extends CompleteAuthorizationCallbackInput {
  readonly validateAudience: TokenAudienceValidator
  readonly receivedAt?: number
}

export interface RefreshAuthorizationGrantInput {
  readonly grant: AuthorizationGrantHandle
  readonly authorizationServerMetadata: AuthorizationServerMetadata
  readonly validateAudience: TokenAudienceValidator
  readonly receivedAt?: number
}

const protocolFailure = (
  reason: ConstructorParameters<typeof AuthorizationProtocolError>[0]["reason"],
  status?: number
): AuthorizationProtocolError => new AuthorizationProtocolError({
  reason,
  ...(status === undefined ? {} : { status })
})

const ownDataValue = (source: object, key: PropertyKey): unknown => {
  const descriptor = Reflect.getOwnPropertyDescriptor(source, key)
  if (descriptor === undefined || !("value" in descriptor)) return undefined
  return descriptor.value
}

const boundedString = (value: unknown, maximum: number, allowEmpty = false): value is string =>
  typeof value === "string" && (allowEmpty || value.length > 0) && value.length <= maximum &&
  !/[\u0000-\u001f\u007f-\u009f]/.test(value)

const opaqueHandle = (value: unknown): value is string => boundedString(value, 4096)

const bearerTokenType = (value: unknown): "Bearer" | undefined =>
  boundedString(value, 128) && value.length === 6 && value.toLowerCase() === "bearer"
    ? "Bearer"
    : undefined

const redactedString = (
  value: unknown,
  maximum: number
): Redacted.Redacted<string> | undefined => {
  try {
    if (!Redacted.isRedacted(value)) return undefined
    const revealed = Redacted.value(value)
    return boundedString(revealed, maximum) ? value as Redacted.Redacted<string> : undefined
  } catch {
    return undefined
  }
}

const snapshotScopes = (value: unknown): AuthorizationScopeSet | undefined => {
  const snapshot = snapshotDenseAuthorizationArray(value, 0, 4096)
  if (snapshot._tag === "Failure") return undefined
  const output: Array<AuthorizationScope> = []
  for (const scope of snapshot.values) {
    if (!boundedString(scope, 512) || /[\u0009-\u000d\u0020]/.test(scope)) return undefined
    output.push(scope as AuthorizationScope)
  }
  return Object.freeze(output) as AuthorizationScopeSet
}

interface CredentialSnapshot {
  readonly issuer: string
  readonly clientId: string
  readonly clientSecret?: Redacted.Redacted<string>
}

const snapshotCredential = (value: unknown): CredentialSnapshot | undefined => {
  try {
    if (typeof value !== "object" || value === null) return undefined
    const issuer = ownDataValue(value, "issuer")
    const clientId = ownDataValue(value, "clientId")
    const rawSecret = ownDataValue(value, "clientSecret")
    const clientSecret = rawSecret === undefined ? undefined : redactedString(rawSecret, 16 * 1024)
    if (!isSafeHttpsIssuer(issuer) || !boundedString(clientId, 2048) ||
      rawSecret !== undefined && clientSecret === undefined) return undefined
    return Object.freeze({
      issuer,
      clientId,
      ...(clientSecret === undefined ? {} : { clientSecret })
    })
  } catch {
    return undefined
  }
}

interface AuthorizationSnapshot {
  readonly issuer: string
  readonly resource: string
  readonly credentialHandle: AuthorizationCredentialHandle
  readonly redirectUri: string
  readonly scopes: AuthorizationScopeSet
  readonly authorizationCode: Redacted.Redacted<string>
  readonly codeVerifier: Redacted.Redacted<string>
}

const snapshotAuthorization = (value: unknown): AuthorizationSnapshot | undefined => {
  try {
    if (typeof value !== "object" || value === null) return undefined
    const issuer = ownDataValue(value, "issuer")
    const resource = ownDataValue(value, "resource")
    const credentialHandle = ownDataValue(value, "credentialHandle")
    const redirectUri = ownDataValue(value, "redirectUri")
    const scopes = snapshotScopes(ownDataValue(value, "scopes"))
    const authorizationCode = redactedString(ownDataValue(value, "authorizationCode"), 16 * 1024)
    const codeVerifier = redactedString(ownDataValue(value, "codeVerifier"), 4096)
    if (!boundedString(resource, 2048)) return undefined
    const parsedResource = parseAuthorizationUri(resource)
    if (!isSafeHttpsIssuer(issuer) || parsedResource._tag === "Failure" ||
      parsedResource.value.scheme.toLowerCase() !== "https" ||
      parsedResource.value.fragment !== undefined || !opaqueHandle(credentialHandle) ||
      !isSafeRedirectIdentifier(redirectUri) || scopes === undefined ||
      authorizationCode === undefined || codeVerifier === undefined) return undefined
    return Object.freeze({
      issuer,
      resource,
      credentialHandle: credentialHandle as AuthorizationCredentialHandle,
      redirectUri,
      scopes,
      authorizationCode,
      codeVerifier
    })
  } catch {
    return undefined
  }
}

interface GrantSnapshot {
  readonly issuer: string
  readonly resource: string
  readonly clientId: string
  readonly scopes: AuthorizationScopeSet
  readonly tokenType: string
  readonly accessToken: Redacted.Redacted<string>
  readonly refreshToken?: Redacted.Redacted<string>
}

const snapshotGrant = (value: unknown): GrantSnapshot | undefined => {
  try {
    if (typeof value !== "object" || value === null) return undefined
    const issuer = ownDataValue(value, "issuer")
    const resource = ownDataValue(value, "resource")
    const clientId = ownDataValue(value, "clientId")
    const scopes = snapshotScopes(ownDataValue(value, "scopes"))
    const tokenType = bearerTokenType(ownDataValue(value, "tokenType"))
    const accessToken = redactedString(ownDataValue(value, "accessToken"), 16 * 1024)
    const rawRefresh = ownDataValue(value, "refreshToken")
    const refreshToken = rawRefresh === undefined ? undefined : redactedString(rawRefresh, 16 * 1024)
    if (!boundedString(resource, 2048)) return undefined
    const parsedResource = parseAuthorizationUri(resource)
    if (!isSafeHttpsIssuer(issuer) || parsedResource._tag === "Failure" ||
      parsedResource.value.scheme.toLowerCase() !== "https" ||
      parsedResource.value.fragment !== undefined ||
      !boundedString(clientId, 2048) || scopes === undefined || tokenType === undefined ||
      accessToken === undefined || rawRefresh !== undefined && refreshToken === undefined) {
      return undefined
    }
    return Object.freeze({
      issuer,
      resource,
      clientId,
      scopes,
      tokenType,
      accessToken,
      ...(refreshToken === undefined ? {} : { refreshToken })
    })
  } catch {
    return undefined
  }
}

type OptionalCredentialHandle =
  | { readonly _tag: "None" }
  | { readonly _tag: "Some"; readonly value: AuthorizationCredentialHandle }

const snapshotOptionalCredentialHandle = (value: unknown): OptionalCredentialHandle | undefined => {
  try {
    if (typeof value !== "object" || value === null || !Option.isOption(value)) return undefined
    const prototype = Reflect.getPrototypeOf(value)
    if (typeof prototype !== "object" || prototype === null) return undefined
    const tagDescriptor = Reflect.getOwnPropertyDescriptor(prototype, "_tag")
    if (tagDescriptor === undefined || !("value" in tagDescriptor)) return undefined
    const valueDescriptor = Reflect.getOwnPropertyDescriptor(value, "value")
    if (tagDescriptor.value === "None") {
      return valueDescriptor === undefined ? Object.freeze({ _tag: "None" }) : undefined
    }
    if (tagDescriptor.value !== "Some" || valueDescriptor === undefined ||
      !("value" in valueDescriptor) || !opaqueHandle(valueDescriptor.value)) return undefined
    return Object.freeze({
      _tag: "Some",
      value: valueDescriptor.value as AuthorizationCredentialHandle
    })
  } catch {
    return undefined
  }
}

interface TokenResponseSnapshot {
  readonly accessToken: Redacted.Redacted<string>
  readonly tokenType: string
  readonly refreshToken?: Redacted.Redacted<string>
  readonly scopes: AuthorizationScopeSet
  readonly expiresAt?: number
}

const responseString = (
  value: Record<string, unknown>,
  key: string,
  required: boolean,
  maximum: number
): string | undefined => {
  const raw = ownDataValue(value, key)
  if (raw === undefined && !required) return undefined
  return boundedString(raw, maximum) ? raw : undefined
}

const parseResponseScopes = (
  raw: unknown,
  required: AuthorizationScopeSet
): AuthorizationScopeSet | undefined => {
  if (raw === undefined) return required
  if (!boundedString(raw, 64 * 1024)) return undefined
  const parts = raw.split(" ")
  if (parts.length === 0 || parts.some((part) => part.length === 0)) return undefined
  const scopes = snapshotScopes(parts)
  if (scopes === undefined) return undefined
  const granted = new Set<string>(scopes)
  return required.every((scope) => granted.has(scope)) ? scopes : undefined
}

const computeExpiration = (raw: unknown, receivedAt: number | undefined): number | undefined | null => {
  if (raw === undefined) return undefined
  if (!Number.isSafeInteger(raw) || (raw as number) < 0 || receivedAt === undefined ||
    !Number.isSafeInteger(receivedAt) || receivedAt < 0) return null
  const duration = (raw as number) * 1000
  if (!Number.isSafeInteger(duration) || duration > Number.MAX_SAFE_INTEGER - receivedAt) return null
  return receivedAt + duration
}

const snapshotTokenResponse = (
  value: Record<string, unknown>,
  requiredScopes: AuthorizationScopeSet,
  receivedAt: number | undefined
): TokenResponseSnapshot | undefined => {
  try {
    const accessToken = responseString(value, "access_token", true, 16 * 1024)
    const tokenType = bearerTokenType(responseString(value, "token_type", true, 128))
    const rawRefresh = ownDataValue(value, "refresh_token")
    const refreshToken = responseString(value, "refresh_token", false, 16 * 1024)
    const scopes = parseResponseScopes(ownDataValue(value, "scope"), requiredScopes)
    const expiresAt = computeExpiration(ownDataValue(value, "expires_in"), receivedAt)
    if (accessToken === undefined || tokenType === undefined ||
      rawRefresh !== undefined && refreshToken === undefined || scopes === undefined ||
      expiresAt === null) return undefined
    return Object.freeze({
      accessToken: Redacted.make(accessToken),
      tokenType,
      ...(refreshToken === undefined ? {} : { refreshToken: Redacted.make(refreshToken) }),
      scopes,
      ...(expiresAt === undefined ? {} : { expiresAt })
    })
  } catch {
    return undefined
  }
}

const metadataTokenEndpoint = (
  metadata: AuthorizationServerMetadata,
  issuer: string
): string | undefined => {
  try {
    const metadataIssuer = ownDataValue(metadata, "issuer")
    const endpoint = ownDataValue(metadata, "tokenEndpoint")
    return metadataIssuer === issuer && isSafeHttpsIssuer(issuer) && isSafeHttpsEndpoint(endpoint)
      ? endpoint
      : undefined
  } catch {
    return undefined
  }
}

const appendClientAuthentication = (
  entries: Array<readonly [string, string]>,
  credential: CredentialSnapshot
): void => {
  entries.push(["client_id", credential.clientId])
  if (credential.clientSecret !== undefined) {
    entries.push(["client_secret", Redacted.value(credential.clientSecret)])
  }
}

const requestToken = (
  endpoint: string,
  entries: ReadonlyArray<readonly [string, string]>,
  failureReason: "TokenExchangeFailed" | "TokenRefreshFailed",
  requiredScopes: AuthorizationScopeSet,
  receivedAt: number | undefined
) => Effect.gen(function*() {
  if (receivedAt !== undefined && (!Number.isSafeInteger(receivedAt) || receivedAt < 0)) {
    return yield* Effect.fail(protocolFailure(failureReason))
  }
  const form = encodeForm(entries)
  const body = form === undefined ? undefined : encodeUtf8(form, 128 * 1024)
  if (body === undefined) return yield* Effect.fail(protocolFailure(failureReason))
  const http = yield* AuthorizationHttpClient
  const rawReply = yield* http.request({
    method: "POST",
    url: endpoint,
    headers: [["content-type", Redacted.make("application/x-www-form-urlencoded")]],
    body: Redacted.make(body)
  })
  const reply = snapshotHttpReply(rawReply)
  if (reply._tag === "Failure") return yield* Effect.fail(protocolFailure(failureReason))
  if (reply.value.status < 200 || reply.value.status >= 300) {
    return yield* Effect.fail(protocolFailure(failureReason, reply.value.status))
  }
  const json = decodeJsonObject(reply.value.body)
  if (json._tag === "Failure") return yield* Effect.fail(protocolFailure(failureReason))
  const rawExpiresIn = ownDataValue(json.value, "expires_in")
  let effectiveReceivedAt = receivedAt
  if (rawExpiresIn !== undefined && effectiveReceivedAt === undefined) {
    const providedClock = yield* Effect.serviceOption(Clock.Clock)
    effectiveReceivedAt = Option.isSome(providedClock)
      ? yield* providedClock.value.currentTimeMillis
      : yield* Clock.currentTimeMillis
  }
  const response = snapshotTokenResponse(json.value, requiredScopes, effectiveReceivedAt)
  return response === undefined
    ? yield* Effect.fail(protocolFailure(failureReason))
    : response
})

const validateTokenAudience = (
  validateAudience: TokenAudienceValidator,
  token: Redacted.Redacted<string>,
  issuer: string,
  resource: string
) => Effect.gen(function*() {
  const rawAudiences = yield* validateAudience(Object.freeze({ token, issuer, resource }))
  const snapshot = snapshotDenseAuthorizationArray(rawAudiences, 1, 64)
  if (snapshot._tag === "Failure") return yield* Effect.fail(protocolFailure("AudienceMismatch"))
  const audiences: Array<string> = []
  for (const audience of snapshot.values) {
    if (!boundedString(audience, 2048)) {
      return yield* Effect.fail(protocolFailure("AudienceMismatch"))
    }
    audiences.push(audience)
  }
  if (!audiences.includes(resource)) return yield* Effect.fail(protocolFailure("AudienceMismatch"))
  return Object.freeze(audiences)
})

const saveTokenGrant = (
  credential: CredentialSnapshot,
  issuer: string,
  resource: string,
  response: TokenResponseSnapshot,
  refreshToken: Redacted.Redacted<string> | undefined,
  failureReason: "TokenExchangeFailed" | "TokenRefreshFailed"
) => Effect.gen(function*() {
  const store = yield* AuthorizationClientStore
  const handle = yield* store.saveGrant(Object.freeze({
    issuer,
    resource,
    clientId: credential.clientId,
    scopes: response.scopes,
    tokenType: response.tokenType,
    accessToken: response.accessToken,
    ...(refreshToken === undefined ? {} : { refreshToken }),
    ...(response.expiresAt === undefined ? {} : { expiresAt: response.expiresAt })
  } satisfies StoredAuthorizationGrant))
  return opaqueHandle(handle)
    ? handle
    : yield* Effect.fail(protocolFailure(failureReason))
})

export const exchangeAuthorizationCode = (input: ExchangeAuthorizationCodeInput) =>
  Effect.gen(function*() {
    const authorization = snapshotAuthorization(input.authorization)
    if (authorization === undefined) {
      return yield* Effect.fail(protocolFailure("TokenExchangeFailed"))
    }
    const endpoint = metadataTokenEndpoint(input.authorizationServerMetadata, authorization.issuer)
    if (endpoint === undefined) return yield* Effect.fail(protocolFailure("IssuerMismatch"))
    const store = yield* AuthorizationClientStore
    const credential = snapshotCredential(yield* store.readCredential(authorization.credentialHandle))
    if (credential === undefined || credential.issuer !== authorization.issuer) {
      return yield* Effect.fail(protocolFailure("CredentialIssuerMismatch"))
    }
    const entries: Array<readonly [string, string]> = [
      ["grant_type", "authorization_code"],
      ["code", Redacted.value(authorization.authorizationCode)],
      ["code_verifier", Redacted.value(authorization.codeVerifier)],
      ["redirect_uri", authorization.redirectUri],
      ["resource", authorization.resource]
    ]
    appendClientAuthentication(entries, credential)
    const response = yield* requestToken(
      endpoint,
      entries,
      "TokenExchangeFailed",
      authorization.scopes,
      input.receivedAt
    )
    yield* validateTokenAudience(
      input.validateAudience,
      response.accessToken,
      authorization.issuer,
      authorization.resource
    )
    return yield* saveTokenGrant(
      credential,
      authorization.issuer,
      authorization.resource,
      response,
      response.refreshToken,
      "TokenExchangeFailed"
    )
  })

export const refreshAuthorizationGrant = (input: RefreshAuthorizationGrantInput) =>
  Effect.gen(function*() {
    if (!opaqueHandle(input.grant)) return yield* Effect.fail(protocolFailure("TokenRefreshFailed"))
    const store = yield* AuthorizationClientStore
    const grant = snapshotGrant(yield* store.readGrant(input.grant))
    if (grant === undefined) return yield* Effect.fail(protocolFailure("TokenRefreshFailed"))
    const endpoint = metadataTokenEndpoint(input.authorizationServerMetadata, grant.issuer)
    if (endpoint === undefined) return yield* Effect.fail(protocolFailure("IssuerMismatch"))
    if (grant.refreshToken === undefined) {
      return yield* Effect.fail(protocolFailure("TokenRefreshFailed"))
    }
    const found = snapshotOptionalCredentialHandle(yield* store.findCredential({
      issuer: grant.issuer,
      clientId: grant.clientId
    }))
    if (found === undefined || found._tag === "None") {
      return yield* Effect.fail(protocolFailure("CredentialMissing"))
    }
    const credential = snapshotCredential(yield* store.readCredential(found.value))
    if (credential === undefined || credential.issuer !== grant.issuer ||
      credential.clientId !== grant.clientId) {
      return yield* Effect.fail(protocolFailure("CredentialIssuerMismatch"))
    }
    const entries: Array<readonly [string, string]> = [
      ["grant_type", "refresh_token"],
      ["refresh_token", Redacted.value(grant.refreshToken)],
      ["resource", grant.resource]
    ]
    appendClientAuthentication(entries, credential)
    const response = yield* requestToken(
      endpoint,
      entries,
      "TokenRefreshFailed",
      grant.scopes,
      input.receivedAt
    )
    yield* validateTokenAudience(
      input.validateAudience,
      response.accessToken,
      grant.issuer,
      grant.resource
    )
    return yield* saveTokenGrant(
      credential,
      grant.issuer,
      grant.resource,
      response,
      response.refreshToken ?? grant.refreshToken,
      "TokenRefreshFailed"
    )
  })

export const exchangeAuthorizationCallback = (input: ExchangeAuthorizationCallbackInput) =>
  Effect.gen(function*() {
    const authorization = yield* completeAuthorizationCallback({
      callback: input.callback,
      authorizationServerMetadata: input.authorizationServerMetadata
    })
    return yield* exchangeAuthorizationCode({
      authorization,
      authorizationServerMetadata: input.authorizationServerMetadata,
      validateAudience: input.validateAudience,
      ...(input.receivedAt === undefined ? {} : { receivedAt: input.receivedAt })
    })
  })
