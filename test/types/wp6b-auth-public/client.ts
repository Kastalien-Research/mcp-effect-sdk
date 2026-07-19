import * as Effect from "effect/Effect"
import * as Option from "effect/Option"
import * as Redacted from "effect/Redacted"
import * as Schema from "effect/Schema"
import * as Client from "mcp-effect-sdk/auth/client"

// Effect 3.22's own declarations mention these Web names even when a consumer
// imports only platform-neutral Effect types. Keep them opaque so this fixture
// can run with lib ES2022 and types [] while the separate emitted-graph test
// still rejects any such name from the SDK auth declarations themselves.
declare global {
  interface AbortSignal {}
  interface QueuingStrategy<Value = unknown> {}
  interface ReadableStream<Value = unknown> {}
  interface URL {}
}

type Equal<Left, Right> =
  (<Value>() => Value extends Left ? 1 : 2) extends
  (<Value>() => Value extends Right ? 1 : 2) ? true : false
type Assert<Value extends true> = Value
type IsAny<Value> = 0 extends (1 & Value) ? true : false
type FirstConstructorArgument<Value> = Value extends abstract new (arg: infer Argument, ...rest: Array<any>) => unknown
  ? Argument
  : never
type ConstructorOmits<Value, Key extends PropertyKey> = IsAny<Value> extends true
  ? true
  : Key extends keyof FirstConstructorArgument<Value> ? false : true

type ExpectedHeaders = ReadonlyArray<readonly [string, Redacted.Redacted<string>]>
declare const headers: Client.AuthorizationHeaders
const expectedHeaders: ExpectedHeaders = headers
const roundTripHeaders: Client.AuthorizationHeaders = expectedHeaders

// @ts-expect-error HTTP header values are always Redacted.
const plainHeaderValue: Redacted.Redacted<string> = "Bearer secret"
// @ts-expect-error HTTP request and response bodies are always Redacted.
const plainBody: Redacted.Redacted<Uint8Array> = new Uint8Array()
// @ts-expect-error The complete interaction authorization URI is always Redacted.
const plainAuthorizationUri: Redacted.Redacted<string> = "https://issuer.example/authorize?code=secret"

const httpRequest: Client.AuthorizationHttpRequest = {
  method: "POST",
  url: "https://issuer.example/token",
  headers: [["authorization", Redacted.make("secret")]],
  body: Redacted.make(new Uint8Array())
}
const httpResponse: Client.AuthorizationHttpResponse = {
  status: 200,
  headers: [["content-type", Redacted.make("application/json")]],
  body: Redacted.make(new Uint8Array())
}
const http: Client.AuthorizationHttpClientService = { request: () => Effect.succeed(httpResponse) }
const httpEffect: Effect.Effect<Client.AuthorizationHttpResponse, Client.AuthorizationHttpError> = http.request(httpRequest)

declare const signingKey: Client.AuthorizationSigningKeyHandle
const crypto: Client.AuthorizationCryptoService = {
  randomBytes: () => Effect.succeed(new Uint8Array()),
  sha256: () => Effect.succeed(new Uint8Array()),
  sign: () => Effect.succeed(new Uint8Array())
}
const signEffect: Effect.Effect<Uint8Array, Client.AuthorizationCryptoError> = crypto.sign({
  algorithm: "ES256",
  key: signingKey,
  payload: new Uint8Array()
})

declare const transaction: Client.AuthorizationTransactionHandle
const interactionRequest: Client.AuthorizationInteractionRequest = {
  authorizationUri: Redacted.make("https://issuer.example/authorize?state=secret"),
  redirectUri: "https://client.example/callback?route=one",
  transaction
}
const interaction: Client.AuthorizationInteractionService = {
  open: () => Effect.void,
  waitForCallback: () => Effect.die("not run")
}
const openEffect: Effect.Effect<void, Client.AuthorizationInteractionError> = interaction.open(interactionRequest)

declare const scopes: Client.AuthorizationScopeSet
declare const credential: Client.AuthorizationCredentialHandle
declare const grant: Client.AuthorizationGrantHandle
const store: Client.AuthorizationClientStoreService = {
  findCredential: () => Effect.succeed(Option.some(credential)),
  saveCredential: () => Effect.succeed(credential),
  readCredential: () => Effect.succeed({ issuer: "https://issuer.example", clientId: "client", clientSecret: Redacted.make("secret") }),
  findGrant: () => Effect.succeed(Option.some(grant)),
  saveGrant: () => Effect.succeed(grant),
  readGrant: () => Effect.succeed({
    issuer: "https://issuer.example",
    resource: "https://resource.example/mcp",
    clientId: "client",
    scopes,
    tokenType: "Bearer",
    accessToken: Redacted.make("secret")
  }),
  removeGrant: () => Effect.void,
  saveTransaction: () => Effect.succeed(transaction),
  takeTransaction: () => Effect.succeed({
    issuer: "https://issuer.example",
    resource: "https://resource.example/mcp",
    redirectUri: "https://client.example/callback?route=one",
    scopes,
    state: Redacted.make("state"),
    codeVerifier: Redacted.make("verifier"),
    createdAt: 1
  })
}
const storeEffect: Effect.Effect<Readonly<unknown>, Client.AuthorizationStoreError> = store.takeTransaction(transaction)

const request: Client.AuthorizationRequest = {
  protectedResource: "https://resource.example/mcp",
  requestedScopes: scopes
}
const current: Effect.Effect<Option.Option<Client.AuthorizationGrantHandle>, Client.AuthorizationClientError, Client.AuthorizationClient> =
  Client.currentAuthorizationGrant(request)
const acquire: Effect.Effect<Client.AuthorizationGrantHandle, Client.AuthorizationClientError, Client.AuthorizationClient> =
  Client.acquireAuthorization(request)

type _DecodeNoMessage = Assert<ConstructorOmits<typeof Client.AuthorizationDecodeError, "message">>
type _HttpNoMessage = Assert<ConstructorOmits<typeof Client.AuthorizationHttpError, "message">>
type _CryptoNoMessage = Assert<ConstructorOmits<typeof Client.AuthorizationCryptoError, "message">>
type _InteractionNoMessage = Assert<ConstructorOmits<typeof Client.AuthorizationInteractionError, "message">>
type _StoreNoMessage = Assert<ConstructorOmits<typeof Client.AuthorizationStoreError, "message">>
type _ProtocolNoMessage = Assert<ConstructorOmits<typeof Client.AuthorizationProtocolError, "message">>
type _HttpBodyExact = Assert<IsAny<Client.AuthorizationHttpRequest> extends true
  ? true
  : Equal<Client.AuthorizationHttpRequest["body"], Redacted.Redacted<Uint8Array> | undefined>>
type _AuthorizationUriExact = Assert<IsAny<Client.AuthorizationInteractionRequest> extends true
  ? true
  : Equal<Client.AuthorizationInteractionRequest["authorizationUri"], Redacted.Redacted<string>>>

void Client.AuthorizationCallbackInput
void Client.AuthorizationChallenge
void Client.AuthorizationClient
void Client.AuthorizationClientStore
void Client.AuthorizationCredentialHandle
void Client.AuthorizationCrypto
void Client.AuthorizationCryptoError
void Client.AuthorizationDecodeError
void Client.AuthorizationGrantHandle
void Client.AuthorizationHttpClient
void Client.AuthorizationHttpError
void Client.AuthorizationInteraction
void Client.AuthorizationInteractionError
void Client.AuthorizationProtocolError
void Client.AuthorizationScope
void Client.AuthorizationScopeSet
void Client.AuthorizationServerMetadata
void Client.AuthorizationSigningKeyHandle
void Client.AuthorizationStoreError
void Client.AuthorizationTransactionHandle
void Client.ProtectedResourceMetadata
void Client.respondToAuthorizationChallenge
void Schema
void plainHeaderValue
void plainBody
void plainAuthorizationUri
void roundTripHeaders
void httpEffect
void signEffect
void openEffect
void storeEffect
void current
void acquire
void (null as unknown as _DecodeNoMessage)
void (null as unknown as _HttpNoMessage)
void (null as unknown as _CryptoNoMessage)
void (null as unknown as _InteractionNoMessage)
void (null as unknown as _StoreNoMessage)
void (null as unknown as _ProtocolNoMessage)
void (null as unknown as _HttpBodyExact)
void (null as unknown as _AuthorizationUriExact)
