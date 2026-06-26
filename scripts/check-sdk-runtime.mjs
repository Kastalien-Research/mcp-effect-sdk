import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { Effect, Queue, Schema } from "effect"
import {
  ElicitationHandler,
  HttpTransport,
  McpClient,
  McpModern,
  McpSchema,
  McpServer,
  RootsProvider,
  SamplingHandler,
  StreamableHttpServerTransport
} from "../dist/index.js"

// MCP 2026-07-28 (stateless draft): clients are identified by a lightweight
// ClientContext (per-request _meta), not a stored initialize payload, and there
// are no server-initiated requests (sampling/elicitation/roots moved to MRTR).
// See docs/draft-2026-07-28-migration.md.
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
  }
})

const jsonRpcRequest = (method, params = {}) => new Request("http://127.0.0.1/mcp", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params })
})

const modernJsonRpcRequest = ({ method, params = {}, headers = {} }) => new Request(
  "http://127.0.0.1/mcp",
  {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      [McpModern.MCP_PROTOCOL_VERSION_HEADER]: McpModern.MODERN_PROTOCOL_VERSION,
      [McpModern.MCP_METHOD_HEADER]: method,
      ...headers
    },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params })
  }
)

const noopHandler = async () =>
  new Response(JSON.stringify({ jsonrpc: "2.0", id: 1, result: {} }), {
    headers: { "Content-Type": "application/json" }
  })

const assertHeaderMismatch = async (response) => {
  assert.equal(response.status, 400)
  assert.equal(
    response.headers.get(McpModern.MCP_PROTOCOL_VERSION_HEADER),
    McpModern.MODERN_PROTOCOL_VERSION
  )
  const body = await response.json()
  assert.equal(body.error.code, McpModern.HEADER_MISMATCH_ERROR_CODE)
}

const modernServerOptions = {
  name: "modern-runtime-server",
  version: "1.0.0",
  path: "/mcp",
  modern: true
}

const publicTransportDeclarations = [
  "dist/McpServer.d.ts",
  "dist/transport/StreamableHttpServerTransport.d.ts"
].map((file) => readFileSync(file, "utf8")).join("\n")

const makeProtocolProbe = async () => {
  const notifications = await Effect.runPromise(Queue.unbounded())
  const serverRequests = await Effect.runPromise(Queue.unbounded())
  const sentRequests = []
  let onMessage
  const clientProtocol = {
    supportsAck: false,
    supportsTransferables: false,
    run: (handler) => {
      onMessage = handler
      return Effect.never
    },
    send: (request) =>
      Effect.sync(() => {
        sentRequests.push(request)
        const result = request.tag === "server/discover"
          ? {
              resultType: "complete",
              supportedVersions: [McpSchema.MCP_SCHEMA_VERSION],
              capabilities: { tools: {} },
              serverInfo: { name: "probe-server", version: "1.0.0" }
            }
          : { resultType: "complete", tools: [] }
        Effect.runFork(onMessage({
          _tag: "Exit",
          requestId: request.id,
          exit: {
            _tag: "Success",
            value: result
          }
        }))
      })
  }

  return {
    sentRequests,
    protocol: {
      clientProtocol,
      serverRequests,
      notifications,
      respond: () => Effect.void,
      respondError: () => Effect.void
    }
  }
}

for (const removedOption of [
  "sessionIdGenerator",
  "onsessioninitialized",
  "onsessionclosed",
  "eventStore",
  "retryInterval"
]) {
  assert.equal(
    publicTransportDeclarations.includes(removedOption),
    false,
    `${removedOption} must not be exposed by public transport option types`
  )
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
await assertHeaderMismatch(missingMethodResponse)

const mismatchedMethodResponse = await StreamableHttpServerTransport.handleRequest(
  modernJsonRpcRequest({
    method: McpModern.SERVER_DISCOVER_METHOD,
    headers: {
      [McpModern.MCP_METHOD_HEADER]: "tools/list"
    }
  }),
  noopHandler,
  modernServerOptions
)
await assertHeaderMismatch(mismatchedMethodResponse)

const missingNameResponse = await StreamableHttpServerTransport.handleRequest(
  modernJsonRpcRequest({
    method: "tools/call",
    params: { name: "echo" }
  }),
  noopHandler,
  modernServerOptions
)
await assertHeaderMismatch(missingNameResponse)

const mismatchedNameResponse = await StreamableHttpServerTransport.handleRequest(
  modernJsonRpcRequest({
    method: "tools/call",
    params: { name: "echo" },
    headers: {
      [McpModern.MCP_NAME_HEADER]: "wrong-tool"
    }
  }),
  noopHandler,
  modernServerOptions
)
await assertHeaderMismatch(mismatchedNameResponse)

const forbiddenHostDiscoverResponse = await StreamableHttpServerTransport.handleRequest(
  new Request("http://evil.example/mcp", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Host": "evil.example",
      [McpModern.MCP_PROTOCOL_VERSION_HEADER]: McpModern.MODERN_PROTOCOL_VERSION,
      [McpModern.MCP_METHOD_HEADER]: McpModern.SERVER_DISCOVER_METHOD
    },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: McpModern.SERVER_DISCOVER_METHOD })
  }),
  noopHandler,
  {
    ...modernServerOptions,
    enableDnsRebindingProtection: true,
    allowedHosts: ["127.0.0.1"]
  }
)
assert.equal(forbiddenHostDiscoverResponse.status, 403)
assert.equal(
  forbiddenHostDiscoverResponse.headers.get(McpModern.MCP_PROTOCOL_VERSION_HEADER),
  McpModern.MODERN_PROTOCOL_VERSION
)

const forbiddenOriginDiscoverResponse = await StreamableHttpServerTransport.handleRequest(
  new Request("http://127.0.0.1/mcp", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Origin": "http://evil.example",
      [McpModern.MCP_PROTOCOL_VERSION_HEADER]: McpModern.MODERN_PROTOCOL_VERSION,
      [McpModern.MCP_METHOD_HEADER]: McpModern.SERVER_DISCOVER_METHOD
    },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: McpModern.SERVER_DISCOVER_METHOD })
  }),
  noopHandler,
  {
    ...modernServerOptions,
    enableDnsRebindingProtection: true,
    allowedHosts: ["127.0.0.1"],
    allowedOrigins: ["http://127.0.0.1:3000"]
  }
)
assert.equal(forbiddenOriginDiscoverResponse.status, 403)
assert.equal(
  forbiddenOriginDiscoverResponse.headers.get(McpModern.MCP_PROTOCOL_VERSION_HEADER),
  McpModern.MODERN_PROTOCOL_VERSION
)

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
assert.equal(
  discoverResponse.headers.get(McpModern.MCP_PROTOCOL_VERSION_HEADER),
  McpModern.MODERN_PROTOCOL_VERSION
)
const discoverBody = await discoverResponse.json()
assert.equal(discoverBody.result.resultType, "complete")
assert.deepEqual(discoverBody.result.supportedVersions, [McpModern.MODERN_PROTOCOL_VERSION])
assert.equal(discoverBody.result.ttlMs, 60_000)
assert.equal(discoverBody.result.cacheScope, "public")

const getResponse = await StreamableHttpServerTransport.handleRequest(
  new Request("http://127.0.0.1/mcp", { method: "GET" }),
  noopHandler,
  modernServerOptions
)
assert.equal(getResponse.status, 405)
assert.equal(getResponse.headers.get("Allow"), "POST")

const deleteResponse = await StreamableHttpServerTransport.handleRequest(
  new Request("http://127.0.0.1/mcp", { method: "DELETE" }),
  noopHandler,
  modernServerOptions
)
assert.equal(deleteResponse.status, 405)
assert.equal(deleteResponse.headers.get("Allow"), "POST")

const putResponse = await StreamableHttpServerTransport.handleRequest(
  new Request("http://127.0.0.1/mcp", { method: "PUT" }),
  noopHandler,
  modernServerOptions
)
assert.equal(putResponse.status, 405)
assert.equal(putResponse.headers.get("Allow"), "POST")

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
      name: "zeta",
      description: "Registered before alpha to prove list order is sorted",
      content: () => Effect.succeed("zeta")
    })

    yield* McpServer.registerTool({
      name: "alpha",
      description: "Registered after zeta to prove list order is sorted",
      content: () => Effect.succeed("alpha")
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
      server.tools.map(({ tool }) => tool.name),
      ["alpha", "echo", "zeta"]
    )

    const echo = yield* server.callTool({
      name: "echo",
      arguments: { text: "ok" }
    })
    assert.equal(echo.content[0]?.type, "text")
    assert.equal(echo.content[0]?.text, "echo:ok")

    const resource = yield* server.findResource("test://hello")
    assert.equal(resource.contents[0]?.uri, "test://hello")
    assert.equal(resource.contents[0]?.text, "resource-ok")
    assert.equal(resource.resultType, "complete")
    assert.equal(resource.ttlMs, 0)
    assert.equal(resource.cacheScope, "private")

    const missingResourceExit = yield* server.findResource("test://missing").pipe(Effect.exit)
    assert.equal(missingResourceExit._tag, "Failure")
    const missingResourceReason = missingResourceExit.cause.reasons[0]
    assert.equal(missingResourceReason._tag, "Fail")
    const missingResourceError = missingResourceReason.error
    assert.equal(missingResourceError.code, McpSchema.INVALID_PARAMS_ERROR_CODE)
    assert.notEqual(missingResourceError.code, -32002)

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

{
  const { protocol, sentRequests } = await makeProtocolProbe()
  await Effect.runPromise(
    Effect.scoped(
      Effect.gen(function*() {
        const client = yield* McpClient.make(protocol, {
          clientInfo: { name: "probe-client", version: "1.0.0" }
        })
        yield* client.listTools({
          _meta: {
            traceparent: [
              "00",
              "4bf92f3577b34da6a3ce929d0e0e4736",
              "00f067aa0ba902b7",
              "00"
            ].join("-"),
            tracestate: "vendor=value",
            baggage: "tenant=alpha"
          }
        })
      })
    )
  )
  const listRequest = sentRequests.find((request) => request.tag === "tools/list")
  assert.equal(
    listRequest.payload._meta.traceparent,
    [
      "00",
      "4bf92f3577b34da6a3ce929d0e0e4736",
      "00f067aa0ba902b7",
      "00"
    ].join("-")
  )
  assert.equal(listRequest.payload._meta.tracestate, "vendor=value")
  assert.equal(listRequest.payload._meta.baggage, "tenant=alpha")
  assert.equal(
    listRequest.payload._meta["io.modelcontextprotocol/protocolVersion"],
    McpSchema.MCP_SCHEMA_VERSION
  )
}

console.log("SDK runtime check passed.")
