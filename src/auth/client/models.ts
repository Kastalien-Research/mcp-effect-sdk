import type * as Effect from "effect/Effect"
import type * as Option from "effect/Option"
import type * as Redacted from "effect/Redacted"
import type {
  AuthorizationCallbackInput,
  AuthorizationChallenge,
  AuthorizationCredentialHandle,
  AuthorizationGrantHandle,
  AuthorizationScopeSet,
  AuthorizationSigningKeyHandle,
  AuthorizationTransactionHandle
} from "../common.js"
import type {
  AuthorizationClientError,
  AuthorizationCryptoError,
  AuthorizationHttpError,
  AuthorizationInteractionError,
  AuthorizationStoreError
} from "./errors.js"

export type AuthorizationHeaders = ReadonlyArray<readonly [string, Redacted.Redacted<string>]>

export interface AuthorizationHttpRequest {
  readonly method: "GET" | "POST"
  readonly url: string
  readonly headers: AuthorizationHeaders
  readonly body?: Redacted.Redacted<Uint8Array>
}

export interface AuthorizationHttpResponse {
  readonly status: number
  readonly headers: AuthorizationHeaders
  readonly body: Redacted.Redacted<Uint8Array>
}

export interface AuthorizationHttpClientService {
  readonly request: (
    request: AuthorizationHttpRequest
  ) => Effect.Effect<AuthorizationHttpResponse, AuthorizationHttpError>
}

export interface AuthorizationSignRequest {
  readonly algorithm: "ES256" | "RS256"
  readonly key: AuthorizationSigningKeyHandle
  readonly payload: Uint8Array
}

export interface AuthorizationCryptoService {
  readonly randomBytes: (length: number) => Effect.Effect<Uint8Array, AuthorizationCryptoError>
  readonly sha256: (value: Uint8Array) => Effect.Effect<Uint8Array, AuthorizationCryptoError>
  readonly sign: (request: AuthorizationSignRequest) => Effect.Effect<Uint8Array, AuthorizationCryptoError>
}

export interface AuthorizationInteractionRequest {
  readonly authorizationUri: Redacted.Redacted<string>
  readonly redirectUri: string
  readonly transaction: AuthorizationTransactionHandle
}

export interface AuthorizationCallbackRequest {
  readonly redirectUri: string
  readonly transaction: AuthorizationTransactionHandle
}

export interface AuthorizationInteractionService {
  readonly open: (
    request: AuthorizationInteractionRequest
  ) => Effect.Effect<void, AuthorizationInteractionError>
  readonly waitForCallback: (
    request: AuthorizationCallbackRequest
  ) => Effect.Effect<AuthorizationCallbackInput, AuthorizationInteractionError>
}

export interface AuthorizationCredentialKey {
  readonly issuer: string
  readonly clientId?: string
}

export interface AuthorizationGrantKey {
  readonly issuer: string
  readonly resource: string
  readonly clientId: string
  readonly scopes: AuthorizationScopeSet
}

export interface StoredAuthorizationCredential {
  readonly issuer: string
  readonly clientId: string
  readonly tokenEndpointAuthMethod?: "none" | "client_secret_post" | "client_secret_basic"
  readonly clientSecret?: Redacted.Redacted<string>
  readonly registrationAccessToken?: Redacted.Redacted<string>
}

export interface StoredAuthorizationGrant {
  readonly issuer: string
  readonly resource: string
  readonly clientId: string
  readonly credentialHandle?: AuthorizationCredentialHandle
  readonly scopes: AuthorizationScopeSet
  readonly tokenType: string
  readonly accessToken: Redacted.Redacted<string>
  readonly refreshToken?: Redacted.Redacted<string>
  readonly expiresAt?: number
}

export interface StoredAuthorizationTransaction {
  readonly issuer: string
  readonly resource: string
  readonly credentialHandle?: AuthorizationCredentialHandle
  readonly clientId?: string
  readonly authorizationResponseIssParameterRequired?: boolean
  readonly redirectUri: string
  readonly scopes: AuthorizationScopeSet
  readonly state: Redacted.Redacted<string>
  readonly codeVerifier: Redacted.Redacted<string>
  readonly createdAt: number
}

export interface AuthorizationClientStoreService {
  readonly findCredential: (
    key: AuthorizationCredentialKey
  ) => Effect.Effect<Option.Option<AuthorizationCredentialHandle>, AuthorizationStoreError>
  readonly saveCredential: (
    value: StoredAuthorizationCredential
  ) => Effect.Effect<AuthorizationCredentialHandle, AuthorizationStoreError>
  readonly readCredential: (
    handle: AuthorizationCredentialHandle
  ) => Effect.Effect<StoredAuthorizationCredential, AuthorizationStoreError>
  readonly findGrant: (
    key: AuthorizationGrantKey
  ) => Effect.Effect<Option.Option<AuthorizationGrantHandle>, AuthorizationStoreError>
  readonly saveGrant: (
    value: StoredAuthorizationGrant
  ) => Effect.Effect<AuthorizationGrantHandle, AuthorizationStoreError>
  readonly readGrant: (
    handle: AuthorizationGrantHandle
  ) => Effect.Effect<StoredAuthorizationGrant, AuthorizationStoreError>
  readonly removeGrant: (
    handle: AuthorizationGrantHandle
  ) => Effect.Effect<void, AuthorizationStoreError>
  readonly saveTransaction: (
    value: StoredAuthorizationTransaction
  ) => Effect.Effect<AuthorizationTransactionHandle, AuthorizationStoreError>
  readonly takeTransaction: (
    handle: AuthorizationTransactionHandle
  ) => Effect.Effect<StoredAuthorizationTransaction, AuthorizationStoreError>
}

export interface AuthorizationRequest {
  readonly protectedResource: string
  readonly requestedScopes: AuthorizationScopeSet
}

export interface AuthorizationChallengeRequest {
  readonly protectedResource: string
  readonly challenge: AuthorizationChallenge
  readonly priorGrant?: AuthorizationGrantHandle
}

export interface AuthorizationClientService {
  readonly currentGrant: (
    request: AuthorizationRequest
  ) => Effect.Effect<Option.Option<AuthorizationGrantHandle>, AuthorizationClientError>
  readonly acquire: (
    request: AuthorizationRequest
  ) => Effect.Effect<AuthorizationGrantHandle, AuthorizationClientError>
  readonly respondToChallenge: (
    request: AuthorizationChallengeRequest
  ) => Effect.Effect<AuthorizationGrantHandle, AuthorizationClientError>
}
