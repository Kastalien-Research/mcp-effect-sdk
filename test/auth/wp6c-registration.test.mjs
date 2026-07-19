import assert from "node:assert/strict"
import test from "node:test"
import { inspect } from "node:util"
import * as Effect from "effect/Effect"
import * as Option from "effect/Option"
import * as Redacted from "effect/Redacted"
import * as Schema from "effect/Schema"

const encoder = new TextEncoder()
const decoder = new TextDecoder("utf-8", { fatal: true })

const loadRegistration = async () => {
  const registration = await import("../../dist/auth/client/registration.js")
  const client = await import("../../dist/auth/client.js")
  return { client, registration }
}

const jsonResponse = (body, status = 201) => ({
  status,
  headers: [["content-type", Redacted.make("application/json")]],
  body: Redacted.make(encoder.encode(JSON.stringify(body)))
})

const byteResponse = (body, status = 201) => ({
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
        requests.push(request)
        return Effect.suspend(() => respond(request, requests.length - 1))
      }
    }
  }
}

const makeStore = ({ credentials = new Map(), handles = new Map(), saveHandles = [] } = {}) => {
  const calls = []
  const saved = []
  let saveIndex = 0
  return {
    calls,
    saved,
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
      }),
      saveCredential: (credential) => Effect.sync(() => {
        calls.push(["saveCredential", credential])
        saved.push(credential)
        const handle = saveHandles[saveIndex]
        saveIndex += 1
        if (handle === undefined) throw new Error("unexpected credential save")
        return handle
      })
    }
  }
}

const runWithPorts = (effect, http, store, client) => Effect.runPromise(effect.pipe(
  Effect.provideService(client.AuthorizationHttpClient, http.service),
  Effect.provideService(client.AuthorizationClientStore, store.service)
))

const failureWithPorts = async (effect, http, store, client) => {
  const result = await Effect.runPromise(Effect.either(effect.pipe(
    Effect.provideService(client.AuthorizationHttpClient, http.service),
    Effect.provideService(client.AuthorizationClientStore, store.service)
  )))
  if (result._tag === "Right") assert.fail("expected credential resolution to fail")
  return result.left
}

const makeConfiguration = (overrides = {}) => ({
  clientName: "WP6C registration fixture",
  redirectUris: ["https://client.example/callback"],
  preRegisteredCredentials: [],
  ...overrides
})

const makeMetadata = (client, issuer, overrides = {}) => Schema.decodeUnknownSync(
  client.AuthorizationServerMetadata
)({
  issuer,
  token_endpoint: `${issuer}/token`,
  ...overrides
})

const makeScopes = (client, values = ["read", "write"]) =>
  Schema.decodeUnknownSync(client.AuthorizationScopeSet)(values)

const makeHandle = (client, value) =>
  Schema.decodeUnknownSync(client.AuthorizationCredentialHandle)(value)

test("configuration refinement rejects non-string redacted secrets before port activity", async () => {
  const {
    client,
    registration: {
      resolveAuthorizationCredential,
      snapshotAuthorizationResolutionConfiguration
    }
  } = await loadRegistration()
  const issuer = "https://issuer.example"
  const configuration = makeConfiguration({
    preRegisteredCredentials: [{
      issuer,
      clientId: "configured-client",
      clientSecret: Redacted.make(123)
    }]
  })

  assert.equal(snapshotAuthorizationResolutionConfiguration(configuration), undefined)

  const http = makeHttp(() => Effect.die("invalid secret reached HTTP"))
  const store = makeStore()
  const error = await failureWithPorts(resolveAuthorizationCredential({
    issuer,
    authorizationServerMetadata: makeMetadata(client, issuer),
    scopes: makeScopes(client),
    configuration
  }), http, store, client)
  assert.equal(error?._tag, "AuthorizationProtocolError")
  assert.equal(error.reason, "InvalidConfiguration")
  assert.deepEqual(http.requests, [])
  assert.deepEqual(store.calls, [])
})

test("credential resolution uses pre-registration, stored reuse, CIMD, DCR, then unsupported precedence", async () => {
  const { client, registration: { resolveAuthorizationCredential } } = await loadRegistration()
  const issuer = "https://issuer.example"
  const selectedHandle = makeHandle(client, "selected-credential")
  const foundHandle = makeHandle(client, "found-credential")
  const configuredHandle = makeHandle(client, "configured-credential")
  const cimdHandle = makeHandle(client, "cimd-credential")
  const dcrHandle = makeHandle(client, "dcr-credential")
  const allMechanisms = makeMetadata(client, issuer, {
    registration_endpoint: `${issuer}/register`,
    client_id_metadata_document_supported: true
  })
  const base = {
    issuer,
    authorizationServerMetadata: allMechanisms,
    selectedCredentialHandle: selectedHandle,
    scopes: makeScopes(client),
    configuration: makeConfiguration({
      clientIdMetadataDocument: "https://client.example/client-metadata.json",
      preRegisteredCredentials: [{
        issuer,
        clientId: "configured-client",
        clientSecret: Redacted.make("configured-secret")
      }]
    })
  }

  const configuredHttp = makeHttp(() => Effect.die("unexpected HTTP request"))
  const configuredStore = makeStore({ saveHandles: [configuredHandle] })
  const configured = await runWithPorts(
    resolveAuthorizationCredential(base),
    configuredHttp,
    configuredStore,
    client
  )
  assert.equal(configured, configuredHandle)
  assert.equal(configuredStore.saved.length, 1)
  assert.equal(configuredStore.saved[0].issuer, issuer)
  assert.equal(configuredStore.saved[0].clientId, "configured-client")
  assert.equal(Redacted.isRedacted(configuredStore.saved[0].clientSecret), true)
  assert.deepEqual(configuredHttp.requests, [])
  assert.deepEqual(configuredStore.calls.map(([operation]) => operation), ["saveCredential"])

  const selectedHttp = makeHttp(() => Effect.die("unexpected HTTP request"))
  const selectedStore = makeStore({
    credentials: new Map([[selectedHandle, { issuer, clientId: "selected-client" }]])
  })
  const selected = await runWithPorts(resolveAuthorizationCredential({
    ...base,
    configuration: makeConfiguration()
  }), selectedHttp, selectedStore, client)
  assert.equal(selected, selectedHandle)
  assert.deepEqual(selectedStore.calls, [["readCredential", selectedHandle]])
  assert.deepEqual(selectedHttp.requests, [])

  const foundHttp = makeHttp(() => Effect.die("unexpected HTTP request"))
  const foundStore = makeStore({
    credentials: new Map([[foundHandle, { issuer, clientId: "found-client" }]]),
    handles: new Map([[issuer, foundHandle]])
  })
  const found = await runWithPorts(resolveAuthorizationCredential({
    ...base,
    selectedCredentialHandle: undefined,
    configuration: makeConfiguration()
  }), foundHttp, foundStore, client)
  assert.equal(found, foundHandle)
  assert.deepEqual(foundStore.calls, [
    ["findCredential", { issuer }],
    ["readCredential", foundHandle]
  ])
  assert.deepEqual(foundHttp.requests, [])

  const cimdHttp = makeHttp(() => Effect.die("unexpected HTTP request"))
  const cimdStore = makeStore({ saveHandles: [cimdHandle] })
  const cimd = await runWithPorts(resolveAuthorizationCredential({
    ...base,
    selectedCredentialHandle: undefined,
    configuration: makeConfiguration({
      clientIdMetadataDocument: "https://client.example/client-metadata.json"
    })
  }), cimdHttp, cimdStore, client)
  assert.equal(cimd, cimdHandle)
  assert.deepEqual(cimdStore.saved, [{
    issuer,
    clientId: "https://client.example/client-metadata.json"
  }])
  assert.deepEqual(cimdHttp.requests, [])

  const dcrHttp = makeHttp(() => Effect.succeed(jsonResponse({ client_id: "dcr-client" })))
  const dcrStore = makeStore({ saveHandles: [dcrHandle] })
  const dcr = await runWithPorts(resolveAuthorizationCredential({
    ...base,
    authorizationServerMetadata: makeMetadata(client, issuer, {
      registration_endpoint: `${issuer}/register`
    }),
    selectedCredentialHandle: undefined,
    configuration: makeConfiguration()
  }), dcrHttp, dcrStore, client)
  assert.equal(dcr, dcrHandle)
  assert.equal(dcrHttp.requests.length, 1)

  const unsafeEndpointHttp = makeHttp(() => Effect.die("unsafe registration endpoint used"))
  const unsafeEndpointStore = makeStore()
  const unsafeEndpointError = await failureWithPorts(resolveAuthorizationCredential({
    ...base,
    authorizationServerMetadata: makeMetadata(client, issuer, {
      registration_endpoint: "http://issuer.example/register"
    }),
    selectedCredentialHandle: undefined,
    configuration: makeConfiguration()
  }), unsafeEndpointHttp, unsafeEndpointStore, client)
  assert.equal(unsafeEndpointError?._tag, "AuthorizationProtocolError")
  assert.equal(unsafeEndpointError.reason, "UnsupportedAuthorizationServer")
  assert.deepEqual(unsafeEndpointHttp.requests, [])
  assert.deepEqual(unsafeEndpointStore.calls, [])

  const unsupportedHttp = makeHttp(() => Effect.die("unexpected HTTP request"))
  const unsupportedStore = makeStore()
  const unsupportedError = await failureWithPorts(resolveAuthorizationCredential({
      ...base,
      authorizationServerMetadata: makeMetadata(client, issuer),
      selectedCredentialHandle: undefined,
      configuration: makeConfiguration()
    }), unsupportedHttp, unsupportedStore, client)
  assert.equal(unsupportedError?._tag, "AuthorizationProtocolError")
  assert.equal(unsupportedError.reason, "UnsupportedRegistration")
  assert.deepEqual(unsupportedHttp.requests, [])
})

test("redirect and CIMD identifiers are validated before port activity", async () => {
  const { client, registration: { resolveAuthorizationCredential } } = await loadRegistration()
  const issuer = "https://issuer.example"
  const metadata = makeMetadata(client, issuer, {
    registration_endpoint: `${issuer}/register`,
    client_id_metadata_document_supported: true
  })
  const invalidConfigurations = [
    makeConfiguration({ redirectUris: ["http://remote.example/callback"] }),
    makeConfiguration({ redirectUris: ["https://user@client.example/callback"] }),
    makeConfiguration({ redirectUris: ["https://client.example/callback#fragment"] }),
    makeConfiguration({ redirectUris: ["ftp://client.example/callback"] }),
    makeConfiguration({ clientIdMetadataDocument: "http://client.example/client.json" }),
    makeConfiguration({ clientIdMetadataDocument: "https://client.example" }),
    makeConfiguration({ clientIdMetadataDocument: "https://user@client.example/client.json" }),
    makeConfiguration({ clientIdMetadataDocument: "https://client.example/client.json?version=1" }),
    makeConfiguration({ clientIdMetadataDocument: "https://client.example/client.json#fragment" })
  ]

  for (const configuration of invalidConfigurations) {
    const http = makeHttp(() => Effect.die("unexpected HTTP request"))
    const store = makeStore()
    const error = await failureWithPorts(resolveAuthorizationCredential({
        issuer,
        authorizationServerMetadata: metadata,
        scopes: makeScopes(client),
        configuration
      }), http, store, client)
    assert.equal(error?._tag, "AuthorizationProtocolError")
    assert.equal(error.reason, "InvalidConfiguration")
    assert.deepEqual(http.requests, [], JSON.stringify(configuration.redirectUris))
    assert.deepEqual(store.calls, [], JSON.stringify(configuration.redirectUris))
  }

  const acceptedHandle = makeHandle(client, "accepted-loopback-redirects")
  const acceptedHttp = makeHttp(() => Effect.die("unexpected HTTP request"))
  const acceptedStore = makeStore({ saveHandles: [acceptedHandle] })
  const accepted = await runWithPorts(resolveAuthorizationCredential({
    issuer,
    authorizationServerMetadata: metadata,
    scopes: makeScopes(client),
    configuration: makeConfiguration({
      redirectUris: [
        "https://client.example/callback",
        "http://localhost:3000/callback?route=complete",
        "http://127.0.0.1/callback",
        "http://[::1]:3000/callback"
      ],
      clientIdMetadataDocument: "https://client.example/client.json"
    })
  }), acceptedHttp, acceptedStore, client)
  assert.equal(accepted, acceptedHandle)
  assert.deepEqual(acceptedHttp.requests, [])
})

test("CIMD identity is portable but saved separately for each exact issuer", async () => {
  const { client, registration: { resolveAuthorizationCredential } } = await loadRegistration()
  const issuerA = "https://ISSUER.example/tenant"
  const issuerB = "https://issuer.example/tenant"
  const handleA = makeHandle(client, "cimd-a")
  const handleB = makeHandle(client, "cimd-b")
  const clientId = "https://client.example/client-metadata.json"
  const store = makeStore({ saveHandles: [handleA, handleB] })
  const http = makeHttp(() => Effect.die("unexpected HTTP request"))

  for (const [issuer, expectedHandle] of [[issuerA, handleA], [issuerB, handleB]]) {
    const handle = await runWithPorts(resolveAuthorizationCredential({
      issuer,
      authorizationServerMetadata: makeMetadata(client, issuer, {
        client_id_metadata_document_supported: true
      }),
      scopes: makeScopes(client),
      configuration: makeConfiguration({ clientIdMetadataDocument: clientId })
    }), http, store, client)
    assert.equal(handle, expectedHandle)
  }

  assert.deepEqual(store.saved, [
    { issuer: issuerA, clientId },
    { issuer: issuerB, clientId }
  ])
  assert.deepEqual(http.requests, [])
})

test("DCR sends exact redacted JSON defaults and overrides and binds response secrets to selected issuer", async () => {
  const { client, registration: { resolveAuthorizationCredential } } = await loadRegistration()
  const issuer = "https://issuer.example/tenant"
  const registrationEndpoint = "https://issuer.example/tenant/register"
  const clientName = "Café MCP ☕"
  const nativeClientId = "client-café-🚀"
  const webClientId = "client-web-café-🌐"
  const responseSecret = "secret-café-🔐"
  const responseAccessToken = "jeton-café-🎫"
  const nativeHandle = makeHandle(client, "native-dcr")
  const webHandle = makeHandle(client, "web-dcr")
  const responses = [
    jsonResponse({
      client_id: nativeClientId,
      client_secret: responseSecret,
      registration_access_token: responseAccessToken,
      issuer: "https://hostile.example"
    }),
    jsonResponse({ client_id: webClientId })
  ]
  const http = makeHttp((_request, index) => Effect.succeed(responses[index]))
  const store = makeStore({ saveHandles: [nativeHandle, webHandle] })
  const metadata = makeMetadata(client, issuer, { registration_endpoint: registrationEndpoint })

  const native = await runWithPorts(resolveAuthorizationCredential({
    issuer,
    authorizationServerMetadata: metadata,
    scopes: makeScopes(client, ["prior", "requested", "challenge"]),
    configuration: makeConfiguration({
      clientName,
      redirectUris: [
        "https://client.example/callback",
        "https://127.0.0.1:8443/callback?route=complete"
      ],
      tokenEndpointAuthMethod: "client_secret_post",
      grantTypes: ["authorization_code"],
      responseTypes: ["code"]
    })
  }), http, store, client)
  assert.equal(native, nativeHandle)

  const web = await runWithPorts(resolveAuthorizationCredential({
    issuer,
    authorizationServerMetadata: metadata,
    scopes: makeScopes(client, ["read", "write"]),
    configuration: makeConfiguration({ clientName })
  }), http, store, client)
  assert.equal(web, webHandle)

  assert.equal(http.requests.length, 2)
  for (const request of http.requests) {
    assert.equal(request.method, "POST")
    assert.equal(request.url, registrationEndpoint)
    assert.equal(request.headers.length, 1)
    assert.equal(request.headers[0][0], "content-type")
    assert.equal(Redacted.isRedacted(request.headers[0][1]), true)
    assert.equal(Redacted.value(request.headers[0][1]), "application/json")
    assert.equal(Redacted.isRedacted(request.body), true)
    assert.equal(Redacted.value(request.body) instanceof Uint8Array, true)
  }

  const nativeBytes = Redacted.value(http.requests[0].body)
  const nativeText = decoder.decode(nativeBytes)
  assert.deepEqual(encoder.encode(nativeText), nativeBytes)
  assert.deepEqual(JSON.parse(nativeText), {
    client_name: clientName,
    redirect_uris: [
      "https://client.example/callback",
      "https://127.0.0.1:8443/callback?route=complete"
    ],
    token_endpoint_auth_method: "client_secret_post",
    grant_types: ["authorization_code"],
    response_types: ["code"],
    scope: "prior requested challenge",
    application_type: "native"
  })
  const webBytes = Redacted.value(http.requests[1].body)
  const webText = decoder.decode(webBytes)
  assert.deepEqual(encoder.encode(webText), webBytes)
  assert.deepEqual(JSON.parse(webText), {
    client_name: clientName,
    redirect_uris: ["https://client.example/callback"],
    token_endpoint_auth_method: "none",
    grant_types: ["authorization_code", "refresh_token"],
    response_types: ["code"],
    scope: "read write",
    application_type: "web"
  })

  assert.equal(store.saved[0].issuer, issuer)
  assert.equal(store.saved[0].clientId, nativeClientId)
  assert.equal(Redacted.isRedacted(store.saved[0].clientSecret), true)
  assert.equal(Redacted.isRedacted(store.saved[0].registrationAccessToken), true)
  assert.equal(Redacted.value(store.saved[0].clientSecret), responseSecret)
  assert.equal(Redacted.value(store.saved[0].registrationAccessToken), responseAccessToken)
  assert.deepEqual(store.saved[1], { issuer, clientId: webClientId })
})

test("DCR fails closed on non-2xx, oversize, invalid UTF-8, invalid JSON, and malformed responses", async () => {
  const { client, registration: { resolveAuthorizationCredential } } = await loadRegistration()
  const issuer = "https://issuer.example"
  const responseSentinel = "synthetic-response-body-sentinel"
  const cases = [
    { name: "non-2xx", response: jsonResponse({ error: responseSentinel }, 500), status: 500 },
    { name: "oversize", response: byteResponse(new Uint8Array(1024 * 1024 + 1)) },
    { name: "invalid UTF-8", response: byteResponse(Uint8Array.from([0xc3, 0x28])) },
    { name: "invalid JSON", response: byteResponse(encoder.encode("{")) },
    { name: "array root", response: jsonResponse([]) },
    { name: "missing client id", response: jsonResponse({ client_secret: responseSentinel }) },
    { name: "empty client id", response: jsonResponse({ client_id: "" }) }
  ]

  for (const fixture of cases) {
    const http = makeHttp(() => Effect.succeed(fixture.response))
    const store = makeStore()
    const error = await failureWithPorts(resolveAuthorizationCredential({
      issuer,
      authorizationServerMetadata: makeMetadata(client, issuer, {
        registration_endpoint: `${issuer}/register`
      }),
      scopes: makeScopes(client),
      configuration: makeConfiguration()
    }), http, store, client)

    assert.equal(error?._tag, "AuthorizationProtocolError", fixture.name)
    assert.equal(error.reason, "RegistrationFailed", fixture.name)
    if (fixture.status !== undefined) assert.equal(error.status, fixture.status, fixture.name)
    assert.equal(http.requests.length, 1, fixture.name)
    assert.deepEqual(store.saved, [], fixture.name)
    const rendered = `${String(error)} ${JSON.stringify(error)} ${inspect(error)}`
    assert.equal(rendered.includes(responseSentinel), false, fixture.name)
  }
})
