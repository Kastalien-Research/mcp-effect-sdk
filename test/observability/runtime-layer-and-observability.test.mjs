import assert from "node:assert/strict"
import { test } from "node:test"

import { Deferred, Fiber, Mailbox, Ref, Stream } from "effect"
import * as Either from "effect/Either"
import * as Context from "effect/Context"
import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"
import { Tracer } from "effect"

import * as DevTools from "@effect/experimental/DevTools"
import * as DevToolsServer from "@effect/experimental/DevTools/Server"
import * as NodeSocketServer from "@effect/platform-node/NodeSocketServer"
import * as SocketServer from "@effect/platform/SocketServer"
import * as McpModern from "../../dist/McpModern.js"
import * as McpServer from "../../dist/server.js"
import * as StreamableHttpServerTransport from "../../dist/transport/StreamableHttpServerTransport.js"

import {
  validateDevToolsUrl as validateScriptDevToolsUrl,
  isDevToolsEnabled as isScriptDevToolsEnabled,
  makeDevToolsRuntimeLayer as makeScriptDevToolsRuntimeLayer
} from "../../scripts/lib/observability.mjs"
import {
  validateDevToolsUrl,
  isDevToolsEnabled,
  makeDevToolsRuntimeLayer
} from "../../dist/examples/internal/DevTools.js"

const isWebSocketBindUnavailable = (error) => {
  const messages = []
  const seen = new Set()
  let current = error

  while (current !== undefined && current !== null && typeof current === "object" && !seen.has(current)) {
    seen.add(current)
    if (typeof current.message === "string") {
      messages.push(current.message)
    }
    current = current.cause
  }

  const normalized = messages.join(" ").toLowerCase()

  return (
    normalized.includes("listen eperm") ||
    normalized.includes("operation not permitted") ||
    normalized.includes("eacces") ||
    normalized.includes("eaddrnotavail")
  )
}

const Probe = Context.GenericTag("mcp-effect-sdk/devtools/probe")

let probeLayerCreations = 0

const probeLayer = Layer.scoped(
  Probe,
  Effect.sync(() => {
    probeLayerCreations = probeLayerCreations + 1
    return {
      tag: "probe"
    }
  })
)

const request = async (handler, id) => {
  const response = await handler(
    new Request("http://localhost/mcp", {
      method: "POST",
      headers: {
        accept: "application/json, text/event-stream",
        [McpModern.MCP_PROTOCOL_VERSION_HEADER]: McpModern.MODERN_PROTOCOL_VERSION,
        "content-type": "application/json",
        [McpModern.MCP_METHOD_HEADER]: "tools/call",
        [McpModern.MCP_NAME_HEADER]: "probe"
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id,
        method: "tools/call",
        params: {
          name: "probe",
          arguments: {},
          _meta: {
            [McpModern.MCP_PROTOCOL_VERSION_META_KEY]: McpModern.MODERN_PROTOCOL_VERSION,
            [McpModern.MCP_CLIENT_CAPABILITIES_META_KEY]: {}
          }
        }
      })
    })
  )
  const body = await response.text()
  const payload = JSON.parse(body)
  const text = payload?.result?.content?.[0]?.text
  assert.equal(typeof text, "string")
  return text
}

test("toWebHandler merges runtimeLayer once for all requests", async () => {
  const server = Effect.runSync(
    McpServer.make({
      serverInfo: {
        name: "runtime-layer-test",
        version: "1.0.0"
      },
      supportedProtocolVersions: [McpModern.MODERN_PROTOCOL_VERSION],
      handlers: Effect.gen(function* () {
        yield* McpServer.registerTool({
          name: "probe",
          description: "Probe tool for runtime-layer construction",
          content: () => Effect.succeed("probe")
        })
      })
    })
  )

  const web = StreamableHttpServerTransport.toWebHandler(server, {
    path: "/mcp",
    runtimeLayer: probeLayer,
    enableJsonResponse: true
  })

  try {
    const first = await request(web.handler, 1)
    const second = await request(web.handler, 2)

    assert.equal(first, "probe")
    assert.equal(second, "probe")
    assert.equal(probeLayerCreations, 1)
  } finally {
    await web.dispose()
  }
})

test("DevTools URL parser accepts only ws and wss and rejects userinfo", () => {
  assert.equal(validateDevToolsUrl("ws://localhost:34437"), "ws://localhost:34437/")
  assert.equal(validateDevToolsUrl("wss://localhost:34437"), "wss://localhost:34437/")
  assert.throws(() => {
    validateDevToolsUrl("http://localhost:34437")
  })
  assert.throws(() => {
    validateDevToolsUrl("ws://user:pass@localhost:34437")
  })
  assert.throws(() => {
    validateDevToolsUrl("ftp://localhost:34437")
  })
})

test("Script DevTools URL parser enforces ws/wss and userinfo policy", () => {
  assert.equal(validateScriptDevToolsUrl("ws://localhost:1234"), "ws://localhost:1234/")
  assert.throws(() => {
    validateScriptDevToolsUrl("ws://alice:secret@localhost:1234")
  })
  assert.throws(() => {
    validateScriptDevToolsUrl("https://localhost:1234")
  })
})

test("Example DevTools helper disables tracing when env var is unset", () => {
  assert.equal(isDevToolsEnabled(undefined), false)
  assert.ok(makeDevToolsRuntimeLayer(undefined))
  assert.ok(makeDevToolsRuntimeLayer("ws://localhost:34437"))
})

test("Script DevTools helper disables tracing when env var is unset", () => {
  const original = process.env.MCP_EFFECT_DEVTOOLS_URL
  try {
    process.env.MCP_EFFECT_DEVTOOLS_URL = ""
    assert.equal(isScriptDevToolsEnabled(), false)
    assert.ok(makeScriptDevToolsRuntimeLayer())

    process.env.MCP_EFFECT_DEVTOOLS_URL = "ws://localhost:34437"
    assert.equal(isScriptDevToolsEnabled(), true)
    assert.equal(validateScriptDevToolsUrl(process.env.MCP_EFFECT_DEVTOOLS_URL), "ws://localhost:34437/")
    assert.ok(makeScriptDevToolsRuntimeLayer())
  } finally {
    if (original === undefined) {
      delete process.env.MCP_EFFECT_DEVTOOLS_URL
    } else {
      process.env.MCP_EFFECT_DEVTOOLS_URL = original
    }
  }
})

test("disabled DevTools helpers never trigger websocket construction or long startup delay", async () => {
  const originalDescriptor = Object.getOwnPropertyDescriptor(globalThis, "WebSocket")
  const originalSetTimeout = globalThis.setTimeout
  const originalEnv = process.env.MCP_EFFECT_DEVTOOLS_URL
  let websocketLookups = 0
  let longDelaySetTimeoutCalls = 0

  Object.defineProperty(globalThis, "WebSocket", {
    configurable: true,
    get() {
      websocketLookups += 1
      return class {
        constructor() {
          throw new Error("websocket construction is disabled for this assertion")
        }
      }
    },
    set() {
      // Keep assignment attempts non-fatal while this assertion runs.
    }
  })

  globalThis.setTimeout = (handler, timeout, ...rest) => {
    if (typeof timeout === "number" && timeout >= 750) {
      longDelaySetTimeoutCalls += 1
    }
    return originalSetTimeout(handler, timeout, ...rest)
  }

  try {
    process.env.MCP_EFFECT_DEVTOOLS_URL = ""
    const scriptLayer = makeScriptDevToolsRuntimeLayer()
    const program = Effect.sync(() => {
      websocketLookups += 0
    }).pipe(Effect.provide(scriptLayer))

    assert.ok(Layer.isLayer(scriptLayer))
    await Effect.runPromise(program)

    delete process.env.MCP_EFFECT_DEVTOOLS_URL
    const exampleLayer = makeDevToolsRuntimeLayer(undefined)
    const exampleProgram = Effect.sync(() => {
      websocketLookups += 0
    }).pipe(Effect.provide(exampleLayer))
    await Effect.runPromise(exampleProgram)

    assert.equal(websocketLookups, 0, "disabled DevTools paths must not read WebSocket at runtime")
    assert.equal(longDelaySetTimeoutCalls, 0, "disabled DevTools paths should not schedule startup-delay timers")
  } finally {
    if (originalEnv === undefined) {
      delete process.env.MCP_EFFECT_DEVTOOLS_URL
    } else {
      process.env.MCP_EFFECT_DEVTOOLS_URL = originalEnv
    }
    if (originalDescriptor === undefined) {
      delete globalThis.WebSocket
    } else {
      Object.defineProperty(globalThis, "WebSocket", originalDescriptor)
    }
    globalThis.setTimeout = originalSetTimeout
  }
})

test("toWebHandler uses caller-provided tracer runtime layer", async () => {
  const collected = []
  const tracerLayer = Layer.setTracer(
    Tracer.make({
      span: (name, parent, context, links, startTime, kind, options = {}) => {
        const attributes = new Map(Object.entries(options.attributes ?? {}))
        return {
          _tag: "Span",
          name,
          spanId: "span",
          traceId: "trace",
          parent,
          context,
          status: {
            _tag: "Started",
            startTime
          },
          attributes,
          links,
          sampled: true,
          kind,
          attribute: (key, value) => {
            attributes.set(key, value)
          },
          event: () => {},
          addLinks: () => {},
          end: () => {
            collected.push(name)
          }
        }
      },
      context: (effect) => effect()
    })
  )

  const server = Effect.runSync(
    McpServer.make({
      serverInfo: {
        name: "runtime-layer-tracer-test",
        version: "1.0.0"
      },
      supportedProtocolVersions: [McpModern.MODERN_PROTOCOL_VERSION],
      handlers: Effect.gen(function* () {
        yield* McpServer.registerTool({
          name: "probe",
          description: "Probe tool for tracer propagation",
          content: () => Effect.succeed("probe")
        })
      })
    })
  )

  const web = StreamableHttpServerTransport.toWebHandler(server, {
    path: "/mcp",
    runtimeLayer: tracerLayer,
    enableJsonResponse: true
  })

  try {
    const responseText = await request(web.handler, 3)
    assert.equal(responseText, "probe")
    assert.ok(collected.includes("mcp.transport.receive"), "runtimeLayer tracer should receive transport receive spans")
    assert.ok(collected.includes("mcp.server.dispatch"), "runtimeLayer tracer should receive server dispatch spans")
  } finally {
    await web.dispose()
  }
})

test("DevTools integration sends started and ended spans and flushes on dispose", async () => {
  const spanName = "mcp.tests.devtools.integration"
  const { skipped, started, ended } = await Effect.runPromise(
    Effect.gen(function* () {
      const started = yield* Deferred.make()
      const ended = yield* Deferred.make()
      const observedSpanId = yield* Ref.make(undefined)

      const maybeServer = yield* Effect.either(NodeSocketServer.makeWebSocket({ host: "127.0.0.1", port: 0 }))
      if (Either.isLeft(maybeServer)) {
        if (isWebSocketBindUnavailable(maybeServer.left)) {
          return { skipped: true }
        }
        throw maybeServer.left
      }

      const server = maybeServer.right
      if (server.address._tag !== "TcpAddress") {
        throw new Error("expected websocket server to use TCP address")
      }

      const wsUrl = `ws://127.0.0.1:${server.address.port}`
      const devToolsServer = DevToolsServer.run((client) =>
        Mailbox.toStream(client.queue).pipe(
          Stream.tap((request) =>
            Effect.gen(function* () {
              if (request._tag !== "Span" || request.name !== spanName) return

              const currentSpanId = yield* Ref.get(observedSpanId)

              if (request.status._tag === "Started" && currentSpanId === undefined) {
                yield* Ref.set(observedSpanId, request.spanId)
                yield* Deferred.succeed(started, request)
              } else if (request.status._tag === "Ended" && request.spanId === currentSpanId) {
                yield* Deferred.succeed(ended, request)
              }
            })
          ),
          Stream.runDrain
        )
      ).pipe(Effect.provide(Layer.succeed(SocketServer.SocketServer, server)))
      const serverFiber = yield* Effect.fork(devToolsServer)

      const tracedProgram = Effect.withSpan(spanName, { captureStackTrace: false })(Effect.never).pipe(
        Effect.provide(DevTools.layer(wsUrl))
      )
      const tracedFiber = yield* Effect.fork(tracedProgram)

      try {
        const startedSpan = yield* Deferred.await(started).pipe(
          Effect.timeoutFail({
            duration: "5 seconds",
            onTimeout: () => new Error("no started span observed from DevTools")
          })
        )

        yield* Fiber.interrupt(tracedFiber)

        const endedSpan = yield* Deferred.await(ended).pipe(
          Effect.timeoutFail({
            duration: "5 seconds",
            onTimeout: () => new Error("no ended span observed from DevTools")
          })
        )
        return {
          skipped: false,
          started: startedSpan,
          ended: endedSpan
        }
      } finally {
        yield* Effect.either(Fiber.interrupt(tracedFiber))
        yield* Effect.either(Fiber.interrupt(serverFiber))
      }
    }).pipe(Effect.scoped)
  )

  if (skipped) {
    return
  }

  assert.equal(started.status._tag, "Started")
  assert.equal(ended.status._tag, "Ended")
  assert.equal(typeof started.status.startTime, "bigint")
  assert.equal(typeof ended.status.startTime, "bigint")
  assert.equal(typeof ended.status.endTime, "bigint")
  assert.equal(ended.status.endTime > ended.status.startTime, true)
  assert.equal(started.spanId, ended.spanId)
  assert.equal(started.traceId, ended.traceId)
})

test("DevTools integration sends started and ended spans on normal completion", async () => {
  const spanName = "mcp.tests.devtools.completion"
  const { skipped, started, ended } = await Effect.runPromise(
    Effect.gen(function* () {
      const started = yield* Deferred.make()
      const ended = yield* Deferred.make()
      const observedSpanId = yield* Ref.make(undefined)

      const maybeServer = yield* Effect.either(NodeSocketServer.makeWebSocket({ host: "127.0.0.1", port: 0 }))
      if (Either.isLeft(maybeServer)) {
        if (isWebSocketBindUnavailable(maybeServer.left)) {
          return { skipped: true }
        }
        throw maybeServer.left
      }

      const server = maybeServer.right
      if (server.address._tag !== "TcpAddress") {
        throw new Error("expected websocket server to use TCP address")
      }

      const wsUrl = `ws://127.0.0.1:${server.address.port}`
      const devToolsServer = DevToolsServer.run((client) =>
        Mailbox.toStream(client.queue).pipe(
          Stream.tap((request) =>
            Effect.gen(function* () {
              if (request._tag !== "Span" || request.name !== spanName) return

              const currentSpanId = yield* Ref.get(observedSpanId)

              if (request.status._tag === "Started" && currentSpanId === undefined) {
                yield* Ref.set(observedSpanId, request.spanId)
                yield* Deferred.succeed(started, request)
              } else if (request.status._tag === "Ended" && request.spanId === currentSpanId) {
                yield* Deferred.succeed(ended, request)
              }
            })
          ),
          Stream.runDrain
        )
      ).pipe(Effect.provide(Layer.succeed(SocketServer.SocketServer, server)))
      const serverFiber = yield* Effect.fork(devToolsServer)
      let completedFiber

      try {
        const completed = Effect.withSpan(spanName, { captureStackTrace: false })(Effect.sleep("50 millis")).pipe(
          Effect.provide(DevTools.layer(wsUrl))
        )
        completedFiber = yield* Effect.fork(completed)

        const startedSpan = yield* Deferred.await(started).pipe(
          Effect.timeoutFail({
            duration: "5 seconds",
            onTimeout: () => new Error("no started span observed from DevTools")
          })
        )
        yield* Fiber.join(completedFiber).pipe(Effect.either)

        const endedSpan = yield* Deferred.await(ended).pipe(
          Effect.timeoutFail({
            duration: "5 seconds",
            onTimeout: () => new Error("no ended span observed from DevTools")
          })
        )

        return {
          skipped: false,
          started: startedSpan,
          ended: endedSpan
        }
      } finally {
        if (completedFiber !== undefined) {
          yield* Effect.either(Fiber.interrupt(completedFiber))
        }
        yield* Effect.either(Fiber.interrupt(serverFiber))
      }
    }).pipe(Effect.scoped)
  )

  if (skipped) {
    return
  }

  assert.equal(started.status._tag, "Started")
  assert.equal(ended.status._tag, "Ended")
  assert.equal(typeof started.status.startTime, "bigint")
  assert.equal(typeof ended.status.startTime, "bigint")
  assert.equal(typeof ended.status.endTime, "bigint")
  assert.equal(ended.status.endTime > ended.status.startTime, true)
  assert.equal(started.spanId, ended.spanId)
  assert.equal(started.traceId, ended.traceId)
})
