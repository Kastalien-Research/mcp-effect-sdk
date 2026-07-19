import assert from "node:assert/strict"
import test from "node:test"
import * as Deferred from "effect/Deferred"
import * as Effect from "effect/Effect"
import * as Either from "effect/Either"
import * as Fiber from "effect/Fiber"
import * as Option from "effect/Option"
import * as Stream from "effect/Stream"
import * as McpClient from "../../dist/McpClient.js"
import { TransportError } from "../../dist/McpErrors.js"
import { RootsProvider } from "../../dist/client-handlers/RootsProvider.js"
import { resourceWorkspaceClient } from "../../dist/examples/core-protocol-catalog.js"

const success = (request, result) => ({
  _tag: "Success",
  response: {
    _tag: "SuccessResponse",
    jsonrpc: "2.0",
    id: request.id,
    result
  }
})

const error = (request, code, message, data) => ({
  _tag: "Error",
  response: {
    _tag: "ErrorResponse",
    jsonrpc: "2.0",
    id: request.id,
    error: { code, message, ...(data === undefined ? {} : { data }) }
  }
})

const notification = (method, params = {}) => ({
  _tag: "Notification",
  notification: { _tag: "Notification", jsonrpc: "2.0", method, params }
})

const discoverResult = (capabilities = { tools: {} }) => ({
  resultType: "complete",
  supportedVersions: ["2026-07-28"],
  capabilities,
  _meta: {
    "io.modelcontextprotocol/serverInfo": { name: "transport-test", version: "1.0.0" }
  },
  ttlMs: 0,
  cacheScope: "private"
})

const makeClient = (transport) => McpClient.make({
  transport,
  clientInfo: { name: "transport-client", version: "1.0.0" }
})

test("McpClient consumes McpTransport request streams directly and dispatches ordered notifications", async () => {
  const requests = []
  const transport = {
    request: (request) => {
      requests.push(request)
      if (request.method === "server/discover") {
        return Stream.succeed(success(request, discoverResult()))
      }
      return Stream.make(
        notification("notifications/tools/list_changed", { sequence: 1 }),
        notification("notifications/tools/list_changed", { sequence: 2 }),
        success(request, {
          resultType: "complete",
          tools: [],
          ttlMs: 0,
          cacheScope: "private"
        })
      )
    }
  }

  const observed = []
  const result = await Effect.runPromise(Effect.scoped(Effect.gen(function*() {
    const client = yield* makeClient(transport)
    yield* client.notifications.on("notifications/tools/list_changed", (params) =>
      Effect.sync(() => observed.push(params.sequence)))
    return yield* client.listTools()
  })))

  assert.deepEqual(observed, [1, 2])
  assert.deepEqual(result.tools, [])
  assert.deepEqual(requests.map(({ id, method }) => [id, method]), [
    [1, "server/discover"],
    [2, "tools/list"]
  ])
  for (const request of requests) {
    assert.equal(
      request.params._meta["io.modelcontextprotocol/protocolVersion"],
      "2026-07-28"
    )
    assert.deepEqual(
      request.params._meta["io.modelcontextprotocol/clientInfo"],
      { name: "transport-client", version: "1.0.0" }
    )
  }
})

test("McpClient retains JSON-RPC error data and the original transport failure", async () => {
  const protocolData = { field: "name", expected: "string" }
  const original = new TransportError({ message: "fixture transport failed", cause: { stage: "read" } })
  let listAttempts = 0
  const transport = {
    request: (request) => {
      if (request.method === "server/discover") {
        return Stream.succeed(success(request, discoverResult()))
      }
      listAttempts += 1
      return listAttempts === 1
        ? Stream.succeed(error(request, -32602, "bad params", protocolData))
        : Stream.fail(original)
    }
  }

  const [protocolFailure, transportFailure] = await Effect.runPromise(Effect.scoped(Effect.gen(function*() {
    const client = yield* makeClient(transport)
    const first = yield* client.listTools().pipe(Effect.either)
    const second = yield* client.listTools().pipe(Effect.either)
    return [first, second]
  })))

  assert.equal(Either.isLeft(protocolFailure), true)
  assert.deepEqual(protocolFailure.left.cause.data, protocolData)
  assert.equal(Either.isLeft(transportFailure), true)
  assert.strictEqual(transportFailure.left.cause, original)
})

test("subscriptions/listen remains caller-owned and interruption releases its request stream", async () => {
  let subscriptionId
  let subscriptionParams
  const released = await Effect.runPromise(Deferred.make())
  const transport = {
    request: (request) => {
      if (request.method === "server/discover") {
        return Stream.succeed(success(request, discoverResult({ resources: {} })))
      }
      subscriptionId = request.id
      subscriptionParams = request.params
      return Stream.unwrapScoped(Effect.gen(function*() {
        yield* Effect.addFinalizer(() => Deferred.succeed(released, undefined).pipe(Effect.asVoid))
        return Stream.make(
          notification("notifications/subscriptions/acknowledged", {
            notifications: { resourcesListChanged: true },
            _meta: { "io.modelcontextprotocol/subscriptionId": request.id }
          }),
          notification("notifications/resources/list_changed", {
            _meta: { "io.modelcontextprotocol/subscriptionId": request.id }
          })
        ).pipe(Stream.concat(Stream.never))
      }))
    }
  }

  const observed = []
  await Effect.runPromise(Effect.scoped(Effect.gen(function*() {
    const client = yield* makeClient(transport)
    yield* client.notifications.onFallback((message) =>
      Effect.sync(() => observed.push(message.method)))
    const owner = yield* client.subscriptionsListen({ resourcesListChanged: true }).pipe(Effect.forkScoped)
    while (observed.length < 2) yield* Effect.yieldNow()
    assert.deepEqual(observed, [
      "notifications/subscriptions/acknowledged",
      "notifications/resources/list_changed"
    ])
    assert.equal(Option.isNone(yield* Fiber.poll(owner)), true)
    yield* Fiber.interrupt(owner)
    yield* Deferred.await(released)
  })))
  assert.equal(subscriptionId, 2)
  assert.deepEqual(subscriptionParams.notifications, { resourcesListChanged: true })
  assert.equal("resourcesListChanged" in subscriptionParams, false)
})

test("resource workspace example owns the subscription without blocking later reads", async () => {
  const calls = []
  const client = {
    listResources: () => Effect.sync(() => calls.push("resources/list")),
    listResourceTemplates: () => Effect.sync(() => calls.push("resources/templates/list")),
    subscriptionsListen: () => Effect.never,
    readResource: ({ uri }) => Effect.sync(() => calls.push(`resources/read:${uri}`))
  }

  const result = await Effect.runPromise(
    resourceWorkspaceClient(client).pipe(Effect.timeoutOption("100 millis"))
  )

  assert.equal(Option.isSome(result), true)
  assert.deepEqual(calls, [
    "resources/list",
    "resources/templates/list",
    "resources/read:workspace://README.md",
    "resources/read:workspace://notes/alpha"
  ])
})

test("subscription transport closure returns a typed client failure with the original cause", async () => {
  const original = new TransportError({ message: "subscription closed", cause: { stage: "eof" } })
  const transport = {
    request: (request) => request.method === "server/discover"
      ? Stream.succeed(success(request, discoverResult()))
      : Stream.make(notification("notifications/subscriptions/acknowledged", {
          notifications: {},
          _meta: { "io.modelcontextprotocol/subscriptionId": request.id }
        })).pipe(Stream.concat(Stream.fail(original)))
  }

  const result = await Effect.runPromise(Effect.scoped(Effect.gen(function*() {
    const client = yield* makeClient(transport)
    return yield* client.subscriptionsListen().pipe(Effect.either)
  })))
  assert.equal(Either.isLeft(result), true)
  assert.strictEqual(result.left.cause, original)
})

test("direct transport integration preserves MRTR input hooks and allocates a new retry id", async () => {
  const calls = []
  const transport = {
    request: (request) => {
      if (request.method === "server/discover") {
        return Stream.succeed(success(request, discoverResult()))
      }
      calls.push(request)
      if (calls.length === 1) {
        return Stream.succeed(success(request, {
          resultType: "input_required",
          requestState: "opaque-state",
          inputRequests: {
            roots: { method: "roots/list", params: {} }
          }
        }))
      }
      return Stream.succeed(success(request, {
        resultType: "complete",
        content: [{ type: "text", text: "done" }]
      }))
    }
  }

  const result = await Effect.runPromise(Effect.scoped(Effect.gen(function*() {
    const client = yield* makeClient(transport)
    return yield* client.callTool({ name: "mrtr", arguments: {} })
  }).pipe(Effect.provideService(RootsProvider, {
    list: Effect.succeed({ resultType: "complete", roots: [] })
  }))))

  assert.equal(result.content[0].text, "done")
  assert.deepEqual(calls.map(({ id }) => id), [2, 3])
  assert.equal(calls[1].params.requestState, "opaque-state")
  assert.deepEqual(calls[1].params.inputResponses, {
    roots: { resultType: "complete", roots: [] }
  })
})
