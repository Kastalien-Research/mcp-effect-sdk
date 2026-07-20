import * as Effect from "effect/Effect"
import * as Redacted from "effect/Redacted"
import * as Schema from "effect/Schema"
import * as Protected from "mcp-effect-sdk/auth/protected-resource"

type Assert<Value extends true> = Value
type Equal<Left, Right> =
  (<Value>() => Value extends Left ? 1 : 2) extends
  (<Value>() => Value extends Right ? 1 : 2) ? true : false
type IsAny<Value> = 0 extends (1 & Value) ? true : false
type FirstConstructorArgument<Value> = Value extends abstract new (arg: infer Argument, ...rest: Array<any>) => unknown
  ? Argument
  : never
type ConstructorOmits<Value, Key extends PropertyKey> = IsAny<Value> extends true
  ? true
  : Key extends keyof FirstConstructorArgument<Value> ? false : true

type _VerificationRequestNotAny = Assert<Equal<IsAny<Protected.TokenVerificationRequest>, false>>
type _VerifierServiceNotAny = Assert<Equal<IsAny<Protected.TokenVerifierService>, false>>
type _PrincipalNotAny = Assert<Equal<IsAny<Protected.AuthorizationPrincipal>, false>>
type _PrincipalClassNotAny = Assert<Equal<IsAny<typeof Protected.AuthorizationPrincipal>, false>>
type _VerificationErrorNotAny = Assert<Equal<IsAny<typeof Protected.TokenVerificationError>, false>>
type _PolicyErrorNotAny = Assert<Equal<IsAny<typeof Protected.AuthorizationPolicyError>, false>>
type _BearerErrorNotAny = Assert<Equal<IsAny<typeof Protected.BearerAuthorizationError>, false>>

declare const scopes: Protected.AuthorizationScopeSet
const request: Protected.TokenVerificationRequest = {
  bearerToken: Redacted.make("secret"),
  protectedResource: "https://resource.example/mcp"
}
const verifier: Protected.TokenVerifierService = { verify: () => Effect.die("not run") }
const verifierEffect: Effect.Effect<Protected.AuthorizationPrincipal, Protected.TokenVerificationError> = verifier.verify(request)
const accessorEffect: Effect.Effect<
  Protected.AuthorizationPrincipal,
  Protected.TokenVerificationError,
  Protected.TokenVerifier
> = Protected.verifyToken(request)
const extracted: Effect.Effect<Redacted.Redacted<string>, Protected.BearerAuthorizationError> =
  Protected.extractBearerToken("Bearer secret")

const principal = Schema.decodeUnknownSync(Protected.AuthorizationPrincipal)({
  subject: "subject-one",
  clientId: "client-one",
  issuer: "https://issuer.example",
  audiences: ["https://resource.example/mcp"],
  scopes: ["tools.read"],
  claims: { tenant: "one", nested: [true, 1, null] }
})
const challenge: Protected.AuthorizationChallenge = Protected.insufficientScopeChallenge({
  resourceMetadata: "https://resource.example/.well-known/oauth-protected-resource",
  scopes
})
const policyEffect: Effect.Effect<void, Protected.AuthorizationPolicyError> =
  Protected.requireAuthorizationScopes(principal, scopes)
const middlewareEffect: Effect.Effect<
  Protected.AuthorizationPrincipal,
  Protected.BearerAuthorizationError | Protected.TokenVerificationError | Protected.AuthorizationPolicyError,
  Protected.TokenVerifier
> = Protected.verifyBearerAuthorization({
  authorizationHeader: "Bearer secret",
  protectedResource: "https://resource.example/mcp",
  requiredScopes: scopes
})
const serialized: string = Protected.serializeAuthorizationChallenge(challenge)

type _VerificationNoMessage = Assert<ConstructorOmits<typeof Protected.TokenVerificationError, "message">>
type _PolicyNoMessage = Assert<ConstructorOmits<typeof Protected.AuthorizationPolicyError, "message">>
type _VerificationNoDetail = Assert<ConstructorOmits<typeof Protected.TokenVerificationError, "detail">>
type _PolicyNoDetail = Assert<ConstructorOmits<typeof Protected.AuthorizationPolicyError, "detail">>

void Protected.AuthorizationChallenge
void Protected.AuthorizationPolicyError
void Protected.AuthorizationPrincipal
void Protected.AuthorizationScope
void Protected.AuthorizationScopeSet
void Protected.BearerAuthorizationError
void Protected.ProtectedResourceMetadata
void Protected.TokenVerificationError
void Protected.TokenVerifier
void Protected.unauthorizedChallenge
void extracted
void policyEffect
void middlewareEffect
void serialized
void verifierEffect
void accessorEffect
void principal
void challenge
void (null as unknown as _VerificationNoMessage)
void (null as unknown as _PolicyNoMessage)
void (null as unknown as _VerificationNoDetail)
void (null as unknown as _PolicyNoDetail)
void (null as unknown as _VerificationRequestNotAny)
void (null as unknown as _VerifierServiceNotAny)
void (null as unknown as _PrincipalNotAny)
void (null as unknown as _PrincipalClassNotAny)
void (null as unknown as _VerificationErrorNotAny)
void (null as unknown as _PolicyErrorNotAny)
void (null as unknown as _BearerErrorNotAny)
