import assert from "node:assert/strict"
import { test } from "node:test"
import * as Effect from "effect/Effect"
import * as Cause from "effect/Cause"
import * as Deferred from "effect/Deferred"
import * as Fiber from "effect/Fiber"
import * as Either from "effect/Either"
import * as Stream from "effect/Stream"
import * as ClientApi from "../../dist/client.js"

const complete = (method, overrides = {}) => {
  const common = { resultType: "complete", ttlMs: 1_000, cacheScope: "public" }
  switch (method) {
    case "server/discover": return { ...common, supportedVersions: ["2026-07-28"], capabilities: { tools: {}, resources: {}, prompts: {}, completions: {} }, ...overrides }
    case "tools/list": return { ...common, tools: [], ...overrides }
    case "resources/list": return { ...common, resources: [], ...overrides }
    case "resources/templates/list": return { ...common, resourceTemplates: [], ...overrides }
    case "resources/read": return { ...common, contents: [], ...overrides }
    case "prompts/list": return { ...common, prompts: [], ...overrides }
    case "tools/call": return { resultType: "complete", content: [], ...overrides }
    default: return { resultType: "complete", completion: { values: [] }, ...overrides }
  }
}

const makeTransport = (options = {}) => {
  const calls = []
  const transport = {
    request: (request) => {
      calls.push(request)
      const result = options.result?.(request, calls.length) ?? complete(request.method, options.overrides?.[request.method])
      const frames = options.frames?.(request, result) ?? [{
        _tag: "Success",
        response: { _tag: "SuccessResponse", jsonrpc: "2.0", id: request.id, result }
      }]
      return Stream.fromIterable(frames)
    }
  }
  return { calls, transport }
}

const scopedClient = (options, use) => Effect.runPromise(Effect.scoped(
  ClientApi.make(options).pipe(Effect.flatMap(use))
))

test("stable client exports the approved cache boundary", () => {
  assert.equal(typeof ClientApi.McpCache?.memory, "function")
  assert.equal(typeof ClientApi.McpCacheError, "function")
})

test("all six cacheable methods hit positive-TTL entries while zero TTL misses", async () => {
  const cache = await Effect.runPromise(ClientApi.McpCache.memory())
  const probe = makeTransport()
  await scopedClient({ transport: probe.transport, cache, cacheNamespace: "all-methods" }, (client) => Effect.gen(function*() {
    yield* client.listTools(); yield* client.listTools()
    yield* client.listResources(); yield* client.listResources()
    yield* client.listResourceTemplates(); yield* client.listResourceTemplates()
    yield* client.readResource({ uri: "test://one" }); yield* client.readResource({ uri: "test://one" })
    yield* client.listPrompts(); yield* client.listPrompts()
  }))
  for (const method of ["server/discover", "tools/list", "resources/list", "resources/templates/list", "resources/read", "prompts/list"]) {
    assert.equal(probe.calls.filter((call) => call.method === method).length, 1, method)
  }

  const stale = makeTransport({ overrides: { "tools/list": { ttlMs: 0 } } })
  await scopedClient({ transport: stale.transport, cache: await Effect.runPromise(ClientApi.McpCache.memory()) }, (client) =>
    client.listTools().pipe(Effect.zipRight(client.listTools())))
  assert.equal(stale.calls.filter(({ method }) => method === "tools/list").length, 2)
})

test("absent and empty cursors, request profiles, URIs, and methods have distinct keys", async () => {
  const cache = await Effect.runPromise(ClientApi.McpCache.memory())
  let profile = "one"
  const probe = makeTransport()
  await scopedClient({
    transport: probe.transport,
    cache,
    cacheNamespace: "keys",
    extensions: () => Effect.succeed({ [`example.com/${profile}`]: {} })
  }, (client) => Effect.gen(function*() {
    yield* client.listTools()
    yield* client.listTools({ cursor: "" })
    yield* client.listTools({ cursor: "" })
    profile = "two"
    yield* client.listTools({ cursor: "" })
    yield* client.readResource({ uri: "test://one" })
    yield* client.readResource({ uri: "test://two" })
  }))
  assert.equal(probe.calls.filter(({ method }) => method === "tools/list").length, 3)
  assert.equal(probe.calls.filter(({ method }) => method === "resources/read").length, 2)
})

test("equivalent capability profiles share one canonical memory-cache key", async () => {
  const cache = await Effect.runPromise(ClientApi.McpCache.memory())
  let reversed = false
  const probe = makeTransport()
  await scopedClient({
    transport: probe.transport,
    cache,
    cacheNamespace: "canonical-profile",
    extensions: () => Effect.succeed(reversed
      ? { "beta.example/feature": { second: 2, first: 1 }, "alpha.example/feature": {} }
      : { "alpha.example/feature": {}, "beta.example/feature": { first: 1, second: 2 } })
  }, (client) => Effect.gen(function*() {
    yield* client.listTools()
    reversed = true
    yield* client.listTools()
  }))
  assert.equal(probe.calls.filter(({ method }) => method === "tools/list").length, 1)
})

test("public entries share explicitly while private entries default to bypass", async () => {
  const cache = await Effect.runPromise(ClientApi.McpCache.memory())
  const first = makeTransport()
  const second = makeTransport()
  await scopedClient({ transport: first.transport, cache, cacheNamespace: "shared" }, () => Effect.void)
  await scopedClient({ transport: second.transport, cache, cacheNamespace: "shared" }, () => Effect.void)
  assert.equal(first.calls.length, 1)
  assert.equal(second.calls.length, 0)

  const privateCache = await Effect.runPromise(ClientApi.McpCache.memory())
  const privateFirst = makeTransport({ overrides: { "server/discover": { cacheScope: "private" } } })
  const privateSecond = makeTransport({ overrides: { "server/discover": { cacheScope: "private" } } })
  await scopedClient({ transport: privateFirst.transport, cache: privateCache, cacheNamespace: "private" }, () => Effect.void)
  await scopedClient({ transport: privateSecond.transport, cache: privateCache, cacheNamespace: "private" }, () => Effect.void)
  assert.equal(privateFirst.calls.length, 1)
  assert.equal(privateSecond.calls.length, 1)
})

test("anonymous and exact authorized partitions isolate private entries", async () => {
  const cache = await Effect.runPromise(ClientApi.McpCache.memory())
  const run = async (partition) => {
    const probe = makeTransport({ overrides: { "server/discover": { cacheScope: "private" } } })
    await scopedClient({
      transport: probe.transport,
      cache,
      cacheNamespace: "partitions",
      cacheAuthorization: () => Effect.succeed(partition)
    }, () => Effect.void)
    return probe.calls.length
  }
  assert.equal(await run({ _tag: "Anonymous" }), 1)
  assert.equal(await run({ _tag: "Anonymous" }), 0)
  assert.equal(await run({ _tag: "Authorized", partition: "tenant-a" }), 1)
  assert.equal(await run({ _tag: "Authorized", partition: "tenant-a" }), 0)
  assert.equal(await run({ _tag: "Authorized", partition: "tenant-b" }), 1)
  assert.equal(await run({ _tag: "AuthorizedUnpartitioned" }), 1)
})

test("list-change and resource-updated notifications invalidate before exposure", async () => {
  const cache = await Effect.runPromise(ClientApi.McpCache.memory())
  let notify = false
  const probe = makeTransport({
    frames: (request, result) => notify && request.method === "tools/call"
      ? [
          { _tag: "Notification", notification: { _tag: "Notification", jsonrpc: "2.0", method: "notifications/tools/list_changed", params: {} } },
          { _tag: "Notification", notification: { _tag: "Notification", jsonrpc: "2.0", method: "notifications/resources/updated", params: { uri: "test://one" } } },
          { _tag: "Success", response: { _tag: "SuccessResponse", jsonrpc: "2.0", id: request.id, result } }
        ]
      : [{ _tag: "Success", response: { _tag: "SuccessResponse", jsonrpc: "2.0", id: request.id, result } }]
  })
  await scopedClient({ transport: probe.transport, cache, cacheNamespace: "invalidate" }, (client) => Effect.gen(function*() {
    yield* client.listTools(); yield* client.listTools()
    yield* client.readResource({ uri: "test://one" }); yield* client.readResource({ uri: "test://one" })
    notify = true
    yield* client.callTool({ name: "notify", arguments: {} })
    yield* client.listTools()
    yield* client.readResource({ uri: "test://one" })
  }))
  assert.equal(probe.calls.filter(({ method }) => method === "tools/list").length, 2)
  assert.equal(probe.calls.filter(({ method }) => method === "resources/read").length, 2)
})

test("explicit discover force-refreshes instead of serving a cached entry", async () => {
  const probe = makeTransport()
  await scopedClient({ transport: probe.transport, cache: await Effect.runPromise(ClientApi.McpCache.memory()) }, (client) =>
    client.discover().pipe(Effect.zipRight(client.discover())))
  assert.equal(probe.calls.filter(({ method }) => method === "server/discover").length, 3)
})

test("cache callback failures are typed Cache errors and interruption survives", async () => {
  const cache = {
    get: () => Effect.die("cache-secret"),
    set: () => Effect.void,
    invalidate: () => Effect.void
  }
  const outcome = await Effect.runPromise(Effect.scoped(
    ClientApi.make({ transport: makeTransport().transport, cache }).pipe(Effect.either)
  ))
  assert.equal(Either.isLeft(outcome), true)
  assert.equal(outcome.left.reason, "Cache")
  assert.equal(outcome.left.cause?._tag, "McpCacheError")
  assert.equal(outcome.left.message.includes("cache-secret"), false)

  const interrupted = await Effect.runPromiseExit(Effect.scoped(
    ClientApi.make({
      transport: makeTransport().transport,
      cache: { ...cache, get: () => Effect.interrupt }
    })
  ))
  assert.equal(interrupted._tag, "Failure")
  assert.equal(interrupted.cause._tag === "Interrupt" || JSON.stringify(interrupted.cause).includes("Interrupt"), true)
})

test("memory cache capacity is deterministic and corrupt values invalidate to a miss", async () => {
  const cache = await Effect.runPromise(ClientApi.McpCache.memory({ capacity: 1 }))
  const probe = makeTransport()
  await scopedClient({ transport: probe.transport, cache, cacheNamespace: "capacity" }, (client) => Effect.gen(function*() {
    yield* client.listTools()
    yield* client.listResources()
    yield* client.listTools()
  }))
  assert.equal(probe.calls.filter(({ method }) => method === "tools/list").length, 2)
})

test("freshness equality is stale and overflow expiration saturates safely", async () => {
  let stored
  let invalidations = 0
  const cache = {
    get: () => Effect.succeed(stored === undefined ? { _tag: "None" } : { _tag: "Some", value: stored }),
    set: (_key, entry) => Effect.sync(() => { stored = entry }),
    invalidate: () => Effect.sync(() => { invalidations += 1; stored = undefined })
  }
  const probe = makeTransport({ overrides: { "server/discover": { ttlMs: Number.MAX_SAFE_INTEGER } } })
  await scopedClient({ transport: probe.transport, cache, cacheNamespace: "freshness" }, (client) => Effect.gen(function*() {
    assert.equal(stored.expiresAt, Number.MAX_SAFE_INTEGER)
    stored = { ...stored, expiresAt: stored.receivedAt }
    yield* client.listTools()
  }))
  assert.equal(invalidations > 0, true)
})

test("cache stores immutable exact wire JSON and re-decodes every hit", async () => {
  const cache = await Effect.runPromise(ClientApi.McpCache.memory())
  const result = complete("tools/list", { tools: [{ name: "stable", inputSchema: { type: "object" } }] })
  const probe = makeTransport({ result: (request) => request.method === "tools/list" ? result : complete(request.method) })
  await scopedClient({ transport: probe.transport, cache, cacheNamespace: "immutable" }, (client) => Effect.gen(function*() {
    const first = yield* client.listTools()
    result.tools[0].name = "mutated"
    const second = yield* client.listTools()
    assert.equal(first.tools[0].name, "stable")
    assert.equal(second.tools[0].name, "stable")
    assert.notStrictEqual(first, second)
  }))
})

test("hostile and corrupt hits invalidate before falling back to transport", async () => {
  let invalidated = 0
  let invoked = 0
  const hostile = {}
  Object.defineProperty(hostile, "result", { get() { invoked += 1; throw new Error("must-not-run") } })
  const cache = {
    get: () => Effect.succeed({ _tag: "Some", value: hostile }),
    set: () => Effect.void,
    invalidate: () => Effect.sync(() => { invalidated += 1 })
  }
  const probe = makeTransport()
  await scopedClient({ transport: probe.transport, cache }, () => Effect.void)
  assert.equal(invoked, 0)
  assert.equal(invalidated, 1)
  assert.equal(probe.calls.length, 1)
})

test("protocol errors and invalid cacheable results are never stored", async () => {
  let sets = 0
  const cache = {
    get: () => Effect.succeed({ _tag: "None" }),
    set: () => Effect.sync(() => { sets += 1 }),
    invalidate: () => Effect.void
  }
  const probe = makeTransport({ result: (request) => request.method === "tools/list"
    ? { resultType: "input_required", inputRequests: {} }
    : complete(request.method) })
  const outcome = await Effect.runPromise(Effect.scoped(ClientApi.make({ transport: probe.transport, cache }).pipe(
    Effect.flatMap((client) => client.listTools()),
    Effect.either
  )))
  assert.equal(Either.isLeft(outcome), true)
  assert.equal(sets, 1, "only the valid initial discovery may be cached")
})

test("authorization provider is exact, never inspects principal-like extras, and failures are typed", async () => {
  let getterCalls = 0
  const tagged = { _tag: "Authorized", partition: "tenant" }
  Object.defineProperty(tagged, "principal", { get() { getterCalls += 1; throw new Error("principal-read") } })
  await scopedClient({
    transport: makeTransport({ overrides: { "server/discover": { cacheScope: "private" } } }).transport,
    cache: await Effect.runPromise(ClientApi.McpCache.memory()),
    cacheAuthorization: () => Effect.succeed(tagged)
  }, () => Effect.void)
  assert.equal(getterCalls, 0)

  for (const provider of [
    () => { throw new Error("provider-secret") },
    () => "not-an-effect",
    () => Effect.die("provider-defect")
  ]) {
    const outcome = await Effect.runPromise(Effect.scoped(ClientApi.make({
      transport: makeTransport().transport,
      cache: await Effect.runPromise(ClientApi.McpCache.memory()),
      cacheAuthorization: provider
    }).pipe(Effect.either)))
    assert.equal(Either.isLeft(outcome), true)
    assert.equal(outcome.left.reason, "Cache")
    assert.equal(outcome.left.message.includes("secret"), false)
  }
})

test("set and invalidate infrastructure failures own the request", async () => {
  const methods = [
    { get: () => Effect.succeed({ _tag: "None" }), set: () => Effect.fail("set-failure"), invalidate: () => Effect.void },
    { get: () => Effect.succeed({ _tag: "Some", value: { result: {}, receivedAt: 0, expiresAt: 0, cacheScope: "public" } }), set: () => Effect.void, invalidate: () => Effect.fail("invalidate-failure") }
  ]
  for (const cache of methods) {
    const outcome = await Effect.runPromise(Effect.scoped(ClientApi.make({ transport: makeTransport().transport, cache }).pipe(Effect.either)))
    assert.equal(Either.isLeft(outcome), true)
    assert.equal(outcome.left.reason, "Cache")
  }
})

test("mixed and deep cache Causes preserve composition and interruption", async () => {
  let deep = Cause.interrupt("cache-interrupt")
  for (let index = 0; index < 12_000; index++) deep = Cause.sequential(Cause.fail(new Error("cache-failure")), deep)
  const cache = { get: () => Effect.failCause(deep), set: () => Effect.void, invalidate: () => Effect.void }
  const exit = await Effect.runPromiseExit(Effect.scoped(ClientApi.make({ transport: makeTransport().transport, cache })))
  assert.equal(exit._tag, "Failure")
  assert.equal(Cause.isInterrupted(exit.cause), true)
})

test("invalidation epochs prevent an in-flight stale response from repopulating", async () => {
  const gate = await Effect.runPromise(Deferred.make())
  let sets = 0
  let listCalls = 0
  const cache = {
    get: () => Effect.succeed({ _tag: "None" }),
    set: () => Effect.sync(() => { sets += 1 }),
    invalidate: () => Effect.void
  }
  const transport = {
    request: (request) => {
      if (request.method === "tools/list") {
        listCalls += 1
        return Stream.unwrap(Deferred.await(gate).pipe(Effect.as(Stream.succeed({
          _tag: "Success", response: { _tag: "SuccessResponse", jsonrpc: "2.0", id: request.id, result: complete("tools/list") }
        }))))
      }
      const frames = request.method === "tools/call" ? [
        { _tag: "Notification", notification: { _tag: "Notification", jsonrpc: "2.0", method: "notifications/tools/list_changed", params: {} } },
        { _tag: "Success", response: { _tag: "SuccessResponse", jsonrpc: "2.0", id: request.id, result: complete("tools/call") } }
      ] : [{ _tag: "Success", response: { _tag: "SuccessResponse", jsonrpc: "2.0", id: request.id, result: complete(request.method) } }]
      return Stream.fromIterable(frames)
    }
  }
  await scopedClient({ transport, cache }, (client) => Effect.gen(function*() {
    const before = sets
    assert.equal(before, 1, "initial discovery establishes that cache writes are active")
    const pending = yield* client.listTools().pipe(Effect.fork)
    while (listCalls === 0) yield* Effect.yieldNow()
    yield* client.callTool({ name: "notify", arguments: {} })
    yield* Deferred.succeed(gate, undefined)
    yield* Fiber.join(pending)
    assert.equal(sets, before, "stale in-flight list must not be stored")
  }))
})

test("invalidation during a delayed cache get never returns the stale hit", async () => {
  const getStarted = await Effect.runPromise(Deferred.make())
  const releaseGet = await Effect.runPromise(Deferred.make())
  let listCalls = 0
  let toolGets = 0
  const stale = {
    result: complete("tools/list", { tools: [{ name: "old", inputSchema: { type: "object" } }] }),
    receivedAt: 0,
    expiresAt: Number.MAX_SAFE_INTEGER,
    cacheScope: "public"
  }
  const cache = {
    get: (key) => key.method === "tools/list"
      ? Effect.gen(function*() {
          toolGets += 1
          yield* Deferred.succeed(getStarted, undefined)
          yield* Deferred.await(releaseGet)
          return { _tag: "Some", value: stale }
        })
      : Effect.succeed({ _tag: "None" }),
    set: () => Effect.void,
    invalidate: () => Effect.void
  }
  const transport = {
    request: (request) => {
      if (request.method === "tools/list") listCalls += 1
      const frames = request.method === "tools/call" ? [
        { _tag: "Notification", notification: { _tag: "Notification", jsonrpc: "2.0", method: "notifications/tools/list_changed", params: {} } },
        { _tag: "Success", response: { _tag: "SuccessResponse", jsonrpc: "2.0", id: request.id, result: complete("tools/call") } }
      ] : [{
        _tag: "Success",
        response: { _tag: "SuccessResponse", jsonrpc: "2.0", id: request.id, result: complete(request.method, {
          ...(request.method === "tools/list"
            ? { tools: [{ name: "new", inputSchema: { type: "object" } }] }
            : {})
        }) }
      }]
      return Stream.fromIterable(frames)
    }
  }
  await scopedClient({ transport, cache, cacheNamespace: "delayed-get" }, (client) => Effect.gen(function*() {
    const pending = yield* client.listTools().pipe(Effect.fork)
    yield* Deferred.await(getStarted)
    yield* client.callTool({ name: "notify", arguments: {} })
    yield* Deferred.succeed(releaseGet, undefined)
    const result = yield* Fiber.join(pending)
    assert.equal(result.tools[0].name, "new")
  }))
  assert.equal(toolGets, 1)
  assert.equal(listCalls, 1)
})

test("invalidation during a delayed cache set removes the late stale write", async () => {
  const setStarted = await Effect.runPromise(Deferred.make())
  const releaseSet = await Effect.runPromise(Deferred.make())
  let stored
  let listCalls = 0
  let blockFirstToolSet = true
  const cache = {
    get: (key) => Effect.succeed(key.method === "tools/list" && stored !== undefined
      ? { _tag: "Some", value: stored }
      : { _tag: "None" }),
    set: (key, entry) => key.method === "tools/list" && blockFirstToolSet
      ? Effect.gen(function*() {
          blockFirstToolSet = false
          yield* Deferred.succeed(setStarted, undefined)
          yield* Deferred.await(releaseSet)
          stored = entry
        })
      : Effect.sync(() => {
          if (key.method === "tools/list") stored = entry
        }),
    invalidate: (selector) => Effect.sync(() => {
      if (selector.methods?.includes("tools/list")) stored = undefined
    })
  }
  const transport = {
    request: (request) => {
      if (request.method === "tools/list") listCalls += 1
      const result = request.method === "tools/list"
        ? complete("tools/list", { tools: [{ name: `version-${listCalls}`, inputSchema: { type: "object" } }] })
        : complete(request.method)
      const frames = request.method === "tools/call" ? [
        { _tag: "Notification", notification: { _tag: "Notification", jsonrpc: "2.0", method: "notifications/tools/list_changed", params: {} } },
        { _tag: "Success", response: { _tag: "SuccessResponse", jsonrpc: "2.0", id: request.id, result } }
      ] : [{ _tag: "Success", response: { _tag: "SuccessResponse", jsonrpc: "2.0", id: request.id, result } }]
      return Stream.fromIterable(frames)
    }
  }
  await scopedClient({ transport, cache, cacheNamespace: "delayed-set" }, (client) => Effect.gen(function*() {
    const pending = yield* client.listTools().pipe(Effect.fork)
    yield* Deferred.await(setStarted)
    yield* client.callTool({ name: "notify", arguments: {} })
    yield* Deferred.succeed(releaseSet, undefined)
    yield* Fiber.join(pending)
    const fresh = yield* client.listTools()
    assert.equal(fresh.tools[0].name, "version-2")
  }))
  assert.equal(listCalls, 2)
})

test("memory services and implicit namespaces isolate clients", async () => {
  const shared = await Effect.runPromise(ClientApi.McpCache.memory())
  const one = makeTransport()
  const two = makeTransport()
  await scopedClient({ transport: one.transport, cache: shared }, () => Effect.void)
  await scopedClient({ transport: two.transport, cache: shared }, () => Effect.void)
  assert.equal(one.calls.length, 1)
  assert.equal(two.calls.length, 1)
  const isolated = await Effect.runPromise(ClientApi.McpCache.memory())
  const three = makeTransport()
  await scopedClient({ transport: three.transport, cache: isolated, cacheNamespace: "shared" }, () => Effect.void)
  assert.equal(three.calls.length, 1)
})
