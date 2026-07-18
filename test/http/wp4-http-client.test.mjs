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
