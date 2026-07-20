import * as Effect from "effect/Effect"
import * as Option from "effect/Option"
import * as Redacted from "effect/Redacted"
import type {
  AuthorizationCredentialHandle,
  AuthorizationScopeSet,
  AuthorizationServerMetadata
} from "../common.js"
import { snapshotDenseAuthorizationArray } from "../common.js"
import { AuthorizationProtocolError } from "./errors.js"
import { decodeJsonObject, encodeJsonObject, snapshotHttpReply } from "./json.js"
import type { StoredAuthorizationCredential } from "./models.js"
import { AuthorizationClientStore, AuthorizationHttpClient } from "./services.js"
import {
  isSafeClientMetadataIdentifier,
  isSafeHttpsEndpoint,
  isSafeHttpsIssuer,
  isSafeRedirectIdentifier,
  parseAuthorizationUri
} from "./uri.js"

export interface PreRegisteredAuthorizationCredential {
  readonly issuer: string
  readonly clientId: string
  readonly tokenEndpointAuthMethod?: "none" | "client_secret_post" | "client_secret_basic"
  readonly clientSecret?: Redacted.Redacted<string>
  readonly registrationAccessToken?: Redacted.Redacted<string>
}

export interface AuthorizationResolutionConfiguration {
  readonly clientName: string
  readonly redirectUris: ReadonlyArray<string>
  readonly preRegisteredCredentials: ReadonlyArray<PreRegisteredAuthorizationCredential>
  readonly clientIdMetadataDocument?: string
  readonly tokenEndpointAuthMethod?: "none" | "client_secret_post" | "client_secret_basic"
  readonly grantTypes?: ReadonlyArray<string>
  readonly responseTypes?: ReadonlyArray<string>
}

export interface ResolveAuthorizationCredentialInput {
  readonly issuer: string
  readonly authorizationServerMetadata: AuthorizationServerMetadata
  readonly selectedCredentialHandle?: AuthorizationCredentialHandle
  readonly scopes: AuthorizationScopeSet
  readonly configuration: AuthorizationResolutionConfiguration
}

export interface AuthorizationResolutionConfigurationSnapshot {
  readonly clientName: string
  readonly redirectUris: ReadonlyArray<string>
  readonly preRegisteredCredentials: ReadonlyArray<PreRegisteredAuthorizationCredential>
  readonly clientIdMetadataDocument?: string
  readonly tokenEndpointAuthMethod?: "none" | "client_secret_post" | "client_secret_basic"
  readonly grantTypes?: ReadonlyArray<string>
  readonly responseTypes?: ReadonlyArray<string>
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
  if (descriptor === undefined) return undefined
  if (!("value" in descriptor)) throw new TypeError("Invalid configuration")
  return descriptor.value
}

const boundedText = (value: unknown, maximum: number, allowEmpty = false): value is string =>
  typeof value === "string" && (allowEmpty || value.length > 0) && value.length <= maximum &&
  !/[\u0000-\u001f\u007f-\u009f]/.test(value)

const isRedactedBoundedText = (value: unknown, maximum: number): boolean => {
  if (!Redacted.isRedacted(value)) return false
  try {
    return boundedText(Redacted.value(value), maximum)
  } catch {
    return false
  }
}

const snapshotStringArray = (
  value: unknown,
  minimumLength: number
): ReadonlyArray<string> | undefined => {
  const snapshot = snapshotDenseAuthorizationArray(value, minimumLength, 64)
  if (snapshot._tag === "Failure") return undefined
  const output: Array<string> = []
  for (const item of snapshot.values) {
    if (!boundedText(item, 256)) return undefined
    output.push(item)
  }
  return Object.freeze(output)
}

const snapshotPreRegistrations = (
  value: unknown
): ReadonlyArray<PreRegisteredAuthorizationCredential> | undefined => {
  const snapshot = snapshotDenseAuthorizationArray(value, 0, 4096)
  if (snapshot._tag === "Failure") return undefined
  const output: Array<PreRegisteredAuthorizationCredential> = []
  try {
    for (const item of snapshot.values) {
      if (typeof item !== "object" || item === null) return undefined
      Reflect.ownKeys(item)
      const issuer = ownDataValue(item, "issuer")
      const clientId = ownDataValue(item, "clientId")
      const tokenEndpointAuthMethod = ownDataValue(item, "tokenEndpointAuthMethod")
      const clientSecret = ownDataValue(item, "clientSecret")
      const registrationAccessToken = ownDataValue(item, "registrationAccessToken")
      if (!isSafeHttpsIssuer(issuer) || !boundedText(clientId, 2048) ||
        tokenEndpointAuthMethod !== undefined && tokenEndpointAuthMethod !== "none" &&
          tokenEndpointAuthMethod !== "client_secret_post" &&
          tokenEndpointAuthMethod !== "client_secret_basic" ||
        clientSecret !== undefined && !isRedactedBoundedText(clientSecret, 16384) ||
        registrationAccessToken !== undefined &&
          !isRedactedBoundedText(registrationAccessToken, 16384)) {
        return undefined
      }
      output.push(Object.freeze({
        issuer,
        clientId,
        ...(tokenEndpointAuthMethod === undefined ? {} : { tokenEndpointAuthMethod }),
        ...(clientSecret === undefined
          ? {}
          : { clientSecret: clientSecret as Redacted.Redacted<string> }),
        ...(registrationAccessToken === undefined
          ? {}
          : { registrationAccessToken: registrationAccessToken as Redacted.Redacted<string> })
      }))
    }
    return Object.freeze(output)
  } catch {
    return undefined
  }
}

export const snapshotAuthorizationResolutionConfiguration = (
  value: unknown
): AuthorizationResolutionConfigurationSnapshot | undefined => {
  try {
    if (typeof value !== "object" || value === null) return undefined
    Reflect.ownKeys(value)
    const clientName = ownDataValue(value, "clientName")
    const rawRedirects = snapshotDenseAuthorizationArray(ownDataValue(value, "redirectUris"), 1, 64)
    const preRegisteredCredentials = snapshotPreRegistrations(
      ownDataValue(value, "preRegisteredCredentials")
    )
    if (!boundedText(clientName, 512) || rawRedirects._tag === "Failure" ||
      preRegisteredCredentials === undefined) return undefined
    const redirectUris: Array<string> = []
    for (const redirect of rawRedirects.values) {
      if (!isSafeRedirectIdentifier(redirect)) return undefined
      redirectUris.push(redirect)
    }
    const clientIdMetadataDocument = ownDataValue(value, "clientIdMetadataDocument")
    if (clientIdMetadataDocument !== undefined &&
      !isSafeClientMetadataIdentifier(clientIdMetadataDocument)) return undefined
    const tokenEndpointAuthMethod = ownDataValue(value, "tokenEndpointAuthMethod")
    if (tokenEndpointAuthMethod !== undefined && tokenEndpointAuthMethod !== "none" &&
      tokenEndpointAuthMethod !== "client_secret_post" &&
      tokenEndpointAuthMethod !== "client_secret_basic") {
      return undefined
    }
    const rawGrantTypes = ownDataValue(value, "grantTypes")
    const grantTypes = rawGrantTypes === undefined ? undefined : snapshotStringArray(rawGrantTypes, 1)
    if (rawGrantTypes !== undefined && grantTypes === undefined) return undefined
    const rawResponseTypes = ownDataValue(value, "responseTypes")
    const responseTypes = rawResponseTypes === undefined
      ? undefined
      : snapshotStringArray(rawResponseTypes, 1)
    if (rawResponseTypes !== undefined && responseTypes === undefined) return undefined
    const output: AuthorizationResolutionConfigurationSnapshot = Object.freeze({
      clientName,
      redirectUris: Object.freeze(redirectUris),
      preRegisteredCredentials,
      ...(clientIdMetadataDocument === undefined ? {} : { clientIdMetadataDocument }),
      ...(tokenEndpointAuthMethod === undefined ? {} : { tokenEndpointAuthMethod }),
      ...(grantTypes === undefined ? {} : { grantTypes }),
      ...(responseTypes === undefined ? {} : { responseTypes })
    })
    return output
  } catch {
    return undefined
  }
}

const validateStoredIssuer = (
  issuer: string,
  credential: StoredAuthorizationCredential
): Effect.Effect<void, AuthorizationProtocolError> => credential.issuer === issuer
  ? Effect.void
  : Effect.fail(protocolFailure("CredentialIssuerMismatch"))

const readAndValidateCredential = (
  issuer: string,
  handle: AuthorizationCredentialHandle
) => Effect.gen(function*() {
  const store = yield* AuthorizationClientStore
  const credential = yield* store.readCredential(handle)
  yield* validateStoredIssuer(issuer, credential)
  return handle
})

const isNativeRedirect = (value: string): boolean => {
  const parsed = parseAuthorizationUri(value)
  return parsed._tag === "Success" && parsed.value.loopback
}

const registrationString = (
  source: Record<string, unknown>,
  key: string,
  required: boolean,
  maximum: number
): string | undefined => {
  const value = ownDataValue(source, key)
  if (value === undefined && !required) return undefined
  return boundedText(value, maximum) ? value : undefined
}

export const resolveAuthorizationCredential = (
  input: ResolveAuthorizationCredentialInput
) => Effect.gen(function*() {
  const configuration = snapshotAuthorizationResolutionConfiguration(input.configuration)
  if (configuration === undefined || !isSafeHttpsIssuer(input.issuer) ||
    input.authorizationServerMetadata.issuer !== input.issuer) {
    return yield* Effect.fail(protocolFailure("InvalidConfiguration"))
  }
  if (!isSafeHttpsEndpoint(input.authorizationServerMetadata.tokenEndpoint) ||
    input.authorizationServerMetadata.authorizationEndpoint !== undefined &&
      !isSafeHttpsEndpoint(input.authorizationServerMetadata.authorizationEndpoint) ||
    input.authorizationServerMetadata.registrationEndpoint !== undefined &&
      !isSafeHttpsEndpoint(input.authorizationServerMetadata.registrationEndpoint)) {
    return yield* Effect.fail(protocolFailure("UnsupportedAuthorizationServer"))
  }
  const store = yield* AuthorizationClientStore
  const configured = configuration.preRegisteredCredentials.find(
    (credential) => credential.issuer === input.issuer
  )
  if (configured !== undefined) {
    const tokenEndpointAuthMethod = configured.tokenEndpointAuthMethod ??
      configuration.tokenEndpointAuthMethod ??
      (configured.clientSecret === undefined ? "none" : "client_secret_post")
    return yield* store.saveCredential({
      issuer: input.issuer,
      clientId: configured.clientId,
      tokenEndpointAuthMethod,
      ...(configured.clientSecret === undefined ? {} : { clientSecret: configured.clientSecret }),
      ...(configured.registrationAccessToken === undefined
        ? {}
        : { registrationAccessToken: configured.registrationAccessToken })
    })
  }
  if (input.selectedCredentialHandle !== undefined) {
    return yield* readAndValidateCredential(input.issuer, input.selectedCredentialHandle)
  }
  const found = yield* store.findCredential({ issuer: input.issuer })
  if (Option.isSome(found)) return yield* readAndValidateCredential(input.issuer, found.value)

  if (input.authorizationServerMetadata.clientIdMetadataDocumentSupported === true &&
    configuration.clientIdMetadataDocument !== undefined) {
    const credential: StoredAuthorizationCredential = {
      issuer: input.issuer,
      clientId: configuration.clientIdMetadataDocument
    }
    Object.defineProperty(credential, "tokenEndpointAuthMethod", {
      configurable: false,
      enumerable: false,
      value: "none",
      writable: false
    })
    return yield* store.saveCredential(credential)
  }

  const registrationEndpoint = input.authorizationServerMetadata.registrationEndpoint
  if (registrationEndpoint === undefined) {
    return yield* Effect.fail(protocolFailure("UnsupportedRegistration"))
  }
  const bodyValue: Record<string, unknown> = {
    client_name: configuration.clientName,
    redirect_uris: configuration.redirectUris,
    token_endpoint_auth_method: configuration.tokenEndpointAuthMethod ?? "none",
    grant_types: configuration.grantTypes ?? ["authorization_code", "refresh_token"],
    response_types: configuration.responseTypes ?? ["code"],
    ...(input.scopes.length === 0 ? {} : { scope: input.scopes.join(" ") }),
    application_type: configuration.redirectUris.some(isNativeRedirect) ? "native" : "web"
  }
  const encoded = encodeJsonObject(bodyValue)
  if (encoded._tag === "Failure") {
    return yield* Effect.fail(protocolFailure("RegistrationFailed"))
  }
  const http = yield* AuthorizationHttpClient
  const rawReply = yield* http.request({
    method: "POST",
    url: registrationEndpoint,
    headers: [["content-type", Redacted.make("application/json")]],
    body: encoded.value
  })
  const reply = snapshotHttpReply(rawReply)
  if (reply._tag === "Failure") {
    return yield* Effect.fail(protocolFailure("RegistrationFailed"))
  }
  if (reply.value.status < 200 || reply.value.status >= 300) {
    return yield* Effect.fail(protocolFailure("RegistrationFailed", reply.value.status))
  }
  const json = decodeJsonObject(reply.value.body)
  if (json._tag === "Failure") {
    return yield* Effect.fail(protocolFailure("RegistrationFailed"))
  }
  const clientId = registrationString(json.value, "client_id", true, 2048)
  const clientSecret = registrationString(json.value, "client_secret", false, 16384)
  const registrationAccessToken = registrationString(
    json.value,
    "registration_access_token",
    false,
    16384
  )
  if (clientId === undefined ||
    ownDataValue(json.value, "client_secret") !== undefined && clientSecret === undefined ||
    ownDataValue(json.value, "registration_access_token") !== undefined &&
      registrationAccessToken === undefined) {
    return yield* Effect.fail(protocolFailure("RegistrationFailed"))
  }
  return yield* store.saveCredential({
    issuer: input.issuer,
    clientId,
    tokenEndpointAuthMethod: configuration.tokenEndpointAuthMethod ?? "none",
    ...(clientSecret === undefined ? {} : { clientSecret: Redacted.make(clientSecret) }),
    ...(registrationAccessToken === undefined
      ? {}
      : { registrationAccessToken: Redacted.make(registrationAccessToken) })
  })
})
