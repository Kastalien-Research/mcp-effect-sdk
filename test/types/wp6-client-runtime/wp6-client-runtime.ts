import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"
import * as Client from "mcp-effect-sdk/auth/client"

declare global {
  interface AbortSignal {}
  interface QueuingStrategy<Value = unknown> {}
  interface ReadableStream<Value = unknown> {}
  interface URL {}
}

declare const scopes: Client.AuthorizationScopeSet

const preregistration: Client.PreRegisteredAuthorizationCredential = {
  issuer: "https://issuer.example",
  clientId: "client"
}

const registration: Client.AuthorizationResolutionConfiguration = {
  clientName: "Type fixture",
  redirectUris: ["https://client.example/callback"],
  preRegisteredCredentials: [preregistration]
}

const validateAudience: Client.TokenAudienceValidator = (input) => {
  void input.token
  return Effect.succeed([input.resource])
}

const config: Client.AuthorizationClientConfig = {
  protectedResource: "https://resource.example/mcp",
  requestedScopes: scopes,
  redirectUri: "https://client.example/callback",
  registration,
  validateAudience,
  endpointPolicy: "https-only"
}

const made: Effect.Effect<
  Client.AuthorizationClientService,
  Client.AuthorizationClientError,
  Client.AuthorizationHttpClient | Client.AuthorizationCrypto |
    Client.AuthorizationInteraction | Client.AuthorizationClientStore
> = Client.makeAuthorizationClient(config)

const layer: Layer.Layer<
  Client.AuthorizationClient,
  Client.AuthorizationClientError,
  Client.AuthorizationHttpClient | Client.AuthorizationCrypto |
    Client.AuthorizationInteraction | Client.AuthorizationClientStore
> = Client.layerAuthorizationClient({ ...config, endpointPolicy: "allow-loopback-http" })

// @ts-expect-error the endpoint policy is a closed union
const invalidPolicy: Client.AuthorizationEndpointPolicy = "allow-http"

// @ts-expect-error selected redirect is required
const missingRedirect: Client.AuthorizationClientConfig = {
  protectedResource: "https://resource.example/mcp",
  requestedScopes: scopes,
  registration,
  validateAudience
}

void made
void layer
void invalidPolicy
void missingRedirect
