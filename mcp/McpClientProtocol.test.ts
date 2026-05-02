import { describe, expect, it } from "vitest"
import { Effect, Fiber, Queue } from "effect"
import type * as RpcClient from "@effect/rpc/RpcClient"
import type { RpcClientError } from "@effect/rpc/RpcClientError"
import { make } from "./McpClientProtocol.js"
import type {
  IncomingNotification,
  IncomingServerRequest
} from "./McpClientProtocol.js"

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

/**
 * Create a mock transport Protocol that feeds canned messages
 * to the run callback, then blocks forever.
 */
function makeTestProtocol(
  messages: ReadonlyArray<Record<string, unknown>>
): {
  protocol: RpcClient.Protocol["Type"]
  sent: Array<unknown>
} {
  const sent: Array<unknown> = []
  const protocol: RpcClient.Protocol["Type"] = {
    send: (msg: unknown) => {
      sent.push(msg)
      return Effect.void as Effect.Effect<void, RpcClientError>
    },
    supportsAck: false,
    supportsTransferables: false,
    run: (f) =>
      Effect.gen(function* () {
        for (const msg of messages) {
          yield* f(msg as never)
        }
        return yield* Effect.never
      })
  }
  return { protocol, sent }
}

function runWithTimeout<A, E>(
  effect: Effect.Effect<A, E>,
  ms = 500
): Promise<A> {
  return Effect.runPromise(
    effect.pipe(
      Effect.timeoutFail({
        duration: ms,
        onTimeout: () => new Error("Test timed out")
      })
    )
  )
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("McpClientProtocol", () => {
  it("routes Exit messages to clientProtocol handler", async () => {
    const exitMsg = {
      _tag: "Exit",
      requestId: "1",
      exit: { _tag: "Success", value: { tools: [] } }
    }
    const { protocol } = makeTestProtocol([exitMsg])

    const received: Array<unknown> = []

    await runWithTimeout(
      Effect.gen(function* () {
        const router = yield* make(protocol)

        // Start the run loop — it calls f for each message
        const fiber = yield* Effect.fork(
          router.clientProtocol.run((msg) => {
            received.push(msg)
            return Effect.void
          })
        )

        // Give the loop time to process
        yield* Effect.sleep("50 millis")
        yield* Fiber.interrupt(fiber)
      })
    )

    expect(received).toHaveLength(1)
    const msg = received[0] as Record<string, unknown>
    expect(msg["_tag"]).toBe("Exit")
    expect(msg["requestId"]).toBe("1")
  })

  it("routes server requests to serverRequests queue", async () => {
    const serverRequest = {
      _tag: "Request",
      id: "10",
      tag: "sampling/createMessage",
      payload: { messages: [], maxTokens: 100 },
      headers: []
    }
    const { protocol } = makeTestProtocol([serverRequest])

    const result = await runWithTimeout(
      Effect.gen(function* () {
        const router = yield* make(protocol)
        const fiber = yield* Effect.fork(
          router.clientProtocol.run(() => Effect.void)
        )
        yield* Effect.sleep("50 millis")

        const req = yield* Queue.poll(
          router.serverRequests as Queue.Queue<IncomingServerRequest>
        )
        yield* Fiber.interrupt(fiber)
        return req
      })
    )

    expect(result._tag).toBe("Some")
    if (result._tag === "Some") {
      expect(result.value.id).toBe("10")
      expect(result.value.tag).toBe("sampling/createMessage")
      expect(result.value.payload).toEqual({
        messages: [],
        maxTokens: 100
      })
    }
  })

  it("routes notifications to notifications queue", async () => {
    const notification = {
      _tag: "Request",
      id: "",
      tag: "notifications/tools/list_changed",
      payload: {},
      headers: []
    }
    const { protocol } = makeTestProtocol([notification])

    const result = await runWithTimeout(
      Effect.gen(function* () {
        const router = yield* make(protocol)
        const fiber = yield* Effect.fork(
          router.clientProtocol.run(() => Effect.void)
        )
        yield* Effect.sleep("50 millis")

        const notif = yield* Queue.poll(
          router.notifications as Queue.Queue<IncomingNotification>
        )
        yield* Fiber.interrupt(fiber)
        return notif
      })
    )

    expect(result._tag).toBe("Some")
    if (result._tag === "Some") {
      expect(result.value.tag).toBe(
        "notifications/tools/list_changed"
      )
    }
  })

  it("routes ping requests to serverRequests queue", async () => {
    // Server can send ping as a request
    const pingRequest = {
      _tag: "Request",
      id: "99",
      tag: "ping",
      payload: {},
      headers: []
    }
    const { protocol } = makeTestProtocol([pingRequest])

    const result = await runWithTimeout(
      Effect.gen(function* () {
        const router = yield* make(protocol)
        const fiber = yield* Effect.fork(
          router.clientProtocol.run(() => Effect.void)
        )
        yield* Effect.sleep("50 millis")

        const req = yield* Queue.poll(
          router.serverRequests as Queue.Queue<IncomingServerRequest>
        )
        yield* Fiber.interrupt(fiber)
        return req
      })
    )

    expect(result._tag).toBe("Some")
    if (result._tag === "Some") {
      expect(result.value.tag).toBe("ping")
    }
  })

  it("demuxes mixed messages correctly", async () => {
    const messages = [
      {
        _tag: "Exit",
        requestId: "1",
        exit: { _tag: "Success", value: {} }
      },
      {
        _tag: "Request",
        id: "5",
        tag: "sampling/createMessage",
        payload: { messages: [] },
        headers: []
      },
      {
        _tag: "Request",
        id: "",
        tag: "notifications/resources/list_changed",
        payload: {},
        headers: []
      },
      {
        _tag: "Exit",
        requestId: "2",
        exit: { _tag: "Success", value: { prompts: [] } }
      }
    ]
    const { protocol } = makeTestProtocol(messages)

    const exitMessages: Array<unknown> = []

    const result = await runWithTimeout(
      Effect.gen(function* () {
        const router = yield* make(protocol)
        const fiber = yield* Effect.fork(
          router.clientProtocol.run((msg) => {
            exitMessages.push(msg)
            return Effect.void
          })
        )
        yield* Effect.sleep("50 millis")

        const reqCount = yield* Queue.size(
          router.serverRequests as Queue.Queue<IncomingServerRequest>
        )
        const notifCount = yield* Queue.size(
          router.notifications as Queue.Queue<IncomingNotification>
        )
        yield* Fiber.interrupt(fiber)
        return { reqCount, notifCount }
      })
    )

    expect(exitMessages).toHaveLength(2)
    expect(result.reqCount).toBe(1)
    expect(result.notifCount).toBe(1)
  })

  it("respond sends success via transport", async () => {
    const { protocol, sent } = makeTestProtocol([])

    await runWithTimeout(
      Effect.gen(function* () {
        const router = yield* make(protocol)
        yield* router.respond("42", { content: [], model: "test" })
      })
    )

    expect(sent).toHaveLength(1)
    const msg = sent[0] as Record<string, unknown>
    expect(msg["_tag"]).toBe("Exit")
    expect(msg["requestId"]).toBe("42")
    const exit = msg["exit"] as Record<string, unknown>
    expect(exit["_tag"]).toBe("Success")
    expect(exit["value"]).toEqual({ content: [], model: "test" })
  })

  it("respondError sends error via transport", async () => {
    const { protocol, sent } = makeTestProtocol([])

    await runWithTimeout(
      Effect.gen(function* () {
        const router = yield* make(protocol)
        yield* router.respondError("42", {
          code: -32601,
          message: "Method not found"
        })
      })
    )

    expect(sent).toHaveLength(1)
    const msg = sent[0] as Record<string, unknown>
    expect(msg["_tag"]).toBe("Exit")
    const exit = msg["exit"] as Record<string, unknown>
    expect(exit["_tag"]).toBe("Failure")
    const cause = exit["cause"] as Record<string, unknown>
    expect(cause["error"]).toEqual({
      code: -32601,
      message: "Method not found"
    })
  })

  it("ignores unknown request methods", async () => {
    const unknown = {
      _tag: "Request",
      id: "1",
      tag: "unknown/method",
      payload: {},
      headers: []
    }
    const { protocol } = makeTestProtocol([unknown])

    const exitMessages: Array<unknown> = []

    const result = await runWithTimeout(
      Effect.gen(function* () {
        const router = yield* make(protocol)
        const fiber = yield* Effect.fork(
          router.clientProtocol.run((msg) => {
            exitMessages.push(msg)
            return Effect.void
          })
        )
        yield* Effect.sleep("50 millis")

        const reqCount = yield* Queue.size(
          router.serverRequests as Queue.Queue<IncomingServerRequest>
        )
        const notifCount = yield* Queue.size(
          router.notifications as Queue.Queue<IncomingNotification>
        )
        yield* Fiber.interrupt(fiber)
        return { reqCount, notifCount }
      })
    )

    // Unknown method should not appear anywhere
    expect(exitMessages).toHaveLength(0)
    expect(result.reqCount).toBe(0)
    expect(result.notifCount).toBe(0)
  })
})
