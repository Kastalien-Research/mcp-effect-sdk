import { fileURLToPath } from "node:url"
import { dirname, join } from "node:path"
import { describe, expect, it } from "vitest"
import { Effect, Fiber } from "effect"
import { make } from "./StdioTransport.js"
import { make as makeRouter } from "../McpClientProtocol.js"

const __dirname = dirname(fileURLToPath(import.meta.url))
const echoServer = join(__dirname, "test-echo-server.mjs")

describe("StdioTransport", () => {
  it("spawns a process and round-trips a message", async () => {
    const result = await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const protocol = yield* make({
            command: "node",
            args: [echoServer]
          })

          // Send an initialize request
          yield* protocol.send({
            _tag: "Request",
            id: "1",
            tag: "initialize",
            payload: {
              protocolVersion: "2025-11-25",
              capabilities: {},
              clientInfo: {
                name: "test",
                version: "0.1.0"
              }
            },
            headers: []
          } as never)

          // Read the response through the run loop
          const responses: Array<unknown> = []
          const fiber = yield* Effect.fork(
            protocol.run((msg) => {
              responses.push(msg)
              return Effect.void
            })
          )

          yield* Effect.sleep("300 millis")
          yield* Fiber.interrupt(fiber)

          expect(responses).toHaveLength(1)
          const resp = responses[0] as Record<
            string,
            unknown
          >
          expect(resp["_tag"]).toBe("Exit")
          expect(resp["requestId"]).toBe("1")
          const exit = resp["exit"] as Record<
            string,
            unknown
          >
          expect(exit["_tag"]).toBe("Success")
          const value = exit["value"] as Record<
            string,
            unknown
          >
          expect(value["protocolVersion"]).toBe("2025-11-25")
          return value
        })
      ).pipe(
        Effect.timeoutFail({
          duration: 5000,
          onTimeout: () => new Error("Test timed out")
        })
      )
    )

    expect(result["protocolVersion"]).toBe("2025-11-25")
  })

  it("integrates with McpClientProtocol router", async () => {
    await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const rawProtocol = yield* make({
            command: "node",
            args: [echoServer]
          })
          const router = yield* makeRouter(rawProtocol)

          // Send ping via transport
          yield* router.clientProtocol.send({
            _tag: "Request",
            id: "99",
            tag: "ping",
            payload: {},
            headers: []
          } as never)

          const responses: Array<unknown> = []
          const fiber = yield* Effect.fork(
            router.clientProtocol.run((msg) => {
              responses.push(msg)
              return Effect.void
            })
          )

          yield* Effect.sleep("300 millis")
          yield* Fiber.interrupt(fiber)

          expect(responses).toHaveLength(1)
          const resp = responses[0] as Record<
            string,
            unknown
          >
          expect(resp["_tag"]).toBe("Exit")
          expect(resp["requestId"]).toBe("99")
        })
      ).pipe(
        Effect.timeoutFail({
          duration: 5000,
          onTimeout: () => new Error("Test timed out")
        })
      )
    )
  })
})
