import assert from "node:assert/strict"
import { test } from "node:test"
import * as Cause from "effect/Cause"
import * as Chunk from "effect/Chunk"
import * as Context from "effect/Context"
import * as Effect from "effect/Effect"
import * as Either from "effect/Either"
import * as Queue from "effect/Queue"
import * as McpSchema from "../../dist/McpSchema.js"
import { SchemaValidationError } from "../../dist/McpErrors.js"
import * as McpServer from "../../dist/McpServer.js"
import * as ServerApi from "../../dist/server.js"

const client = (name = "pagination-client") => McpSchema.McpServerClient.of({
  clientId: name,
  requestContext: { clientInfo: { name, version: "1" }, capabilities: {} }
})

const dispatch = (server, method, params = {}, identity = "pagination-client") =>
  McpServer.dispatch(method, params).pipe(
    Effect.provideService(McpServer.McpServer, server),
    Effect.provideService(McpSchema.McpServerClient, client(identity))
  )

const makeServer = (handlers, options = {}) => Effect.runPromise(McpServer.make({
  serverInfo: { name: "pagination-server", version: "1" },
  handlers,
  pagination: { pageSize: 2, ttlMs: 37, cacheScope: "public" },
  ...options
}))

const collect = async (server, method, key) => {
  const output = []
  let cursor
  do {
    const result = await Effect.runPromise(dispatch(server, method, cursor === undefined ? {} : { cursor }))
    output.push(...result[key])
    cursor = result.nextCursor
    assert.equal(result.ttlMs, 37)
    assert.equal(result.cacheScope, "public")
  } while (cursor !== undefined)
  return output
}

test("stable server exports the approved pagination boundary", () => {
  assert.equal(typeof ServerApi.PaginationCursor?.memory, "function")
})

test("constructed server services do not expose mutable pagination internals", async () => {
  const server = await makeServer(Effect.void)
  for (const key of ["paginationOwner", "paginationCursor", "paginationRevisions"]) {
    assert.equal(Object.hasOwn(server, key), false, key)
    assert.equal(key in server, false, key)
  }
})

test("all four registries paginate after exact code-unit ordering", async () => {
  const tools = ["z", "a", "\u00e4", "A", "aa"]
  const resources = ["test://z", "test://a", "test://A", "test://aa", "test://\u00e4"]
  const prompts = ["z", "a", "\u00e4", "A", "aa"]
  const handlers = Effect.gen(function*() {
    for (const name of tools) yield* McpServer.registerTool({ name, content: () => Effect.succeed(name) })
    for (const uri of resources) yield* McpServer.registerResource({ uri, name: uri, content: Effect.succeed(uri) })
    for (const name of prompts) yield* McpServer.registerPrompt({ name, content: () => Effect.succeed(name) })
    const id = McpSchema.param("id", McpSchema.Cursor)
    yield* McpServer.registerResource`template://z/${id}`({ name: "z", content: (uri) => Effect.succeed(uri) })
    yield* McpServer.registerResource`template://a/${id}`({ name: "a", content: (uri) => Effect.succeed(uri) })
    yield* McpServer.registerResource`template://A/${id}`({ name: "A", content: (uri) => Effect.succeed(uri) })
    yield* McpServer.registerResource`template://aa/${id}`({ name: "aa", content: (uri) => Effect.succeed(uri) })
    yield* McpServer.registerResource`template://\u00e4/${id}`({ name: "\u00e4", content: (uri) => Effect.succeed(uri) })
  })
  const server = await makeServer(handlers)
  const listedTools = await collect(server, "tools/list", "tools")
  const listedResources = await collect(server, "resources/list", "resources")
  const listedPrompts = await collect(server, "prompts/list", "prompts")
  const listedTemplates = await collect(server, "resources/templates/list", "resourceTemplates")
  assert.deepEqual(listedTools.map(({ name }) => name), ["A", "a", "aa", "z", "\u00e4"])
  assert.deepEqual(listedResources.map(({ uri }) => uri), ["test://A", "test://a", "test://aa", "test://z", "test://\u00e4"])
  assert.deepEqual(listedPrompts.map(({ name }) => name), ["A", "a", "aa", "z", "\u00e4"])
  assert.deepEqual(listedTemplates.map(({ name }) => name), ["A", "a", "aa", "z", "\u00e4"])
})

test("empty custom cursors are present, reusable, and terminal pages omit nextCursor", async () => {
  let state
  const cursor = {
    issue: (next) => Effect.sync(() => { state = next; return "" }),
    resolve: (value) => Effect.sync(() => {
      assert.equal(value, "")
      return state
    }),
    invalidate: () => Effect.void
  }
  const server = await makeServer(Effect.all([
    McpServer.registerTool({ name: "a", content: () => Effect.succeed("a") }),
    McpServer.registerTool({ name: "b", content: () => Effect.succeed("b") }),
    McpServer.registerTool({ name: "c", content: () => Effect.succeed("c") })
  ], { discard: true }), { paginationCursor: cursor })
  const first = await Effect.runPromise(dispatch(server, "tools/list"))
  assert.equal(Object.hasOwn(first, "nextCursor"), true)
  assert.equal(first.nextCursor, "")
  const second = await Effect.runPromise(dispatch(server, "tools/list", { cursor: "" }))
  const reused = await Effect.runPromise(dispatch(server, "tools/list", { cursor: "" }))
  assert.deepEqual(second.tools.map(({ name }) => name), ["c"])
  assert.deepEqual(reused.tools.map(({ name }) => name), ["c"])
  assert.equal(Object.hasOwn(second, "nextCursor"), false)
})

test("malformed, foreign, wrong-collection, and changed-view cursors fail safely", async () => {
  let visible = true
  const annotations = Context.make(McpSchema.EnabledWhen, () => visible)
  const server = await makeServer(Effect.all([
    McpServer.registerTool({ name: "a", content: () => Effect.succeed("a") }),
    McpServer.registerTool({ name: "b", content: () => Effect.succeed("b") }),
    McpServer.registerTool({ name: "c", annotations, content: () => Effect.succeed("c") })
  ], { discard: true }))
  const first = await Effect.runPromise(dispatch(server, "tools/list"))
  for (const value of ["", "not-a-cursor", `${first.nextCursor}x`]) {
    const outcome = await Effect.runPromise(dispatch(server, "tools/list", { cursor: value }).pipe(Effect.either))
    assert.equal(Either.isLeft(outcome), true)
    assert.equal(outcome.left._tag, "SchemaValidationError")
    if (value.length > 0) assert.equal(outcome.left.message.includes(value), false)
  }
  const wrong = await Effect.runPromise(dispatch(server, "prompts/list", { cursor: first.nextCursor }).pipe(Effect.either))
  assert.equal(Either.isLeft(wrong), true)
  visible = false
  const changed = await Effect.runPromise(dispatch(server, "tools/list", { cursor: first.nextCursor }).pipe(Effect.either))
  assert.equal(Either.isLeft(changed), true)
})

test("registration and explicit list-change expire outstanding cursors", async () => {
  const server = await makeServer(Effect.all([
    McpServer.registerTool({ name: "a", content: () => Effect.succeed("a") }),
    McpServer.registerTool({ name: "b", content: () => Effect.succeed("b") }),
    McpServer.registerTool({ name: "c", content: () => Effect.succeed("c") })
  ], { discard: true }))
  const registrationCursor = (await Effect.runPromise(dispatch(server, "tools/list"))).nextCursor
  await Effect.runPromise(McpServer.registerTool({ name: "d", content: () => Effect.succeed("d") }).pipe(
    Effect.provideService(McpServer.McpServer, server)
  ))
  assert.equal(Either.isLeft(await Effect.runPromise(dispatch(server, "tools/list", { cursor: registrationCursor }).pipe(Effect.either))), true)
  const manualCursor = (await Effect.runPromise(dispatch(server, "tools/list"))).nextCursor
  await Effect.runPromise(McpServer.sendToolListChanged.pipe(Effect.provideService(McpServer.McpServer, server)))
  assert.equal(Either.isLeft(await Effect.runPromise(dispatch(server, "tools/list", { cursor: manualCursor }).pipe(Effect.either))), true)
})

test("resource invalidation is one exact scoped operation and preserves tool and prompt cursors", async () => {
  const memory = await Effect.runPromise(ServerApi.PaginationCursor.memory())
  const invalidations = []
  const cursor = {
    issue: memory.issue,
    resolve: memory.resolve,
    invalidate: (collections) => Effect.sync(() => {
      invalidations.push(collections)
    }).pipe(Effect.zipRight(memory.invalidate(collections)))
  }
  const id = McpSchema.param("id", McpSchema.Cursor)
  const server = await makeServer(Effect.gen(function*() {
    for (const name of ["a", "b", "c"]) {
      yield* McpServer.registerTool({ name, content: () => Effect.succeed(name) })
      yield* McpServer.registerPrompt({ name, content: () => Effect.succeed(name) })
      yield* McpServer.registerResource({ uri: `test://${name}`, name, content: Effect.succeed(name) })
    }
    yield* McpServer.registerResource`template://a/${id}`({ name: "a", content: (uri) => Effect.succeed(uri) })
    yield* McpServer.registerResource`template://b/${id}`({ name: "b", content: (uri) => Effect.succeed(uri) })
    yield* McpServer.registerResource`template://c/${id}`({ name: "c", content: (uri) => Effect.succeed(uri) })
  }), { paginationCursor: cursor, pagination: { pageSize: 1 } })

  const cursors = async () => ({
    tools: (await Effect.runPromise(dispatch(server, "tools/list"))).nextCursor,
    prompts: (await Effect.runPromise(dispatch(server, "prompts/list"))).nextCursor,
    resources: (await Effect.runPromise(dispatch(server, "resources/list"))).nextCursor,
    templates: (await Effect.runPromise(dispatch(server, "resources/templates/list"))).nextCursor
  })
  const assertResourceOnly = async (before) => {
    assert.deepEqual(invalidations, [["resources", "resourceTemplates"]])
    assert.equal(Object.isFrozen(invalidations[0]), true)
    assert.equal(Either.isRight(await Effect.runPromise(dispatch(server, "tools/list", { cursor: before.tools }).pipe(Effect.either))), true)
    assert.equal(Either.isRight(await Effect.runPromise(dispatch(server, "prompts/list", { cursor: before.prompts }).pipe(Effect.either))), true)
    assert.equal(Either.isLeft(await Effect.runPromise(dispatch(server, "resources/list", { cursor: before.resources }).pipe(Effect.either))), true)
    assert.equal(Either.isLeft(await Effect.runPromise(dispatch(server, "resources/templates/list", { cursor: before.templates }).pipe(Effect.either))), true)
  }

  invalidations.length = 0
  const beforeRegistration = await cursors()
  await Effect.runPromise(McpServer.registerResource({
    uri: "test://d", name: "d", content: Effect.succeed("d")
  }).pipe(Effect.provideService(McpServer.McpServer, server)))
  await assertResourceOnly(beforeRegistration)

  invalidations.length = 0
  const beforeManual = await cursors()
  await Effect.runPromise(McpServer.sendResourceListChanged.pipe(Effect.provideService(McpServer.McpServer, server)))
  await assertResourceOnly(beforeManual)
})

test("failed cursor invalidation leaves every registry mutation atomic and unexposed", async () => {
  const id = McpSchema.param("id", McpSchema.Cursor)
  const setup = async () => {
    let reject = false
    let nextToken = 0
    const states = new Map()
    const issued = []
    const paginationCursor = {
      issue: (state) => Effect.sync(() => {
        const token = `cursor-${nextToken++}`
        states.set(token, state)
        issued.push(state)
        return token
      }),
      resolve: (token) => states.has(token)
        ? Effect.succeed(states.get(token))
        : Effect.fail(new SchemaValidationError({ message: "unused" })),
      invalidate: () => reject
        ? Effect.fail(new SchemaValidationError({ message: "invalidation failed" }))
        : Effect.void
    }
    const server = await makeServer(Effect.gen(function*() {
      yield* McpServer.registerTool({ name: "base", content: () => Effect.succeed("base") })
      yield* McpServer.registerResource({ uri: "test://base", name: "base", content: Effect.succeed("base") })
      yield* McpServer.registerResource`template://atomic/${id}`({
        name: "base", completion: { id: () => Effect.succeed(["old-template"]) },
        content: (uri) => Effect.succeed(uri)
      })
      yield* McpServer.registerPrompt({
        name: "base", parameters: { old: McpSchema.Cursor },
        completion: { old: () => Effect.succeed(["old-prompt"]) },
        content: () => Effect.succeed("base")
      })
      yield* McpServer.registerTool({ name: "second", content: () => Effect.succeed("second") })
      yield* McpServer.registerResource({ uri: "test://second", name: "second", content: Effect.succeed("second") })
      yield* McpServer.registerResource`template://second/${id}`({ name: "second", content: (uri) => Effect.succeed(uri) })
      yield* McpServer.registerPrompt({ name: "second", content: () => Effect.succeed("second") })
    }), { paginationCursor, pagination: { pageSize: 1 } })
    await Effect.runPromise(Queue.takeAll(server.notificationsQueue))
    reject = true
    return { server, issued }
  }
  const cases = [
    {
      method: "tools/list", key: "tools",
      mutate: McpServer.registerTool({ name: "added", content: () => Effect.succeed("added") })
    },
    {
      method: "resources/list", key: "resources",
      mutate: McpServer.registerResource({ uri: "test://added", name: "added", content: Effect.succeed("added") })
    },
    {
      method: "resources/templates/list", key: "resourceTemplates",
      mutate: McpServer.registerResource`template://atomic/${id}`({
        name: "replacement", completion: { id: () => Effect.succeed(["new-template"]) },
        content: (uri) => Effect.succeed(uri)
      }),
      completion: {
        ref: { type: "ref/resource", uri: "template://atomic/{id}" },
        argument: { name: "id", value: "" }
      },
      expectedCompletion: ["old-template"]
    },
    {
      method: "prompts/list", key: "prompts",
      mutate: McpServer.registerPrompt({
        name: "base", parameters: { next: McpSchema.Cursor },
        completion: { next: () => Effect.succeed(["new-prompt"]) },
        content: () => Effect.succeed("replacement")
      }),
      completion: {
        ref: { type: "ref/prompt", name: "base" },
        argument: { name: "old", value: "" }
      },
      expectedCompletion: ["old-prompt"]
    }
  ]
  for (const scenario of cases) {
    const { server, issued } = await setup()
    const beforeList = await Effect.runPromise(dispatch(server, scenario.method))
    const beforeRevision = issued.at(-1).revision
    const outcome = await Effect.runPromise(scenario.mutate.pipe(
      Effect.provideService(McpServer.McpServer, server),
      Effect.either
    ))
    assert.equal(Either.isLeft(outcome), true)
    assert.equal(outcome.left._tag, "SchemaValidationError")
    const afterList = await Effect.runPromise(dispatch(server, scenario.method))
    assert.deepEqual(afterList[scenario.key], beforeList[scenario.key])
    assert.equal(issued.at(-1).revision, beforeRevision)
    assert.equal(Chunk.size(await Effect.runPromise(Queue.takeAll(server.notificationsQueue))), 0)
    if (scenario.completion !== undefined) {
      const completed = await Effect.runPromise(dispatch(server, "completion/complete", scenario.completion))
      assert.deepEqual(completed.completion.values, scenario.expectedCompletion)
    }
  }
})

test("pagination policy bounds fail construction before handlers run", async () => {
  for (const pagination of [
    { pageSize: 0 }, { pageSize: 10_001 }, { pageSize: 1.5 },
    { ttlMs: -1 }, { ttlMs: Number.MAX_SAFE_INTEGER + 1 },
    { cacheScope: "shared" }
  ]) {
    const outcome = await Effect.runPromise(McpServer.make({
      serverInfo: { name: "invalid", version: "1" },
      handlers: Effect.die("must-not-run"),
      pagination
    }).pipe(Effect.either))
    assert.equal(Either.isLeft(outcome), true, JSON.stringify(pagination))
    assert.equal(outcome.left._tag, "SchemaValidationError")
  }
})

test("cursor callback mixed Causes preserve interruption and safe typed failures", async () => {
  const typed = new SchemaValidationError({ message: "private-cache-token" })
  const mixed = Cause.parallel(Cause.fail(typed), Cause.interrupt("cursor-fiber"))
  const cursor = {
    issue: () => Effect.failCause(mixed),
    resolve: () => Effect.fail(typed),
    invalidate: () => Effect.void
  }
  const server = await makeServer(Effect.all([
    McpServer.registerTool({ name: "a", content: () => Effect.succeed("a") }),
    McpServer.registerTool({ name: "b", content: () => Effect.succeed("b") }),
    McpServer.registerTool({ name: "c", content: () => Effect.succeed("c") })
  ], { discard: true }), { paginationCursor: cursor })
  const exit = await Effect.runPromiseExit(dispatch(server, "tools/list"))
  assert.equal(exit._tag, "Failure")
  assert.equal(Cause.isInterrupted(exit.cause), true)
  const failures = Chunk.toReadonlyArray(Cause.failures(exit.cause))
  const local = failures.find((failure) => failure?._tag === "SchemaValidationError")
  assert.equal(local !== undefined, true)
  const causeDescriptor = Object.getOwnPropertyDescriptor(local, "cause")
  assert.equal(causeDescriptor?.enumerable, false)
  assert.equal(causeDescriptor?.value, mixed)
  assert.equal(causeDescriptor?.value?._tag, "Parallel")
  assert.equal(Cause.isInterrupted(causeDescriptor.value), true)
  assert.equal(JSON.stringify(exit).includes("private-cache-token"), false)
})

test("default policy pages at 100 with private immediately-stale hints", async () => {
  const registrations = Array.from({ length: 101 }, (_, index) => McpServer.registerTool({
    name: `tool-${String(index).padStart(3, "0")}`,
    content: () => Effect.succeed(index)
  }))
  const server = await Effect.runPromise(McpServer.make({
    serverInfo: { name: "defaults", version: "1" },
    handlers: Effect.all(registrations, { discard: true })
  }))
  const first = await Effect.runPromise(dispatch(server, "tools/list"))
  assert.equal(first.tools.length, 100)
  assert.equal(first.ttlMs, 0)
  assert.equal(first.cacheScope, "private")
  assert.equal(typeof first.nextCursor, "string")
  const final = await Effect.runPromise(dispatch(server, "tools/list", { cursor: first.nextCursor }))
  assert.equal(final.tools.length, 1)
  assert.equal(Object.hasOwn(final, "nextCursor"), false)
})

test("registry upserts replace duplicate primary keys and template ordering is deterministic", async () => {
  const id = McpSchema.param("id", McpSchema.Cursor)
  const server = await makeServer(Effect.gen(function*() {
    yield* McpServer.registerTool({ name: "same", description: "old", content: () => Effect.succeed("old") })
    yield* McpServer.registerTool({ name: "same", description: "new", content: () => Effect.succeed("new") })
    yield* McpServer.registerResource({ uri: "test://same", name: "old", content: Effect.succeed("old") })
    yield* McpServer.registerResource({ uri: "test://same", name: "new", content: Effect.succeed("new") })
    yield* McpServer.registerPrompt({ name: "same", description: "old", content: () => Effect.succeed("old") })
    yield* McpServer.registerPrompt({ name: "same", description: "new", content: () => Effect.succeed("new") })
    yield* McpServer.registerResource`template://same/${id}`({ name: "old", content: (uri) => Effect.succeed(uri) })
    yield* McpServer.registerResource`template://same/${id}`({ name: "new", content: (uri) => Effect.succeed(uri) })
  }))
  assert.deepEqual((await Effect.runPromise(dispatch(server, "tools/list"))).tools.map(({ description }) => description), ["new"])
  assert.deepEqual((await Effect.runPromise(dispatch(server, "resources/list"))).resources.map(({ name }) => name), ["new"])
  assert.deepEqual((await Effect.runPromise(dispatch(server, "prompts/list"))).prompts.map(({ description }) => description), ["new"])
  assert.deepEqual((await Effect.runPromise(dispatch(server, "resources/templates/list"))).resourceTemplates.map(({ name }) => name), ["new"])
})

test("cursor memory validates capacity and lifetime bounds", async () => {
  assert.equal(typeof ServerApi.PaginationCursor?.memory, "function")
  for (const options of [
    { capacity: 0 }, { capacity: 1.5 }, { capacity: Number.MAX_SAFE_INTEGER + 1 },
    { lifetimeMs: 0 }, { lifetimeMs: 1.5 }, { lifetimeMs: Number.MAX_SAFE_INTEGER + 1 }
  ]) {
    const invalid = await Effect.runPromise(ServerApi.PaginationCursor.memory(options).pipe(Effect.either))
    assert.equal(Either.isLeft(invalid), true, JSON.stringify(options))
  }
})

test("cursor memory uses deterministic FIFO eviction", async () => {
  assert.equal(typeof ServerApi.PaginationCursor?.memory, "function")
  const state = (offset) => ({ owner: "a".repeat(32), collection: "tools", revision: 1, offset, view: ["a", "b", "c"] })
  const bounded = await Effect.runPromise(ServerApi.PaginationCursor.memory({ capacity: 1, lifetimeMs: 50 }))
  const first = await Effect.runPromise(bounded.issue(state(1)))
  const second = await Effect.runPromise(bounded.issue(state(2)))
  assert.equal(Either.isLeft(await Effect.runPromise(bounded.resolve(first).pipe(Effect.either))), true)
  assert.equal((await Effect.runPromise(bounded.resolve(second))).offset, 2)
})

test("cursor memory expires tokens at the exact lifetime boundary", async () => {
  assert.equal(typeof ServerApi.PaginationCursor?.memory, "function")
  const state = { owner: "a".repeat(32), collection: "tools", revision: 1, offset: 1, view: ["a", "b"] }
  const bounded = await Effect.runPromise(ServerApi.PaginationCursor.memory({ lifetimeMs: 50 }))
  const token = await Effect.runPromise(bounded.issue(state))
  await new Promise((resolve) => setTimeout(resolve, 60))
  assert.equal(Either.isLeft(await Effect.runPromise(bounded.resolve(token).pipe(Effect.either))), true)
})

test("cursor memory rejects tokens after a service restart", async () => {
  assert.equal(typeof ServerApi.PaginationCursor?.memory, "function")
  const state = { owner: "a".repeat(32), collection: "tools", revision: 1, offset: 1, view: ["a", "b"] }
  const original = await Effect.runPromise(ServerApi.PaginationCursor.memory())
  const token = await Effect.runPromise(original.issue(state))
  const restarted = await Effect.runPromise(ServerApi.PaginationCursor.memory())
  assert.equal(Either.isLeft(await Effect.runPromise(restarted.resolve(token).pipe(Effect.either))), true)
})

test("cursor memory rejects coercing cursor objects without invoking toString", async () => {
  const state = { owner: "a".repeat(32), collection: "tools", revision: 1, offset: 1, view: ["a", "b"] }
  const cursor = await Effect.runPromise(ServerApi.PaginationCursor.memory())
  const token = await Effect.runPromise(cursor.issue(state))
  let invoked = 0
  const hostile = { toString() { invoked += 1; return token } }
  const outcome = await Effect.runPromise(cursor.resolve(hostile).pipe(Effect.either))
  assert.equal(Either.isLeft(outcome), true)
  assert.equal(outcome.left._tag, "SchemaValidationError")
  assert.equal(invoked, 0)
})

test("cursor memory rejects hostile states as typed failures without invoking accessors", async () => {
  const cursor = await Effect.runPromise(ServerApi.PaginationCursor.memory())
  let invoked = 0
  const accessorState = {
    get owner() { invoked += 1; throw new Error("owner-secret") },
    collection: "tools", revision: 1, offset: 1, view: ["a", "b"]
  }
  const hostileView = ["a", "b"]
  Object.defineProperty(hostileView, "0", { get() { invoked += 1; throw new Error("view-secret") } })
  const proxyState = new Proxy({}, {
    ownKeys() { invoked += 1; throw new Error("proxy-secret") }
  })
  for (const state of [
    accessorState,
    { owner: "a".repeat(32), collection: "tools", revision: 1, offset: 1, view: hostileView },
    proxyState
  ]) {
    const outcome = await Effect.runPromise(cursor.issue(state).pipe(Effect.either))
    assert.equal(Either.isLeft(outcome), true)
    assert.equal(outcome.left._tag, "SchemaValidationError")
    assert.equal(outcome.left.message.includes("secret"), false)
  }
  assert.equal(invoked, 1, "only the Proxy ownKeys trap may run during descriptor inspection")
})

test("registry replacement removes stale resource-template and prompt completions", async () => {
  const id = McpSchema.param("id", McpSchema.Cursor)
  const server = await makeServer(Effect.gen(function*() {
    yield* McpServer.registerResource`template://replace/${id}`({
      name: "old", completion: { id: () => Effect.succeed(["stale-template"]) },
      content: (uri) => Effect.succeed(uri)
    })
    yield* McpServer.registerResource`template://replace/${id}`({
      name: "new", content: (uri) => Effect.succeed(uri)
    })
    yield* McpServer.registerPrompt({
      name: "replace", parameters: { old: McpSchema.Cursor },
      completion: { old: () => Effect.succeed(["stale-prompt"]) },
      content: () => Effect.succeed("old")
    })
    yield* McpServer.registerPrompt({
      name: "replace", parameters: { next: McpSchema.Cursor },
      content: () => Effect.succeed("new")
    })
  }))
  const template = await Effect.runPromise(dispatch(server, "completion/complete", {
    ref: { type: "ref/resource", uri: "template://replace/{id}" },
    argument: { name: "id", value: "" }
  }))
  const prompt = await Effect.runPromise(dispatch(server, "completion/complete", {
    ref: { type: "ref/prompt", name: "replace" },
    argument: { name: "old", value: "" }
  }))
  assert.deepEqual(template.completion.values, [])
  assert.deepEqual(prompt.completion.values, [])
})

test("cursor services are isolated across concurrent servers and client views", async () => {
  const annotations = Context.make(McpSchema.EnabledWhen, (context) => context.clientInfo?.name === "allowed")
  const handlers = Effect.all([
    McpServer.registerTool({ name: "a", content: () => Effect.succeed("a") }),
    McpServer.registerTool({ name: "b", content: () => Effect.succeed("b") }),
    McpServer.registerTool({ name: "c", annotations, content: () => Effect.succeed("c") })
  ], { discard: true })
  const [one, two] = await Promise.all([makeServer(handlers), makeServer(handlers)])
  const [oneFirst, twoFirst] = await Promise.all([
    Effect.runPromise(dispatch(one, "tools/list", {}, "allowed")),
    Effect.runPromise(dispatch(two, "tools/list", {}, "allowed"))
  ])
  assert.equal(Either.isLeft(await Effect.runPromise(dispatch(two, "tools/list", { cursor: oneFirst.nextCursor }, "allowed").pipe(Effect.either))), true)
  assert.equal(Either.isLeft(await Effect.runPromise(dispatch(one, "tools/list", { cursor: oneFirst.nextCursor }, "denied").pipe(Effect.either))), true)
  assert.deepEqual((await Effect.runPromise(dispatch(two, "tools/list", { cursor: twoFirst.nextCursor }, "allowed"))).tools.map(({ name }) => name), ["c"])
})

test("cursor callback throws and non-Effect returns are contained without invocation drift", async () => {
  const cases = [
    { issue: () => { throw new Error("issue-secret") }, resolve: () => Effect.die("unused"), invalidate: () => Effect.void },
    { issue: () => "not-an-effect", resolve: () => Effect.die("unused"), invalidate: () => Effect.void }
  ]
  for (const paginationCursor of cases) {
    const server = await makeServer(Effect.all([
      McpServer.registerTool({ name: "a", content: () => Effect.succeed("a") }),
      McpServer.registerTool({ name: "b", content: () => Effect.succeed("b") }),
      McpServer.registerTool({ name: "c", content: () => Effect.succeed("c") })
    ], { discard: true }), { paginationCursor })
    const outcome = await Effect.runPromise(dispatch(server, "tools/list").pipe(Effect.either))
    assert.equal(Either.isLeft(outcome), true)
    assert.equal(outcome.left._tag, "SchemaValidationError")
    assert.equal(outcome.left.message.includes("secret"), false)
  }
})

test("deep cursor callback Causes remain stack-safe and interruption-preserving", async () => {
  let deep = Cause.interrupt("deep-cursor")
  for (let index = 0; index < 12_000; index++) deep = Cause.sequential(Cause.fail(new Error("deep")), deep)
  const cursor = { issue: () => Effect.failCause(deep), resolve: () => Effect.failCause(deep), invalidate: () => Effect.void }
  const server = await makeServer(Effect.all([
    McpServer.registerTool({ name: "a", content: () => Effect.succeed("a") }),
    McpServer.registerTool({ name: "b", content: () => Effect.succeed("b") }),
    McpServer.registerTool({ name: "c", content: () => Effect.succeed("c") })
  ], { discard: true }), { paginationCursor: cursor })
  const exit = await Effect.runPromiseExit(dispatch(server, "tools/list"))
  assert.equal(exit._tag, "Failure")
  assert.equal(Cause.isInterrupted(exit.cause), true)
})
