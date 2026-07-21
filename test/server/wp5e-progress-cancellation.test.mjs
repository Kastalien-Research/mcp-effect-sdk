import assert from "node:assert/strict"
import { test } from "node:test"
import * as Cause from "effect/Cause"
import * as Deferred from "effect/Deferred"
import * as Effect from "effect/Effect"
import * as Either from "effect/Either"
import * as Fiber from "effect/Fiber"
import * as FiberId from "effect/FiberId"
import * as Option from "effect/Option"
import * as Queue from "effect/Queue"
import * as McpDispatcher from "../../dist/McpDispatcher.js"
import * as McpServer from "../../dist/server.js"

const request = (id, token, name = "progress") => ({
  _tag: "Request",
  jsonrpc: "2.0",
  id,
  method: "tools/call",
  params: {
    name,
    arguments: {},
    _meta: {
      "io.modelcontextprotocol/clientCapabilities": {},
      "io.modelcontextprotocol/protocolVersion": "2026-07-28",
      ...(token === undefined ? {} : { progressToken: token })
    }
  }
})

const cancel = (requestId) => ({
  _tag: "Notification",
  jsonrpc: "2.0",
  method: "notifications/cancelled",
  params: { requestId }
})

const extension = (marker) => ({
  _tag: "Notification",
  jsonrpc: "2.0",
  method: "example.com/raw-owned",
  params: { marker }
})

const makeProgressServer = (observeContext) => McpServer.make({
  serverInfo: { name: "wp5e-server", version: "1" },
  handlers: McpServer.registerTool({
    name: "progress",
    content: () => Effect.gen(function*() {
      if (observeContext !== undefined) yield* observeContext()
      yield* McpServer.sendProgress({ progress: 0, total: 1, message: "owned" })
      return "done"
    })
  })
})

const runRequest = (server, message) => Effect.scoped(Effect.gen(function*() {
  const sent = []
  const terminal = yield* Deferred.make()
  const dispatcher = yield* McpServer.makeDispatcher({
    send: (frame) => Effect.sync(() => { sent.push(frame) }).pipe(
      Effect.zipRight(frame._tag === "Notification"
        ? Effect.void
        : Deferred.succeed(terminal, undefined).pipe(Effect.asVoid))
    )
  }).pipe(Effect.provideService(McpServer.McpServer, server))
  yield* dispatcher.accept(message)
  yield* Deferred.await(terminal).pipe(Effect.timeout("1 second"))
  return sent
}))

test("stable sendProgress derives exact empty-string and zero tokens from a distinct request facade", async () => {
  assert.ok(McpServer.McpRequestContext, "stable McpRequestContext runtime facade must be exported")
  const observedKeys = []
  const server = await Effect.runPromise(makeProgressServer(() => Effect.gen(function*() {
    const context = yield* McpServer.McpRequestContext
    observedKeys.push(Object.keys(context).sort())
    assert.equal(Object.hasOwn(context, "notificationSink"), false)
  })))

  for (const [id, token] of [["empty", ""], [0, 0]]) {
    const sent = await Effect.runPromise(runRequest(server, request(id, token)))
    assert.deepEqual(sent.map((frame) => frame._tag), ["Notification", "SuccessResponse"])
    assert.equal(sent[0].method, "notifications/progress")
    assert.strictEqual(sent[0].params.progressToken, token)
    assert.equal(Object.hasOwn(sent[0].params, "_meta"), false)
    assert.strictEqual(sent[1].id, id)
  }
  assert.equal(observedKeys.length, 2)
  assert.equal(observedKeys.every((keys) => !keys.includes("notificationSink")), true)
})

test("missing and hostile facade tokens plus invalid updates fail typed before the owned sink", async (t) => {
  assert.ok(McpServer.McpRequestContext)
  const cases = [
    { name: "missing", progressToken: Option.none(), update: { progress: 1 } },
    { name: "fractional", progressToken: Option.some(1.5), update: { progress: 1 } },
    { name: "invalid update", progressToken: Option.some("valid"), update: { progress: Number.NaN } }
  ]
  for (const testCase of cases) await t.test(testCase.name, async () => {
    let writes = 0
    const fake = {
      progressToken: testCase.progressToken,
      reportProgress: () => Effect.sync(() => { writes += 1 })
    }
    const result = await Effect.runPromise(McpServer.sendProgress(testCase.update).pipe(
      Effect.provideService(McpServer.McpRequestContext, fake),
      Effect.either
    ))
    assert.equal(Either.isLeft(result), true)
    assert.equal(result.left._tag, "SchemaValidationError")
    assert.equal(writes, 0)
  })

  await t.test("hostile Option accessor is never invoked", async () => {
    let getterReads = 0
    let writes = 0
    const progressToken = { _tag: "Some" }
    Object.defineProperty(progressToken, "value", {
      enumerable: true,
      get() {
        getterReads += 1
        throw new Error("hostile-token")
      }
    })
    const result = await Effect.runPromise(McpServer.sendProgress({ progress: 1 }).pipe(
      Effect.provideService(McpServer.McpRequestContext, {
        progressToken,
        reportProgress: () => Effect.sync(() => { writes += 1 })
      }),
      Effect.either
    ))
    assert.equal(Either.isLeft(result), true)
    assert.equal(result.left._tag, "SchemaValidationError")
    assert.equal(getterReads, 0)
    assert.equal(writes, 0)
  })
})

test("owner-local gate orders a raw notification before terminal and rejects leaked post-terminal writes", async () => {
  const notificationEntered = await Effect.runPromise(Deferred.make())
  const releaseNotification = await Effect.runPromise(Deferred.make())
  const handlerEntered = await Effect.runPromise(Deferred.make())
  const releaseHandler = await Effect.runPromise(Deferred.make())
  const terminalSent = await Effect.runPromise(Deferred.make())
  let context
  const sent = []

  await Effect.runPromise(Effect.scoped(Effect.gen(function*() {
    const dispatcher = yield* McpDispatcher.makeServerDispatcher({
      send: (frame) => frame._tag === "Notification"
        ? Deferred.succeed(notificationEntered, undefined).pipe(
            Effect.zipRight(Deferred.await(releaseNotification)),
            Effect.zipRight(Effect.sync(() => { sent.push(frame) }))
          )
        : Effect.sync(() => { sent.push(frame) }).pipe(
            Effect.zipRight(Deferred.succeed(terminalSent, undefined)),
            Effect.asVoid
          ),
      handle: () => Effect.gen(function*() {
        context = yield* McpDispatcher.McpRequestContext
        yield* Deferred.succeed(handlerEntered, undefined)
        yield* Deferred.await(releaseHandler)
        return { resultType: "complete" }
      })
    })
    yield* dispatcher.accept(request("gate", "gate"))
    yield* Deferred.await(handlerEntered)
    const raw = yield* context.notificationSink(extension("before-terminal")).pipe(Effect.forkScoped)
    yield* Deferred.await(notificationEntered)
    yield* Deferred.succeed(releaseHandler, undefined)
    yield* Effect.yieldNow()
    assert.equal(Option.isNone(yield* Deferred.poll(terminalSent)), true,
      "terminal write overtook the request-owned notification")
    yield* Deferred.succeed(releaseNotification, undefined)
    yield* Fiber.join(raw)
    yield* Deferred.await(terminalSent)
    assert.deepEqual(sent.map((frame) => frame._tag), ["Notification", "SuccessResponse"])

    const late = yield* context.notificationSink(extension("after-terminal")).pipe(Effect.either)
    assert.equal(Either.isLeft(late), true)
    assert.equal(sent.length, 2)
  })))
})

test("stable cancellation facade stays exact and incoming cancellation interrupts without a terminal", async () => {
  assert.ok(McpServer.McpRequestContext)
  const started = await Effect.runPromise(Deferred.make())
  const interrupted = await Effect.runPromise(Deferred.make())
  let context
  const sent = []
  await Effect.runPromise(Effect.scoped(Effect.gen(function*() {
    const server = yield* McpServer.make({
      serverInfo: { name: "cancel", version: "1" },
      handlers: McpServer.registerTool({
        name: "cancel",
        content: () => Effect.gen(function*() {
          context = yield* McpServer.McpRequestContext
          yield* Deferred.succeed(started, undefined)
          yield* Effect.never
        }).pipe(Effect.onInterrupt(() => Deferred.succeed(interrupted, undefined).pipe(Effect.asVoid)))
      })
    })
    const dispatcher = yield* McpServer.makeDispatcher({
      send: (frame) => Effect.sync(() => { sent.push(frame) })
    }).pipe(Effect.provideService(McpServer.McpServer, server))
    yield* dispatcher.accept(request("cancel-owner", "token", "cancel"))
    yield* Deferred.await(started)
    assert.equal(yield* context.isCancelled, false)
    yield* dispatcher.accept(cancel("cancel-owner"))
    yield* context.cancelled
    yield* Deferred.await(interrupted)
    assert.equal(yield* context.isCancelled, true)
    yield* Effect.yieldNow()
    assert.deepEqual(sent, [])
  })))
})

test("stable progress failures retain complete Causes while interruption remains interruption", async (t) => {
  assert.ok(McpServer.McpRequestContext)
  const source = new Error("progress-sink-secret")
  const causes = [
    Cause.fail(source),
    Cause.die(source),
    Cause.parallel(Cause.fail(source), Cause.interrupt(FiberId.runtime(601, 1)))
  ]
  for (const original of causes) await t.test(original._tag, async () => {
    const exit = await Effect.runPromise(McpServer.sendProgress({ progress: 1 }).pipe(
      Effect.provideService(McpServer.McpRequestContext, {
        progressToken: Option.some("cause"),
        reportProgress: () => Effect.failCause(original)
      }),
      Effect.exit
    ))
    assert.equal(exit._tag, "Failure")
    const failure = Cause.failureOption(exit.cause)
    assert.equal(Option.isSome(failure), true)
    assert.equal(failure.value._tag, "SchemaValidationError")
    assert.strictEqual(failure.value.cause, original)
    assert.equal(Object.getOwnPropertyDescriptor(failure.value, "cause")?.enumerable, false)
    assert.equal(Cause.isInterrupted(exit.cause), Cause.isInterrupted(original))
  })
})

test("stable request facade keeps its authoritative progress token immutable to handlers", async () => {
  let facadeFrozen = false
  let tokenFrozen = false
  let mutationResult = true
  const server = await Effect.runPromise(McpServer.make({
    serverInfo: { name: "immutable-progress-token", version: "1" },
    handlers: McpServer.registerTool({
      name: "immutable-token",
      content: () => Effect.gen(function*() {
        const context = yield* McpServer.McpRequestContext
        facadeFrozen = Object.isFrozen(context)
        tokenFrozen = Object.isFrozen(context.progressToken)
        mutationResult = Reflect.set(context.progressToken, "value", "spoofed-owner")
        yield* McpServer.sendProgress({ progress: 1 })
        return "done"
      })
    })
  }))

  const sent = await Effect.runPromise(runRequest(server, request("immutable-token", "real-owner", "immutable-token")))
  assert.equal(facadeFrozen, true)
  assert.equal(tokenFrozen, true)
  assert.equal(mutationResult, false)
  assert.equal(sent[0].method, "notifications/progress")
  assert.equal(sent[0].params.progressToken, "real-owner")
})

test("server public progress inspection is exact-own-data and contains hostile traps", async (t) => {
  let getterReads = 0
  const inheritedUpdate = Object.create({ progress: 1 })
  const customPrototypeUpdate = Object.assign(Object.create({ marker: true }), { progress: 1 })
  const symbolUpdate = { progress: 1, [Symbol("extra")]: true }
  const accessorUpdate = {}
  Object.defineProperty(accessorUpdate, "progress", {
    enumerable: true,
    get() {
      getterReads += 1
      throw new Error("progress getter escaped")
    }
  })
  const inheritedToken = Object.assign(Object.create({ value: "owned" }), { _tag: "Some" })
  const cases = [
    { name: "inherited update", context: { progressToken: Option.some("owned"), reportProgress: () => Effect.void }, update: inheritedUpdate },
    { name: "custom update prototype", context: { progressToken: Option.some("owned"), reportProgress: () => Effect.void }, update: customPrototypeUpdate },
    { name: "symbol update", context: { progressToken: Option.some("owned"), reportProgress: () => Effect.void }, update: symbolUpdate },
    { name: "accessor update", context: { progressToken: Option.some("owned"), reportProgress: () => Effect.void }, update: accessorUpdate },
    { name: "inherited token value", context: { progressToken: inheritedToken, reportProgress: () => Effect.void }, update: { progress: 1 } },
    {
      name: "update ownKeys trap",
      context: { progressToken: Option.some("owned"), reportProgress: () => Effect.void },
      update: new Proxy({}, { ownKeys() { throw new Error("ownKeys escaped") } })
    },
    {
      name: "update descriptor trap",
      context: { progressToken: Option.some("owned"), reportProgress: () => Effect.void },
      update: new Proxy({ progress: 1 }, { getOwnPropertyDescriptor() { throw new Error("descriptor escaped") } })
    },
    {
      name: "update prototype trap",
      context: { progressToken: Option.some("owned"), reportProgress: () => Effect.void },
      update: new Proxy({ progress: 1 }, { getPrototypeOf() { throw new Error("prototype escaped") } })
    },
    {
      name: "token descriptor trap",
      context: {
        progressToken: new Proxy({ _tag: "Some", value: "owned" }, {
          getOwnPropertyDescriptor() { throw new Error("token descriptor escaped") }
        }),
        reportProgress: () => Effect.void
      },
      update: { progress: 1 }
    },
    {
      name: "context get trap",
      context: new Proxy({ progressToken: Option.some("owned"), reportProgress: () => Effect.void }, {
        get() { throw new Error("context get escaped") }
      }),
      update: { progress: 1 }
    }
  ]

  for (const testCase of cases) await t.test(testCase.name, async () => {
    let writes = 0
    const base = testCase.context
    const context = base instanceof Object && !Object.hasOwn(base, "reportProgress")
      ? base
      : new Proxy(base, {
          getOwnPropertyDescriptor(target, property) {
            if (property === "reportProgress") {
              return { configurable: true, enumerable: true, writable: true, value: () => Effect.sync(() => { writes += 1 }) }
            }
            return Reflect.getOwnPropertyDescriptor(target, property)
          }
        })
    const exit = await Effect.runPromise(McpServer.sendProgress(testCase.update).pipe(
      Effect.provideService(McpServer.McpRequestContext, context),
      Effect.exit
    ))
    assert.equal(exit._tag, "Failure")
    const failure = Cause.failureOption(exit.cause)
    assert.equal(Option.isSome(failure), true)
    assert.equal(failure.value._tag, "SchemaValidationError")
    assert.equal(Option.isNone(Cause.dieOption(exit.cause)), true)
    assert.equal(writes, 0)
  })
  assert.equal(getterReads, 0)
})

test("cancellation waits for an already-owned notification send before exposing its signal", async () => {
  const handlerEntered = await Effect.runPromise(Deferred.make())
  const notificationEntered = await Effect.runPromise(Deferred.make())
  const releaseNotification = await Effect.runPromise(Deferred.make())
  const cancellationReturned = await Effect.runPromise(Deferred.make())
  const handlerInterrupted = await Effect.runPromise(Deferred.make())
  let context
  const sent = []

  await Effect.runPromise(Effect.scoped(Effect.gen(function*() {
    const dispatcher = yield* McpDispatcher.makeServerDispatcher({
      send: (frame) => frame._tag === "Notification"
        ? Effect.uninterruptible(Deferred.succeed(notificationEntered, undefined).pipe(
            Effect.zipRight(Deferred.await(releaseNotification)),
            Effect.zipRight(Effect.sync(() => { sent.push(frame) }))
          ))
        : Effect.sync(() => { sent.push(frame) }),
      handle: () => Effect.gen(function*() {
        context = yield* McpDispatcher.McpRequestContext
        yield* Deferred.succeed(handlerEntered, undefined)
        yield* Effect.never
      }).pipe(Effect.onInterrupt(() => Deferred.succeed(handlerInterrupted, undefined).pipe(Effect.asVoid)))
    })
    yield* dispatcher.accept(request("cancel-drain", "owned"))
    yield* Deferred.await(handlerEntered)
    const raw = yield* context.notificationSink(extension("committed-before-cancel")).pipe(Effect.forkScoped)
    yield* Deferred.await(notificationEntered)
    const cancelling = yield* dispatcher.accept(cancel("cancel-drain")).pipe(
      Effect.tap(() => Deferred.succeed(cancellationReturned, undefined)),
      Effect.forkScoped
    )
    yield* Effect.yieldNow()
    const cancellationVisibleEarly = yield* context.isCancelled
    const cancellationReturnedEarly = Option.isSome(yield* Deferred.poll(cancellationReturned))
    const sentEarly = sent.length
    yield* Deferred.succeed(releaseNotification, undefined)
    yield* Fiber.join(raw)
    yield* Fiber.join(cancelling)
    yield* context.cancelled
    yield* Deferred.await(handlerInterrupted)
    assert.equal(cancellationVisibleEarly, false)
    assert.equal(cancellationReturnedEarly, false)
    assert.equal(sentEarly, 0)
    assert.equal(sent.length, 1)
    assert.equal(sent[0].params.marker, "committed-before-cancel")
    const late = yield* context.notificationSink(extension("after-cancel")).pipe(Effect.either)
    assert.equal(Either.isLeft(late), true)
    assert.equal(sent.length, 1)
  })))
})

test("interrupting cancellation cannot orphan a pending cancellation claim", async () => {
  const handlerEntered = await Effect.runPromise(Deferred.make())
  const notificationEntered = await Effect.runPromise(Deferred.make())
  const releaseNotification = await Effect.runPromise(Deferred.make())
  const handlerInterrupted = await Effect.runPromise(Deferred.make())
  let context

  await Effect.runPromise(Effect.scoped(Effect.gen(function*() {
    const dispatcher = yield* McpDispatcher.makeServerDispatcher({
      send: (frame) => frame._tag === "Notification"
        ? Effect.uninterruptible(Deferred.succeed(notificationEntered, undefined).pipe(
            Effect.zipRight(Deferred.await(releaseNotification))
          ))
        : Effect.void,
      handle: () => Effect.gen(function*() {
        context = yield* McpDispatcher.McpRequestContext
        yield* Deferred.succeed(handlerEntered, undefined)
        yield* Effect.never
      }).pipe(Effect.onInterrupt(() => Deferred.succeed(handlerInterrupted, undefined).pipe(Effect.asVoid)))
    })
    yield* dispatcher.accept(request("cancel-interrupted", "owned"))
    yield* Deferred.await(handlerEntered)
    const raw = yield* context.notificationSink(extension("blocking")).pipe(Effect.forkScoped)
    yield* Deferred.await(notificationEntered)
    const cancelling = yield* dispatcher.accept(cancel("cancel-interrupted")).pipe(Effect.forkScoped)
    yield* Effect.yieldNow()
    yield* Fiber.interruptFork(cancelling)
    const cancellationVisibleEarly = yield* context.isCancelled
    yield* Deferred.succeed(releaseNotification, undefined)
    yield* Fiber.join(raw)
    yield* context.cancelled.pipe(Effect.timeout("1 second"))
    yield* Deferred.await(handlerInterrupted).pipe(Effect.timeout("1 second"))
    assert.equal(cancellationVisibleEarly, false)
    assert.equal(yield* context.isCancelled, true)
  })))
})
