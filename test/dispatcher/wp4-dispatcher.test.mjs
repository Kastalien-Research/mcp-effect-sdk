import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import path from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"
import { test } from "node:test"
import { Cause, Context, Deferred, Effect, Either, Fiber, Option, Queue, Stream } from "effect"

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..")
const dispatcherPath = path.join(root, "dist/McpDispatcher.js")
const serverPath = path.join(root, "dist/McpServer.js")
const schemaPath = path.join(root, "dist/McpSchema.js")

let dispatcher
let dispatcherLoadError
let serverApi
let schemaApi
try {
  dispatcher = await import(pathToFileURL(dispatcherPath).href)
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

test("request abandonment callback arms only after successful send ownership", async () => {
  const api = requireDispatcher()
  const abandoned = []
  const sent = []
  await Effect.runPromise(Effect.scoped(Effect.gen(function*() {
    const client = yield* api.makeClientDispatcher({
      send: (message) => message.id === "send-failure"
        ? Effect.fail("fixture send failure")
        : Effect.sync(() => { sent.push(message.id) }),
      onRequestAbandoned: (message) => Effect.sync(() => { abandoned.push(message.id) })
    })

    const original = yield* collect(client, request("owned")).pipe(Effect.forkScoped)
    while (!sent.includes("owned")) yield* Effect.yieldNow()
    const duplicate = yield* collect(client, request("owned")).pipe(Effect.either)
    assert.equal(Either.isLeft(duplicate), true)
    assert.deepEqual(abandoned, [])
    yield* Fiber.interrupt(original)
    assert.deepEqual(abandoned, ["owned"])

    const sendFailure = yield* collect(client, request("send-failure")).pipe(Effect.either)
    assert.equal(Either.isLeft(sendFailure), true)
    assert.deepEqual(abandoned, ["owned"])

    const terminal = yield* collect(client, request("terminal")).pipe(Effect.forkScoped)
    while (!sent.includes("terminal")) yield* Effect.yieldNow()
    yield* client.accept(success("terminal"))
    yield* Fiber.join(terminal)
    assert.deepEqual(abandoned, ["owned"])
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
    assert.deepEqual(Object.keys(client).sort(), ["accept", "cancel", "close", "request"])
    yield* client.accept(success("sub"))
    yield* client.accept(errorResponse("sub"))

    const frames = Array.from(yield* Fiber.join(fiber))
    assert.deepEqual(frames.map((frame) => frame._tag), ["Notification", "Notification", "Success"])
    assert.deepEqual(frames.slice(0, 2).map((frame) => frame.notification), [explicit, automatic])
  })))
})

test("bounded client ownership preserves a saturated terminal without stalling another owner", async () => {
  const api = requireDispatcher()
  const sent = []
  await Effect.runPromise(Effect.scoped(Effect.gen(function*() {
    const client = yield* api.makeClientDispatcher({
      send: (message) => Effect.sync(() => { sent.push(message.id) })
    })
    const saturatedPull = yield* Stream.toPull(client.request(request("saturated")))
    const firstPull = yield* saturatedPull.pipe(Effect.forkScoped)
    while (!sent.includes("saturated")) yield* Effect.yieldNow()
    yield* client.accept(notification("notifications/message", { sequence: 0 }), { ownerId: "saturated" })
    yield* Fiber.join(firstPull)

    for (let sequence = 1; sequence <= 16; sequence++) {
      yield* client.accept(notification("notifications/message", { sequence }), { ownerId: "saturated" })
    }
    yield* client.accept(success("saturated", { resultType: "complete", terminal: true }))

    const unrelated = yield* collect(client, request("unrelated")).pipe(Effect.forkScoped)
    while (!sent.includes("unrelated")) yield* Effect.yieldNow()
    yield* client.accept(success("unrelated"))
    const unrelatedDone = yield* Fiber.join(unrelated).pipe(Effect.timeoutOption("100 millis"))
    assert.equal(Option.isSome(unrelatedDone), true, "saturated owner stalled an unrelated terminal")

    const remaining = []
    for (let index = 0; index < 17; index++) {
      remaining.push(...Array.from(yield* saturatedPull))
    }
    assert.deepEqual(remaining.slice(0, 16).map((frame) => frame.notification.params.sequence),
      Array.from({ length: 16 }, (_, index) => index + 1))
    assert.equal(remaining.at(-1)._tag, "Success")
    assert.equal(remaining.at(-1).response.result.terminal, true)
  })))
})

test("client owner overflow fails exactly once without cross-owner interference", async () => {
  const api = requireDispatcher()
  const sent = []
  await Effect.runPromise(Effect.scoped(Effect.gen(function*() {
    const client = yield* api.makeClientDispatcher({
      send: (message) => Effect.sync(() => { sent.push(message.id) })
    })
    const overflowPull = yield* Stream.toPull(client.request(request("overflow")))
    const firstPull = yield* overflowPull.pipe(Effect.forkScoped)
    while (!sent.includes("overflow")) yield* Effect.yieldNow()
    yield* client.accept(notification("notifications/message", { sequence: 0 }), { ownerId: "overflow" })
    yield* Fiber.join(firstPull)

    for (let sequence = 1; sequence <= 17; sequence++) {
      yield* client.accept(notification("notifications/message", { sequence }), { ownerId: "overflow" })
    }
    yield* client.accept(notification("notifications/message", { sequence: 18 }), { ownerId: "overflow" })

    const unrelated = yield* collect(client, request("overflow-unrelated")).pipe(Effect.forkScoped)
    while (!sent.includes("overflow-unrelated")) yield* Effect.yieldNow()
    yield* client.accept(success("overflow-unrelated"))
    const unrelatedDone = yield* Fiber.join(unrelated).pipe(Effect.timeoutOption("100 millis"))
    assert.equal(Option.isSome(unrelatedDone), true)

    for (let index = 0; index < 16; index++) yield* overflowPull
    const overflow = yield* overflowPull.pipe(Effect.either)
    assert.equal(Either.isLeft(overflow), true)
    assert.equal(Option.isSome(overflow.left), true)
    assert.equal(overflow.left.value._tag, "TransportError")
    assert.match(overflow.left.value.message, /buffer capacity/i)

    const reused = yield* collect(client, request("overflow")).pipe(Effect.forkScoped)
    while (sent.filter((id) => id === "overflow").length < 2) yield* Effect.yieldNow()
    yield* client.accept(success("overflow"))
    assert.equal(Array.from(yield* Fiber.join(reused)).at(-1)._tag, "Success",
      "overflow failure must release the exact owner once")
  })))
})

test("bounded server failure supervision backpressures only failed owners without loss", async () => {
  const api = requireDispatcher()
  const sent = []
  let attempts = 0
  await Effect.runPromise(Effect.scoped(Effect.gen(function*() {
    const server = yield* api.makeServerDispatcher({
      send: (message) => Effect.sync(() => { attempts += 1 }).pipe(
        Effect.zipRight(String(message.id).startsWith("failed-")
          ? Effect.fail(new api.TransportError({ message: "fixture write failed" }))
          : Effect.sync(() => { sent.push(message) }))
      ),
      handle: () => Effect.succeed({ resultType: "complete" })
    })

    for (let index = 0; index < 17; index++) {
      yield* server.accept(request(`failed-${index}`, "tools/list", validParams()))
    }
    yield* server.accept(request("healthy", "tools/list", validParams()))
    while (attempts < 18) yield* Effect.yieldNow()
    assert.deepEqual(sent.map(({ id }) => id), ["healthy"])

    const failures = []
    for (let index = 0; index < 17; index++) {
      const failure = yield* Queue.take(server.failures).pipe(Effect.timeoutOption("100 millis"))
      assert.equal(Option.isSome(failure), true, `missing supervised failure ${index}`)
      failures.push(failure.value.requestId)
    }
    assert.deepEqual(new Set(failures), new Set(Array.from({ length: 17 }, (_, index) => `failed-${index}`)))
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

test("unknown terminals never steal an active request owner", async () => {
  const api = requireDispatcher()
  await Effect.runPromise(Effect.scoped(Effect.gen(function*() {
    const client = yield* api.makeClientDispatcher({ send: () => Effect.void })
    const active = yield* collect(client, request("owned")).pipe(Effect.forkScoped)
    yield* settle()
    yield* client.accept(success("other"))
    assert.equal(Option.isNone(yield* Fiber.poll(active)), true)
    yield* client.accept(success("owned"))
    const frames = Array.from(yield* Fiber.join(active))
    assert.equal(frames.length, 1)
    assert.strictEqual(frames[0].response.id, "owned")
  })))
})

test("an interrupted send remains interruption instead of becoming a transport failure", async () => {
  const api = requireDispatcher()
  await Effect.runPromise(Effect.scoped(Effect.gen(function*() {
    const client = yield* api.makeClientDispatcher({ send: () => Effect.interrupt })
    const exit = yield* collect(client, request("interrupt-send")).pipe(Effect.exit)
    assert.equal(exit._tag, "Failure")
    assert.equal(Cause.isInterruptedOnly(exit.cause), true)
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

test("local client cancellation fails only the exact active request with RequestCancelledError", async () => {
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
    const active = yield* collect(client, request("cancel-local")).pipe(Effect.forkScoped)
    yield* Queue.take(sendEvents)
    yield* client.cancel("cancel-local", "operator stopped")
    const cancelled = yield* Fiber.join(active).pipe(Effect.either)
    assert.equal(Either.isLeft(cancelled), true)
    assert.equal(cancelled.left._tag, "RequestCancelledError")
    assert.strictEqual(cancelled.left.requestId, "cancel-local")
    assert.equal(cancelled.left.reason, "operator stopped")

    yield* client.cancel("cancel-local", "late")
    const reused = yield* collect(client, request("cancel-local")).pipe(Effect.forkScoped)
    yield* Queue.take(sendEvents)
    yield* client.accept(success("cancel-local"))
    assert.equal(Array.from(yield* Fiber.join(reused))[0]._tag, "Success")
    assert.deepEqual(sent.map((message) => message.id), ["cancel-local", "cancel-local"])
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

test("terminal writing retains exact ownership until the send settles", async () => {
  const api = requireDispatcher()
  const writes = []
  let handled = 0
  let firstContext
  await Effect.runPromise(Effect.scoped(Effect.gen(function*() {
    const firstWriteStarted = yield* Deferred.make()
    const releaseFirstWrite = yield* Deferred.make()
    const writeSettled = yield* Queue.unbounded()
    const server = yield* api.makeServerDispatcher({
      send: (message) => Effect.gen(function*() {
        if (writes.length === 0) {
          yield* Deferred.succeed(firstWriteStarted, undefined)
          yield* Deferred.await(releaseFirstWrite)
        }
        writes.push(message)
        yield* Queue.offer(writeSettled, message)
      }),
      handle: () => Effect.gen(function*() {
        handled += 1
        if (handled === 1) firstContext = yield* api.McpRequestContext
        return { resultType: "complete", sequence: handled }
      })
    })
    yield* server.accept(request("blocked-send", "tools/list", validParams()))
    yield* Deferred.await(firstWriteStarted)

    yield* server.accept(cancel("blocked-send"))
    const duplicate = yield* server.accept(
      request("blocked-send", "tools/list", validParams())
    ).pipe(Effect.either)
    yield* Deferred.succeed(releaseFirstWrite, undefined)
    yield* Queue.take(writeSettled)
    yield* Effect.yieldNow()

    assert.equal(Either.isLeft(duplicate), true)
    assert.equal(duplicate.left._tag, "InvalidRequest")
    assert.equal(handled, 1)
    assert.equal(yield* firstContext.isCancelled, false)
    assert.deepEqual(writes.map((message) => message.result.sequence), [1])

    yield* server.accept(cancel("blocked-send"))
    yield* server.accept(request("blocked-send", "tools/list", validParams()))
    yield* Queue.take(writeSettled)
    assert.equal(handled, 2)
    assert.deepEqual(writes.map((message) => message.result.sequence), [1, 2])
  })))
})

test("server terminal send failures are supervised with their original Cause", async () => {
  const api = requireDispatcher()
  const cases = [
    {
      id: "checked-send",
      send: () => Effect.fail(new api.TransportError({ message: "checked write failure" })),
      assertCause: (cause) => {
        const failure = Cause.failureOption(cause)
        assert.equal(Option.isSome(failure), true)
        assert.equal(failure.value._tag, "TransportError")
      }
    },
    {
      id: "defect-send",
      send: () => Effect.die("write defect"),
      assertCause: (cause) => assert.deepEqual(Array.from(Cause.defects(cause)), ["write defect"])
    },
    {
      id: "interrupt-send",
      send: () => Effect.interrupt,
      assertCause: (cause) => assert.equal(Cause.isInterruptedOnly(cause), true)
    }
  ]

  await Effect.runPromise(Effect.scoped(Effect.gen(function*() {
    for (const testCase of cases) {
      let handled = 0
      const server = yield* api.makeServerDispatcher({
        send: testCase.send,
        handle: () => Effect.sync(() => {
          handled += 1
          return { resultType: "complete" }
        })
      })
      yield* server.accept(request(testCase.id, "tools/list", validParams()))
      const failure = yield* Queue.take(server.failures)
      assert.equal(failure._tag, "ServerDispatchFailure")
      assert.strictEqual(failure.requestId, testCase.id)
      assert.equal(failure.method, "tools/list")
      assert.equal(failure.terminalTag, "SuccessResponse")
      assert.equal(typeof failure.message, "string")
      assert.doesNotThrow(() => JSON.stringify({
        requestId: failure.requestId,
        method: failure.method,
        terminalTag: failure.terminalTag,
        message: failure.message
      }))
      testCase.assertCause(failure.cause)
      yield* Effect.yieldNow()

      yield* server.accept(request(testCase.id, "tools/list", validParams()))
      const secondFailure = yield* Queue.take(server.failures)
      assert.strictEqual(secondFailure.requestId, testCase.id)
      assert.equal(handled, 2)
    }
  })))
})

test("server failure publication never reads hostile Error accessors", async () => {
  const api = requireDispatcher()
  const cases = ["checked", "defect"]

  await Effect.runPromise(Effect.scoped(Effect.gen(function*() {
    for (const failureKind of cases) {
      let getterReads = 0
      const hostile = new Error("initial")
      Object.defineProperties(hostile, {
        name: {
          configurable: true,
          get: () => {
            getterReads += 1
            throw new Error("name getter must not run")
          }
        },
        message: {
          configurable: true,
          get: () => {
            getterReads += 1
            throw new Error("message getter must not run")
          }
        }
      })
      const server = yield* api.makeServerDispatcher({
        send: () => failureKind === "checked" ? Effect.fail(hostile) : Effect.die(hostile),
        handle: () => Effect.succeed({ resultType: "complete" })
      })
      yield* server.accept(request(`hostile-${failureKind}`, "tools/list", validParams()))
      const published = yield* Queue.take(server.failures).pipe(
        Effect.timeoutOption("250 millis")
      )
      assert.equal(Option.isSome(published), true)
      const failure = published.value
      assert.equal(failure.message, "Terminal send failed")
      assert.equal(getterReads, 0)
      if (failureKind === "checked") {
        const checked = Cause.failureOption(failure.cause)
        assert.equal(Option.isSome(checked), true)
        assert.strictEqual(checked.value, hostile)
      } else {
        assert.strictEqual(Array.from(Cause.defects(failure.cause))[0], hostile)
      }
      assert.equal(getterReads, 0)
    }
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
    assert.equal(sent.filter((message) => message.id === largeId).length, 0)
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
      tool: new schemaApi.Tool({ name: "visible", inputSchema: { type: "object" } }),
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
        },
        traceparent: "00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01",
        tracestate: "vendor=value",
        baggage: "tenant=adapter-test"
      }
    }))
    yield* Queue.take(sendEvents)
    assert.equal(sent[0]._tag, "SuccessResponse")
    assert.strictEqual(sent[0].id, id)
    assert.deepEqual(sent[0].result.tools.map((tool) => tool.name), ["visible"])
    assert.equal(observedClients.length, 1)
    assert.equal(observedClients[0].traceparent, "00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01")
    assert.equal(observedClients[0].tracestate, "vendor=value")
    assert.equal(observedClients[0].baggage, "tenant=adapter-test")
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
    const invalidCancellation = yield* server.accept(notification("notifications/cancelled", {
      requestId: 1,
      reason: 123
    })).pipe(Effect.either)
    assert.equal(Either.isLeft(invalidCancellation), true)
    assert.equal(invalidCancellation.left._tag, "InvalidRequest")
    assert.equal(yield* contexts.get(1).isCancelled, false)
    assert.equal(sent.filter((message) => message.id === 1).length, 0)
    yield* server.accept(cancel(1))
    yield* server.accept(cancel(1))
    yield* server.accept(cancel("unknown"))
    assert.equal(yield* contexts.get(1).isCancelled, true)
    assert.equal(yield* contexts.get("1").isCancelled, false)
    assert.equal(sent.filter((message) => message.id === 1).length, 0)

    yield* Deferred.succeed(stringGate, undefined)
    yield* Queue.take(sendEvents)
    assert.equal(sent.filter((message) => message.id === "1").length, 1)
    yield* server.accept(cancel("1"))
    assert.equal(sent.filter((message) => message.id === "1").length, 1)
  })))
})

test("running cancellation interrupts immediately, emits no terminal, and releases after cleanup", async () => {
  const api = requireDispatcher()
  const sendCalls = []
  let handled = 0
  let context
  let writable = false
  await Effect.runPromise(Effect.scoped(Effect.gen(function*() {
    const handlerStarted = yield* Deferred.make()
    const handlerInterrupted = yield* Deferred.make()
    const releaseCleanup = yield* Deferred.make()
    const sendEvents = yield* Queue.unbounded()
    const server = yield* api.makeServerDispatcher({
      send: (message) => Effect.sync(() => { sendCalls.push(message) }).pipe(
        Effect.zipRight(writable
          ? Queue.offer(sendEvents, message).pipe(Effect.asVoid)
          : Effect.die("transport is not writable"))
      ),
      handle: () => {
        handled += 1
        if (handled > 1) return Effect.succeed({ resultType: "complete" })
        return Effect.gen(function*() {
          context = yield* api.McpRequestContext
          yield* Deferred.succeed(handlerStarted, undefined)
          yield* Effect.never
        }).pipe(Effect.onInterrupt(() => Deferred.succeed(handlerInterrupted, undefined).pipe(
          Effect.zipRight(Deferred.await(releaseCleanup))
        )))
      }
    })
    yield* server.accept(request("cancel-running", "tools/list", validParams()))
    yield* Deferred.await(handlerStarted)
    const cancelling = yield* server.accept(cancel("cancel-running")).pipe(Effect.forkScoped)
    yield* context.cancelled
    yield* Deferred.await(handlerInterrupted)

    const duplicateDuringCleanup = yield* server.accept(
      request("cancel-running", "tools/list", validParams())
    ).pipe(Effect.either)
    yield* Deferred.succeed(releaseCleanup, undefined)
    yield* Fiber.join(cancelling)
    yield* Effect.yieldNow()

    assert.equal(Either.isLeft(duplicateDuringCleanup), true)
    assert.equal(duplicateDuringCleanup.left._tag, "InvalidRequest")
    assert.equal(yield* context.isCancelled, true)
    assert.equal(sendCalls.length, 0)
    assert.equal(handled, 1)

    writable = true
    yield* server.accept(request("cancel-running", "tools/list", validParams()))
    yield* Queue.take(sendEvents)
    assert.equal(handled, 2)
    assert.equal(sendCalls.length, 1)
    assert.equal(sendCalls[0]._tag, "SuccessResponse")
    yield* server.accept(cancel("cancel-running"))
    assert.equal(sendCalls.length, 1)
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

test("owned dispatcher and direct client paths reject coercive or transport-owned state", () => {
  const dispatcherSource = (() => {
    try {
      return readFileSync(path.join(root, "src/McpDispatcher.ts"), "utf8")
    } catch {
      return ""
    }
  })()
  const clientSource = readFileSync(path.join(root, "src/McpClient.ts"), "utf8")
  const owned = `${dispatcherSource}\n${clientSource}`

  assert.match(dispatcherSource, /HashMap\.(?:empty|make)<JsonRpcId/)
  assert.match(dispatcherSource, /McpRequestContext/)
  assert.doesNotMatch(owned, /\b(?:String|Number)\s*\([^)]*(?:requestId|\bid\b)[^)]*\)/)
  assert.doesNotMatch(owned, /\bidStr\b|HashMap\.HashMap<string|new Map<string/)
  assert.doesNotMatch(owned, /!\s*(?:id|requestId)\b/)
  assert.doesNotMatch(dispatcherSource, /Effect\.runFork|runPromise|interface\s+JsonRpc/)
  assert.doesNotMatch(dispatcherSource, /Session|MCP-Session|Http|Stdio|ReadableStream|WebSocket/)
  assert.doesNotMatch(dispatcherSource, /Queue\.unbounded/, "production dispatch ownership must be bounded")
})
