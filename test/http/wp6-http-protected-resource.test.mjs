import assert from "node:assert/strict"
import { inspect } from "node:util"
import { test } from "node:test"
import * as Cause from "effect/Cause"
import * as Context from "effect/Context"
import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"
import * as Redacted from "effect/Redacted"
import * as McpDispatcher from "../../dist/McpDispatcher.js"
import * as McpModern from "../../dist/McpModern.js"
import * as McpSchema from "../../dist/McpSchema.js"
import * as McpServer from "../../dist/McpServer.js"
import * as Protected from "../../dist/auth/protected-resource.js"
import * as HttpServer from "../../dist/transport/StreamableHttpServerTransport.js"

const protocolVersion = McpModern.MODERN_PROTOCOL_VERSION
const protectedResource = "https://mcp.example.test/endpoint"
const resourceMetadata = "https://mcp.example.test/.well-known/oauth-protected-resource"
const tokenSentinel = "WP6E_SERVER_BEARER_SENTINEL"

const principal = (overrides = {}) => new Protected.AuthorizationPrincipal({
  subject: "subject-one",
  clientId: "client-one",
  issuer: "https://issuer.example.test",
  audiences: [protectedResource],
  scopes: ["tools.read"],
  claims: { tenant: "tenant-one" },
  ...overrides
})

const request = (id, authorization) => new Request("http://localhost/mcp", {
  method: "POST",
  headers: {
    "content-type": "application/json",
    accept: "application/json, text/event-stream",
    [McpModern.MCP_PROTOCOL_VERSION_HEADER]: protocolVersion,
    [McpModern.MCP_METHOD_HEADER]: "tools/call",
    [McpModern.MCP_NAME_HEADER]: "principal-probe",
    ...(authorization === undefined ? {} : { authorization })
  },
  body: JSON.stringify({
    jsonrpc: "2.0",
    id,
    method: "tools/call",
    params: {
      name: "principal-probe",
      arguments: {},
      _meta: {
        "io.modelcontextprotocol/protocolVersion": protocolVersion,
        "io.modelcontextprotocol/clientCapabilities": {}
      }
    }
  })
})

const makeWeb = async (transportOptions) => {
  const server = Effect.runSync(McpServer.make({
    serverInfo: { name: "wp6e-protected-resource", version: "1.0.0" },
    handlers: Effect.void,
    supportedProtocolVersions: [protocolVersion]
  }))
  Effect.runSync(server.addTool({
    tool: new McpSchema.Tool({
      name: "principal-probe",
      inputSchema: { type: "object", properties: {} }
    }),
    annotations: Context.empty(),
    handler: () => McpDispatcher.McpRequestContext.pipe(Effect.map((context) =>
      new McpSchema.CallToolResult({
        resultType: "complete",
        content: [],
        structuredContent: { authorizationPrincipal: context.authorizationPrincipal }
      })))
  }))
  const web = HttpServer.toWebHandler(server, {
    path: "/mcp",
    enableJsonResponse: true,
    ...transportOptions
  })
  return web
}

const authorization = (verifier, requiredScopes = ["tools.read"]) => ({
  verifier,
  protectedResource,
  resourceMetadata,
  requiredScopes
})

test("missing and malformed bearer credentials return exact 401 challenges before verification", async () => {
  let verifierCalls = 0
  const verifier = { verify: () => Effect.sync(() => {
    verifierCalls += 1
    return principal()
  }) }
  const web = await makeWeb({ authorization: authorization(verifier) })
  try {
    const cases = [
      ["missing", undefined],
      ["basic", "Basic abc"],
      ["empty", "Bearer "],
      ["multiple", "Bearer abc, Bearer def"]
    ]
    for (const [id, header] of cases) {
      const response = await web.handler(request(id, header))
      assert.equal(response.status, 401, id)
      assert.equal(
        response.headers.get("www-authenticate"),
        `Bearer resource_metadata="${resourceMetadata}", scope="tools.read"`,
        id
      )
      assert.equal(await response.text(), "", id)
    }
    assert.equal(verifierCalls, 0)
  } finally {
    await web.dispose()
  }
})

test("invalid and expired tokens map to exact invalid_token 401 without exposing the bearer", async () => {
  for (const reason of ["Invalid", "Expired", "AudienceMismatch"]) {
    let observed
    const verifier = {
      verify: (input) => Effect.sync(() => {
        observed = input
        return input
      }).pipe(Effect.zipRight(Effect.fail(new Protected.TokenVerificationError({ reason }))))
    }
    const web = await makeWeb({ authorization: authorization(verifier) })
    try {
      const response = await web.handler(request(reason, `Bearer ${tokenSentinel}`))
      assert.equal(response.status, 401, reason)
      assert.equal(
        response.headers.get("www-authenticate"),
        `Bearer error="invalid_token", scope="tools.read", resource_metadata="${resourceMetadata}"`,
        reason
      )
      assert.equal(Redacted.isRedacted(observed.bearerToken), true)
      assert.equal(Redacted.value(observed.bearerToken), tokenSentinel)
      assert.equal(observed.protectedResource, protectedResource)
      assert.equal(inspect(response, { depth: 8 }).includes(tokenSentinel), false)
    } finally {
      await web.dispose()
    }
  }
})

test("only a token-free verified principal reaches the MCP request context", async () => {
  const verified = principal()
  let observed
  const web = await makeWeb({
    authorization: authorization({
      verify: (input) => Effect.sync(() => {
        observed = input
        return verified
      })
    })
  })
  try {
    const response = await web.handler(request("verified", `Bearer ${tokenSentinel}`))
    const body = await response.json()
    assert.equal(response.status, 200)
    assert.equal(Redacted.value(observed.bearerToken), tokenSentinel)
    assert.deepEqual(body.result.structuredContent.authorizationPrincipal, {
      subject: "subject-one",
      clientId: "client-one",
      issuer: "https://issuer.example.test",
      audiences: [protectedResource],
      scopes: ["tools.read"],
      claims: { tenant: "tenant-one" }
    })
    assert.equal(JSON.stringify(body).includes(tokenSentinel), false)
    assert.equal(Object.hasOwn(body.result.structuredContent.authorizationPrincipal, "token"), false)
  } finally {
    await web.dispose()
  }
})

test("authenticated insufficient scope returns exact 403 and never dispatches", async () => {
  let handlerCalls = 0
  const verified = principal({ scopes: ["tools.read"] })
  const server = Effect.runSync(McpServer.make({
    serverInfo: { name: "wp6e-scope", version: "1.0.0" },
    handlers: Effect.void,
    supportedProtocolVersions: [protocolVersion]
  }))
  Effect.runSync(server.addTool({
    tool: new McpSchema.Tool({ name: "principal-probe", inputSchema: { type: "object", properties: {} } }),
    annotations: Context.empty(),
    handler: () => Effect.sync(() => {
      handlerCalls += 1
      return new McpSchema.CallToolResult({ resultType: "complete", content: [] })
    })
  }))
  const web = HttpServer.toWebHandler(server, {
    path: "/mcp",
    enableJsonResponse: true,
    authorization: authorization({ verify: () => Effect.succeed(verified) }, ["tools.write", "admin"])
  })
  try {
    const response = await web.handler(request("insufficient", `Bearer ${tokenSentinel}`))
    assert.equal(response.status, 403)
    assert.equal(
      response.headers.get("www-authenticate"),
      `Bearer error="insufficient_scope", scope="tools.write admin", resource_metadata="${resourceMetadata}"`
    )
    assert.equal(handlerCalls, 0)
  } finally {
    await web.dispose()
  }
})

test("verifier defects and unavailable failures are not mislabeled as token facts", async () => {
  for (const [label, verify] of [
    ["unavailable", () => Effect.fail(new Protected.TokenVerificationError({ reason: "VerifierUnavailable" }))],
    ["defect", () => Effect.die(new Error("verifier defect"))]
  ]) {
    const web = await makeWeb({ authorization: authorization({ verify }) })
    try {
      const response = await web.handler(request(label, `Bearer ${tokenSentinel}`))
      assert.equal(response.status, 500, label)
      assert.equal(response.headers.has("www-authenticate"), false, label)
      assert.equal(await response.text(), "", label)
    } finally {
      await web.dispose()
    }
  }

  const interrupted = await makeWeb({
    authorization: authorization({ verify: () => Effect.interrupt })
  })
  try {
    await assert.rejects(
      interrupted.handler(request("interrupted", `Bearer ${tokenSentinel}`)),
      (error) => Cause.isInterruptedOnly(error?.[Symbol.for("effect/Runtime/FiberFailure/Cause")]) ||
        /interrupted/i.test(String(error))
    )
  } finally {
    await interrupted.dispose()
  }
})

test("the already-verified hook is token-free and cannot bypass a configured verifier", async () => {
  const verified = principal({ subject: "embedded-subject" })
  const unprotected = await makeWeb({})
  try {
    const response = await unprotected.handler(request("embedded"), {
      verifiedAuthorizationPrincipal: verified
    })
    const body = await response.json()
    assert.equal(response.status, 200)
    assert.equal(body.result.structuredContent.authorizationPrincipal.subject, "embedded-subject")

    const tokenBearing = await unprotected.handler(request("token-bearing"), {
      verifiedAuthorizationPrincipal: {
        subject: "unsafe",
        audiences: [protectedResource],
        scopes: [],
        token: tokenSentinel
      }
    })
    assert.equal(tokenBearing.status, 400)
  } finally {
    await unprotected.dispose()
  }

  let verifierCalls = 0
  const protectedWeb = await makeWeb({
    authorization: authorization({ verify: () => Effect.sync(() => {
      verifierCalls += 1
      return principal()
    }) })
  })
  try {
    const response = await protectedWeb.handler(request("no-bypass", `Bearer ${tokenSentinel}`), {
      verifiedAuthorizationPrincipal: verified
    })
    assert.equal(response.status, 400)
    assert.equal(verifierCalls, 0)
  } finally {
    await protectedWeb.dispose()
  }
})
