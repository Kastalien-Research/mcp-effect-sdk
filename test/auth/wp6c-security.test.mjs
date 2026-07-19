import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"
import { inspect } from "node:util"
import test from "node:test"
import * as Cause from "effect/Cause"
import * as Deferred from "effect/Deferred"
import * as Effect from "effect/Effect"
import * as Exit from "effect/Exit"
import * as Fiber from "effect/Fiber"
import * as Option from "effect/Option"
import * as Redacted from "effect/Redacted"
import * as Schema from "effect/Schema"

const encoder = new TextEncoder()

const loadWp6c = async () => {
  const resolution = await import("../../dist/auth/client/resolution.js")
  const client = await import("../../dist/auth/client.js")
  return { client, resolution }
}

const jsonResponse = (body, status = 200) => ({
  status,
  headers: [["content-type", Redacted.make("application/json")]],
  body: Redacted.make(encoder.encode(JSON.stringify(body)))
})

const makeScopes = (client, values) =>
  Schema.decodeUnknownSync(client.AuthorizationScopeSet)(values)

const makeCredentialHandle = (client, value = "resolved-credential") =>
  Schema.decodeUnknownSync(client.AuthorizationCredentialHandle)(value)

const makeGrantHandle = (client, value = "prior-grant") =>
  Schema.decodeUnknownSync(client.AuthorizationGrantHandle)(value)

const makeHttp = (respond, events = []) => {
  const requests = []
  return {
    requests,
    service: {
      request: (request) => {
        requests.push(request)
        events.push(`http:${request.url}`)
        return Effect.suspend(() => respond(request, requests.length - 1))
      }
    }
  }
}

const makeStore = (client, options = {}, events = []) => {
  const calls = []
  return {
    calls,
    service: {
      findCredential: (key) => {
        calls.push(["findCredential", key])
        events.push("store:findCredential")
        return Effect.succeed(Option.none())
      },
      readCredential: (handle) => {
        calls.push(["readCredential", handle])
        events.push("store:readCredential")
        return options.readCredential === undefined
          ? Effect.die("unexpected credential read")
          : options.readCredential(handle)
      },
      saveCredential: (credential) => {
        calls.push(["saveCredential", credential])
        events.push("store:saveCredential")
        return options.saveCredential === undefined
          ? Effect.die("unexpected credential save")
          : options.saveCredential(credential)
      },
      readGrant: (handle) => {
        calls.push(["readGrant", handle])
        events.push("store:readGrant")
        return options.readGrant === undefined
          ? Effect.die("unexpected grant read")
          : options.readGrant(handle)
      }
    }
  }
}

const providePorts = (effect, http, store, client) => effect.pipe(
  Effect.provideService(client.AuthorizationHttpClient, http.service),
  Effect.provideService(client.AuthorizationClientStore, store.service)
)

const failureWithPorts = async (effect, http, store, client) => {
  const result = await Effect.runPromise(Effect.either(providePorts(effect, http, store, client)))
  if (result._tag === "Right") assert.fail("expected authorization context to fail")
  return result.left
}

const makeConfiguration = (overrides = {}) => ({
  clientName: "WP6C context fixture",
  redirectUris: ["https://client.example/callback"],
  preRegisteredCredentials: [],
  ...overrides
})

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

const assertNoSentinel = (error, sentinel) => {
  assert.equal(recursivelyContains(error, sentinel), false)
  const rendered = [String(error), inspect(error)]
  try {
    rendered.push(JSON.stringify(error))
  } catch {
    // A safe error need not be JSON serializable, but it must not retain the sentinel.
  }
  assert.equal(rendered.join(" ").includes(sentinel), false)
}

test("authorization context composes discovery, exact selection, scopes, and credentials in order", async () => {
  const { client, resolution: { resolveAuthorizationContext } } = await loadWp6c()
  const resourceMetadataUri = "https://resource.example/metadata"
  const protectedResource = "https://resource.example/public/mcp"
  const canonicalResource = "https://resource.example/public"
  const issuer = "https://issuer-b.example"
  const credentialHandle = makeCredentialHandle(client)
  const priorGrant = makeGrantHandle(client)
  const events = []
  const http = makeHttp((request) => {
    if (request.url === resourceMetadataUri) {
      return Effect.succeed(jsonResponse({
        resource: canonicalResource,
        authorization_servers: ["https://issuer-a.example", issuer],
        scopes_supported: ["metadata-fallback-must-not-appear"]
      }))
    }
    if (request.url === `${issuer}/.well-known/oauth-authorization-server`) {
      return Effect.succeed(jsonResponse({}, 404))
    }
    if (request.url === `${issuer}/.well-known/openid-configuration`) {
      return Effect.succeed(jsonResponse({
        issuer,
        authorization_endpoint: `${issuer}/authorize`,
        token_endpoint: `${issuer}/token`
      }))
    }
    return Effect.die("unexpected context request")
  }, events)
  const store = makeStore(client, {
    readGrant: () => Effect.succeed({
      issuer,
      resource: canonicalResource,
      clientId: "configured-client",
      scopes: makeScopes(client, ["prior", "shared"]),
      tokenType: "Bearer",
      accessToken: Redacted.make("synthetic-context-token")
    }),
    saveCredential: () => Effect.succeed(credentialHandle)
  }, events)

  const result = await Effect.runPromise(providePorts(resolveAuthorizationContext({
    protectedResource,
    resourceMetadataUri,
    requestedScopes: makeScopes(client, ["requested", "shared"]),
    challengeScopes: makeScopes(client, ["challenge", "requested"]),
    priorGrant,
    configuration: makeConfiguration({
      preRegisteredCredentials: [{
        issuer,
        clientId: "configured-client",
        clientSecret: Redacted.make("synthetic-configured-secret")
      }]
    })
  }), http, store, client))

  assert.deepEqual(Object.keys(result).sort(), [
    "authorizationServerMetadata",
    "canonicalResource",
    "credentialHandle",
    "issuer",
    "protectedResourceMetadata",
    "scopes"
  ])
  assert.equal(result.issuer, issuer)
  assert.equal(result.canonicalResource, canonicalResource)
  assert.equal(result.credentialHandle, credentialHandle)
  assert.equal(Schema.is(client.ProtectedResourceMetadata)(result.protectedResourceMetadata), true)
  assert.equal(Schema.is(client.AuthorizationServerMetadata)(result.authorizationServerMetadata), true)
  assert.equal(Schema.is(client.AuthorizationCredentialHandle)(result.credentialHandle), true)
  assert.equal(Schema.is(client.AuthorizationScopeSet)(result.scopes), true)
  assert.deepEqual(result.scopes, ["prior", "shared", "requested", "challenge"])
  assert.equal(Object.isFrozen(result.scopes), true)
  assert.equal(Object.isFrozen(result.protectedResourceMetadata.authorizationServers), true)
  assert.deepEqual(events, [
    `http:${resourceMetadataUri}`,
    `http:${issuer}/.well-known/oauth-authorization-server`,
    `http:${issuer}/.well-known/openid-configuration`,
    "store:readGrant",
    "store:saveCredential"
  ])
})

test("an interrupted never-ending HTTP operation remains interruption", async () => {
  const { client, resolution: { resolveAuthorizationContext } } = await loadWp6c()
  const started = await Effect.runPromise(Deferred.make())
  const http = makeHttp(() => Effect.zipRight(
    Deferred.succeed(started, undefined),
    Effect.never
  ))
  const store = makeStore(client)
  const effect = providePorts(resolveAuthorizationContext({
    protectedResource: "https://resource.example/mcp",
    requestedScopes: makeScopes(client, []),
    configuration: makeConfiguration()
  }), http, store, client)
  const fiber = Effect.runFork(effect)
  await Effect.runPromise(Deferred.await(started))
  const exit = await Effect.runPromise(Fiber.interrupt(fiber))

  assert.equal(Exit.isFailure(exit), true)
  assert.equal(Cause.isInterruptedOnly(exit.cause), true)
})

test("hostile, revoked, and body-bearing port responses fail closed without recursive disclosure", async () => {
  const { client, resolution: { resolveAuthorizationContext } } = await loadWp6c()
  const responseSentinel = "synthetic-hostile-response-sentinel"
  const hostileConfiguration = {
    clientName: "Hostile configuration",
    preRegisteredCredentials: []
  }
  Object.defineProperty(hostileConfiguration, "redirectUris", {
    enumerable: true,
    get: () => {
      throw new Error(responseSentinel)
    }
  })
  for (const configuration of [
    makeConfiguration({ redirectUris: ["http://remote.example/callback"] }),
    hostileConfiguration
  ]) {
    const http = makeHttp(() => Effect.die("configuration must fail before HTTP"))
    const store = makeStore(client)
    const error = await failureWithPorts(resolveAuthorizationContext({
      protectedResource: "https://resource.example/mcp",
      requestedScopes: makeScopes(client, []),
      configuration
    }), http, store, client)
    assert.equal(error?._tag, "AuthorizationProtocolError")
    assert.equal(error.reason, "InvalidConfiguration")
    assert.deepEqual(http.requests, [])
    assert.deepEqual(store.calls, [])
    assertNoSentinel(error, responseSentinel)
  }

  const hostile = { status: 200, headers: [] }
  Object.defineProperty(hostile, "body", {
    enumerable: true,
    get: () => {
      throw new Error(responseSentinel)
    }
  })
  const revocable = Proxy.revocable(jsonResponse({}), {})
  revocable.revoke()
  const fixtures = [
    { name: "accessor", response: hostile },
    { name: "revoked proxy", response: revocable.proxy },
    { name: "non-2xx body", response: jsonResponse({ detail: responseSentinel }, 500) }
  ]

  for (const fixture of fixtures) {
    const http = makeHttp(() => Effect.succeed(fixture.response))
    const store = makeStore(client)
    const error = await failureWithPorts(resolveAuthorizationContext({
      protectedResource: "https://resource.example/mcp",
      resourceMetadataUri: "https://resource.example/metadata",
      requestedScopes: makeScopes(client, []),
      configuration: makeConfiguration()
    }), http, store, client)

    assert.match(String(error?._tag), /^Authorization/, fixture.name)
    assertNoSentinel(error, responseSentinel)
    assert.equal(http.requests.length, 1, fixture.name)
  }
})

test("advertised issuers reject non-HTTPS, query, and fragment identifiers before discovery", async () => {
  const { client, resolution: { resolveAuthorizationContext } } = await loadWp6c()
  const fixtures = [
    { issuer: "http://issuer.example", sentinel: undefined },
    {
      issuer: "https://issuer.example?marker=synthetic-query-sentinel",
      sentinel: "synthetic-query-sentinel"
    },
    {
      issuer: "https://issuer.example#synthetic-fragment-sentinel",
      sentinel: "synthetic-fragment-sentinel"
    }
  ]

  for (const fixture of fixtures) {
    const http = makeHttp(() => Effect.succeed(jsonResponse({
      resource: "https://resource.example/mcp",
      authorization_servers: [fixture.issuer]
    })))
    const store = makeStore(client)
    const error = await failureWithPorts(resolveAuthorizationContext({
      protectedResource: "https://resource.example/mcp",
      resourceMetadataUri: "https://resource.example/metadata",
      requestedScopes: makeScopes(client, []),
      configuration: makeConfiguration()
    }), http, store, client)

    assert.equal(error?._tag, "AuthorizationProtocolError")
    assert.equal(error.reason, "UnsupportedAuthorizationServer")
    assert.equal(http.requests.length, 1)
    if (fixture.sentinel !== undefined) assertNoSentinel(error, fixture.sentinel)
  }
})

test("WP6C emitted graphs remain platform-neutral while public package surfaces stay unchanged", async () => {
  await loadWp6c()
  const modules = ["uri", "json", "discovery", "registration", "resolution"]
  const forbidden = /(?:\b(?:URL|TextEncoder|TextDecoder|Promise|fetch|Request|Response|Headers|AbortSignal|Buffer|Node)\b|node:|@effect\/platform|effect\/unstable|\bunstable\b)/
  for (const moduleName of modules) {
    for (const extension of ["js", "d.ts"]) {
      const path = `dist/auth/client/${moduleName}.${extension}`
      const source = await readFile(path, "utf8")
      assert.doesNotMatch(source, forbidden, path)
    }
  }

  const authClient = await import("../../dist/auth/client.js")
  assert.deepEqual(Object.keys(authClient).sort(), [
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
  ])

  const packageJson = JSON.parse(await readFile("package.json", "utf8"))
  assert.deepEqual(packageJson.exports, {
    ".": { import: "./dist/index.js", types: "./dist/index.d.ts" },
    "./client": { import: "./dist/client.js", types: "./dist/client.d.ts" },
    "./auth/client": { import: "./dist/auth/client.js", types: "./dist/auth/client.d.ts" },
    "./auth/protected-resource": {
      import: "./dist/auth/protected-resource.js",
      types: "./dist/auth/protected-resource.d.ts"
    },
    "./integrations/effect-platform": {
      import: "./dist/integrations/EffectPlatform.js",
      types: "./dist/integrations/EffectPlatform.d.ts"
    },
    "./transport/stdio": {
      import: "./dist/transport/stdio.js",
      types: "./dist/transport/stdio.d.ts"
    },
    "./transport/http": {
      import: "./dist/transport/http.js",
      types: "./dist/transport/http.d.ts"
    },
    "./deprecated": { import: "./dist/deprecated.js", types: "./dist/deprecated.d.ts" },
    "./server": { import: "./dist/server.js", types: "./dist/server.d.ts" },
    "./protocol/2026-07-28": {
      import: "./dist/protocol/2026-07-28.js",
      types: "./dist/protocol/2026-07-28.d.ts"
    }
  })
  assert.equal(packageJson.packageManager, "pnpm@10.11.1")
  assert.deepEqual(packageJson.dependencies, { ajv: "8.20.0" })
  assert.deepEqual(packageJson.peerDependencies, {
    "@effect/platform": "^0.97.0",
    effect: "^3.22.0"
  })
  assert.deepEqual(packageJson.devDependencies, {
    "@effect/platform-node": "0.108.0",
    "@effect/rpc": "0.76.0",
    "ajv-formats": "3.0.1",
    "@types/node": "^22.0.0",
    effect: "3.22.0",
    typescript: "^5.9.3"
  })
  assert.deepEqual(packageJson.pnpm?.overrides, { "@effect/rpc": "0.76.0" })

  const root = await import("../../dist/index.js")
  assert.equal(typeof root.OAuth, "object")
  assert.equal(typeof root.OAuthProviders, "object")
  assert.equal(typeof root.OAuthErrors, "object")
  assert.equal("AuthorizationClient" in root, false)
  assert.equal("resolveAuthorizationContext" in authClient, false)
})
