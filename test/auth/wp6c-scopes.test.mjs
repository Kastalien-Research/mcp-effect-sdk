import assert from "node:assert/strict"
import test from "node:test"
import * as Effect from "effect/Effect"
import * as Redacted from "effect/Redacted"
import * as Schema from "effect/Schema"

const loadScopes = async () => {
  const resolution = await import("../../dist/auth/client/resolution.js")
  const client = await import("../../dist/auth/client.js")
  return { client, resolution }
}

const makeScopes = (client, values) =>
  Schema.decodeUnknownSync(client.AuthorizationScopeSet)(values)

const makeGrantHandle = (client, value = "prior-grant") =>
  Schema.decodeUnknownSync(client.AuthorizationGrantHandle)(value)

const makeMetadata = (client, scopesSupported) => Schema.decodeUnknownSync(
  client.ProtectedResourceMetadata
)({
  resource: "https://resource.example/mcp",
  authorization_servers: ["https://issuer.example"],
  ...(scopesSupported === undefined ? {} : { scopes_supported: scopesSupported })
})

const makeStoredGrant = (client, overrides = {}) => ({
  issuer: "https://issuer.example",
  resource: "https://resource.example/mcp",
  clientId: "scope-fixture-client",
  scopes: makeScopes(client, ["prior"]),
  tokenType: "Bearer",
  accessToken: Redacted.make("synthetic-scope-fixture-token"),
  ...overrides
})

const makeStore = (readGrant) => {
  const calls = []
  return {
    calls,
    service: {
      readGrant: (handle) => {
        calls.push(["readGrant", handle])
        return Effect.suspend(() => readGrant(handle))
      }
    }
  }
}

const runWithStore = (effect, store, client) => Effect.runPromise(
  Effect.provideService(effect, client.AuthorizationClientStore, store.service)
)

const failureWithStore = async (effect, store, client) => {
  const result = await Effect.runPromise(Effect.either(
    Effect.provideService(effect, client.AuthorizationClientStore, store.service)
  ))
  if (result._tag === "Right") assert.fail("expected scope resolution to fail")
  return result.left
}

test("scope resolution preserves prior-requested-challenge order and removes exact duplicates only", async () => {
  const { client, resolution: { resolveAuthorizationScopes } } = await loadScopes()
  const priorGrant = makeGrantHandle(client)
  const priorScopes = makeScopes(client, ["read", "Admin", "urn:scope"])
  const requestedScopes = makeScopes(client, ["read", "admin", "urn:scope:child", "write"])
  const challengeScopes = makeScopes(client, ["Admin", "write", "READ"])
  const store = makeStore(() => Effect.succeed(makeStoredGrant(client, { scopes: priorScopes })))

  const resolved = await runWithStore(resolveAuthorizationScopes({
    issuer: "https://issuer.example",
    canonicalResource: "https://resource.example/mcp",
    protectedResourceMetadata: makeMetadata(client, ["metadata-fallback-must-not-appear"]),
    requestedScopes,
    challengeScopes,
    priorGrant
  }), store, client)

  assert.deepEqual(resolved, [
    "read",
    "Admin",
    "urn:scope",
    "admin",
    "urn:scope:child",
    "write",
    "READ"
  ])
  assert.equal(Object.isFrozen(resolved), true)
  assert.throws(() => resolved.push("mutation"), TypeError)
  assert.deepEqual(Schema.decodeUnknownSync(client.AuthorizationScopeSet)(resolved), resolved)
  assert.deepEqual(store.calls, [["readGrant", priorGrant]])
})

test("metadata scopes are the fallback only when all explicit sources are empty and challenge is absent", async () => {
  const { client, resolution: { resolveAuthorizationScopes } } = await loadScopes()
  const store = makeStore(() => Effect.die("unexpected grant read"))
  const fallback = await runWithStore(resolveAuthorizationScopes({
    issuer: "https://issuer.example",
    canonicalResource: "https://resource.example/mcp",
    protectedResourceMetadata: makeMetadata(client, ["metadata-read", "Metadata-Case"]),
    requestedScopes: makeScopes(client, [])
  }), store, client)
  assert.deepEqual(fallback, ["metadata-read", "Metadata-Case"])
  assert.equal(Object.isFrozen(fallback), true)

  const noMetadata = await runWithStore(resolveAuthorizationScopes({
    issuer: "https://issuer.example",
    canonicalResource: "https://resource.example/mcp",
    protectedResourceMetadata: makeMetadata(client),
    requestedScopes: makeScopes(client, [])
  }), store, client)
  assert.deepEqual(noMetadata, [])
  assert.equal(Object.isFrozen(noMetadata), true)
  assert.deepEqual(Schema.decodeUnknownSync(client.AuthorizationScopeSet)(noMetadata), noMetadata)
  assert.deepEqual(store.calls, [])
})

test("an explicitly present empty challenge suppresses protected-resource metadata scopes", async () => {
  const { client, resolution: { resolveAuthorizationScopes } } = await loadScopes()
  const store = makeStore(() => Effect.die("unexpected grant read"))
  const resolved = await runWithStore(resolveAuthorizationScopes({
    issuer: "https://issuer.example",
    canonicalResource: "https://resource.example/mcp",
    protectedResourceMetadata: makeMetadata(client, ["metadata-must-not-appear"]),
    requestedScopes: makeScopes(client, []),
    challengeScopes: makeScopes(client, [])
  }), store, client)

  assert.deepEqual(resolved, [])
  assert.equal(Object.isFrozen(resolved), true)
  assert.deepEqual(store.calls, [])
})

test("prior grants must exactly match both selected issuer and canonical resource", async () => {
  const { client, resolution: { resolveAuthorizationScopes } } = await loadScopes()
  const priorGrant = makeGrantHandle(client)
  const base = {
    issuer: "https://issuer.example",
    canonicalResource: "https://resource.example/mcp",
    protectedResourceMetadata: makeMetadata(client, ["metadata-must-not-replace-invalid-prior"]),
    requestedScopes: makeScopes(client, ["requested"]),
    priorGrant
  }
  const fixtures = [
    {
      name: "issuer",
      grant: makeStoredGrant(client, {
        issuer: "https://other-issuer.example",
        scopes: makeScopes(client, ["invalid-prior-issuer-scope"])
      }),
      reason: "IssuerMismatch"
    },
    {
      name: "resource",
      grant: makeStoredGrant(client, {
        resource: "https://resource.example/other",
        scopes: makeScopes(client, ["invalid-prior-resource-scope"])
      }),
      reason: "ResourceMismatch"
    }
  ]

  for (const fixture of fixtures) {
    const store = makeStore(() => Effect.succeed(fixture.grant))
    const error = await failureWithStore(resolveAuthorizationScopes(base), store, client)
    assert.equal(error?._tag, "AuthorizationProtocolError", fixture.name)
    assert.equal(error.reason, fixture.reason, fixture.name)
    assert.deepEqual(store.calls, [["readGrant", priorGrant]], fixture.name)
  }
})

test("authorization store failures propagate unchanged", async () => {
  const { client, resolution: { resolveAuthorizationScopes } } = await loadScopes()
  const priorGrant = makeGrantHandle(client)
  const storeError = new client.AuthorizationStoreError({
    operation: "readGrant",
    reason: "Unavailable"
  })
  const store = makeStore(() => Effect.fail(storeError))

  const error = await failureWithStore(resolveAuthorizationScopes({
      issuer: "https://issuer.example",
      canonicalResource: "https://resource.example/mcp",
      protectedResourceMetadata: makeMetadata(client),
      requestedScopes: makeScopes(client, []),
      priorGrant
    }), store, client)
  assert.equal(error, storeError)
  assert.deepEqual(store.calls, [["readGrant", priorGrant]])
})
