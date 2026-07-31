import assert from "node:assert/strict"
import { test } from "node:test"
import * as Deferred from "effect/Deferred"
import * as Effect from "effect/Effect"
import * as Either from "effect/Either"
import * as Queue from "effect/Queue"
import * as Ref from "effect/Ref"
import * as Schema from "effect/Schema"
import * as Stream from "effect/Stream"
import * as Deprecated from "../../dist/deprecated.js"
import * as McpClient from "../../dist/McpClient.js"
import * as McpModern from "../../dist/McpModern.js"
import * as McpServer from "../../dist/McpServer.js"
import * as HttpServer from "../../dist/transport/StreamableHttpServerTransport.js"
import * as Generated from "../../dist/generated/mcp/2026-07-28/McpSchema.generated.js"

const protocolVersion = McpModern.MODERN_PROTOCOL_VERSION
const toolName = "logging-probe"

const requestMeta = (logLevel) => ({
  "io.modelcontextprotocol/clientCapabilities": {},
  "io.modelcontextprotocol/protocolVersion": protocolVersion,
  ...(logLevel === undefined ? {} : { "io.modelcontextprotocol/logLevel": logLevel })
})

const callToolRequest = (id, logLevel) => ({
  _tag: "Request",
  jsonrpc: "2.0",
  id,
  method: "tools/call",
  params: {
    name: toolName,
    arguments: {},
    _meta: requestMeta(logLevel)
  }
})

const discoverRequest = (id) => ({
  _tag: "Request",
  jsonrpc: "2.0",
  id,
  method: "server/discover",
  params: { _meta: requestMeta() }
})

const makeLoggingServer = (logging, calls = { count: 0 }) =>
  Effect.runPromise(
    McpServer.make({
      serverInfo: { name: "runtime-compliance", version: "1.0.0" },
      ...(logging === undefined ? {} : { logging }),
      handlers: McpServer.registerTool({
        name: toolName,
        content: () =>
          Effect.gen(function* () {
            calls.count += 1
            yield* Deprecated.sendLoggingMessage({ level: "debug", data: "debug-message" })
            yield* Deprecated.sendLoggingMessage({ level: "warning", data: "warning-message" })
            yield* Deprecated.sendLoggingMessage({ level: "error", data: "error-message" })
            return "done"
          })
      })
    })
  )

const dispatchFrames = (server, request) =>
  Effect.runPromise(
    Effect.scoped(
      Effect.gen(function* () {
        const output = yield* Queue.unbounded()
        const dispatcher = yield* McpServer.makeDispatcher({
          send: (message) => Queue.offer(output, message).pipe(Effect.asVoid),
          transport: "stdio"
        }).pipe(Effect.provideService(McpServer.McpServer, server))
        yield* dispatcher.accept(request)
        const frames = []
        while (true) {
          const frame = yield* Queue.take(output)
          frames.push(frame)
          if (frame._tag !== "Notification") return frames
        }
      })
    )
  )

test("generated request metadata and discovery requiredness drive the Modern façade", () => {
  const metadata = McpModern.makeModernRequestMeta({})
  assert.equal(Object.hasOwn(metadata, "io.modelcontextprotocol/clientInfo"), false)
  assert.deepEqual(
    Schema.encodeSync(Generated.RequestMetaObject)(Schema.decodeUnknownSync(Generated.RequestMetaObject)(metadata)),
    {
      "io.modelcontextprotocol/clientCapabilities": {},
      "io.modelcontextprotocol/protocolVersion": protocolVersion
    }
  )

  const discovered = McpModern.makeDiscoverResult({ capabilities: new Generated.ServerCapabilities({}) })
  assert.equal(discovered.ttlMs, 0)
  assert.equal(discovered.cacheScope, "private")
  const encoded = Schema.encodeSync(Generated.DiscoverResult)(discovered)
  assert.equal(encoded.ttlMs, 0)
  assert.equal(encoded.cacheScope, "private")
  assert.equal(encoded.resultType, "complete")
})

test("logging is opt-in, request-owned, threshold-filtered, and never published to subscriptions", async () => {
  const enabled = await makeLoggingServer(true)
  const disabled = await makeLoggingServer()

  const [enabledDiscovery] = await dispatchFrames(enabled, discoverRequest("enabled-discover"))
  const [disabledDiscovery] = await dispatchFrames(disabled, discoverRequest("disabled-discover"))
  assert.deepEqual(enabledDiscovery.result.capabilities.logging, {})
  assert.equal(Object.hasOwn(disabledDiscovery.result.capabilities, "logging"), false)

  await Effect.runPromise(Queue.takeAll(enabled.notificationsQueue))
  const subscriptionMessages = []
  const close = enabled.openSubscription(
    "logging-subscription",
    {
      promptsListChanged: true,
      resourcesListChanged: true,
      toolsListChanged: true
    },
    (notification) =>
      Effect.sync(() => {
        subscriptionMessages.push(notification)
      })
  )
  try {
    const thresholded = await dispatchFrames(enabled, callToolRequest("threshold", "warning"))
    assert.deepEqual(
      thresholded.map((frame) =>
        frame._tag === "Notification" ? [frame.method, frame.params.level, frame.params.data] : frame._tag
      ),
      [
        ["notifications/message", "warning", "warning-message"],
        ["notifications/message", "error", "error-message"],
        "SuccessResponse"
      ]
    )
    assert.deepEqual(subscriptionMessages, [])
    assert.equal(Array.from(await Effect.runPromise(Queue.takeAll(enabled.notificationsQueue))).length, 0)

    const absent = await dispatchFrames(enabled, callToolRequest("absent", undefined))
    assert.deepEqual(
      absent.map(({ _tag }) => _tag),
      ["SuccessResponse"]
    )

    const disabledFrames = await dispatchFrames(disabled, callToolRequest("disabled", "debug"))
    assert.deepEqual(
      disabledFrames.map(({ _tag }) => _tag),
      ["SuccessResponse"]
    )
  } finally {
    close()
  }
})

test("invalid request and client log levels fail before an invalid call is sent", async () => {
  const calls = { count: 0 }
  const server = await makeLoggingServer(true, calls)
  const invalidServerRequest = await dispatchFrames(server, callToolRequest("invalid-level", "verbose"))
  assert.equal(invalidServerRequest.length, 1)
  assert.equal(invalidServerRequest[0]._tag, "ErrorResponse")
  assert.equal(invalidServerRequest[0].error.code, -32602)
  assert.equal(calls.count, 0)

  const sent = []
  const transport = {
    request: (request) => {
      sent.push(request)
      const result =
        request.method === "server/discover"
          ? {
              resultType: "complete",
              ttlMs: 0,
              cacheScope: "private",
              supportedVersions: [protocolVersion],
              capabilities: { tools: {} }
            }
          : {
              resultType: "complete",
              ttlMs: 0,
              cacheScope: "private",
              tools: []
            }
      return Stream.succeed({
        _tag: "Success",
        response: {
          _tag: "SuccessResponse",
          jsonrpc: "2.0",
          id: request.id,
          result
        }
      })
    }
  }
  await Effect.runPromise(
    Effect.scoped(
      Effect.gen(function* () {
        const client = yield* McpClient.make({ transport })
        const invalid = yield* client.listTools(undefined, { logLevel: "verbose" }).pipe(Effect.either)
        assert.equal(Either.isLeft(invalid), true)
        assert.equal(invalid.left.reason, "Protocol")
        assert.equal(sent.length, 1)

        yield* client.listTools(undefined, { logLevel: "error" })
        assert.equal(sent.length, 2)
        assert.equal(sent[1].params._meta["io.modelcontextprotocol/logLevel"], "error")
      })
    )
  )
})

test("HTTP log-level metadata forces request-scoped SSE logging", async () => {
  const server = await makeLoggingServer(true)
  const web = HttpServer.toWebHandler(server, {
    path: "/mcp",
    enableJsonResponse: true
  })
  const post = (id, logLevel) =>
    new Request("http://localhost/mcp", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        accept: "application/json, text/event-stream",
        [McpModern.MCP_PROTOCOL_VERSION_HEADER]: protocolVersion,
        [McpModern.MCP_METHOD_HEADER]: "tools/call",
        [McpModern.MCP_NAME_HEADER]: toolName
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id,
        method: "tools/call",
        params: {
          name: toolName,
          arguments: {},
          _meta: requestMeta(logLevel)
        }
      })
    })
  try {
    const streamed = await web.handler(post("streamed", "warning"))
    assert.match(streamed.headers.get("content-type") ?? "", /^text\/event-stream/)
    const frames = (await streamed.text())
      .trim()
      .split("\n\n")
      .map((frame) => JSON.parse(frame.split("\n")[1].slice("data: ".length)))
    assert.deepEqual(
      frames.map((frame) => frame.method ?? frame.result?.resultType),
      ["notifications/message", "notifications/message", "complete"]
    )

    const json = await web.handler(post("json", undefined))
    assert.match(json.headers.get("content-type") ?? "", /^application\/json/)
    assert.equal((await json.json()).result.resultType, "complete")
  } finally {
    await web.dispose()
  }
})

test("concurrent HTTP logging stays owned by each request and its severity threshold", async () => {
  const arrivals = await Effect.runPromise(Ref.make(0))
  const bothArrived = await Effect.runPromise(Deferred.make())
  const server = await Effect.runPromise(
    McpServer.make({
      serverInfo: { name: "runtime-concurrent-logging", version: "1.0.0" },
      logging: true,
      handlers: McpServer.registerTool({
        name: toolName,
        content: () =>
          Effect.gen(function* () {
            const context = yield* McpServer.McpRequestContext
            const arrived = yield* Ref.updateAndGet(arrivals, (count) => count + 1)
            if (arrived === 2) {
              yield* Deferred.succeed(bothArrived, undefined)
            }
            yield* Deferred.await(bothArrived).pipe(Effect.timeout("1 second"))
            yield* Deprecated.sendLoggingMessage({
              level: "warning",
              data: `warning:${String(context.id)}`
            })
            yield* Deprecated.sendLoggingMessage({
              level: "error",
              data: `error:${String(context.id)}`
            })
            return "done"
          })
      })
    })
  )
  const web = HttpServer.toWebHandler(server, {
    path: "/mcp",
    enableJsonResponse: true
  })
  const post = (id, logLevel) =>
    new Request("http://localhost/mcp", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        accept: "application/json, text/event-stream",
        [McpModern.MCP_PROTOCOL_VERSION_HEADER]: protocolVersion,
        [McpModern.MCP_METHOD_HEADER]: "tools/call",
        [McpModern.MCP_NAME_HEADER]: toolName
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id,
        method: "tools/call",
        params: {
          name: toolName,
          arguments: {},
          _meta: requestMeta(logLevel)
        }
      })
    })
  const parse = (body) =>
    body
      .trim()
      .split("\n\n")
      .map((frame) => JSON.parse(frame.split("\n")[1].slice("data: ".length)))
  try {
    const [warningResponse, errorResponse] = await Promise.all([
      web.handler(post("warning-owner", "warning")),
      web.handler(post("error-owner", "error"))
    ])
    const [warningFrames, errorFrames] = await Promise.all([
      warningResponse.text().then(parse),
      errorResponse.text().then(parse)
    ])
    assert.deepEqual(
      warningFrames.filter(({ method }) => method === "notifications/message").map(({ params }) => params.data),
      ["warning:warning-owner", "error:warning-owner"]
    )
    assert.deepEqual(
      errorFrames.filter(({ method }) => method === "notifications/message").map(({ params }) => params.data),
      ["error:error-owner"]
    )
    assert.equal(
      warningFrames.some(({ params }) => params?.data?.includes("error-owner")),
      false
    )
    assert.equal(
      errorFrames.some(({ params }) => params?.data?.includes("warning-owner")),
      false
    )
  } finally {
    await web.dispose()
  }
})

test("McpClient dispatches request-stream logging notifications to registered handlers", async () => {
  const observed = []
  const sent = []
  const transport = {
    request: (request) => {
      sent.push(request)
      if (request.method === "server/discover") {
        return Stream.succeed({
          _tag: "Success",
          response: {
            _tag: "SuccessResponse",
            jsonrpc: "2.0",
            id: request.id,
            result: {
              resultType: "complete",
              ttlMs: 0,
              cacheScope: "private",
              supportedVersions: [protocolVersion],
              capabilities: { tools: {} }
            }
          }
        })
      }
      return Stream.make(
        {
          _tag: "Notification",
          notification: {
            _tag: "Notification",
            jsonrpc: "2.0",
            method: "notifications/message",
            params: {
              level: "notice",
              logger: "request-handler",
              data: "client-observed"
            }
          }
        },
        {
          _tag: "Success",
          response: {
            _tag: "SuccessResponse",
            jsonrpc: "2.0",
            id: request.id,
            result: {
              resultType: "complete",
              ttlMs: 0,
              cacheScope: "private",
              tools: []
            }
          }
        }
      )
    }
  }

  await Effect.runPromise(
    Effect.scoped(
      Effect.gen(function* () {
        const client = yield* McpClient.make({ transport })
        yield* client.notifications.on("notifications/message", (params) =>
          Effect.sync(() => {
            observed.push(params)
          })
        )
        yield* client.listTools(undefined, { logLevel: "notice" })
      })
    )
  )

  assert.deepEqual(observed, [
    {
      level: "notice",
      logger: "request-handler",
      data: "client-observed"
    }
  ])
  assert.equal(sent.length, 2)
  assert.equal(sent[1].params._meta["io.modelcontextprotocol/logLevel"], "notice")
})
