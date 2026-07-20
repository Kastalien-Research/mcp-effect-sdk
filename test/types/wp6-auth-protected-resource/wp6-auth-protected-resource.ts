import * as Effect from "effect/Effect"
import * as Redacted from "effect/Redacted"
import * as Schema from "effect/Schema"
import * as Protected from "../../../src/auth/protected-resource.js"
import * as HttpServer from "../../../src/transport/StreamableHttpServerTransport.js"

declare const verifier: Protected.TokenVerifierService
declare const principal: Protected.AuthorizationPrincipal
const requiredScopes = Schema.decodeUnknownSync(Protected.AuthorizationScopeSet)(["tools.read"])

const extracted: Effect.Effect<Redacted.Redacted<string>, Protected.BearerAuthorizationError> =
  Protected.extractBearerToken("Bearer opaque")
void extracted

const authorized: Effect.Effect<void, Protected.AuthorizationPolicyError> =
  Protected.requireAuthorizationScopes(principal, requiredScopes)
void authorized

const embedded: Effect.Effect<
  Protected.AuthorizationPrincipal,
  Protected.TokenVerificationError
> = Protected.embedVerifiedAuthorizationPrincipal(principal)
void embedded

const verified: Effect.Effect<
  Protected.AuthorizationPrincipal,
  Protected.BearerAuthorizationError | Protected.TokenVerificationError | Protected.AuthorizationPolicyError,
  Protected.TokenVerifier
> = Protected.verifyBearerAuthorization({
  authorizationHeader: "Bearer opaque",
  protectedResource: "https://mcp.example.test/endpoint",
  requiredScopes
})
void verified

const serialized: string = Protected.serializeAuthorizationChallenge(
  Protected.unauthorizedChallenge({
    resourceMetadata: "https://mcp.example.test/.well-known/oauth-protected-resource",
    scopes: requiredScopes
  })
)
void serialized

const options = {
  path: "/mcp",
  authorization: {
    verifier,
    protectedResource: "https://mcp.example.test/endpoint",
    resourceMetadata: "https://mcp.example.test/.well-known/oauth-protected-resource",
    requiredScopes
  }
} satisfies HttpServer.StreamableHttpServerTransportOptions
void options

const trusted: HttpServer.HandleRequestOptions = {
  verifiedAuthorizationPrincipal: principal
}
void trusted

const notificationOptions: HttpServer.StreamableHttpServerTransportOptions = {
  path: "/mcp",
  acceptNotification: (_notification, context) => {
    const exact: Protected.AuthorizationPrincipal | undefined = context.authorizationPrincipal
    void exact
    return Effect.void
  }
}
void notificationOptions

const oldHook: HttpServer.HandleRequestOptions = {
  // @ts-expect-error token-bearing authInfo was replaced outright
  authInfo: { token: "must-not-compile" }
}
void oldHook

const tokenBearing: HttpServer.HandleRequestOptions = {
  // @ts-expect-error only an AuthorizationPrincipal may be embedded
  verifiedAuthorizationPrincipal: { token: "must-not-compile" }
}
void tokenBearing
