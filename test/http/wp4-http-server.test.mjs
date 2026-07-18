import assert from "node:assert/strict"
import { test } from "node:test"
import * as Layer from "effect/Layer"
import * as McpModern from "../../dist/McpModern.js"
import * as StreamableHttpServerTransport from "../../dist/transport/StreamableHttpServerTransport.js"

const protocolVersion = McpModern.MODERN_PROTOCOL_VERSION

const options = (overrides = {}) => ({
  name: "wp4-http-server",
  version: "1.0.0",
  path: "/mcp",
  enableJsonResponse: true,
  supportedProtocolVersions: [protocolVersion],
  ...overrides
})

const requestParams = (overrides = {}) => ({
  _meta: {
    "io.modelcontextprotocol/clientCapabilities": {},
    "io.modelcontextprotocol/protocolVersion": protocolVersion
  },
  ...overrides
})

const requestBody = (overrides = {}) => ({
  jsonrpc: "2.0",
  id: "server-boundary",
  method: "server/discover",
  params: requestParams(),
  ...overrides
})

const post = ({
  body = requestBody(),
  contentType = "application/json",
  accept = "application/json, text/event-stream",
  headers = {},
  origin
} = {}) => new Request("http://localhost/mcp", {
  method: "POST",
  headers: {
    "content-type": contentType,
    accept,
    [McpModern.MCP_PROTOCOL_VERSION_HEADER]: protocolVersion,
    [McpModern.MCP_METHOD_HEADER]: body?.method ?? "server/discover",
    ...(origin === undefined ? {} : { origin }),
    ...headers
  },
  body: typeof body === "string" ? body : JSON.stringify(body)
})

const withServer = async (serverOptions, run) => {
  const web = StreamableHttpServerTransport.toWebHandler(Layer.empty, serverOptions)
  try {
    await run(web.handler)
  } finally {
    await web.dispose()
  }
}

const assertSelectedProtocol = (response) => {
  assert.equal(
    response.headers.get(McpModern.MCP_PROTOCOL_VERSION_HEADER),
    protocolVersion
  )
}

test("modern-only handler accepts a valid request without the removed modern flag", async () => {
  await withServer(options(), async (handler) => {
    const response = await handler(post())
    assert.equal(response.status, 200)
    assertSelectedProtocol(response)
    assert.equal(response.headers.has("mcp-session-id"), false)
    assert.equal(response.headers.has("last-event-id"), false)
    assert.equal(response.headers.has("connection"), false)
  })
})

test("present Origin requires an explicit exact allowlist match before method handling", async () => {
  const attackerOrigin = "https://attacker.invalid"
  await withServer(options(), async (handler) => {
    const response = await handler(new Request("http://localhost/mcp", {
      method: "GET",
      headers: {
        origin: attackerOrigin,
        [McpModern.MCP_PROTOCOL_VERSION_HEADER]: "attacker-version"
      }
    }))
    assert.equal(response.status, 403)
    assert.equal(await response.text(), "")
    assertSelectedProtocol(response)
  })
})

test("an exactly allowed Origin proceeds to POST-only rejection", async () => {
  const allowedOrigin = "https://allowed.example"
  await withServer(options({ allowedOrigins: [allowedOrigin] }), async (handler) => {
    const response = await handler(new Request("http://localhost/mcp", {
      method: "DELETE",
      headers: {
        origin: allowedOrigin,
        [McpModern.MCP_PROTOCOL_VERSION_HEADER]: protocolVersion,
        "mcp-session-id": "ignored-session",
        "last-event-id": "ignored-resume"
      }
    }))
    assert.equal(response.status, 405)
    assert.equal(response.headers.get("allow"), "POST")
    assert.equal(await response.text(), "")
    assertSelectedProtocol(response)
    assert.equal(response.headers.has("mcp-session-id"), false)
    assert.equal(response.headers.has("last-event-id"), false)
    assert.equal(response.headers.has("connection"), false)
  })
})

test("optional Host protection follows Origin validation and emits safe bodyless 403", async () => {
  const attackerHost = "attacker.invalid"
  await withServer(options({
    enableDnsRebindingProtection: true,
    allowedHosts: ["localhost"]
  }), async (handler) => {
    const response = await handler(post({
      headers: { host: attackerHost }
    }))
    assert.equal(response.status, 403)
    assert.equal(await response.text(), "")
    assertSelectedProtocol(response)
  })
})

test("POST rejects a non-JSON request media type before decoding", async () => {
  await withServer(options(), async (handler) => {
    const response = await handler(post({
      contentType: "text/plain",
      headers: {
        [McpModern.MCP_PROTOCOL_VERSION_HEADER]: "attacker-version"
      }
    }))
    assert.equal(response.status, 415)
    assert.equal(await response.text(), "")
    assertSelectedProtocol(response)
  })
})

test("POST requires Accept to contain JSON and SSE", async () => {
  await withServer(options(), async (handler) => {
    const response = await handler(post({ accept: "application/json" }))
    assert.equal(response.status, 406)
    assert.equal(await response.text(), "")
    assertSelectedProtocol(response)
  })
})

test("maxBodyBytes accepts the exact boundary and rejects one byte over before dispatch", async () => {
  const body = JSON.stringify(requestBody())
  const bodyBytes = new TextEncoder().encode(body).byteLength

  await withServer(options({ maxBodyBytes: bodyBytes }), async (handler) => {
    const exact = await handler(post({ body }))
    assert.equal(exact.status, 200)

    const oversized = await handler(post({
      body: `${body} `
    }))
    assert.equal(oversized.status, 413)
    assert.equal(await oversized.text(), "")
    assertSelectedProtocol(oversized)
  })
})

test("invalid maxBodyBytes values are rejected before any request body can be accessed", async () => {
  const incorrectlyAccepted = []
  for (const maxBodyBytes of [0, -1, 1.5, Number.MAX_SAFE_INTEGER + 1, Infinity, Number.NaN]) {
    let web
    try {
      web = StreamableHttpServerTransport.toWebHandler(
        Layer.empty,
        options({ maxBodyBytes })
      )
      incorrectlyAccepted.push(maxBodyBytes)
    } catch {
      // Expected: option validation is synchronous and no handler was invoked.
    } finally {
      await web?.dispose()
    }
  }
  assert.deepEqual(incorrectlyAccepted, [])
})

test("malformed JSON without an exact request id returns bodyless 400", async () => {
  await withServer(options(), async (handler) => {
    const response = await handler(post({ body: "{not-json" }))
    assert.equal(response.status, 400)
    assert.equal(await response.text(), "")
    assertSelectedProtocol(response)
  })
})

test("JSON-RPC batches return bodyless 400 without inventing id null", async () => {
  await withServer(options(), async (handler) => {
    const response = await handler(post({
      body: [requestBody({ id: 1 }), requestBody({ id: 2 })]
    }))
    assert.equal(response.status, 400)
    assert.equal(await response.text(), "")
    assertSelectedProtocol(response)
  })
})

test("an inbound response fails closed with its exact recoverable id", async () => {
  await withServer(options(), async (handler) => {
    const response = await handler(post({
      body: {
        jsonrpc: "2.0",
        id: "inbound-response",
        result: { resultType: "complete" }
      }
    }))
    assert.equal(response.status, 400)
    assertSelectedProtocol(response)
    assert.deepEqual(await response.json(), {
      jsonrpc: "2.0",
      id: "inbound-response",
      error: {
        code: -32600,
        message: "Invalid JSON-RPC request"
      }
    })
  })
})

test("legacy session and resume request headers are ignored and never echoed", async () => {
  await withServer(options(), async (handler) => {
    const response = await handler(post({
      headers: {
        "mcp-session-id": "legacy-session",
        "last-event-id": "legacy-resume"
      }
    }))
    assert.equal(response.status, 200)
    assertSelectedProtocol(response)
    assert.equal(response.headers.has("mcp-session-id"), false)
    assert.equal(response.headers.has("last-event-id"), false)
    assert.equal(response.headers.has("connection"), false)
  })
})
