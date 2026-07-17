import assert from "node:assert/strict"
import { spawn } from "node:child_process"
import { once } from "node:events"
import { test } from "node:test"
import * as Effect from "effect/Effect"
import * as Either from "effect/Either"
import * as FiberRef from "effect/FiberRef"
import * as Layer from "effect/Layer"
import * as ManagedRuntime from "effect/ManagedRuntime"
import * as Queue from "effect/Queue"
import * as Schema from "effect/Schema"
import * as McpSchema from "../../dist/McpSchema.js"
import * as McpServer from "../../dist/McpServer.js"
import { currentRequestAnnotations } from "../../dist/internal/RuntimeContext.js"
import * as StreamableHttpServerTransport from "../../dist/transport/StreamableHttpServerTransport.js"

const decodeFails = (schema, value) => Either.isLeft(Schema.decodeUnknownEither(schema)(value))

test("modern result codecs require resultType and cache metadata", () => {
  assert.equal(decodeFails(McpSchema.ListToolsResult, { tools: [] }), true)
  assert.equal(decodeFails(McpSchema.ListToolsResult, {
    resultType: "complete",
    ttlMs: 0,
    cacheScope: "private",
    tools: []
  }), false)
})

test("capability codecs retain generated nested structures", () => {
  assert.equal(decodeFails(McpSchema.ClientCapabilities, { roots: "not-an-object" }), true)
  assert.equal(decodeFails(McpSchema.ClientCapabilities, { sampling: { tools: "not-an-object" } }), true)
  assert.equal(decodeFails(McpSchema.ServerCapabilities, { resources: { subscribe: "yes" } }), true)
})

test("McpError and modern request/notification payloads fail closed", () => {
  assert.equal(decodeFails(McpSchema.McpError, { arbitrary: true }), true)
  assert.equal(decodeFails(McpSchema.McpError, { code: -32601, message: "missing" }), false)
  assert.equal(decodeFails(McpSchema.CallTool.payloadSchema, {}), true)
  assert.equal(decodeFails(McpSchema.Complete.payloadSchema, { ref: { type: "ref/prompt", name: "p" } }), true)
  assert.equal(decodeFails(McpSchema.SubscriptionsListen.payloadSchema, { notifications: "all" }), true)
  assert.equal(decodeFails(McpSchema.ProgressNotification.payloadSchema, { progressToken: "p" }), true)
  assert.equal(decodeFails(McpSchema.ResourceUpdatedNotification.payloadSchema, { uri: 42 }), true)
})

const makeClient = (traceparent) => McpSchema.McpServerClient.of({
  clientId: traceparent,
  initializePayload: { traceparent, capabilities: new McpSchema.ClientCapabilities({}) }
})

test("dispatch installs request annotations without leaking between concurrent calls", async () => {
  const app = Layer.effectDiscard(McpServer.registerTool({
    name: "request-context",
    content: () => FiberRef.get(currentRequestAnnotations)
  }))
  const runtime = ManagedRuntime.make(app.pipe(Layer.provideMerge(McpServer.McpServer.layer)))
  const call = (traceparent) => runtime.runPromise(
    McpServer.dispatch("tools/call", {
      name: "request-context",
      _meta: { traceparent }
    }).pipe(Effect.provideService(McpSchema.McpServerClient, makeClient(traceparent)))
  )
  try {
    const [left, right] = await Promise.all([call("trace-left"), call("trace-right")])
    assert.deepEqual(left.structuredContent, { traceparent: "trace-left" })
    assert.deepEqual(right.structuredContent, { traceparent: "trace-right" })
  } finally {
    await runtime.dispose()
  }
})

test("completion, subscriptions, and list-change server behavior remains observable", async () => {
  const id = McpSchema.param("id", Schema.String)
  const app = Layer.mergeAll(
    McpServer.resource`test://item/${id}`({
      name: "item",
      completion: { id: () => Effect.succeed(["one", "two"]) },
      content: (uri) => Effect.succeed(uri)
    })
  )
  const runtime = ManagedRuntime.make(app.pipe(Layer.provideMerge(McpServer.McpServer.layer)))
  try {
    const completion = await runtime.runPromise(
      McpServer.dispatch("completion/complete", {
        ref: { type: "ref/resource", uri: "test://item/{id}" },
        argument: { name: "id", value: "o" }
      }).pipe(Effect.provideService(McpSchema.McpServerClient, makeClient("completion")))
    )
    assert.deepEqual(completion.completion.values, ["one", "two"])

    const listen = await runtime.runPromise(
      McpServer.dispatch("subscriptions/listen", { notifications: { toolsListChanged: true } })
        .pipe(Effect.provideService(McpSchema.McpServerClient, makeClient("listen")))
    )
    assert.equal(listen.resultType, "complete")

    await runtime.runPromise(McpServer.sendToolListChanged)
    const server = await runtime.runPromise(McpServer.McpServer)
    const notification = await runtime.runPromise(Queue.take(server.notificationsQueue))
    assert.equal(notification.tag, "notifications/tools/list_changed")
  } finally {
    await runtime.dispose()
  }
})

test("unknown HTTP method returns exact 404 and JSON-RPC -32601", async () => {
  const web = StreamableHttpServerTransport.toWebHandler(Layer.empty, {
    name: "review",
    version: "1.0.0",
    path: "/mcp"
  })
  try {
    const response = await web.handler(new Request("http://localhost/mcp", {
      method: "POST",
      headers: { "content-type": "application/json", accept: "application/json, text/event-stream" },
      body: JSON.stringify({ jsonrpc: "2.0", id: "unknown", method: "unknown/method", params: {} })
    }))
    assert.equal(response.status, 404)
    const body = await response.json()
    assert.equal(body.error.code, -32601)
  } finally {
    await web.dispose()
  }
})

test("public HTTP layer registers an operational route", async () => {
  assert.equal(typeof McpServer.HttpRouteRegistry, "function")
  let registered
  const routes = Layer.succeed(McpServer.HttpRouteRegistry, {
    post: (path, handler) => Effect.sync(() => { registered = { path, handler } })
  })
  const runtime = ManagedRuntime.make(McpServer.layerHttp({
    name: "layer-review",
    version: "1.0.0",
    path: "/mcp"
  }).pipe(Layer.provide(routes)))
  try {
    await runtime.runPromise(McpServer.McpServer)
    assert.equal(registered.path, "/mcp")
    const response = await Effect.runPromise(registered.handler(new Request("http://localhost/mcp", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list", params: {} })
    })))
    assert.equal(response.status, 200)
    assert.equal((await response.json()).result.resultType, "complete")
  } finally {
    await runtime.dispose()
  }
})

test("public stdio server layer reads and writes NDJSON", { timeout: 5_000 }, async () => {
  const child = spawn(process.execPath, ["test/foundation/wp2-stdio-fixture.mjs"], {
    cwd: process.cwd(),
    stdio: ["pipe", "pipe", "pipe"]
  })
  let stdout = ""
  let stderr = ""
  child.stdout.setEncoding("utf8")
  child.stderr.setEncoding("utf8")
  child.stdout.on("data", (chunk) => { stdout += chunk })
  child.stderr.on("data", (chunk) => { stderr += chunk })
  child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", id: 7, method: "tools/list", params: {} })}\n`)

  const response = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`stdio response timeout; stderr=${stderr}`)), 3_000)
    child.stdout.on("data", () => {
      const line = stdout.split("\n").find((candidate) => candidate.trim())
      if (line) {
        clearTimeout(timer)
        resolve(JSON.parse(line))
      }
    })
    child.once("exit", (code) => {
      if (!stdout.trim()) {
        clearTimeout(timer)
        reject(new Error(`stdio server exited ${code} before responding; stderr=${stderr}`))
      }
    })
  })
  assert.equal(response.id, 7)
  assert.equal(response.result.resultType, "complete")
  assert.equal(response.result.tools[0].name, "stdio-tool")
  child.kill("SIGTERM")
  await once(child, "exit")
})
