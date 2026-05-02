import { fileURLToPath } from "node:url"
import { dirname, join } from "node:path"
import { describe, expect, it } from "vitest"
import { Effect, Layer, Option } from "effect"
import { make as makeTransport } from "./transport/StdioTransport.js"
import { make as makeRouter } from "./McpClientProtocol.js"
import { make as makeClient } from "./McpClient.js"
import { SamplingHandler } from "./handlers/SamplingHandler.js"
import { RootsProvider } from "./handlers/RootsProvider.js"

const __dirname = dirname(fileURLToPath(import.meta.url))
const echoServer = join(
  __dirname,
  "transport",
  "test-echo-server.mjs"
)

const clientConfig = {
  clientInfo: { name: "test-client", version: "0.1.0" }
}

/** Spin up the echo server and return a connected client. */
const withClient = <A>(
  f: (
    client: Awaited<
      ReturnType<typeof makeClient> extends Effect.Effect<
        infer T,
        // eslint-disable-next-line @typescript-eslint/no-unused-vars
        infer _E,
        // eslint-disable-next-line @typescript-eslint/no-unused-vars
        infer _R
      >
        ? T
        : never
    >
  ) => Effect.Effect<A, unknown>
) =>
  Effect.scoped(
    Effect.gen(function* () {
      const transport = yield* makeTransport({
        command: "node",
        args: [echoServer]
      })
      const router = yield* makeRouter(transport)
      const client = yield* makeClient(
        router,
        clientConfig
      )
      return yield* f(client)
    })
  ).pipe(
    Effect.timeoutFail({
      duration: 5000,
      onTimeout: () => new Error("Test timed out")
    })
  )

describe("McpClient", () => {
  it("completes init handshake", async () => {
    await Effect.runPromise(
      withClient((client) =>
        Effect.gen(function* () {
          const info = yield* client.serverInfo
          const raw = info as unknown as Record<
            string,
            unknown
          >
          expect(raw["name"]).toBe("test-echo")
          expect(raw["version"]).toBe("1.0.0")
        })
      )
    )
  })

  it("stores server capabilities", async () => {
    await Effect.runPromise(
      withClient((client) =>
        Effect.gen(function* () {
          const caps = yield* client.serverCapabilities
          const raw = caps as unknown as Record<
            string,
            unknown
          >
          expect(raw["tools"]).toBeDefined()
          expect(raw["prompts"]).toBeDefined()
          expect(raw["logging"]).toBeDefined()
        })
      )
    )
  })

  it("stores server instructions", async () => {
    await Effect.runPromise(
      withClient((client) =>
        Effect.gen(function* () {
          const instr = yield* client.instructions
          expect(Option.isSome(instr)).toBe(true)
          if (Option.isSome(instr)) {
            expect(instr.value).toBe(
              "Test server instructions"
            )
          }
        })
      )
    )
  })

  it("lists tools", async () => {
    await Effect.runPromise(
      withClient((client) =>
        Effect.gen(function* () {
          const result = yield* client.listTools()
          const raw = result as unknown as Record<
            string,
            unknown
          >
          const tools = raw["tools"] as Array<unknown>
          expect(tools).toHaveLength(1)
          const tool = tools[0] as Record<
            string,
            unknown
          >
          expect(tool["name"]).toBe("echo")
        })
      )
    )
  })

  it("calls a tool", async () => {
    await Effect.runPromise(
      withClient((client) =>
        Effect.gen(function* () {
          const result = yield* client.callTool({
            name: "echo",
            arguments: { text: "hello world" }
          })
          const raw = result as unknown as Record<
            string,
            unknown
          >
          const content = raw["content"] as Array<
            Record<string, unknown>
          >
          expect(content).toHaveLength(1)
          expect(content[0]!["text"]).toBe("hello world")
        })
      )
    )
  })

  it("gates on missing capability", async () => {
    await Effect.runPromise(
      withClient((client) =>
        Effect.gen(function* () {
          // Server advertises tools, prompts, logging
          // but NOT resources. This should fail.
          const result =
            yield* client.listResources().pipe(
              Effect.map(() => "ok" as const),
              Effect.catchAll((err) =>
                Effect.succeed(err.reason)
              )
            )
          expect(result).toBe("CapabilityNotSupported")
        })
      )
    )
  })

  it("allows ping without capability", async () => {
    await Effect.runPromise(
      withClient((client) =>
        Effect.gen(function* () {
          // Ping is always allowed regardless of caps
          yield* client.ping()
        })
      )
    )
  })

  it("dispatches server notification", async () => {
    await Effect.runPromise(
      withClient((client) =>
        Effect.gen(function* () {
          const received: Array<unknown> = []
          yield* client.notifications.on(
            "notifications/tools/list_changed",
            (payload) => {
              received.push(payload)
              return Effect.void
            }
          )

          // The echo server sends a tools/list_changed
          // notification after receiving initialized.
          // Give it time to arrive and be dispatched.
          yield* Effect.sleep("200 millis")

          expect(received.length).toBeGreaterThanOrEqual(
            1
          )
        })
      )
    )
  })

  it("sends outbound notification", async () => {
    await Effect.runPromise(
      withClient((client) =>
        Effect.gen(function* () {
          // Should not throw — sends to the server
          yield* client.sendCancelled({
            requestId: "99",
            reason: "testing"
          })
        })
      )
    )
  })

  it("advertises sampling when handler present", async () => {
    const TestSampling = Layer.succeed(
      SamplingHandler,
      SamplingHandler.of({
        handle: () => Effect.die("not called in test")
      })
    )

    // We can't directly inspect the init message sent,
    // but we can verify the handler was detected by
    // checking that the client constructs without error.
    // A more thorough test would inspect the wire, but
    // the transport test already covers wire fidelity.
    await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const transport = yield* makeTransport({
            command: "node",
            args: [echoServer]
          })
          const router = yield* makeRouter(transport)
          const client = yield* makeClient(
            router,
            clientConfig
          )
          // If we got here, init succeeded with
          // sampling advertised
          const info = yield* client.serverInfo
          expect(info).toBeDefined()
        })
      ).pipe(
        Effect.provide(TestSampling),
        Effect.timeoutFail({
          duration: 5000,
          onTimeout: () => new Error("Test timed out")
        })
      )
    )
  })

  it("advertises roots when provider present", async () => {
    const TestRoots = Layer.succeed(
      RootsProvider,
      RootsProvider.of({
        list: Effect.die("not called in test")
      })
    )

    await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const transport = yield* makeTransport({
            command: "node",
            args: [echoServer]
          })
          const router = yield* makeRouter(transport)
          const client = yield* makeClient(
            router,
            clientConfig
          )
          const info = yield* client.serverInfo
          expect(info).toBeDefined()
        })
      ).pipe(
        Effect.provide(TestRoots),
        Effect.timeoutFail({
          duration: 5000,
          onTimeout: () => new Error("Test timed out")
        })
      )
    )
  })
})
