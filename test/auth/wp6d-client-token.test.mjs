import assert from "node:assert/strict"
import { inspect } from "node:util"
import test from "node:test"
import * as Cause from "effect/Cause"
import * as Clock from "effect/Clock"
import * as Effect from "effect/Effect"
import * as Exit from "effect/Exit"
import * as Option from "effect/Option"
import * as Redacted from "effect/Redacted"
import * as Schema from "effect/Schema"

const encoder = new TextEncoder()
const decoder = new TextDecoder("utf-8", { fatal: true })
const tokenSecret = "WP6D_OPAQUE_TOKEN_SECRET_6d217a"
const refreshSecret = "WP6D_REFRESH_SECRET_937cf1"
const codeSecret = "WP6D_CODE_SECRET_12e8a9"
const clientAuthSecret = "WP6D_CLIENT_AUTH_SECRET_449ab2"
const stateSecret = "S".repeat(43)
const verifierSecret = "V".repeat(43)

const loadWp6d = async () => {
  const token = await import("../../dist/auth/client/token.js")
  const transaction = await import("../../dist/auth/client/transaction.js")
  const client = await import("../../dist/auth/client.js")
  return { client, token, transaction }
}

const scopes = (client, values = ["tools.read", "tools.write"]) =>
  Schema.decodeUnknownSync(client.AuthorizationScopeSet)(values)

const credentialHandle = (client, value = "credential-wp6d") =>
  Schema.decodeUnknownSync(client.AuthorizationCredentialHandle)(value)

const grantHandle = (client, value = "grant-wp6d") =>
  Schema.decodeUnknownSync(client.AuthorizationGrantHandle)(value)

const transactionHandle = (client) =>
  Schema.decodeUnknownSync(client.AuthorizationTransactionHandle)("transaction-wp6d")

const metadata = (client, issuer = "https://issuer.example", responseIssSupported, overrides = {}) =>
  Schema.decodeUnknownSync(client.AuthorizationServerMetadata)({
    issuer,
    authorization_endpoint: `${issuer}/authorize`,
    token_endpoint: `${issuer}/token`,
    code_challenge_methods_supported: ["S256"],
    ...(responseIssSupported === undefined
      ? {}
      : { authorization_response_iss_parameter_supported: responseIssSupported }),
    ...overrides
  })

const authorization = (client, overrides = {}) => ({
  issuer: "https://issuer.example",
  resource: "https://resource.example/mcp",
  credentialHandle: credentialHandle(client),
  clientId: "wp6d-client",
  redirectUri: "https://client.example/callback?route=complete",
  scopes: scopes(client),
  authorizationCode: Redacted.make(codeSecret),
  codeVerifier: Redacted.make(verifierSecret),
  ...overrides
})

const storedGrant = (client, overrides = {}) => ({
  issuer: "https://issuer.example",
  resource: "https://resource.example/mcp",
  clientId: "wp6d-client",
  scopes: scopes(client),
  tokenType: "Bearer",
  accessToken: Redacted.make("old-access-token"),
  refreshToken: Redacted.make(refreshSecret),
  ...overrides
})

const storedTransaction = (client, overrides = {}) => ({
  issuer: "https://issuer.example",
  resource: "https://resource.example/mcp",
  credentialHandle: credentialHandle(client),
  clientId: "wp6d-client",
  authorizationResponseIssParameterRequired: true,
  redirectUri: "https://client.example/callback?route=complete",
  scopes: scopes(client),
  state: Redacted.make(stateSecret),
  codeVerifier: Redacted.make(verifierSecret),
  createdAt: 123,
  ...overrides
})

const callback = (client, parameters, overrides = {}) => Schema.decodeUnknownSync(
  client.AuthorizationCallbackInput
)({
  transaction: transactionHandle(client),
  redirectUri: "https://client.example/callback?route=complete",
  parameters: Redacted.make(parameters),
  ...overrides
})

const jsonResponse = (body, status = 200) => ({
  status,
  headers: [["content-type", Redacted.make("application/json")]],
  body: Redacted.make(encoder.encode(JSON.stringify(body)))
})

const makeHttp = (respond) => {
  const requests = []
  return {
    requests,
    service: {
      request: (request) => {
        requests.push(request)
        return Effect.suspend(() => respond(request, requests.length - 1))
      }
    }
  }
}

const makeStore = (client, options = {}, events = []) => {
  const calls = []
  const saved = []
  let transaction = options.transaction
  return {
    calls,
    saved,
    service: {
      findCredential: (key) => Effect.sync(() => {
        calls.push(["findCredential", key])
        events.push("store:findCredential")
        if (Object.prototype.hasOwnProperty.call(options, "findCredentialResult")) {
          return options.findCredentialResult
        }
        return options.missingCredential
          ? Option.none()
          : Option.some(options.credentialHandle ?? credentialHandle(client))
      }),
      readCredential: (handle) => Effect.sync(() => {
        calls.push(["readCredential", handle])
        events.push("store:readCredential")
        return options.credentials?.get(handle) ?? options.credential ?? {
          issuer: "https://issuer.example",
          clientId: "wp6d-client",
          clientSecret: Redacted.make("synthetic-client-secret")
        }
      }),
      readGrant: (handle) => Effect.sync(() => {
        calls.push(["readGrant", handle])
        events.push("store:readGrant")
        return options.grant ?? storedGrant(client)
      }),
      saveGrant: (value) => Effect.sync(() => {
        calls.push(["saveGrant", value])
        events.push("store:saveGrant")
        saved.push(value)
        return options.savedHandle ?? grantHandle(client)
      }),
      saveTransaction: (value) => Effect.sync(() => {
        calls.push(["saveTransaction", value])
        events.push("store:saveTransaction")
        transaction = value
        return transactionHandle(client)
      }),
      takeTransaction: (handle) => Effect.suspend(() => {
        calls.push(["takeTransaction", handle])
        events.push("store:takeTransaction")
        if (transaction === undefined) {
          return Effect.fail(new client.AuthorizationStoreError({
            operation: "takeTransaction",
            reason: "NotFound"
          }))
        }
        const value = transaction
        transaction = undefined
        return Effect.succeed(value)
      })
    }
  }
}

const providePorts = (effect, client, http, store) => effect.pipe(
  Effect.provideService(client.AuthorizationHttpClient, http.service),
  Effect.provideService(client.AuthorizationClientStore, store.service)
)

const fixedClock = (milliseconds) => ({
  [Clock.ClockTypeId]: Clock.ClockTypeId,
  currentTimeMillis: Effect.succeed(milliseconds),
  currentTimeNanos: Effect.succeed(BigInt(milliseconds) * 1_000_000n),
  sleep: () => Effect.void,
  unsafeCurrentTimeMillis: () => milliseconds,
  unsafeCurrentTimeNanos: () => BigInt(milliseconds) * 1_000_000n
})

const runFailure = async (effect) => {
  const result = await Effect.runPromise(Effect.either(effect))
  if (result._tag === "Right") assert.fail("expected token operation to fail")
  return result.left
}

const formBody = (request) => {
  assert.equal(request.method, "POST")
  assert.equal(Redacted.isRedacted(request.body), true)
  return new URLSearchParams(decoder.decode(Redacted.value(request.body)))
}

const recursivelyContains = (value, sentinel, seen = new Set()) => {
  if (typeof value === "string") return value.includes(sentinel)
  if ((typeof value !== "object" && typeof value !== "function") || value === null) return false
  if (seen.has(value)) return false
  seen.add(value)
  let keys
  try {
    keys = Reflect.ownKeys(value)
  } catch {
    return false
  }
  for (const key of keys) {
    let descriptor
    try {
      descriptor = Reflect.getOwnPropertyDescriptor(value, key)
    } catch {
      continue
    }
    if (descriptor !== undefined && "value" in descriptor &&
      recursivelyContains(descriptor.value, sentinel, seen)) return true
  }
  return false
}

const assertSecretsAbsent = (error, sentinels) => {
  const rendered = [String(error), inspect(error, { depth: 8 })]
  try {
    rendered.push(JSON.stringify(error))
  } catch {
    // Secret safety does not require JSON serialization.
  }
  for (const sentinel of sentinels) {
    assert.equal(recursivelyContains(error, sentinel), false, sentinel)
    assert.equal(rendered.join(" ").includes(sentinel), false, sentinel)
  }
}

test("authorization-code exchange sends exact code, verifier, redirect, and resource before persisting audience-validated opaque tokens", async () => {
  const { client, token: { exchangeAuthorizationCode } } = await loadWp6d()
  const issuer = "https://issuer.example"
  const events = []
  const http = makeHttp(() => Effect.sync(() => {
    events.push("http:token")
    return jsonResponse({
      access_token: tokenSecret,
      token_type: "Bearer",
      refresh_token: refreshSecret
    })
  }))
  const store = makeStore(client, {}, events)
  let validationInput
  const validateAudience = (input) => Effect.sync(() => {
    events.push("validate:audience")
    validationInput = input
    return Object.freeze(["https://resource.example/mcp"])
  })

  const result = await Effect.runPromise(providePorts(exchangeAuthorizationCode({
    authorization: authorization(client),
    authorizationServerMetadata: metadata(client, issuer),
    validateAudience
  }), client, http, store))

  assert.equal(result, grantHandle(client))
  assert.deepEqual(store.calls[0], ["readCredential", credentialHandle(client)])
  assert.equal(http.requests.length, 1)
  assert.equal(http.requests[0].url, `${issuer}/token`)
  assert.equal(Redacted.isRedacted(http.requests[0].headers[0][1]), true)
  assert.equal(Redacted.value(http.requests[0].headers[0][1]), "application/x-www-form-urlencoded")
  const body = formBody(http.requests[0])
  assert.deepEqual([...body.keys()].sort(), [
    "client_id",
    "client_secret",
    "code",
    "code_verifier",
    "grant_type",
    "redirect_uri",
    "resource"
  ])
  assert.equal(body.get("grant_type"), "authorization_code")
  assert.equal(body.get("code"), codeSecret)
  assert.equal(body.get("code_verifier"), verifierSecret)
  assert.equal(body.get("redirect_uri"), "https://client.example/callback?route=complete")
  assert.equal(body.get("resource"), "https://resource.example/mcp")
  assert.equal(body.get("client_id"), "wp6d-client")
  assert.equal(body.get("client_secret"), "synthetic-client-secret")

  assert.deepEqual(Object.keys(validationInput).sort(), ["issuer", "resource", "token"])
  assert.equal(validationInput.issuer, issuer)
  assert.equal(validationInput.resource, "https://resource.example/mcp")
  assert.equal(Redacted.isRedacted(validationInput.token), true)
  assert.equal(Redacted.value(validationInput.token), tokenSecret)
  assert.deepEqual(events, [
    "store:readCredential",
    "http:token",
    "validate:audience",
    "store:saveGrant"
  ])
  assert.equal(store.saved.length, 1)
  assert.equal(store.saved[0].issuer, issuer)
  assert.equal(store.saved[0].resource, "https://resource.example/mcp")
  assert.equal(Redacted.isRedacted(store.saved[0].accessToken), true)
  assert.equal(Redacted.value(store.saved[0].accessToken), tokenSecret)
  assert.equal(Redacted.isRedacted(store.saved[0].refreshToken), true)
  assert.equal(Redacted.value(store.saved[0].refreshToken), refreshSecret)
  assert.equal(store.saved[0].expiresAt, undefined)
})

test("authorization code exchange remains bound to the exact start credential among same-issuer clients", async () => {
  const {
    client,
    token: { exchangeAuthorizationCode },
    transaction: { completeAuthorizationCallback, startAuthorizationTransaction }
  } = await loadWp6d()
  const issuer = "https://issuer.example"
  const handleA = credentialHandle(client, "credential-client-a")
  const handleB = credentialHandle(client, "credential-client-b")
  const credentials = new Map([
    [handleA, { issuer, clientId: "client-a", clientSecret: Redacted.make("secret-a") }],
    [handleB, { issuer, clientId: "client-b", clientSecret: Redacted.make("secret-b") }]
  ])
  const store = makeStore(client, {
    credentialHandle: handleB,
    credentials
  })
  let randomCall = 0
  const crypto = {
    randomBytes: (length) => Effect.sync(() => {
      randomCall += 1
      return new Uint8Array(length).fill(randomCall)
    }),
    sha256: () => Effect.succeed(new Uint8Array(32).fill(3)),
    sign: () => Effect.die("sign is not part of PKCE")
  }
  const serverMetadata = metadata(client, issuer, true)
  const started = await Effect.runPromise(startAuthorizationTransaction({
    authorizationServerMetadata: serverMetadata,
    issuer,
    canonicalResource: "https://resource.example/mcp",
    credentialHandle: handleA,
    scopes: scopes(client),
    redirectUri: "https://client.example/callback?route=complete",
    createdAt: 123
  }).pipe(
    Effect.provideService(client.AuthorizationCrypto, crypto),
    Effect.provideService(client.AuthorizationClientStore, store.service)
  ))
  const authorizationUri = new URL(Redacted.value(started.authorizationUri))
  assert.equal(authorizationUri.searchParams.get("client_id"), "client-a")
  const savedTransaction = store.calls.find(([operation]) => operation === "saveTransaction")?.[1]
  assert.ok(savedTransaction)
  assert.equal(savedTransaction.credentialHandle, handleA)

  const completed = await Effect.runPromise(completeAuthorizationCallback({
    callback: callback(client, new URLSearchParams({
      code: codeSecret,
      state: Redacted.value(savedTransaction.state),
      iss: issuer
    }).toString()),
    authorizationServerMetadata: serverMetadata
  }).pipe(Effect.provideService(client.AuthorizationClientStore, store.service)))
  assert.equal(completed.credentialHandle, handleA)

  store.calls.length = 0
  const http = makeHttp(() => Effect.succeed(jsonResponse({
    access_token: tokenSecret,
    token_type: "Bearer"
  })))
  await Effect.runPromise(providePorts(exchangeAuthorizationCode({
    authorization: completed,
    authorizationServerMetadata: serverMetadata,
    validateAudience: ({ resource }) => Effect.succeed(Object.freeze([resource]))
  }), client, http, store))

  assert.equal(formBody(http.requests[0]).get("client_id"), "client-a")
  assert.deepEqual(store.calls.map(([operation, value]) => [operation, value]), [
    ["readCredential", handleA],
    ["saveGrant", store.saved[0]]
  ])
  assert.equal(store.calls.some(([operation]) => operation === "findCredential"), false)
})

test("refresh is issuer-partitioned, sends the RFC 8707 resource, and preserves an unrotated refresh token", async () => {
  const { client, token: { refreshAuthorizationGrant } } = await loadWp6d()
  const issuer = "https://issuer.example"
  const prior = grantHandle(client, "prior-grant")
  const next = grantHandle(client, "refreshed-grant")
  const events = []
  const http = makeHttp(() => Effect.sync(() => {
    events.push("http:refresh")
    return jsonResponse({ access_token: tokenSecret, token_type: "Bearer" })
  }))
  const store = makeStore(client, { savedHandle: next }, events)

  const result = await Effect.runPromise(providePorts(refreshAuthorizationGrant({
    grant: prior,
    authorizationServerMetadata: metadata(client, issuer),
    validateAudience: ({ token, issuer: validatedIssuer, resource }) => {
      assert.equal(Redacted.isRedacted(token), true)
      assert.equal(validatedIssuer, issuer)
      assert.equal(resource, "https://resource.example/mcp")
      events.push("validate:audience")
      return Effect.succeed(Object.freeze([resource]))
    }
  }), client, http, store))

  assert.equal(result, next)
  assert.deepEqual(store.calls.map(([operation]) => operation), [
    "readGrant",
    "findCredential",
    "readCredential",
    "saveGrant"
  ])
  assert.deepEqual(store.calls[1][1], { issuer, clientId: "wp6d-client" })
  const body = formBody(http.requests[0])
  assert.equal(body.get("grant_type"), "refresh_token")
  assert.equal(body.get("refresh_token"), refreshSecret)
  assert.equal(body.get("resource"), "https://resource.example/mcp")
  assert.equal(body.get("client_id"), "wp6d-client")
  assert.equal(Redacted.value(store.saved[0].refreshToken), refreshSecret)
  assert.deepEqual(events, [
    "store:readGrant",
    "store:findCredential",
    "store:readCredential",
    "http:refresh",
    "validate:audience",
    "store:saveGrant"
  ])
})

test("token expiry uses the Effect Clock when receivedAt is absent and accepts immediate zero-second expiry", async () => {
  const { client, token: { exchangeAuthorizationCode } } = await loadWp6d()
  const now = 1_724_000_000_123
  const fixtures = [
    { name: "positive lifetime", expiresIn: 60, expected: now + 60_000 },
    { name: "immediate expiry", expiresIn: 0, expected: now }
  ]
  const outcomes = []

  for (const fixture of fixtures) {
    const http = makeHttp(() => Effect.succeed(jsonResponse({
      access_token: tokenSecret,
      token_type: "Bearer",
      expires_in: fixture.expiresIn
    })))
    const store = makeStore(client)
    const result = await Effect.runPromise(Effect.either(providePorts(exchangeAuthorizationCode({
      authorization: authorization(client),
      authorizationServerMetadata: metadata(client),
      validateAudience: ({ resource }) => Effect.succeed(Object.freeze([resource]))
    }), client, http, store).pipe(
      Effect.provideService(Clock.Clock, fixedClock(now))
    )))
    outcomes.push({ fixture, result, store })
  }

  assert.deepEqual(outcomes.map(({ fixture, result, store }) => ({
    name: fixture.name,
    result: result._tag,
    saved: store.saved.length,
    expiresAt: store.saved[0]?.expiresAt,
    bounded: Number.isSafeInteger(store.saved[0]?.expiresAt)
  })), fixtures.map((fixture) => ({
    name: fixture.name,
    result: "Right",
    saved: 1,
    expiresAt: fixture.expected,
    bounded: true
  })))
})

test("Bearer token types are case-insensitive and canonical while non-Bearer responses and grants fail before downstream work", async () => {
  const { client, token: { exchangeAuthorizationCode, refreshAuthorizationGrant } } = await loadWp6d()

  const mixedCaseHttp = makeHttp(() => Effect.succeed(jsonResponse({
    access_token: tokenSecret,
    token_type: "bEaReR"
  })))
  const mixedCaseStore = makeStore(client)
  let mixedCaseAudienceCalls = 0
  const mixedCaseResult = await Effect.runPromise(Effect.either(providePorts(
    exchangeAuthorizationCode({
      authorization: authorization(client),
      authorizationServerMetadata: metadata(client),
      validateAudience: ({ resource }) => Effect.sync(() => {
        mixedCaseAudienceCalls += 1
        return Object.freeze([resource])
      })
    }),
    client,
    mixedCaseHttp,
    mixedCaseStore
  )))

  const responseHttp = makeHttp(() => Effect.succeed(jsonResponse({
    access_token: tokenSecret,
    token_type: "DPoP"
  })))
  const responseStore = makeStore(client)
  let responseAudienceCalls = 0
  const responseResult = await Effect.runPromise(Effect.either(providePorts(
    exchangeAuthorizationCode({
      authorization: authorization(client),
      authorizationServerMetadata: metadata(client),
      validateAudience: ({ resource }) => Effect.sync(() => {
        responseAudienceCalls += 1
        return Object.freeze([resource])
      })
    }),
    client,
    responseHttp,
    responseStore
  )))

  const grantHttp = makeHttp(() => Effect.succeed(jsonResponse({
    access_token: tokenSecret,
    token_type: "Bearer"
  })))
  const grantStore = makeStore(client, {
    grant: storedGrant(client, { tokenType: "DPoP" })
  })
  let grantAudienceCalls = 0
  const grantResult = await Effect.runPromise(Effect.either(providePorts(
    refreshAuthorizationGrant({
      grant: grantHandle(client),
      authorizationServerMetadata: metadata(client),
      validateAudience: ({ resource }) => Effect.sync(() => {
        grantAudienceCalls += 1
        return Object.freeze([resource])
      })
    }),
    client,
    grantHttp,
    grantStore
  )))

  assert.deepEqual({
    mixedCase: {
      result: mixedCaseResult._tag,
      audienceCalls: mixedCaseAudienceCalls,
      saved: mixedCaseStore.saved.length,
      storedTokenType: mixedCaseStore.saved[0]?.tokenType
    },
    responseDpop: {
      result: responseResult._tag,
      errorTag: responseResult.left?._tag,
      reason: responseResult.left?.reason,
      audienceCalls: responseAudienceCalls,
      saved: responseStore.saved.length
    },
    storedGrantDpop: {
      result: grantResult._tag,
      errorTag: grantResult.left?._tag,
      reason: grantResult.left?.reason,
      storeCalls: grantStore.calls.map(([operation]) => operation),
      httpRequests: grantHttp.requests.length,
      audienceCalls: grantAudienceCalls,
      saved: grantStore.saved.length
    }
  }, {
    mixedCase: {
      result: "Right",
      audienceCalls: 1,
      saved: 1,
      storedTokenType: "Bearer"
    },
    responseDpop: {
      result: "Left",
      errorTag: "AuthorizationProtocolError",
      reason: "TokenExchangeFailed",
      audienceCalls: 0,
      saved: 0
    },
    storedGrantDpop: {
      result: "Left",
      errorTag: "AuthorizationProtocolError",
      reason: "TokenRefreshFailed",
      storeCalls: ["readGrant"],
      httpRequests: 0,
      audienceCalls: 0,
      saved: 0
    }
  })
})

test("refresh accepts genuine Effect Options and rejects spoofed, revoked, or accessor-shaped results without invoking getters", async () => {
  const { client, token: { refreshAuthorizationGrant } } = await loadWp6d()
  const handle = credentialHandle(client)
  const revoked = Proxy.revocable(Option.some(handle), {})
  revoked.revoke()
  let getterCalls = 0
  const accessorShaped = {}
  Object.defineProperties(accessorShaped, {
    _tag: {
      enumerable: true,
      get: () => {
        getterCalls += 1
        return "Some"
      }
    },
    value: {
      enumerable: true,
      get: () => {
        getterCalls += 1
        return handle
      }
    }
  })
  const fixtures = [
    { name: "genuine Effect Some", value: Option.some(handle), succeeds: true },
    { name: "spoofed data object", value: { _tag: "Some", value: handle }, succeeds: false },
    { name: "revoked Option proxy", value: revoked.proxy, succeeds: false },
    { name: "accessor-shaped object", value: accessorShaped, succeeds: false }
  ]
  const outcomes = []

  for (const fixture of fixtures) {
    const http = makeHttp(() => Effect.succeed(jsonResponse({
      access_token: tokenSecret,
      token_type: "Bearer"
    })))
    const store = makeStore(client, { findCredentialResult: fixture.value })
    let audienceCalls = 0
    const result = await Effect.runPromise(Effect.either(providePorts(refreshAuthorizationGrant({
      grant: grantHandle(client),
      authorizationServerMetadata: metadata(client),
      validateAudience: ({ resource }) => Effect.sync(() => {
        audienceCalls += 1
        return Object.freeze([resource])
      })
    }), client, http, store)))
    outcomes.push({ fixture, result, http, store, audienceCalls })
  }

  assert.deepEqual({
    outcomes: outcomes.map(({ fixture, result, http, store, audienceCalls }) => ({
      name: fixture.name,
      result: result._tag,
      errorTag: result.left?._tag,
      reason: result.left?.reason,
      storeCalls: store.calls.map(([operation]) => operation),
      httpRequests: http.requests.length,
      audienceCalls,
      saved: store.saved.length
    })),
    getterCalls
  }, {
    outcomes: fixtures.map((fixture) => fixture.succeeds
      ? {
          name: fixture.name,
          result: "Right",
          errorTag: undefined,
          reason: undefined,
          storeCalls: ["readGrant", "findCredential", "readCredential", "saveGrant"],
          httpRequests: 1,
          audienceCalls: 1,
          saved: 1
        }
      : {
          name: fixture.name,
          result: "Left",
          errorTag: "AuthorizationProtocolError",
          reason: "CredentialMissing",
          storeCalls: ["readGrant", "findCredential"],
          httpRequests: 0,
          audienceCalls: 0,
          saved: 0
        }),
    getterCalls: 0
  })
})

test("opaque-token audience mismatch, interruption, and defects occur before grant persistence", async () => {
  const { client, token: { exchangeAuthorizationCode } } = await loadWp6d()
  const cases = [
    {
      name: "mismatch",
      validateAudience: () => Effect.succeed(Object.freeze(["https://other-resource.example/mcp"])),
      assertExit: (exit) => {
        assert.equal(exit._tag, "Failure")
        const failure = Cause.failureOption(exit.cause)
        assert.equal(failure._tag, "Some")
        assert.equal(failure.value?._tag, "AuthorizationProtocolError")
        assert.equal(failure.value.reason, "AudienceMismatch")
        assertSecretsAbsent(failure.value, [tokenSecret])
      }
    },
    {
      name: "interrupt",
      validateAudience: () => Effect.interrupt,
      assertExit: (exit) => {
        assert.equal(Exit.isFailure(exit), true)
        assert.equal(Cause.isInterruptedOnly(exit.cause), true)
      }
    },
    {
      name: "defect",
      validateAudience: () => Effect.die("synthetic audience validator defect"),
      assertExit: (exit) => {
        assert.equal(Exit.isFailure(exit), true)
        assert.equal(Cause.dieOption(exit.cause)._tag, "Some")
      }
    }
  ]

  for (const fixture of cases) {
    const http = makeHttp(() => Effect.succeed(jsonResponse({
      access_token: tokenSecret,
      token_type: "Bearer"
    })))
    const store = makeStore(client)
    const exit = await Effect.runPromiseExit(providePorts(exchangeAuthorizationCode({
      authorization: authorization(client),
      authorizationServerMetadata: metadata(client),
      validateAudience: fixture.validateAudience
    }), client, http, store))
    fixture.assertExit(exit)
    assert.equal(http.requests.length, 1, fixture.name)
    assert.deepEqual(store.calls.map(([operation]) => operation), [
      "readCredential"
    ], fixture.name)
    assert.deepEqual(store.saved, [], fixture.name)
  }
})

test("credential, grant, and metadata issuers are exact partitions and mismatch before token HTTP", async () => {
  const { client, token: { exchangeAuthorizationCode, refreshAuthorizationGrant } } = await loadWp6d()
  const exactIssuer = "https://ISSUER.example/tenant"
  const normalizedIssuer = "https://issuer.example/tenant"
  const fixtures = [
    {
      name: "authorization versus metadata",
      effect: (http, store) => providePorts(exchangeAuthorizationCode({
        authorization: authorization(client, { issuer: exactIssuer }),
        authorizationServerMetadata: metadata(client, normalizedIssuer),
        validateAudience: () => Effect.die("issuer mismatch reached audience validation")
      }), client, http, store),
      expectedCalls: [],
      reason: "IssuerMismatch"
    },
    {
      name: "credential versus selected issuer",
      storeOptions: {
        credential: { issuer: normalizedIssuer, clientId: "wrong-partition" }
      },
      effect: (http, store) => providePorts(exchangeAuthorizationCode({
        authorization: authorization(client, { issuer: exactIssuer }),
        authorizationServerMetadata: metadata(client, exactIssuer),
        validateAudience: () => Effect.die("credential mismatch reached audience validation")
      }), client, http, store),
      expectedCalls: ["readCredential"],
      reason: "CredentialIssuerMismatch"
    },
    {
      name: "grant versus metadata",
      storeOptions: {
        grant: storedGrant(client, { issuer: exactIssuer })
      },
      effect: (http, store) => providePorts(refreshAuthorizationGrant({
        grant: grantHandle(client),
        authorizationServerMetadata: metadata(client, normalizedIssuer),
        validateAudience: () => Effect.die("grant mismatch reached audience validation")
      }), client, http, store),
      expectedCalls: ["readGrant"],
      reason: "IssuerMismatch"
    }
  ]

  for (const fixture of fixtures) {
    const http = makeHttp(() => Effect.die("issuer mismatch reached token HTTP"))
    const store = makeStore(client, fixture.storeOptions)
    const error = await runFailure(fixture.effect(http, store))
    assert.equal(error?._tag, "AuthorizationProtocolError", fixture.name)
    assert.equal(error.reason, fixture.reason, fixture.name)
    assert.deepEqual(store.calls.map(([operation]) => operation), fixture.expectedCalls, fixture.name)
    assert.deepEqual(http.requests, [], fixture.name)
    assert.deepEqual(store.saved, [], fixture.name)
  }
})

test("callback state, redirect, response iss, and denial failures prevent every token request", async () => {
  const { client, token: { exchangeAuthorizationCallback } } = await loadWp6d()
  const issuer = "https://issuer.example"
  const cases = [
    {
      name: "state absent",
      parameters: `code=${codeSecret}&iss=${encodeURIComponent(issuer)}`,
      reason: "StateMismatch"
    },
    {
      name: "state mismatch",
      parameters: `code=${codeSecret}&state=wrong&iss=${encodeURIComponent(issuer)}`,
      reason: "StateMismatch"
    },
    {
      name: "redirect mismatch",
      parameters: `code=${codeSecret}&state=${stateSecret}&iss=${encodeURIComponent(issuer)}`,
      callbackOverrides: { redirectUri: "https://client.example/callback?route=other" },
      reason: "RedirectMismatch"
    },
    {
      name: "issuer mismatch precedes denial",
      parameters: `error=access_denied&error_description=${codeSecret}&state=${stateSecret}&iss=${encodeURIComponent("https://attacker.example")}`,
      reason: "ResponseIssuerMismatch"
    },
    {
      name: "malformed issuer precedes denial",
      parameters: `error=access_denied&error_description=${codeSecret}&state=${stateSecret}&iss=not-an-issuer`,
      reason: "ResponseIssuerMismatch"
    },
    {
      name: "authorization denial",
      parameters: `error=access_denied&error_description=${codeSecret}&state=${stateSecret}&iss=${encodeURIComponent(issuer)}`,
      reason: "AuthorizationDenied"
    }
  ]

  for (const fixture of cases) {
    const http = makeHttp(() => Effect.die("invalid callback reached token HTTP"))
    const store = makeStore(client, { transaction: storedTransaction(client) })
    const error = await runFailure(providePorts(exchangeAuthorizationCallback({
      callback: callback(client, fixture.parameters, fixture.callbackOverrides),
      authorizationServerMetadata: metadata(client, issuer, true),
      validateAudience: () => Effect.die("invalid callback reached audience validation")
    }), client, http, store))
    assert.equal(error?._tag, "AuthorizationProtocolError", fixture.name)
    assert.equal(error.reason, fixture.reason, fixture.name)
    assert.deepEqual(http.requests, [], fixture.name)
    assert.deepEqual(store.calls.map(([operation]) => operation), ["takeTransaction"], fixture.name)
    assert.deepEqual(store.saved, [], fixture.name)
    assertSecretsAbsent(error, [codeSecret, verifierSecret])
  }
})

test("token endpoint failures are typed and never retain code, verifier, token, refresh token, or response bodies", async () => {
  const { client, token: { exchangeAuthorizationCode } } = await loadWp6d()
  const responseSecret = "WP6D_TOKEN_RESPONSE_BODY_SECRET_8ad4c1"
  const cases = [
    {
      name: "non-2xx",
      response: jsonResponse({ error: "invalid_grant", error_description: responseSecret }, 400),
      status: 400
    },
    { name: "malformed success", response: jsonResponse({ access_token: responseSecret }) },
    { name: "invalid JSON", response: {
      status: 200,
      headers: [["content-type", Redacted.make("application/json")]],
      body: Redacted.make(encoder.encode(`{${responseSecret}`))
    } }
  ]

  for (const fixture of cases) {
    const http = makeHttp(() => Effect.succeed(fixture.response))
    const store = makeStore(client)
    const error = await runFailure(providePorts(exchangeAuthorizationCode({
      authorization: authorization(client),
      authorizationServerMetadata: metadata(client),
      validateAudience: () => Effect.die("invalid response reached audience validation")
    }), client, http, store))
    assert.equal(error?._tag, "AuthorizationProtocolError", fixture.name)
    assert.equal(error.reason, "TokenExchangeFailed", fixture.name)
    if (fixture.status !== undefined) assert.equal(error.status, fixture.status, fixture.name)
    assert.deepEqual(store.saved, [], fixture.name)
    assertSecretsAbsent(error, [
      codeSecret,
      verifierSecret,
      tokenSecret,
      refreshSecret,
      responseSecret
    ])
  }
})

test("authorization-code exchange rejects a credential handle whose client identity changed after transaction start", async () => {
  const {
    client,
    token: { exchangeAuthorizationCode },
    transaction: { completeAuthorizationCallback, startAuthorizationTransaction }
  } = await loadWp6d()
  const issuer = "https://issuer.example"
  const handle = credentialHandle(client, "mutable-credential")
  const credentials = new Map([
    [handle, {
      issuer,
      clientId: "client-a",
      clientSecret: Redacted.make("client-a-secret")
    }]
  ])
  const store = makeStore(client, { credentials })
  let randomCall = 0
  const crypto = {
    randomBytes: (length) => Effect.sync(() => {
      randomCall += 1
      return new Uint8Array(length).fill(randomCall)
    }),
    sha256: () => Effect.succeed(new Uint8Array(32).fill(3)),
    sign: () => Effect.die("sign is not part of PKCE")
  }
  const serverMetadata = metadata(client, issuer, true)
  const started = await Effect.runPromise(startAuthorizationTransaction({
    authorizationServerMetadata: serverMetadata,
    issuer,
    canonicalResource: "https://resource.example/mcp",
    credentialHandle: handle,
    scopes: scopes(client),
    redirectUri: "https://client.example/callback?route=complete",
    createdAt: 123
  }).pipe(
    Effect.provideService(client.AuthorizationCrypto, crypto),
    Effect.provideService(client.AuthorizationClientStore, store.service)
  ))
  const saved = store.calls.find(([operation]) => operation === "saveTransaction")?.[1]
  const completed = await Effect.runPromise(completeAuthorizationCallback({
    callback: callback(client, new URLSearchParams({
      code: codeSecret,
      state: Redacted.value(saved.state),
      iss: issuer
    }).toString(), { transaction: started.transaction }),
    authorizationServerMetadata: serverMetadata
  }).pipe(Effect.provideService(client.AuthorizationClientStore, store.service)))

  credentials.set(handle, {
    issuer,
    clientId: "client-b",
    clientSecret: Redacted.make("client-b-secret")
  })
  store.calls.length = 0
  const http = makeHttp(() => Effect.succeed(jsonResponse({
    access_token: tokenSecret,
    token_type: "Bearer"
  })))
  let audienceCalls = 0
  const result = await Effect.runPromise(Effect.either(providePorts(exchangeAuthorizationCode({
    authorization: completed,
    authorizationServerMetadata: serverMetadata,
    validateAudience: ({ resource }) => Effect.sync(() => {
      audienceCalls += 1
      return Object.freeze([resource])
    })
  }), client, http, store)))

  assert.equal(result._tag, "Left")
  assert.equal(result.left?._tag, "AuthorizationProtocolError")
  assert.deepEqual(store.calls.map(([operation]) => operation), ["readCredential"])
  assert.deepEqual(http.requests, [])
  assert.equal(audienceCalls, 0)
  assert.deepEqual(store.saved, [])
})

test("rehydrated transaction and completed authorization without client identity reject same-issuer credential substitution before token ports", async () => {
  const { client, token: { exchangeAuthorizationCallback, exchangeAuthorizationCode } } =
    await loadWp6d()
  const issuer = "https://issuer.example"
  const substitutedCredential = {
    issuer,
    clientId: "substituted-same-issuer-client",
    tokenEndpointAuthMethod: "client_secret_basic",
    clientSecret: Redacted.make(clientAuthSecret)
  }
  const completeTransaction = storedTransaction(client)
  const incompleteTransaction = { ...completeTransaction }
  delete incompleteTransaction.clientId
  const completeAuthorization = authorization(client)
  const incompleteAuthorization = { ...completeAuthorization }
  delete incompleteAuthorization.clientId
  const fixtures = [
    {
      name: "stored transaction",
      storeOptions: { transaction: incompleteTransaction, credential: substitutedCredential },
      expectedReason: "StateReplay",
      expectedStoreCalls: ["takeTransaction"],
      run: (http, store, validateAudience) => exchangeAuthorizationCallback({
        callback: callback(client, new URLSearchParams({
          code: codeSecret,
          state: stateSecret,
          iss: issuer
        }).toString()),
        authorizationServerMetadata: metadata(client, issuer, true),
        validateAudience
      }).pipe(
        Effect.provideService(client.AuthorizationHttpClient, http.service),
        Effect.provideService(client.AuthorizationClientStore, store.service)
      )
    },
    {
      name: "completed authorization",
      storeOptions: { credential: substitutedCredential },
      expectedReason: "TokenExchangeFailed",
      expectedStoreCalls: [],
      run: (http, store, validateAudience) => providePorts(exchangeAuthorizationCode({
        authorization: incompleteAuthorization,
        authorizationServerMetadata: metadata(client, issuer),
        validateAudience
      }), client, http, store)
    }
  ]
  const outcomes = []

  for (const fixture of fixtures) {
    const http = makeHttp(() => Effect.succeed(jsonResponse({
      access_token: tokenSecret,
      token_type: "Bearer"
    })))
    const store = makeStore(client, fixture.storeOptions)
    let audienceCalls = 0
    const result = await Effect.runPromise(Effect.either(fixture.run(
      http,
      store,
      ({ resource }) => Effect.sync(() => {
        audienceCalls += 1
        return Object.freeze([resource])
      })
    )))
    outcomes.push({
      name: fixture.name,
      result: result._tag,
      errorTag: result.left?._tag,
      reason: result.left?.reason,
      storeCalls: store.calls.map(([operation]) => operation),
      httpRequests: http.requests.length,
      audienceCalls,
      saved: store.saved.length
    })
  }

  assert.deepEqual(outcomes, fixtures.map((fixture) => ({
    name: fixture.name,
    result: "Left",
    errorTag: "AuthorizationProtocolError",
    reason: fixture.expectedReason,
    storeCalls: fixture.expectedStoreCalls,
    httpRequests: 0,
    audienceCalls: 0,
    saved: 0
  })))
})

test("stored state and verifier require the exact generated 32-byte base64url shape before token exchange", async () => {
  const { client, token: { exchangeAuthorizationCallback } } = await loadWp6d()
  const issuer = "https://issuer.example"
  const fixtures = [
    { name: "short state", state: "short", verifier: verifierSecret },
    { name: "malformed state", state: `${"S".repeat(42)}+`, verifier: verifierSecret },
    { name: "short verifier", state: stateSecret, verifier: "short" },
    { name: "malformed verifier", state: stateSecret, verifier: `${"V".repeat(42)}=` }
  ]
  const outcomes = []

  for (const fixture of fixtures) {
    const store = makeStore(client, {
      transaction: storedTransaction(client, {
        state: Redacted.make(fixture.state),
        codeVerifier: Redacted.make(fixture.verifier)
      })
    })
    const http = makeHttp(() => Effect.succeed(jsonResponse({
      access_token: tokenSecret,
      token_type: "Bearer"
    })))
    let audienceCalls = 0
    const result = await Effect.runPromise(Effect.either(providePorts(exchangeAuthorizationCallback({
      callback: callback(client, new URLSearchParams({
        code: codeSecret,
        state: fixture.state,
        iss: issuer
      }).toString()),
      authorizationServerMetadata: metadata(client, issuer, true),
      validateAudience: ({ resource }) => Effect.sync(() => {
        audienceCalls += 1
        return Object.freeze([resource])
      })
    }), client, http, store)))
    outcomes.push({ fixture, result, store, http, audienceCalls })
  }

  assert.deepEqual(outcomes.map(({ fixture, result, store, http, audienceCalls }) => ({
    name: fixture.name,
    result: result._tag,
    errorTag: result.left?._tag,
    storeCalls: store.calls.map(([operation]) => operation),
    httpRequests: http.requests.length,
    audienceCalls,
    saved: store.saved.length
  })), fixtures.map(({ name }) => ({
    name,
    result: "Left",
    errorTag: "AuthorizationProtocolError",
    storeCalls: ["takeTransaction"],
    httpRequests: 0,
    audienceCalls: 0,
    saved: 0
  })))
})

test("token endpoint authentication selects none, post, or Basic and rejects unsupported or inconsistent methods before HTTP", async () => {
  const { client, token: { exchangeAuthorizationCode } } = await loadWp6d()
  const issuer = "https://issuer.example"
  const fixtures = [
    {
      name: "none",
      method: "none",
      advertised: ["none"],
      succeeds: true,
      clientSecret: undefined,
      expected: { clientId: true, clientSecret: false, authorization: false, secretMatches: false }
    },
    {
      name: "client_secret_post",
      method: "client_secret_post",
      advertised: ["client_secret_post"],
      succeeds: true,
      clientSecret: clientAuthSecret,
      expected: { clientId: true, clientSecret: true, authorization: false, secretMatches: true }
    },
    {
      name: "client_secret_basic",
      method: "client_secret_basic",
      advertised: ["client_secret_basic"],
      succeeds: true,
      clientSecret: clientAuthSecret,
      expected: { clientId: false, clientSecret: false, authorization: true, secretMatches: true }
    },
    {
      name: "unsupported method",
      method: "private_key_jwt",
      advertised: ["private_key_jwt"],
      succeeds: false,
      clientSecret: clientAuthSecret
    },
    {
      name: "method not advertised",
      method: "client_secret_post",
      advertised: ["client_secret_basic"],
      succeeds: false,
      clientSecret: clientAuthSecret
    },
    {
      name: "post without secret",
      method: "client_secret_post",
      advertised: ["client_secret_post"],
      succeeds: false,
      clientSecret: undefined
    },
    {
      name: "none with secret",
      method: "none",
      advertised: ["none"],
      succeeds: false,
      clientSecret: clientAuthSecret
    }
  ]
  const outcomes = []

  for (const fixture of fixtures) {
    const credential = {
      issuer,
      clientId: "wp6d-client",
      tokenEndpointAuthMethod: fixture.method,
      ...(fixture.clientSecret === undefined
        ? {}
        : { clientSecret: Redacted.make(fixture.clientSecret) })
    }
    const store = makeStore(client, { credential })
    const http = makeHttp(() => Effect.succeed(jsonResponse({
      access_token: tokenSecret,
      token_type: "Bearer"
    })))
    let audienceCalls = 0
    const result = await Effect.runPromise(Effect.either(providePorts(exchangeAuthorizationCode({
      authorization: authorization(client),
      authorizationServerMetadata: metadata(client, issuer, undefined, {
        token_endpoint_auth_methods_supported: fixture.advertised
      }),
      validateAudience: ({ resource }) => Effect.sync(() => {
        audienceCalls += 1
        return Object.freeze([resource])
      })
    }), client, http, store)))
    const request = http.requests[0]
    const body = request === undefined ? undefined : formBody(request)
    const authorizationHeader = request?.headers.find(([name]) => name.toLowerCase() === "authorization")
    const authorizationValue = authorizationHeader === undefined
      ? undefined
      : Redacted.value(authorizationHeader[1])
    const basicMatches = authorizationValue?.startsWith("Basic ") === true &&
      Buffer.from(authorizationValue.slice(6), "base64").toString("utf8") ===
        `wp6d-client:${clientAuthSecret}`
    outcomes.push({
      fixture,
      result,
      store,
      http,
      audienceCalls,
      placement: {
        clientId: body?.get("client_id") === "wp6d-client",
        clientSecret: body?.has("client_secret") === true,
        authorization: authorizationHeader !== undefined && Redacted.isRedacted(authorizationHeader[1]),
        secretMatches: fixture.method === "client_secret_basic"
          ? basicMatches
          : body?.get("client_secret") === clientAuthSecret
      }
    })
  }

  assert.deepEqual(outcomes.map(({ fixture, result, store, http, audienceCalls, placement }) =>
    fixture.succeeds
      ? {
          name: fixture.name,
          result: result._tag,
          httpRequests: http.requests.length,
          audienceCalls,
          saved: store.saved.length,
          placement
        }
      : {
          name: fixture.name,
          result: result._tag,
          errorTag: result.left?._tag,
          reason: result.left?.reason,
          storeCalls: store.calls.map(([operation]) => operation),
          httpRequests: http.requests.length,
          audienceCalls,
          saved: store.saved.length
        }), fixtures.map((fixture) => fixture.succeeds
    ? {
        name: fixture.name,
        result: "Right",
        httpRequests: 1,
        audienceCalls: 1,
        saved: 1,
        placement: fixture.expected
      }
    : {
        name: fixture.name,
        result: "Left",
        errorTag: "AuthorizationProtocolError",
        reason: "TokenExchangeFailed",
        storeCalls: ["readCredential"],
        httpRequests: 0,
        audienceCalls: 0,
        saved: 0
      }))
})

test("methodless confidential credentials select an advertised method and default to client_secret_basic", async () => {
  const { client, token: { exchangeAuthorizationCode } } = await loadWp6d()
  const issuer = "https://issuer.example"
  const fixtures = [
    { name: "advertised post", advertised: ["client_secret_post"], expectedMethod: "post" },
    { name: "advertised basic", advertised: ["client_secret_basic"], expectedMethod: "basic" },
    { name: "metadata default", advertised: undefined, expectedMethod: "basic" }
  ]
  const outcomes = []

  for (const fixture of fixtures) {
    const store = makeStore(client, {
      credential: {
        issuer,
        clientId: "wp6d-client",
        clientSecret: Redacted.make(clientAuthSecret)
      }
    })
    const http = makeHttp(() => Effect.succeed(jsonResponse({
      access_token: tokenSecret,
      token_type: "Bearer"
    })))
    const result = await Effect.runPromise(Effect.either(providePorts(exchangeAuthorizationCode({
      authorization: authorization(client),
      authorizationServerMetadata: metadata(client, issuer, undefined,
        fixture.advertised === undefined
          ? {}
          : { token_endpoint_auth_methods_supported: fixture.advertised }),
      validateAudience: ({ resource }) => Effect.succeed(Object.freeze([resource]))
    }), client, http, store)))
    const request = http.requests[0]
    const body = request === undefined ? undefined : formBody(request)
    const authorizationHeader = request?.headers.find(
      ([name]) => name.toLowerCase() === "authorization"
    )
    const authorizationValue = authorizationHeader === undefined
      ? undefined
      : Redacted.value(authorizationHeader[1])
    const basicMatches = authorizationValue?.startsWith("Basic ") === true &&
      Buffer.from(authorizationValue.slice(6), "base64").toString("utf8") ===
        `wp6d-client:${clientAuthSecret}`
    outcomes.push({
      name: fixture.name,
      result: result._tag,
      errorTag: result.left?._tag,
      reason: result.left?.reason,
      httpRequests: http.requests.length,
      saved: store.saved.length,
      method: authorizationHeader === undefined
        ? body?.get("client_secret") === clientAuthSecret ? "post" : "none"
        : basicMatches && Redacted.isRedacted(authorizationHeader[1]) ? "basic" : "invalid"
    })
  }

  assert.deepEqual(outcomes, fixtures.map((fixture) => ({
    name: fixture.name,
    result: "Right",
    errorTag: undefined,
    reason: undefined,
    httpRequests: 1,
    saved: 1,
    method: fixture.expectedMethod
  })))
})

test("null and accessor-shaped top-level inputs fail as typed errors before all port activity for five operations", async () => {
  const {
    client,
    token: { exchangeAuthorizationCallback, exchangeAuthorizationCode, refreshAuthorizationGrant },
    transaction: { completeAuthorizationCallback, startAuthorizationTransaction }
  } = await loadWp6d()
  const operations = [
    { name: "start", property: "authorizationServerMetadata", run: startAuthorizationTransaction },
    { name: "complete", property: "callback", run: completeAuthorizationCallback },
    {
      name: "exchange code",
      property: "authorization",
      run: exchangeAuthorizationCode,
      hasAudience: true
    },
    { name: "refresh", property: "grant", run: refreshAuthorizationGrant, hasAudience: true },
    {
      name: "exchange callback",
      property: "callback",
      run: exchangeAuthorizationCallback,
      hasAudience: true
    }
  ]
  const outcomes = []

  for (const operation of operations) {
    for (const shape of ["null", "accessor"]) {
      let getterCalls = 0
      let audienceCalls = 0
      const input = shape === "null" ? null : {}
      if (shape === "accessor") {
        Object.defineProperty(input, operation.property, {
          enumerable: true,
          get: () => {
            getterCalls += 1
            return undefined
          }
        })
        if (operation.hasAudience === true) {
          Object.defineProperty(input, "validateAudience", {
            enumerable: true,
            value: () => Effect.sync(() => {
              audienceCalls += 1
              return Object.freeze(["https://resource.example/mcp"])
            })
          })
        }
      }
      const store = makeStore(client)
      const http = makeHttp(() => Effect.die("invalid top-level input reached HTTP"))
      const cryptoCalls = []
      const crypto = {
        randomBytes: (length) => Effect.sync(() => {
          cryptoCalls.push(["randomBytes", length])
          return new Uint8Array(length)
        }),
        sha256: (value) => Effect.sync(() => {
          cryptoCalls.push(["sha256", value.length])
          return new Uint8Array(32)
        }),
        sign: () => Effect.die("invalid top-level input reached signing")
      }
      const effect = operation.run(input).pipe(
        Effect.provideService(client.AuthorizationClientStore, store.service),
        Effect.provideService(client.AuthorizationHttpClient, http.service),
        Effect.provideService(client.AuthorizationCrypto, crypto)
      )
      const exit = await Effect.runPromiseExit(effect)
      const failure = Exit.isFailure(exit) ? Cause.failureOption(exit.cause) : Option.none()
      const defect = Exit.isFailure(exit) ? Cause.dieOption(exit.cause) : Option.none()
      outcomes.push({
        name: `${operation.name} ${shape}`,
        exit: exit._tag,
        errorTag: failure._tag === "Some" ? failure.value?._tag : undefined,
        defect: defect._tag,
        getterCalls,
        storeCalls: store.calls.length,
        httpRequests: http.requests.length,
        cryptoCalls: cryptoCalls.length,
        audienceCalls
      })
    }
  }

  assert.deepEqual(outcomes, outcomes.map(({ name }) => ({
    name,
    exit: "Failure",
    errorTag: "AuthorizationProtocolError",
    defect: "None",
    getterCalls: 0,
    storeCalls: 0,
    httpRequests: 0,
    cryptoCalls: 0,
    audienceCalls: 0
  })))
})

test("refresh rejects an Option forged from a deeper Some prototype before credential or token activity", async () => {
  const { client, token: { refreshAuthorizationGrant } } = await loadWp6d()
  const handle = credentialHandle(client)
  const somePrototype = Object.getPrototypeOf(Option.some(handle))
  const deeperPrototype = Object.create(somePrototype)
  Object.defineProperty(deeperPrototype, "_tag", {
    configurable: true,
    enumerable: true,
    value: "Some",
    writable: true
  })
  const forged = Object.create(deeperPrototype)
  Object.defineProperty(forged, "value", {
    configurable: true,
    enumerable: true,
    value: handle,
    writable: true
  })
  assert.equal(Option.isOption(forged), true)

  const store = makeStore(client, { findCredentialResult: forged })
  const http = makeHttp(() => Effect.succeed(jsonResponse({
    access_token: tokenSecret,
    token_type: "Bearer"
  })))
  let audienceCalls = 0
  const result = await Effect.runPromise(Effect.either(providePorts(refreshAuthorizationGrant({
    grant: grantHandle(client),
    authorizationServerMetadata: metadata(client),
    validateAudience: ({ resource }) => Effect.sync(() => {
      audienceCalls += 1
      return Object.freeze([resource])
    })
  }), client, http, store)))

  assert.equal(result._tag, "Left")
  assert.equal(result.left?._tag, "AuthorizationProtocolError")
  assert.equal(result.left.reason, "CredentialMissing")
  assert.deepEqual(store.calls.map(([operation]) => operation), ["readGrant", "findCredential"])
  assert.deepEqual(http.requests, [])
  assert.equal(audienceCalls, 0)
  assert.deepEqual(store.saved, [])
})
