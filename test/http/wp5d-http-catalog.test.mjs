import assert from "node:assert/strict"
import { test } from "node:test"
import * as Chunk from "effect/Chunk"
import * as Effect from "effect/Effect"
import * as Stream from "effect/Stream"
import * as HttpClient from "../../dist/transport/StreamableHttpClientTransport.js"

const meta = {
  "io.modelcontextprotocol/protocolVersion": "2026-07-28",
  "io.modelcontextprotocol/clientCapabilities": {}
}
const request = (id, method, params = {}) => ({
  _tag: "Request", jsonrpc: "2.0", id, method, params: { ...params, _meta: meta }
})
const response = (body, type = "application/json") => new Response(
  type === "application/json" ? JSON.stringify(body) : body,
  { status: 200, headers: { "content-type": type } }
)
const success = (id, result) => ({ jsonrpc: "2.0", id, result })
const tool = (header) => ({ name: "echo", inputSchema: { type: "object", properties: {
  value: { type: "string", "x-mcp-header": header }
} } })

test("empty cursor merges plans and tools-list-change clears before mismatch recovery", async () => {
  const calls = []
  let list = 0
  const frames = await Effect.runPromise(Effect.scoped(Effect.gen(function*() {
    const transport = yield* HttpClient.make({
      url: "https://mcp.example.test/mcp",
      fetch: async (_input, init) => {
        const body = JSON.parse(init.body)
        const headers = new Headers(init.headers)
        calls.push({ body, headers })
        if (body.method === "tools/list") {
          const header = list++ === 0 ? "Old" : list === 2 ? "Empty-Page" : "Fresh"
          return response(success(body.id, {
            resultType: "complete", ttlMs: 0, cacheScope: "private", tools: [tool(header)]
          }))
        }
        if (body.method === "subscriptions/listen") {
          const subMeta = { "io.modelcontextprotocol/subscriptionId": body.id }
          const events = [
            { jsonrpc: "2.0", method: "notifications/subscriptions/acknowledged", params: { _meta: subMeta, notifications: { toolsListChanged: true } } },
            { jsonrpc: "2.0", method: "notifications/tools/list_changed", params: { _meta: subMeta } },
            success(body.id, { resultType: "complete", _meta: subMeta })
          ].map((event) => `data: ${JSON.stringify(event)}\n\n`).join("")
          return response(events, "text/event-stream")
        }
        if (!headers.has("mcp-param-fresh")) {
          return new Response(JSON.stringify({ jsonrpc: "2.0", id: body.id, error: { code: -32020, message: "refresh" } }), {
            status: 400,
            headers: { "content-type": "application/json" }
          })
        }
        return response(success(body.id, { resultType: "complete", content: [] }))
      }
    })
    yield* transport.request(request("first", "tools/list")).pipe(Stream.runDrain)
    yield* transport.request(request("empty", "tools/list", { cursor: "" })).pipe(Stream.runDrain)
    yield* transport.request(request("sub", "subscriptions/listen", { notifications: { toolsListChanged: true } })).pipe(Stream.runDrain)
    return yield* transport.request(request("call", "tools/call", { name: "echo", arguments: { value: "x" } })).pipe(Stream.runCollect)
  })))
  const callAttempts = calls.filter(({ body }) => body.method === "tools/call")
  assert.equal(callAttempts.length, 2)
  assert.equal(callAttempts[0].headers.has("mcp-param-old"), false)
  assert.equal(callAttempts[0].headers.has("mcp-param-empty-page"), false)
  assert.equal(callAttempts[1].headers.get("mcp-param-fresh"), "x")
  assert.equal(Chunk.toReadonlyArray(frames).at(-1)._tag, "Success")
})
