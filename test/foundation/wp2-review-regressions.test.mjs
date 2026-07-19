import assert from "node:assert/strict"
import { spawn, spawnSync } from "node:child_process"
import { once } from "node:events"
import { test } from "node:test"
import * as HttpApp from "@effect/platform/HttpApp"
import * as HttpRouter from "@effect/platform/HttpRouter"
import * as Context from "effect/Context"
import * as Effect from "effect/Effect"
import * as Either from "effect/Either"
import * as FiberRef from "effect/FiberRef"
import * as Layer from "effect/Layer"
import * as ManagedRuntime from "effect/ManagedRuntime"
import * as Schema from "effect/Schema"
import * as EffectPlatform from "../../dist/integrations/EffectPlatform.js"
import * as McpModern from "../../dist/McpModern.js"
import * as McpSchema from "../../dist/McpSchema.js"
import * as McpServer from "../../dist/McpServer.js"
import { currentRequestAnnotations } from "../../dist/internal/RuntimeContext.js"
import * as StreamableHttpServerTransport from "../../dist/transport/StreamableHttpServerTransport.js"

const decodeFails = (schema, value) => Either.isLeft(Schema.decodeUnknownEither(schema)(value))

const stdioParams = (params = {}) => ({
  ...params,
  _meta: {
    "io.modelcontextprotocol/clientCapabilities": {},
    "io.modelcontextprotocol/protocolVersion": "2026-07-28"
  }
})

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
  requestContext: { traceparent, capabilities: new McpSchema.ClientCapabilities({}) }
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

    const server = await runtime.runPromise(McpServer.McpServer)
    const notifications = []
    const close = server.openSubscription("wp2-review", {
      resourcesListChanged: true,
      toolsListChanged: true
    }, (notification) => Effect.sync(() => {
      notifications.push(notification)
    }))
    try {
      await runtime.runPromise(McpServer.sendResourceListChanged)
      await runtime.runPromise(McpServer.sendToolListChanged)
    } finally {
      close()
    }
    assert.deepEqual(
      notifications.map(({ tag }) => tag),
      ["notifications/resources/list_changed", "notifications/tools/list_changed"]
    )
  } finally {
    await runtime.dispose()
  }
})

test("server discovery advertises capabilities backed by the live registry", async () => {
  const id = McpSchema.param("id", Schema.String)
  const app = Layer.mergeAll(
    McpServer.tool({
      name: "discover-tool",
      content: () => Effect.succeed("ok")
    }),
    McpServer.resource`test://discover/${id}`({
      name: "discover-resource",
      completion: { id: () => Effect.succeed(["one"]) },
      content: (uri) => Effect.succeed(uri)
    }),
    McpServer.prompt({
      name: "discover-prompt",
      content: () => Effect.succeed("ok")
    })
  )
  const runtime = ManagedRuntime.make(app.pipe(Layer.provideMerge(McpServer.McpServer.layer)))
  try {
    const result = await runtime.runPromise(
      McpServer.dispatch("server/discover", {})
        .pipe(Effect.provideService(McpSchema.McpServerClient, makeClient("discover")))
    )
    assert.deepEqual(result.capabilities, {
      completions: {},
      extensions: {},
      prompts: { listChanged: true },
      resources: { listChanged: true, subscribe: true },
      tools: { listChanged: true }
    })
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
    const response = await web.handler(modernWebRequest({
      id: "unknown",
      method: "unknown/method"
    }))
    assert.equal(response.status, 404)
    const body = await response.json()
    assert.equal(body.error.code, -32601)
  } finally {
    await web.dispose()
  }
})

test("Web HTTP discovery uses transport options and resource blobs use base64 on the wire", async () => {
  const app = McpServer.resource({
    uri: "test://wire-blob",
    name: "wire-blob",
    content: Effect.succeed(Uint8Array.from([1, 2, 3]))
  })
  const web = StreamableHttpServerTransport.toWebHandler(app, {
    name: "web-options",
    version: "3.0.0",
    path: "/mcp",
    enableJsonResponse: true
  })
  const request = (id, method, params = {}, headers = {}) =>
    web.handler(modernWebRequest({ id, method, params, headers }))
  try {
    const discover = await (await request(1, "server/discover")).json()
    assert.deepEqual(discover.result._meta["io.modelcontextprotocol/serverInfo"], {
      name: "web-options",
      version: "3.0.0"
    })
    assert.equal("serverInfo" in discover.result, false)
    const resource = await (await request(2, "resources/read", { uri: "test://wire-blob" }, {
      [McpModern.MCP_NAME_HEADER]: "test://wire-blob"
    })).json()
    assert.equal(resource.result.contents[0].blob, "AQID")
  } finally {
    await web.dispose()
  }
})

test("legacy public HTTP route ownership is removed from McpServer", () => {
  assert.equal("HttpRouteRegistry" in McpServer, false)
  assert.equal("handleWebRequest" in McpServer, false)
  assert.equal("layerHttp" in McpServer, false)
  assert.equal("httpRouteRegistryLayer" in EffectPlatform, false)
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
  const responseReady = new Promise((resolve, reject) => {
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
  child.stdin.write(`${JSON.stringify({
    jsonrpc: "2.0",
    id: 7,
    method: "tools/list",
    params: stdioParams()
  })}\n`)
  const response = await responseReady
  assert.equal(response.id, 7)
  assert.equal(response.result.resultType, "complete")
  assert.equal(response.result.tools.some(({ name }) => name === "stdio-tool"), true)
  child.kill("SIGTERM")
  await once(child, "exit")
})

test("the root entrypoint imports without the optional Effect Platform peer", () => {
  const result = spawnSync(process.execPath, [
    "--experimental-loader",
    "./test/foundation/deny-effect-platform-loader.mjs",
    "--input-type=module",
    "--eval",
    "await import('./dist/index.js')"
  ], { cwd: process.cwd(), encoding: "utf8" })
  assert.equal(result.status, 0, `${result.stdout}${result.stderr}`)
})

const makeLayerRuntime = (options = {}) => {
  const runtime = ManagedRuntime.make(EffectPlatform.layer({
    name: "boundary-http",
    version: "2.0.0",
    path: "/mcp",
    enableJsonResponse: true,
    instructions: "boundary instructions",
    extensions: { "example.com/feature": { enabled: true } },
    supportedProtocolVersions: ["2026-07-28"],
    ...options
  }).pipe(Layer.provideMerge(HttpRouter.Default.Live)))
  return {
    runtime,
    registered: async () => {
      const router = await runtime.runPromise(HttpRouter.Default.router)
      const handler = HttpApp.toWebHandler(router)
      return {
        path: "/mcp",
        handler: (request) => Effect.promise(() => handler(request))
      }
    }
  }
}

const modernWebRequest = ({
  id,
  method,
  params = {},
  accept = "application/json, text/event-stream",
  body,
  headers = {}
}) =>
  new Request("http://localhost/mcp", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      accept,
      [McpModern.MCP_PROTOCOL_VERSION_HEADER]: McpModern.MODERN_PROTOCOL_VERSION,
      [McpModern.MCP_METHOD_HEADER]: method,
      ...headers
    },
    body: body ?? JSON.stringify({
      jsonrpc: "2.0",
      id,
      method,
      params: {
        ...params,
        _meta: {
          "io.modelcontextprotocol/clientCapabilities": {},
          "io.modelcontextprotocol/protocolVersion": McpModern.MODERN_PROTOCOL_VERSION,
          ...(params._meta ?? {})
        }
      }
    })
  })

test("public HTTP layer discovers its configured server and reports parse errors", async () => {
  const harness = makeLayerRuntime()
  try {
    const registered = await harness.registered()
    const discoverResponse = await Effect.runPromise(registered.handler(modernWebRequest({
      id: 1,
      method: "server/discover"
    })))
    assert.equal(discoverResponse.status, 200)
    const discover = await discoverResponse.json()
    assert.deepEqual(discover.result._meta["io.modelcontextprotocol/serverInfo"], {
      name: "boundary-http",
      version: "2.0.0"
    })
    assert.equal("serverInfo" in discover.result, false)
    assert.equal(discover.result.resultType, "complete")
    assert.equal(discover.result.instructions, "boundary instructions")
    assert.deepEqual(discover.result.supportedVersions, ["2026-07-28"])
    assert.deepEqual(discover.result.capabilities.extensions, {
      "example.com/feature": { enabled: true }
    })

    const malformedResponse = await Effect.runPromise(registered.handler(modernWebRequest({
      method: "server/discover",
      body: "{not-json"
    })))
    assert.equal(malformedResponse.status, 400)
    assert.equal(await malformedResponse.text(), "")
  } finally {
    await harness.runtime.dispose()
  }
})

test("tool handlers use dispatch request services instead of registration services", async () => {
  const registrationClient = McpSchema.McpServerClient.of({
    clientId: 111,
    requestContext: { capabilities: new McpSchema.ClientCapabilities({}) }
  })
  const dispatchClient = McpSchema.McpServerClient.of({
    clientId: 222,
    requestContext: {
      capabilities: new McpSchema.ClientCapabilities({
        experimental: { dispatch: { enabled: true } }
      })
    }
  })
  const app = Layer.effectDiscard(McpServer.registerTool({
    name: "dispatch-client",
    content: () => Effect.all({
      clientId: McpSchema.McpServerClient.pipe(Effect.map((client) => client.clientId)),
      capabilities: McpServer.clientCapabilities
    })
  }).pipe(Effect.provideService(McpSchema.McpServerClient, registrationClient)))
  const runtime = ManagedRuntime.make(app.pipe(Layer.provideMerge(McpServer.McpServer.layer)))
  try {
    const result = await runtime.runPromise(McpServer.dispatch("tools/call", {
      name: "dispatch-client"
    }).pipe(Effect.provideService(McpSchema.McpServerClient, dispatchClient)))
    assert.equal(result.structuredContent.clientId, 222)
    assert.deepEqual(result.structuredContent.capabilities.experimental, {
      dispatch: { enabled: true }
    })
  } finally {
    await runtime.dispose()
  }
})

test("registries preserve Effect schema structure, transformations, and binary content", async () => {
  const id = McpSchema.param("id", Schema.NumberFromString)
  const app = Layer.mergeAll(
    McpServer.tool({
      name: "schema-tool",
      parameters: {
        count: Schema.Number,
        label: Schema.optional(Schema.String)
      },
      content: ({ count, label }) => Effect.succeed({ count, label })
    }),
    McpServer.prompt({
      name: "schema-prompt",
      parameters: {
        required: Schema.String,
        optional: Schema.optional(Schema.String)
      },
      content: ({ required, optional }) => Effect.succeed(`${required}:${optional ?? "missing"}`)
    }),
    McpServer.resource`test://number/${id}`({
      name: "number-resource",
      content: (uri, value) => Effect.succeed(`${typeof value}:${value}`)
    }),
    McpServer.resource({
      uri: "test://blob",
      name: "blob-resource",
      mimeType: "application/octet-stream",
      content: Effect.succeed(Uint8Array.from([1, 2, 3]))
    })
  )
  const runtime = ManagedRuntime.make(app.pipe(Layer.provideMerge(McpServer.McpServer.layer)))
  const dispatch = (method, params) => runtime.runPromise(
    McpServer.dispatch(method, params).pipe(Effect.provideService(McpSchema.McpServerClient, makeClient("registry")))
  )
  try {
    const tools = await dispatch("tools/list", {})
    assert.deepEqual(tools.tools.find(({ name }) => name === "schema-tool").inputSchema, {
      $schema: "http://json-schema.org/draft-07/schema#",
      type: "object",
      required: ["count"],
      properties: {
        count: { type: "number" },
        label: { type: "string" }
      },
      additionalProperties: false
    })

    const prompts = await dispatch("prompts/list", {})
    assert.deepEqual(prompts.prompts.find(({ name }) => name === "schema-prompt").arguments, [
      new McpSchema.PromptArgument({ name: "required", required: true }),
      new McpSchema.PromptArgument({ name: "optional", required: false })
    ])

    const transformed = await dispatch("resources/read", { uri: "test://number/42" })
    assert.equal(transformed.contents[0].text, "number:42")

    const binary = await dispatch("resources/read", { uri: "test://blob" })
    assert.equal(binary.contents[0] instanceof McpSchema.BlobResourceContents, true)
    assert.deepEqual(binary.contents[0].blob, Uint8Array.from([1, 2, 3]))
    assert.equal("text" in binary.contents[0], false)
  } finally {
    await runtime.dispose()
  }
})

test("registration metadata and EnabledWhen visibility remain request-client aware", async () => {
  const onlyClientA = Context.make(McpSchema.EnabledWhen, (client) => client.clientInfo?.name === "client-a")
  const id = McpSchema.param("id", Schema.NumberFromString)
  const app = Layer.mergeAll(
    McpServer.tool({
      name: "conditional-tool",
      annotations: onlyClientA,
      content: () => Effect.succeed("visible")
    }),
    McpServer.resource({
      uri: "test://conditional-resource",
      name: "conditional-resource",
      audience: ["assistant"],
      priority: 0.75,
      annotations: onlyClientA,
      content: Effect.succeed("visible")
    }),
    McpServer.resource`test://conditional-template/${id}`({
      name: "conditional-template",
      audience: ["user"],
      priority: 0.25,
      annotations: onlyClientA,
      content: (_uri, value) => Effect.succeed(String(value))
    }),
    McpServer.prompt({
      name: "conditional-prompt",
      annotations: onlyClientA,
      parameters: {
        subject: Schema.String.annotations({ description: "Subject to discuss" }),
        detail: Schema.optional(Schema.String).annotations({ description: "Optional detail" }),
        tone: Schema.optionalWith(Schema.String, { default: () => "neutral" }).annotations({
          description: "Preferred tone"
        })
      },
      content: ({ subject }) => Effect.succeed(subject)
    })
  )
  const runtime = ManagedRuntime.make(app.pipe(Layer.provideMerge(McpServer.McpServer.layer)))
  const client = (name) => McpSchema.McpServerClient.of({
    clientId: name === "client-a" ? 1 : 2,
    requestContext: {
      clientInfo: { name, version: "1.0.0" },
      capabilities: new McpSchema.ClientCapabilities({})
    }
  })
  const list = (method, name) => runtime.runPromise(
    McpServer.dispatch(method, {}).pipe(Effect.provideService(McpSchema.McpServerClient, client(name)))
  )
  try {
    const [toolsA, resourcesA, templatesA, promptsA, toolsB, resourcesB, templatesB, promptsB] = await Promise.all([
      list("tools/list", "client-a"),
      list("resources/list", "client-a"),
      list("resources/templates/list", "client-a"),
      list("prompts/list", "client-a"),
      list("tools/list", "client-b"),
      list("resources/list", "client-b"),
      list("resources/templates/list", "client-b"),
      list("prompts/list", "client-b")
    ])
    assert.deepEqual(toolsA.tools.map(({ name }) => name), ["conditional-tool"])
    assert.deepEqual(resourcesA.resources[0].annotations, new McpSchema.Annotations({
      audience: ["assistant"], priority: 0.75
    }))
    assert.deepEqual(templatesA.resourceTemplates[0].annotations, new McpSchema.Annotations({
      audience: ["user"], priority: 0.25
    }))
    assert.deepEqual(promptsA.prompts[0].arguments, [
      new McpSchema.PromptArgument({ name: "subject", description: "Subject to discuss", required: true }),
      new McpSchema.PromptArgument({ name: "detail", description: "Optional detail", required: false }),
      new McpSchema.PromptArgument({ name: "tone", description: "Preferred tone", required: false })
    ])

    assert.deepEqual(toolsB.tools, [])
    assert.deepEqual(resourcesB.resources, [])
    assert.deepEqual(templatesB.resourceTemplates, [])
    assert.deepEqual(promptsB.prompts, [])
  } finally {
    await runtime.dispose()
  }
})

const waitForJsonLine = (child, predicate, timeout = 3_000) => new Promise((resolve, reject) => {
  let buffer = ""
  let stderr = ""
  child.stderr.setEncoding("utf8")
  child.stderr.on("data", (chunk) => { stderr += chunk })
  child.stdout.setEncoding("utf8")
  const timer = setTimeout(() => {
    cleanup()
    reject(new Error(`stdio response timeout; stderr=${stderr}`))
  }, timeout)
  const onData = (chunk) => {
    buffer += chunk
    const lines = buffer.split("\n")
    buffer = lines.pop() ?? ""
    for (const line of lines) {
      if (!line.trim()) continue
      const value = JSON.parse(line)
      if (predicate(value)) {
        cleanup()
        resolve(value)
        return
      }
    }
  }
  const onExit = (code) => {
    cleanup()
    reject(new Error(`stdio server exited ${code}; stderr=${stderr}`))
  }
  const cleanup = () => {
    clearTimeout(timer)
    child.stdout.off("data", onData)
    child.off("exit", onExit)
  }
  child.stdout.on("data", onData)
  child.on("exit", onExit)
})

test("stdio discovery, subscriptions, and fail-closed framing are protocol-live", { timeout: 10_000 }, async () => {
  const child = spawn(process.execPath, ["test/foundation/wp2-stdio-fixture.mjs"], {
    cwd: process.cwd(),
    stdio: ["pipe", "pipe", "pipe"]
  })
  try {
    child.stdin.write(`${JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "server/discover",
      params: stdioParams()
    })}\n`)
    const discover = await waitForJsonLine(child, (value) => value.id === 1)
    assert.deepEqual(discover.result._meta["io.modelcontextprotocol/serverInfo"], {
      name: "stdio-review",
      version: "1.0.0"
    })
    assert.equal("serverInfo" in discover.result, false)
    assert.equal(discover.result.resultType, "complete")

    child.stdin.write(`${JSON.stringify({
      jsonrpc: "2.0",
      id: 7,
      method: "subscriptions/listen",
      params: stdioParams({ notifications: { toolsListChanged: true } })
    })}\n`)
    const acknowledged = await waitForJsonLine(child, (value) => value.method === "notifications/subscriptions/acknowledged")
    assert.deepEqual(acknowledged.params.notifications, { toolsListChanged: true })
    assert.equal(acknowledged.params._meta["io.modelcontextprotocol/subscriptionId"], 7)

    child.stdin.write(`${JSON.stringify({
      jsonrpc: "2.0",
      id: 8,
      method: "tools/call",
      params: stdioParams({ name: "emit-list-change" })
    })}\n`)
    const changed = await waitForJsonLine(child, (value) => value.method === "notifications/tools/list_changed")
    assert.equal(changed.params._meta["io.modelcontextprotocol/subscriptionId"], 7)
    const call = await waitForJsonLine(child, (value) => value.id === 8)
    assert.equal(call.result.resultType, "complete")

    child.stdin.write("{not-json\n")
    await assert.rejects(
      waitForJsonLine(child, () => true, 150),
      /stdio response timeout/
    )
  } finally {
    child.kill("SIGTERM")
    await once(child, "exit")
  }
})

const readSseJson = async (reader, predicate, timeout = 3_000) => {
  const decoder = new TextDecoder()
  let buffer = ""
  return Promise.race([
    (async () => {
      while (true) {
        const { done, value } = await reader.read()
        if (done) throw new Error("SSE stream ended before expected notification")
        buffer += decoder.decode(value, { stream: true })
        const events = buffer.split("\n\n")
        buffer = events.pop() ?? ""
        for (const event of events) {
          const data = event.split("\n").find((line) => line.startsWith("data: "))
          if (!data) continue
          const parsed = JSON.parse(data.slice(6))
          if (predicate(parsed)) return parsed
        }
      }
    })(),
    new Promise((_, reject) => setTimeout(() => reject(new Error("SSE response timeout")), timeout))
  ])
}

test("HTTP subscriptions stream acknowledgements and subsequent list changes", { timeout: 10_000 }, async () => {
  const harness = makeLayerRuntime()
  try {
    const registered = await harness.registered()
    const response = await Effect.runPromise(registered.handler(modernWebRequest({
      id: "http-sub",
      method: "subscriptions/listen",
      params: { notifications: { toolsListChanged: true } }
    })))
    assert.equal(response.status, 200)
    assert.match(response.headers.get("content-type") ?? "", /^text\/event-stream/)
    const reader = response.body.getReader()
    const acknowledged = await readSseJson(reader, (value) => value.method === "notifications/subscriptions/acknowledged")
    assert.equal(acknowledged.params._meta["io.modelcontextprotocol/subscriptionId"], "http-sub")
    await harness.runtime.runPromise(McpServer.sendToolListChanged)
    const changed = await readSseJson(reader, (value) => value.method === "notifications/tools/list_changed")
    assert.equal(changed.params._meta["io.modelcontextprotocol/subscriptionId"], "http-sub")

    const promptsResponse = await Effect.runPromise(registered.handler(modernWebRequest({
      id: "prompt-sub",
      method: "subscriptions/listen",
      params: { notifications: { promptsListChanged: true } }
    })))
    const promptsReader = promptsResponse.body.getReader()
    await readSseJson(promptsReader, (value) => value.method === "notifications/subscriptions/acknowledged")
    await harness.runtime.runPromise(McpServer.sendPromptListChanged)
    const promptChanged = await readSseJson(promptsReader, (value) => value.method === "notifications/prompts/list_changed")
    assert.equal(promptChanged.params._meta["io.modelcontextprotocol/subscriptionId"], "prompt-sub")
    await reader.cancel()
    await promptsReader.cancel()
  } finally {
    await harness.runtime.dispose()
  }
})
