import assert from "node:assert/strict"
import { auth, OAuthError } from "../dist/auth/auth.js"

const resourceUrl = "https://resource.example/mcp"
const issuerA = "https://issuer-a.example"
const issuerB = "https://issuer-b.example"
const localhostRedirect = "http://localhost:3000/callback"

class TestOAuthProvider {
  savedClientInformation
  savedTokens
  savedVerifier
  invalidations = []
  redirects = []

  constructor(options = {}) {
    this.redirectUrl = options.redirectUrl ?? localhostRedirect
    this.clientMetadataUrl = options.clientMetadataUrl
    this.clientMetadata = {
      client_name: options.clientName ?? "auth-hardening-test-client",
      redirect_uris: [this.redirectUrl],
      ...options.clientMetadata
    }
    this.savedClientInformation = options.clientInformation
  }

  clientInformation() {
    return this.savedClientInformation
  }

  saveClientInformation(clientInformation) {
    this.savedClientInformation = clientInformation
  }

  tokens() {
    return this.savedTokens
  }

  saveTokens(tokens) {
    this.savedTokens = tokens
  }

  redirectToAuthorization(authorizationUrl) {
    this.redirects.push(authorizationUrl)
  }

  saveCodeVerifier(codeVerifier) {
    this.savedVerifier = codeVerifier
  }

  codeVerifier() {
    assert.ok(this.savedVerifier, "code verifier saved before token request")
    return this.savedVerifier
  }

  invalidateCredentials(scope) {
    this.invalidations.push(scope)
    if (scope === "all" || scope === "client") {
      this.savedClientInformation = undefined
    }
    if (scope === "all" || scope === "tokens") {
      this.savedTokens = undefined
    }
  }
}

const tests = []

const test = (name, fn) => {
  tests.push({ name, fn })
}

test("DCR marks localhost redirect clients as native applications", async () => {
  const provider = new TestOAuthProvider()
  const recorder = makeOAuthFetchRecorder({ issuer: issuerA })

  await auth(provider, { serverUrl: resourceUrl, fetchFn: recorder.fetch })

  assert.equal(recorder.registrations.length, 1)
  assert.equal(recorder.registrations[0].application_type, "native")
  assert.equal(provider.savedClientInformation.issuer, issuerA)
})

test("DCR preserves web posture for non-local HTTPS redirects", async () => {
  const provider = new TestOAuthProvider({
    redirectUrl: "https://client.example/callback"
  })
  const recorder = makeOAuthFetchRecorder({ issuer: issuerA })

  await auth(provider, { serverUrl: resourceUrl, fetchFn: recorder.fetch })

  assert.equal(recorder.registrations.length, 1)
  assert.equal(recorder.registrations[0].application_type, "web")
})

test("persisted dynamic client credentials are re-registered when issuer changes", async () => {
  const provider = new TestOAuthProvider()
  const issuerARecorder = makeOAuthFetchRecorder({ issuer: issuerA })
  await auth(provider, { serverUrl: resourceUrl, fetchFn: issuerARecorder.fetch })

  const issuerBRecorder = makeOAuthFetchRecorder({ issuer: issuerB })
  await auth(provider, { serverUrl: resourceUrl, fetchFn: issuerBRecorder.fetch })

  assert.equal(issuerARecorder.registrations.length, 1)
  assert.equal(issuerBRecorder.registrations.length, 1)
  assert.deepEqual(provider.invalidations, ["client"])
  assert.equal(provider.savedClientInformation.issuer, issuerB)
})

test("Client ID Metadata Documents are preferred when the issuer supports them", async () => {
  const provider = new TestOAuthProvider({
    clientMetadataUrl: "https://client.example/.well-known/oauth-client"
  })
  const recorder = makeOAuthFetchRecorder({
    issuer: issuerA,
    clientIdMetadataDocumentSupported: true
  })

  await auth(provider, { serverUrl: resourceUrl, fetchFn: recorder.fetch })

  assert.equal(recorder.registrations.length, 0)
  assert.deepEqual(provider.savedClientInformation, {
    client_id: "https://client.example/.well-known/oauth-client",
    issuer: issuerA
  })
})

test("authorization response issuer mismatch is rejected", async () => {
  const provider = new TestOAuthProvider()
  const recorder = makeOAuthFetchRecorder({ issuer: issuerA })

  await assert.rejects(
    () =>
      auth(provider, {
        serverUrl: resourceUrl,
        authorizationCode: "test-code",
        authorizationIssuer: issuerB,
        fetchFn: recorder.fetch
      }),
    (error) =>
      error instanceof OAuthError &&
      error.code === "invalid_issuer" &&
      error.message.includes(issuerB)
  )
})

test("authorization response issuer match is accepted", async () => {
  const provider = new TestOAuthProvider()
  provider.saveCodeVerifier("saved-code-verifier")
  const recorder = makeOAuthFetchRecorder({ issuer: issuerA })

  const result = await auth(provider, {
    serverUrl: resourceUrl,
    authorizationCode: "test-code",
    authorizationIssuer: issuerA,
    fetchFn: recorder.fetch
  })

  assert.equal(result, "AUTHORIZED")
  assert.equal(provider.savedTokens.access_token, "access-token-for-issuer-a.example")
})

test("re-authorization requests union existing and challenged scopes", async () => {
  const provider = new TestOAuthProvider({
    clientInformation: { client_id: "issuer-a-client", issuer: issuerA }
  })
  provider.saveTokens({
    access_token: "existing-token",
    token_type: "Bearer",
    scope: "mcp:basic"
  })
  const recorder = makeOAuthFetchRecorder({ issuer: issuerA })

  await auth(provider, {
    serverUrl: resourceUrl,
    scope: "mcp:profile",
    fetchFn: recorder.fetch
  })

  assert.equal(provider.redirects.length, 1)
  assert.equal(provider.redirects[0].searchParams.get("scope"), "mcp:basic mcp:profile")
})

for (const { name, fn } of tests) {
  try {
    await fn()
  } catch (error) {
    console.error(`Auth hardening check failed: ${name}`)
    throw error
  }
}

console.log("Auth hardening check passed.")

function makeOAuthFetchRecorder(options) {
  const registrations = []
  const issuer = new URL(options.issuer)
  const metadata = {
    issuer: options.issuer,
    authorization_endpoint: new URL("/authorize", issuer).href,
    token_endpoint: new URL("/token", issuer).href,
    registration_endpoint: new URL("/register", issuer).href,
    response_types_supported: ["code"],
    grant_types_supported: ["authorization_code", "client_credentials"],
    authorization_response_iss_parameter_supported: true,
    token_endpoint_auth_methods_supported: ["none"],
    client_id_metadata_document_supported: options.clientIdMetadataDocumentSupported
  }

  return {
    registrations,
    fetch: async (input, init) => {
      const url = new URL(String(input))
      if (url.hostname === "resource.example") {
        return jsonResponse({
          resource: resourceUrl,
          authorization_servers: [issuer.href]
        })
      }
      if (url.pathname.includes("oauth-authorization-server")) {
        return jsonResponse(metadata)
      }
      if (url.pathname === "/register") {
        const body = JSON.parse(String(init?.body ?? "{}"))
        registrations.push(body)
        return jsonResponse({
          client_id: `client-for-${issuer.hostname}`,
          client_secret: `secret-for-${issuer.hostname}`,
          ...body
        })
      }
      if (url.pathname === "/token") {
        return jsonResponse({
          access_token: `access-token-for-${issuer.hostname}`,
          token_type: "Bearer"
        })
      }
      return new Response("not found", { status: 404 })
    }
  }
}

function jsonResponse(body) {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" }
  })
}
