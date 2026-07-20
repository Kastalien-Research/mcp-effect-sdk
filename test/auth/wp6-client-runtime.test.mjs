import assert from "node:assert/strict"
import test from "node:test"
import * as Cause from "effect/Cause"
import * as Effect from "effect/Effect"
import * as Exit from "effect/Exit"
import * as Option from "effect/Option"
import * as Redacted from "effect/Redacted"
import * as Schema from "effect/Schema"

const encoder = new TextEncoder()

const loadClient = () => import("../../dist/auth/client.js")

const scopes = (client, values) => Schema.decodeUnknownSync(client.AuthorizationScopeSet)(values)

const jsonResponse = (body, status = 200) => ({
  status,
  headers: [["content-type", Redacted.make("application/json")]],
  body: Redacted.make(encoder.encode(JSON.stringify(body)))
})

const grantKey = ({ issuer, resource, clientId, scopes: requested }) =>
  JSON.stringify([issuer, resource, clientId, [...requested]])

const makeStore = (client, options = {}, events = []) => {
  const credentials = new Map(options.credentials ?? [])
  const grants = new Map(options.grants ?? [])
  const credentialIndex = new Map()
  const grantIndex = new Map()
  const transactions = new Map()
  let sequence = 0
  for (const [handle, credential] of credentials) {
    credentialIndex.set(JSON.stringify([credential.issuer, credential.clientId]), handle)
    if (!credentialIndex.has(JSON.stringify([credential.issuer, undefined]))) {
      credentialIndex.set(JSON.stringify([credential.issuer, undefined]), handle)
    }
  }
  for (const [handle, grant] of grants) grantIndex.set(grantKey(grant), handle)
  const missing = (operation) => Effect.fail(new client.AuthorizationStoreError({
    operation,
    reason: "NotFound"
  }))
  return {
    credentials,
    grants,
    transactions,
    events,
    service: {
      findCredential: (key) => Effect.sync(() => {
        events.push(["findCredential", key])
        const handle = credentialIndex.get(JSON.stringify([key.issuer, key.clientId])) ??
          credentialIndex.get(JSON.stringify([key.issuer, undefined]))
        return handle === undefined ? Option.none() : Option.some(handle)
      }),
      saveCredential: (value) => Effect.sync(() => {
        events.push(["saveCredential", value.issuer, value.clientId])
        const handle = `credential-runtime-${++sequence}`
        credentials.set(handle, value)
        credentialIndex.set(JSON.stringify([value.issuer, value.clientId]), handle)
        credentialIndex.set(JSON.stringify([value.issuer, undefined]), handle)
        return handle
      }),
      readCredential: (handle) => Effect.suspend(() => {
        events.push(["readCredential", handle])
        const value = credentials.get(handle)
        return value === undefined ? missing("readCredential") : Effect.succeed(value)
      }),
      findGrant: (key) => Effect.sync(() => {
        events.push(["findGrant", key])
        const handle = grantIndex.get(grantKey(key))
        return handle === undefined ? Option.none() : Option.some(handle)
      }),
      saveGrant: (value) => Effect.sync(() => {
        events.push(["saveGrant", [...value.scopes]])
        const handle = `grant-runtime-${++sequence}`
        grants.set(handle, value)
        grantIndex.set(grantKey(value), handle)
        return handle
      }),
      readGrant: (handle) => Effect.suspend(() => {
        events.push(["readGrant", handle])
        const value = grants.get(handle)
        return value === undefined ? missing("readGrant") : Effect.succeed(value)
      }),
      removeGrant: (handle) => Effect.sync(() => {
        events.push(["removeGrant", handle])
        const value = grants.get(handle)
        if (value !== undefined) grantIndex.delete(grantKey(value))
        grants.delete(handle)
      }),
      saveTransaction: (value) => Effect.sync(() => {
        const handle = `transaction-runtime-${++sequence}`
        events.push(["saveTransaction", handle])
        transactions.set(handle, value)
        return handle
      }),
      takeTransaction: (handle) => Effect.suspend(() => {
        events.push(["takeTransaction", handle])
        const value = transactions.get(handle)
        if (value === undefined) return missing("takeTransaction")
        transactions.delete(handle)
        return Effect.succeed(value)
      })
    }
  }
}

const makeFixture = (client, overrides = {}) => {
  const protectedResource = overrides.protectedResource ?? "https://resource.example/mcp"
  const issuer = overrides.issuer ?? "https://issuer.example"
  const redirectUri = overrides.redirectUri ?? "https://client.example/callback"
  const credentialHandle = "credential-runtime-existing"
  const credential = {
    issuer,
    clientId: "runtime-client",
    tokenEndpointAuthMethod: "none"
  }
  const events = []
  const store = makeStore(client, {
    credentials: [[credentialHandle, credential]],
    grants: overrides.grants ?? []
  }, events)
  const requests = []
  const http = {
    request: (request) => Effect.suspend(() => {
      requests.push(request)
      events.push(["http", request.method, request.url])
      if (overrides.httpFailure) return overrides.httpFailure(request)
      if (request.method === "POST") {
        return Effect.succeed(jsonResponse({
          access_token: "opaque-runtime-access",
          refresh_token: "opaque-runtime-refresh",
          token_type: "Bearer",
          scope: overrides.tokenScopes ?? "configured request challenge prior",
          expires_in: 60
        }))
      }
      if (request.url.includes("oauth-protected-resource") ||
        request.url === `${protectedResource}/.well-known-explicit`) {
        return Effect.succeed(jsonResponse({
          resource: protectedResource,
          authorization_servers: [issuer]
        }))
      }
      return Effect.succeed(jsonResponse({
        issuer,
        authorization_endpoint: `${issuer}/authorize`,
        token_endpoint: `${issuer}/token`,
        code_challenge_methods_supported: ["S256"],
        authorization_response_iss_parameter_supported: true
      }))
    })
  }
  const crypto = {
    randomBytes: (length) => Effect.succeed(Uint8Array.from({ length }, (_, index) => index + 1)),
    sha256: () => Effect.succeed(new Uint8Array(32).fill(7)),
    sign: () => Effect.die("sign is not used by the runtime fixture")
  }
  const opened = []
  const interaction = {
    open: (request) => Effect.sync(() => {
      events.push(["interaction:open"])
      opened.push(request)
    }),
    waitForCallback: (request) => overrides.interruptInteraction
      ? Effect.interrupt
      : Effect.sync(() => {
        events.push(["interaction:callback"])
        const transaction = store.transactions.get(request.transaction)
        assert.ok(transaction)
        return new client.AuthorizationCallbackInput({
          transaction: request.transaction,
          redirectUri: request.redirectUri,
          parameters: Redacted.make(
            `code=runtime-code&state=${Redacted.value(transaction.state)}&iss=${encodeURIComponent(issuer)}`
          )
        })
      })
  }
  const validateAudience = (input) => Effect.sync(() => {
    assert.equal(Redacted.isRedacted(input.token), true)
    events.push(["validateAudience", input.issuer, input.resource])
    return [input.resource]
  })
  const config = {
    protectedResource,
    requestedScopes: scopes(client, overrides.configuredScopes ?? ["configured"]),
    redirectUri,
    registration: {
      clientName: "Runtime fixture",
      redirectUris: [redirectUri],
      preRegisteredCredentials: [{ issuer, clientId: credential.clientId }]
    },
    validateAudience,
    ...(overrides.endpointPolicy === undefined ? {} : { endpointPolicy: overrides.endpointPolicy })
  }
  return { config, credential, credentialHandle, crypto, events, http, interaction, opened, requests, store }
}

const runtimeEffect = (client, fixture, config = fixture.config) =>
  client.makeAuthorizationClient(config).pipe(
    Effect.provideService(client.AuthorizationHttpClient, fixture.http),
    Effect.provideService(client.AuthorizationCrypto, fixture.crypto),
    Effect.provideService(client.AuthorizationInteraction, fixture.interaction),
    Effect.provideService(client.AuthorizationClientStore, fixture.store.service)
  )

const makeRuntime = (client, fixture, config = fixture.config) =>
  Effect.runPromise(runtimeEffect(client, fixture, config))

const runtimeFailure = (client, fixture, config = fixture.config) =>
  failure(runtimeEffect(client, fixture, config))

const failure = async (effect) => {
  const result = await Effect.runPromise(Effect.either(effect))
  if (result._tag === "Right") assert.fail("expected authorization runtime failure")
  return result.left
}

test("public factory snapshots a resource-bound configuration and rejects redirect, resource, and accessor adversaries", async () => {
  const client = await loadClient()
  assert.equal(typeof client.makeAuthorizationClient, "function")
  assert.equal(typeof client.layerAuthorizationClient, "function")
  const fixture = makeFixture(client)
  const runtime = await makeRuntime(client, fixture)
  const mismatch = await failure(runtime.currentGrant({
    protectedResource: "https://other.example/mcp",
    requestedScopes: scopes(client, ["request"])
  }))
  assert.equal(mismatch._tag, "AuthorizationProtocolError")
  assert.equal(mismatch.reason, "InvalidConfiguration")
  assert.equal(fixture.requests.length, 0)

  const wrongRedirect = { ...fixture.config, redirectUri: "https://client.example/other" }
  assert.equal((await runtimeFailure(client, fixture, wrongRedirect)).reason, "InvalidConfiguration")

  let getterCalls = 0
  const hostile = Object.defineProperty({}, "protectedResource", {
    enumerable: true,
    get() {
      getterCalls += 1
      return fixture.config.protectedResource
    }
  })
  assert.equal((await runtimeFailure(client, fixture, hostile)).reason, "InvalidConfiguration")
  assert.equal(getterCalls, 0)
})

test("currentGrant unions configured and request scopes and handles valid, expired-refreshable, and stale grants", async () => {
  const client = await loadClient()
  const now = Date.now()
  const requested = scopes(client, ["request", "configured"])
  const exactScopes = scopes(client, ["configured", "request"])
  const baseGrant = {
    issuer: "https://issuer.example",
    resource: "https://resource.example/mcp",
    clientId: "runtime-client",
    credentialHandle: "credential-runtime-existing",
    scopes: exactScopes,
    tokenType: "Bearer",
    accessToken: Redacted.make("old-access")
  }

  const valid = makeFixture(client, { grants: [["grant-valid", { ...baseGrant, expiresAt: now + 60_000 }]] })
  const validRuntime = await makeRuntime(client, valid)
  const current = await Effect.runPromise(validRuntime.currentGrant({
    protectedResource: valid.config.protectedResource,
    requestedScopes: requested
  }))
  assert.equal(Option.isSome(current), true)
  assert.equal(current.value, "grant-valid")
  assert.equal(valid.requests.some(({ method }) => method === "POST"), false)

  const refreshable = makeFixture(client, {
    grants: [["grant-expired", {
      ...baseGrant,
      refreshToken: Redacted.make("old-refresh"),
      expiresAt: now - 1
    }]],
    tokenScopes: "configured request"
  })
  const refreshRuntime = await makeRuntime(client, refreshable)
  const refreshed = await Effect.runPromise(refreshRuntime.currentGrant({
    protectedResource: refreshable.config.protectedResource,
    requestedScopes: requested
  }))
  assert.equal(Option.isSome(refreshed), true)
  assert.notEqual(refreshed.value, "grant-expired")
  assert.equal(refreshable.store.grants.has("grant-expired"), false)

  const stale = makeFixture(client, {
    grants: [["grant-stale", { ...baseGrant, expiresAt: now - 1 }]]
  })
  const staleRuntime = await makeRuntime(client, stale)
  const missing = await Effect.runPromise(staleRuntime.currentGrant({
    protectedResource: stale.config.protectedResource,
    requestedScopes: requested
  }))
  assert.equal(Option.isNone(missing), true)
  assert.equal(stale.store.grants.has("grant-stale"), false)
})

test("acquire reuses a current grant, otherwise performs interaction and captures the four ports once", async () => {
  const client = await loadClient()
  const fixture = makeFixture(client, { tokenScopes: "configured request" })
  const runtime = await makeRuntime(client, fixture)
  const replacementHttp = { request: () => Effect.die("runtime must retain the captured HTTP port") }
  const acquired = await Effect.runPromise(runtime.acquire({
    protectedResource: fixture.config.protectedResource,
    requestedScopes: scopes(client, ["request"])
  }).pipe(Effect.provideService(client.AuthorizationHttpClient, replacementHttp)))
  assert.equal(typeof acquired, "string")
  assert.equal(fixture.opened.length, 1)
  const authorizationUri = Redacted.value(fixture.opened[0].authorizationUri)
  assert.equal(new URL(authorizationUri).searchParams.get("scope"), "configured request")

  const reused = await Effect.runPromise(runtime.acquire({
    protectedResource: fixture.config.protectedResource,
    requestedScopes: scopes(client, ["request"])
  }))
  assert.equal(reused, acquired)
  assert.equal(fixture.opened.length, 1)
})

test("challenge handling removes invalid tokens and preserves insufficient-scope grants with prior-configured-challenge ordering", async () => {
  const client = await loadClient()
  const priorScopes = scopes(client, ["prior", "configured"])
  const makePrior = () => ({
    issuer: "https://issuer.example",
    resource: "https://resource.example/mcp",
    clientId: "runtime-client",
    credentialHandle: "credential-runtime-existing",
    scopes: priorScopes,
    tokenType: "Bearer",
    accessToken: Redacted.make("rejected-access")
  })
  for (const fixtureCase of [
    { status: 401, error: "invalid_token", removed: true },
    { status: 403, error: "insufficient_scope", removed: false }
  ]) {
    const fixture = makeFixture(client, {
      grants: [["grant-prior", makePrior()]],
      tokenScopes: "prior configured challenge"
    })
    const runtime = await makeRuntime(client, fixture)
    await Effect.runPromise(runtime.respondToChallenge({
      protectedResource: fixture.config.protectedResource,
      priorGrant: "grant-prior",
      challenge: new client.AuthorizationChallenge({
        scheme: "Bearer",
        status: fixtureCase.status,
        error: fixtureCase.error,
        scopes: scopes(client, ["challenge", "configured"]),
        resourceMetadata: `${fixture.config.protectedResource}/.well-known-explicit`
      })
    }))
    assert.equal(fixture.store.grants.has("grant-prior"), !fixtureCase.removed)
    assert.equal(new URL(Redacted.value(fixture.opened[0].authorizationUri)).searchParams.get("scope"),
      "prior configured challenge")
    const removeIndex = fixture.events.findIndex(([name]) => name === "removeGrant")
    const openIndex = fixture.events.findIndex(([name]) => name === "interaction:open")
    if (fixtureCase.removed) assert.ok(removeIndex >= 0 && removeIndex < openIndex)
    else assert.equal(removeIndex, -1)
  }
})

test("interaction interruption remains interruption rather than a typed OAuth failure", async () => {
  const client = await loadClient()
  const fixture = makeFixture(client, { interruptInteraction: true })
  const runtime = await makeRuntime(client, fixture)
  const exit = await Effect.runPromiseExit(runtime.acquire({
    protectedResource: fixture.config.protectedResource,
    requestedScopes: scopes(client, [])
  }))
  assert.equal(Exit.isFailure(exit), true)
  assert.equal(Cause.isInterruptedOnly(exit.cause), true)
})

test("endpoint policy defaults to HTTPS, permits only exact loopback HTTP through the full flow, and rejects non-loopback HTTP", async () => {
  const client = await loadClient()
  const denied = makeFixture(client, {
    protectedResource: "http://127.0.0.1:3100/mcp",
    issuer: "http://127.0.0.1:3200"
  })
  assert.equal((await runtimeFailure(client, denied)).reason, "InvalidConfiguration")
  assert.equal(denied.requests.length, 0)

  for (const host of ["localhost", "127.0.0.1", "[::1]"]) {
    const fixture = makeFixture(client, {
      protectedResource: `http://${host}:3100/mcp`,
      issuer: `http://${host}:3200`,
      redirectUri: `http://${host}:3300/callback`,
      endpointPolicy: "allow-loopback-http",
      tokenScopes: "configured"
    })
    const runtime = await makeRuntime(client, fixture)
    const handle = await Effect.runPromise(runtime.acquire({
      protectedResource: fixture.config.protectedResource,
      requestedScopes: scopes(client, [])
    }))
    assert.equal(typeof handle, "string", host)
  }

  const nonLoopback = makeFixture(client, {
    protectedResource: "http://resource.example/mcp",
    issuer: "http://issuer.example",
    redirectUri: "https://client.example/callback",
    endpointPolicy: "allow-loopback-http"
  })
  assert.equal((await runtimeFailure(client, nonLoopback)).reason, "InvalidConfiguration")
  assert.equal(nonLoopback.requests.length, 0)

  for (const protectedResource of [
    "http://localhost.example/mcp",
    "http://127.1/mcp",
    "http://2130706433/mcp",
    "http://0177.0.0.1/mcp",
    "http://%31%32%37.0.0.1/mcp",
    "http://user@localhost/mcp",
    "http://localhost/mcp#fragment"
  ]) {
    const hostile = makeFixture(client, {
      protectedResource,
      issuer: "http://localhost:3200",
      redirectUri: "http://localhost:3300/callback",
      endpointPolicy: "allow-loopback-http"
    })
    assert.equal((await runtimeFailure(client, hostile)).reason, "InvalidConfiguration",
      protectedResource)
    assert.equal(hostile.requests.length, 0, protectedResource)
  }
})
