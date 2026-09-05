import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { Effect, Result, Option, Queue, Schema, Stream } from "effect"
import * as NodeRuntime from "@effect/platform-node/NodeRuntime"
import {
  McpClient,
  McpModern,
  McpSchema,
  McpServer,
  StreamableHttpClientTransport,
  StreamableHttpServerTransport
} from "../dist/index.js"
import { RootsProvider, SamplingHandler, sendLoggingMessage } from "../dist/deprecated.js"
import { runScript } from "./lib/process.mjs"

// MCP 2026-07-28 (released stateless protocol): clients are identified by a lightweight
// ClientContext (per-request _meta), not a stored initialize payload, and there
// are no server-initiated requests (sampling/elicitation/roots moved to MRTR).
// See docs/migration-2026-07-28.md.
const client = McpSchema.McpServerClient.of({
  clientId: 1,
  requestContext: {
    protocolVersion: McpSchema.MCP_SCHEMA_VERSION,
    capabilities: {
      elicitation: { form: {} },
      sampling: {},
      roots: { listChanged: true }
    },
    clientInfo: { name: "runtime-proof-client", version: "1.0.0" }
  }
})

const jsonRpcRequest = (method, params = {}) =>
  new Request("http://127.0.0.1/mcp", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json, text/event-stream",
      [McpModern.MCP_METHOD_HEADER]: method
    },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
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

const modernJsonRpcRequest = ({ method, params = {}, headers = {} }) =>
  new Request("http://127.0.0.1/mcp", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json, text/event-stream",
      [McpModern.MCP_PROTOCOL_VERSION_HEADER]: McpModern.MODERN_PROTOCOL_VERSION,
      [McpModern.MCP_METHOD_HEADER]: method,
      ...headers
    },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
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

const handleServerRequest = (request, options = modernServerOptions) => {
  const { name, version, instructions, extensions, supportedProtocolVersions, ...transportOptions } = options
  return Effect.acquireUseRelease(
    McpServer.make({
      serverInfo: { name, version },
      handlers: Effect.void,
      instructions,
      extensions,
      supportedProtocolVersions
    }).pipe(Effect.map((server) => StreamableHttpServerTransport.toWebHandler(server, transportOptions))),
    (web) => Effect.promise(() => web.handler(request)),
    (web) => Effect.promise(() => web.dispose()).pipe(Effect.orDie)
  )
}

const assertHeaderMismatch = (response) =>
  Effect.gen(function* () {
    assert.equal(response.status, 400)
    assert.equal(response.headers.get(McpModern.MCP_PROTOCOL_VERSION_HEADER), McpModern.MODERN_PROTOCOL_VERSION)
    const body = yield* Effect.promise(() => response.json())
    assert.equal(body.error.code, McpModern.HEADER_MISMATCH_ERROR_CODE)
  })

const modernServerOptions = {
  name: "modern-runtime-server",
  version: "1.0.0",
  path: "/mcp",
  enableJsonResponse: true
}

const publicTransportDeclarations = [
  "dist/McpServer.d.ts",
  "dist/integrations/EffectPlatform.d.ts",
  "dist/transport/StreamableHttpServerTransport.d.ts"
]
  .map((file) => readFileSync(file, "utf8"))
  .join("\n")

const makeTransportProbe = () => {
  const sentRequests = []
  const transport = {
    request: (request) => {
      sentRequests.push(request)
      const result =
        request.method === "server/discover"
          ? {
              resultType: "complete",
              supportedVersions: [McpSchema.MCP_SCHEMA_VERSION],
              capabilities: { tools: {} },
              ttlMs: 0,
              cacheScope: "private",
              _meta: {
                "io.modelcontextprotocol/serverInfo": {
                  name: "probe-server",
                  version: "1.0.0"
                }
              }
            }
          : {
              resultType: "complete",
              tools: [],
              ttlMs: 0,
              cacheScope: "private"
            }
      return Stream.succeed({
        _tag: "Success",
        response: {
          _tag: "SuccessResponse",
          jsonrpc: "2.0",
          id: request.id,
          result
        }
      })
    }
  }
  return { sentRequests, transport }
}

const runCheckSdkRuntime = Effect.fn("mcp.script.check.sdk-runtime")(function* () {
  for (const removedServerApi of ["HttpRouteRegistry", "handleWebRequest", "layerHttp", "httpRouteRegistryLayer"]) {
    assert.equal(
      publicTransportDeclarations.includes(removedServerApi),
      false,
      `${removedServerApi} must not be exposed by the public server boundary`
    )
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

  const missingVersionResponse = yield* handleServerRequest(jsonRpcRequest(McpModern.SERVER_DISCOVER_METHOD))
  assert.equal(missingVersionResponse.status, 400)
  assert.equal(
    (yield* Effect.promise(() => missingVersionResponse.json())).error.code,
    McpModern.HEADER_MISMATCH_ERROR_CODE
  )

  const missingMethodResponse = yield* handleServerRequest(
    new Request("http://127.0.0.1/mcp", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json, text/event-stream",
        [McpModern.MCP_PROTOCOL_VERSION_HEADER]: McpModern.MODERN_PROTOCOL_VERSION
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: McpModern.SERVER_DISCOVER_METHOD,
        params: {
          _meta: {
            "io.modelcontextprotocol/clientCapabilities": {},
            "io.modelcontextprotocol/protocolVersion": McpModern.MODERN_PROTOCOL_VERSION
          }
        }
      })
    })
  )
  yield* assertHeaderMismatch(missingMethodResponse)

  const mismatchedMethodResponse = yield* handleServerRequest(
    modernJsonRpcRequest({
      method: McpModern.SERVER_DISCOVER_METHOD,
      headers: {
        [McpModern.MCP_METHOD_HEADER]: "tools/list"
      }
    })
  )
  yield* assertHeaderMismatch(mismatchedMethodResponse)

  const missingNameResponse = yield* handleServerRequest(
    modernJsonRpcRequest({
      method: "tools/call",
      params: { name: "echo" }
    })
  )
  yield* assertHeaderMismatch(missingNameResponse)

  const mismatchedNameResponse = yield* handleServerRequest(
    modernJsonRpcRequest({
      method: "tools/call",
      params: { name: "echo" },
      headers: {
        [McpModern.MCP_NAME_HEADER]: "wrong-tool"
      }
    })
  )
  yield* assertHeaderMismatch(mismatchedNameResponse)

  const forbiddenHostDiscoverResponse = yield* handleServerRequest(
    new Request("http://evil.example/mcp", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json, text/event-stream",
        Host: "evil.example",
        [McpModern.MCP_PROTOCOL_VERSION_HEADER]: McpModern.MODERN_PROTOCOL_VERSION,
        [McpModern.MCP_METHOD_HEADER]: McpModern.SERVER_DISCOVER_METHOD
      },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: McpModern.SERVER_DISCOVER_METHOD })
    }),
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

  const forbiddenOriginDiscoverResponse = yield* handleServerRequest(
    new Request("http://127.0.0.1/mcp", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json, text/event-stream",
        Origin: "http://evil.example",
        [McpModern.MCP_PROTOCOL_VERSION_HEADER]: McpModern.MODERN_PROTOCOL_VERSION,
        [McpModern.MCP_METHOD_HEADER]: McpModern.SERVER_DISCOVER_METHOD
      },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: McpModern.SERVER_DISCOVER_METHOD })
    }),
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

  const discoverResponse = yield* handleServerRequest(
    modernJsonRpcRequest({ method: McpModern.SERVER_DISCOVER_METHOD })
  )
  assert.equal(discoverResponse.status, 200)
  assert.equal(discoverResponse.headers.get(McpModern.MCP_PROTOCOL_VERSION_HEADER), McpModern.MODERN_PROTOCOL_VERSION)
  const discoverBody = yield* Effect.promise(() => discoverResponse.json())
  assert.equal(discoverBody.result.resultType, "complete")
  assert.deepEqual(discoverBody.result.supportedVersions, [McpModern.MODERN_PROTOCOL_VERSION])
  assert.equal(discoverBody.result.ttlMs, 0)
  assert.equal(discoverBody.result.cacheScope, "private")

  const getResponse = yield* handleServerRequest(new Request("http://127.0.0.1/mcp", { method: "GET" }))
  assert.equal(getResponse.status, 405)
  assert.equal(getResponse.headers.get("Allow"), "POST")

  const deleteResponse = yield* handleServerRequest(new Request("http://127.0.0.1/mcp", { method: "DELETE" }))
  assert.equal(deleteResponse.status, 405)
  assert.equal(deleteResponse.headers.get("Allow"), "POST")

  const putResponse = yield* handleServerRequest(new Request("http://127.0.0.1/mcp", { method: "PUT" }))
  assert.equal(putResponse.status, 405)
  assert.equal(putResponse.headers.get("Allow"), "POST")

  const modern404 = yield* Effect.result(
    Effect.scoped(
      Effect.gen(function* () {
        const transport = yield* StreamableHttpClientTransport.make({
          url: "http://127.0.0.1/mcp",
          fetch: async () => new Response("missing", { status: 404 })
        })
        yield* transport
          .request({
            _tag: "Request",
            jsonrpc: "2.0",
            id: "modern-404",
            method: "tools/list",
            params: {
              _meta: {
                "io.modelcontextprotocol/protocolVersion": McpModern.MODERN_PROTOCOL_VERSION,
                "io.modelcontextprotocol/clientCapabilities": {}
              }
            }
          })
          .pipe(Stream.runDrain)
      })
    )
  )
  assert.equal(Result.isFailure(modern404) && modern404.failure._tag, "TransportError")

  yield* Effect.gen(function* () {
    assert.equal(typeof McpServer.registerTool, "function")
    assert.equal(typeof McpServer.tool, "function")
    assert.equal(typeof sendLoggingMessage, "function")
    assert.equal(typeof McpServer.sendProgress, "function")
    assert.equal(typeof McpServer.sendResourceUpdated, "function")
    assert.equal(typeof SamplingHandler, "function")
    assert.equal(typeof RootsProvider, "function")

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

    const missingResource = yield* server.findResource("test://missing").pipe(Effect.result)
    assert.equal(missingResource._tag, "Failure")
    const missingResourceError = missingResource.failure
    assert.equal(missingResourceError.code, McpSchema.INVALID_PARAMS_ERROR_CODE)
    assert.notEqual(missingResourceError.code, -32002)

    const prompt = yield* server.getPromptResult({
      name: "ask",
      arguments: { topic: "mcp" }
    })
    assert.equal(prompt.messages[0]?.content.type, "text")
    assert.equal(prompt.messages[0]?.content.text, "Prompt about mcp")

    const registrationNotifications = yield* Queue.takeAll(server.notificationsQueue)
    const registrationTags = new Set([...registrationNotifications].map(({ tag }) => tag))
    assert.ok(registrationTags.has("notifications/tools/list_changed"))
    assert.ok(registrationTags.has("notifications/resources/list_changed"))
    assert.ok(registrationTags.has("notifications/prompts/list_changed"))

    yield* server.publish({
      tag: "notifications/message",
      payload: { level: "info", data: "runtime-log" }
    })
    const logNotification = yield* Queue.take(server.notificationsQueue)
    assert.equal(logNotification.tag, "notifications/message")
    assert.equal(logNotification.payload.level, "info")
    assert.equal(logNotification.payload.data, "runtime-log")

    yield* McpServer.registerTool({
      name: "runtime_progress",
      content: () =>
        McpServer.sendProgress({
          progress: 1,
          total: 2,
          message: "half"
        }).pipe(Effect.as("progress-ok"))
    })
    const progressFrames = yield* Effect.scoped(
      Effect.gen(function* () {
        const frames = yield* Queue.unbounded()
        const dispatcher = yield* McpServer.makeDispatcher({
          send: (frame) => Queue.offer(frames, frame).pipe(Effect.asVoid),
          transport: "stdio"
        })
        yield* dispatcher.accept({
          _tag: "Request",
          jsonrpc: "2.0",
          id: "runtime-progress-request",
          method: "tools/call",
          params: {
            name: "runtime_progress",
            arguments: {},
            _meta: {
              "io.modelcontextprotocol/clientCapabilities": {},
              "io.modelcontextprotocol/protocolVersion": McpModern.MODERN_PROTOCOL_VERSION,
              progressToken: "runtime-progress"
            }
          }
        })
        return [yield* Queue.take(frames), yield* Queue.take(frames)]
      })
    )
    assert.deepEqual(
      progressFrames.map((frame) => frame._tag),
      ["Notification", "SuccessResponse"]
    )
    assert.equal(progressFrames[0].method, "notifications/progress")
    assert.equal(progressFrames[0].params.progressToken, "runtime-progress")
    assert.equal(progressFrames[0].params.progress, 1)
  }).pipe(
    Effect.provideService(McpSchema.McpServerClient, client),
    Effect.provide(
      McpServer.layer({
        serverInfo: { name: "sdk-runtime-server", version: "1.0.0" },
        handlers: Effect.void
      })
    )
  )

  {
    const { transport, sentRequests } = makeTransportProbe()
    yield* Effect.scoped(
      Effect.gen(function* () {
        const client = yield* McpClient.make({
          transport,
          clientInfo: { name: "probe-client", version: "1.0.0" }
        })
        const discoveredInfo = yield* client.serverInfo
        assert.equal(Option.isSome(discoveredInfo), true)
        assert.equal(discoveredInfo.value.name, "probe-server")
        assert.equal(discoveredInfo.value.version, "1.0.0")
        yield* client.listTools({
          _meta: {
            traceparent: ["00", "4bf92f3577b34da6a3ce929d0e0e4736", "00f067aa0ba902b7", "00"].join("-"),
            tracestate: "vendor=value",
            baggage: "tenant=alpha"
          }
        })
      })
    )
    const listRequest = sentRequests.find((request) => request.method === "tools/list")
    assert.equal(
      listRequest.params._meta.traceparent,
      ["00", "4bf92f3577b34da6a3ce929d0e0e4736", "00f067aa0ba902b7", "00"].join("-")
    )
    assert.equal(listRequest.params._meta.tracestate, "vendor=value")
    assert.equal(listRequest.params._meta.baggage, "tenant=alpha")
    assert.equal(listRequest.params._meta["io.modelcontextprotocol/protocolVersion"], McpSchema.MCP_SCHEMA_VERSION)
  }

  console.log("SDK runtime check passed.")
})

if (process.argv[1] && new URL(import.meta.url).pathname === new URL(process.argv[1], "file:").pathname) {
  NodeRuntime.runMain(runScript("check:sdk-runtime", runCheckSdkRuntime()))
}
