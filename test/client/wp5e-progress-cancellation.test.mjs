import assert from "node:assert/strict"
import { test } from "node:test"
import * as Cause from "effect/Cause"
import * as Deferred from "effect/Deferred"
import * as Effect from "effect/Effect"
import * as Either from "effect/Either"
import * as Fiber from "effect/Fiber"
import * as FiberId from "effect/FiberId"
import * as Option from "effect/Option"
import * as Stream from "effect/Stream"
import * as McpClient from "../../dist/client.js"
import { runLoggingProgressCancellationClient } from "../../dist/examples/core-protocol-catalog.js"

const success = (request, result) => ({
  _tag: "Success",
  response: { _tag: "SuccessResponse", jsonrpc: "2.0", id: request.id, result }
})

const progress = (token, value, extra = {}) => ({
  _tag: "Notification",
  notification: {
    _tag: "Notification",
    jsonrpc: "2.0",
    method: "notifications/progress",
    params: { progressToken: token, progress: value, ...extra }
  }
})

const extension = (marker) => ({
  _tag: "Notification",
  notification: {
    _tag: "Notification",
    jsonrpc: "2.0",
    method: "example.com/progress-marker",
    params: { marker }
  }
})

const discoverResult = (capabilities = { tools: {}, resources: {}, prompts: {}, completions: {} }) => ({
  resultType: "complete",
  supportedVersions: ["2026-07-28"],
  capabilities,
  ttlMs: 0,
  cacheScope: "private",
  _meta: { "io.modelcontextprotocol/serverInfo": { name: "wp5e", version: "1" } }
})

const resultFor = (request) => request.method === "tools/call"
  ? { resultType: "complete", content: [] }
  : request.method === "tools/list"
    ? { resultType: "complete", tools: [], ttlMs: 0, cacheScope: "private" }
    : request.method === "resources/list"
      ? { resultType: "complete", resources: [], ttlMs: 0, cacheScope: "private" }
      : request.method === "resources/templates/list"
        ? { resultType: "complete", resourceTemplates: [], ttlMs: 0, cacheScope: "private" }
        : request.method === "resources/read"
          ? { resultType: "complete", contents: [], ttlMs: 0, cacheScope: "private" }
          : request.method === "prompts/list"
            ? { resultType: "complete", prompts: [], ttlMs: 0, cacheScope: "private" }
            : request.method === "prompts/get"
              ? { resultType: "complete", messages: [] }
              : request.method === "completion/complete"
                ? { resultType: "complete", completion: { values: [] } }
                : { resultType: "complete", _meta: { "io.modelcontextprotocol/subscriptionId": request.id } }

const makeClient = (request) => McpClient.make({
  transport: { request },
  clientInfo: { name: "wp5e-client", version: "1" }
})

test("per-method progress options inject an exact token and consume ordered progress with stream backpressure", async () => {
  const requests = []
  const order = []
  let callbackActive = false
  const client = await Effect.runPromise(Effect.scoped(Effect.gen(function*() {
    const value = yield* makeClient((request) => {
      requests.push(request)
      if (request.method === "server/discover") return Stream.succeed(success(request, discoverResult()))
      return Stream.make(
        progress("", 0, { total: 2, message: "zero" }),
        progress("", 1, { total: 2, message: "one" }),
        extension("after-progress"),
        success(request, resultFor(request))
      )
    })
    yield* value.notifications.onFallback((notification) => Effect.sync(() => {
      assert.equal(callbackActive, false, "global dispatch raced the progress callback")
      order.push(`global:${notification.method}`)
    }))
    const result = yield* value.callTool({ name: "ordered", arguments: {} }, {
      progress: {
        token: "",
        onProgress: (notification) => Effect.gen(function*() {
          assert.equal(callbackActive, false)
          callbackActive = true
          order.push(`callback:${notification.progress}`)
          yield* Effect.yieldNow()
          callbackActive = false
        })
      }
    })
    return { result, value }
  })))

  assert.deepEqual(client.result.content, [])
  assert.strictEqual(requests[1].params._meta.progressToken, "")
  assert.equal(Object.hasOwn(requests[1].params, "progressToken"), false)
  assert.deepEqual(order, [
    "callback:0",
    "global:notifications/progress",
    "callback:1",
    "global:notifications/progress",
    "global:example.com/progress-marker"
  ])
})

test("active progress tokens are strict type-sensitive reservations released on every exit", async () => {
  const firstSent = await Effect.runPromise(Deferred.make())
  let targetSends = 0
  const exits = []
  await Effect.runPromise(Effect.scoped(Effect.gen(function*() {
    const client = yield* makeClient((request) => {
      if (request.method === "server/discover") return Stream.succeed(success(request, discoverResult()))
      targetSends += 1
      if (targetSends === 1) {
        return Stream.unwrapScoped(Effect.gen(function*() {
          yield* Effect.addFinalizer(() => Effect.sync(() => { exits.push(request.id) }))
          yield* Deferred.succeed(firstSent, undefined)
          return Stream.never
        }))
      }
      return Stream.succeed(success(request, resultFor(request)))
    })
    const first = yield* client.callTool({ name: "first", arguments: {} }, {
      progress: { token: 1 }
    }).pipe(Effect.forkScoped)
    yield* Deferred.await(firstSent)

    const duplicate = yield* client.callTool({ name: "duplicate", arguments: {} }, {
      progress: { token: 1 }
    }).pipe(Effect.either)
    assert.equal(Either.isLeft(duplicate), true)
    assert.equal(duplicate.left._tag, "McpClientError")
    assert.equal(duplicate.left.reason, "Protocol")
    assert.equal(targetSends, 1, "duplicate token reached the target transport")

    yield* Fiber.interrupt(first)
    assert.deepEqual(exits.length, 1)
    yield* client.callTool({ name: "reused", arguments: {} }, {
      progress: { token: 1 }
    })
    yield* client.callTool({ name: "textual", arguments: {} }, {
      progress: { token: "1" }
    })
    assert.equal(targetSends, 3)
  })))
})

test("progress options are snapshotted and validated before target providers or transport effects", async () => {
  let targetProviderCalls = 0
  let targetSends = 0
  const hostile = {}
  let getterReads = 0
  Object.defineProperty(hostile, "progress", {
    enumerable: true,
    get() {
      getterReads += 1
      throw new Error("hostile-progress-options")
    }
  })
  const invalidTokens = [null, 1.5, Number.NaN, Number.POSITIVE_INFINITY, {}, []]

  await Effect.runPromise(Effect.scoped(Effect.gen(function*() {
    const client = yield* McpClient.make({
      capabilities: ({ method }) => Effect.sync(() => {
        if (method !== "server/discover") targetProviderCalls += 1
        return {}
      }),
      transport: {
        request: (request) => {
          if (request.method === "server/discover") return Stream.succeed(success(request, discoverResult()))
          targetSends += 1
          return Stream.succeed(success(request, resultFor(request)))
        }
      }
    })

    const hostileResult = yield* client.listTools({}, hostile).pipe(Effect.either)
    assert.equal(Either.isLeft(hostileResult), true)
    assert.equal(hostileResult.left.reason, "Protocol")
    assert.equal(getterReads, 0, "progress options accessor was invoked")

    for (const token of invalidTokens) {
      const invalid = yield* client.listTools({}, { progress: { token } }).pipe(Effect.either)
      assert.equal(Either.isLeft(invalid), true, `accepted invalid token ${String(token)}`)
      assert.equal(invalid.left.reason, "Protocol")
    }
    assert.equal(targetProviderCalls, 0)
    assert.equal(targetSends, 0)
  })))
})

test("malformed, mismatched, subscription-owned, and post-terminal progress stays request-owned", async (t) => {
  const cases = [
    {
      name: "malformed",
      frames: (request) => [progress("owned", "not-a-number"), success(request, resultFor(request))]
    },
    {
      name: "mismatched",
      frames: (request) => [progress("other", 1), success(request, resultFor(request))]
    },
    {
      name: "subscription-owned",
      frames: (request) => [progress("owned", 1, {
        _meta: { "io.modelcontextprotocol/subscriptionId": request.id }
      }), success(request, resultFor(request))]
    },
    {
      name: "post-terminal",
      frames: (request) => [success(request, resultFor(request)), progress("owned", 1)]
    }
  ]

  for (const testCase of cases) await t.test(testCase.name, async () => {
    const observed = []
    const callbacks = []
    const outcome = await Effect.runPromise(Effect.scoped(Effect.gen(function*() {
      const client = yield* makeClient((request) => request.method === "server/discover"
        ? Stream.succeed(success(request, discoverResult()))
        : Stream.make(...testCase.frames(request)))
      yield* client.notifications.onFallback((message) => Effect.sync(() => observed.push(message)))
      return yield* client.listTools({}, {
        progress: {
          token: "owned",
          onProgress: (value) => Effect.sync(() => { callbacks.push(value) })
        }
      }).pipe(Effect.either)
    })))
    assert.equal(Either.isLeft(outcome), true)
    assert.equal(outcome.left._tag, "McpClientError")
    assert.equal(outcome.left.reason, "Protocol")
    assert.deepEqual(callbacks, [])
    assert.deepEqual(observed, [])
  })

  await t.test("request-bound extension remains globally visible but never enters progress callback", async () => {
    const observed = []
    const callbacks = []
    await Effect.runPromise(Effect.scoped(Effect.gen(function*() {
      const client = yield* makeClient((request) => request.method === "server/discover"
        ? Stream.succeed(success(request, discoverResult()))
        : Stream.make(extension("visible"), success(request, resultFor(request))))
      yield* client.notifications.onFallback((message) => Effect.sync(() => observed.push(message.method)))
      yield* client.listTools({}, {
        progress: {
          token: "owned",
          onProgress: (value) => Effect.sync(() => { callbacks.push(value) })
        }
      })
    })))
    assert.deepEqual(callbacks, [])
    assert.deepEqual(observed, ["example.com/progress-marker"])
  })
})

test("progress callback failures retain complete Causes and interruption composition", async (t) => {
  const source = new Error("callback-secret")
  const causes = [
    Cause.fail(source),
    Cause.die(source),
    Cause.parallel(Cause.fail(source), Cause.interrupt(FiberId.runtime(501, 1)))
  ]
  for (const original of causes) await t.test(original._tag, async () => {
    let finalized = 0
    const exit = await Effect.runPromise(Effect.scoped(Effect.gen(function*() {
      const client = yield* makeClient((request) => {
        if (request.method === "server/discover") return Stream.succeed(success(request, discoverResult()))
        return Stream.unwrapScoped(Effect.gen(function*() {
          yield* Effect.addFinalizer(() => Effect.sync(() => { finalized += 1 }))
          return Stream.make(progress("cause", 1), success(request, resultFor(request)))
        }))
      })
      return yield* client.listTools({}, {
        progress: { token: "cause", onProgress: () => Effect.failCause(original) }
      }).pipe(Effect.exit)
    })))
    assert.equal(exit._tag, "Failure")
    const failure = Cause.failureOption(exit.cause)
    assert.equal(Option.isSome(failure), true)
    assert.equal(failure.value._tag, "McpClientError")
    assert.strictEqual(failure.value.cause, original)
    const descriptor = Object.getOwnPropertyDescriptor(failure.value, "cause")
    assert.equal(descriptor?.enumerable, false)
    assert.equal(Cause.isInterrupted(exit.cause), Cause.isInterrupted(original))
    assert.equal(finalized, 1)
  })
})

test("direct high-level interruption finalizes the sole transport stream once without a cancel echo", async () => {
  const targetSent = await Effect.runPromise(Deferred.make())
  let finalized = 0
  let targetSends = 0
  const exit = await Effect.runPromise(Effect.scoped(Effect.gen(function*() {
    const client = yield* makeClient((request) => {
      if (request.method === "server/discover") return Stream.succeed(success(request, discoverResult()))
      targetSends += 1
      return Stream.unwrapScoped(Effect.gen(function*() {
        yield* Effect.addFinalizer(() => Effect.sync(() => { finalized += 1 }))
        yield* Deferred.succeed(targetSent, undefined)
        return Stream.never
      }))
    })
    const fiber = yield* client.listTools({}, { progress: { token: 0 } }).pipe(Effect.forkScoped)
    yield* Deferred.await(targetSent)
    return yield* Fiber.interrupt(fiber)
  })))
  assert.equal(exit._tag, "Failure")
  assert.equal(Cause.isInterruptedOnly(exit.cause), true)
  assert.equal(finalized, 1)
  assert.equal(targetSends, 1)
})

test("ordinary transport McpClientError cannot impersonate a progress callback wrapper", async () => {
  const source = new Error("transport-source")
  const originalCause = Cause.fail(source)
  const original = new McpClient.McpClientError({
    reason: "Transport",
    message: "Progress callback failed",
    cause: originalCause
  })
  const outcome = await Effect.runPromise(Effect.scoped(Effect.gen(function*() {
    const client = yield* makeClient((request) => request.method === "server/discover"
      ? Stream.succeed(success(request, discoverResult()))
      : Stream.fail(original))
    return yield* client.listTools({}, {
      progress: { token: "ordinary-transport" }
    }).pipe(Effect.either)
  })))
  assert.equal(Either.isLeft(outcome), true)
  assert.strictEqual(outcome.left, original)
  assert.equal(outcome.left.reason, "Transport")
  assert.strictEqual(outcome.left.cause, originalCause)
})

test("progress callback cause restoration remains stack-safe and preserves shared Cause identity", async (t) => {
  const source = new Error("deep-callback-source")
  let deep = Cause.fail(source)
  for (let index = 0; index < 20_000; index += 1) {
    deep = Cause.sequential(deep, Cause.fail(source))
  }
  const shared = Cause.parallel(
    Cause.fail(source),
    Cause.interrupt(FiberId.runtime(702, 1))
  )
  const dag = Cause.sequential(shared, shared)

  for (const [name, original] of [["20k sequential", deep], ["shared DAG", dag]]) {
    await t.test(name, async () => {
      const exit = await Effect.runPromise(Effect.scoped(Effect.gen(function*() {
        const client = yield* makeClient((request) => request.method === "server/discover"
          ? Stream.succeed(success(request, discoverResult()))
          : Stream.make(progress("deep", 1), success(request, resultFor(request))))
        return yield* client.listTools({}, {
          progress: { token: "deep", onProgress: () => Effect.failCause(original) }
        }).pipe(Effect.exit)
      })))
      assert.equal(exit._tag, "Failure")
      const failure = Cause.failureOption(exit.cause)
      assert.equal(Option.isSome(failure), true)
      assert.equal(failure.value._tag, "McpClientError")
      assert.strictEqual(failure.value.cause, original)
    })
  }
})

test("logging progress cancellation example supplies a real progress option", async () => {
  let captured
  const client = {
    callTool: (params, options) => Effect.sync(() => {
      captured = { params, options }
      return { resultType: "complete", content: [] }
    })
  }
  await Effect.runPromise(runLoggingProgressCancellationClient(client))
  assert.equal(captured.params.name, "logged_progress")
  assert.equal(captured.options.progress.token, "core-progress")
  assert.equal(typeof captured.options.progress.onProgress, "function")
})
