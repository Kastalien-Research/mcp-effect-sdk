import assert from "node:assert/strict"
import { test } from "node:test"
import * as Cause from "effect/Cause"
import * as Context from "effect/Context"
import * as Effect from "effect/Effect"
import * as Either from "effect/Either"
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
    assert.equal(outcome.left.message.includes(value), false)
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
  assert.equal(JSON.stringify(exit).includes("private-cache-token"), false)
})
