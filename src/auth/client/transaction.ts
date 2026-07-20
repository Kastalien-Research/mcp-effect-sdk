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
  isSafeHttpsEndpoint,
  isSafeHttpsIssuer,
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
}

export interface StartedAuthorizationTransaction {
  readonly transaction: AuthorizationTransactionHandle
  readonly authorizationUri: Redacted.Redacted<string>
}

export interface CompleteAuthorizationCallbackInput {
  readonly callback: AuthorizationCallbackInput
  readonly authorizationServerMetadata: AuthorizationServerMetadata
}

export interface CompletedAuthorizationCode {
  readonly issuer: string
  readonly resource: string
  readonly credentialHandle: AuthorizationCredentialHandle
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

const snapshotCredential = (value: unknown): StoredAuthorizationCredential | undefined => {
  try {
    if (typeof value !== "object" || value === null) return undefined
    const issuer = ownDataValue(value, "issuer")
    const clientId = ownDataValue(value, "clientId")
    if (!isSafeHttpsIssuer(issuer) || !boundedString(clientId, 2048)) return undefined
    return Object.freeze({ issuer, clientId })
  } catch {
    return undefined
  }
}

interface StoredTransactionSnapshot {
  readonly issuer: string
  readonly resource: string
  readonly credentialHandle: AuthorizationCredentialHandle
  readonly redirectUri: string
  readonly scopes: AuthorizationScopeSet
  readonly state: Redacted.Redacted<string>
  readonly codeVerifier: Redacted.Redacted<string>
}

const snapshotStoredTransaction = (value: unknown): StoredTransactionSnapshot | undefined => {
  try {
    if (typeof value !== "object" || value === null) return undefined
    const issuer = ownDataValue(value, "issuer")
    const resource = ownDataValue(value, "resource")
    const credentialHandle = ownDataValue(value, "credentialHandle")
    const redirectUri = ownDataValue(value, "redirectUri")
    const scopes = snapshotScopes(ownDataValue(value, "scopes"))
    const state = redactedString(ownDataValue(value, "state"), 4096)
    const codeVerifier = redactedString(ownDataValue(value, "codeVerifier"), 4096)
    if (!boundedString(resource, 2048)) return undefined
    const parsedResource = parseAuthorizationUri(resource)
    if (!isSafeHttpsIssuer(issuer) || parsedResource._tag === "Failure" ||
      parsedResource.value.scheme.toLowerCase() !== "https" ||
      parsedResource.value.fragment !== undefined ||
      !opaqueHandle(credentialHandle) || !isSafeRedirectIdentifier(redirectUri) ||
      scopes === undefined || state === undefined || codeVerifier === undefined) return undefined
    return Object.freeze({
      issuer,
      resource,
      credentialHandle: credentialHandle as AuthorizationCredentialHandle,
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

const validateStartInput = (input: StartAuthorizationTransactionInput): boolean => {
  try {
    const metadataIssuer = ownDataValue(input.authorizationServerMetadata, "issuer")
    const endpoint = ownDataValue(input.authorizationServerMetadata, "authorizationEndpoint")
    const resource = parseAuthorizationUri(input.canonicalResource)
    return metadataIssuer === input.issuer && isSafeHttpsIssuer(input.issuer) &&
      isSafeHttpsEndpoint(endpoint) && resource._tag === "Success" &&
      resource.value.scheme.toLowerCase() === "https" && resource.value.fragment === undefined &&
      opaqueHandle(input.credentialHandle) && snapshotScopes(input.scopes) !== undefined &&
      isSafeRedirectIdentifier(input.redirectUri) && Number.isSafeInteger(input.createdAt) &&
      input.createdAt >= 0
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
    if (!supportsS256(input.authorizationServerMetadata)) {
      return yield* Effect.fail(protocolFailure("UnsupportedAuthorizationServer"))
    }
    if (!validateStartInput(input)) {
      return yield* Effect.fail(protocolFailure("InvalidConfiguration"))
    }
    const endpoint = ownDataValue(input.authorizationServerMetadata, "authorizationEndpoint") as string
    const scopes = snapshotScopes(input.scopes)!
    const store = yield* AuthorizationClientStore
    const rawCredential = yield* store.readCredential(input.credentialHandle)
    const credential = snapshotCredential(rawCredential)
    if (credential === undefined || credential.issuer !== input.issuer) {
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
    const query = encodeForm([
      ["response_type", "code"],
      ["client_id", credential.clientId],
      ["redirect_uri", input.redirectUri],
      ["scope", scopes.join(" ")],
      ["state", state],
      ["code_challenge", encodeBase64Url(challengeBytes)],
      ["code_challenge_method", "S256"],
      ["resource", input.canonicalResource]
    ])
    if (query === undefined) return yield* Effect.fail(protocolFailure("InvalidConfiguration"))

    const transaction = yield* store.saveTransaction(Object.freeze({
      issuer: input.issuer,
      resource: input.canonicalResource,
      credentialHandle: input.credentialHandle,
      redirectUri: input.redirectUri,
      scopes,
      state: Redacted.make(state),
      codeVerifier: Redacted.make(verifier),
      createdAt: input.createdAt
    } satisfies StoredAuthorizationTransaction))
    if (!opaqueHandle(transaction)) {
      return yield* Effect.fail(protocolFailure("StateReplay"))
    }
    return Object.freeze({
      transaction,
      authorizationUri: Redacted.make(`${endpoint}${endpoint.includes("?") ? "&" : "?"}${query}`)
    })
  })

export const completeAuthorizationCallback = (input: CompleteAuthorizationCallbackInput) =>
  Effect.gen(function*() {
    const callback = snapshotCallback(input.callback)
    if (callback === undefined) return yield* Effect.fail(protocolFailure("StateMismatch"))
    const store = yield* AuthorizationClientStore
    const rawStored = yield* store.takeTransaction(callback.transaction).pipe(
      Effect.catchAll((error): Effect.Effect<never, AuthorizationProtocolError | AuthorizationStoreError> =>
        error.operation === "takeTransaction" && error.reason === "NotFound"
          ? Effect.fail(protocolFailure("StateReplay"))
          : Effect.fail(error))
    )
    const stored = snapshotStoredTransaction(rawStored)
    if (stored === undefined) return yield* Effect.fail(protocolFailure("StateReplay"))
    if (callback.redirectUri !== stored.redirectUri) {
      return yield* Effect.fail(protocolFailure("RedirectMismatch"))
    }
    const parameters = decodeForm(callback.parameters)
    if (parameters === undefined) return yield* Effect.fail(protocolFailure("StateMismatch"))
    const state = parameters.state
    if (state === undefined || !constantTimeEqual(state, Redacted.value(stored.state))) {
      return yield* Effect.fail(protocolFailure("StateMismatch"))
    }

    const metadataIssuer = ownDataValue(input.authorizationServerMetadata, "issuer")
    const responseIssSupported = ownDataValue(
      input.authorizationServerMetadata,
      "authorizationResponseIssParameterSupported"
    )
    const responseIssuer = parameters.iss
    if (metadataIssuer !== stored.issuer ||
      (responseIssSupported !== undefined && typeof responseIssSupported !== "boolean") ||
      (responseIssSupported === true && responseIssuer === undefined) ||
      (responseIssuer !== undefined &&
        (!isSafeHttpsIssuer(responseIssuer) || responseIssuer !== stored.issuer))) {
      return yield* Effect.fail(protocolFailure("ResponseIssuerMismatch"))
    }
    if (parameters.error !== undefined) {
      return yield* Effect.fail(protocolFailure("AuthorizationDenied"))
    }
    const code = parameters.code
    if (!boundedString(code, 16 * 1024)) {
      return yield* Effect.fail(protocolFailure("TokenExchangeFailed"))
    }
    return Object.freeze({
      issuer: stored.issuer,
      resource: stored.resource,
      credentialHandle: stored.credentialHandle,
      redirectUri: stored.redirectUri,
      scopes: stored.scopes,
      authorizationCode: Redacted.make(code),
      codeVerifier: stored.codeVerifier
    })
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
      authorizationServerMetadata: input.authorizationServerMetadata
    })
  })
