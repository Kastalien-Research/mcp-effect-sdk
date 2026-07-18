import assert from "node:assert/strict"
import { test } from "node:test"
import * as Chunk from "effect/Chunk"
import * as Effect from "effect/Effect"
import * as Either from "effect/Either"
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

const success = (id, result = { resultType: "complete" }) => ({
  jsonrpc: "2.0",
  id,
  result
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
      result: { resultType: "complete", tools: [] }
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
  const terminal = success("sse-order", { resultType: "complete", value: "done" })
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
