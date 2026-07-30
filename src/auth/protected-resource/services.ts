import * as Context from "effect/Context"
import * as Effect from "effect/Effect"
import * as Redacted from "effect/Redacted"
import * as Schema from "effect/Schema"
import { AuthorizationChallenge, AuthorizationScopeSet, type AuthorizationScope } from "../common.js"
import { AuthorizationPolicyError, BearerAuthorizationError, TokenVerificationError } from "./errors.js"
import type { TokenVerificationRequest, TokenVerifierService } from "./models.js"
import { AuthorizationPrincipal } from "./models.js"
import { SpanName } from "../../observability/Spans.js"

export class TokenVerifier extends Context.Tag("mcp-effect-sdk/auth/protected-resource/TokenVerifier")<
  TokenVerifier,
  TokenVerifierService
>() {}

export const verifyToken = (
  request: TokenVerificationRequest
): Effect.Effect<AuthorizationPrincipal, TokenVerificationError, TokenVerifier> =>
  Effect.flatMap(TokenVerifier, (verifier) => verifier.verify(request))

export const extractBearerToken = (
  authorizationHeader: string | null | undefined
): Effect.Effect<Redacted.Redacted<string>, BearerAuthorizationError> => {
  if (authorizationHeader === null || authorizationHeader === undefined) {
    return Effect.fail(new BearerAuthorizationError({ reason: "Missing" }))
  }
  const matched = /^Bearer +([A-Za-z0-9\-._~+/]+=*)$/i.exec(authorizationHeader)
  return matched === null
    ? Effect.fail(new BearerAuthorizationError({ reason: "Malformed" }))
    : Effect.succeed(Redacted.make(matched[1]!))
}

export interface AuthorizationScopeSatisfaction {
  readonly principal: AuthorizationPrincipal
  readonly grantedScope: AuthorizationScope
  readonly requiredScope: AuthorizationScope
}

export type AuthorizationScopeSatisfies = (satisfaction: AuthorizationScopeSatisfaction) => boolean

const exactScopeSatisfies: AuthorizationScopeSatisfies = ({ grantedScope, requiredScope }) =>
  grantedScope === requiredScope

export const requireAuthorizationScopes = (
  principal: AuthorizationPrincipal,
  requiredScopes: typeof AuthorizationScopeSet.Type,
  scopeSatisfies: AuthorizationScopeSatisfies = exactScopeSatisfies
): Effect.Effect<void, AuthorizationPolicyError> =>
  Effect.withSpan(SpanName.authScopePolicy, { captureStackTrace: false })(
    Effect.gen(function* () {
      return yield* Effect.try({
        try: () => {
          if (typeof scopeSatisfies !== "function") throw new TypeError("Scope satisfaction policy must be a function")
          for (const required of requiredScopes) {
            let matched = false
            for (const granted of principal.scopes) {
              const result = scopeSatisfies({ principal, grantedScope: granted, requiredScope: required })
              if (typeof result !== "boolean") {
                throw new TypeError("Scope satisfaction policy must return a boolean")
              }
              if (result) {
                matched = true
                break
              }
            }
            if (!matched) return false
          }
          return true
        },
        catch: () =>
          new AuthorizationPolicyError({
            reason: "PolicyFailure",
            required: requiredScopes,
            granted: principal.scopes
          })
      }).pipe(
        Effect.flatMap((satisfied) =>
          satisfied
            ? Effect.void
            : Effect.fail(
                new AuthorizationPolicyError({
                  reason: "InsufficientScope",
                  required: requiredScopes,
                  granted: principal.scopes
                })
              )
        )
      )
    })
  )

export interface VerifyBearerAuthorizationOptions {
  readonly authorizationHeader: string | null | undefined
  readonly protectedResource: string
  readonly requiredScopes: typeof AuthorizationScopeSet.Type
  readonly scopeSatisfies?: AuthorizationScopeSatisfies | undefined
}

const PRINCIPAL_PROPERTY_NAMES = new Set(["subject", "clientId", "issuer", "audiences", "scopes", "claims"])

const decodeAuthorizationPrincipal = Schema.decodeUnknownSync(AuthorizationPrincipal)

export const embedVerifiedAuthorizationPrincipal = (
  value: unknown
): Effect.Effect<AuthorizationPrincipal, TokenVerificationError> =>
  Effect.suspend(() => {
    try {
      if (
        !(value instanceof AuthorizationPrincipal) ||
        Reflect.getPrototypeOf(value) !== AuthorizationPrincipal.prototype
      ) {
        throw new TypeError()
      }
      const snapshot: Record<string, unknown> = {}
      for (const key of Reflect.ownKeys(value)) {
        if (typeof key !== "string" || !PRINCIPAL_PROPERTY_NAMES.has(key)) {
          throw new TypeError()
        }
        const descriptor = Reflect.getOwnPropertyDescriptor(value, key)
        if (descriptor === undefined || !("value" in descriptor)) throw new TypeError()
        snapshot[key] = descriptor.value
      }
      return Effect.succeed(decodeAuthorizationPrincipal(snapshot))
    } catch {
      return Effect.fail(new TokenVerificationError({ reason: "VerifierFailure" }))
    }
  })

export const verifyBearerAuthorization = (
  options: VerifyBearerAuthorizationOptions
): Effect.Effect<
  AuthorizationPrincipal,
  BearerAuthorizationError | TokenVerificationError | AuthorizationPolicyError,
  TokenVerifier
> =>
  Effect.withSpan(SpanName.authBearerVerify, { captureStackTrace: false })(
    Effect.gen(function* () {
      const bearerToken = yield* extractBearerToken(options.authorizationHeader)
      const untrustedPrincipal = yield* verifyToken({
        bearerToken,
        protectedResource: options.protectedResource
      })
      const principal = yield* embedVerifiedAuthorizationPrincipal(untrustedPrincipal)
      yield* requireAuthorizationScopes(principal, options.requiredScopes, options.scopeSatisfies)
      return principal
    })
  )

const challengeValue = (value: string): string => `"${value.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`

export const serializeAuthorizationChallenge = (challenge: AuthorizationChallenge): string => {
  const parameters: Array<string> = []
  if (challenge.error !== undefined) {
    parameters.push(`error=${challengeValue(challenge.error)}`)
  }
  if (challenge.errorDescription !== undefined) {
    parameters.push(`error_description=${challengeValue(challenge.errorDescription)}`)
  }
  if (challenge.scopes !== undefined && challenge.scopes.length > 0) {
    parameters.push(`scope=${challengeValue(challenge.scopes.join(" "))}`)
  }
  if (challenge.resourceMetadata !== undefined) {
    parameters.push(`resource_metadata=${challengeValue(challenge.resourceMetadata)}`)
  }
  if (
    challenge.status === 401 &&
    challenge.error === undefined &&
    challenge.errorDescription === undefined &&
    challenge.resourceMetadata !== undefined
  ) {
    const metadata = parameters.pop()!
    parameters.unshift(metadata)
  }
  return parameters.length === 0 ? "Bearer" : `Bearer ${parameters.join(", ")}`
}

export const unauthorizedChallenge = (options: {
  readonly resourceMetadata: string
  readonly scopes?: typeof AuthorizationScopeSet.Type
  readonly error?: "invalid_token"
  readonly errorDescription?: string
}): AuthorizationChallenge =>
  Schema.decodeUnknownSync(AuthorizationChallenge)({
    scheme: "Bearer",
    status: 401,
    scopes: options.scopes ?? Schema.decodeUnknownSync(AuthorizationScopeSet)([]),
    resourceMetadata: options.resourceMetadata,
    ...(options.error === undefined ? {} : { error: options.error }),
    ...(options.errorDescription === undefined ? {} : { errorDescription: options.errorDescription })
  })

export const insufficientScopeChallenge = (options: {
  readonly resourceMetadata: string
  readonly scopes: typeof AuthorizationScopeSet.Type
  readonly errorDescription?: string
}): AuthorizationChallenge =>
  Schema.decodeUnknownSync(AuthorizationChallenge)({
    scheme: "Bearer",
    status: 403,
    error: "insufficient_scope",
    scopes: options.scopes,
    resourceMetadata: options.resourceMetadata,
    ...(options.errorDescription === undefined ? {} : { errorDescription: options.errorDescription })
  })
