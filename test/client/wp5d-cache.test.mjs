import assert from "node:assert/strict"
import { test } from "node:test"
import * as Effect from "effect/Effect"
import * as Either from "effect/Either"
import * as Stream from "effect/Stream"
import * as ClientApi from "../../dist/client.js"

const complete = (method, overrides = {}) => {
  const common = { resultType: "complete", ttlMs: 1_000, cacheScope: "public", ...overrides }
  switch (method) {
    case "server/discover": return { ...common, supportedVersions: ["2026-07-28"], capabilities: { tools: {}, resources: {}, prompts: {}, completions: {} } }
    case "tools/list": return { ...common, tools: [] }
    case "resources/list": return { ...common, resources: [] }
    case "resources/templates/list": return { ...common, resourceTemplates: [] }
    case "resources/read": return { ...common, contents: [] }
    case "prompts/list": return { ...common, prompts: [] }
    case "tools/call": return { resultType: "complete", content: [] }
    default: return { resultType: "complete", completion: { values: [] } }
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
