import * as Effect from "effect/Effect"
import * as Protected from "../../../src/auth/protected-resource.js"
import * as HttpServer from "../../../src/transport/StreamableHttpServerTransport.js"

declare const verifier: Protected.TokenVerifierService
declare const principal: Protected.AuthorizationPrincipal

const options = {
  path: "/mcp",
  authorization: {
    verifier,
    protectedResource: "https://mcp.example.test/endpoint",
    resourceMetadata: "https://mcp.example.test/.well-known/oauth-protected-resource",
    requiredScopes: ["tools.read"]
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
