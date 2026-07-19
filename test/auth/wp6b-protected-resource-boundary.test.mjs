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

const decodeWithoutThrowing = (schema, value) => {
  try {
    return { result: Schema.decodeUnknownEither(schema)(value), thrown: false }
  } catch (error) {
    return { error, result: undefined, thrown: true }
  }
}

const revokedArray = (values) => {
  const revocable = Proxy.revocable(values, {})
  revocable.revoke()
  return revocable.proxy
}

const accessorArray = (value) => {
  let reads = 0
  const values = []
  Object.defineProperty(values, "0", {
    configurable: true,
    enumerable: true,
    get: () => {
      reads += 1
      return value
    }
  })
  return { reads: () => reads, values }
}

const timeVaryingArray = (values) => {
  let reads = 0
  const proxy = new Proxy(values, {
    get: (target, property, receiver) => {
      if (typeof property === "string" && /^(?:0|[1-9][0-9]*)$/.test(property)) {
        reads += 1
        return sentinel
      }
      return Reflect.get(target, property, receiver)
    }
  })
  return { reads: () => reads, values: proxy }
}

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
  assert.equal(decode(Protected.AuthorizationPrincipal, { ...input, subject: "" }).subject, "")
  assert.equal(failsDecode(Protected.AuthorizationPrincipal, { ...input, claims: { execute: () => sentinel } }), true)
  assert.equal(failsDecode(Protected.AuthorizationPrincipal, { ...input, claims: { secret: Redacted.make(sentinel) } }), true)
})

test("principal and policy array codecs use descriptor-safe snapshots", async () => {
  const Protected = await load(protectedSpecifier)
  const cases = [
    {
      label: "principal audiences",
      schema: Protected.AuthorizationPrincipal,
      element: "https://resource.example/mcp",
      wrap: (values) => ({ subject: "subject-one", audiences: values, scopes: ["tools.read"] })
    },
    {
      label: "principal scopes",
      schema: Protected.AuthorizationPrincipal,
      element: "tools.read",
      wrap: (values) => ({
        subject: "subject-one",
        audiences: ["https://resource.example/mcp"],
        scopes: values
      })
    },
    {
      label: "policy required scopes",
      schema: Protected.AuthorizationPolicyError,
      element: "tools.write",
      wrap: (values) => ({
        _tag: "AuthorizationPolicyError",
        reason: "InsufficientScope",
        required: values,
        granted: ["tools.read"]
      })
    },
    {
      label: "policy granted scopes",
      schema: Protected.AuthorizationPolicyError,
      element: "tools.read",
      wrap: (values) => ({
        _tag: "AuthorizationPolicyError",
        reason: "InsufficientScope",
        required: ["tools.write"],
        granted: values
      })
    }
  ]
  const violations = []

  for (const { label, schema, element, wrap } of cases) {
    const revoked = decodeWithoutThrowing(schema, wrap(revokedArray([element])))
    if (revoked.thrown || !Either.isLeft(revoked.result)) {
      violations.push(`${label} revoked Proxy did not return an ordinary Left`)
    }

    const accessor = accessorArray(element)
    const accessorDecoded = decodeWithoutThrowing(schema, wrap(accessor.values))
    if (accessorDecoded.thrown || !Either.isLeft(accessorDecoded.result) || accessor.reads() !== 0) {
      violations.push(`${label} accessor was invoked or did not return an ordinary Left`)
    }
    try {
      if (inspect(accessorDecoded.result, { depth: 8 }).includes(sentinel)) {
        violations.push(`${label} parse failure retained hostile input`)
      }
    } catch {
      violations.push(`${label} parse failure inspection threw`)
    }

    const changing = timeVaryingArray([element])
    const changingDecoded = decodeWithoutThrowing(schema, wrap(changing.values))
    if (changingDecoded.thrown || Either.isLeft(changingDecoded.result) || changing.reads() !== 0) {
      violations.push(`${label} did not decode from one descriptor snapshot`)
    }
  }

  assert.deepEqual(violations, [])
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

test("policy error scope fields remain frozen after construction and schema decode", async () => {
  const Protected = await load(protectedSpecifier)
  const violations = []
  const checkFrozen = (label, error) => {
    const before = JSON.stringify(error)
    for (const field of ["required", "granted"]) {
      try {
        error[field].push(sentinel)
      } catch {
        // Frozen policy scope sets reject mutation.
      }
      if (!Object.isFrozen(error[field])) violations.push(`${label} ${field} was not frozen`)
    }
    if (JSON.stringify(error) !== before) violations.push(`${label} changed after mutation`)
  }

  checkFrozen("constructed policy error", new Protected.AuthorizationPolicyError({
    reason: "InsufficientScope",
    required: decode(Protected.AuthorizationScopeSet, ["tools.write"]),
    granted: decode(Protected.AuthorizationScopeSet, ["tools.read"])
  }))
  checkFrozen("decoded policy error", decode(Protected.AuthorizationPolicyError, {
    _tag: "AuthorizationPolicyError",
    reason: "InsufficientScope",
    required: ["tools.write"],
    granted: ["tools.read"]
  }))

  assert.deepEqual(violations, [])
})

test("verification errors drop identifiers containing userinfo, query, or fragment data", async () => {
  const Protected = await load(protectedSpecifier)
  const cases = [
    ["issuer", `https://issuer.example/path?diagnostic=${sentinel}`],
    ["resource", `https://resource.example/mcp#${sentinel}`],
    ["issuer", `https://${sentinel}@issuer.example/path`]
  ]
  const violations = []
  for (const [field, value] of cases) {
    let error
    try {
      error = new Protected.TokenVerificationError({
        reason: "AudienceMismatch",
        [field]: value
      })
    } catch {
      continue
    }
    if (Object.hasOwn(error, field)) violations.push(`${field} retained an unsafe identifier`)
    for (const form of [JSON.stringify(error), inspect(error, { depth: 8 })]) {
      if (form.includes(sentinel)) violations.push(`${field} exposed an unsafe identifier`)
    }
  }
  assert.deepEqual(violations, [])
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

test("principal claim decoding is total and snapshots descriptor-safe JSON without invoking accessors", async () => {
  const Protected = await load(protectedSpecifier)
  const principalWithClaims = (claims) => ({
    subject: "subject-one",
    audiences: ["https://resource.example/mcp"],
    scopes: ["tools.read"],
    claims
  })
  const decodeClaims = (claims) => {
    try {
      return {
        result: Schema.decodeUnknownEither(Protected.AuthorizationPrincipal)(principalWithClaims(claims)),
        thrown: false
      }
    } catch {
      return { result: undefined, thrown: true }
    }
  }
  const violations = []

  const revoked = Proxy.revocable({ safe: "value" }, {})
  revoked.revoke()
  const revokedDecoded = decodeClaims(revoked.proxy)
  if (revokedDecoded.thrown || !Either.isLeft(revokedDecoded.result)) {
    violations.push("revoked Proxy did not return an ordinary Left")
  }

  let accessorReads = 0
  const accessorClaims = {}
  Object.defineProperty(accessorClaims, "secret", {
    enumerable: true,
    get: () => {
      accessorReads += 1
      return sentinel
    }
  })
  const accessorDecoded = decodeClaims(accessorClaims)
  if (accessorDecoded.thrown || !Either.isLeft(accessorDecoded.result) || accessorReads !== 0) {
    violations.push("accessor claim was invoked or did not return an ordinary Left")
  }

  let dynamicReads = 0
  const changingClaims = new Proxy({ stable: "descriptor-safe" }, {
    get: (target, property, receiver) => {
      if (property === "stable") {
        dynamicReads += 1
        return sentinel
      }
      return Reflect.get(target, property, receiver)
    },
    getOwnPropertyDescriptor: (target, property) => {
      if (property === "stable") {
        return {
          configurable: true,
          enumerable: true,
          value: "descriptor-safe",
          writable: true
        }
      }
      return Reflect.getOwnPropertyDescriptor(target, property)
    }
  })
  const changingDecoded = decodeClaims(changingClaims)
  const changingSnapshotIsSafe = Either.isRight(changingDecoded.result) &&
    changingDecoded.result.right.claims?.stable === "descriptor-safe" &&
    Object.isFrozen(changingDecoded.result.right.claims)
  if (changingDecoded.thrown || dynamicReads !== 0 ||
    (!Either.isLeft(changingDecoded.result) && !changingSnapshotIsSafe)) {
    violations.push("time-varying Proxy was read after validation or retained its later value")
  }

  const cyclicClaims = {}
  cyclicClaims.self = cyclicClaims
  const sparseClaims = new Array(1)
  const customPrototypeClaims = Object.assign(Object.create({ inherited: true }), { safe: "value" })
  for (const [label, claims] of [
    ["cyclic", cyclicClaims],
    ["sparse", sparseClaims],
    ["custom-prototype", customPrototypeClaims]
  ]) {
    const decoded = decodeClaims(claims)
    if (decoded.thrown || !Either.isLeft(decoded.result)) {
      violations.push(`${label} claims did not return an ordinary Left`)
    }
  }

  assert.deepEqual(violations, [])
})
