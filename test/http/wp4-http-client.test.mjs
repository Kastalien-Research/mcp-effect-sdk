import assert from "node:assert/strict"
import { once } from "node:events"
import { createServer } from "node:http"
import { test } from "node:test"
import * as Chunk from "effect/Chunk"
import * as Effect from "effect/Effect"
import * as Either from "effect/Either"
import * as Fiber from "effect/Fiber"
import * as Logger from "effect/Logger"
import * as Stream from "effect/Stream"
import * as StreamableHttpClientTransport from "../../dist/transport/StreamableHttpClientTransport.js"

const protocolMeta = {
  "io.modelcontextprotocol/protocolVersion": "2026-07-28",
  "io.modelcontextprotocol/clientCapabilities": {}
}

const request = (id, method = "tools/list", params = {}) => ({
  _tag: "Request",
  jsonrpc: "2.0",
  id,
  method,
  params: { ...params, _meta: { ...protocolMeta } }
})

const jsonResponse = (body, init = {}) => new Response(JSON.stringify(body), {
  status: init.status ?? 200,
  headers: { "Content-Type": "application/json", ...init.headers }
})

const success = (id, result = {
  resultType: "complete",
  cacheScope: "private",
  ttlMs: 0,
  tools: []
}) => ({
  jsonrpc: "2.0",
  id,
  result: Array.isArray(result.tools)
    ? { cacheScope: "private", ttlMs: 0, ...result }
    : result
})

const encoder = new TextEncoder()

const sseResponse = (chunks, init = {}) => new Response(new ReadableStream({
  start(controller) {
    for (const chunk of chunks) {
      controller.enqueue(typeof chunk === "string" ? encoder.encode(chunk) : chunk)
    }
    controller.close()
  }
}), {
  status: init.status ?? 200,
  headers: { "Content-Type": "text/event-stream; charset=utf-8", ...init.headers }
})

const sse = (...events) => events.map((event) => `data: ${JSON.stringify(event)}\n\n`)

const runRequest = (options, message) => Effect.runPromise(Effect.scoped(
  Effect.gen(function*() {
    const transport = yield* StreamableHttpClientTransport.make(options)
    return yield* transport.request(message).pipe(Stream.runCollect)
  })
))

const makeOAuthProvider = () => {
  let tokens = { access_token: "old-token", token_type: "Bearer" }
  return {
    redirectUrl: undefined,
    clientMetadata: {
      client_name: "test-client",
      redirect_uris: [],
      token_endpoint_auth_method: "none"
    },
    clientInformation: () => ({ client_id: "test-client", token_endpoint_auth_method: "none" }),
    tokens: () => tokens,
    saveTokens: (next) => {
      tokens = next
    },
    redirectToAuthorization: () => {},
    saveCodeVerifier: () => {},
    codeVerifier: () => "verifier"
  }
}

test("modern HTTP client maps one strict request to one exact JSON terminal", async () => {
  const calls = []
  const message = request("exact-string")
  const frames = await runRequest({
    url: "https://mcp.example.test/endpoint",
    headers: {
      "x-caller": "present",
      "content-type": "text/plain",
      Accept: "text/plain",
      "mcp-protocol-version": "wrong",
      "MCP-METHOD": "wrong",
      "Mcp-Session-Id": "must-not-leak",
      "Last-Event-ID": "must-not-leak"
    },
    fetch: async (input, init) => {
      calls.push({ input, init })
      return jsonResponse(success("exact-string", { resultType: "complete", tools: [] }))
    }
  }, message)

  assert.equal(calls.length, 1)
  assert.equal(String(calls[0].input), "https://mcp.example.test/endpoint")
  assert.equal(calls[0].init.method, "POST")
  assert.deepEqual(JSON.parse(calls[0].init.body), {
    jsonrpc: "2.0",
    id: "exact-string",
    method: "tools/list",
    params: message.params
  })
  const headers = new Headers(calls[0].init.headers)
  assert.equal(headers.get("content-type"), "application/json")
  assert.equal(headers.get("accept"), "application/json, text/event-stream")
  assert.equal(headers.get("mcp-protocol-version"), "2026-07-28")
  assert.equal(headers.get("mcp-method"), "tools/list")
  assert.equal(headers.get("x-caller"), "present")
  assert.equal(headers.has("mcp-session-id"), false)
  assert.equal(headers.has("last-event-id"), false)
  assert.deepEqual(Chunk.toReadonlyArray(frames), [{
    _tag: "Success",
    response: {
      _tag: "SuccessResponse",
      jsonrpc: "2.0",
      id: "exact-string",
      result: {
        cacheScope: "private",
        ttlMs: 0,
        resultType: "complete",
        tools: []
      }
    }
  }])
})

test("modern HTTP client preserves concurrent numeric and string IDs without correlation state", async () => {
  const seen = []
  const options = {
    url: new URL("https://mcp.example.test/endpoint"),
    fetch: async (_input, init) => {
      const body = JSON.parse(init.body)
      seen.push(body.id)
      await Promise.resolve()
      return jsonResponse(success(body.id))
    }
  }

  const [numeric, textual] = await Effect.runPromise(Effect.scoped(
    Effect.gen(function*() {
      const transport = yield* StreamableHttpClientTransport.make(options)
      return yield* Effect.all([
        transport.request(request(7)).pipe(Stream.runCollect),
        transport.request(request("7")).pipe(Stream.runCollect)
      ], { concurrency: "unbounded" })
    })
  ))

  assert.deepEqual(new Set(seen), new Set([7, "7"]))
  assert.equal(Chunk.toReadonlyArray(numeric)[0].response.id, 7)
  assert.equal(Chunk.toReadonlyArray(textual)[0].response.id, "7")
})

test("modern HTTP client exposes exact-ID JSON-RPC errors from non-auth HTTP failures", async () => {
  const frames = await runRequest({
    url: "https://mcp.example.test/endpoint",
    fetch: async () => jsonResponse({
      jsonrpc: "2.0",
      id: "mismatch",
      error: { code: -32020, message: "Header mismatch" }
    }, { status: 400 })
  }, request("mismatch", "tools/call", { name: "echo", arguments: {} }))

  assert.deepEqual(Chunk.toReadonlyArray(frames), [{
    _tag: "Error",
    response: {
      _tag: "ErrorResponse",
      jsonrpc: "2.0",
      id: "mismatch",
      error: { code: -32020, message: "Header mismatch" }
    }
  }])
})

test("modern HTTP client rejects invalid JSON response envelopes and content negotiation", async () => {
  const cases = [
    ["missing content type", () => new Response(JSON.stringify(success(1)))],
    ["wrong content type", () => new Response(JSON.stringify(success(1)), {
      headers: { "Content-Type": "text/plain" }
    })],
    ["malformed JSON", () => new Response("{", {
      headers: { "Content-Type": "application/json" }
    })],
    ["batch", () => jsonResponse([success(1)])],
    ["standalone request", () => jsonResponse({ jsonrpc: "2.0", id: 1, method: "tools/list", params: {} })],
    ["notification", () => jsonResponse({ jsonrpc: "2.0", method: "notifications/progress", params: {} })],
    ["wrong numeric/string ID", () => jsonResponse(success("1"))],
    ["success terminal on non-2xx", () => jsonResponse(success(1), { status: 400 })],
    ["error without exact ID on non-2xx", () => jsonResponse({
      jsonrpc: "2.0",
      id: "1",
      error: { code: -32601, message: "not found" }
    }, { status: 404 })]
  ]

  for (const [label, response] of cases) {
    const result = await Effect.runPromise(Effect.scoped(
      Effect.gen(function*() {
        const transport = yield* StreamableHttpClientTransport.make({
          url: "https://mcp.example.test/endpoint",
          fetch: async () => response()
        })
        return yield* transport.request(request(1)).pipe(
          Stream.runCollect,
          Effect.either
        )
      })
    ))
    assert.equal(Either.isLeft(result), true, label)
    assert.ok(
      result.left._tag === "TransportError" ||
      result.left._tag === "InvalidRequest" ||
      result.left._tag === "ParseError",
      `${label}: ${result.left._tag}`
    )
  }
})

test("modern HTTP client bounds JSON before decoding and accepts media type parameters", async () => {
  const accepted = await runRequest({
    url: "https://mcp.example.test/endpoint",
    maxJsonBytes: 256,
    fetch: async () => jsonResponse(success("parameters"), {
      headers: { "Content-Type": "application/json; charset=utf-8" }
    })
  }, request("parameters"))
  assert.equal(Chunk.toReadonlyArray(accepted)[0].response.id, "parameters")

  const oversized = await Effect.runPromise(Effect.scoped(
    Effect.gen(function*() {
      const transport = yield* StreamableHttpClientTransport.make({
        url: "https://mcp.example.test/endpoint",
        maxJsonBytes: 32,
        fetch: async () => jsonResponse(success("large", { resultType: "complete", value: "x".repeat(64) }))
      })
      return yield* transport.request(request("large")).pipe(Stream.runCollect, Effect.either)
    })
  ))
  assert.equal(Either.isLeft(oversized), true)
  assert.equal(oversized.left._tag, "TransportError")
})

test("modern HTTP client validates bounds and caller headers without invoking accessors", async () => {
  for (const key of ["maxLineBytes", "maxEventBytes", "maxJsonBytes"]) {
    for (const value of [0, -1, 1.5, Number.MAX_SAFE_INTEGER + 1]) {
      const result = await Effect.runPromise(Effect.scoped(
        StreamableHttpClientTransport.make({
          url: "https://mcp.example.test/endpoint",
          [key]: value
        }).pipe(Effect.either)
      ))
      assert.equal(Either.isLeft(result), true, `${key}=${value}`)
      assert.equal(result.left._tag, "TransportError", `${key}=${value}`)
    }
  }

  let invoked = false
  const headers = {}
  Object.defineProperty(headers, "unsafe", {
    enumerable: true,
    get() {
      invoked = true
      return "value"
    }
  })
  const result = await Effect.runPromise(Effect.scoped(
    StreamableHttpClientTransport.make({
      url: "https://mcp.example.test/endpoint",
      headers
    }).pipe(Effect.either)
  ))
  assert.equal(Either.isLeft(result), true)
  assert.equal(result.left._tag, "TransportError")
  assert.equal(invoked, false)
})

test("modern HTTP client requires an absolute HTTP endpoint and snapshots URL inputs", async () => {
  for (const url of ["not a URL", "/relative", "ftp://mcp.example.test/endpoint"]) {
    const result = await Effect.runPromise(Effect.scoped(
      StreamableHttpClientTransport.make({ url }).pipe(Effect.either)
    ))
    assert.equal(Either.isLeft(result), true, url)
    assert.equal(result.left._tag, "TransportError", url)
  }

  const endpoint = new URL("https://mcp.example.test/original")
  let fetched
  const frames = await Effect.runPromise(Effect.scoped(
    Effect.gen(function*() {
      const transport = yield* StreamableHttpClientTransport.make({
        url: endpoint,
        fetch: async (input) => {
          fetched = String(input)
          return jsonResponse(success("snapshot"))
        }
      })
      endpoint.href = "https://attacker.example.test/redirected"
      return yield* transport.request(request("snapshot")).pipe(Stream.runCollect)
    })
  ))
  assert.equal(fetched, "https://mcp.example.test/original")
  assert.equal(Chunk.toReadonlyArray(frames)[0].response.id, "snapshot")
})

test("incremental SSE joins data lines and preserves split UTF-8 notifications before the terminal", async () => {
  const notification = {
    jsonrpc: "2.0",
    method: "notifications/progress",
    params: { progressToken: "work", progress: 1, message: "Hello, 世界" }
  }
  const terminal = success("sse-order", { resultType: "complete", value: "done", tools: [] })
  const terminalText = JSON.stringify(terminal)
  const body = [
    ": keepalive\r\n\r\n",
    "event: message\r\n",
    "id: ignored\r\n",
    "retry: 10\r\n",
    "unknown: ignored\r\n",
    `data: ${JSON.stringify(notification)}\r\n\r\n`,
    "event:\n",
    `data: ${terminalText.slice(0, terminalText.indexOf(",") + 1)}\n`,
    `data: ${terminalText.slice(terminalText.indexOf(",") + 1)}\n\n`
  ]
  const bytes = encoder.encode(body.join(""))
  const world = encoder.encode("世界")
  let split = -1
  for (let index = 0; index <= bytes.length - world.length; index++) {
    if (world.every((byte, offset) => bytes[index + offset] === byte)) {
      split = index + 1
      break
    }
  }
  assert.notEqual(split, -1)

  const frames = await runRequest({
    url: "https://mcp.example.test/endpoint",
    fetch: async () => sseResponse([
      bytes.slice(0, 1),
      bytes.slice(1, split),
      bytes.slice(split, split + 2),
      bytes.slice(split + 2)
    ])
  }, request("sse-order"))

  assert.deepEqual(Chunk.toReadonlyArray(frames), [
    {
      _tag: "Notification",
      notification: { _tag: "Notification", ...notification }
    },
    {
      _tag: "Success",
      response: { _tag: "SuccessResponse", ...terminal }
    }
  ])
})

test("incremental SSE accepts an acknowledged selected subscription and exact graceful terminal", async () => {
  const id = "subscription"
  const subscriptionMeta = { "io.modelcontextprotocol/subscriptionId": id }
  const acknowledged = {
    jsonrpc: "2.0",
    method: "notifications/subscriptions/acknowledged",
    params: {
      _meta: subscriptionMeta,
      notifications: { toolsListChanged: true }
    }
  }
  const changed = {
    jsonrpc: "2.0",
    method: "notifications/tools/list_changed",
    params: { _meta: subscriptionMeta }
  }
  const terminal = success(id, {
    resultType: "complete",
    _meta: subscriptionMeta
  })
  const frames = await runRequest({
    url: "https://mcp.example.test/endpoint",
    fetch: async () => sseResponse(sse(acknowledged, changed, terminal))
  }, request(id, "subscriptions/listen", {
    notifications: { toolsListChanged: true, promptsListChanged: true }
  }))

  assert.deepEqual(Chunk.toReadonlyArray(frames).map((frame) => frame._tag), [
    "Notification",
    "Notification",
    "Success"
  ])
})

test("incremental SSE rejects invalid event framing, UTF-8, JSON, and envelope types", async () => {
  const invalid = [
    ["non-message event", ["event: endpoint\ndata: {}\n\n"]],
    ["bare CR", ["data: {}\r\r"]],
    ["invalid UTF-8", [new Uint8Array([0x64, 0x61, 0x74, 0x61, 0x3a, 0x20, 0xff, 0x0a, 0x0a])]],
    ["malformed JSON", ["data: {\n\n"]],
    ["batch", ["data: []\n\n"]],
    ["standalone request", sse({ jsonrpc: "2.0", id: "invalid", method: "tools/list", params: {} })],
    ["wrong terminal ID", sse(success("other"))]
  ]

  for (const [label, chunks] of invalid) {
    const result = await Effect.runPromise(Effect.scoped(
      Effect.gen(function*() {
        const transport = yield* StreamableHttpClientTransport.make({
          url: "https://mcp.example.test/endpoint",
          fetch: async () => sseResponse(chunks)
        })
        return yield* transport.request(request("invalid")).pipe(Stream.runCollect, Effect.either)
      })
    ))
    assert.equal(Either.isLeft(result), true, label)
  }
})

test("incremental SSE rejects invalid terminal ordering and ordinary subscription frames", async () => {
  const terminal = success("ordered")
  const notification = {
    jsonrpc: "2.0",
    method: "notifications/progress",
    params: { progressToken: "p", progress: 1 }
  }
  const subscriptionNotification = {
    jsonrpc: "2.0",
    method: "notifications/tools/list_changed",
    params: { _meta: { "io.modelcontextprotocol/subscriptionId": "ordered" } }
  }
  const invalid = [
    ["duplicate terminal", sse(terminal, terminal)],
    ["notification after terminal", sse(terminal, notification)],
    ["subscription notification on ordinary request", sse(subscriptionNotification, terminal)]
  ]

  for (const [label, chunks] of invalid) {
    const result = await Effect.runPromise(Effect.scoped(
      Effect.gen(function*() {
        const transport = yield* StreamableHttpClientTransport.make({
          url: "https://mcp.example.test/endpoint",
          fetch: async () => sseResponse(chunks)
        })
        return yield* transport.request(request("ordered")).pipe(Stream.runCollect, Effect.either)
      })
    ))
    assert.equal(Either.isLeft(result), true, label)
  }
})

test("incremental SSE enforces line and event byte bounds before decoding", async () => {
  const cases = [
    ["line", { maxLineBytes: 16, maxEventBytes: 128 }, [`data: ${"x".repeat(32)}\n\n`]],
    ["event", { maxLineBytes: 64, maxEventBytes: 24 }, ["data: 1234567890\ndata: 1234567890\n\n"]]
  ]
  for (const [label, bounds, chunks] of cases) {
    const result = await Effect.runPromise(Effect.scoped(
      Effect.gen(function*() {
        const transport = yield* StreamableHttpClientTransport.make({
          url: "https://mcp.example.test/endpoint",
          ...bounds,
          fetch: async () => sseResponse(chunks)
        })
        return yield* transport.request(request(label)).pipe(Stream.runCollect, Effect.either)
      })
    ))
    assert.equal(Either.isLeft(result), true, label)
    assert.equal(result.left._tag, "TransportError", label)
  }
})

test("incremental SSE rejects partial and terminal-less ordinary EOF", async () => {
  const cases = [
    ["partial line", ["data: {"]],
    ["partial event", [`data: ${JSON.stringify(success("eof"))}\n`]],
    ["ordinary without terminal", [": keepalive\n\n"]]
  ]
  for (const [label, chunks] of cases) {
    const result = await Effect.runPromise(Effect.scoped(
      Effect.gen(function*() {
        const transport = yield* StreamableHttpClientTransport.make({
          url: "https://mcp.example.test/endpoint",
          fetch: async () => sseResponse(chunks)
        })
        return yield* transport.request(request("eof")).pipe(Stream.runCollect, Effect.either)
      })
    ))
    assert.equal(Either.isLeft(result), true, label)
  }
})

test("subscription SSE rejects wrong ordering, selection, IDs, and abrupt EOF", async () => {
  const id = "sub-invalid"
  const meta = (value = id) => ({ "io.modelcontextprotocol/subscriptionId": value })
  const ack = (notifications = { toolsListChanged: true }, value = id) => ({
    jsonrpc: "2.0",
    method: "notifications/subscriptions/acknowledged",
    params: { _meta: meta(value), notifications }
  })
  const changed = (method, value = id, extra = {}) => ({
    jsonrpc: "2.0",
    method,
    params: { _meta: meta(value), ...extra }
  })
  const listen = request(id, "subscriptions/listen", {
    notifications: { toolsListChanged: true }
  })
  const invalid = [
    ["notification before acknowledgement", sse(changed("notifications/tools/list_changed"))],
    ["wrong acknowledgement ID", sse(ack(undefined, "other"))],
    ["acknowledges unrequested filter", sse(ack({ promptsListChanged: true }))],
    ["wrong notification ID", sse(ack(), changed("notifications/tools/list_changed", "other"))],
    ["unselected notification", sse(ack(), changed("notifications/prompts/list_changed"))],
    ["abrupt EOF after acknowledgement", sse(ack())]
  ]

  for (const [label, chunks] of invalid) {
    const result = await Effect.runPromise(Effect.scoped(
      Effect.gen(function*() {
        const transport = yield* StreamableHttpClientTransport.make({
          url: "https://mcp.example.test/endpoint",
          fetch: async () => sseResponse(chunks)
        })
        return yield* transport.request(listen).pipe(Stream.runCollect, Effect.either)
      })
    ))
    assert.equal(Either.isLeft(result), true, label)
  }

  const json = await Effect.runPromise(Effect.scoped(
    Effect.gen(function*() {
      const transport = yield* StreamableHttpClientTransport.make({
        url: "https://mcp.example.test/endpoint",
        fetch: async () => jsonResponse(success(id))
      })
      return yield* transport.request(listen).pipe(Stream.runCollect, Effect.either)
    })
  ))
  assert.equal(Either.isLeft(json), true, "subscription must use SSE")
})

test("subscription SSE requires exact terminal metadata and forbids duplicate acknowledgement", async () => {
  const id = "sub-terminal"
  const subscriptionMeta = (value = id) => ({ "io.modelcontextprotocol/subscriptionId": value })
  const acknowledged = {
    jsonrpc: "2.0",
    method: "notifications/subscriptions/acknowledged",
    params: {
      _meta: subscriptionMeta(),
      notifications: { toolsListChanged: true }
    }
  }
  const listen = request(id, "subscriptions/listen", {
    notifications: { toolsListChanged: true }
  })
  const invalid = [
    ["missing terminal subscription ID", sse(acknowledged, success(id, { resultType: "complete", _meta: {} }))],
    ["wrong terminal subscription ID", sse(acknowledged, success(id, {
      resultType: "complete",
      _meta: subscriptionMeta("other")
    }))],
    ["wrong terminal subscription ID type", sse(acknowledged, success(id, {
      resultType: "complete",
      _meta: subscriptionMeta(1)
    }))],
    ["duplicate acknowledgement", sse(acknowledged, acknowledged)]
  ]

  for (const [label, chunks] of invalid) {
    const result = await Effect.runPromise(Effect.scoped(
      Effect.gen(function*() {
        const transport = yield* StreamableHttpClientTransport.make({
          url: "https://mcp.example.test/endpoint",
          fetch: async () => sseResponse(chunks)
        })
        return yield* transport.request(listen).pipe(Stream.runCollect, Effect.either)
      })
    ))
    assert.equal(Either.isLeft(result), true, label)
    assert.equal(result.left._tag, "InvalidRequest", label)
  }
})

test("HTTP response streams reject the stdio-only cancelled notification", async () => {
  const cancelled = {
    jsonrpc: "2.0",
    method: "notifications/cancelled",
    params: { requestId: "http-cancelled" }
  }
  const result = await Effect.runPromise(Effect.scoped(
    Effect.gen(function*() {
      const transport = yield* StreamableHttpClientTransport.make({
        url: "https://mcp.example.test/endpoint",
        fetch: async () => sseResponse(sse(cancelled, success("http-cancelled")))
      })
      return yield* transport.request(request("http-cancelled")).pipe(Stream.runCollect, Effect.either)
    })
  ))
  assert.equal(Either.isLeft(result), true)
  assert.equal(result.left._tag, "InvalidRequest")
})

test("subscription SSE enforces acknowledged resource URI selection", async () => {
  const id = "sub-resource"
  const subscriptionMeta = { "io.modelcontextprotocol/subscriptionId": id }
  const ack = (uris) => ({
    jsonrpc: "2.0",
    method: "notifications/subscriptions/acknowledged",
    params: {
      _meta: subscriptionMeta,
      notifications: { resourceSubscriptions: uris }
    }
  })
  const updated = (uri) => ({
    jsonrpc: "2.0",
    method: "notifications/resources/updated",
    params: { _meta: subscriptionMeta, uri }
  })
  const terminal = success(id, { resultType: "complete", _meta: subscriptionMeta })
  const listen = request(id, "subscriptions/listen", {
    notifications: { resourceSubscriptions: ["file:///one", "file:///two"] }
  })

  const frames = await runRequest({
    url: "https://mcp.example.test/endpoint",
    fetch: async () => sseResponse(sse(ack(["file:///one"]), updated("file:///one"), terminal))
  }, listen)
  assert.deepEqual(Chunk.toReadonlyArray(frames).map((frame) => frame._tag), [
    "Notification",
    "Notification",
    "Success"
  ])

  const invalid = [
    ["acknowledges unrequested URI", sse(ack(["file:///three"]))],
    ["updates URI outside acknowledged subset", sse(ack(["file:///one"]), updated("file:///two"))]
  ]
  for (const [label, chunks] of invalid) {
    const result = await Effect.runPromise(Effect.scoped(
      Effect.gen(function*() {
        const transport = yield* StreamableHttpClientTransport.make({
          url: "https://mcp.example.test/endpoint",
          fetch: async () => sseResponse(chunks)
        })
        return yield* transport.request(listen).pipe(Stream.runCollect, Effect.either)
      })
    ))
    assert.equal(Either.isLeft(result), true, label)
    assert.equal(result.left._tag, "InvalidRequest", label)
  }
})

test("ordinary SSE rejects subscription-only methods even when subscription metadata is missing", async () => {
  const id = "ordinary-subscription-method"
  const subscriptionOnly = [
    { method: "notifications/subscriptions/acknowledged", params: { notifications: {} } },
    { method: "notifications/tools/list_changed", params: {} },
    { method: "notifications/prompts/list_changed", params: {} },
    { method: "notifications/resources/list_changed", params: {} },
    { method: "notifications/resources/updated", params: { uri: "file:///one" } }
  ]

  for (const item of subscriptionOnly) {
    const result = await Effect.runPromise(Effect.scoped(
      Effect.gen(function*() {
        const transport = yield* StreamableHttpClientTransport.make({
          url: "https://mcp.example.test/endpoint",
          fetch: async () => sseResponse(sse({ jsonrpc: "2.0", ...item }, success(id)))
        })
        return yield* transport.request(request(id)).pipe(Stream.runCollect, Effect.either)
      })
    ))
    assert.equal(Either.isLeft(result), true, item.method)
    assert.equal(result.left._tag, "InvalidRequest", item.method)
  }
})

test("ordinary SSE validates known notification payloads and preserves unknown extensions", async () => {
  const known = await Effect.runPromise(Effect.scoped(Effect.gen(function*() {
    const transport = yield* StreamableHttpClientTransport.make({
      url: "https://mcp.example.test/endpoint",
      fetch: async () => sseResponse(sse(
        {
          jsonrpc: "2.0",
          method: "notifications/progress",
          params: { progressToken: "work", progress: "invalid" }
        },
        success("known-invalid")
      ))
    })
    return yield* transport.request(request("known-invalid")).pipe(Stream.runCollect, Effect.either)
  })))
  assert.equal(Either.isLeft(known), true)
  assert.equal(known.left._tag, "InvalidRequest")

  const unknown = await runRequest({
    url: "https://mcp.example.test/endpoint",
    fetch: async () => sseResponse(sse(
      {
        jsonrpc: "2.0",
        method: "notifications/vendor.extension",
        params: { arbitrary: { future: true } }
      },
      success("unknown-extension")
    ))
  }, request("unknown-extension"))
  assert.deepEqual(
    Chunk.toReadonlyArray(unknown).map((frame) => frame._tag),
    ["Notification", "Success"]
  )
})

test("subscription acknowledgement requires generated filter value shapes", async () => {
  const id = "malformed-ack-filter"
  const meta = { "io.modelcontextprotocol/subscriptionId": id }
  const listen = request(id, "subscriptions/listen", { notifications: {} })
  const malformed = [
    { toolsListChanged: "yes" },
    { promptsListChanged: 1 },
    { resourcesListChanged: null },
    { resourceSubscriptions: "file:///one" },
    { resourceSubscriptions: ["file:///one", 2] }
  ]

  for (const notifications of malformed) {
    const acknowledged = {
      jsonrpc: "2.0",
      method: "notifications/subscriptions/acknowledged",
      params: { _meta: meta, notifications }
    }
    const result = await Effect.runPromise(Effect.scoped(
      Effect.gen(function*() {
        const transport = yield* StreamableHttpClientTransport.make({
          url: "https://mcp.example.test/endpoint",
          fetch: async () => sseResponse(sse(acknowledged))
        })
        return yield* transport.request(listen).pipe(Stream.runCollect, Effect.either)
      })
    ))
    assert.equal(Either.isLeft(result), true, JSON.stringify(notifications))
    assert.equal(result.left._tag, "InvalidRequest", JSON.stringify(notifications))
  }
})

test("closing a request stream aborts fetch and cancels and releases its response reader", async () => {
  let fetchSignal
  let body
  let bodyCancelled = 0
  const notification = {
    jsonrpc: "2.0",
    method: "notifications/progress",
    params: { progressToken: "cancel", progress: 1 }
  }
  const frames = await Effect.runPromise(Effect.scoped(
    Effect.gen(function*() {
      const transport = yield* StreamableHttpClientTransport.make({
        url: "https://mcp.example.test/endpoint",
        fetch: async (_input, init) => {
          fetchSignal = init.signal
          body = new ReadableStream({
            start(controller) {
              controller.enqueue(encoder.encode(sse(notification)[0]))
            },
            cancel() {
              bodyCancelled += 1
            }
          })
          return new Response(body, { headers: { "Content-Type": "text/event-stream" } })
        }
      })
      return yield* transport.request(request("cancel")).pipe(Stream.take(1), Stream.runCollect)
    })
  ))
  assert.equal(Chunk.toReadonlyArray(frames).length, 1)
  assert.equal(fetchSignal.aborted, true)
  assert.equal(bodyCancelled, 1)
  assert.equal(body.locked, false)
})

test("incremental SSE reads with downstream backpressure and retains reader failures", async () => {
  let pulls = 0
  let cancelled = 0
  const cause = new Error("synthetic reader failure")
  const first = {
    jsonrpc: "2.0",
    method: "notifications/progress",
    params: { progressToken: "pull", progress: 1 }
  }
  const second = {
    jsonrpc: "2.0",
    method: "notifications/progress",
    params: { progressToken: "pull", progress: 2 }
  }
  const chunks = [sse(first)[0], sse(second)[0]]
  const response = new Response(new ReadableStream({
    pull(controller) {
      const chunk = chunks[pulls]
      pulls += 1
      if (chunk !== undefined) controller.enqueue(encoder.encode(chunk))
      else controller.error(cause)
    },
    cancel() {
      cancelled += 1
    }
  }), { headers: { "Content-Type": "text/event-stream" } })
  const result = await Effect.runPromise(Effect.scoped(
    Effect.gen(function*() {
      const transport = yield* StreamableHttpClientTransport.make({
        url: "https://mcp.example.test/endpoint",
        fetch: async () => response
      })
      return yield* transport.request(request("pull")).pipe(Stream.runCollect, Effect.either)
    })
  ))
  assert.equal(Either.isLeft(result), true)
  assert.equal(result.left._tag, "TransportError")
  assert.ok(result.left.cause === cause || result.left.cause !== undefined)
  assert.ok(pulls <= 3, `reader pulled ${pulls} chunks without downstream demand`)
  assert.equal(cancelled <= 1, true)
})

test("real Node HTTP response delivers arbitrary incremental SSE chunks", async () => {
  const id = "real-incremental"
  const notification = {
    jsonrpc: "2.0",
    method: "notifications/progress",
    params: { progressToken: "real", progress: 1, message: "世界" }
  }
  const terminal = success(id, { resultType: "complete", value: "ok", tools: [] })
  const payload = `${sse(notification)[0]}${sse(terminal)[0]}`
  const bytes = encoder.encode(payload)
  const server = createServer((incoming, outgoing) => {
    assert.equal(incoming.method, "POST")
    outgoing.writeHead(200, { "Content-Type": "text/event-stream" })
    outgoing.write(bytes.slice(0, 3))
    outgoing.write(bytes.slice(3, 17))
    outgoing.write(bytes.slice(17, 31))
    outgoing.end(bytes.slice(31))
  })
  server.listen(0, "127.0.0.1")
  await once(server, "listening")
  try {
    const address = server.address()
    assert.notEqual(address, null)
    assert.equal(typeof address, "object")
    const frames = await runRequest({ url: `http://127.0.0.1:${address.port}/mcp` }, request(id))
    assert.deepEqual(Chunk.toReadonlyArray(frames).map((frame) => frame._tag), ["Notification", "Success"])
  } finally {
    const closed = once(server, "close")
    server.close()
    await closed
  }
})

test("OAuth challenge retries once with refreshed provider output and abort-aware fetches", async () => {
  const provider = makeOAuthProvider()
  const endpoint = "https://mcp.example.test/endpoint"
  const resourceMetadata = "https://mcp.example.test/.well-known/oauth-protected-resource"
  const authorizationServer = "https://auth.example.test"
  let endpointCalls = 0
  const endpointAuth = []
  const signals = []

  const frames = await runRequest({
    url: endpoint,
    headers: { authorization: "Bearer caller-must-not-win" },
    authProvider: provider,
    fetch: async (input, init = {}) => {
      const url = String(input)
      signals.push(init.signal)
      if (url === endpoint) {
        endpointCalls += 1
        endpointAuth.push(new Headers(init.headers).get("authorization"))
        return endpointCalls === 1
          ? new Response(null, {
              status: 401,
              headers: { "WWW-Authenticate": `Bearer resource_metadata="${resourceMetadata}"` }
            })
          : jsonResponse(success("oauth"))
      }
      if (url === resourceMetadata) {
        return jsonResponse({
          resource: endpoint,
          authorization_servers: [authorizationServer]
        })
      }
      if (url === `${authorizationServer}/.well-known/oauth-authorization-server`) {
        return jsonResponse({
          issuer: authorizationServer,
          authorization_endpoint: `${authorizationServer}/authorize`,
          token_endpoint: `${authorizationServer}/token`,
          token_endpoint_auth_methods_supported: ["none"]
        })
      }
      if (url === `${authorizationServer}/token`) {
        return jsonResponse({ access_token: "new-token", token_type: "Bearer" })
      }
      throw new Error(`unexpected OAuth URL: ${url}`)
    }
  }, request("oauth"))

  assert.equal(Chunk.toReadonlyArray(frames)[0].response.id, "oauth")
  assert.equal(endpointCalls, 2)
  assert.deepEqual(endpointAuth, ["Bearer old-token", "Bearer new-token"])
  assert.ok(signals.every((signal) => signal instanceof AbortSignal))
  assert.ok(signals.every((signal) => signal.aborted), "request scope must abort OAuth fetch signals")
})

test("OAuth challenge budget stops after a second 401 and never retries other failures", async () => {
  const provider = makeOAuthProvider()
  const endpoint = "https://mcp.example.test/endpoint"
  const resourceMetadata = "https://mcp.example.test/.well-known/oauth-protected-resource"
  const authorizationServer = "https://auth.example.test"
  let endpointCalls = 0
  const fetch = async (input) => {
    const url = String(input)
    if (url === endpoint) {
      endpointCalls += 1
      return new Response(null, {
        status: 401,
        headers: { "WWW-Authenticate": `Bearer resource_metadata="${resourceMetadata}"` }
      })
    }
    if (url === resourceMetadata) {
      return jsonResponse({ resource: endpoint, authorization_servers: [authorizationServer] })
    }
    if (url === `${authorizationServer}/.well-known/oauth-authorization-server`) {
      return jsonResponse({
        issuer: authorizationServer,
        authorization_endpoint: `${authorizationServer}/authorize`,
        token_endpoint: `${authorizationServer}/token`,
        token_endpoint_auth_methods_supported: ["none"]
      })
    }
    if (url === `${authorizationServer}/token`) {
      return jsonResponse({ access_token: "still-rejected", token_type: "Bearer" })
    }
    throw new Error(`unexpected OAuth URL: ${url}`)
  }

  const result = await Effect.runPromise(Effect.scoped(
    Effect.gen(function*() {
      const transport = yield* StreamableHttpClientTransport.make({
        url: endpoint,
        authProvider: provider,
        fetch
      })
      return yield* transport.request(request("oauth-stop")).pipe(Stream.runCollect, Effect.either)
    })
  ))
  assert.equal(Either.isLeft(result), true)
  assert.equal(result.left._tag, "TransportError")
  assert.equal(result.left.status, 401)
  assert.equal(endpointCalls, 2)

  let forbiddenCalls = 0
  const forbidden = await Effect.runPromise(Effect.scoped(
    Effect.gen(function*() {
      const transport = yield* StreamableHttpClientTransport.make({
        url: endpoint,
        fetch: async () => {
          forbiddenCalls += 1
          return new Response(null, { status: 403 })
        }
      })
      return yield* transport.request(request("no-provider")).pipe(Stream.runCollect, Effect.either)
    })
  ))
  assert.equal(Either.isLeft(forbidden), true)
  assert.equal(forbiddenCalls, 1)
})

test("OAuth redirect completes with one code exchange inside the same retry budget", async () => {
  const provider = makeOAuthProvider()
  provider.redirectUrl = "https://client.example.test/callback"
  provider.getAuthCode = () => "authorization-code"
  let redirected
  provider.redirectToAuthorization = (url) => {
    redirected = url
  }
  const endpoint = "https://mcp.example.test/endpoint"
  const resourceMetadata = "https://mcp.example.test/.well-known/oauth-protected-resource"
  const authorizationServer = "https://auth.example.test"
  let endpointCalls = 0
  let tokenBody
  const frames = await runRequest({
    url: endpoint,
    authProvider: provider,
    fetch: async (input, init = {}) => {
      const url = String(input)
      if (url === endpoint) {
        endpointCalls += 1
        return endpointCalls === 1
          ? new Response(null, {
              status: 401,
              headers: { "WWW-Authenticate": `Bearer resource_metadata="${resourceMetadata}"` }
            })
          : jsonResponse(success("oauth-redirect"))
      }
      if (url === resourceMetadata) {
        return jsonResponse({ resource: endpoint, authorization_servers: [authorizationServer] })
      }
      if (url === `${authorizationServer}/.well-known/oauth-authorization-server`) {
        return jsonResponse({
          issuer: authorizationServer,
          authorization_endpoint: `${authorizationServer}/authorize`,
          token_endpoint: `${authorizationServer}/token`,
          token_endpoint_auth_methods_supported: ["none"]
        })
      }
      if (url === `${authorizationServer}/token`) {
        tokenBody = String(init.body)
        return jsonResponse({ access_token: "redirect-token", token_type: "Bearer" })
      }
      throw new Error(`unexpected OAuth URL: ${url}`)
    }
  }, request("oauth-redirect"))
  assert.equal(endpointCalls, 2)
  assert.equal(Chunk.toReadonlyArray(frames)[0].response.id, "oauth-redirect")
  assert.equal(redirected.searchParams.get("code_challenge_method"), "S256")
  assert.match(tokenBody, /grant_type=authorization_code/)
  assert.match(tokenBody, /code=authorization-code/)
})

test("cancelling during OAuth discovery aborts the auth fetch", async () => {
  const provider = makeOAuthProvider()
  const endpoint = "https://mcp.example.test/endpoint"
  const resourceMetadata = "https://mcp.example.test/.well-known/oauth-protected-resource"
  let startedResolve
  const started = new Promise((resolve) => {
    startedResolve = resolve
  })
  let authSignal
  await Effect.runPromise(Effect.scoped(Effect.gen(function*() {
    const transport = yield* StreamableHttpClientTransport.make({
      url: endpoint,
      authProvider: provider,
      fetch: async (input, init = {}) => {
        if (String(input) === endpoint) {
          return new Response(null, {
            status: 401,
            headers: { "WWW-Authenticate": `Bearer resource_metadata="${resourceMetadata}"` }
          })
        }
        authSignal = init.signal
        startedResolve()
        return await new Promise((_resolve, reject) => {
          init.signal.addEventListener("abort", () => reject(init.signal.reason), { once: true })
        })
      }
    })
    const fiber = yield* Effect.fork(
      transport.request(request("cancel-auth")).pipe(Stream.runDrain)
    )
    yield* Effect.promise(() => started)
    yield* Fiber.interrupt(fiber)
  })))
  assert.equal(authSignal instanceof AbortSignal, true)
  assert.equal(authSignal.aborted, true)
})

test("tools/list filters and caches schemas before one hidden HeaderMismatch refresh", async () => {
  const warnings = []
  const calls = []
  let listCalls = 0
  let callAttempts = 0
  const oldTool = {
    name: "deploy",
    inputSchema: {
      type: "object",
      properties: { region: { type: "string", "x-mcp-header": "Old-Region" } }
    }
  }
  const newTool = {
    name: "deploy",
    inputSchema: {
      type: "object",
      properties: { region: { type: "string", "x-mcp-header": "Region" } }
    }
  }
  const invalidTool = {
    name: "invalid",
    inputSchema: {
      type: "object",
      properties: { value: { type: "number", "x-mcp-header": "Value" } }
    }
  }
  const clientMeta = {
    ...protocolMeta,
    "io.modelcontextprotocol/clientInfo": { name: "cache-test", version: "1" }
  }
  const options = {
    url: "https://mcp.example.test/endpoint",
    warningSink: (warning) => Effect.sync(() => warnings.push(warning)),
    fetch: async (_input, init) => {
      const body = JSON.parse(init.body)
      const headers = new Headers(init.headers)
      calls.push({ body, headers })
      if (body.method === "tools/list") {
        listCalls += 1
        return jsonResponse(success(body.id, {
          resultType: "complete",
          tools: listCalls === 1 ? [oldTool, invalidTool] : [newTool]
        }))
      }
      callAttempts += 1
      if (callAttempts === 1) {
        assert.equal(headers.get("mcp-param-old-region"), "us-west1")
        return jsonResponse({
          jsonrpc: "2.0",
          id: body.id,
          error: { code: -32020, message: "stale custom header" }
        }, { status: 400 })
      }
      assert.equal(headers.has("mcp-param-old-region"), false)
      assert.equal(headers.get("mcp-param-region"), "us-west1")
      return jsonResponse(success(body.id, { resultType: "complete", content: [] }))
    }
  }

  const [listed, called] = await Effect.runPromise(Effect.scoped(
    Effect.gen(function*() {
      const transport = yield* StreamableHttpClientTransport.make(options)
      const listRequest = request("public-list")
      listRequest.params._meta = { ...clientMeta }
      const listed = yield* transport.request(listRequest).pipe(Stream.runCollect)
      const callRequest = request("public-call", "tools/call", {
        name: "deploy",
        arguments: { region: "us-west1" }
      })
      callRequest.params._meta = { ...clientMeta }
      const called = yield* transport.request(callRequest).pipe(Stream.runCollect)
      return [listed, called]
    })
  ))

  assert.deepEqual(Chunk.toReadonlyArray(listed)[0].response.result.tools.map((tool) => tool.name), ["deploy"])
  assert.equal(warnings.length, 1)
  assert.equal(Chunk.toReadonlyArray(called).at(-1)._tag, "Success")
  assert.equal(calls.length, 4)
  const refresh = calls[2].body
  assert.equal(refresh.method, "tools/list")
  assert.equal(typeof refresh.id, "string")
  assert.notEqual(refresh.id, "public-call")
  assert.match(refresh.id, /[0-9a-f]{8}-[0-9a-f-]+:\d+$/i)
  assert.deepEqual(refresh.params._meta, clientMeta)
  assert.equal(calls[1].body.id, "public-call")
  assert.equal(calls[3].body.id, "public-call")
})

test("warning sink failures never fail filtering or prevent valid plan caching", async () => {
  for (const sink of [
    () => Effect.fail(new Error("sink failure")),
    () => Effect.die(new Error("sink defect"))
  ]) {
    let header
    await Effect.runPromise(Effect.scoped(Effect.gen(function*() {
      const transport = yield* StreamableHttpClientTransport.make({
        url: "https://mcp.example.test/endpoint",
        warningSink: sink,
        fetch: async (_input, init) => {
          const body = JSON.parse(init.body)
          if (body.method === "tools/list") {
            return jsonResponse(success(body.id, {
              resultType: "complete",
              tools: [
                { name: "valid", inputSchema: { type: "object", properties: {
                  region: { type: "string", "x-mcp-header": "Region" }
                } } },
                { name: "invalid", inputSchema: { type: "object", properties: {
                  count: { type: "number", "x-mcp-header": "Count" }
                } } }
              ]
            }))
          }
          header = new Headers(init.headers).get("mcp-param-region")
          return jsonResponse(success(body.id, { resultType: "complete", content: [] }))
        }
      })
      const listed = yield* transport.request(request("sink-list")).pipe(Stream.runCollect)
      assert.deepEqual(
        Chunk.toReadonlyArray(listed)[0].response.result.tools.map((tool) => tool.name),
        ["valid"]
      )
      yield* transport.request(request("sink-call", "tools/call", {
        name: "valid",
        arguments: { region: "eu" }
      })).pipe(Stream.runCollect)
    })))
    assert.equal(header, "eu")
  }
})

test("default warning diagnostics are structured, constant-safe, and non-blocking", async () => {
  const logs = []
  const capture = Logger.make(({ logLevel, message }) => logs.push({ logLevel, message }))
  const program = Effect.scoped(Effect.gen(function*() {
    const transport = yield* StreamableHttpClientTransport.make({
      url: "https://mcp.example.test/endpoint",
      fetch: async (_input, init) => {
        const body = JSON.parse(init.body)
        return jsonResponse(success(body.id, {
          resultType: "complete",
          tools: [{
            name: "safe-name",
            description: "synthetic-secret-must-not-log",
            inputSchema: { type: "object", properties: {
              count: { type: "number", "x-mcp-header": "Count" }
            } }
          }]
        }))
      }
    })
    return yield* transport.request(request("default-warning")).pipe(Stream.runCollect)
  })).pipe(Effect.provide(Logger.replace(Logger.defaultLogger, capture)))
  const frames = await Effect.runPromise(program)
  assert.deepEqual(Chunk.toReadonlyArray(frames)[0].response.result.tools, [])
  assert.equal(logs.length, 1)
  assert.deepEqual(logs[0].message, [{
    _tag: "InvalidHttpToolHeader",
    toolName: "safe-name",
    reason: "unsupported-property-type"
  }])
  assert.equal(JSON.stringify(logs).includes("synthetic-secret"), false)
})

test("first-page tools lists replace the catalog while cursor pages merge", async () => {
  const listed = [
    [{ name: "one", inputSchema: { type: "object", properties: {
      value: { type: "string", "x-mcp-header": "One" }
    } } }],
    [{ name: "two", inputSchema: { type: "object", properties: {
      value: { type: "string", "x-mcp-header": "Two" }
    } } }],
    [{ name: "three", inputSchema: { type: "object", properties: {
      value: { type: "string", "x-mcp-header": "Three" }
    } } }]
  ]
  let listIndex = 0
  const callHeaders = new Map()
  await Effect.runPromise(Effect.scoped(Effect.gen(function*() {
    const transport = yield* StreamableHttpClientTransport.make({
      url: "https://mcp.example.test/endpoint",
      fetch: async (_input, init) => {
        const body = JSON.parse(init.body)
        if (body.method === "tools/list") {
          return jsonResponse(success(body.id, { resultType: "complete", tools: listed[listIndex++] }))
        }
        callHeaders.set(body.params.name, new Headers(init.headers))
        return jsonResponse(success(body.id, { resultType: "complete", content: [] }))
      }
    })
    yield* transport.request(request("page-one")).pipe(Stream.runDrain)
    yield* transport.request(request("page-two", "tools/list", { cursor: "next" })).pipe(Stream.runDrain)
    yield* transport.request(request("replacement")).pipe(Stream.runDrain)
    for (const name of ["one", "two", "three"]) {
      yield* transport.request(request(`call-${name}`, "tools/call", {
        name,
        arguments: { value: name }
      })).pipe(Stream.runDrain)
    }
  })))
  assert.equal(callHeaders.get("one").has("mcp-param-one"), false)
  assert.equal(callHeaders.get("two").has("mcp-param-two"), false)
  assert.equal(callHeaders.get("three").get("mcp-param-three"), "three")
})

test("concurrent same-tool recoveries retry with their own refreshed plan", async () => {
  const retryHeaders = new Map()
  const attempts = new Map()
  await Effect.runPromise(Effect.scoped(Effect.gen(function*() {
    const transport = yield* StreamableHttpClientTransport.make({
      url: "https://mcp.example.test/endpoint",
      fetch: async (_input, init) => {
        const body = JSON.parse(init.body)
        if (body.method === "tools/list") {
          const marker = body.params._meta.marker
          await Promise.resolve()
          return jsonResponse(success(body.id, {
            resultType: "complete",
            tools: [{ name: "shared", inputSchema: { type: "object", properties: {
              value: { type: "string", "x-mcp-header": marker }
            } } }]
          }))
        }
        const count = (attempts.get(body.id) ?? 0) + 1
        attempts.set(body.id, count)
        if (count === 1) {
          return jsonResponse({
            jsonrpc: "2.0",
            id: body.id,
            error: { code: -32020, message: "refresh" }
          }, { status: 400 })
        }
        retryHeaders.set(body.id, new Headers(init.headers))
        return jsonResponse(success(body.id, { resultType: "complete", content: [] }))
      }
    })
    const call = (id, marker) => {
      const message = request(id, "tools/call", { name: "shared", arguments: { value: id } })
      message.params._meta.marker = marker
      return transport.request(message).pipe(Stream.runDrain)
    }
    yield* Effect.all([call("one", "Plan-One"), call("two", "Plan-Two")], { concurrency: "unbounded" })
  })))
  assert.equal(retryHeaders.get("one").get("mcp-param-plan-one"), "one")
  assert.equal(retryHeaders.get("one").has("mcp-param-plan-two"), false)
  assert.equal(retryHeaders.get("two").get("mcp-param-plan-two"), "two")
  assert.equal(retryHeaders.get("two").has("mcp-param-plan-one"), false)
})

test("HeaderMismatch recovery exposes the original terminal when refresh omits the target", async () => {
  const calls = []
  const frames = await runRequest({
    url: "https://mcp.example.test/endpoint",
    fetch: async (_input, init) => {
      const body = JSON.parse(init.body)
      calls.push(body)
      if (body.method === "tools/call") {
        return jsonResponse({
          jsonrpc: "2.0",
          id: body.id,
          error: { code: -32020, message: "original mismatch" }
        }, { status: 400 })
      }
      return jsonResponse(success(body.id, { resultType: "complete", tools: [] }))
    }
  }, request("missing-target", "tools/call", { name: "gone", arguments: {} }))

  assert.equal(calls.length, 2)
  assert.equal(calls[1].method, "tools/list")
  const terminal = Chunk.toReadonlyArray(frames).at(-1)
  assert.equal(terminal._tag, "Error")
  assert.equal(terminal.response.error.message, "original mismatch")
})

test("known-empty stale plans refresh once and a retry mismatch stops", async () => {
  const tool = (annotated) => ({
    name: "empty-stale",
    inputSchema: annotated
      ? { type: "object", properties: { region: { type: "string", "x-mcp-header": "Region" } } }
      : { type: "object", properties: { region: { type: "string" } } }
  })
  let lists = 0
  const calls = []
  await Effect.runPromise(Effect.scoped(Effect.gen(function*() {
    const transport = yield* StreamableHttpClientTransport.make({
      url: "https://mcp.example.test/endpoint",
      fetch: async (_input, init) => {
        const body = JSON.parse(init.body)
        calls.push(body)
        if (body.method === "tools/list") {
          lists += 1
          return jsonResponse(success(body.id, { resultType: "complete", tools: [tool(lists > 1)] }))
        }
        return jsonResponse({
          jsonrpc: "2.0",
          id: body.id,
          error: { code: -32020, message: `mismatch-${calls.length}` }
        }, { status: 400 })
      }
    })
    yield* transport.request(request("seed-empty")).pipe(Stream.runCollect)
    const frames = yield* transport.request(request("retry-once", "tools/call", {
      name: "empty-stale",
      arguments: { region: "x" }
    })).pipe(Stream.runCollect)
    assert.equal(Chunk.toReadonlyArray(frames).at(-1).response.error.code, -32020)
  })))
  assert.deepEqual(calls.map((call) => call.method), ["tools/list", "tools/call", "tools/list", "tools/call"])
})

test("invalid or failed internal refresh preserves the original mismatch", async () => {
  for (const mode of ["invalid", "transport", "terminal"]) {
    let count = 0
    const frames = await runRequest({
      url: "https://mcp.example.test/endpoint",
      warningSink: () => Effect.void,
      fetch: async (_input, init) => {
        const body = JSON.parse(init.body)
        count += 1
        if (body.method === "tools/call") {
          return jsonResponse({ jsonrpc: "2.0", id: body.id, error: { code: -32020, message: "keep-me" } }, { status: 400 })
        }
        if (mode === "transport") throw new Error("refresh transport")
        if (mode === "terminal") {
          return jsonResponse({ jsonrpc: "2.0", id: body.id, error: { code: -32603, message: "refresh failed" } }, { status: 500 })
        }
        return jsonResponse(success(body.id, {
          resultType: "complete",
          tools: [{ name: "target", inputSchema: { type: "object", properties: {
            bad: { type: "number", "x-mcp-header": "Bad" }
          } } }]
        }))
      }
    }, request(`failure-${mode}`, "tools/call", { name: "target", arguments: {} }))
    assert.equal(count, 2, mode)
    const terminal = Chunk.toReadonlyArray(frames).at(-1)
    assert.equal(terminal._tag, "Error", mode)
    assert.equal(terminal.response.error.message, "keep-me", mode)
  }
})

test("concurrent recoveries use distinct random internal IDs and descriptor-copy metadata", async () => {
  const refreshes = []
  let trapInvoked = false
  const attempts = new Map()
  const messages = new Map()
  const options = {
    url: "https://mcp.example.test/endpoint",
    fetch: async (_input, init) => {
      const body = JSON.parse(init.body)
      if (body.method === "tools/list") {
        refreshes.push(body)
        delete messages.get(body.params._meta.marker).params._meta.trap
        return jsonResponse(success(body.id, {
          resultType: "complete",
          tools: [{ name: body.params._meta.marker, inputSchema: { type: "object", properties: {} } }]
        }))
      }
      const count = (attempts.get(body.id) ?? 0) + 1
      attempts.set(body.id, count)
      if (count === 1) {
        Object.defineProperty(messages.get(body.id).params._meta, "trap", {
          enumerable: true,
          get() {
            trapInvoked = true
            return "unsafe"
          }
        })
      }
      return count === 1
        ? jsonResponse({ jsonrpc: "2.0", id: body.id, error: { code: -32020, message: "refresh" } }, { status: 400 })
        : jsonResponse(success(body.id))
    }
  }
  await Effect.runPromise(Effect.scoped(Effect.gen(function*() {
    const transport = yield* StreamableHttpClientTransport.make(options)
    const makeCall = (id) => {
      const message = request(id, "tools/call", { name: id, arguments: {} })
      Object.defineProperty(message.params._meta, "marker", { value: id, enumerable: true })
      messages.set(id, message)
      return transport.request(message).pipe(Stream.runCollect)
    }
    yield* Effect.all([makeCall("one"), makeCall("two")], { concurrency: "unbounded" })
  })))
  assert.equal(refreshes.length, 2)
  assert.equal(new Set(refreshes.map((item) => item.id)).size, 2)
  assert.ok(refreshes.every((item) => typeof item.id === "string" && item.id.includes(":")))
  assert.equal(trapInvoked, false)
  assert.ok(refreshes.every((item) => item.params._meta["io.modelcontextprotocol/protocolVersion"] === "2026-07-28"))
})

test("original call and internal refresh share one OAuth challenge budget", async () => {
  const provider = makeOAuthProvider()
  const endpoint = "https://mcp.example.test/endpoint"
  const resourceMetadata = "https://mcp.example.test/.well-known/oauth-protected-resource"
  const authorizationServer = "https://auth.example.test"
  let mcpCalls = 0
  let tokenCalls = 0
  const frames = await runRequest({
    url: endpoint,
    authProvider: provider,
    fetch: async (input, init = {}) => {
      const url = String(input)
      if (url === endpoint) {
        mcpCalls += 1
        const body = JSON.parse(init.body)
        if (mcpCalls === 1 || body.method === "tools/list") {
          return new Response(null, {
            status: 401,
            headers: { "WWW-Authenticate": `Bearer resource_metadata="${resourceMetadata}"` }
          })
        }
        return jsonResponse({
          jsonrpc: "2.0",
          id: body.id,
          error: { code: -32020, message: "original after auth" }
        }, { status: 400 })
      }
      if (url === resourceMetadata) {
        return jsonResponse({ resource: endpoint, authorization_servers: [authorizationServer] })
      }
      if (url === `${authorizationServer}/.well-known/oauth-authorization-server`) {
        return jsonResponse({
          issuer: authorizationServer,
          authorization_endpoint: `${authorizationServer}/authorize`,
          token_endpoint: `${authorizationServer}/token`,
          token_endpoint_auth_methods_supported: ["none"]
        })
      }
      if (url === `${authorizationServer}/token`) {
        tokenCalls += 1
        return jsonResponse({ access_token: `token-${tokenCalls}`, token_type: "Bearer" })
      }
      throw new Error(`unexpected URL ${url}`)
    }
  }, request("shared-auth", "tools/call", { name: "unknown", arguments: {} }))
  assert.equal(mcpCalls, 3)
  assert.equal(tokenCalls, 1)
  assert.equal(Chunk.toReadonlyArray(frames).at(-1).response.error.message, "original after auth")
})
