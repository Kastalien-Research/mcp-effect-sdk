import assert from "node:assert/strict"
import { test } from "node:test"
import * as Context from "effect/Context"
import * as Effect from "effect/Effect"
import * as Either from "effect/Either"
import * as Queue from "effect/Queue"
import * as Schema from "effect/Schema"
import { SchemaValidationError } from "../../dist/McpErrors.js"
import * as McpModern from "../../dist/McpModern.js"
import * as McpSchema from "../../dist/McpSchema.js"
import * as McpServer from "../../dist/McpServer.js"
import * as StreamableHttpServerTransport from "../../dist/transport/StreamableHttpServerTransport.js"

const SERVER_INFO_KEY = "io.modelcontextprotocol/serverInfo"
const protocolVersion = "2026-07-28"

const requestParams = (params = {}, capabilities = {}, clientInfo) => ({
  ...params,
  _meta: {
    "io.modelcontextprotocol/protocolVersion": protocolVersion,
    "io.modelcontextprotocol/clientCapabilities": capabilities,
    ...(clientInfo === undefined
      ? {}
      : { "io.modelcontextprotocol/clientInfo": clientInfo })
  }
})

const request = (id, method, params = {}) => ({
  _tag: "Request",
  jsonrpc: "2.0",
  id,
  method,
  params: requestParams(params)
})

const dispatchWire = (server, message) => Effect.scoped(Effect.gen(function*() {
  const sent = yield* Queue.unbounded()
  const dispatcher = yield* McpServer.makeDispatcher({
    send: (response) => Queue.offer(sent, response).pipe(Effect.asVoid)
  }).pipe(Effect.provideService(McpServer.McpServer, server))
  yield* dispatcher.accept(message)
  return yield* Queue.take(sent)
}))

const client = ({ id, capabilities = {}, clientInfo }) => McpSchema.McpServerClient.of({
  clientId: id,
  requestContext: {
    protocolVersion,
    capabilities,
    clientInfo
  }
})

const dispatch = (server, clientService, method, params) => McpServer.dispatch(
  method,
  requestParams(params, clientService.requestContext.capabilities, clientService.requestContext.clientInfo)
).pipe(
  Effect.provideService(McpServer.McpServer, server),
  Effect.provideService(McpSchema.McpServerClient, clientService)
)

const handlersFor = (name, registrations) => Effect.gen(function*() {
  yield* Effect.sync(() => {
    registrations.count += 1
  })
  yield* McpServer.registerTool({
    name: `${name}-tool`,
    content: () => Effect.succeed(`${name}-tool-result`)
  })
  yield* McpServer.registerResource({
    uri: `test://${name}/resource`,
    name: `${name}-resource`,
    content: Effect.succeed(`${name}-resource-result`)
  })
  yield* McpServer.registerPrompt({
    name: `${name}-prompt`,
    parameters: { choice: Schema.String },
    completion: {
      choice: () => Effect.succeed([`${name}-completion`])
    },
    content: ({ choice }) => Effect.succeed(`${name}:${choice}`)
  })
})

test("explicit construction validates identity and runs one registration Effect once", async () => {
  const registrations = { count: 0 }
  const serverInfo = {
    name: "wp5b-explicit-server",
    title: "WP5B explicit server",
    version: "5.0.0"
  }
  const server = await Effect.runPromise(McpServer.make({
    serverInfo,
    handlers: handlersFor("explicit", registrations),
    instructions: "explicit construction",
    supportedProtocolVersions: [protocolVersion]
  }))
  serverInfo.name = "mutated-after-construction"

  assert.equal(registrations.count, 1)
  assert.deepEqual(server.tools.map(({ tool }) => tool.name), ["explicit-tool"])
  assert.deepEqual(server.resources.map(({ resource }) => resource.name), ["explicit-resource"])
  assert.deepEqual(server.prompts.map(({ prompt }) => prompt.name), ["explicit-prompt"])

  const discovered = await Effect.runPromise(dispatchWire(
    server,
    request("discover", "server/discover")
  ))
  assert.deepEqual(discovered.result._meta[SERVER_INFO_KEY], {
    name: "wp5b-explicit-server",
    title: "WP5B explicit server",
    version: "5.0.0"
  })
  assert.equal(discovered.result.instructions, "explicit construction")
})

test("server constructor properties are descriptor-snapshotted exactly once", async () => {
  const descriptorReads = new Map()
  const target = {
    serverInfo: { name: "descriptor-server", version: "5.0.0" },
    handlers: Effect.void,
    instructions: "snapshotted"
  }
  const options = new Proxy(target, {
    get(_target, property) {
      throw new Error(`server constructor property was read directly: ${String(property)}`)
    },
    getOwnPropertyDescriptor(current, property) {
      descriptorReads.set(property, (descriptorReads.get(property) ?? 0) + 1)
      return Reflect.getOwnPropertyDescriptor(current, property)
    },
    ownKeys: (current) => Reflect.ownKeys(current)
  })

  const server = await Effect.runPromise(McpServer.make(options))
  assert.equal(server.options.instructions, "snapshotted")
  assert.deepEqual(Object.fromEntries(descriptorReads), {
    serverInfo: 1,
    handlers: 1,
    instructions: 1
  })
})

test("temporal handlers accessors fail typed without invocation or defects", async () => {
  let getterCalls = 0
  const options = {
    serverInfo: { name: "temporal-handler-server", version: "5.0.0" }
  }
  Object.defineProperty(options, "handlers", {
    enumerable: true,
    get() {
      getterCalls += 1
      if (getterCalls === 1) return Effect.void
      throw new Error("temporal handlers getter was reread")
    }
  })

  const outcome = await Effect.runPromise(McpServer.make(options).pipe(Effect.either))
  assert.equal(Either.isLeft(outcome), true)
  assert.equal(outcome.left instanceof SchemaValidationError, true)
  assert.equal(getterCalls, 0)
})

test("invalid identity and extension configuration fail typed before handlers run", async (t) => {
  const identityAccessor = Object.defineProperty({ version: "5.0.0" }, "name", {
    enumerable: true,
    get() {
      throw new Error("identity accessor must not escape")
    }
  })
  const cyclicExtension = {}
  cyclicExtension.self = cyclicExtension
  const cases = [
    ["missing identity version", { serverInfo: { name: "missing-version" } }],
    ["identity accessor", { serverInfo: identityAccessor }],
    ["malformed extension name", {
      serverInfo: { name: "invalid-extension", version: "5.0.0" },
      extensions: { "not-namespaced": {} }
    }],
    ["non-JSON extension value", {
      serverInfo: { name: "non-json-extension", version: "5.0.0" },
      extensions: { "com.example/non-json": { value: 1n } }
    }],
    ["cyclic extension value", {
      serverInfo: { name: "cyclic-extension", version: "5.0.0" },
      extensions: { "com.example/cycle": cyclicExtension }
    }]
  ]

  for (const [label, invalid] of cases) {
    await t.test(label, async () => {
      let handlerRuns = 0
      const outcome = await Effect.runPromise(McpServer.make({
        handlers: Effect.sync(() => {
          handlerRuns += 1
        }),
        ...invalid
      }).pipe(Effect.either))
      assert.equal(Either.isLeft(outcome), true)
      assert.equal(outcome.left instanceof SchemaValidationError, true)
      assert.equal(handlerRuns, 0)
    })
  }
})

test("extension authority grammar and JSONObject settings are shared by server construction", async (t) => {
  const invalidNames = [
    ".example/demo",
    "1com.example/demo",
    "com..example/demo",
    "com.example./demo",
    "com.example/-bad",
    "com.example/bad-"
  ]
  const invalidSettings = [null, 1, "settings", []]
  for (const [label, extensions] of [
    ...invalidNames.map((name) => [`name ${name}`, { [name]: {} }]),
    ...invalidSettings.map((settings, index) => [
      `settings ${index}`,
      { "com.example/settings": settings }
    ])
  ]) {
    await t.test(label, async () => {
      const outcome = await Effect.runPromise(McpServer.make({
        serverInfo: { name: "invalid-extension-server", version: "5.0.0" },
        handlers: Effect.void,
        extensions
      }).pipe(Effect.either))
      assert.equal(Either.isLeft(outcome), true)
      assert.equal(outcome.left instanceof SchemaValidationError, true)
    })
  }

  const valid = {
    "com.example/demo": { nested: [null, true, 1, "value"] },
    "org.example-1/member_name.v2": {}
  }
  const server = await Effect.runPromise(McpServer.make({
    serverInfo: { name: "valid-extension-server", version: "5.0.0" },
    handlers: Effect.void,
    extensions: valid
  }))
  assert.deepEqual(server.options.extensions, valid)
})

test("constructed servers isolate registries, completions, queues, subscriptions, and identity", async () => {
  const alphaRegistrations = { count: 0 }
  const betaRegistrations = { count: 0 }
  const alpha = await Effect.runPromise(McpServer.make({
    serverInfo: { name: "alpha-server", version: "5.0.0" },
    handlers: handlersFor("alpha", alphaRegistrations)
  }))
  const beta = await Effect.runPromise(McpServer.make({
    serverInfo: { name: "beta-server", version: "5.0.0" },
    handlers: handlersFor("beta", betaRegistrations)
  }))

  assert.notEqual(alpha.tools, beta.tools)
  assert.notEqual(alpha.notificationsQueue, beta.notificationsQueue)
  assert.deepEqual(alpha.tools.map(({ tool }) => tool.name), ["alpha-tool"])
  assert.deepEqual(beta.tools.map(({ tool }) => tool.name), ["beta-tool"])

  const completionParams = {
    ref: { type: "ref/prompt", name: "alpha-prompt" },
    argument: { name: "choice", value: "a" }
  }
  const alphaCompletion = await Effect.runPromise(dispatch(
    alpha,
    client({ id: "alpha-client" }),
    "completion/complete",
    completionParams
  ))
  const betaCompletion = await Effect.runPromise(dispatch(
    beta,
    client({ id: "beta-client" }),
    "completion/complete",
    completionParams
  ))
  assert.deepEqual(alphaCompletion.completion.values, ["alpha-completion"])
  assert.deepEqual(betaCompletion.completion.values, [])

  const received = []
  const close = alpha.openSubscription("alpha-subscription", {
    toolsListChanged: true
  }, (notification) => Effect.sync(() => {
    received.push(notification)
  }))
  await Effect.runPromise(beta.publish({
    tag: "notifications/tools/list_changed",
    payload: { source: "beta" }
  }))
  await Effect.runPromise(alpha.publish({
    tag: "notifications/tools/list_changed",
    payload: { source: "alpha" }
  }))
  close()
  assert.equal(received.length, 1)
  assert.equal(received[0].payload.source, "alpha")

  const [alphaDiscovery, betaDiscovery] = await Promise.all([
    Effect.runPromise(dispatchWire(alpha, request("alpha", "server/discover"))),
    Effect.runPromise(dispatchWire(beta, request("beta", "server/discover")))
  ])
  assert.equal(alphaDiscovery.result._meta[SERVER_INFO_KEY].name, "alpha-server")
  assert.equal(betaDiscovery.result._meta[SERVER_INFO_KEY].name, "beta-server")
})

test("handler requirements are captured during construction", async () => {
  const HandlerProfile = Context.GenericTag("wp5b/HandlerProfile")
  const server = await Effect.runPromise(McpServer.make({
    serverInfo: { name: "captured-handler-server", version: "5.0.0" },
    handlers: McpServer.registerTool({
      name: "captured",
      content: () => Effect.map(HandlerProfile, ({ name }) => name)
    })
  }).pipe(Effect.provideService(HandlerProfile, { name: "captured-handler-profile" })))

  const result = await Effect.runPromise(dispatch(
    server,
    client({ id: "captured-client" }),
    "tools/call",
    { name: "captured", arguments: {} }
  ))
  assert.equal(result.content[0].text, "captured-handler-profile")
})

test("HTTP Web handler accepts an already-constructed server with registration requirements discharged", async () => {
  const RegistryProfile = Context.GenericTag("wp5b/HttpRegistryProfile")
  const server = await Effect.runPromise(McpServer.make({
    serverInfo: { name: "constructed-http-server", version: "5.0.0" },
    handlers: McpServer.registerTool({
      name: "profile",
      content: () => Effect.map(RegistryProfile, ({ name }) => name)
    })
  }).pipe(Effect.provideService(RegistryProfile, { name: "discharged-profile" })))
  const web = StreamableHttpServerTransport.toWebHandler(server, {
    path: "/mcp",
    enableJsonResponse: true
  })
  try {
    const response = await web.handler(new Request("http://localhost/mcp", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        accept: "application/json, text/event-stream",
        [McpModern.MCP_PROTOCOL_VERSION_HEADER]: protocolVersion,
        [McpModern.MCP_METHOD_HEADER]: "tools/call",
        [McpModern.MCP_NAME_HEADER]: "profile"
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: "constructed-http",
        method: "tools/call",
        params: requestParams({ name: "profile", arguments: {} })
      })
    }))
    assert.equal(response.status, 200)
    const body = await response.json()
    assert.equal(body.result.content[0].text, "discharged-profile")
  } finally {
    await web.dispose()
  }
})

test("concurrent requests observe only their request-local client metadata", async () => {
  const server = await Effect.runPromise(McpServer.make({
    serverInfo: { name: "request-local-server", version: "5.0.0" },
    handlers: McpServer.registerTool({
      name: "observe-client",
      content: () => Effect.gen(function*() {
        const capabilities = yield* McpServer.clientCapabilities
        const current = yield* McpSchema.McpServerClient
        return JSON.stringify({
          capabilities,
          clientInfo: current.requestContext.clientInfo
        })
      })
    })
  }))
  const firstClient = client({
    id: "first",
    capabilities: { experimental: { "com.example/first": {} } },
    clientInfo: { name: "first-client", version: "1.0.0" }
  })
  const secondClient = client({
    id: "second",
    capabilities: { experimental: { "com.example/second": {} } },
    clientInfo: { name: "second-client", version: "1.0.0" }
  })

  const [first, second] = await Effect.runPromise(Effect.all([
    dispatch(server, firstClient, "tools/call", { name: "observe-client", arguments: {} }),
    dispatch(server, secondClient, "tools/call", { name: "observe-client", arguments: {} })
  ], { concurrency: "unbounded" }))
  assert.deepEqual(JSON.parse(first.content[0].text), {
    capabilities: firstClient.requestContext.capabilities,
    clientInfo: firstClient.requestContext.clientInfo
  })
  assert.deepEqual(JSON.parse(second.content[0].text), {
    capabilities: secondClient.requestContext.capabilities,
    clientInfo: secondClient.requestContext.clientInfo
  })
  for (const forbidden of ["clientInfo", "clientCapabilities", "requestContext", "clientId"]) {
    assert.equal(Object.hasOwn(server, forbidden), false)
  }
})

test("the McpServer tag no longer exposes default or option-split constructors", () => {
  assert.equal("make" in McpServer.McpServer, false)
  assert.equal("makeWithOptions" in McpServer.McpServer, false)
  assert.equal("layer" in McpServer.McpServer, false)
  assert.equal(typeof McpServer.make, "function")
  assert.equal(typeof McpServer.layer, "function")
})
