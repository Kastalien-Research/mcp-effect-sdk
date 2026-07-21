import assert from "node:assert/strict"
import test from "node:test"
import * as Effect from "effect/Effect"
import * as Option from "effect/Option"
import * as Redacted from "effect/Redacted"
import * as Schema from "effect/Schema"

const encoder = new TextEncoder()

const loadWp6c = async () => {
  const uri = await import("../../dist/auth/client/uri.js")
  const discovery = await import("../../dist/auth/client/discovery.js")
  const resolution = await import("../../dist/auth/client/resolution.js")
  return { discovery, resolution, uri }
}

const jsonResponse = (body, status = 200) => ({
  status,
  headers: [["content-type", Redacted.make("application/json")]],
  body: Redacted.make(encoder.encode(JSON.stringify(body)))
})

const byteResponse = (body, status = 200) => ({
  status,
  headers: [["content-type", Redacted.make("application/json")]],
  body: Redacted.make(body)
})

const makeHttp = (respond) => {
  const requests = []
  return {
    requests,
    service: {
      request: (request) => {
        assert.equal(request.method, "GET")
        assert.equal(request.body, undefined)
        assert.deepEqual(request.headers, [])
        for (const [, value] of request.headers) {
          assert.equal(Redacted.isRedacted(value), true)
        }
        requests.push(request)
        return Effect.suspend(() => respond(request, requests.length - 1))
      }
    }
  }
}

const makeStore = ({ credentials = new Map(), handles = new Map() } = {}) => {
  const calls = []
  return {
    calls,
    service: {
      findCredential: (key) => Effect.sync(() => {
        calls.push(["findCredential", key])
        const handle = handles.get(key.issuer)
        return handle === undefined ? Option.none() : Option.some(handle)
      }),
      readCredential: (handle) => Effect.sync(() => {
        calls.push(["readCredential", handle])
        const credential = credentials.get(handle)
        if (credential === undefined) throw new Error("unexpected credential handle")
        return credential
      })
    }
  }
}

const runWithHttp = (effect, service, tag) => Effect.runPromise(
  Effect.provideService(effect, tag, service)
)

const runWithStore = (effect, service, tag) => Effect.runPromise(
  Effect.provideService(effect, tag, service)
)

const failureWithHttp = async (effect, service, tag) => {
  const result = await Effect.runPromise(Effect.either(
    Effect.provideService(effect, tag, service)
  ))
  if (result._tag === "Right") assert.fail("expected HTTP-backed Effect to fail")
  return result.left
}

const failureWithStore = async (effect, service, tag) => {
  const result = await Effect.runPromise(Effect.either(
    Effect.provideService(effect, tag, service)
  ))
  if (result._tag === "Right") assert.fail("expected store-backed Effect to fail")
  return result.left
}

const withWp6c = async (body) => {
  const modules = await loadWp6c()
  const client = await import("../../dist/auth/client.js")
  await body(modules, client)
}

test("explicit protected-resource metadata URI is exclusive and never falls back", async () =>
  withWp6c(async ({ discovery: { discoverProtectedResourceMetadata } }, client) => {
    const explicit = "https://resource.example/metadata"
    const http = makeHttp(() => Effect.succeed(jsonResponse({}, 404)))

    await assert.rejects(
      runWithHttp(discoverProtectedResourceMetadata({
        protectedResource: "https://resource.example/public/mcp",
        resourceMetadataUri: explicit
      }), http.service, client.AuthorizationHttpClient)
    )
    assert.deepEqual(http.requests.map(({ url }) => url), [explicit])
  }))

test("protected-resource discovery probes endpoint path then root, deduplicating root", async () =>
  withWp6c(async ({ discovery: { discoverProtectedResourceMetadata } }, client) => {
    const http = makeHttp((request) => Effect.succeed(
      request.url.endsWith("/public/mcp")
        ? jsonResponse({}, 404)
        : jsonResponse({
          resource: "https://resource.example/public",
          authorization_servers: ["https://issuer.example"]
        })
    ))
    const result = await runWithHttp(discoverProtectedResourceMetadata({
      protectedResource: "https://resource.example/public/mcp"
    }), http.service, client.AuthorizationHttpClient)

    assert.equal(result.canonicalResource, "https://resource.example/public")
    assert.equal(result.metadata.resource, "https://resource.example/public")
    assert.deepEqual(http.requests.map(({ url }) => url), [
      "https://resource.example/.well-known/oauth-protected-resource/public/mcp",
      "https://resource.example/.well-known/oauth-protected-resource"
    ])

    const rootHttp = makeHttp(() => Effect.succeed(jsonResponse({
      resource: "https://resource.example",
      authorization_servers: ["https://issuer.example"]
    })))
    await runWithHttp(discoverProtectedResourceMetadata({
      protectedResource: "https://resource.example"
    }), rootHttp.service, client.AuthorizationHttpClient)
    assert.deepEqual(rootHttp.requests.map(({ url }) => url), [
      "https://resource.example/.well-known/oauth-protected-resource"
    ])
  }))

test("protected-resource discovery advances only on 404 and fails closed on hostile bodies", async () =>
  withWp6c(async ({ discovery: { discoverProtectedResourceMetadata } }, client) => {
    const resource = "https://resource.example/mcp"
    const cases = [
      { name: "server failure", response: jsonResponse({}, 500), tag: "AuthorizationProtocolError" },
      { name: "malformed metadata", response: jsonResponse({ resource }), tag: "AuthorizationDecodeError" },
      {
        name: "malformed resource identifier",
        response: jsonResponse({
          resource: "not-an-absolute-uri",
          authorization_servers: ["https://issuer.example"]
        }),
        tag: "AuthorizationDecodeError"
      },
      {
        name: "resource identifier containing userinfo",
        response: jsonResponse({
          resource: "https://user@resource.example/public",
          authorization_servers: ["https://issuer.example"]
        }),
        tag: "AuthorizationDecodeError"
      },
      { name: "invalid UTF-8", response: byteResponse(Uint8Array.from([0xc3, 0x28])), tag: "AuthorizationDecodeError" },
      { name: "invalid JSON", response: byteResponse(encoder.encode("{")), tag: "AuthorizationDecodeError" },
      { name: "non-object JSON", response: jsonResponse([]), tag: "AuthorizationDecodeError" },
      { name: "oversize JSON", response: byteResponse(new Uint8Array(1024 * 1024 + 1)), tag: "AuthorizationDecodeError" }
    ]

    for (const fixture of cases) {
      const http = makeHttp(() => Effect.succeed(fixture.response))
      const error = await failureWithHttp(
        discoverProtectedResourceMetadata({ protectedResource: resource }),
        http.service,
        client.AuthorizationHttpClient
      )
      assert.equal(error?._tag, fixture.tag, fixture.name)
      assert.equal(http.requests.length, 1, `${fixture.name} must not downgrade to root fallback`)
    }
  }))

test("canonical protected resource requires exact origin and a path-segment parent", async () =>
  withWp6c(async ({ discovery: { discoverProtectedResourceMetadata } }, client) => {
    const requested = "https://resource.example/public/mcp"
    const accepted = [
      "https://resource.example/public/mcp",
      "https://resource.example/public",
      "https://resource.example"
    ]
    for (const resource of accepted) {
      const http = makeHttp(() => Effect.succeed(jsonResponse({
        resource,
        authorization_servers: ["https://issuer.example"]
      })))
      const result = await runWithHttp(discoverProtectedResourceMetadata({
        protectedResource: requested,
        resourceMetadataUri: "https://resource.example/metadata"
      }), http.service, client.AuthorizationHttpClient)
      assert.equal(result.canonicalResource, resource)
    }

    const rejected = [
      "https://other.example/public",
      "https://resource.example/publication",
      "https://resource.example/public/mcp/child",
      "https://resource.example/public#fragment"
    ]
    for (const resource of rejected) {
      const http = makeHttp(() => Effect.succeed(jsonResponse({
        resource,
        authorization_servers: ["https://issuer.example"]
      })))
      const error = await failureWithHttp(
        discoverProtectedResourceMetadata({
          protectedResource: requested,
          resourceMetadataUri: "https://resource.example/metadata"
        }),
        http.service,
        client.AuthorizationHttpClient
      )
      assert.equal(error?._tag, "AuthorizationProtocolError", resource)
      assert.equal(error.reason, "ResourceMismatch", resource)
    }
  }))

test("canonical resource rejects ambiguous IPv6 host and port origins", async () =>
  withWp6c(async ({ discovery: { discoverProtectedResourceMetadata } }, client) => {
    const collisionHttp = makeHttp(() => Effect.succeed(jsonResponse({
      resource: "https://[::1:8443]/public",
      authorization_servers: ["https://issuer.example"]
    })))
    const collision = await failureWithHttp(
      discoverProtectedResourceMetadata({
        protectedResource: "https://[::1]:8443/public/mcp",
        resourceMetadataUri: "https://resource.example/metadata"
      }),
      collisionHttp.service,
      client.AuthorizationHttpClient
    )
    assert.equal(collision?._tag, "AuthorizationProtocolError")
    assert.equal(collision.reason, "ResourceMismatch")
    assert.equal(collisionHttp.requests.length, 1)
  }))

test("canonical resource recognizes equivalent expanded and compressed IPv6 origins", async () =>
  withWp6c(async ({ discovery: { discoverProtectedResourceMetadata } }, client) => {
    const cases = [
      {
        resource: "https://[0:0:0:0:0:0:0:1]/public",
        protectedResource: "https://[::1]/public/mcp"
      },
      {
        resource: "https://[2001:0db8:0:0:0:0:0:1]/public",
        protectedResource: "https://[2001:db8::1]/public/mcp"
      }
    ]
    for (const fixture of cases) {
      const http = makeHttp(() => Effect.succeed(jsonResponse({
        resource: fixture.resource,
        authorization_servers: ["https://issuer.example"]
      })))
      const result = await runWithHttp(discoverProtectedResourceMetadata({
        protectedResource: fixture.protectedResource,
        resourceMetadataUri: "https://resource.example/metadata"
      }), http.service, client.AuthorizationHttpClient)
      assert.equal(result.canonicalResource, fixture.resource)
      assert.equal(http.requests.length, 1)
    }
  }))

test("malformed terminal compression after embedded IPv4 fails before HTTP", async () =>
  withWp6c(async ({ discovery: { discoverProtectedResourceMetadata } }, client) => {
    const cases = [
      {
        protectedResource: "https://[192.0.2.1::]/public/mcp",
        resource: "https://[c000:201::]/public"
      },
      {
        protectedResource: "https://[1:192.0.2.1::]/public/mcp",
        resource: "https://[1:c000:201::]/public"
      }
    ]
    const outcomes = []
    for (const fixture of cases) {
      const http = makeHttp(() => Effect.succeed(jsonResponse({
        resource: fixture.resource,
        authorization_servers: ["https://issuer.example"]
      })))
      const result = await Effect.runPromise(Effect.either(Effect.provideService(
        discoverProtectedResourceMetadata({
          protectedResource: fixture.protectedResource,
          resourceMetadataUri: "https://resource.example/metadata"
        }),
        client.AuthorizationHttpClient,
        http.service
      )))
      outcomes.push({ fixture, http, result })
    }
    for (const { fixture, http, result } of outcomes) {
      assert.equal(result._tag, "Left", fixture.protectedResource)
      assert.equal(result.left?._tag, "AuthorizationProtocolError", fixture.protectedResource)
      assert.equal(result.left.reason, "InvalidConfiguration", fixture.protectedResource)
      assert.deepEqual(http.requests, [], fixture.protectedResource)
    }
  }))

test("canonical resource compares equivalent decimal port spellings numerically", async () =>
  withWp6c(async ({ discovery: { discoverProtectedResourceMetadata } }, client) => {
    const cases = [
      {
        resource: "https://resource.example/public",
        protectedResource: "https://resource.example:0443/public/mcp"
      },
      {
        resource: "https://resource.example:8443/public",
        protectedResource: "https://resource.example:08443/public/mcp"
      },
      {
        resource: "https://[::1]/public",
        protectedResource: "https://[0:0:0:0:0:0:0:1]:00443/public/mcp"
      }
    ]
    const outcomes = []
    for (const fixture of cases) {
      const http = makeHttp(() => Effect.succeed(jsonResponse({
        resource: fixture.resource,
        authorization_servers: ["https://issuer.example"]
      })))
      const result = await Effect.runPromise(Effect.either(Effect.provideService(
        discoverProtectedResourceMetadata({
          protectedResource: fixture.protectedResource,
          resourceMetadataUri: "https://resource.example/metadata"
        }),
        client.AuthorizationHttpClient,
        http.service
      )))
      outcomes.push({ fixture, http, result })
    }
    for (const { fixture, http, result } of outcomes) {
      assert.equal(result._tag, "Right", fixture.protectedResource)
      assert.equal(result.right.canonicalResource, fixture.resource)
      assert.equal(http.requests.length, 1)
    }
  }))

test("protected-resource identifiers reject normalized dot traversal before HTTP", async () =>
  withWp6c(async ({ discovery: { discoverProtectedResourceMetadata } }, client) => {
    for (const protectedResource of [
      "https://resource.example/public/../admin",
      "https://resource.example/public/%2e%2e/admin",
      "https://resource.example/public/%252e%252e/admin"
    ]) {
      const traversalHttp = makeHttp(() => Effect.succeed(jsonResponse({
        resource: "https://resource.example/public",
        authorization_servers: ["https://issuer.example"]
      })))
      const traversal = await failureWithHttp(
        discoverProtectedResourceMetadata({
          protectedResource,
          resourceMetadataUri: "https://resource.example/metadata"
        }),
        traversalHttp.service,
        client.AuthorizationHttpClient
      )
      assert.equal(traversal?._tag, "AuthorizationProtocolError", protectedResource)
      assert.equal(traversal.reason, "InvalidConfiguration", protectedResource)
      assert.deepEqual(traversalHttp.requests, [], protectedResource)
    }
  }))

test("authorization-server discovery uses exact two-candidate root order", async () =>
  withWp6c(async ({ discovery: { discoverAuthorizationServerMetadata } }, client) => {
    const issuer = "https://issuer.example"
    const http = makeHttp((request) => Effect.succeed(
      request.url.endsWith("oauth-authorization-server")
        ? jsonResponse({}, 404)
        : jsonResponse({
          issuer,
          authorization_endpoint: `${issuer}/authorize`,
          token_endpoint: `${issuer}/token`
        })
    ))
    const metadata = await runWithHttp(
      discoverAuthorizationServerMetadata(issuer),
      http.service,
      client.AuthorizationHttpClient
    )
    assert.equal(metadata.issuer, issuer)
    assert.deepEqual(http.requests.map(({ url }) => url), [
      "https://issuer.example/.well-known/oauth-authorization-server",
      "https://issuer.example/.well-known/openid-configuration"
    ])
  }))

test("authorization-server discovery uses exact three-candidate path order", async () =>
  withWp6c(async ({ discovery: { discoverAuthorizationServerMetadata } }, client) => {
    const issuer = "https://issuer.example/tenant1"
    const http = makeHttp((request, index) => Effect.succeed(index < 2
      ? jsonResponse({}, 404)
      : jsonResponse({
        issuer,
        authorization_endpoint: "https://issuer.example/tenant1/authorize",
        token_endpoint: "https://issuer.example/tenant1/token"
      })))
    await runWithHttp(
      discoverAuthorizationServerMetadata(issuer),
      http.service,
      client.AuthorizationHttpClient
    )
    assert.deepEqual(http.requests.map(({ url }) => url), [
      "https://issuer.example/.well-known/oauth-authorization-server/tenant1",
      "https://issuer.example/.well-known/openid-configuration/tenant1",
      "https://issuer.example/tenant1/.well-known/openid-configuration"
    ])
  }))

test("issuer validation is exact and successful malformed/mismatched metadata never downgrades", async () =>
  withWp6c(async ({ discovery: { discoverAuthorizationServerMetadata } }, client) => {
    const advertised = "https://ISSUER.example/tenant"
    for (const documentIssuer of [
      "https://issuer.example/tenant",
      "https://ISSUER.example/tenant/",
      "https://ISSUER.example/%74enant"
    ]) {
      const http = makeHttp(() => Effect.succeed(jsonResponse({
        issuer: documentIssuer,
        authorization_endpoint: "https://issuer.example/authorize",
        token_endpoint: "https://issuer.example/token"
      })))
      const error = await failureWithHttp(
          discoverAuthorizationServerMetadata(advertised),
          http.service,
          client.AuthorizationHttpClient
      )
      assert.equal(error?._tag, "AuthorizationProtocolError")
      assert.equal(error.reason, "IssuerMismatch")
      assert.equal(http.requests.length, 1)
    }

    const noDefaults = makeHttp(() => Effect.succeed(jsonResponse({
      issuer: advertised,
      token_endpoint: "https://ISSUER.example/tenant/token"
    })))
    const metadata = await runWithHttp(
      discoverAuthorizationServerMetadata(advertised),
      noDefaults.service,
      client.AuthorizationHttpClient
    )
    assert.equal(metadata.authorizationEndpoint, undefined)
    assert.equal(metadata.tokenEndpoint, "https://ISSUER.example/tenant/token")
    assert.equal(noDefaults.requests.length, 1)

    const unsafeEndpoints = [
      {
        name: "authorization endpoint",
        document: {
          issuer: advertised,
          authorization_endpoint: "http://issuer.example/authorize",
          token_endpoint: "https://ISSUER.example/tenant/token"
        }
      },
      {
        name: "token endpoint",
        document: {
          issuer: advertised,
          authorization_endpoint: "https://ISSUER.example/tenant/authorize",
          token_endpoint: "http://issuer.example/token"
        }
      },
      {
        name: "registration endpoint",
        document: {
          issuer: advertised,
          authorization_endpoint: "https://ISSUER.example/tenant/authorize",
          token_endpoint: "https://ISSUER.example/tenant/token",
          registration_endpoint: "http://issuer.example/register"
        }
      }
    ]
    for (const fixture of unsafeEndpoints) {
      const http = makeHttp(() => Effect.succeed(jsonResponse(fixture.document)))
      const error = await failureWithHttp(
          discoverAuthorizationServerMetadata(advertised),
          http.service,
          client.AuthorizationHttpClient
      )
      assert.equal(error?._tag, "AuthorizationProtocolError", fixture.name)
      assert.equal(error.reason, "UnsupportedAuthorizationServer", fixture.name)
      assert.equal(http.requests.length, 1, `${fixture.name} must not downgrade`)
    }

    const exhausted = makeHttp(() => Effect.succeed(jsonResponse({}, 404)))
    const exhaustedError = await failureWithHttp(
        discoverAuthorizationServerMetadata("https://issuer.example"),
        exhausted.service,
        client.AuthorizationHttpClient
    )
    assert.equal(exhaustedError?._tag, "AuthorizationProtocolError")
    assert.equal(exhaustedError.reason, "DiscoveryFailed")
    assert.equal(exhausted.requests.length, 2)
  }))

test("multiple issuers select pre-registration, then stored credential, then document order without reuse", async () =>
  withWp6c(async ({ resolution: { selectAuthorizationServer } }, client) => {
    const issuers = [
      "https://issuer-a.example",
      "https://issuer-b.example",
      "https://issuer-c.example"
    ]
    const metadata = Schema.decodeUnknownSync(client.ProtectedResourceMetadata)({
      resource: "https://resource.example/mcp",
      authorization_servers: issuers
    })
    const handleA = Schema.decodeUnknownSync(client.AuthorizationCredentialHandle)("credential-a")
    const handleB = Schema.decodeUnknownSync(client.AuthorizationCredentialHandle)("credential-b")

    const preRegisteredStore = makeStore({
      credentials: new Map([[handleA, {
        issuer: issuers[0],
        clientId: "stored-a",
        clientSecret: Redacted.make("stored-secret-a")
      }]]),
      handles: new Map([[issuers[0], handleA]])
    })
    const preRegistered = await runWithStore(selectAuthorizationServer({
      metadata,
      preRegisteredCredentials: [{
        issuer: issuers[2],
        clientId: "configured-c",
        clientSecret: Redacted.make("configured-secret-c")
      }]
    }), preRegisteredStore.service, client.AuthorizationClientStore)
    assert.deepEqual(preRegistered, { issuer: issuers[2] })
    assert.deepEqual(preRegisteredStore.calls, [])

    const storedStore = makeStore({
      credentials: new Map([[handleB, {
        issuer: issuers[1],
        clientId: "stored-b",
        clientSecret: Redacted.make("stored-secret-b")
      }]]),
      handles: new Map([[issuers[1], handleB]])
    })
    const stored = await runWithStore(selectAuthorizationServer({
      metadata,
      preRegisteredCredentials: []
    }), storedStore.service, client.AuthorizationClientStore)
    assert.deepEqual(stored, { issuer: issuers[1], credentialHandle: handleB })
    assert.deepEqual(storedStore.calls, [
      ["findCredential", { issuer: issuers[0] }],
      ["findCredential", { issuer: issuers[1] }],
      ["readCredential", handleB]
    ])

    const documentOrderStore = makeStore()
    const documentOrder = await runWithStore(selectAuthorizationServer({
      metadata,
      preRegisteredCredentials: []
    }), documentOrderStore.service, client.AuthorizationClientStore)
    assert.deepEqual(documentOrder, { issuer: issuers[0] })
    assert.deepEqual(documentOrderStore.calls, issuers.map((issuer) => [
      "findCredential",
      { issuer }
    ]))

    const unadvertisedStore = makeStore()
    const unadvertised = await runWithStore(selectAuthorizationServer({
      metadata,
      preRegisteredCredentials: [{
        issuer: "https://unadvertised.example",
        clientId: "must-not-steer-selection",
        clientSecret: Redacted.make("unadvertised-secret")
      }]
    }), unadvertisedStore.service, client.AuthorizationClientStore)
    assert.deepEqual(unadvertised, { issuer: issuers[0] })
    assert.deepEqual(unadvertisedStore.calls, issuers.map((issuer) => [
      "findCredential",
      { issuer }
    ]))

    const corruptStore = makeStore({
      credentials: new Map([[handleA, {
        issuer: issuers[1],
        clientId: "wrong-issuer",
        clientSecret: Redacted.make("wrong-issuer-secret")
      }]]),
      handles: new Map([[issuers[0], handleA], [issuers[1], handleB]])
    })
    const corruptError = await failureWithStore(selectAuthorizationServer({
        metadata,
        preRegisteredCredentials: []
      }), corruptStore.service, client.AuthorizationClientStore)
    assert.equal(corruptError?._tag, "AuthorizationProtocolError")
    assert.equal(corruptError.reason, "CredentialIssuerMismatch")
    assert.deepEqual(corruptStore.calls, [
      ["findCredential", { issuer: issuers[0] }],
      ["readCredential", handleA]
    ])
  }))
