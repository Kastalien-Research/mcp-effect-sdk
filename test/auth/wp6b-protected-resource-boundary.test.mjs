import assert from "node:assert/strict"
import { inspect } from "node:util"
import { test } from "node:test"
import * as Cause from "effect/Cause"
import * as Effect from "effect/Effect"
import * as Either from "effect/Either"
import * as Redacted from "effect/Redacted"
import * as Schema from "effect/Schema"

const clientSpecifier = "mcp-effect-sdk/auth/client"
const protectedSpecifier = "mcp-effect-sdk/auth/protected-resource"
const sentinel = "WP6B_BEARER_SENTINEL_64b1e8"
const protectedKeys = [
  "AuthorizationChallenge",
  "AuthorizationPolicyError",
  "AuthorizationPrincipal",
  "AuthorizationScope",
  "AuthorizationScopeSet",
  "ProtectedResourceMetadata",
  "TokenVerificationError",
  "TokenVerifier",
  "insufficientScopeChallenge",
  "unauthorizedChallenge",
  "verifyToken"
]

const load = async (specifier) => {
  try {
    return await import(specifier)
  } catch (error) {
    assert.fail(`expected ${specifier} to resolve; received ${error?.code ?? error?.name}: ${error?.message}`)
  }
}

const decode = (schema, value) => Schema.decodeUnknownSync(schema)(value)
const failsDecode = (schema, value) => Either.isLeft(Schema.decodeUnknownEither(schema)(value))

const assertClosedError = (ErrorClass, init) => {
  const hostile = {
    ...init,
    message: sentinel,
    detail: sentinel,
    cause: new Error(sentinel),
    bearerToken: sentinel,
    claims: { token: sentinel }
  }
  const error = new ErrorClass(hostile)
  const descriptor = Object.getOwnPropertyDescriptor(error, "message")
  assert.ok(descriptor)
  assert.equal(descriptor.enumerable, false)
  assert.equal(error.message.includes(sentinel), false)
  for (const key of ["detail", "cause", "bearerToken", "claims"]) {
    assert.equal(Object.hasOwn(error, key), false, `${ErrorClass.name} retained hostile ${key}`)
  }
  assert.equal(Object.keys(error).includes("message"), false)
  const encoded = Schema.encodeSync(ErrorClass)(error)
  for (const form of [JSON.stringify(error), JSON.stringify(encoded), inspect(error, { depth: 8 })]) {
    assert.equal(form.includes(sentinel), false, `${ErrorClass.name} exposed arbitrary input`)
  }
  return error
}

test("protected-resource subpath exposes exact keys and shared schemas have runtime identity", async () => {
  const Protected = await load(protectedSpecifier)
  const Client = await load(clientSpecifier)
  assert.deepEqual(Object.keys(Protected).sort(), protectedKeys)
  assert.strictEqual(Protected.AuthorizationChallenge, Client.AuthorizationChallenge)
  assert.strictEqual(Protected.AuthorizationScope, Client.AuthorizationScope)
  assert.strictEqual(Protected.AuthorizationScopeSet, Client.AuthorizationScopeSet)
  assert.strictEqual(Protected.ProtectedResourceMetadata, Client.ProtectedResourceMetadata)
  for (const forbidden of ["make", "default", "live", "layer", "OAuth", "authInfo", "verifiedAuthorizationPrincipal"]) {
    assert.equal(Object.hasOwn(Protected, forbidden), false)
  }
})

test("TokenVerifier has a stable tag and verifyToken delegates with exact success and error channels", async () => {
  const Protected = await load(protectedSpecifier)
  assert.equal(Protected.TokenVerifier.key, "mcp-effect-sdk/auth/protected-resource/TokenVerifier")
  const scopes = decode(Protected.AuthorizationScopeSet, ["tools.read"])
  const principal = decode(Protected.AuthorizationPrincipal, {
    subject: "subject-one",
    clientId: "client-one",
    issuer: "https://issuer.example",
    audiences: ["https://resource.example/mcp"],
    scopes,
    claims: { tenant: "one", nested: [true, 1, null] }
  })
  let captured
  const success = {
    verify: (request) => Effect.sync(() => {
      captured = request
      return principal
    })
  }
  const request = {
    bearerToken: Redacted.make(sentinel),
    protectedResource: "https://resource.example/mcp"
  }
  const verified = await Effect.runPromise(
    Protected.verifyToken(request).pipe(Effect.provideService(Protected.TokenVerifier, success))
  )
  assert.strictEqual(verified, principal)
  assert.strictEqual(captured, request)
  assert.equal(Redacted.isRedacted(captured.bearerToken), true)
  assert.equal(JSON.stringify(verified).includes(sentinel), false)

  const unavailable = new Protected.TokenVerificationError({ reason: "VerifierUnavailable" })
  const failure = await Effect.runPromise(Protected.verifyToken(request).pipe(
    Effect.provideService(Protected.TokenVerifier, { verify: () => Effect.fail(unavailable) }),
    Effect.either
  ))
  assert.deepEqual(failure, Either.left(unavailable))
})

test("principal decoding is strict JSON, token-free, immutable, and fail-closed", async () => {
  const Protected = await load(protectedSpecifier)
  const input = {
    subject: "subject-one",
    clientId: "client-one",
    issuer: "https://issuer.example",
    audiences: ["https://resource.example/mcp"],
    scopes: ["tools.read"],
    claims: { tenant: "one", nested: [true, 1, null] },
    bearerToken: sentinel,
    accessToken: sentinel,
    token: sentinel
  }
  const principal = decode(Protected.AuthorizationPrincipal, input)
  assert.deepEqual(Object.keys(principal).sort(), ["audiences", "claims", "clientId", "issuer", "scopes", "subject"])
  assert.equal(JSON.stringify(principal).includes(sentinel), false)
  assert.equal(Object.isFrozen(principal.audiences), true)
  assert.equal(Object.isFrozen(principal.scopes), true)
  assert.equal(Object.isFrozen(principal.claims), true)
  assert.equal(failsDecode(Protected.AuthorizationPrincipal, { ...input, subject: "" }), true)
  assert.equal(failsDecode(Protected.AuthorizationPrincipal, { ...input, claims: { execute: () => sentinel } }), true)
  assert.equal(failsDecode(Protected.AuthorizationPrincipal, { ...input, claims: { secret: Redacted.make(sentinel) } }), true)
})

test("challenge constructors produce decoded 401 and 403 values without transport behavior", async () => {
  const Protected = await load(protectedSpecifier)
  const scopes = decode(Protected.AuthorizationScopeSet, ["tools.read", "tools.write"])
  const unauthorized = Protected.unauthorizedChallenge({
    resourceMetadata: "https://resource.example/.well-known/oauth-protected-resource",
    error: "invalid_token",
    errorDescription: "Token is invalid"
  })
  assert.equal(unauthorized.scheme, "Bearer")
  assert.equal(unauthorized.status, 401)
  assert.equal(unauthorized.error, "invalid_token")
  const insufficient = Protected.insufficientScopeChallenge({
    resourceMetadata: "https://resource.example/.well-known/oauth-protected-resource",
    scopes,
    errorDescription: "Additional scope is required"
  })
  assert.equal(insufficient.scheme, "Bearer")
  assert.equal(insufficient.status, 403)
  assert.equal(insufficient.error, "insufficient_scope")
  assert.deepEqual(insufficient.scopes, scopes)
})

test("protected-resource errors are closed and expose only fixed non-enumerable messages", async () => {
  const Protected = await load(protectedSpecifier)
  const required = decode(Protected.AuthorizationScopeSet, ["tools.write"])
  const granted = decode(Protected.AuthorizationScopeSet, ["tools.read"])
  const cases = [
    [Protected.TokenVerificationError, {
      reason: "AudienceMismatch",
      issuer: "https://issuer.example",
      resource: "https://resource.example/mcp"
    }],
    [Protected.AuthorizationPolicyError, { reason: "InsufficientScope", required, granted }]
  ]
  for (const [ErrorClass, init] of cases) {
    const first = assertClosedError(ErrorClass, init)
    const second = new ErrorClass({ ...init, message: `${sentinel}-different` })
    assert.equal(second.message, first.message)
  }
})

test("verifier interruption remains interruption rather than a verification failure", async () => {
  const Protected = await load(protectedSpecifier)
  const exit = await Effect.runPromiseExit(Protected.verifyToken({
    bearerToken: Redacted.make(sentinel),
    protectedResource: "https://resource.example/mcp"
  }).pipe(Effect.provideService(Protected.TokenVerifier, { verify: () => Effect.interrupt })))
  assert.equal(exit._tag, "Failure")
  assert.equal(Cause.isInterruptedOnly(exit.cause), true)
})
