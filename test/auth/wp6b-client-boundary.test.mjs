import assert from "node:assert/strict"
import { inspect } from "node:util"
import { test } from "node:test"
import * as Cause from "effect/Cause"
import * as Effect from "effect/Effect"
import * as Either from "effect/Either"
import * as Option from "effect/Option"
import * as Redacted from "effect/Redacted"
import * as Schema from "effect/Schema"

const specifier = "mcp-effect-sdk/auth/client"
const sentinel = "WP6B_SECRET_SENTINEL_7f094d"
const clientKeys = [
  "AuthorizationCallbackInput",
  "AuthorizationChallenge",
  "AuthorizationClient",
  "AuthorizationClientStore",
  "AuthorizationCredentialHandle",
  "AuthorizationCrypto",
  "AuthorizationCryptoError",
  "AuthorizationDecodeError",
  "AuthorizationGrantHandle",
  "AuthorizationHttpClient",
  "AuthorizationHttpError",
  "AuthorizationInteraction",
  "AuthorizationInteractionError",
  "AuthorizationProtocolError",
  "AuthorizationScope",
  "AuthorizationScopeSet",
  "AuthorizationServerMetadata",
  "AuthorizationSigningKeyHandle",
  "AuthorizationStoreError",
  "AuthorizationTransactionHandle",
  "ProtectedResourceMetadata",
  "acquireAuthorization",
  "currentAuthorizationGrant",
  "respondToAuthorizationChallenge"
]

const loadClient = async () => {
  try {
    return await import(specifier)
  } catch (error) {
    assert.fail(`expected ${specifier} to resolve; received ${error?.code ?? error?.name}: ${error?.message}`)
  }
}

const decode = (schema, value) => Schema.decodeUnknownSync(schema)(value)
const failsDecode = (schema, value) => Either.isLeft(Schema.decodeUnknownEither(schema)(value))
const failsEncode = (schema, value) => Either.isLeft(Schema.encodeUnknownEither(schema)(value))

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

const assertEffect = (value, label) => {
  assert.equal(Effect.isEffect(value), true, `${label} must return Effect`)
  assert.equal(value instanceof Promise, false, `${label} must not return Promise`)
}

const assertClosedError = (ErrorClass, init) => {
  const hostile = {
    ...init,
    message: sentinel,
    detail: sentinel,
    cause: new Error(sentinel),
    accessToken: sentinel,
    requestBody: sentinel,
    responseBody: sentinel
  }
  const error = new ErrorClass(hostile)
  const descriptor = Object.getOwnPropertyDescriptor(error, "message")
  assert.ok(descriptor, `${ErrorClass.name}.message must be an own Error property`)
  assert.equal(descriptor.enumerable, false)
  assert.equal(typeof error.message, "string")
  assert.equal(error.message.includes(sentinel), false)
  for (const key of ["detail", "cause", "accessToken", "requestBody", "responseBody"]) {
    assert.equal(Object.hasOwn(error, key), false, `${ErrorClass.name} retained hostile ${key}`)
  }
  assert.equal(Object.keys(error).includes("message"), false)
  const encoded = Schema.encodeSync(ErrorClass)(error)
  for (const form of [JSON.stringify(error), JSON.stringify(encoded), inspect(error, { depth: 8 })]) {
    assert.equal(form.includes(sentinel), false, `${ErrorClass.name} exposed arbitrary input`)
  }
  return error
}

test("client subpath exposes exactly the frozen runtime boundary", async () => {
  const Client = await loadClient()
  assert.deepEqual(Object.keys(Client).sort(), clientKeys)
  for (const forbidden of ["make", "default", "live", "layer", "OAuth", "OAuthProviders", "OAuthErrors"]) {
    assert.equal(Object.hasOwn(Client, forbidden), false)
  }
})

test("all five client services use stable Context tag identities", async () => {
  const Client = await loadClient()
  assert.equal(Client.AuthorizationClient.key, "mcp-effect-sdk/auth/client/AuthorizationClient")
  assert.equal(Client.AuthorizationHttpClient.key, "mcp-effect-sdk/auth/client/AuthorizationHttpClient")
  assert.equal(Client.AuthorizationCrypto.key, "mcp-effect-sdk/auth/client/AuthorizationCrypto")
  assert.equal(Client.AuthorizationInteraction.key, "mcp-effect-sdk/auth/client/AuthorizationInteraction")
  assert.equal(Client.AuthorizationClientStore.key, "mcp-effect-sdk/auth/client/AuthorizationClientStore")
})

test("client accessors delegate to one injected service with exact success and error channels", async () => {
  const Client = await loadClient()
  const grant = decode(Client.AuthorizationGrantHandle, "grant-one")
  const scopes = decode(Client.AuthorizationScopeSet, ["tools.read"])
  const calls = []
  const denied = new Client.AuthorizationProtocolError({ reason: "AuthorizationDenied" })
  const service = {
    currentGrant: (request) => Effect.sync(() => {
      calls.push(["currentGrant", request])
      return Option.some(grant)
    }),
    acquire: (request) => Effect.sync(() => {
      calls.push(["acquire", request])
      return grant
    }),
    respondToChallenge: (request) => Effect.zipRight(
      Effect.sync(() => calls.push(["respondToChallenge", request])),
      Effect.fail(denied)
    )
  }
  const request = { protectedResource: "https://resource.example/mcp", requestedScopes: scopes }
  const current = await Effect.runPromise(
    Client.currentAuthorizationGrant(request).pipe(Effect.provideService(Client.AuthorizationClient, service))
  )
  assert.deepEqual(current, Option.some(grant))
  assert.equal(await Effect.runPromise(
    Client.acquireAuthorization(request).pipe(Effect.provideService(Client.AuthorizationClient, service))
  ), grant)
  const challenge = decode(Client.AuthorizationChallenge, {
    scheme: "Bearer",
    status: 401,
    error: "invalid_token",
    scopes: []
  })
  const failed = await Effect.runPromise(Client.respondToAuthorizationChallenge({
    protectedResource: request.protectedResource,
    challenge,
    priorGrant: grant
  }).pipe(Effect.provideService(Client.AuthorizationClient, service), Effect.either))
  assert.deepEqual(failed, Either.left(denied))
  assert.deepEqual(calls.map(([operation]) => operation), ["currentGrant", "acquire", "respondToChallenge"])
})

test("HTTP, crypto, interaction, and store ports are Effect-native and redact secret-bearing material", async () => {
  const Client = await loadClient()
  const secretText = Redacted.make(sentinel)
  const secretBytes = Redacted.make(new TextEncoder().encode(sentinel))
  const transaction = decode(Client.AuthorizationTransactionHandle, "transaction-one")
  const credential = decode(Client.AuthorizationCredentialHandle, "credential-one")
  const grant = decode(Client.AuthorizationGrantHandle, "grant-one")
  const signingKey = decode(Client.AuthorizationSigningKeyHandle, "key-one")
  const scopes = decode(Client.AuthorizationScopeSet, ["tools.read"])

  const httpRequest = {
    method: "POST",
    url: "https://issuer.example/token",
    headers: [["authorization", secretText]],
    body: secretBytes
  }
  const httpResult = Effect.succeed({ status: 200, headers: [["content-type", Redacted.make("application/json")]], body: secretBytes })
  const http = { request: (request) => (assert.deepEqual(request, httpRequest), httpResult) }
  assertEffect(http.request(httpRequest), "AuthorizationHttpClient.request")
  const response = await Effect.runPromise(http.request(httpRequest))
  assert.equal(Redacted.isRedacted(httpRequest.headers[0][1]), true)
  assert.equal(Redacted.isRedacted(httpRequest.body), true)
  assert.equal(Redacted.isRedacted(response.headers[0][1]), true)
  assert.equal(Redacted.isRedacted(response.body), true)

  const crypto = {
    randomBytes: () => Effect.succeed(new Uint8Array(32)),
    sha256: () => Effect.succeed(new Uint8Array(32)),
    sign: () => Effect.succeed(new Uint8Array(64))
  }
  assertEffect(crypto.randomBytes(32), "AuthorizationCrypto.randomBytes")
  assertEffect(crypto.sha256(new Uint8Array()), "AuthorizationCrypto.sha256")
  assertEffect(crypto.sign({ algorithm: "ES256", key: signingKey, payload: new Uint8Array() }), "AuthorizationCrypto.sign")

  const interactionRequest = {
    authorizationUri: Redacted.make(`https://issuer.example/authorize?state=${sentinel}`),
    redirectUri: "https://client.example/callback?route=one",
    transaction
  }
  const interaction = {
    open: (request) => (assert.equal(Redacted.isRedacted(request.authorizationUri), true), Effect.void),
    waitForCallback: () => Effect.never
  }
  assertEffect(interaction.open(interactionRequest), "AuthorizationInteraction.open")
  assertEffect(interaction.waitForCallback({ redirectUri: interactionRequest.redirectUri, transaction }), "AuthorizationInteraction.waitForCallback")

  const methods = {
    findCredential: () => Effect.succeed(Option.some(credential)),
    saveCredential: () => Effect.succeed(credential),
    readCredential: () => Effect.succeed({ issuer: "https://issuer.example", clientId: "client", clientSecret: secretText }),
    findGrant: () => Effect.succeed(Option.some(grant)),
    saveGrant: () => Effect.succeed(grant),
    readGrant: () => Effect.succeed({
      issuer: "https://issuer.example",
      resource: "https://resource.example/mcp",
      clientId: "client",
      scopes,
      tokenType: "Bearer",
      accessToken: secretText
    }),
    removeGrant: () => Effect.void,
    saveTransaction: () => Effect.succeed(transaction),
    takeTransaction: () => Effect.succeed({
      issuer: "https://issuer.example",
      resource: "https://resource.example/mcp",
      redirectUri: "https://client.example/callback?route=one",
      scopes,
      state: secretText,
      codeVerifier: secretText,
      createdAt: 1
    })
  }
  for (const [name, method] of Object.entries(methods)) assertEffect(method({}), `AuthorizationClientStore.${name}`)
})

test("metadata and challenge schemas decode standards fields, ignore extensions, and fail closed", async () => {
  const Client = await loadClient()
  const resource = decode(Client.ProtectedResourceMetadata, {
    resource: "https://resource.example/mcp",
    authorization_servers: ["https://issuer.example"],
    scopes_supported: ["tools.read"],
    bearer_methods_supported: ["header"],
    vendor_extension: { ignored: true }
  })
  assert.deepEqual(resource.authorizationServers, ["https://issuer.example"])
  assert.deepEqual(resource.scopesSupported, ["tools.read"])
  assert.equal(Object.hasOwn(resource, "vendor_extension"), false)

  const server = decode(Client.AuthorizationServerMetadata, {
    issuer: "https://issuer.example",
    authorization_endpoint: "https://issuer.example/authorize",
    token_endpoint: "https://issuer.example/token",
    response_types_supported: ["code"],
    grant_types_supported: ["authorization_code", "refresh_token"],
    token_endpoint_auth_methods_supported: ["client_secret_basic"],
    code_challenge_methods_supported: ["S256"]
  })
  assert.equal(server.tokenEndpoint, "https://issuer.example/token")
  assert.equal(failsDecode(Client.AuthorizationScope, "tools.read tools.write"), true)
  assert.equal(failsDecode(Client.ProtectedResourceMetadata, { resource: "https://resource.example", authorization_servers: [] }), true)
  assert.equal(failsDecode(Client.AuthorizationServerMetadata, { issuer: "https://issuer.example" }), true)
  assert.equal(failsDecode(Client.AuthorizationChallenge, { scheme: "Basic", status: 401, scopes: [] }), true)
})

test("authorization URI schemas reject bounded structural and secret-bearing hazards", async () => {
  const Client = await loadClient()
  let multiplyEncodedSecretAssignment = "token="
  for (let pass = 0; pass < 4; pass += 1) {
    multiplyEncodedSecretAssignment = multiplyEncodedSecretAssignment
      .replaceAll("%", "%25")
      .replaceAll("=", "%3D")
  }
  const invalidIdentifiers = [
    ["control-bearing path", "https://issuer.example/path\r\nnext"],
    ["oversized identifier", `https://issuer.example/${"a".repeat(2048)}`],
    ["space in authority", "https://issuer .example/path"],
    ["empty host", "https://:443/path"],
    ["non-numeric port", "https://issuer.example:not-a-port/path"],
    ["malformed bracketed host", "https://[2001:db8::1/path"],
    ["backslash", "https://issuer.example\\path"],
    ["malformed percent escape", "https://issuer.example/%ZZ"],
    ["secret-bearing path component", `https://issuer.example/token=${sentinel}`],
    ["multiply encoded secret-bearing component", `https://issuer.example/${multiplyEncodedSecretAssignment}${sentinel}`]
  ]
  const violations = []
  for (const [label, identifier] of invalidIdentifiers) {
    if (!failsDecode(Client.AuthorizationServerMetadata, {
      issuer: identifier,
      token_endpoint: "https://issuer.example/token"
    })) {
      violations.push(`${label} decoded as a safe URI`)
    }
    const error = new Client.AuthorizationProtocolError({
      reason: "IssuerMismatch",
      issuer: identifier
    })
    if (Object.hasOwn(error, "issuer")) {
      violations.push(`${label} survived diagnostic sanitization`)
    }
  }

  const redirect = decode(Client.AuthorizationCallbackInput, {
    transaction: "transaction-one",
    redirectUri: "https://client.example/callback?route=one",
    parameters: Redacted.make("")
  })
  assert.equal(redirect.redirectUri, "https://client.example/callback?route=one")
  assert.deepEqual(violations, [])
})

test("authorization URI schemas decode escapes totally and reject sensitive component families", async () => {
  const Client = await loadClient()
  const unsafeServerIdentifiers = [
    "https://issuer.example/%80",
    "https://issuer.example/%9F",
    "https://issuer.example/%C2%80",
    "https://issuer.example/%25C2%2580",
    "https://issuer.example/%C2",
    `https://issuer.example/path#secret=${sentinel}`
  ]
  const unsafeRedirects = [
    `https://client.example/callback?password=${sentinel}`,
    `https://client.example/callback?client_assertion=${sentinel}`,
    `https://client.example/callback?api_key=${sentinel}`,
    `https://client.example/callback?session-credential=${sentinel}`,
    `https://client.example/callback?oauth-token=${sentinel}`,
    `https://client.example/callback?authorization-code=${sentinel}`,
    `https://client.example/callback?pkce_verifier=${sentinel}`,
    `https://client.example/callback?request_state=${sentinel}`,
    `https://client.example/callback?session_cookie=${sentinel}`,
    `https://client.example/callback?bearer-value=${sentinel}`
  ]
  const violations = []
  for (const issuer of unsafeServerIdentifiers) {
    if (!failsDecode(Client.AuthorizationServerMetadata, {
      issuer,
      token_endpoint: "https://issuer.example/token"
    })) violations.push("unsafe server identifier decoded")
  }
  for (const redirectUri of unsafeRedirects) {
    if (!failsDecode(Client.AuthorizationCallbackInput, {
      transaction: "transaction-one",
      redirectUri,
      parameters: Redacted.make("")
    })) violations.push("sensitive redirect component decoded")
  }
  const safe = decode(Client.AuthorizationCallbackInput, {
    transaction: "transaction-one",
    redirectUri: "https://client.example/callback?route=one",
    parameters: Redacted.make("")
  })
  assert.equal(safe.redirectUri, "https://client.example/callback?route=one")
  assert.deepEqual(violations, [])
})

test("authorization URI schemas reject Unicode separators, nested assignments, and key families", async () => {
  const Client = await loadClient()
  const nested = (value, passes) => {
    let encoded = value
    for (let pass = 0; pass < passes; pass += 1) encoded = encodeURIComponent(encoded)
    return encoded
  }
  const unsafeServerIdentifiers = [
    "https://issuer.example/path\u200bsegment",
    "https://issuer.example/path%E2%80%8Bsegment",
    "https://issuer.example/path%E2%80%AEsegment",
    `https://issuer.example/path${nested("\u202e", 2)}segment`,
    "https://issuer.example/path%E2%80%A8segment",
    `https://issuer.example/path${nested("\u3000", 2)}segment`
  ]
  const unsafeRedirects = [
    `https://client.example/callback?next=${nested(`https://issuer.example/callback?access_token=${sentinel}`, 1)}`,
    `https://client.example/callback?next=${nested(`https://issuer.example/callback?access_token=${sentinel}`, 2)}`,
    `https://client.example/callback?next=${nested(`https://issuer.example/callback#private_key=${sentinel}`, 1)}`,
    `https://client.example/callback?private_key=${sentinel}`,
    `https://client.example/callback?private-key=${sentinel}`,
    `https://client.example/callback?privateKey=${sentinel}`,
    `https://client.example/callback?signing_key=${sentinel}`,
    `https://client.example/callback?signingKey=${sentinel}`,
    `https://client.example/callback?encryption-key=${sentinel}`,
    `https://client.example/callback?encryptionKey=${sentinel}`,
    `https://client.example/callback?apiKeys=${sentinel}`
  ]
  const violations = []
  for (const issuer of unsafeServerIdentifiers) {
    if (!failsDecode(Client.AuthorizationServerMetadata, {
      issuer,
      token_endpoint: "https://issuer.example/token"
    })) violations.push("Unicode-unsafe server identifier decoded")
  }
  for (const redirectUri of unsafeRedirects) {
    if (!failsDecode(Client.AuthorizationCallbackInput, {
      transaction: "transaction-one",
      redirectUri,
      parameters: Redacted.make("")
    })) violations.push("nested or key-family redirect identifier decoded")
  }
  const safe = decode(Client.AuthorizationCallbackInput, {
    transaction: "transaction-one",
    redirectUri: "https://client.example/callback?route=one&view=summary",
    parameters: Redacted.make("")
  })
  assert.equal(safe.redirectUri, "https://client.example/callback?route=one&view=summary")
  assert.deepEqual(violations, [])
})

test("authorization URI schemas reject standalone private, signing, and encryption names", async () => {
  const Client = await loadClient()
  const unsafeNames = [
    "private",
    "privates",
    "privateKey",
    "private_key",
    "private-key",
    "signing",
    "signings",
    "signingKey",
    "signing_key",
    "signing-key",
    "encryption",
    "encryptions",
    "encryptionKey",
    "encryption_key",
    "encryption-key"
  ]
  const violations = []

  for (const name of unsafeNames) {
    const identifier = `https://issuer.example/callback?${name}=${sentinel}`
    if (!failsDecode(Client.AuthorizationServerMetadata, {
      issuer: "https://issuer.example",
      token_endpoint: identifier
    })) violations.push(`${name} decoded through SafeAuthorizationUri`)
    if (!failsDecode(Client.AuthorizationCallbackInput, {
      transaction: "transaction-one",
      redirectUri: identifier,
      parameters: Redacted.make("")
    })) violations.push(`${name} decoded through SafeRedirectUri`)
  }

  const safe = decode(Client.AuthorizationCallbackInput, {
    transaction: "transaction-one",
    redirectUri: "https://client.example/callback?route=one",
    parameters: Redacted.make("")
  })
  assert.equal(safe.redirectUri, "https://client.example/callback?route=one")
  assert.deepEqual(violations, [])
})

test("client array codecs snapshot one dense descriptor view without throwing or invoking accessors", async () => {
  const Client = await loadClient()
  const cases = [
    {
      label: "scope set",
      schema: Client.AuthorizationScopeSet,
      element: "tools.read",
      wrap: (values) => values
    },
    {
      label: "protected-resource authorization servers",
      schema: Client.ProtectedResourceMetadata,
      element: "https://issuer.example",
      wrap: (values) => ({ resource: "https://resource.example/mcp", authorization_servers: values })
    },
    {
      label: "protected-resource supported scopes",
      schema: Client.ProtectedResourceMetadata,
      element: "tools.read",
      wrap: (values) => ({
        resource: "https://resource.example/mcp",
        authorization_servers: ["https://issuer.example"],
        scopes_supported: values
      })
    },
    {
      label: "protected-resource bearer methods",
      schema: Client.ProtectedResourceMetadata,
      element: "header",
      wrap: (values) => ({
        resource: "https://resource.example/mcp",
        authorization_servers: ["https://issuer.example"],
        bearer_methods_supported: values
      })
    },
    ...[
      ["response types", "response_types_supported", "code"],
      ["grant types", "grant_types_supported", "authorization_code"],
      ["token endpoint authentication methods", "token_endpoint_auth_methods_supported", "client_secret_basic"],
      ["code challenge methods", "code_challenge_methods_supported", "S256"]
    ].map(([label, key, element]) => ({
      label: `authorization-server ${label}`,
      schema: Client.AuthorizationServerMetadata,
      element,
      wrap: (values) => ({
        issuer: "https://issuer.example",
        token_endpoint: "https://issuer.example/token",
        [key]: values
      })
    })),
    {
      label: "decode error outer issues",
      schema: Client.AuthorizationDecodeError,
      element: ["issuer"],
      wrap: (values) => ({ _tag: "AuthorizationDecodeError", model: "AuthorizationServerMetadata", issues: values })
    },
    {
      label: "decode error inner path",
      schema: Client.AuthorizationDecodeError,
      element: "issuer",
      wrap: (values) => ({
        _tag: "AuthorizationDecodeError",
        model: "AuthorizationServerMetadata",
        issues: [values]
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

  const oversized = decodeWithoutThrowing(Client.ProtectedResourceMetadata, {
    resource: "https://resource.example/mcp",
    authorization_servers: ["https://issuer.example"],
    bearer_methods_supported: Array.from({ length: 4097 }, () => "header")
  })
  if (oversized.thrown || !Either.isLeft(oversized.result)) {
    violations.push("oversized public array did not fail with an ordinary Left")
  }

  assert.deepEqual(violations, [])
})

test("all client tagged errors have closed safe schemas and fixed non-enumerable messages", async () => {
  const Client = await loadClient()
  const scopes = decode(Client.AuthorizationScopeSet, ["tools.read"])
  const cases = [
    [Client.AuthorizationDecodeError, { model: "AuthorizationServerMetadata", issues: [["authorization_servers", 0]] }],
    [Client.AuthorizationHttpError, { operation: "request", status: 503, retryable: true }],
    [Client.AuthorizationCryptoError, { operation: "sha256", reason: "Failed" }],
    [Client.AuthorizationInteractionError, { operation: "open", reason: "Rejected" }],
    [Client.AuthorizationStoreError, { operation: "takeTransaction", reason: "NotFound" }],
    [Client.AuthorizationProtocolError, {
      reason: "AudienceMismatch",
      issuer: "https://issuer.example",
      resource: "https://resource.example/mcp",
      scopes,
      status: 401
    }]
  ]
  for (const [ErrorClass, init] of cases) {
    const first = assertClosedError(ErrorClass, init)
    const second = new ErrorClass({ ...init, message: `${sentinel}-different` })
    assert.equal(second.message, first.message)
  }
})

test("protocol error diagnostics drop identifiers containing userinfo, query, or fragment data", async () => {
  const Client = await loadClient()
  const cases = [
    ["issuer", `https://issuer.example/path?diagnostic=${sentinel}`],
    ["resource", `https://resource.example/mcp#${sentinel}`],
    ["issuer", `https://${sentinel}@issuer.example/path`]
  ]
  const violations = []
  for (const [field, value] of cases) {
    let error
    try {
      error = new Client.AuthorizationProtocolError({
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

test("decode error issue paths retain only closed model fields and numeric indices", async () => {
  const Client = await loadClient()
  const error = new Client.AuthorizationDecodeError({
    model: "AuthorizationPrincipal",
    issues: [
      ["subject"],
      ["authorization_servers", 0],
      ["claims", 1],
      [sentinel],
      ["claims", sentinel]
    ]
  })
  assert.deepEqual(error.issues, [
    ["subject"],
    ["authorization_servers", 0],
    ["claims", 1]
  ])
  const encoded = Schema.encodeSync(Client.AuthorizationDecodeError)(error)
  for (const form of [JSON.stringify(error), JSON.stringify(encoded), inspect(error, { depth: 8 })]) {
    assert.equal(form.includes(sentinel), false)
  }
  assert.equal(failsDecode(Client.AuthorizationDecodeError, {
    _tag: "AuthorizationDecodeError",
    model: "AuthorizationPrincipal",
    issues: [["issuer", -1]]
  }), true)
})

test("authorization scope sets and protocol error scope fields resist post-decode mutation", async () => {
  const Client = await loadClient()
  const violations = []
  const checkFrozenScopeSet = (label, scopes) => {
    const before = JSON.stringify(scopes)
    try {
      scopes.push(sentinel)
    } catch {
      // A frozen scope set rejects mutation.
    }
    if (!Object.isFrozen(scopes)) violations.push(`${label} was not frozen`)
    if (JSON.stringify(scopes) !== before) violations.push(`${label} changed after mutation`)
  }

  checkFrozenScopeSet("direct scope decode", decode(Client.AuthorizationScopeSet, ["tools.read"]))

  const constructed = new Client.AuthorizationProtocolError({
    reason: "AudienceMismatch",
    scopes: decode(Client.AuthorizationScopeSet, ["tools.read"])
  })
  checkFrozenScopeSet("constructed protocol error scopes", constructed.scopes)

  const decoded = decode(Client.AuthorizationProtocolError, {
    _tag: "AuthorizationProtocolError",
    reason: "AudienceMismatch",
    scopes: ["tools.read"]
  })
  checkFrozenScopeSet("decoded protocol error scopes", decoded.scopes)

  const frozenInvalidScopeSet = Object.freeze(["tools.read tools.write"])
  if (!failsEncode(Client.AuthorizationScopeSet, frozenInvalidScopeSet)) {
    violations.push("frozen runtime-cast invalid scope set encoded successfully")
  }

  assert.deepEqual(violations, [])
})

test("decode error issue paths resist post-validation injection after construction and decode", async () => {
  const Client = await loadClient()
  const violations = []
  const checkDeeplyFrozen = (label, error) => {
    const beforeJson = JSON.stringify(error)
    const beforeInspect = inspect(error, { depth: 8 })
    try {
      error.issues[0][0] = sentinel
    } catch {
      // A frozen issue path rejects mutation.
    }
    try {
      error.issues.push([sentinel])
    } catch {
      // A frozen outer issue list rejects mutation.
    }
    if (!Object.isFrozen(error.issues)) violations.push(`${label} outer issues were not frozen`)
    if (!error.issues.every(Object.isFrozen)) violations.push(`${label} inner issue paths were not frozen`)
    if (JSON.stringify(error) !== beforeJson) violations.push(`${label} JSON changed after mutation`)
    if (inspect(error, { depth: 8 }) !== beforeInspect) violations.push(`${label} inspection changed after mutation`)
  }

  checkDeeplyFrozen("constructed decode error", new Client.AuthorizationDecodeError({
    model: "AuthorizationPrincipal",
    issues: [["subject"]]
  }))
  checkDeeplyFrozen("decoded decode error", decode(Client.AuthorizationDecodeError, {
    _tag: "AuthorizationDecodeError",
    model: "AuthorizationPrincipal",
    issues: [["subject"]]
  }))

  assert.deepEqual(violations, [])
})

test("authorization challenge descriptions reject CR, LF, and control characters", async () => {
  const Client = await loadClient()
  for (const errorDescription of [
    `before\rafter`,
    `before\nafter`,
    `before\u0000after`,
    `before\u001fafter`,
    `before\u007fafter`
  ]) {
    assert.equal(failsDecode(Client.AuthorizationChallenge, {
      scheme: "Bearer",
      status: 401,
      error: "invalid_token",
      errorDescription,
      scopes: []
    }), true)
  }
})

test("Effect interruption crosses the client facade without becoming an authorization error", async () => {
  const Client = await loadClient()
  const scopes = decode(Client.AuthorizationScopeSet, ["tools.read"])
  const service = {
    currentGrant: () => Effect.interrupt,
    acquire: () => Effect.interrupt,
    respondToChallenge: () => Effect.interrupt
  }
  const exit = await Effect.runPromiseExit(Client.acquireAuthorization({
    protectedResource: "https://resource.example/mcp",
    requestedScopes: scopes
  }).pipe(Effect.provideService(Client.AuthorizationClient, service)))
  assert.equal(exit._tag, "Failure")
  assert.equal(Cause.isInterruptedOnly(exit.cause), true)
})
