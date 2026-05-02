import { describe, expect, it } from "vitest"
import { Effect } from "effect"
import type { RpcClientError } from "@effect/rpc/RpcClientError"
import {
  makeInboundDispatcher,
  outbound
} from "./McpNotifications.js"
import type { IncomingNotification } from "./McpClientProtocol.js"

describe("McpNotifications.inbound", () => {
  it("dispatches to registered handler", async () => {
    const received: Array<unknown> = []

    await Effect.runPromise(
      Effect.gen(function* () {
        const dispatcher = yield* makeInboundDispatcher()

        yield* dispatcher.on(
          "notifications/tools/list_changed",
          (payload) => {
            received.push(payload)
            return Effect.void
          }
        )

        yield* dispatcher.dispatch({
          tag: "notifications/tools/list_changed",
          payload: {}
        })
      })
    )

    expect(received).toHaveLength(1)
  })

  it("routes by method name", async () => {
    const tools: Array<unknown> = []
    const logs: Array<unknown> = []

    await Effect.runPromise(
      Effect.gen(function* () {
        const dispatcher = yield* makeInboundDispatcher()

        yield* dispatcher.on(
          "notifications/tools/list_changed",
          (payload) => {
            tools.push(payload)
            return Effect.void
          }
        )
        yield* dispatcher.on(
          "notifications/message",
          (payload) => {
            logs.push(payload)
            return Effect.void
          }
        )

        yield* dispatcher.dispatch({
          tag: "notifications/tools/list_changed",
          payload: {}
        })
        yield* dispatcher.dispatch({
          tag: "notifications/message",
          payload: { level: "info", data: "hello" }
        })
        yield* dispatcher.dispatch({
          tag: "notifications/resources/list_changed",
          payload: { uri: "file://a" }
        })
      })
    )

    expect(tools).toHaveLength(1)
    expect(logs).toHaveLength(1)
    expect(
      (logs[0] as Record<string, unknown>)["level"]
    ).toBe("info")
  })

  it("silently drops unhandled notifications", async () => {
    await Effect.runPromise(
      Effect.gen(function* () {
        const dispatcher = yield* makeInboundDispatcher()

        // Should not throw
        yield* dispatcher.dispatch({
          tag: "notifications/unknown/method",
          payload: { some: "data" }
        })
      })
    )
  })

  it("invokes fallback for unhandled notifications", async () => {
    const fallbackReceived: Array<IncomingNotification> = []

    await Effect.runPromise(
      Effect.gen(function* () {
        const dispatcher = yield* makeInboundDispatcher()

        yield* dispatcher.onFallback((notification) => {
          fallbackReceived.push(notification)
          return Effect.void
        })

        yield* dispatcher.dispatch({
          tag: "notifications/unknown/method",
          payload: { x: 1 }
        })
      })
    )

    expect(fallbackReceived).toHaveLength(1)
    expect(fallbackReceived[0]?.tag).toBe(
      "notifications/unknown/method"
    )
  })

  it("prefers specific handler over fallback", async () => {
    const specific: Array<unknown> = []
    const fallback: Array<unknown> = []

    await Effect.runPromise(
      Effect.gen(function* () {
        const dispatcher = yield* makeInboundDispatcher()

        yield* dispatcher.on(
          "notifications/message",
          (payload) => {
            specific.push(payload)
            return Effect.void
          }
        )
        yield* dispatcher.onFallback((n) => {
          fallback.push(n)
          return Effect.void
        })

        yield* dispatcher.dispatch({
          tag: "notifications/message",
          payload: { level: "info", data: "hi" }
        })
      })
    )

    expect(specific).toHaveLength(1)
    expect(fallback).toHaveLength(0)
  })

  it("removes handler with off()", async () => {
    const received: Array<unknown> = []

    await Effect.runPromise(
      Effect.gen(function* () {
        const dispatcher = yield* makeInboundDispatcher()

        yield* dispatcher.on(
          "notifications/progress",
          (payload) => {
            received.push(payload)
            return Effect.void
          }
        )

        yield* dispatcher.dispatch({
          tag: "notifications/progress",
          payload: { progress: 50 }
        })

        yield* dispatcher.off("notifications/progress")

        yield* dispatcher.dispatch({
          tag: "notifications/progress",
          payload: { progress: 100 }
        })
      })
    )

    expect(received).toHaveLength(1)
  })

  it("replaces handler on duplicate registration", async () => {
    const first: Array<unknown> = []
    const second: Array<unknown> = []

    await Effect.runPromise(
      Effect.gen(function* () {
        const dispatcher = yield* makeInboundDispatcher()

        yield* dispatcher.on(
          "notifications/message",
          (payload) => {
            first.push(payload)
            return Effect.void
          }
        )
        yield* dispatcher.on(
          "notifications/message",
          (payload) => {
            second.push(payload)
            return Effect.void
          }
        )

        yield* dispatcher.dispatch({
          tag: "notifications/message",
          payload: { level: "warn", data: "test" }
        })
      })
    )

    expect(first).toHaveLength(0)
    expect(second).toHaveLength(1)
  })
})

describe("McpNotifications.outbound", () => {
  function makeMockProtocol() {
    const sent: Array<unknown> = []
    const protocol = {
      send: (msg: unknown) => {
        sent.push(msg)
        return Effect.void as Effect.Effect<
          void,
          RpcClientError
        >
      },
      run: () => Effect.never,
      supportsAck: false,
      supportsTransferables: false
    }
    return { protocol, sent }
  }

  it("sends cancelled notification", async () => {
    const { protocol, sent } = makeMockProtocol()
    const notifications = outbound(protocol)

    await Effect.runPromise(
      notifications.sendCancelled({
        requestId: "42",
        reason: "user abort"
      })
    )

    expect(sent).toHaveLength(1)
    const msg = sent[0] as Record<string, unknown>
    expect(msg["tag"]).toBe("notifications/cancelled")
    expect(msg["id"]).toBe("")
  })

  it("sends initialized notification", async () => {
    const { protocol, sent } = makeMockProtocol()
    const notifications = outbound(protocol)

    await Effect.runPromise(notifications.sendInitialized())

    expect(sent).toHaveLength(1)
    const msg = sent[0] as Record<string, unknown>
    expect(msg["tag"]).toBe("notifications/initialized")
  })

  it("sends progress notification", async () => {
    const { protocol, sent } = makeMockProtocol()
    const notifications = outbound(protocol)

    await Effect.runPromise(
      notifications.sendProgress({
        progressToken: "tok-1",
        progress: 50,
        total: 100
      })
    )

    expect(sent).toHaveLength(1)
    const msg = sent[0] as Record<string, unknown>
    expect(msg["tag"]).toBe("notifications/progress")
  })

  it("sends roots list changed notification", async () => {
    const { protocol, sent } = makeMockProtocol()
    const notifications = outbound(protocol)

    await Effect.runPromise(
      notifications.sendRootsListChanged()
    )

    expect(sent).toHaveLength(1)
    const msg = sent[0] as Record<string, unknown>
    expect(msg["tag"]).toBe(
      "notifications/roots/list_changed"
    )
  })
})
