import assert from "node:assert/strict"
import { Effect, Queue, Schema } from "effect"
import {
  ElicitationHandler,
  HttpTransport,
  McpModern,
  McpSchema,
  McpServer,
  RootsProvider,
  SamplingHandler,
  StreamableHttpServerTransport
} from "../dist/index.js"

const client = McpSchema.McpServerClient.of({
  clientId: 1,
  initializePayload: {
    protocolVersion: McpSchema.MCP_SCHEMA_VERSION,
    capabilities: {
      elicitation: { form: {} },
      sampling: {},
      roots: { listChanged: true }
    },
    clientInfo: { name: "runtime-proof-client", version: "1.0.0" }
  },
  getClient: Effect.succeed({
    "elicitation/create": () =>
      Effect.succeed({
        action: "accept",
        content: { name: "Ada" }
      })
  }),
  elicit: () =>
    Effect.succeed({
      action: "accept",
      content: { name: "Ada" }
    }),
  sample: () =>
    Effect.succeed({
      role: "assistant",
      content: { type: "text", text: "sampled" },
      model: "runtime-proof-model",
      stopReason: "endTurn"
    }),
  listRoots: () =>
    Effect.succeed({
      roots: [{
        uri: "file:///tmp/runtime-root",
        name: "Runtime Root"
      }]
    })
})

const jsonRpcRequest = (method, params = {}) => new Request("http://127.0.0.1/mcp", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params })
})

const noopHandler = async () => new Response(JSON.stringify({ jsonrpc: "2.0", id: 1, result: {} }), {
  headers: { "Content-Type": "application/json" }
})

const modernServerOptions = {
  name: "modern-runtime-server",
  version: "1.0.0",
  path: "/mcp",
  modern: true
}

const missingVersionResponse = await StreamableHttpServerTransport.handleRequest(
  jsonRpcRequest(McpModern.SERVER_DISCOVER_METHOD),
  noopHandler,
  modernServerOptions
)
assert.equal(missingVersionResponse.status, 400)
assert.equal((await missingVersionResponse.json()).error.code, McpModern.HEADER_MISMATCH_ERROR_CODE)

const missingMethodResponse = await StreamableHttpServerTransport.handleRequest(
  new Request("http://127.0.0.1/mcp", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      [McpModern.MCP_PROTOCOL_VERSION_HEADER]: McpModern.MODERN_PROTOCOL_VERSION
    },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: McpModern.SERVER_DISCOVER_METHOD })
  }),
  noopHandler,
  modernServerOptions
)
assert.equal(missingMethodResponse.status, 400)
assert.equal((await missingMethodResponse.json()).error.code, McpModern.HEADER_MISMATCH_ERROR_CODE)

const discoverResponse = await StreamableHttpServerTransport.handleRequest(
  new Request("http://127.0.0.1/mcp", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      [McpModern.MCP_PROTOCOL_VERSION_HEADER]: McpModern.MODERN_PROTOCOL_VERSION,
      [McpModern.MCP_METHOD_HEADER]: McpModern.SERVER_DISCOVER_METHOD
    },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: McpModern.SERVER_DISCOVER_METHOD })
  }),
  noopHandler,
  modernServerOptions
)
assert.equal(discoverResponse.status, 200)
const discoverBody = await discoverResponse.json()
assert.equal(discoverBody.result.resultType, "complete")
assert.deepEqual(discoverBody.result.supportedVersions, [McpModern.MODERN_PROTOCOL_VERSION])

const getResponse = await StreamableHttpServerTransport.handleRequest(
  new Request("http://127.0.0.1/mcp", { method: "GET" }),
  noopHandler,
  modernServerOptions
)
assert.equal(getResponse.status, 405)

let modern404Error
try {
  await Effect.runPromise(
    Effect.scoped(
      Effect.gen(function*() {
        const transport = yield* HttpTransport.make({
          url: "http://127.0.0.1/mcp",
          modern: true,
          fetch: async () => new Response("missing", { status: 404 })
        })
        yield* transport.send({
          _tag: "Request",
          id: "modern-404",
          tag: "tools/list",
          payload: {}
        })
      })
    )
  )
} catch (error) {
  modern404Error = error
}
assert.equal(modern404Error?.reason, "Transport")

await Effect.runPromise(
  Effect.gen(function*() {
    assert.equal(typeof McpServer.registerTool, "function")
    assert.equal(typeof McpServer.tool, "function")
    assert.equal(typeof McpServer.sendLoggingMessage, "function")
    assert.equal(typeof McpServer.sendProgress, "function")
    assert.equal(typeof McpServer.listRoots, "object")
    assert.equal(typeof McpServer.sendResourceUpdated, "function")
    assert.equal(typeof SamplingHandler.SamplingHandler, "function")
    assert.equal(typeof ElicitationHandler.ElicitationHandler, "function")
    assert.equal(typeof RootsProvider.RootsProvider, "function")

    yield* McpServer.registerTool({
      name: "echo",
      description: "Echo input",
      parameters: { text: Schema.String },
      content: ({ text }) => Effect.succeed(`echo:${text}`)
    })

    yield* McpServer.registerTool({
      name: "sample",
      description: "Use server-to-client sampling",
      content: () =>
        Effect.gen(function*() {
          const result = yield* McpServer.sample({
            messages: [{
              role: "user",
              content: { type: "text", text: "sample this" }
            }],
            maxTokens: 16,
            metadata: {}
          })
          return `sample:${result.model}`
        })
    })

    yield* McpServer.registerTool({
      name: "elicit",
      description: "Use server-to-client elicitation",
      content: () =>
        Effect.gen(function*() {
          const result = yield* McpServer.elicit({
            message: "Name",
            schema: Schema.Struct({ name: Schema.String })
          })
          return `elicit:${result.name}`
        })
    })

    yield* McpServer.registerResource({
      uri: "test://hello",
      name: "Hello",
      content: Effect.succeed("resource-ok")
    })

    yield* McpServer.registerPrompt({
      name: "ask",
      parameters: { topic: Schema.String },
      content: ({ topic }) => Effect.succeed(`Prompt about ${topic}`)
    })

    const server = yield* McpServer.McpServer

    assert.deepEqual(
      server.tools.map(({ tool }) => tool.name).sort(),
      ["echo", "elicit", "sample"]
    )

    const echo = yield* server.callTool({
      name: "echo",
      arguments: { text: "ok" }
    })
    assert.equal(echo.content[0]?.type, "text")
    assert.equal(echo.content[0]?.text, "echo:ok")

    const sampled = yield* server.callTool({
      name: "sample",
      arguments: {}
    })
    assert.equal(sampled.content[0]?.type, "text")
    assert.equal(sampled.content[0]?.text, "sample:runtime-proof-model")

    const elicited = yield* server.callTool({
      name: "elicit",
      arguments: {}
    })
    assert.equal(elicited.content[0]?.type, "text")
    assert.equal(elicited.content[0]?.text, "elicit:Ada")

    const roots = yield* McpServer.listRoots
    assert.equal(roots.roots[0]?.uri, "file:///tmp/runtime-root")

    const resource = yield* server.findResource("test://hello")
    assert.equal(resource.contents[0]?.uri, "test://hello")
    assert.equal(resource.contents[0]?.text, "resource-ok")

    const prompt = yield* server.getPromptResult({
      name: "ask",
      arguments: { topic: "mcp" }
    })
    assert.equal(prompt.messages[0]?.content.type, "text")
    assert.equal(prompt.messages[0]?.content.text, "Prompt about mcp")

    yield* McpServer.sendLoggingMessage({
      level: "info",
      data: "runtime-log"
    })
    const logNotification = yield* Queue.take(server.notificationsQueue)
    assert.equal(logNotification.tag, "notifications/message")
    assert.equal(logNotification.payload.level, "info")
    assert.equal(logNotification.payload.data, "runtime-log")

    yield* McpServer.sendProgress({
      progressToken: "runtime-progress",
      progress: 1,
      total: 2,
      message: "half"
    })
    const progressNotification = yield* Queue.take(server.notificationsQueue)
    assert.equal(progressNotification.tag, "notifications/progress")
    assert.equal(progressNotification.payload.progressToken, "runtime-progress")
    assert.equal(progressNotification.payload.progress, 1)
  }).pipe(
    Effect.provideService(McpSchema.McpServerClient, client),
    Effect.provide(McpServer.McpServer.layer)
  )
)

console.log("SDK runtime check passed.")
