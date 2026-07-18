import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import path from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"
import { test } from "node:test"
import { Context, Deferred, Effect, Either, Fiber, Queue, Stream } from "effect"

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..")
const dispatcherPath = path.join(root, "dist/McpDispatcher.js")
const clientPath = path.join(root, "dist/McpClient.js")
const serverPath = path.join(root, "dist/McpServer.js")
const schemaPath = path.join(root, "dist/McpSchema.js")

let dispatcher
let dispatcherLoadError
let clientApi
let serverApi
let schemaApi
try {
  dispatcher = await import(pathToFileURL(dispatcherPath).href)
  clientApi = await import(pathToFileURL(clientPath).href)
  serverApi = await import(pathToFileURL(serverPath).href)
  schemaApi = await import(pathToFileURL(schemaPath).href)
} catch (error) {
  dispatcherLoadError = error
}

const requireDispatcher = () => {
  assert.ifError(dispatcherLoadError)
  assert.ok(dispatcher, "McpDispatcher module must exist")
  return dispatcher
}

const request = (id, method = "tools/list", params = {}) => ({
  _tag: "Request",
  jsonrpc: "2.0",
  id,
  method,
  params
})
const validParams = (params = {}) => ({
  ...params,
  _meta: {
    "io.modelcontextprotocol/clientCapabilities": {},
    "io.modelcontextprotocol/protocolVersion": "2026-07-28"
  }
})
const success = (id, result = { resultType: "complete" }) => ({
  _tag: "SuccessResponse",
  jsonrpc: "2.0",
  id,
  result
})
const errorResponse = (id, code = -32603, message = "failed") => ({
  _tag: "ErrorResponse",
  jsonrpc: "2.0",
  id,
  error: { code, message }
})
const notification = (method = "notifications/message", params = {}) => ({
  _tag: "Notification",
  jsonrpc: "2.0",
  method,
  params
})
const cancel = (requestId) => notification("notifications/cancelled", { requestId })
const collect = (client, message) => client.request(message).pipe(Stream.runCollect)
const settle = Effect.yieldNow

test("client correlation preserves exact mixed ID identity", async () => {
  const api = requireDispatcher()
  const ids = ["1", 1, "", 0, -1, "001"]
  const sent = []
  await Effect.runPromise(Effect.scoped(Effect.gen(function*() {
    const client = yield* api.makeClientDispatcher({
      send: (message) => Effect.sync(() => { sent.push(message) })
    })
    const fibers = []
    for (const id of ids) fibers.push(yield* collect(client, request(id)).pipe(Effect.forkScoped))
    yield* settle()
    assert.deepEqual(sent.map((message) => message.id), ids)

    for (const id of [...ids].reverse()) {
      yield* client.accept(success(id, { resultType: "complete", owner: `${typeof id}:${id}` }))
    }
    for (let index = 0; index < ids.length; index++) {
      const frames = Array.from(yield* Fiber.join(fibers[index]))
      assert.equal(frames.length, 1)
      assert.equal(frames[0]._tag, "Success")
      assert.strictEqual(frames[0].response.id, ids[index])
      assert.equal(frames[0].response.result.owner, `${typeof ids[index]}:${ids[index]}`)
    }
  })))
})

test("duplicate active IDs fail before send and preserve the original owner", async () => {
  const api = requireDispatcher()
  const sent = []
  await Effect.runPromise(Effect.scoped(Effect.gen(function*() {
    const sendEvents = yield* Queue.unbounded()
    const client = yield* api.makeClientDispatcher({
      send: (message) => Effect.sync(() => { sent.push(message) }).pipe(
        Effect.zipRight(Queue.offer(sendEvents, message)),
        Effect.asVoid
      )
    })
    const first = yield* collect(client, request("same")).pipe(Effect.forkScoped)
    yield* Queue.take(sendEvents)
    const duplicate = yield* collect(client, request("same")).pipe(Effect.either)
    assert.equal(Either.isLeft(duplicate), true)
    assert.equal(duplicate.left._tag, "InvalidRequest")
    assert.equal(sent.length, 1)

    yield* client.accept(success("same"))
    assert.equal(Array.from(yield* Fiber.join(first))[0]._tag, "Success")

    const reused = yield* collect(client, request("same")).pipe(Effect.forkScoped)
    yield* Queue.take(sendEvents)
    assert.equal(sent.length, 2)
    yield* client.accept(success("same"))
    yield* Fiber.join(reused)
  })))
})

test("request streams preserve explicit and subscription-bound notification order", async () => {
  const api = requireDispatcher()
  await Effect.runPromise(Effect.scoped(Effect.gen(function*() {
    const client = yield* api.makeClientDispatcher({ send: () => Effect.void })
    const fiber = yield* collect(client, request("sub", "subscriptions/listen", { notifications: {} })).pipe(Effect.forkScoped)
    yield* settle()
    const explicit = notification("notifications/message", { level: "info" })
    const automatic = notification("notifications/resources/updated", {
      uri: "file:///one",
      _meta: { "io.modelcontextprotocol/subscriptionId": "sub" }
    })
    const global = notification("notifications/tools/list_changed")
    yield* client.accept(explicit, { ownerId: "sub" })
    yield* client.accept(automatic)
    yield* client.accept(global)
    assert.deepEqual(yield* Queue.take(client.notifications), global)
    yield* client.accept(success("sub"))
    yield* client.accept(errorResponse("sub"))

    const frames = Array.from(yield* Fiber.join(fiber))
    assert.deepEqual(frames.map((frame) => frame._tag), ["Notification", "Notification", "Success"])
    assert.deepEqual(frames.slice(0, 2).map((frame) => frame.notification), [explicit, automatic])
  })))
})

test("terminal errors are values while unknown, late, and standalone requests are protocol-safe", async () => {
  const api = requireDispatcher()
  await Effect.runPromise(Effect.scoped(Effect.gen(function*() {
    const client = yield* api.makeClientDispatcher({ send: () => Effect.void })
    yield* client.accept(success("unknown"))
    const standalone = yield* client.accept(request("server-request")).pipe(Effect.either)
    assert.equal(Either.isLeft(standalone), true)
    assert.equal(standalone.left._tag, "InvalidRequest")

    const fiber = yield* collect(client, request(0)).pipe(Effect.forkScoped)
    yield* settle()
    yield* client.accept(errorResponse(0, -32602, "bad params"))
    yield* client.accept(success(0))
    const result = yield* Fiber.join(fiber).pipe(Effect.either)
    assert.equal(Either.isRight(result), true)
    const frames = Array.from(result.right)
    assert.equal(frames.length, 1)
    assert.equal(frames[0]._tag, "Error")
    assert.equal(frames[0].response.error.code, -32602)
  })))
})

test("client send failure, abrupt close, and future requests use the typed error channel", async () => {
  const api = requireDispatcher()
  let sends = 0
  await Effect.runPromise(Effect.scoped(Effect.gen(function*() {
    const failing = yield* api.makeClientDispatcher({
      send: () => {
        sends += 1
        return Effect.fail(new api.TransportError({ message: "send failed" }))
      }
    })
    const sendResult = yield* collect(failing, request(1)).pipe(Effect.either)
    assert.equal(Either.isLeft(sendResult), true)
    assert.equal(sendResult.left._tag, "TransportError")

    const defective = yield* api.makeClientDispatcher({
      send: () => Effect.die("send defect")
    })
    const defectResult = yield* collect(defective, request("defect")).pipe(Effect.either)
    assert.equal(Either.isLeft(defectResult), true)
    assert.equal(defectResult.left._tag, "TransportError")

    const client = yield* api.makeClientDispatcher({
      send: () => Effect.sync(() => { sends += 1 })
    })
    const active = yield* collect(client, request(2)).pipe(Effect.forkScoped)
    yield* settle()
    yield* client.close(new Error("connection closed"))
    yield* client.close(new Error("ignored second close"))
    const closed = yield* Fiber.join(active).pipe(Effect.either)
    assert.equal(Either.isLeft(closed), true)
    assert.equal(closed.left._tag, "TransportError")
    const sendsBefore = sends
    const future = yield* collect(client, request(3)).pipe(Effect.either)
    assert.equal(Either.isLeft(future), true)
    assert.equal(future.left._tag, "TransportError")
    assert.equal(sends, sendsBefore)
  })))
})

test("legacy client errors preserve valid JSON-RPC error data", async () => {
  const diagnostics = { field: "name", expected: "string" }
  await Effect.runPromise(Effect.scoped(Effect.gen(function*() {
    const callback = yield* Deferred.make()
    const notifications = yield* Queue.unbounded()
    const serverRequests = yield* Queue.unbounded()
    const protocol = {
      clientProtocol: {
        supportsAck: false,
        supportsTransferables: false,
        run: (handler) => Deferred.succeed(callback, handler).pipe(
          Effect.zipRight(Effect.never)
        ),
        send: (message) => Deferred.await(callback).pipe(Effect.flatMap((handler) =>
          handler(message.tag === "server/discover"
            ? {
              _tag: "Exit",
              requestId: message.id,
              exit: {
                _tag: "Success",
                value: {
                  resultType: "complete",
                  supportedVersions: ["2026-07-28"],
                  capabilities: { tools: {} },
                  serverInfo: { name: "test", version: "1" }
                }
              }
            }
            : {
              _tag: "Exit",
              requestId: message.id,
              exit: {
                _tag: "Failure",
                cause: {
                  _tag: "Fail",
                  error: { code: -32602, message: "bad params", data: diagnostics }
                }
              }
            }))
        )
      },
      notifications,
      serverRequests,
      respond: () => Effect.void,
      respondError: () => Effect.void
    }
    const client = yield* clientApi.make(protocol, {
      clientInfo: { name: "test-client", version: "1" }
    })
    const result = yield* client.listTools().pipe(Effect.either)
    assert.equal(Either.isLeft(result), true)
    assert.deepEqual(result.left.cause.data, diagnostics)
  })))
})

test("interrupted client streams release correlation and allow exact ID reuse", async () => {
  const api = requireDispatcher()
  const sent = []
  await Effect.runPromise(Effect.scoped(Effect.gen(function*() {
    const sendEvents = yield* Queue.unbounded()
    const client = yield* api.makeClientDispatcher({
      send: (message) => Effect.sync(() => { sent.push(message) }).pipe(
        Effect.zipRight(Queue.offer(sendEvents, message)),
        Effect.asVoid
      )
    })
    const abandoned = yield* collect(client, request("reuse")).pipe(Effect.forkScoped)
    yield* Queue.take(sendEvents)
    yield* Fiber.interrupt(abandoned)
    const reused = yield* collect(client, request("reuse")).pipe(Effect.forkScoped)
    yield* Queue.take(sendEvents)
    assert.equal(sent.length, 2)
    yield* client.accept(success("reuse"))
    yield* Fiber.join(reused)
  })))
})

test("server validates generated methods and payloads before invoking handlers", async () => {
  const api = requireDispatcher()
  const sent = []
  let handled = 0
  let handledRequest
  let handledContext
  await Effect.runPromise(Effect.scoped(Effect.gen(function*() {
    const sendEvents = yield* Queue.unbounded()
    const server = yield* api.makeServerDispatcher({
      send: (message) => Effect.sync(() => { sent.push(message) }).pipe(
        Effect.zipRight(Queue.offer(sendEvents, message)),
        Effect.asVoid
      ),
      handle: (message) => Effect.gen(function*() {
        handled += 1
        handledRequest = message
        handledContext = yield* api.McpRequestContext
        return { resultType: "complete" }
      })
    })
    const originalParams = validParams()
    yield* server.accept(request(1, "tools/list", originalParams))
    yield* Queue.take(sendEvents)
    assert.equal(handled, 1)
    assert.notStrictEqual(handledRequest.params, originalParams)
    assert.strictEqual(handledContext.request, handledRequest)
    assert.strictEqual(handledContext.request.params, handledRequest.params)
    assert.equal(sent[0]._tag, "SuccessResponse")

    yield* server.accept(request(2, "unknown/method", validParams()))
    yield* server.accept(request(3, "tools/call", validParams()))
    yield* server.accept(request(4, "tools/list", {}))
    yield* Queue.takeN(sendEvents, 3)
    assert.equal(handled, 1)
    assert.deepEqual(sent.slice(1).map((message) => message.error.code), [-32601, -32602, -32602])

    const beforeNotification = sent.length
    yield* server.accept(notification("notifications/cancelled", { requestId: "unknown" }))
    assert.equal(sent.length, beforeNotification)
  })))
})

test("canonical large integer IDs route subscription notifications and cancellation", async () => {
  const api = requireDispatcher()
  const largeId = Number.MAX_SAFE_INTEGER
  await Effect.runPromise(Effect.scoped(Effect.gen(function*() {
    const clientSent = yield* Deferred.make()
    const client = yield* api.makeClientDispatcher({
      send: () => Deferred.succeed(clientSent, undefined).pipe(Effect.asVoid)
    })
    const clientFiber = yield* collect(client, request(largeId)).pipe(Effect.forkScoped)
    yield* Deferred.await(clientSent)
    const update = notification("notifications/resources/updated", {
      _meta: { "io.modelcontextprotocol/subscriptionId": largeId }
    })
    yield* client.accept(update)
    yield* client.accept(success(largeId))
    assert.deepEqual(Array.from(yield* Fiber.join(clientFiber)).map((frame) => frame._tag), [
      "Notification",
      "Success"
    ])

    let context
    const gate = yield* Deferred.make()
    const handlerStarted = yield* Deferred.make()
    const sent = []
    const server = yield* api.makeServerDispatcher({
      send: (message) => Effect.sync(() => { sent.push(message) }),
      handle: () => Effect.gen(function*() {
        context = yield* api.McpRequestContext
        yield* Deferred.succeed(handlerStarted, undefined)
        yield* Deferred.await(gate)
        return { resultType: "complete" }
      })
    })
    yield* server.accept(request(largeId, "tools/list", validParams()))
    yield* Deferred.await(handlerStarted)
    yield* server.accept(cancel(largeId))
    assert.equal(yield* context.isCancelled, true)
    assert.equal(sent.filter((message) => message.id === largeId).length, 1)
  })))
})

test("McpServer adapter preserves exact IDs and request metadata through the registry", async () => {
  const sent = []
  const observedClients = []
  await Effect.runPromise(Effect.scoped(Effect.gen(function*() {
    const service = yield* serverApi.McpServer.makeWithOptions({
      name: "adapter-test",
      version: "1"
    })
    service.tools.push({
      tool: { name: "visible", inputSchema: { type: "object" } },
      annotations: Context.make(schemaApi.EnabledWhen, (client) => {
        observedClients.push(client)
        return client.protocolVersion === "2026-07-28" &&
          client.clientInfo?.name === "adapter-client" &&
          client.capabilities.extensions?.["example.com/demo"] !== undefined
      }),
      handler: () => Effect.die("tools/list must not call tool handlers")
    })
    const sendEvents = yield* Queue.unbounded()
    const wire = yield* serverApi.makeDispatcher({
      send: (message) => Effect.sync(() => { sent.push(message) }).pipe(
        Effect.zipRight(Queue.offer(sendEvents, message)),
        Effect.asVoid
      )
    }).pipe(Effect.provideService(serverApi.McpServer, service))
    const id = "registry-request"
    yield* wire.accept(request(id, "tools/list", {
      _meta: {
        "io.modelcontextprotocol/protocolVersion": "2026-07-28",
        "io.modelcontextprotocol/clientInfo": { name: "adapter-client", version: "1" },
        "io.modelcontextprotocol/clientCapabilities": {
          extensions: { "example.com/demo": {} }
        }
      }
    }))
    yield* Queue.take(sendEvents)
    assert.equal(sent[0]._tag, "SuccessResponse")
    assert.strictEqual(sent[0].id, id)
    assert.deepEqual(sent[0].result.tools.map((tool) => tool.name), ["visible"])
    assert.equal(observedClients.length, 1)
  })))
})

test("server rejects duplicate active IDs before handler and isolates request contexts", async () => {
  const api = requireDispatcher()
  const Annotation = Context.GenericTag("test/Wp4DispatcherAnnotation")
  const contexts = []
  const sent = []
  await Effect.runPromise(Effect.scoped(Effect.gen(function*() {
    const handlerEvents = yield* Queue.unbounded()
    const sendEvents = yield* Queue.unbounded()
    const gates = new Map([
      ["1", yield* Deferred.make()],
      [1, yield* Deferred.make()]
    ])
    const server = yield* api.makeServerDispatcher({
      send: (message) => Effect.sync(() => { sent.push(message) }).pipe(
        Effect.zipRight(Queue.offer(sendEvents, message)),
        Effect.asVoid
      ),
      handle: (message) => Effect.gen(function*() {
        const context = yield* api.McpRequestContext
        contexts.push(context)
        yield* Queue.offer(handlerEvents, message.id)
        yield* Deferred.await(gates.get(message.id))
        return { resultType: "complete" }
      })
    })
    const meta = (name) => ({
      _meta: {
        "io.modelcontextprotocol/protocolVersion": "2026-07-28",
        "io.modelcontextprotocol/clientInfo": { name, version: "1" },
        "io.modelcontextprotocol/clientCapabilities": { extensions: { [`example.com/${name}`]: {} } }
      }
    })
    yield* server.accept(request("1", "tools/list", meta("string")), {
      authorizationPrincipal: { subject: "string" },
      annotations: Context.make(Annotation, "string")
    })
    const duplicate = yield* server.accept(request("1", "tools/list", meta("duplicate"))).pipe(Effect.either)
    assert.equal(Either.isLeft(duplicate), true)
    assert.equal(duplicate.left._tag, "InvalidRequest")
    yield* server.accept(request(1, "tools/list", meta("number")), {
      authorizationPrincipal: { subject: "number" },
      annotations: Context.make(Annotation, "number")
    })
    yield* Queue.takeN(handlerEvents, 2)
    assert.equal(contexts.length, 2)
    for (const context of contexts) {
      const key = typeof context.id
      assert.equal(context.clientInfo.name, key === "string" ? "string" : "number")
      assert.equal(context.authorizationPrincipal.subject, key)
      assert.equal(Context.get(context.annotations, Annotation), key)
      assert.equal(yield* context.isCancelled, false)
    }
    yield* Deferred.succeed(gates.get("1"), undefined)
    yield* Deferred.succeed(gates.get(1), undefined)
    yield* Queue.takeN(sendEvents, 2)
    assert.deepEqual(sent.map((message) => message.id), ["1", 1])
  })))
})

test("server cancellation is exact, idempotent, and emits at most one terminal", async () => {
  const api = requireDispatcher()
  const contexts = new Map()
  const sent = []
  await Effect.runPromise(Effect.scoped(Effect.gen(function*() {
    const handlerEvents = yield* Queue.unbounded()
    const sendEvents = yield* Queue.unbounded()
    const numericGate = yield* Deferred.make()
    const stringGate = yield* Deferred.make()
    const server = yield* api.makeServerDispatcher({
      send: (message) => Effect.sync(() => { sent.push(message) }).pipe(
        Effect.zipRight(Queue.offer(sendEvents, message)),
        Effect.asVoid
      ),
      handle: (message) => Effect.gen(function*() {
        const context = yield* api.McpRequestContext
        contexts.set(message.id, context)
        yield* Queue.offer(handlerEvents, message.id)
        yield* Deferred.await(message.id === 1 ? numericGate : stringGate)
        return { resultType: "complete" }
      })
    })
    yield* server.accept(request(1, "tools/list", validParams()))
    yield* server.accept(request("1", "tools/list", validParams()))
    yield* Queue.takeN(handlerEvents, 2)
    yield* server.accept(cancel(1))
    yield* Queue.take(sendEvents)
    yield* server.accept(cancel(1))
    yield* server.accept(cancel("unknown"))
    assert.equal(yield* contexts.get(1).isCancelled, true)
    assert.equal(yield* contexts.get("1").isCancelled, false)
    assert.equal(sent.filter((message) => message.id === 1).length, 1)

    yield* Deferred.succeed(stringGate, undefined)
    yield* Queue.take(sendEvents)
    assert.equal(sent.filter((message) => message.id === "1").length, 1)
    yield* server.accept(cancel("1"))
    assert.equal(sent.filter((message) => message.id === "1").length, 1)
  })))
})

test("typed handler failures, defects, and send failures clean up without recursive terminals", async () => {
  const api = requireDispatcher()
  const sent = []
  let failSend = true
  let handled = 0
  await Effect.runPromise(Effect.scoped(Effect.gen(function*() {
    const sendAttempts = yield* Queue.unbounded()
    const server = yield* api.makeServerDispatcher({
      send: (message) => failSend
        ? Queue.offer(sendAttempts, message).pipe(
          Effect.zipRight(Effect.fail(new api.TransportError({ message: "write failed" })))
        )
        : Effect.sync(() => { sent.push(message) }).pipe(
          Effect.zipRight(Queue.offer(sendAttempts, message)),
          Effect.asVoid
        ),
      handle: (message) => {
        handled += 1
        if (message.id === "typed") return Effect.fail(new api.InvalidParams({ message: "typed failure" }))
        if (message.id === "defect") return Effect.die("boom")
        return Effect.succeed({ resultType: "complete" })
      }
    })
    yield* server.accept(request("send", "tools/list", validParams()))
    yield* Queue.take(sendAttempts)
    failSend = false
    yield* server.accept(request("send", "tools/list", validParams()))
    yield* server.accept(request("typed", "tools/list", validParams()))
    yield* server.accept(request("defect", "tools/list", validParams()))
    yield* Queue.takeN(sendAttempts, 3)
    assert.equal(handled, 4)
    assert.equal(sent.filter((message) => message.id === "send").length, 1)
    assert.equal(sent.find((message) => message.id === "typed").error.code, -32602)
    assert.equal(sent.find((message) => message.id === "defect").error.code, -32603)
    assert.equal(sent.length, 3)
  })))
})

test("owned dispatcher and compatibility paths reject coercive or transport-owned state", () => {
  const dispatcherSource = (() => {
    try {
      return readFileSync(path.join(root, "src/McpDispatcher.ts"), "utf8")
    } catch {
      return ""
    }
  })()
  const clientSource = readFileSync(path.join(root, "src/McpClient.ts"), "utf8")
  const protocolSource = readFileSync(path.join(root, "src/McpClientProtocol.ts"), "utf8")
  const owned = `${dispatcherSource}\n${clientSource}\n${protocolSource}`

  assert.match(dispatcherSource, /HashMap\.(?:empty|make)<JsonRpcId/)
  assert.match(dispatcherSource, /McpRequestContext/)
  assert.doesNotMatch(owned, /\b(?:String|Number)\s*\([^)]*(?:requestId|\bid\b)[^)]*\)/)
  assert.doesNotMatch(owned, /\bidStr\b|HashMap\.HashMap<string|new Map<string/)
  assert.doesNotMatch(owned, /!\s*(?:id|requestId)\b/)
  assert.doesNotMatch(dispatcherSource, /Effect\.runFork|runPromise|interface\s+JsonRpc/)
  assert.doesNotMatch(dispatcherSource, /Session|MCP-Session|Http|Stdio|ReadableStream|WebSocket/)
  assert.doesNotMatch(protocolSource, /requestId:\s*string/)
})
