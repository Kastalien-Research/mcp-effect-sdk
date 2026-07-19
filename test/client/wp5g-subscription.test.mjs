import assert from "node:assert/strict"
import { fileURLToPath } from "node:url"
import test from "node:test"
import * as Cause from "effect/Cause"
import * as Chunk from "effect/Chunk"
import * as Deferred from "effect/Deferred"
import * as Effect from "effect/Effect"
import * as Either from "effect/Either"
import * as Exit from "effect/Exit"
import * as FiberId from "effect/FiberId"
import * as Stream from "effect/Stream"
import * as McpClient from "../../dist/McpClient.js"
import { InvalidRequest, TransportError } from "../../dist/McpErrors.js"
import * as StdioClientTransport from "../../dist/transport/StdioClientTransport.js"
import * as StreamableHttpClientTransport from "../../dist/transport/StreamableHttpClientTransport.js"

const success = (request, result) => ({
  _tag: "Success",
  response: { _tag: "SuccessResponse", jsonrpc: "2.0", id: request.id, result }
})

const error = (request, code = -32603, message = "subscription failed") => ({
  _tag: "Error",
  response: { _tag: "ErrorResponse", jsonrpc: "2.0", id: request.id, error: { code, message } }
})

const notification = (method, params = {}) => ({
  _tag: "Notification",
  notification: { _tag: "Notification", jsonrpc: "2.0", method, params }
})

const discoverResult = (capabilities = { resources: {}, tools: {}, prompts: {} }) => ({
  resultType: "complete",
  supportedVersions: ["2026-07-28"],
  capabilities,
  _meta: {
    "io.modelcontextprotocol/serverInfo": { name: "wp5g-test", version: "1.0.0" }
  },
  ttlMs: 0,
  cacheScope: "private"
})

const acknowledgement = (request, notifications = {}) => notification(
  "notifications/subscriptions/acknowledged",
  {
    notifications,
    _meta: { "io.modelcontextprotocol/subscriptionId": request.id }
  }
)

const changed = (request, method, params = {}) => notification(method, {
  ...params,
  _meta: { "io.modelcontextprotocol/subscriptionId": request.id }
})

const graceful = (request) => success(request, {
  resultType: "complete",
  _meta: { "io.modelcontextprotocol/subscriptionId": request.id }
})

const makeTransport = (subscription) => ({
  request: (request) => request.method === "server/discover"
    ? Stream.succeed(success(request, discoverResult()))
    : subscription(request)
})

const makeClient = (transport) => McpClient.make({
  transport,
  clientInfo: { name: "wp5g-client", version: "1.0.0" }
})

const runScoped = (effect, timeout = "2 seconds") => Effect.runPromise(
  Effect.scoped(effect).pipe(Effect.timeout(timeout))
)

test("subscription resolves on acknowledgement, snapshots the honored filter, and close is idempotent", async () => {
  const released = await Effect.runPromise(Deferred.make())
  const transport = makeTransport((request) => Stream.unwrapScoped(Effect.gen(function*() {
    yield* Effect.addFinalizer(() => Deferred.succeed(released, undefined).pipe(Effect.asVoid))
    return Stream.make(acknowledgement(request, {
      resourcesListChanged: true,
      resourceSubscriptions: ["file:///one"]
    })).pipe(Stream.concat(Stream.never))
  })))

  await runScoped(Effect.gen(function*() {
    const client = yield* makeClient(transport)
    const subscription = yield* client.subscriptionsListen({
      toolsListChanged: true,
      resourcesListChanged: true,
      resourceSubscriptions: ["file:///one", "file:///two"]
    })
    assert.deepEqual(subscription.acknowledgedFilter, {
      resourcesListChanged: true,
      resourceSubscriptions: ["file:///one"]
    })
    assert.equal(Object.isFrozen(subscription.acknowledgedFilter), true)
    assert.equal(Object.isFrozen(subscription.acknowledgedFilter.resourceSubscriptions), true)
    yield* Effect.all([subscription.close, subscription.close], { concurrency: "unbounded" })
    assert.deepEqual(yield* subscription.closed, { _tag: "CallerClosed" })
    yield* Deferred.await(released)
  }), "500 millis")
})

test("typed notification streams remain isolated while subscriptions interleave", async () => {
  const transport = makeTransport((request) => request.id === 2
    ? Stream.make(
        acknowledgement(request, { toolsListChanged: true }),
        changed(request, "notifications/tools/list_changed"),
        graceful(request)
      )
    : Stream.make(
        acknowledgement(request, { resourcesListChanged: true }),
        changed(request, "notifications/resources/list_changed"),
        graceful(request)
      ))

  await runScoped(Effect.gen(function*() {
    const client = yield* makeClient(transport)
    const [tools, resources] = yield* Effect.all([
      client.subscriptionsListen({ toolsListChanged: true }),
      client.subscriptionsListen({ resourcesListChanged: true })
    ], { concurrency: "unbounded" })
    const [toolEvents, resourceEvents] = yield* Effect.all([
      tools.notifications.pipe(Stream.runCollect),
      resources.notifications.pipe(Stream.runCollect)
    ], { concurrency: "unbounded" })
    assert.deepEqual(Chunk.toReadonlyArray(toolEvents).map(({ method }) => method), [
      "notifications/tools/list_changed"
    ])
    assert.deepEqual(Chunk.toReadonlyArray(resourceEvents).map(({ method }) => method), [
      "notifications/resources/list_changed"
    ])
    assert.equal((yield* tools.closed)._tag, "Graceful")
    assert.equal((yield* resources.closed)._tag, "Graceful")
  }))
})

test("a generated terminal is graceful and ends the notification stream", async () => {
  const transport = makeTransport((request) => Stream.make(
    acknowledgement(request),
    graceful(request)
  ))

  await runScoped(Effect.gen(function*() {
    const client = yield* makeClient(transport)
    const subscription = yield* client.subscriptionsListen()
    assert.deepEqual(Chunk.toReadonlyArray(yield* Stream.runCollect(subscription.notifications)), [])
    const closure = yield* subscription.closed
    assert.equal(closure._tag, "Graceful")
    assert.equal(closure.result.resultType, "complete")
  }))
})

test("a post-terminal frame is ProtocolError unless caller close already won", async () => {
  const terminalSeen = await Effect.runPromise(Deferred.make())
  const releasePostTerminal = await Effect.runPromise(Deferred.make())
  let request
  const transport = makeTransport((current) => {
    request = current
    return Stream.make(acknowledgement(current), graceful(current)).pipe(
      Stream.concat(Stream.fromEffect(
        Deferred.succeed(terminalSeen, undefined).pipe(
          Effect.zipRight(Deferred.await(releasePostTerminal)),
          Effect.as(changed(current, "notifications/tools/list_changed"))
        )
      ))
    )
  })

  await runScoped(Effect.gen(function*() {
    const client = yield* makeClient(transport)
    const subscription = yield* client.subscriptionsListen()
    yield* Deferred.await(terminalSeen)
    yield* subscription.close
    yield* Deferred.succeed(releasePostTerminal, undefined)
    assert.equal((yield* subscription.closed)._tag, "Graceful")
  }))

  const postTerminal = makeTransport(() => Stream.make(
    acknowledgement(request),
    graceful(request),
    changed(request, "notifications/tools/list_changed")
  ))
  await runScoped(Effect.gen(function*() {
    const client = yield* makeClient(postTerminal)
    const subscription = yield* client.subscriptionsListen()
    const closure = yield* subscription.closed
    assert.equal(closure._tag, "ProtocolError")
    assert.equal(closure.error.reason, "Frame")
  }))
})

test("terminal-pending teardown failure is graceful", async () => {
  const transport = makeTransport((request) => Stream.make(
    acknowledgement(request),
    graceful(request)
  ).pipe(Stream.concat(Stream.fail(new TransportError({ message: "teardown failed" })))))

  await runScoped(Effect.gen(function*() {
    const client = yield* makeClient(transport)
    const subscription = yield* client.subscriptionsListen()
    assert.equal((yield* subscription.closed)._tag, "Graceful")
  }))
})

test("EOF after acknowledgement is an abrupt UnexpectedEnd closure", async () => {
  const transport = makeTransport((request) => Stream.succeed(acknowledgement(request)))

  await runScoped(Effect.gen(function*() {
    const client = yield* makeClient(transport)
    const subscription = yield* client.subscriptionsListen()
    const closure = yield* subscription.closed
    assert.equal(closure._tag, "Abrupt")
    assert.equal(closure.error._tag, "SubscriptionAbruptError")
    assert.equal(closure.error.reason, "UnexpectedEnd")
    assert.equal(Object.prototype.propertyIsEnumerable.call(closure.error, "cause"), false)
    const drained = yield* Stream.runDrain(subscription.notifications).pipe(Effect.exit)
    assert.equal(Exit.isFailure(drained), true)
  }))
})

test("unselected and malformed frames close only their owner as ProtocolError", async () => {
  const transport = makeTransport((request) => Stream.make(
    acknowledgement(request, { toolsListChanged: true }),
    changed(request, "notifications/resources/list_changed"),
    error(request)
  ))

  await runScoped(Effect.gen(function*() {
    const client = yield* makeClient(transport)
    const subscription = yield* client.subscriptionsListen({ toolsListChanged: true })
    const closure = yield* subscription.closed
    assert.equal(closure._tag, "ProtocolError")
    assert.equal(closure.error._tag, "SubscriptionProtocolError")
    assert.equal(closure.error.reason, "Frame")
    assert.equal(Object.prototype.propertyIsEnumerable.call(closure.error, "cause"), false)
  }))
})

test("transport failure retains mixed Cause topology and interruption", async () => {
  const marker = new Error("socket failed")
  const originalCause = Cause.parallel(
    Cause.fail(marker),
    Cause.interrupt(FiberId.none)
  )
  const original = new TransportError({ message: "socket failed", cause: originalCause })
  const transport = makeTransport((request) => Stream.make(acknowledgement(request)).pipe(
    Stream.concat(Stream.fail(original))
  ))

  await runScoped(Effect.gen(function*() {
    const client = yield* makeClient(transport)
    const subscription = yield* client.subscriptionsListen()
    const closure = yield* subscription.closed
    assert.equal(closure._tag, "Abrupt")
    assert.equal(closure.error.reason, "Transport")
    assert.strictEqual(closure.error.cause, originalCause)
    yield* subscription.close
    assert.equal((yield* subscription.closed)._tag, "Abrupt")
  }))
})

test("pure transport interruption is Abrupt while notifications terminate by interruption", async () => {
  const transport = makeTransport((request) => Stream.make(acknowledgement(request)).pipe(
    Stream.concat(Stream.fromEffect(Effect.interrupt))
  ))

  await runScoped(Effect.gen(function*() {
    const client = yield* makeClient(transport)
    const subscription = yield* client.subscriptionsListen()
    const closure = yield* subscription.closed
    assert.equal(closure._tag, "Abrupt")
    assert.equal(closure.error.reason, "Transport")
    assert.equal(Cause.isInterruptedOnly(closure.error.cause), true)
    const drained = yield* Stream.runDrain(subscription.notifications).pipe(Effect.exit)
    assert.equal(Exit.isInterrupted(drained), true)
  }))
})

test("caller close wins before a gated transport failure", async () => {
  const armed = await Effect.runPromise(Deferred.make())
  const release = await Effect.runPromise(Deferred.make())
  const transport = makeTransport((request) => Stream.make(acknowledgement(request)).pipe(
    Stream.concat(Stream.fromEffect(
      Deferred.succeed(armed, undefined).pipe(
        Effect.zipRight(Deferred.await(release)),
        Effect.zipRight(Effect.fail(new TransportError({ message: "late failure" })))
      )
    ))
  ))

  await runScoped(Effect.gen(function*() {
    const client = yield* makeClient(transport)
    const subscription = yield* client.subscriptionsListen()
    yield* Deferred.await(armed)
    yield* subscription.close
    yield* Deferred.succeed(release, undefined)
    assert.deepEqual(yield* subscription.closed, { _tag: "CallerClosed" })
  }))
})

test("bounded delivery reserves terminal capacity when notifications are unconsumed", async () => {
  const transport = makeTransport((request) => Stream.make(
    acknowledgement(request, { toolsListChanged: true }),
    ...Array.from({ length: 17 }, () => changed(request, "notifications/tools/list_changed"))
  ).pipe(Stream.concat(Stream.never)))

  await runScoped(Effect.gen(function*() {
    const client = yield* makeClient(transport)
    const subscription = yield* client.subscriptionsListen({ toolsListChanged: true })
    const closure = yield* subscription.closed
    assert.equal(closure._tag, "Abrupt")
    assert.equal(closure.error.reason, "Overflow")
    yield* subscription.close
    assert.equal((yield* subscription.closed)._tag, "Abrupt")
  }), "500 millis")
})

test("hostile filters fail before providers, IDs, or transport subscription effects", async () => {
  let providerCalls = 0
  let subscriptionCalls = 0
  const transport = makeTransport((request) => {
    subscriptionCalls += 1
    return Stream.make(acknowledgement(request), graceful(request))
  })
  const hostile = new Proxy({}, {
    ownKeys: () => { throw new Error("filter trap") }
  })

  await runScoped(Effect.gen(function*() {
    const client = yield* McpClient.make({
      transport,
      capabilities: () => Effect.sync(() => {
        providerCalls += 1
        return {}
      })
    })
    const result = yield* client.subscriptionsListen(hostile).pipe(Effect.either)
    assert.equal(Either.isLeft(result), true)
    assert.equal(result.left.reason, "Protocol")
    assert.equal(providerCalls, 1, "only initial discovery may call the provider")
    assert.equal(subscriptionCalls, 0)
  }))
})

test("caller close leaves unrelated requests live", async () => {
  const transport = makeTransport((request) => request.method === "subscriptions/listen"
    ? Stream.make(acknowledgement(request)).pipe(Stream.concat(Stream.never))
    : Stream.succeed(success(request, {
        resultType: "complete",
        tools: [],
        ttlMs: 0,
        cacheScope: "private"
      })))

  await runScoped(Effect.gen(function*() {
    const client = yield* makeClient(transport)
    const subscription = yield* client.subscriptionsListen()
    yield* subscription.close
    const result = yield* client.listTools()
    assert.deepEqual(result.tools, [])
  }), "500 millis")
})

test("opening protocol and transport failures remain Cause-preserving McpClientError", async () => {
  const invalid = new InvalidRequest({ message: "ack invalid" })
  const originalCause = Cause.parallel(Cause.fail(invalid), Cause.interrupt(FiberId.none))
  const transport = makeTransport(() => Stream.fail(new InvalidRequest({
    message: "ack invalid",
    cause: originalCause
  })))

  const exit = await Effect.runPromise(Effect.scoped(Effect.gen(function*() {
    const client = yield* makeClient(transport)
    return yield* client.subscriptionsListen()
  })).pipe(Effect.exit))
  assert.equal(Exit.isFailure(exit), true)
  assert.equal(Cause.isInterrupted(exit.cause), true)
  const failure = Cause.failureOption(exit.cause)
  assert.equal(failure._tag, "Some")
  assert.equal(failure.value.reason, "Protocol")
})

test("HTTP close cancels the owned response stream without a cancellation POST", async () => {
  const encoder = new TextEncoder()
  const posts = []
  let bodyCancelled = 0
  const fetch = async (_url, init) => {
    const request = JSON.parse(init.body)
    posts.push(request)
    if (request.method === "server/discover") {
      return new Response(JSON.stringify({
        jsonrpc: "2.0",
        id: request.id,
        result: discoverResult()
      }), { status: 200, headers: { "content-type": "application/json" } })
    }
    const ack = {
      jsonrpc: "2.0",
      method: "notifications/subscriptions/acknowledged",
      params: {
        notifications: {},
        _meta: { "io.modelcontextprotocol/subscriptionId": request.id }
      }
    }
    return new Response(new ReadableStream({
      start(controller) {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(ack)}\n\n`))
      },
      cancel() {
        bodyCancelled += 1
      }
    }), { status: 200, headers: { "content-type": "text/event-stream" } })
  }

  await runScoped(Effect.gen(function*() {
    const transport = yield* StreamableHttpClientTransport.make({
      url: "https://mcp.example.test/mcp",
      fetch
    })
    const client = yield* makeClient(transport)
    const subscription = yield* client.subscriptionsListen()
    yield* subscription.close
    while (bodyCancelled === 0) yield* Effect.yieldNow()
    assert.equal((yield* subscription.closed)._tag, "CallerClosed")
  }), "1 second")
  assert.equal(bodyCancelled, 1)
  assert.deepEqual(posts.map(({ method }) => method), ["server/discover", "subscriptions/listen"])
})

test("stdio explicit close and scope finalizer each emit one exact cancellation", async () => {
  const fixture = fileURLToPath(new URL("../stdio/fixtures/stdio-child.mjs", import.meta.url))
  let diagnostics = ""

  await runScoped(Effect.gen(function*() {
    const transport = yield* StdioClientTransport.make({
      command: process.execPath,
      args: [fixture, "wp5g-subscription"],
      stderrSink: (chunk) => Effect.sync(() => {
        diagnostics += new TextDecoder().decode(chunk)
      })
    })
    const client = yield* makeClient(transport)
    const subscription = yield* client.subscriptionsListen({ toolsListChanged: true })
    yield* subscription.close
    while (!diagnostics.includes("cancel:number:2")) yield* Effect.yieldNow()
    yield* Effect.scoped(client.subscriptionsListen({ resourcesListChanged: true }))
    while (!diagnostics.includes("cancel:number:3")) yield* Effect.yieldNow()
    const tools = yield* client.listTools()
    assert.deepEqual(tools.tools, [])
  }), "2 seconds")
  assert.equal(diagnostics.match(/cancel:number:2/g)?.length, 1)
  assert.equal(diagnostics.match(/cancel:number:3/g)?.length, 1)
})
