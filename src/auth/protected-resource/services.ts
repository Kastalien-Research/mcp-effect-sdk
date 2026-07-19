import * as Context from "effect/Context"
import * as Effect from "effect/Effect"
import * as Schema from "effect/Schema"
import {
  AuthorizationChallenge,
  AuthorizationScopeSet
} from "../common.js"
import type { TokenVerificationError } from "./errors.js"
import type {
  AuthorizationPrincipal,
  TokenVerificationRequest,
  TokenVerifierService
} from "./models.js"

export class TokenVerifier extends Context.Tag(
  "mcp-effect-sdk/auth/protected-resource/TokenVerifier"
)<TokenVerifier, TokenVerifierService>() {}

export const verifyToken = (
  request: TokenVerificationRequest
): Effect.Effect<AuthorizationPrincipal, TokenVerificationError, TokenVerifier> =>
  Effect.flatMap(TokenVerifier, (verifier) => verifier.verify(request))

export const unauthorizedChallenge = (options: {
  readonly resourceMetadata: string
  readonly error?: "invalid_token"
  readonly errorDescription?: string
}): AuthorizationChallenge => Schema.decodeUnknownSync(AuthorizationChallenge)({
  scheme: "Bearer",
  status: 401,
  scopes: Schema.decodeUnknownSync(AuthorizationScopeSet)([]),
  resourceMetadata: options.resourceMetadata,
  ...(options.error === undefined ? {} : { error: options.error }),
  ...(options.errorDescription === undefined ? {} : { errorDescription: options.errorDescription })
})

export const insufficientScopeChallenge = (options: {
  readonly resourceMetadata: string
  readonly scopes: typeof AuthorizationScopeSet.Type
  readonly errorDescription?: string
}): AuthorizationChallenge => Schema.decodeUnknownSync(AuthorizationChallenge)({
  scheme: "Bearer",
  status: 403,
  error: "insufficient_scope",
  scopes: options.scopes,
  resourceMetadata: options.resourceMetadata,
  ...(options.errorDescription === undefined ? {} : { errorDescription: options.errorDescription })
})
