import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"
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
  "BearerAuthorizationError",
  "ProtectedResourceMetadata",
  "TokenVerificationError",
  "TokenVerifier",
  "embedVerifiedAuthorizationPrincipal",
  "extractBearerToken",
  "insufficientScopeChallenge",
  "requireAuthorizationScopes",
  "serializeAuthorizationChallenge",
  "unauthorizedChallenge",
  "verifyBearerAuthorization",
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

const walkOwnData = (root) => {
  const output = []
  const pending = [root]
  const seen = new Set()
  while (pending.length > 0) {
    const value = pending.pop()
    if ((typeof value !== "object" || value === null) && typeof value !== "function") {
      output.push(String(value))
      continue
    }
    if (seen.has(value)) continue
    seen.add(value)
    for (const key of Reflect.ownKeys(value)) {
      output.push(String(key))
      const descriptor = Reflect.getOwnPropertyDescriptor(value, key)
      if (descriptor && "value" in descriptor) pending.push(descriptor.value)
    }
  }
  return output.join("\n")
}

const captureConstruction = (ErrorClass, props) => {
  try {
    return { error: new ErrorClass(props), thrown: false }
  } catch (error) {
    return { error, thrown: true }
  }
}

const fixedConstructorErrorMessage = "Authorization error properties are invalid"

const assertFixedConstructorFailure = (result, label, violations) => {
  if (!result.thrown) {
    violations.push(`${label} was accepted`)
    return
  }
  const error = result.error
  if (Object.getPrototypeOf(error) !== TypeError.prototype) {
    violations.push(`${label} did not throw a plain TypeError`)
  }
  if (error.message !== fixedConstructorErrorMessage) {
    violations.push(`${label} did not use the fixed constructor message`)
  }
  for (const key of ["cause", "detail", "input", "issue", "issues", "error", "errors"]) {
    if (Object.hasOwn(error, key)) violations.push(`${label} retained ${key}`)
  }
  try {
    const forms = [
      String(error),
      error.message,
      error.stack ?? "",
      inspect(error, { depth: null }),
      JSON.stringify(error) ?? "",
      walkOwnData(error)
    ]
    if (forms.some((form) => form.includes(sentinel))) {
      violations.push(`${label} retained the hostile sentinel`)
    }
  } catch {
    violations.push(`${label} could not be inspected safely`)
  }
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

test("public bearer middleware extracts Redacted tokens and composes verification with scope policy", async () => {
  const Protected = await load(protectedSpecifier)
  const missing = await Effect.runPromise(Protected.extractBearerToken(undefined).pipe(Effect.either))
  assert.equal(missing._tag, "Left")
  assert.equal(missing.left instanceof Protected.BearerAuthorizationError, true)
  assert.equal(missing.left.reason, "Missing")
  const malformed = await Effect.runPromise(Protected.extractBearerToken("Basic unsafe").pipe(Effect.either))
  assert.equal(malformed._tag, "Left")
  assert.equal(malformed.left.reason, "Malformed")

  const extracted = await Effect.runPromise(Protected.extractBearerToken(`Bearer ${sentinel}`))
  assert.equal(Redacted.isRedacted(extracted), true)
  assert.equal(Redacted.value(extracted), sentinel)
  assert.equal(inspect(extracted, { depth: 8 }).includes(sentinel), false)

  const principal = decode(Protected.AuthorizationPrincipal, {
    subject: "subject-one",
    audiences: ["https://resource.example/mcp"],
    scopes: ["tools.read"]
  })
  const verified = await Effect.runPromise(Protected.verifyBearerAuthorization({
    authorizationHeader: `Bearer ${sentinel}`,
    protectedResource: "https://resource.example/mcp",
    requiredScopes: decode(Protected.AuthorizationScopeSet, ["tools.read"])
  }).pipe(Effect.provideService(Protected.TokenVerifier, {
    verify: (request) => {
      assert.equal(Redacted.value(request.bearerToken), sentinel)
      return Effect.succeed(principal)
    }
  })))
  assert.deepEqual(verified, principal)

  const policy = await Effect.runPromise(Protected.requireAuthorizationScopes(
    principal,
    decode(Protected.AuthorizationScopeSet, ["tools.write"])
  ).pipe(Effect.either))
  assert.equal(policy._tag, "Left")
  assert.equal(policy.left instanceof Protected.AuthorizationPolicyError, true)
  assert.deepEqual(policy.left.required, ["tools.write"])
  assert.deepEqual(policy.left.granted, ["tools.read"])
})

test("public verified-principal embedding accepts only an exact token-free principal", async () => {
  const Protected = await load(protectedSpecifier)
  const exact = decode(Protected.AuthorizationPrincipal, {
    subject: "subject-one",
    clientId: "client-one",
    issuer: "https://issuer.example",
    audiences: ["https://resource.example/mcp"],
    scopes: ["tools.read"],
    claims: { tenant: "one" }
  })
  const embedded = await Effect.runPromise(
    Protected.embedVerifiedAuthorizationPrincipal(exact)
  )
  assert.deepEqual(embedded, exact)
  assert.notStrictEqual(embedded, exact)
  assert.deepEqual(
    Object.keys(embedded).sort(),
    ["audiences", "claims", "clientId", "issuer", "scopes", "subject"]
  )

  const extraOwnKey = decode(Protected.AuthorizationPrincipal, {
    subject: "subject-extra",
    audiences: ["https://resource.example/mcp"],
    scopes: ["tools.read"]
  })
  Object.defineProperty(extraOwnKey, "token", {
    configurable: true,
    enumerable: true,
    value: sentinel,
    writable: true
  })

  let accessorReads = 0
  const accessorPrincipal = Object.create(Protected.AuthorizationPrincipal.prototype)
  Object.defineProperties(accessorPrincipal, {
    subject: {
      configurable: true,
      enumerable: true,
      get: () => {
        accessorReads += 1
        return sentinel
      }
    },
    audiences: {
      configurable: true,
      enumerable: true,
      value: ["https://resource.example/mcp"],
      writable: true
    },
    scopes: {
      configurable: true,
      enumerable: true,
      value: ["tools.read"],
      writable: true
    }
  })

  const revoked = Proxy.revocable(exact, {})
  revoked.revoke()
  const rejected = [
    ["plain principal-shaped object", {
      subject: "subject-plain",
      audiences: ["https://resource.example/mcp"],
      scopes: ["tools.read"]
    }],
    ["plain token-bearing object", {
      subject: "subject-token",
      audiences: ["https://resource.example/mcp"],
      scopes: ["tools.read"],
      token: sentinel
    }],
    ["extra-own-key principal", extraOwnKey],
    ["accessor principal", accessorPrincipal],
    ["revoked principal proxy", revoked.proxy]
  ]
  const violations = []
  for (const [label, input] of rejected) {
    const result = await Effect.runPromise(
      Protected.embedVerifiedAuthorizationPrincipal(input).pipe(Effect.either)
    )
    if (!Either.isLeft(result) ||
      !(result.left instanceof Protected.TokenVerificationError) ||
      result.left.reason !== "VerifierFailure") {
      violations.push(`${label} did not fail with typed VerifierFailure`)
      continue
    }
    const rendered = [
      inspect(result.left, { depth: 8 }),
      JSON.stringify(result.left),
      walkOwnData(result.left)
    ].join("\n")
    if (rendered.includes(sentinel) || /revoked/i.test(rendered)) {
      violations.push(`${label} leaked hostile input`)
    }
  }
  if (accessorReads !== 0) violations.push("accessor principal getter was invoked")
  assert.deepEqual(violations, [])
})

test("public challenge serialization is deterministic and safely escaped", async () => {
  const Protected = await load(protectedSpecifier)
  const challenge = Protected.unauthorizedChallenge({
    resourceMetadata: "https://resource.example/.well-known/oauth-protected-resource",
    scopes: decode(Protected.AuthorizationScopeSet, ["tools.read"]),
    error: "invalid_token",
    errorDescription: "invalid \\\"token\\\""
  })
  assert.equal(
    Protected.serializeAuthorizationChallenge(challenge),
    "Bearer error=\"invalid_token\", error_description=\"invalid \\\\\\\"token\\\\\\\"\", scope=\"tools.read\", resource_metadata=\"https://resource.example/.well-known/oauth-protected-resource\""
  )
})

test("AuthorizationScope enforces the exact RFC 6750 scope-token character set", async () => {
  const Protected = await load(protectedSpecifier)
  for (const valid of ["!", "#", "[", "]", "~", "files.read:tenant/one"]) {
    assert.equal(failsDecode(Protected.AuthorizationScope, valid), false, JSON.stringify(valid))
  }
  for (const invalid of ["quote\"scope", "backslash\\scope", "nul\u0000scope", "unicode-é"]) {
    assert.equal(failsDecode(Protected.AuthorizationScope, invalid), true, JSON.stringify(invalid))
  }
})

test("Streamable HTTP reuses the public protected-resource middleware and serializer", async () => {
  const source = await readFile("src/transport/StreamableHttpServerTransport.ts", "utf8")
  assert.match(source, /embedVerifiedAuthorizationPrincipal/)
  assert.match(source, /verifyBearerAuthorization/)
  assert.match(source, /serializeAuthorizationChallenge/)
  assert.doesNotMatch(source, /exactAuthorizationPrincipal/)
  assert.doesNotMatch(source, /const bearerToken\s*=/)
  assert.doesNotMatch(source, /const challengeResponse\s*=/)
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

test("principal construction snapshots own properties and arrays before traversal", async () => {
  const Protected = await load(protectedSpecifier)
  const base = {
    subject: "subject-one",
    clientId: "client-one",
    issuer: "https://issuer.example",
    audiences: ["https://resource.example/mcp"],
    scopes: ["tools.read"],
    claims: { tenant: "one" }
  }
  const violations = []
  const construct = (props) => {
    try {
      return { principal: new Protected.AuthorizationPrincipal(props), thrown: false }
    } catch (error) {
      return { error, principal: undefined, thrown: true }
    }
  }
  const requireSafeFailure = (label, result) => {
    if (!result.thrown) {
      violations.push(`${label} was accepted`)
      return
    }
    let rendered
    try {
      rendered = inspect(result.error, { depth: 8 })
    } catch {
      violations.push(`${label} failure inspection threw`)
      return
    }
    if (rendered.includes(sentinel) || /revoked/i.test(rendered)) {
      violations.push(`${label} exposed a hostile or raw reflection failure`)
    }
  }

  let propertyAccessorReads = 0
  const accessorProps = { ...base }
  Object.defineProperty(accessorProps, "audiences", {
    enumerable: true,
    get: () => {
      propertyAccessorReads += 1
      return [sentinel]
    }
  })
  requireSafeFailure("top-level accessor", construct(accessorProps))
  if (propertyAccessorReads !== 0) violations.push("top-level accessor was invoked")

  let propertyReads = 0
  const changingProps = new Proxy(base, {
    get: (target, property, receiver) => {
      if (property === "subject") {
        propertyReads += 1
        return sentinel
      }
      return Reflect.get(target, property, receiver)
    }
  })
  const changingPrincipal = construct(changingProps)
  if (changingPrincipal.thrown || propertyReads !== 0 || changingPrincipal.principal?.subject !== "subject-one") {
    violations.push("top-level Proxy was read instead of using its data descriptors")
  }

  const revokedProps = Proxy.revocable(base, {})
  revokedProps.revoke()
  requireSafeFailure("revoked top-level properties", construct(revokedProps.proxy))

  for (const [field, element] of [
    ["audiences", "https://resource.example/mcp"],
    ["scopes", "tools.read"]
  ]) {
    requireSafeFailure(`${field} revoked array`, construct({ ...base, [field]: revokedArray([element]) }))

    const accessor = accessorArray(element)
    requireSafeFailure(`${field} accessor array`, construct({ ...base, [field]: accessor.values }))
    if (accessor.reads() !== 0) violations.push(`${field} accessor array was invoked`)

    const changing = timeVaryingArray([element])
    const changingResult = construct({ ...base, [field]: changing.values })
    if (changingResult.thrown || changing.reads() !== 0 || changingResult.principal?.[field]?.[0] !== element) {
      violations.push(`${field} time-varying array was read after its descriptor snapshot`)
    }

    let oversizeReads = 0
    const oversize = new Proxy(new Array(4097).fill(element), {
      get: (target, property, receiver) => {
        if (typeof property === "string" && /^(?:0|[1-9][0-9]*)$/.test(property)) oversizeReads += 1
        return Reflect.get(target, property, receiver)
      }
    })
    requireSafeFailure(`${field} oversize array`, construct({ ...base, [field]: oversize }))
    if (oversizeReads !== 0) violations.push(`${field} oversize array was traversed before rejection`)
  }

  const complete = construct({ ...base, subject: "" })
  if (complete.thrown || complete.principal?.subject !== "" ||
    complete.principal?.clientId !== base.clientId || complete.principal?.issuer !== base.issuer ||
    !Object.isFrozen(complete.principal?.audiences) || !Object.isFrozen(complete.principal?.scopes) ||
    !Object.isFrozen(complete.principal?.claims)) {
    violations.push("valid complete principal construction contract changed")
  }
  const minimal = construct({
    subject: "subject-one",
    audiences: ["https://resource.example/mcp"],
    scopes: ["tools.read"]
  })
  if (minimal.thrown || Object.hasOwn(minimal.principal, "clientId") ||
    Object.hasOwn(minimal.principal, "issuer") || Object.hasOwn(minimal.principal, "claims")) {
    violations.push("valid minimal principal construction contract changed")
  }

  assert.deepEqual(violations, [])
})

test("principal construction replaces rejected hostile values with one fixed error boundary", async () => {
  const Protected = await load(protectedSpecifier)
  const base = {
    subject: "subject-one",
    clientId: "client-one",
    issuer: "https://issuer.example",
    audiences: ["https://resource.example/mcp"],
    scopes: ["tools.read"],
    claims: { tenant: "one" }
  }
  const violations = []
  const construct = (props) => {
    try {
      return { principal: new Protected.AuthorizationPrincipal(props), thrown: false }
    } catch (error) {
      return { error, principal: undefined, thrown: true }
    }
  }
  const walkOwnData = (root) => {
    const output = []
    const pending = [root]
    const seen = new Set()
    while (pending.length > 0) {
      const value = pending.pop()
      if ((typeof value !== "object" || value === null) && typeof value !== "function") {
        output.push(String(value))
        continue
      }
      if (seen.has(value)) continue
      seen.add(value)
      for (const key of Reflect.ownKeys(value)) {
        output.push(String(key))
        const descriptor = Reflect.getOwnPropertyDescriptor(value, key)
        if (descriptor && "value" in descriptor) pending.push(descriptor.value)
      }
    }
    return output.join("\n")
  }

  let accessorReads = 0
  const accessorProps = { ...base }
  Object.defineProperty(accessorProps, "clientId", {
    enumerable: true,
    get: () => {
      accessorReads += 1
      return sentinel
    }
  })
  const cases = [
    ["descriptor snapshot", construct(accessorProps)],
    ["invalid clientId", construct({
      ...base,
      clientId: Object.freeze({ hostile: sentinel, nested: { [sentinel]: sentinel } })
    })],
    ["symbol audience", construct({ ...base, audiences: [Symbol(sentinel)] })]
  ]
  const messages = new Set()

  for (const [label, result] of cases) {
    if (!result.thrown) {
      violations.push(`${label} was accepted`)
      continue
    }
    const error = result.error
    if (!(error instanceof TypeError)) violations.push(`${label} did not throw TypeError`)
    messages.add(error?.message)
    for (const key of ["cause", "detail", "input", "issue", "issues", "error", "errors"]) {
      if (Object.hasOwn(error, key)) violations.push(`${label} retained ${key}`)
    }
    let forms
    try {
      forms = [
        String(error),
        error?.message ?? "",
        inspect(error, { depth: null }),
        JSON.stringify(error) ?? "",
        walkOwnData(error)
      ]
    } catch {
      violations.push(`${label} failure rendering or property walk threw`)
      continue
    }
    if (forms.some((form) => form.includes(sentinel))) {
      violations.push(`${label} retained the hostile sentinel`)
    }
  }

  if (accessorReads !== 0) violations.push("descriptor snapshot invoked the hostile accessor")
  if (messages.size !== 1) violations.push("descriptor and validation failures did not share one fixed message")
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
    [Protected.BearerAuthorizationError, { reason: "Malformed" }],
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

test("reason-derived tagged errors build messages from one validated own-data snapshot", async () => {
  const Client = await load(clientSpecifier)
  const Protected = await load(protectedSpecifier)
  const cases = [
    [Client.AuthorizationCryptoError, { operation: "sha256", reason: "Failed" }, "Authorization cryptography failed"],
    [Client.AuthorizationInteractionError, { operation: "open", reason: "Rejected" }, "Authorization interaction Rejected"],
    [Client.AuthorizationStoreError, { operation: "findCredential", reason: "NotFound" }, "Authorization store NotFound"],
    [Client.AuthorizationProtocolError, { reason: "AudienceMismatch" }, "Authorization protocol AudienceMismatch"],
    [Protected.TokenVerificationError, { reason: "Invalid" }, "Token verification Invalid"]
  ]
  const violations = []

  for (const [ErrorClass, init, expectedMessage] of cases) {
    let accessorReads = 0
    const accessorProps = { ...init }
    Object.defineProperty(accessorProps, "reason", {
      enumerable: true,
      get: () => {
        accessorReads += 1
        return sentinel
      }
    })
    assertFixedConstructorFailure(
      captureConstruction(ErrorClass, accessorProps),
      `${ErrorClass.name} reason accessor`,
      violations
    )
    if (accessorReads !== 0) violations.push(`${ErrorClass.name} invoked its reason accessor`)

    let proxyReads = 0
    const changingProps = new Proxy(init, {
      get: (target, property, receiver) => {
        if (property === "reason") {
          proxyReads += 1
          return proxyReads === 1 ? target.reason : sentinel
        }
        return Reflect.get(target, property, receiver)
      }
    })
    const changing = captureConstruction(ErrorClass, changingProps)
    if (changing.thrown) {
      violations.push(`${ErrorClass.name} rejected a valid descriptor snapshot`)
    } else if (changing.error.message !== expectedMessage || changing.error.message.includes(sentinel)) {
      violations.push(`${ErrorClass.name} built its message from a later reason read`)
    }
    if (proxyReads !== 0) violations.push(`${ErrorClass.name} re-read reason through the Proxy`)
  }

  assert.deepEqual(violations, [])
})

test("all tagged-error constructors replace rejected known fields with one closed error boundary", async () => {
  const Client = await load(clientSpecifier)
  const Protected = await load(protectedSpecifier)
  const cases = [
    [Client.AuthorizationDecodeError, "model", { model: "AuthorizationPrincipal", issues: [] }],
    [Client.AuthorizationHttpError, "operation", { operation: "request", retryable: true }],
    [Client.AuthorizationCryptoError, "operation", { operation: "sha256", reason: "Failed" }],
    [Client.AuthorizationInteractionError, "operation", { operation: "open", reason: "Rejected" }],
    [Client.AuthorizationStoreError, "operation", { operation: "findCredential", reason: "NotFound" }],
    [Client.AuthorizationProtocolError, "reason", { reason: "AudienceMismatch" }],
    [Protected.TokenVerificationError, "reason", { reason: "Invalid" }],
    [Protected.AuthorizationPolicyError, "reason", {
      reason: "InsufficientScope",
      required: [],
      granted: []
    }]
  ]
  const violations = []
  const failures = []

  for (const [ErrorClass, field, init] of cases) {
    const invalid = captureConstruction(ErrorClass, { ...init, [field]: `${sentinel}-${ErrorClass.name}` })
    const repeated = captureConstruction(ErrorClass, { ...init, [field]: `${sentinel}-${ErrorClass.name}` })
    assertFixedConstructorFailure(invalid, `${ErrorClass.name} invalid ${field}`, violations)
    assertFixedConstructorFailure(repeated, `${ErrorClass.name} repeated invalid ${field}`, violations)
    if (invalid.error === repeated.error) violations.push(`${ErrorClass.name} reused a constructor failure`)
    failures.push(invalid.error, repeated.error)

    let accessorReads = 0
    const accessorProps = { ...init }
    Object.defineProperty(accessorProps, field, {
      enumerable: true,
      get: () => {
        accessorReads += 1
        return sentinel
      }
    })
    const accessor = captureConstruction(ErrorClass, accessorProps)
    assertFixedConstructorFailure(accessor, `${ErrorClass.name} ${field} accessor`, violations)
    if (accessorReads !== 0) violations.push(`${ErrorClass.name} invoked its ${field} accessor`)
    failures.push(accessor.error)

    let unknownReads = 0
    const unknownProps = { ...init }
    Object.defineProperty(unknownProps, "hostileUnknownField", {
      enumerable: true,
      get: () => {
        unknownReads += 1
        return sentinel
      }
    })
    const accepted = captureConstruction(ErrorClass, unknownProps)
    if (accepted.thrown) violations.push(`${ErrorClass.name} rejected an unknown accessor`)
    if (unknownReads !== 0) violations.push(`${ErrorClass.name} invoked an unknown accessor`)
    if (!accepted.thrown && Object.hasOwn(accepted.error, "hostileUnknownField")) {
      violations.push(`${ErrorClass.name} retained an unknown accessor`)
    }
  }

  const revoked = Proxy.revocable({ operation: "request", retryable: true }, {})
  revoked.revoke()
  const reflection = captureConstruction(Client.AuthorizationHttpError, revoked.proxy)
  assertFixedConstructorFailure(reflection, "AuthorizationHttpError revoked reflection", violations)
  failures.push(reflection.error)

  if (new Set(failures.map((error) => error?.message)).size !== 1) {
    violations.push("constructor failures did not share one fixed message")
  }
  assert.deepEqual(violations, [])
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
