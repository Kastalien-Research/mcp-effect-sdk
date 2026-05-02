import { spawn } from "node:child_process"
import { fileURLToPath } from "node:url"
import { dirname, join } from "node:path"
import { describe, expect, it } from "vitest"
import { Chunk, Cause, Effect, Exit, Fiber } from "effect"
import { make } from "./HttpTransport.js"
import { make as makeRouter } from "../McpClientProtocol.js"
import { make as makeClient } from "../McpClient.js"

const __dirname = dirname(fileURLToPath(import.meta.url))
const httpServer = join(__dirname, "test-http-server.mjs")

/**
 * Start the test HTTP server, wait for PORT=XXXX on stderr,
 * return the URL and a cleanup function.
 */
const startServer = (): Effect.Effect<
  { url: string; kill: () => void },
  Error
> =>
  Effect.async<{ url: string; kill: () => void }, Error>(
    (resume) => {
      const child = spawn("node", [httpServer], {
        stdio: ["pipe", "pipe", "pipe"]
      })

      let stderr = ""
      child.stderr?.on("data", (chunk: Buffer) => {
        stderr += chunk.toString()
        const match = stderr.match(/PORT=(\d+)/)
        if (match?.[1]) {
          resume(
            Effect.succeed({
              url: `http://127.0.0.1:${match[1]}`,
              kill: () => child.kill("SIGTERM")
            })
          )
        }
      })

      child.on("error", (err) => {
        resume(
          Effect.fail(
            new Error(`Server failed to start: ${err}`)
          )
        )
      })

      child.on("exit", (code) => {
        if (code !== null && code !== 0) {
          resume(
            Effect.fail(
              new Error(
                `Server exited with code ${code}`
              )
            )
          )
        }
      })
    }
  )

/**
 * Run a test against a fresh HTTP server instance.
 */
const withServer = <A>(
  f: (url: string) => Effect.Effect<A, unknown>
) =>
  Effect.gen(function* () {
    const server = yield* startServer()
    try {
      return yield* f(server.url)
    } finally {
      server.kill()
    }
  }).pipe(
    Effect.timeoutFail({
      duration: 10_000,
      onTimeout: () => new Error("Test timed out")
    })
  )

describe("HttpTransport", () => {
  it("round-trips an initialize request", async () => {
    await Effect.runPromise(
      withServer((url) =>
        Effect.scoped(
          Effect.gen(function* () {
            const protocol = yield* make({ url })

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
            expect(value["protocolVersion"]).toBe(
              "2025-11-25"
            )
          })
        )
      )
    )
  })

  it("receives 202 for notifications", async () => {
    await Effect.runPromise(
      withServer((url) =>
        Effect.scoped(
          Effect.gen(function* () {
            const protocol = yield* make({ url })

            // Init first to get session ID
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

            // Drain init response
            const responses: Array<unknown> = []
            const fiber = yield* Effect.fork(
              protocol.run((msg) => {
                responses.push(msg)
                return Effect.void
              })
            )

            yield* Effect.sleep("200 millis")

            // Send notification (no id → 202)
            yield* protocol.send({
              _tag: "Request",
              id: "",
              tag: "notifications/initialized",
              payload: {},
              headers: []
            } as never)

            yield* Effect.sleep("200 millis")
            yield* Fiber.interrupt(fiber)

            // Only the init response, no extra from notification
            expect(responses).toHaveLength(1)
          })
        )
      )
    )
  })

  it("receives JSON response for ping", async () => {
    await Effect.runPromise(
      withServer((url) =>
        Effect.scoped(
          Effect.gen(function* () {
            const protocol = yield* make({ url })

            // Init first
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

            const responses: Array<unknown> = []
            const fiber = yield* Effect.fork(
              protocol.run((msg) => {
                responses.push(msg)
                return Effect.void
              })
            )

            yield* Effect.sleep("200 millis")

            // Ping
            yield* protocol.send({
              _tag: "Request",
              id: "2",
              tag: "ping",
              payload: {},
              headers: []
            } as never)

            yield* Effect.sleep("200 millis")
            yield* Fiber.interrupt(fiber)

            expect(responses).toHaveLength(2)
            const ping = responses[1] as Record<
              string,
              unknown
            >
            expect(ping["_tag"]).toBe("Exit")
            expect(ping["requestId"]).toBe("2")
          })
        )
      )
    )
  })

  it("parses SSE response from tools/call", async () => {
    await Effect.runPromise(
      withServer((url) =>
        Effect.scoped(
          Effect.gen(function* () {
            const protocol = yield* make({ url })

            // Init
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

            const responses: Array<unknown> = []
            const fiber = yield* Effect.fork(
              protocol.run((msg) => {
                responses.push(msg)
                return Effect.void
              })
            )

            yield* Effect.sleep("200 millis")

            // tools/call → SSE response
            yield* protocol.send({
              _tag: "Request",
              id: "2",
              tag: "tools/call",
              payload: {
                name: "echo",
                arguments: { text: "sse-test" }
              },
              headers: []
            } as never)

            yield* Effect.sleep("300 millis")
            yield* Fiber.interrupt(fiber)

            expect(responses).toHaveLength(2)
            const toolResp = responses[1] as Record<
              string,
              unknown
            >
            expect(toolResp["_tag"]).toBe("Exit")
            expect(toolResp["requestId"]).toBe("2")
            const exit = toolResp["exit"] as Record<
              string,
              unknown
            >
            expect(exit["_tag"]).toBe("Success")
            const value = exit["value"] as Record<
              string,
              unknown
            >
            const content = value["content"] as Array<
              Record<string, unknown>
            >
            expect(content[0]!["text"]).toBe("sse-test")
          })
        )
      )
    )
  })

  it("fails with SessionExpired on 404", async () => {
    await Effect.runPromise(
      withServer((url) =>
        Effect.scoped(
          Effect.gen(function* () {
            // First init to establish a server session
            const protocol = yield* make({ url })

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

            yield* Effect.sleep("200 millis")

            // Create a transport with a wrong session ID
            // header — the server will reject with 404
            const badTransport = yield* make({
              url,
              headers: {
                "MCP-Session-Id": "wrong-session"
              }
            })

            // Send ping — server checks session, returns 404
            const exit = yield* badTransport
              .send({
                _tag: "Request",
                id: "10",
                tag: "ping",
                payload: {},
                headers: []
              } as never)
              .pipe(Effect.exit)

            expect(Exit.isFailure(exit)).toBe(true)
            if (Exit.isFailure(exit)) {
              const defects = Chunk.toReadonlyArray(
                Cause.defects(exit.cause)
              )
              expect(defects).toHaveLength(1)
              const err = defects[0] as {
                reason: string
              }
              expect(err.reason).toBe("SessionExpired")
            }
          })
        )
      )
    )
  })

  it("parses multiple SSE events in one response", async () => {
    await Effect.runPromise(
      withServer((url) =>
        Effect.scoped(
          Effect.gen(function* () {
            const protocol = yield* make({ url })

            // Init
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

            const responses: Array<unknown> = []
            const fiber = yield* Effect.fork(
              protocol.run((msg) => {
                responses.push(msg)
                return Effect.void
              })
            )

            yield* Effect.sleep("200 millis")

            // Call multi-sse tool → 2 SSE events in one body
            yield* protocol.send({
              _tag: "Request",
              id: "2",
              tag: "tools/call",
              payload: {
                name: "multi-sse",
                arguments: {}
              },
              headers: []
            } as never)

            yield* Effect.sleep("300 millis")
            yield* Fiber.interrupt(fiber)

            // 1 init response + 2 SSE events = 3
            expect(responses).toHaveLength(3)

            // Second message: the progress notification
            const notif = responses[1] as Record<
              string,
              unknown
            >
            expect(notif["_tag"]).toBe("Request")
            expect(notif["tag"]).toBe(
              "notifications/progress"
            )

            // Third message: the tool result
            const result = responses[2] as Record<
              string,
              unknown
            >
            expect(result["_tag"]).toBe("Exit")
            expect(result["requestId"]).toBe("2")
          })
        )
      )
    )
  })

  it("concatenates multi-line data: fields per SSE spec", async () => {
    await Effect.runPromise(
      withServer((url) =>
        Effect.scoped(
          Effect.gen(function* () {
            const protocol = yield* make({ url })

            // Init
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

            const responses: Array<unknown> = []
            const fiber = yield* Effect.fork(
              protocol.run((msg) => {
                responses.push(msg)
                return Effect.void
              })
            )

            yield* Effect.sleep("200 millis")

            // multiline-data tool → JSON split across
            // two data: lines in one SSE block
            yield* protocol.send({
              _tag: "Request",
              id: "2",
              tag: "tools/call",
              payload: {
                name: "multiline-data",
                arguments: {}
              },
              headers: []
            } as never)

            yield* Effect.sleep("300 millis")
            yield* Fiber.interrupt(fiber)

            expect(responses).toHaveLength(2)
            const resp = responses[1] as Record<
              string,
              unknown
            >
            expect(resp["_tag"]).toBe("Exit")
            expect(resp["requestId"]).toBe("2")
            const exit = resp["exit"] as Record<
              string,
              unknown
            >
            expect(exit["_tag"]).toBe("Success")
            const value = exit["value"] as Record<
              string,
              unknown
            >
            const content = value["content"] as Array<
              Record<string, unknown>
            >
            expect(content[0]!["text"]).toBe(
              "multiline-ok"
            )
          })
        )
      )
    )
  })

  it("dies with Transport error on network failure", async () => {
    await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          // Port 1 is almost certainly not listening
          const protocol = yield* make({
            url: "http://127.0.0.1:1/mcp"
          })

          const exit = yield* protocol
            .send({
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
            .pipe(Effect.exit)

          expect(Exit.isFailure(exit)).toBe(true)
          if (Exit.isFailure(exit)) {
            const defects = Chunk.toReadonlyArray(
              Cause.defects(exit.cause)
            )
            expect(defects).toHaveLength(1)
            const err = defects[0] as {
              reason: string
              message: string
            }
            expect(err.reason).toBe("Transport")
            expect(err.message).toContain("POST failed")
          }
        })
      ).pipe(
        Effect.timeoutFail({
          duration: 10_000,
          onTimeout: () => new Error("Test timed out")
        })
      )
    )
  })

  it("decodes JSON-RPC error responses", async () => {
    await Effect.runPromise(
      withServer((url) =>
        Effect.scoped(
          Effect.gen(function* () {
            const protocol = yield* make({ url })

            // Init
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

            const responses: Array<unknown> = []
            const fiber = yield* Effect.fork(
              protocol.run((msg) => {
                responses.push(msg)
                return Effect.void
              })
            )

            yield* Effect.sleep("200 millis")

            // Call unknown-tool → server returns JSON-RPC
            // error {code: -32601, message: "Tool not found"}
            yield* protocol.send({
              _tag: "Request",
              id: "2",
              tag: "tools/call",
              payload: {
                name: "unknown-tool",
                arguments: {}
              },
              headers: []
            } as never)

            yield* Effect.sleep("300 millis")
            yield* Fiber.interrupt(fiber)

            expect(responses).toHaveLength(2)
            const errResp = responses[1] as Record<
              string,
              unknown
            >
            expect(errResp["_tag"]).toBe("Exit")
            expect(errResp["requestId"]).toBe("2")
            const exit = errResp["exit"] as Record<
              string,
              unknown
            >
            expect(exit["_tag"]).toBe("Failure")
            const cause = exit["cause"] as Record<
              string,
              unknown
            >
            expect(cause["_tag"]).toBe("Fail")
            const error = cause["error"] as Record<
              string,
              unknown
            >
            expect(error["code"]).toBe(-32601)
            expect(error["message"]).toBe("Tool not found")
          })
        )
      )
    )
  })

  it("integrates with McpClientProtocol router", async () => {
    await Effect.runPromise(
      withServer((url) =>
        Effect.scoped(
          Effect.gen(function* () {
            const rawProtocol = yield* make({ url })
            const router = yield* makeRouter(rawProtocol)

            // Send initialize through router
            yield* router.clientProtocol.send({
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

            const responses: Array<unknown> = []
            const fiber = yield* Effect.fork(
              router.clientProtocol.run((msg) => {
                responses.push(msg)
                return Effect.void
              })
            )

            yield* Effect.sleep("300 millis")

            // Ping via router
            yield* router.clientProtocol.send({
              _tag: "Request",
              id: "2",
              tag: "ping",
              payload: {},
              headers: []
            } as never)

            yield* Effect.sleep("300 millis")
            yield* Fiber.interrupt(fiber)

            expect(responses).toHaveLength(2)
            const ping = responses[1] as Record<
              string,
              unknown
            >
            expect(ping["_tag"]).toBe("Exit")
            expect(ping["requestId"]).toBe("2")
          })
        )
      )
    )
  })

  it("full stack: HttpTransport → McpClientProtocol → McpClient", async () => {
    await Effect.runPromise(
      withServer((url) =>
        Effect.scoped(
          Effect.gen(function* () {
            const transport = yield* make({ url })
            const router = yield* makeRouter(transport)
            const client = yield* makeClient(router, {
              clientInfo: {
                name: "http-test",
                version: "0.1.0"
              }
            })

            // Verify server info
            const info = yield* client.serverInfo
            const raw = info as unknown as Record<
              string,
              unknown
            >
            expect(raw["name"]).toBe("test-http")

            // List tools
            const tools = yield* client.listTools()
            const toolsRaw =
              tools as unknown as Record<
                string,
                unknown
              >
            const toolList = toolsRaw[
              "tools"
            ] as Array<Record<string, unknown>>
            expect(toolList).toHaveLength(1)
            expect(toolList[0]!["name"]).toBe("echo")

            // Call tool (SSE response path)
            const result = yield* client.callTool({
              name: "echo",
              arguments: { text: "full-stack" }
            })
            const resultRaw =
              result as unknown as Record<
                string,
                unknown
              >
            const content = resultRaw[
              "content"
            ] as Array<Record<string, unknown>>
            expect(content[0]!["text"]).toBe(
              "full-stack"
            )

            // Ping
            yield* client.ping()
          })
        )
      )
    )
  })
})
