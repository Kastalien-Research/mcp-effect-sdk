import assert from "node:assert/strict"
import { inspect } from "node:util"
import test from "node:test"
import * as Cause from "effect/Cause"
import * as Deferred from "effect/Deferred"
import * as Effect from "effect/Effect"
import * as Exit from "effect/Exit"
import * as Fiber from "effect/Fiber"
import * as Redacted from "effect/Redacted"
import * as Schema from "effect/Schema"

const encoder = new TextEncoder()
const callbackSecret = "WP6D_CALLBACK_SECRET_2c381f"
const expectedState = "S".repeat(43)
const expectedVerifier = "V".repeat(43)

const loadWp6d = async () => {
  const transaction = await import("../../dist/auth/client/transaction.js")
  const client = await import("../../dist/auth/client.js")
  return { client, transaction }
}

const scopes = (client, values = ["tools.read"]) =>
  Schema.decodeUnknownSync(client.AuthorizationScopeSet)(values)

const credentialHandle = (client) =>
  Schema.decodeUnknownSync(client.AuthorizationCredentialHandle)("credential-wp6d")

const transactionHandle = (client) =>
  Schema.decodeUnknownSync(client.AuthorizationTransactionHandle)("transaction-wp6d")

const metadata = (client, issuer, responseIssSupported) =>
  Schema.decodeUnknownSync(client.AuthorizationServerMetadata)({
    issuer,
    authorization_endpoint: `${issuer}/authorize`,
    token_endpoint: `${issuer}/token`,
    code_challenge_methods_supported: ["S256"],
    ...(responseIssSupported === undefined
      ? {}
      : { authorization_response_iss_parameter_supported: responseIssSupported })
  })

const storedTransaction = (client, overrides = {}) => ({
  issuer: "https://issuer.example",
  resource: "https://resource.example/mcp",
  credentialHandle: credentialHandle(client),
  clientId: "wp6d-client",
  authorizationResponseIssParameterRequired: true,
  redirectUri: "https://client.example/callback?route=complete",
  scopes: scopes(client, ["tools.read", "tools.write"]),
  state: Redacted.make(expectedState),
  codeVerifier: Redacted.make(expectedVerifier),
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

const makeStore = (client, options = {}) => {
  const calls = []
  let available = options.transaction ?? storedTransaction(client)
  return {
    calls,
    service: {
      readCredential: (handle) => Effect.sync(() => {
        calls.push(["readCredential", handle])
        return options.credential ?? {
          issuer: "https://issuer.example",
          clientId: "wp6d-client"
        }
      }),
      saveTransaction: (value) => Effect.sync(() => {
        calls.push(["saveTransaction", value])
        available = value
        return transactionHandle(client)
      }),
      takeTransaction: (handle) => Effect.suspend(() => {
        calls.push(["takeTransaction", handle])
        if (available === undefined) {
          return Effect.fail(new client.AuthorizationStoreError({
            operation: "takeTransaction",
            reason: "NotFound"
          }))
        }
        const value = available
        available = undefined
        return Effect.succeed(value)
      })
    }
  }
}

const provideTransactionPorts = (effect, client, store, crypto, interaction) => effect.pipe(
  Effect.provideService(client.AuthorizationClientStore, store.service),
  ...(crypto === undefined
    ? []
    : [Effect.provideService(client.AuthorizationCrypto, crypto)]),
  ...(interaction === undefined
    ? []
    : [Effect.provideService(client.AuthorizationInteraction, interaction)])
)

const runFailure = async (effect) => {
  const result = await Effect.runPromise(Effect.either(effect))
  if (result._tag === "Right") assert.fail("expected authorization transaction to fail")
  return result.left
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

const assertSecretSafe = (error, sentinel) => {
  assert.equal(recursivelyContains(error, sentinel), false)
  const rendered = [String(error), inspect(error, { depth: 8 })]
  try {
    rendered.push(JSON.stringify(error))
  } catch {
    // Secret safety does not require JSON serialization.
  }
  assert.equal(rendered.join(" ").includes(sentinel), false)
}

test("transaction start uses strong independent state, PKCE S256, exact bindings, and the RFC 8707 resource indicator", async () => {
  const { client, transaction: { startAuthorizationTransaction } } = await loadWp6d()
  const issuer = "https://issuer.example"
  const handle = credentialHandle(client)
  const store = makeStore(client, {
    transaction: undefined,
    credential: { issuer, clientId: "wp6d-client" }
  })
  const stateBytes = Uint8Array.from({ length: 32 }, (_, index) => index)
  const verifierBytes = Uint8Array.from({ length: 32 }, (_, index) => index + 32)
  const randomInputs = [stateBytes, verifierBytes]
  const hash = Uint8Array.from({ length: 32 }, (_, index) => 255 - index)
  const cryptoCalls = []
  const crypto = {
    randomBytes: (length) => Effect.sync(() => {
      cryptoCalls.push(["randomBytes", length])
      return randomInputs.shift()
    }),
    sha256: (value) => Effect.sync(() => {
      cryptoCalls.push(["sha256", [...value]])
      return hash
    }),
    sign: () => Effect.die("sign is not part of PKCE")
  }

  const result = await Effect.runPromise(provideTransactionPorts(
    startAuthorizationTransaction({
      authorizationServerMetadata: metadata(client, issuer),
      issuer,
      canonicalResource: "https://resource.example/mcp",
      credentialHandle: handle,
      scopes: scopes(client, ["tools.read", "tools.write"]),
      redirectUri: "https://client.example/callback?route=complete",
      createdAt: 123
    }),
    client,
    store,
    crypto
  ))

  assert.equal(result.transaction, transactionHandle(client))
  assert.equal(Redacted.isRedacted(result.authorizationUri), true)
  assert.deepEqual(cryptoCalls.map(([operation, value]) => [
    operation,
    typeof value === "number" ? value : value.length
  ]), [
    ["randomBytes", 32],
    ["randomBytes", 32],
    ["sha256", 43]
  ])
  const expectedVerifier = Buffer.from(verifierBytes).toString("base64url")
  assert.deepEqual(cryptoCalls[2][1], [...encoder.encode(expectedVerifier)])

  const saved = store.calls.find(([operation]) => operation === "saveTransaction")?.[1]
  assert.ok(saved)
  assert.equal(saved.issuer, issuer)
  assert.equal(saved.resource, "https://resource.example/mcp")
  assert.equal(saved.credentialHandle, handle)
  assert.equal(saved.redirectUri, "https://client.example/callback?route=complete")
  assert.deepEqual(saved.scopes, ["tools.read", "tools.write"])
  assert.equal(saved.createdAt, 123)
  assert.equal(Redacted.isRedacted(saved.state), true)
  assert.equal(Redacted.isRedacted(saved.codeVerifier), true)
  assert.equal(Redacted.value(saved.state).length, 43)
  assert.equal(Redacted.value(saved.codeVerifier).length, 43)
  assert.equal(Redacted.value(saved.state), Buffer.from(stateBytes).toString("base64url"))
  assert.equal(Redacted.value(saved.codeVerifier), expectedVerifier)
  assert.notEqual(Redacted.value(saved.state), Redacted.value(saved.codeVerifier))

  const authorizationUri = new URL(Redacted.value(result.authorizationUri))
  assert.equal(authorizationUri.origin + authorizationUri.pathname, `${issuer}/authorize`)
  assert.deepEqual([...authorizationUri.searchParams.keys()].sort(), [
    "client_id",
    "code_challenge",
    "code_challenge_method",
    "redirect_uri",
    "resource",
    "response_type",
    "scope",
    "state"
  ])
  assert.equal(authorizationUri.searchParams.get("response_type"), "code")
  assert.equal(authorizationUri.searchParams.get("client_id"), "wp6d-client")
  assert.equal(authorizationUri.searchParams.get("redirect_uri"), saved.redirectUri)
  assert.equal(authorizationUri.searchParams.get("scope"), "tools.read tools.write")
  assert.equal(authorizationUri.searchParams.get("state"), Redacted.value(saved.state))
  assert.equal(authorizationUri.searchParams.get("code_challenge_method"), "S256")
  assert.equal(authorizationUri.searchParams.get("code_challenge"), Buffer.from(hash).toString("base64url"))
  assert.equal(authorizationUri.searchParams.get("resource"), saved.resource)
})

test("transaction start rejects missing or non-S256 PKCE metadata before crypto or store activity", async () => {
  const { client, transaction: { startAuthorizationTransaction } } = await loadWp6d()
  const issuer = "https://issuer.example"
  const fixtures = [
    {
      name: "missing code challenge methods",
      metadata: Schema.decodeUnknownSync(client.AuthorizationServerMetadata)({
        issuer,
        authorization_endpoint: `${issuer}/authorize`,
        token_endpoint: `${issuer}/token`
      })
    },
    {
      name: "S256 absent",
      metadata: Schema.decodeUnknownSync(client.AuthorizationServerMetadata)({
        issuer,
        authorization_endpoint: `${issuer}/authorize`,
        token_endpoint: `${issuer}/token`,
        code_challenge_methods_supported: ["plain"]
      })
    }
  ]

  for (const fixture of fixtures) {
    const store = makeStore(client, { transaction: undefined })
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
      sign: () => Effect.die("sign is not part of PKCE")
    }
    const error = await runFailure(provideTransactionPorts(
      startAuthorizationTransaction({
        authorizationServerMetadata: fixture.metadata,
        issuer,
        canonicalResource: "https://resource.example/mcp",
        credentialHandle: credentialHandle(client),
        scopes: scopes(client),
        redirectUri: "https://client.example/callback?route=complete",
        createdAt: 123
      }),
      client,
      store,
      crypto
    ))
    assert.equal(error?._tag, "AuthorizationProtocolError", fixture.name)
    assert.equal(error.reason, "UnsupportedAuthorizationServer", fixture.name)
    assert.deepEqual(cryptoCalls, [], fixture.name)
    assert.deepEqual(store.calls, [], fixture.name)
  }
})

test("callback validation consumes state once and checks exact state and redirect before returning a redacted code", async () => {
  const { client, transaction: { completeAuthorizationCallback } } = await loadWp6d()
  const issuer = "https://issuer.example"
  const fixtures = [
    {
      name: "state absent",
      callback: callback(client, `code=${callbackSecret}&iss=${encodeURIComponent(issuer)}`),
      reason: "StateMismatch"
    },
    {
      name: "state mismatch",
      callback: callback(client, `code=${callbackSecret}&state=wrong-state&iss=${encodeURIComponent(issuer)}`),
      reason: "StateMismatch"
    },
    {
      name: "redirect mismatch",
      callback: callback(
        client,
        `code=${callbackSecret}&state=${expectedState}&iss=${encodeURIComponent(issuer)}`,
        { redirectUri: "https://client.example/callback?route=other" }
      ),
      reason: "RedirectMismatch"
    }
  ]

  for (const fixture of fixtures) {
    const store = makeStore(client)
    const error = await runFailure(provideTransactionPorts(
      completeAuthorizationCallback({
        callback: fixture.callback,
        authorizationServerMetadata: metadata(client, issuer, true)
      }),
      client,
      store
    ))
    assert.equal(error?._tag, "AuthorizationProtocolError", fixture.name)
    assert.equal(error.reason, fixture.reason, fixture.name)
    assert.deepEqual(store.calls.map(([operation]) => operation), ["takeTransaction"], fixture.name)
    assertSecretSafe(error, callbackSecret)
  }

  const successStore = makeStore(client)
  const input = callback(
    client,
    `code=${callbackSecret}&state=${expectedState}&iss=${encodeURIComponent(issuer)}`
  )
  const completed = await Effect.runPromise(provideTransactionPorts(
    completeAuthorizationCallback({
      callback: input,
      authorizationServerMetadata: metadata(client, issuer, true)
    }),
    client,
    successStore
  ))
  assert.deepEqual(Object.keys(completed).sort(), [
    "authorizationCode",
    "codeVerifier",
    "credentialHandle",
    "issuer",
    "redirectUri",
    "resource",
    "scopes"
  ])
  assert.equal(completed.issuer, issuer)
  assert.equal(completed.resource, "https://resource.example/mcp")
  assert.equal(completed.credentialHandle, credentialHandle(client))
  assert.equal(Redacted.isRedacted(completed.authorizationCode), true)
  assert.equal(Redacted.value(completed.authorizationCode), callbackSecret)
  assert.equal(Redacted.isRedacted(completed.codeVerifier), true)

  const replay = await runFailure(provideTransactionPorts(
    completeAuthorizationCallback({
      callback: input,
      authorizationServerMetadata: metadata(client, issuer, true)
    }),
    client,
    successStore
  ))
  assert.equal(replay?._tag, "AuthorizationProtocolError")
  assert.equal(replay.reason, "StateReplay")
  assert.deepEqual(successStore.calls.map(([operation]) => operation), [
    "takeTransaction",
    "takeTransaction"
  ])
  assertSecretSafe(replay, callbackSecret)
})

test("response iss follows the four-way metadata table with exact unnormalized comparison", async () => {
  const { client, transaction: { completeAuthorizationCallback } } = await loadWp6d()
  const issuer = "https://ISSUER.example/tenant"
  const cases = [
    { name: "supported present exact", flag: true, iss: issuer, succeeds: true },
    { name: "supported absent", flag: true, succeeds: false },
    { name: "false present exact", flag: false, iss: issuer, succeeds: true },
    { name: "false absent", flag: false, succeeds: true },
    { name: "absent present exact", flag: undefined, iss: issuer, succeeds: true },
    { name: "absent absent", flag: undefined, succeeds: true },
    { name: "host case mismatch", flag: false, iss: "https://issuer.example/tenant", succeeds: false },
    { name: "trailing slash mismatch", flag: undefined, iss: `${issuer}/`, succeeds: false },
    { name: "percent spelling mismatch", flag: true, iss: "https://ISSUER.example/%74enant", succeeds: false },
    { name: "malformed iss", flag: false, iss: "not-an-issuer", succeeds: false }
  ]
  const outcomes = []

  for (const fixture of cases) {
    const store = makeStore(client, {
      transaction: storedTransaction(client, {
        issuer,
        authorizationResponseIssParameterRequired: fixture.flag === true
      })
    })
    const parameters = new URLSearchParams({ code: callbackSecret, state: expectedState })
    if (fixture.iss !== undefined) parameters.set("iss", fixture.iss)
    const result = await Effect.runPromise(Effect.either(provideTransactionPorts(
      completeAuthorizationCallback({
        callback: callback(client, parameters.toString()),
        authorizationServerMetadata: metadata(client, issuer, fixture.flag)
      }),
      client,
      store
    )))
    outcomes.push({ fixture, result, store })
  }

  for (const { fixture, result, store } of outcomes) {
    assert.equal(result._tag, fixture.succeeds ? "Right" : "Left", fixture.name)
    if (!fixture.succeeds) {
      assert.equal(result.left?._tag, "AuthorizationProtocolError", fixture.name)
      assert.equal(result.left.reason, "ResponseIssuerMismatch", fixture.name)
      assertSecretSafe(result.left, callbackSecret)
    }
    assert.deepEqual(store.calls.map(([operation]) => operation), ["takeTransaction"], fixture.name)
  }
})

test("issuer validation precedes authorization denial and denial remains secret-safe", async () => {
  const { client, transaction: { completeAuthorizationCallback } } = await loadWp6d()
  const issuer = "https://issuer.example"
  for (const responseIssuer of ["https://attacker.example", "not-an-issuer"]) {
    const invalidIssuer = new URLSearchParams({
      error: "access_denied",
      error_description: callbackSecret,
      state: expectedState,
      iss: responseIssuer
    })
    const issuerError = await runFailure(provideTransactionPorts(
      completeAuthorizationCallback({
        callback: callback(client, invalidIssuer.toString()),
        authorizationServerMetadata: metadata(client, issuer, true)
      }),
      client,
      makeStore(client)
    ))
    assert.equal(issuerError?._tag, "AuthorizationProtocolError", responseIssuer)
    assert.equal(issuerError.reason, "ResponseIssuerMismatch", responseIssuer)
    assertSecretSafe(issuerError, callbackSecret)
  }

  const denied = new URLSearchParams({
    error: "access_denied",
    error_description: callbackSecret,
    state: expectedState,
    iss: issuer
  })
  const deniedError = await runFailure(provideTransactionPorts(
    completeAuthorizationCallback({
      callback: callback(client, denied.toString()),
      authorizationServerMetadata: metadata(client, issuer, true)
    }),
    client,
    makeStore(client)
  ))
  assert.equal(deniedError?._tag, "AuthorizationProtocolError")
  assert.equal(deniedError.reason, "AuthorizationDenied")
  assertSecretSafe(deniedError, callbackSecret)
})

test("interaction cancellation and fiber interruption remain their original Effect causes", async () => {
  const { client, transaction: { performAuthorizationInteraction } } = await loadWp6d()
  const issuer = "https://issuer.example"
  const handle = credentialHandle(client)
  const crypto = {
    randomBytes: () => Effect.succeed(new Uint8Array(32)),
    sha256: () => Effect.succeed(new Uint8Array(32)),
    sign: () => Effect.die("sign is not part of PKCE")
  }
  const base = {
    authorizationServerMetadata: metadata(client, issuer),
    issuer,
    canonicalResource: "https://resource.example/mcp",
    credentialHandle: handle,
    scopes: scopes(client),
    redirectUri: "https://client.example/callback?route=complete",
    createdAt: 123
  }

  const cancelled = new client.AuthorizationInteractionError({
    operation: "waitForCallback",
    reason: "CancelledByUser"
  })
  const cancelledStore = makeStore(client, { transaction: undefined })
  const cancelledResult = await Effect.runPromise(Effect.either(provideTransactionPorts(
    performAuthorizationInteraction(base),
    client,
    cancelledStore,
    crypto,
    { open: () => Effect.void, waitForCallback: () => Effect.fail(cancelled) }
  )))
  assert.equal(cancelledResult._tag, "Left")
  assert.equal(cancelledResult.left, cancelled)

  const started = await Effect.runPromise(Deferred.make())
  const waitingStore = makeStore(client, { transaction: undefined })
  const waiting = provideTransactionPorts(
    performAuthorizationInteraction(base),
    client,
    waitingStore,
    crypto,
    {
      open: () => Effect.void,
      waitForCallback: () => Effect.zipRight(Deferred.succeed(started, undefined), Effect.never)
    }
  )
  const fiber = Effect.runFork(waiting)
  await Effect.runPromise(Deferred.await(started))
  const exit = await Effect.runPromise(Fiber.interrupt(fiber))
  assert.equal(Exit.isFailure(exit), true)
  assert.equal(Cause.isInterruptedOnly(exit.cause), true)
})

test("the response-iss requirement selected at transaction start cannot be weakened at callback completion", async () => {
  const {
    client,
    transaction: { completeAuthorizationCallback, startAuthorizationTransaction }
  } = await loadWp6d()
  const issuer = "https://issuer.example"
  const store = makeStore(client, {
    transaction: undefined,
    credential: { issuer, clientId: "wp6d-client" }
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

  const started = await Effect.runPromise(provideTransactionPorts(
    startAuthorizationTransaction({
      authorizationServerMetadata: metadata(client, issuer, true),
      issuer,
      canonicalResource: "https://resource.example/mcp",
      credentialHandle: credentialHandle(client),
      scopes: scopes(client),
      redirectUri: "https://client.example/callback?route=complete",
      createdAt: 123
    }),
    client,
    store,
    crypto
  ))
  const saved = store.calls.find(([operation]) => operation === "saveTransaction")?.[1]
  assert.ok(saved)

  const result = await Effect.runPromise(Effect.either(provideTransactionPorts(
    completeAuthorizationCallback({
      callback: callback(client, new URLSearchParams({
        code: callbackSecret,
        state: Redacted.value(saved.state)
      }).toString(), { transaction: started.transaction }),
      authorizationServerMetadata: metadata(client, issuer, false)
    }),
    client,
    store
  )))

  assert.equal(result._tag, "Left")
  assert.equal(result.left?._tag, "AuthorizationProtocolError")
  assert.equal(result.left.reason, "ResponseIssuerMismatch")
  assert.deepEqual(store.calls.map(([operation]) => operation), [
    "readCredential",
    "saveTransaction",
    "takeTransaction"
  ])
})

test("a rehydrated transaction missing its response-iss policy fails closed instead of consulting callback-time metadata", async () => {
  const { client, transaction: { completeAuthorizationCallback } } = await loadWp6d()
  const issuer = "https://issuer.example"
  const incompleteTransaction = { ...storedTransaction(client) }
  delete incompleteTransaction.authorizationResponseIssParameterRequired
  const store = makeStore(client, { transaction: incompleteTransaction })

  const result = await Effect.runPromise(Effect.either(provideTransactionPorts(
    completeAuthorizationCallback({
      callback: callback(client, new URLSearchParams({
        code: callbackSecret,
        state: expectedState
      }).toString()),
      authorizationServerMetadata: metadata(client, issuer, false)
    }),
    client,
    store
  )))

  assert.equal(result._tag, "Left")
  assert.equal(result.left?._tag, "AuthorizationProtocolError")
  assert.equal(result.left.reason, "StateReplay")
  assert.deepEqual(store.calls.map(([operation]) => operation), ["takeTransaction"])
  assertSecretSafe(result.left, callbackSecret)
})

test("a valid transaction handle is consumed once even when its callback wrapper or parameters are malformed", async () => {
  const { client, transaction: { completeAuthorizationCallback } } = await loadWp6d()
  const issuer = "https://issuer.example"
  let getterCalls = 0
  const malformedWrapper = {
    transaction: transactionHandle(client),
    redirectUri: "https://client.example/callback?route=complete"
  }
  Object.defineProperty(malformedWrapper, "parameters", {
    enumerable: true,
    get: () => {
      getterCalls += 1
      return Redacted.make("state=hostile")
    }
  })
  const fixtures = [
    { name: "accessor-shaped wrapper", callback: malformedWrapper },
    { name: "malformed percent encoding", callback: callback(client, `state=%ZZ`) }
  ]
  const outcomes = []

  for (const fixture of fixtures) {
    const store = makeStore(client)
    const first = await Effect.runPromise(Effect.either(provideTransactionPorts(
      completeAuthorizationCallback({
        callback: fixture.callback,
        authorizationServerMetadata: metadata(client, issuer, true)
      }),
      client,
      store
    )))
    const corrected = await Effect.runPromise(Effect.either(provideTransactionPorts(
      completeAuthorizationCallback({
        callback: callback(client, new URLSearchParams({
          code: callbackSecret,
          state: expectedState,
          iss: issuer
        }).toString()),
        authorizationServerMetadata: metadata(client, issuer, true)
      }),
      client,
      store
    )))
    outcomes.push({ fixture, first, corrected, store })
  }

  assert.deepEqual({
    outcomes: outcomes.map(({ fixture, first, corrected, store }) => ({
      name: fixture.name,
      first: first._tag,
      firstTag: first.left?._tag,
      corrected: corrected._tag,
      correctedTag: corrected.left?._tag,
      correctedReason: corrected.left?.reason,
      storeCalls: store.calls.map(([operation]) => operation)
    })),
    getterCalls
  }, {
    outcomes: fixtures.map(({ name }) => ({
      name,
      first: "Left",
      firstTag: "AuthorizationProtocolError",
      corrected: "Left",
      correctedTag: "AuthorizationProtocolError",
      correctedReason: "StateReplay",
      storeCalls: ["takeTransaction", "takeTransaction"]
    })),
    getterCalls: 0
  })
})

test("an empty authorization scope set omits rather than emits an empty scope parameter", async () => {
  const { client, transaction: { startAuthorizationTransaction } } = await loadWp6d()
  const issuer = "https://issuer.example"
  const store = makeStore(client, {
    transaction: undefined,
    credential: { issuer, clientId: "wp6d-client" }
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

  const started = await Effect.runPromise(provideTransactionPorts(
    startAuthorizationTransaction({
      authorizationServerMetadata: metadata(client, issuer),
      issuer,
      canonicalResource: "https://resource.example/mcp",
      credentialHandle: credentialHandle(client),
      scopes: scopes(client, []),
      redirectUri: "https://client.example/callback?route=complete",
      createdAt: 123
    }),
    client,
    store,
    crypto
  ))
  const authorizationUri = new URL(Redacted.value(started.authorizationUri))
  const saved = store.calls.find(([operation]) => operation === "saveTransaction")?.[1]

  assert.equal(authorizationUri.searchParams.has("scope"), false)
  assert.deepEqual(saved.scopes, [])
})
