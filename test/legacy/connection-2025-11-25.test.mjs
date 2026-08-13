import assert from "node:assert/strict"
import test from "node:test"
import * as Effect from "effect/Effect"
import * as Fiber from "effect/Fiber"
import * as Queue from "effect/Queue"
import * as Stream from "effect/Stream"
import { make as makeClient } from "../../dist/legacy/LegacyClient.js"
import { make as makeServer } from "../../dist/legacy/LegacyServer.js"
import {
  Implementation,
  ListRootsResult,
  ListToolsResult
} from "../../dist/generated/mcp/2025-11-25/McpSchema.generated.js"

const pair = Effect.gen(function* () {
  const clientInbound = yield* Queue.unbounded()
  const serverInbound = yield* Queue.unbounded()
  return {
    client: {
      messages: Stream.fromQueue(clientInbound),
      send: (message) => Queue.offer(serverInbound, message).pipe(Effect.asVoid)
    },
    server: {
      messages: Stream.fromQueue(serverInbound),
      send: (message) => Queue.offer(clientInbound, message).pipe(Effect.asVoid)
    }
  }
})

test("2025-11-25 initializes and routes requests in both directions", async () => {
  await Effect.runPromise(
    Effect.scoped(
      Effect.gen(function* () {
        const transport = yield* pair
        const server = yield* makeServer({
          transport: transport.server,
          serverInfo: new Implementation({ name: "server", version: "1.0.0" }),
          capabilities: { tools: {}, tasks: {}, resources: {} },
          requestHandlers: {
            "tools/list": () => Effect.succeed(new ListToolsResult({ tools: [] }))
          }
        })
        const clientFiber = yield* makeClient({
          transport: transport.client,
          clientInfo: new Implementation({ name: "client", version: "1.0.0" }),
          capabilities: { roots: {}, tasks: {} },
          requestHandlers: {
            "roots/list": () => Effect.succeed(new ListRootsResult({ roots: [] }))
          }
        }).pipe(Effect.fork)
        const client = yield* Fiber.join(clientFiber)
        assert.equal(client.protocolVersion, "2025-11-25")
        assert.equal(client.serverInfo.name, "server")
        assert.equal(yield* server.lifecycle, "initialized")

        const tools = yield* client.request("tools/list", undefined)
        assert.deepEqual(tools.tools, [])
        const roots = yield* server.request("roots/list", undefined)
        assert.deepEqual(roots.roots, [])
      })
    )
  )
})

test("2025-11-25 client rejects a server-selected unknown protocol", async () => {
  await assert.rejects(
    Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const transport = yield* pair
          yield* Effect.forkScoped(
            transport.server.messages.pipe(
              Stream.runForEach((message) =>
                message._tag === "Request"
                  ? transport.server.send({
                      _tag: "SuccessResponse",
                      jsonrpc: "2.0",
                      id: message.id,
                      result: {
                        protocolVersion: "2099-01-01",
                        capabilities: {},
                        serverInfo: { name: "bad", version: "1" }
                      }
                    })
                  : Effect.void
              )
            )
          )
          yield* makeClient({
            transport: transport.client,
            clientInfo: new Implementation({ name: "client", version: "1" })
          })
        })
      )
    ),
    /unsupported MCP protocol version/
  )
})
