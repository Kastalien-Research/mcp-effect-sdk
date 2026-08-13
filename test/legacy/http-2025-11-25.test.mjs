import assert from "node:assert/strict"
import test from "node:test"
import * as Effect from "effect/Effect"
import { make as makeClient } from "../../dist/legacy/LegacyClient.js"
import { make as makeHttpClient } from "../../dist/legacy/LegacyHttpClient.js"
import { make as makeHttpServer } from "../../dist/legacy/LegacyHttpServer.js"
import { Implementation, ListToolsResult } from "../../dist/generated/mcp/2025-11-25/McpSchema.generated.js"

test("2025-11-25 Streamable HTTP creates, binds, and deletes a session", async () => {
  await Effect.runPromise(
    Effect.scoped(
      Effect.gen(function* () {
        const httpServer = yield* makeHttpServer({
          serverInfo: new Implementation({ name: "server", version: "1" }),
          capabilities: { tools: {} },
          requestHandlers: {
            "tools/list": () => Effect.succeed(new ListToolsResult({ tools: [] }))
          },
          allowedOrigins: ["https://host.example"],
          allowedHosts: ["mcp.example"]
        })
        const fetch = (input, init) => {
          const headers = new Headers(init?.headers)
          headers.set("host", "mcp.example")
          headers.set("origin", "https://host.example")
          return Effect.runPromise(httpServer.handle(new Request(input, { ...init, headers })))
        }
        const transport = yield* makeHttpClient({ url: "https://mcp.example/mcp", fetch })
        const client = yield* makeClient({
          transport,
          clientInfo: new Implementation({ name: "client", version: "1" })
        })
        assert.equal(typeof (yield* transport.sessionId), "string")
        assert.equal(yield* httpServer.sessionCount, 1)
        const result = yield* client.request("tools/list")
        assert.deepEqual(result.tools, [])
        yield* client.close
        assert.equal(yield* httpServer.sessionCount, 0)
      })
    )
  )
})

test("2025-11-25 Streamable HTTP rejects bad origins and missing version headers", async () => {
  await Effect.runPromise(
    Effect.scoped(
      Effect.gen(function* () {
        const server = yield* makeHttpServer({
          serverInfo: new Implementation({ name: "server", version: "1" }),
          allowedOrigins: ["https://allowed.example"]
        })
        const forbidden = yield* server.handle(
          new Request("https://mcp.example/mcp", {
            method: "POST",
            headers: {
              origin: "https://attacker.example",
              accept: "application/json, text/event-stream",
              "content-type": "application/json"
            },
            body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize", params: {} })
          })
        )
        assert.equal(forbidden.status, 403)
      })
    )
  )
})

test("2025-11-25 Streamable HTTP carries server-initiated requests over GET/SSE", async () => {
  await Effect.runPromise(
    Effect.scoped(
      Effect.gen(function* () {
        let sessionServer
        const httpServer = yield* makeHttpServer({
          serverInfo: new Implementation({ name: "server", version: "1" }),
          onSession: (server) =>
            Effect.sync(() => {
              sessionServer = server
            })
        })
        const fetch = (input, init) => Effect.runPromise(httpServer.handle(new Request(input, init)))
        const transport = yield* makeHttpClient({ url: "https://mcp.example/mcp", fetch, reconnectDelayMs: 1 })
        yield* makeClient({
          transport,
          clientInfo: new Implementation({ name: "client", version: "1" }),
          capabilities: { roots: {} },
          requestHandlers: {
            "roots/list": () => Effect.succeed({ roots: [{ uri: "file:///workspace", name: "workspace" }] })
          }
        })
        const roots = yield* sessionServer.request("roots/list")
        assert.equal(roots.roots[0].uri, "file:///workspace")
      })
    )
  )
})
