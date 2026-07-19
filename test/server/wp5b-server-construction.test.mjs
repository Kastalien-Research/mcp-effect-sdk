import assert from "node:assert/strict"
import { test } from "node:test"
import * as Context from "effect/Context"
import * as Effect from "effect/Effect"
import * as Either from "effect/Either"
import * as Queue from "effect/Queue"
import * as Schema from "effect/Schema"
import { SchemaValidationError } from "../../dist/McpErrors.js"
import * as McpSchema from "../../dist/McpSchema.js"
import * as McpServer from "../../dist/McpServer.js"

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
  assert.deepEqual(discovered.response.result._meta[SERVER_INFO_KEY], {
    name: "wp5b-explicit-server",
    title: "WP5B explicit server",
    version: "5.0.0"
  })
  assert.equal(discovered.response.result.instructions, "explicit construction")
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
  assert.equal(alphaDiscovery.response.result._meta[SERVER_INFO_KEY].name, "alpha-server")
  assert.equal(betaDiscovery.response.result._meta[SERVER_INFO_KEY].name, "beta-server")
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
