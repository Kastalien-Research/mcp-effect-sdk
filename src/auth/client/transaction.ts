import * as Effect from "effect/Effect"
import * as Redacted from "effect/Redacted"
import type {
  AuthorizationCallbackInput,
  AuthorizationCredentialHandle,
  AuthorizationScope,
  AuthorizationScopeSet,
  AuthorizationServerMetadata,
  AuthorizationTransactionHandle
} from "../common.js"
import { snapshotDenseAuthorizationArray } from "../common.js"
import {
  AuthorizationCryptoError,
  AuthorizationProtocolError,
  type AuthorizationStoreError
} from "./errors.js"
import {
  decodeForm,
  encodeBase64Url,
  encodeForm,
  encodeUtf8,
  snapshotExactBytes
} from "./encoding.js"
import type {
  StoredAuthorizationCredential,
  StoredAuthorizationTransaction
} from "./models.js"
import {
  AuthorizationClientStore,
  AuthorizationCrypto,
  AuthorizationInteraction
} from "./services.js"
import {
  type AuthorizationEndpointPolicy,
  isAllowedAuthorizationEndpoint,
  isAllowedAuthorizationIssuer,
  isAllowedProtectedResource,
  isAuthorizationEndpointPolicy,
  isSafeRedirectIdentifier,
  parseAuthorizationUri
} from "./uri.js"

export interface StartAuthorizationTransactionInput {
  readonly authorizationServerMetadata: AuthorizationServerMetadata
  readonly issuer: string
  readonly canonicalResource: string
  readonly credentialHandle: AuthorizationCredentialHandle
  readonly scopes: AuthorizationScopeSet
  readonly redirectUri: string
  readonly createdAt: number
  readonly endpointPolicy?: AuthorizationEndpointPolicy
}

export interface StartedAuthorizationTransaction {
  readonly transaction: AuthorizationTransactionHandle
  readonly authorizationUri: Redacted.Redacted<string>
}

export interface CompleteAuthorizationCallbackInput {
  readonly callback: AuthorizationCallbackInput
  readonly authorizationServerMetadata: AuthorizationServerMetadata
  readonly endpointPolicy?: AuthorizationEndpointPolicy
}

export interface CompletedAuthorizationCode {
  readonly issuer: string
  readonly resource: string
  readonly credentialHandle: AuthorizationCredentialHandle
  readonly clientId: string
  readonly redirectUri: string
  readonly scopes: AuthorizationScopeSet
  readonly authorizationCode: Redacted.Redacted<string>
  readonly codeVerifier: Redacted.Redacted<string>
}

const protocolFailure = (
  reason: ConstructorParameters<typeof AuthorizationProtocolError>[0]["reason"]
): AuthorizationProtocolError => new AuthorizationProtocolError({ reason })

const cryptoFailure = (
  operation: "randomBytes" | "sha256"
): AuthorizationCryptoError => new AuthorizationCryptoError({ operation, reason: "Failed" })

const ownDataValue = (source: object, key: PropertyKey): unknown => {
  const descriptor = Reflect.getOwnPropertyDescriptor(source, key)
  if (descriptor === undefined || !("value" in descriptor)) return undefined
  return descriptor.value
}

const boundedString = (value: unknown, maximum: number, allowEmpty = false): value is string =>
  typeof value === "string" && (allowEmpty || value.length > 0) && value.length <= maximum &&
  !/[\u0000-\u001f\u007f-\u009f]/.test(value)

const opaqueHandle = (value: unknown): value is string => boundedString(value, 4096)

const generatedSecret = (value: unknown): value is string =>
  typeof value === "string" && /^[A-Za-z0-9_-]{43}$/.test(value)

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

const snapshotCredential = (
  value: unknown,
  endpointPolicy: AuthorizationEndpointPolicy
): StoredAuthorizationCredential | undefined => {
  try {
    if (typeof value !== "object" || value === null) return undefined
    const issuer = ownDataValue(value, "issuer")
    const clientId = ownDataValue(value, "clientId")
    if (!isAllowedAuthorizationIssuer(issuer, endpointPolicy) ||
      !boundedString(clientId, 2048)) return undefined
    return Object.freeze({ issuer, clientId })
  } catch {
    return undefined
  }
}

interface StoredTransactionSnapshot {
  readonly issuer: string
  readonly resource: string
  readonly credentialHandle: AuthorizationCredentialHandle
  readonly clientId: string
  readonly authorizationResponseIssParameterRequired: boolean
  readonly redirectUri: string
  readonly scopes: AuthorizationScopeSet
  readonly state: Redacted.Redacted<string>
  readonly codeVerifier: Redacted.Redacted<string>
}

const snapshotStoredTransaction = (
  value: unknown,
  endpointPolicy: AuthorizationEndpointPolicy
): StoredTransactionSnapshot | undefined => {
  try {
    if (typeof value !== "object" || value === null) return undefined
    const issuer = ownDataValue(value, "issuer")
    const resource = ownDataValue(value, "resource")
    const credentialHandle = ownDataValue(value, "credentialHandle")
    const clientId = ownDataValue(value, "clientId")
    const responseIssRequired = ownDataValue(value, "authorizationResponseIssParameterRequired")
    const redirectUri = ownDataValue(value, "redirectUri")
    const scopes = snapshotScopes(ownDataValue(value, "scopes"))
    const state = redactedString(ownDataValue(value, "state"), 43)
    const codeVerifier = redactedString(ownDataValue(value, "codeVerifier"), 43)
    if (!boundedString(resource, 2048)) return undefined
    const parsedResource = parseAuthorizationUri(resource)
    if (!isAllowedAuthorizationIssuer(issuer, endpointPolicy) ||
      parsedResource._tag === "Failure" || !isAllowedProtectedResource(resource, endpointPolicy) ||
      !opaqueHandle(credentialHandle) || !isSafeRedirectIdentifier(redirectUri) ||
      scopes === undefined || state === undefined || codeVerifier === undefined ||
      !generatedSecret(Redacted.value(state)) || !generatedSecret(Redacted.value(codeVerifier)) ||
      !boundedString(clientId, 2048) || typeof responseIssRequired !== "boolean") return undefined
    return Object.freeze({
      issuer,
      resource,
      credentialHandle: credentialHandle as AuthorizationCredentialHandle,
      clientId,
      authorizationResponseIssParameterRequired: responseIssRequired,
      redirectUri,
      scopes,
      state,
      codeVerifier
    })
  } catch {
    return undefined
  }
}

interface CallbackSnapshot {
  readonly transaction: AuthorizationTransactionHandle
  readonly redirectUri: string
  readonly parameters: string
}

const snapshotCallbackHandle = (value: unknown): AuthorizationTransactionHandle | undefined => {
  try {
    if (typeof value !== "object" || value === null) return undefined
    const transaction = ownDataValue(value, "transaction")
    return opaqueHandle(transaction) ? transaction as AuthorizationTransactionHandle : undefined
  } catch {
    return undefined
  }
}

const snapshotCallback = (value: unknown): CallbackSnapshot | undefined => {
  try {
    if (typeof value !== "object" || value === null) return undefined
    const transaction = ownDataValue(value, "transaction")
    const redirectUri = ownDataValue(value, "redirectUri")
    const parameters = redactedString(ownDataValue(value, "parameters"), 64 * 1024)
    if (!opaqueHandle(transaction) || !isSafeRedirectIdentifier(redirectUri) ||
      parameters === undefined) return undefined
    return Object.freeze({
      transaction: transaction as AuthorizationTransactionHandle,
      redirectUri,
      parameters: Redacted.value(parameters)
    })
  } catch {
    return undefined
  }
}

interface StartSnapshot {
  readonly authorizationServerMetadata: AuthorizationServerMetadata
  readonly issuer: string
  readonly canonicalResource: string
  readonly credentialHandle: AuthorizationCredentialHandle
  readonly scopes: AuthorizationScopeSet
  readonly redirectUri: string
  readonly createdAt: number
  readonly authorizationEndpoint: string
  readonly authorizationResponseIssParameterRequired: boolean
  readonly endpointPolicy: AuthorizationEndpointPolicy
}

const snapshotStartInput = (value: unknown): StartSnapshot | undefined => {
  try {
    if (typeof value !== "object" || value === null) return undefined
    const metadata = ownDataValue(value, "authorizationServerMetadata")
    const issuer = ownDataValue(value, "issuer")
    const canonicalResource = ownDataValue(value, "canonicalResource")
    const credentialHandle = ownDataValue(value, "credentialHandle")
    const scopes = snapshotScopes(ownDataValue(value, "scopes"))
    const redirectUri = ownDataValue(value, "redirectUri")
    const createdAt = ownDataValue(value, "createdAt")
    const endpointPolicy = ownDataValue(value, "endpointPolicy") ?? "https-only"
    if (typeof metadata !== "object" || metadata === null ||
      !isAuthorizationEndpointPolicy(endpointPolicy) ||
      !isAllowedAuthorizationIssuer(issuer, endpointPolicy) ||
      !boundedString(canonicalResource, 2048) || !opaqueHandle(credentialHandle) ||
      scopes === undefined || !isSafeRedirectIdentifier(redirectUri) ||
      !Number.isSafeInteger(createdAt) || (createdAt as number) < 0) return undefined
    const metadataIssuer = ownDataValue(metadata, "issuer")
    const authorizationEndpoint = ownDataValue(metadata, "authorizationEndpoint")
    const responseIssRequired = ownDataValue(
      metadata,
      "authorizationResponseIssParameterSupported"
    )
    const resource = parseAuthorizationUri(canonicalResource)
    if (metadataIssuer !== issuer ||
      !isAllowedAuthorizationEndpoint(authorizationEndpoint, endpointPolicy) ||
      resource._tag === "Failure" ||
      !isAllowedProtectedResource(canonicalResource, endpointPolicy) ||
      responseIssRequired !== undefined && typeof responseIssRequired !== "boolean") return undefined
    return Object.freeze({
      authorizationServerMetadata: metadata as AuthorizationServerMetadata,
      issuer,
      canonicalResource,
      credentialHandle: credentialHandle as AuthorizationCredentialHandle,
      scopes,
      redirectUri,
      createdAt: createdAt as number,
      authorizationEndpoint,
      endpointPolicy,
      authorizationResponseIssParameterRequired: responseIssRequired === true
    })
  } catch {
    return undefined
  }
}

const supportsS256 = (metadata: AuthorizationServerMetadata): boolean => {
  try {
    const methods = snapshotDenseAuthorizationArray(
      ownDataValue(metadata, "codeChallengeMethodsSupported"),
      1,
      64
    )
    return methods._tag === "Success" && methods.values.every(
      (method) => boundedString(method, 128)
    ) && methods.values.includes("S256")
  } catch {
    return false
  }
}

const constantTimeEqual = (left: string, right: string): boolean => {
  let difference = left.length ^ right.length
  const length = Math.max(left.length, right.length)
  for (let index = 0; index < length; index += 1) {
    difference |= (left.charCodeAt(index) || 0) ^ (right.charCodeAt(index) || 0)
  }
  return difference === 0
}

export const startAuthorizationTransaction = (input: StartAuthorizationTransactionInput) =>
  Effect.gen(function*() {
    const snapshot = snapshotStartInput(input)
    if (snapshot === undefined) {
      return yield* Effect.fail(protocolFailure("InvalidConfiguration"))
    }
    if (!supportsS256(snapshot.authorizationServerMetadata)) {
      return yield* Effect.fail(protocolFailure("UnsupportedAuthorizationServer"))
    }
    const store = yield* AuthorizationClientStore
    const rawCredential = yield* store.readCredential(snapshot.credentialHandle)
    const credential = snapshotCredential(rawCredential, snapshot.endpointPolicy)
    if (credential === undefined || credential.issuer !== snapshot.issuer) {
      return yield* Effect.fail(protocolFailure("CredentialIssuerMismatch"))
    }

    const crypto = yield* AuthorizationCrypto
    const stateBytes = snapshotExactBytes(yield* crypto.randomBytes(32), 32)
    if (stateBytes === undefined) return yield* Effect.fail(cryptoFailure("randomBytes"))
    const verifierBytes = snapshotExactBytes(yield* crypto.randomBytes(32), 32)
    if (verifierBytes === undefined) return yield* Effect.fail(cryptoFailure("randomBytes"))
    const state = encodeBase64Url(stateBytes)
    const verifier = encodeBase64Url(verifierBytes)
    const verifierUtf8 = encodeUtf8(verifier, 128)
    if (verifierUtf8 === undefined) return yield* Effect.fail(cryptoFailure("sha256"))
    const challengeBytes = snapshotExactBytes(yield* crypto.sha256(verifierUtf8), 32)
    if (challengeBytes === undefined) return yield* Effect.fail(cryptoFailure("sha256"))
    const queryEntries: Array<readonly [string, string]> = [
      ["response_type", "code"],
      ["client_id", credential.clientId],
      ["redirect_uri", snapshot.redirectUri],
      ["state", state],
      ["code_challenge", encodeBase64Url(challengeBytes)],
      ["code_challenge_method", "S256"],
      ["resource", snapshot.canonicalResource]
    ]
    if (snapshot.scopes.length > 0) queryEntries.splice(3, 0, ["scope", snapshot.scopes.join(" ")])
    const query = encodeForm(queryEntries)
    if (query === undefined) return yield* Effect.fail(protocolFailure("InvalidConfiguration"))

    const transaction = yield* store.saveTransaction(Object.freeze({
      issuer: snapshot.issuer,
      resource: snapshot.canonicalResource,
      credentialHandle: snapshot.credentialHandle,
      clientId: credential.clientId,
      authorizationResponseIssParameterRequired:
        snapshot.authorizationResponseIssParameterRequired,
      redirectUri: snapshot.redirectUri,
      scopes: snapshot.scopes,
      state: Redacted.make(state),
      codeVerifier: Redacted.make(verifier),
      createdAt: snapshot.createdAt
    } satisfies StoredAuthorizationTransaction))
    if (!opaqueHandle(transaction)) {
      return yield* Effect.fail(protocolFailure("StateReplay"))
    }
    return Object.freeze({
      transaction,
      authorizationUri: Redacted.make(
        `${snapshot.authorizationEndpoint}${snapshot.authorizationEndpoint.includes("?") ? "&" : "?"}${query}`
      )
    })
  })

export const completeAuthorizationCallback = (input: CompleteAuthorizationCallbackInput) =>
  Effect.gen(function*() {
    let rawCallback: unknown
    let rawMetadata: unknown
    let rawEndpointPolicy: unknown
    try {
      if (typeof input !== "object" || input === null) {
        return yield* Effect.fail(protocolFailure("StateMismatch"))
      }
      rawCallback = ownDataValue(input, "callback")
      rawMetadata = ownDataValue(input, "authorizationServerMetadata")
      rawEndpointPolicy = ownDataValue(input, "endpointPolicy")
    } catch {
      return yield* Effect.fail(protocolFailure("StateMismatch"))
    }
    const transaction = snapshotCallbackHandle(rawCallback)
    if (transaction === undefined) return yield* Effect.fail(protocolFailure("StateMismatch"))
    const store = yield* AuthorizationClientStore
    const rawStored = yield* store.takeTransaction(transaction).pipe(
      Effect.catchAll((error): Effect.Effect<never, AuthorizationProtocolError | AuthorizationStoreError> =>
        error.operation === "takeTransaction" && error.reason === "NotFound"
          ? Effect.fail(protocolFailure("StateReplay"))
          : Effect.fail(error))
    )
    const endpointPolicy = rawEndpointPolicy ?? "https-only"
    if (!isAuthorizationEndpointPolicy(endpointPolicy)) {
      return yield* Effect.fail(protocolFailure("StateMismatch"))
    }
    const stored = snapshotStoredTransaction(rawStored, endpointPolicy)
    if (stored === undefined) return yield* Effect.fail(protocolFailure("StateReplay"))
    const callback = snapshotCallback(rawCallback)
    if (callback === undefined) return yield* Effect.fail(protocolFailure("StateMismatch"))
    if (callback.redirectUri !== stored.redirectUri) {
      return yield* Effect.fail(protocolFailure("RedirectMismatch"))
    }
    const parameters = decodeForm(callback.parameters)
    if (parameters === undefined) return yield* Effect.fail(protocolFailure("StateMismatch"))
    const state = parameters.state
    if (state === undefined || !constantTimeEqual(state, Redacted.value(stored.state))) {
      return yield* Effect.fail(protocolFailure("StateMismatch"))
    }

    let metadataIssuer: unknown
    let responseIssSupported: unknown
    try {
      if (typeof rawMetadata !== "object" || rawMetadata === null) {
        return yield* Effect.fail(protocolFailure("ResponseIssuerMismatch"))
      }
      metadataIssuer = ownDataValue(rawMetadata, "issuer")
      responseIssSupported = ownDataValue(
        rawMetadata,
        "authorizationResponseIssParameterSupported"
      )
    } catch {
      return yield* Effect.fail(protocolFailure("ResponseIssuerMismatch"))
    }
    const responseIssuerRequired = stored.authorizationResponseIssParameterRequired
    const responseIssuer = parameters.iss
    if (metadataIssuer !== stored.issuer ||
      (responseIssSupported !== undefined && typeof responseIssSupported !== "boolean") ||
      (responseIssuerRequired && responseIssuer === undefined) ||
      (responseIssuer !== undefined &&
        (!isAllowedAuthorizationIssuer(responseIssuer, endpointPolicy) ||
          responseIssuer !== stored.issuer))) {
      return yield* Effect.fail(protocolFailure("ResponseIssuerMismatch"))
    }
    if (parameters.error !== undefined) {
      return yield* Effect.fail(protocolFailure("AuthorizationDenied"))
    }
    const code = parameters.code
    if (!boundedString(code, 16 * 1024)) {
      return yield* Effect.fail(protocolFailure("TokenExchangeFailed"))
    }
    const completed = {
      issuer: stored.issuer,
      resource: stored.resource,
      credentialHandle: stored.credentialHandle,
      redirectUri: stored.redirectUri,
      scopes: stored.scopes,
      authorizationCode: Redacted.make(code),
      codeVerifier: stored.codeVerifier
    }
    Object.defineProperty(completed, "clientId", {
      configurable: false,
      enumerable: false,
      value: stored.clientId,
      writable: false
    })
    return Object.freeze(completed) as CompletedAuthorizationCode
  })

export const performAuthorizationInteraction = (input: StartAuthorizationTransactionInput) =>
  Effect.gen(function*() {
    const started = yield* startAuthorizationTransaction(input)
    const interaction = yield* AuthorizationInteraction
    yield* interaction.open({
      authorizationUri: started.authorizationUri,
      redirectUri: input.redirectUri,
      transaction: started.transaction
    })
    const callback = yield* interaction.waitForCallback({
      redirectUri: input.redirectUri,
      transaction: started.transaction
    })
    return yield* completeAuthorizationCallback({
      callback,
      authorizationServerMetadata: input.authorizationServerMetadata,
      ...(input.endpointPolicy === undefined ? {} : { endpointPolicy: input.endpointPolicy })
    })
  })
