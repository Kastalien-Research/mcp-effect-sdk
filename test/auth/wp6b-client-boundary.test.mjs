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
