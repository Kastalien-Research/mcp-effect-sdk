import assert from "node:assert/strict"
import { test } from "node:test"
import * as Context from "effect/Context"
import * as Deferred from "effect/Deferred"
import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"
import * as McpDispatcher from "../../dist/McpDispatcher.js"
import * as McpModern from "../../dist/McpModern.js"
import * as McpSchema from "../../dist/McpSchema.js"
import * as McpServer from "../../dist/McpServer.js"
import * as HttpMetadata from "../../dist/transport/HttpMetadata.js"
import * as StreamableHttpServerTransport from "../../dist/transport/StreamableHttpServerTransport.js"

const protocolVersion = McpModern.MODERN_PROTOCOL_VERSION

const options = (overrides = {}) => ({
  name: "wp4-http-server",
  version: "1.0.0",
  path: "/mcp",
  enableJsonResponse: true,
  supportedProtocolVersions: [protocolVersion],
  ...overrides
})

const requestParams = (overrides = {}) => ({
  _meta: {
    "io.modelcontextprotocol/clientCapabilities": {},
    "io.modelcontextprotocol/protocolVersion": protocolVersion
  },
  ...overrides
})

const requestBody = (overrides = {}) => ({
  jsonrpc: "2.0",
  id: "server-boundary",
  method: "server/discover",
  params: requestParams(),
  ...overrides
})

const post = ({
  body = requestBody(),
  contentType = "application/json",
  accept = "application/json, text/event-stream",
  headers = {},
  origin
} = {}) => new Request("http://localhost/mcp", {
  method: "POST",
  headers: {
    "content-type": contentType,
    accept,
    [McpModern.MCP_PROTOCOL_VERSION_HEADER]: protocolVersion,
    [McpModern.MCP_METHOD_HEADER]: body?.method ?? "server/discover",
    ...(origin === undefined ? {} : { origin }),
    ...headers
  },
  body: typeof body === "string" ? body : JSON.stringify(body)
})

const withServerLayer = async (appLayer, serverOptions, run) => {
  const web = StreamableHttpServerTransport.toWebHandler(appLayer, serverOptions)
  try {
    await run(web.handler)
  } finally {
    await web.dispose()
  }
}

const withServer = (serverOptions, run) =>
  withServerLayer(Layer.empty, serverOptions, run)

const assertSelectedProtocol = (response) => {
  assert.equal(
    response.headers.get(McpModern.MCP_PROTOCOL_VERSION_HEADER),
    protocolVersion
  )
}

const requestMeta = (version = protocolVersion, overrides = {}) => ({
  "io.modelcontextprotocol/clientCapabilities": {},
  "io.modelcontextprotocol/protocolVersion": version,
  ...overrides
})

const rpcPost = (input) => {
  const {
    id,
    method,
    params,
    nameHeader,
    headers = {}
  } = input
  const protocolHeader = Object.hasOwn(input, "protocolHeader")
    ? input.protocolHeader
    : protocolVersion
  const methodHeader = Object.hasOwn(input, "methodHeader")
    ? input.methodHeader
    : method
  const requestHeaders = new Headers({
    "content-type": "application/json",
    accept: "application/json, text/event-stream",
    ...headers
  })
  if (protocolHeader !== undefined) {
    requestHeaders.set(McpModern.MCP_PROTOCOL_VERSION_HEADER, protocolHeader)
  }
  if (methodHeader !== undefined) {
    requestHeaders.set(McpModern.MCP_METHOD_HEADER, methodHeader)
  }
  if (nameHeader !== undefined) {
    requestHeaders.set(McpModern.MCP_NAME_HEADER, nameHeader)
  }
  return new Request("http://localhost/mcp", {
    method: "POST",
    headers: requestHeaders,
    body: JSON.stringify({ jsonrpc: "2.0", id, method, params })
  })
}

const errorObservation = async (response) => {
  const body = await response.json()
  return {
    status: response.status,
    protocolVersion: response.headers.get(McpModern.MCP_PROTOCOL_VERSION_HEADER),
    id: body.id,
    code: body.error?.code,
    message: body.error?.message,
    data: body.error?.data
  }
}

const emptyCallResult = (structuredContent = {}) => new McpSchema.CallToolResult({
  resultType: "complete",
  content: [],
  structuredContent
})

const validationProbeLayer = (counters) => Layer.effectDiscard(Effect.gen(function*() {
  const server = yield* McpServer.McpServer
  const callTool = server.callTool
  const getPromptResult = server.getPromptResult
  const findResource = server.findResource
  const openSubscription = server.openSubscription

  server.callTool = (request) => Effect.sync(() => {
    counters.registry++
  }).pipe(Effect.zipRight(callTool(request)))
  server.getPromptResult = (request) => Effect.sync(() => {
    counters.registry++
  }).pipe(Effect.zipRight(getPromptResult(request)))
  server.findResource = (uri) => Effect.sync(() => {
    counters.registry++
  }).pipe(Effect.zipRight(findResource(uri)))
  server.openSubscription = (...args) => {
    counters.subscription++
    return openSubscription(...args)
  }

  yield* server.addTool({
    tool: new McpSchema.Tool({
      name: "side-effect-tool",
      inputSchema: { type: "object", properties: {} }
    }),
    annotations: Context.empty(),
    handler: () => Effect.sync(() => {
      counters.handler++
      return emptyCallResult({ source: "handler" })
    })
  })
}))

const freshCounters = () => ({ registry: 0, handler: 0, subscription: 0 })

const toolCallParams = (overrides = {}) => ({
  name: "side-effect-tool",
  arguments: {},
  _meta: requestMeta(),
  ...overrides
})

const httpToolFixtures = (counters = new Map()) => [
  {
    tool: new McpSchema.Tool({
      name: "custom-header",
      inputSchema: {
        type: "object",
        properties: {
          context: {
            type: "object",
            properties: {
              region: { type: "string", "x-mcp-header": "Region" }
            }
          }
        }
      }
    }),
    annotations: Context.empty(),
    handler: (request) => Effect.sync(() => {
      counters.set("custom-header", (counters.get("custom-header") ?? 0) + 1)
      return emptyCallResult({ arguments: request.arguments })
    })
  },
  {
    tool: new McpSchema.Tool({
      name: "empty-plan",
      inputSchema: { type: "object", properties: {} }
    }),
    annotations: Context.empty(),
    handler: () => Effect.sync(() => {
      counters.set("empty-plan", (counters.get("empty-plan") ?? 0) + 1)
      return emptyCallResult({ source: "empty-plan" })
    })
  },
  {
    tool: new McpSchema.Tool({
      name: "invalid-header",
      inputSchema: {
        type: "object",
        properties: {
          count: { type: "number", "x-mcp-header": "Count" }
        }
      }
    }),
    annotations: Context.empty(),
    handler: () => Effect.sync(() => {
      counters.set("invalid-header", (counters.get("invalid-header") ?? 0) + 1)
      return emptyCallResult({ source: "invalid-header" })
    })
  }
]

const httpToolLayer = (counters) => Layer.effectDiscard(Effect.gen(function*() {
  const server = yield* McpServer.McpServer
  for (const entry of httpToolFixtures(counters)) {
    yield* server.addTool(entry)
  }
}))

const listToolsRequest = (id) => rpcPost({
  id,
  method: "tools/list",
  params: { _meta: requestMeta() }
})

const progressNotification = (marker) => ({
  _tag: "Notification",
  jsonrpc: "2.0",
  method: "notifications/progress",
  params: { progressToken: marker, progress: 1, message: marker }
})

const streamToolLayer = (name, handler) => Layer.effectDiscard(Effect.gen(function*() {
  const server = yield* McpServer.McpServer
  yield* server.addTool({
    tool: new McpSchema.Tool({
      name,
      inputSchema: { type: "object", properties: {} }
    }),
    annotations: Context.empty(),
    handler
  })
}))

const callToolRequest = (id, name, argumentsValue = {}) => rpcPost({
  id,
  method: "tools/call",
  nameHeader: name,
  params: {
    name,
    arguments: argumentsValue,
    _meta: requestMeta()
  }
})

const promptOutcome = async (promise, timeoutMs = 200) => {
  let timeout
  try {
    return await Promise.race([
      promise.then((value) => ({ _tag: "Response", value })),
      new Promise((resolve) => {
        timeout = setTimeout(() => resolve({ _tag: "Timeout" }), timeoutMs)
      })
    ])
  } finally {
    clearTimeout(timeout)
  }
}

const parseSseMessages = (text) => {
  assert.equal(text.endsWith("\n\n"), true)
  return text.slice(0, -2).split("\n\n").map((frame) => {
    const lines = frame.split("\n")
    assert.deepEqual(lines.slice(0, 1), ["event: message"])
    assert.equal(lines.length, 2)
    assert.equal(lines[1].startsWith("data: "), true)
    return JSON.parse(lines[1].slice("data: ".length))
  })
}

const release = (gate) => Effect.runPromise(Deferred.succeed(gate, undefined))

test("modern-only handler accepts a valid request without the removed modern flag", async () => {
  await withServer(options(), async (handler) => {
    const response = await handler(post())
    assert.equal(response.status, 200)
    assertSelectedProtocol(response)
    assert.equal(response.headers.has("mcp-session-id"), false)
    assert.equal(response.headers.has("last-event-id"), false)
    assert.equal(response.headers.has("connection"), false)
  })
})

test("present Origin requires an explicit exact allowlist match before method handling", async () => {
  const attackerOrigin = "https://attacker.invalid"
  await withServer(options(), async (handler) => {
    const response = await handler(new Request("http://localhost/mcp", {
      method: "GET",
      headers: {
        origin: attackerOrigin,
        [McpModern.MCP_PROTOCOL_VERSION_HEADER]: "attacker-version"
      }
    }))
    assert.equal(response.status, 403)
    assert.equal(await response.text(), "")
    assertSelectedProtocol(response)
  })
})

test("an exactly allowed Origin proceeds to POST-only rejection", async () => {
  const allowedOrigin = "https://allowed.example"
  await withServer(options({ allowedOrigins: [allowedOrigin] }), async (handler) => {
    const response = await handler(new Request("http://localhost/mcp", {
      method: "DELETE",
      headers: {
        origin: allowedOrigin,
        [McpModern.MCP_PROTOCOL_VERSION_HEADER]: protocolVersion,
        "mcp-session-id": "ignored-session",
        "last-event-id": "ignored-resume"
      }
    }))
    assert.equal(response.status, 405)
    assert.equal(response.headers.get("allow"), "POST")
    assert.equal(await response.text(), "")
    assertSelectedProtocol(response)
    assert.equal(response.headers.has("mcp-session-id"), false)
    assert.equal(response.headers.has("last-event-id"), false)
    assert.equal(response.headers.has("connection"), false)
  })
})

test("optional Host protection follows Origin validation and emits safe bodyless 403", async () => {
  const attackerHost = "attacker.invalid"
  await withServer(options({
    enableDnsRebindingProtection: true,
    allowedHosts: ["localhost"]
  }), async (handler) => {
    const response = await handler(post({
      headers: { host: attackerHost }
    }))
    assert.equal(response.status, 403)
    assert.equal(await response.text(), "")
    assertSelectedProtocol(response)
  })
})

test("POST rejects a non-JSON request media type before decoding", async () => {
  await withServer(options(), async (handler) => {
    const response = await handler(post({
      contentType: "text/plain",
      headers: {
        [McpModern.MCP_PROTOCOL_VERSION_HEADER]: "attacker-version"
      }
    }))
    assert.equal(response.status, 415)
    assert.equal(await response.text(), "")
    assertSelectedProtocol(response)
  })
})

test("POST requires Accept to contain JSON and SSE", async () => {
  await withServer(options(), async (handler) => {
    const response = await handler(post({ accept: "application/json" }))
    assert.equal(response.status, 406)
    assert.equal(await response.text(), "")
    assertSelectedProtocol(response)
  })
})

test("maxBodyBytes accepts the exact boundary and rejects one byte over before dispatch", async () => {
  const body = JSON.stringify(requestBody())
  const bodyBytes = new TextEncoder().encode(body).byteLength

  await withServer(options({ maxBodyBytes: bodyBytes }), async (handler) => {
    const exact = await handler(post({ body }))
    assert.equal(exact.status, 200)

    const oversized = await handler(post({
      body: `${body} `
    }))
    assert.equal(oversized.status, 413)
    assert.equal(await oversized.text(), "")
    assertSelectedProtocol(oversized)
  })
})

test("invalid maxBodyBytes values are rejected before any request body can be accessed", async () => {
  const incorrectlyAccepted = []
  for (const maxBodyBytes of [0, -1, 1.5, Number.MAX_SAFE_INTEGER + 1, Infinity, Number.NaN]) {
    let web
    try {
      web = StreamableHttpServerTransport.toWebHandler(
        Layer.empty,
        options({ maxBodyBytes })
      )
      incorrectlyAccepted.push(maxBodyBytes)
    } catch {
      // Expected: option validation is synchronous and no handler was invoked.
    } finally {
      await web?.dispose()
    }
  }
  assert.deepEqual(incorrectlyAccepted, [])
})

test("malformed JSON without an exact request id returns bodyless 400", async () => {
  await withServer(options(), async (handler) => {
    const response = await handler(post({ body: "{not-json" }))
    assert.equal(response.status, 400)
    assert.equal(await response.text(), "")
    assertSelectedProtocol(response)
  })
})

test("JSON-RPC batches return bodyless 400 without inventing id null", async () => {
  await withServer(options(), async (handler) => {
    const response = await handler(post({
      body: [requestBody({ id: 1 }), requestBody({ id: 2 })]
    }))
    assert.equal(response.status, 400)
    assert.equal(await response.text(), "")
    assertSelectedProtocol(response)
  })
})

test("an inbound response fails closed with its exact recoverable id", async () => {
  await withServer(options(), async (handler) => {
    const response = await handler(post({
      body: {
        jsonrpc: "2.0",
        id: "inbound-response",
        result: { resultType: "complete" }
      }
    }))
    assert.equal(response.status, 400)
    assertSelectedProtocol(response)
    assert.deepEqual(await response.json(), {
      jsonrpc: "2.0",
      id: "inbound-response",
      error: {
        code: -32600,
        message: "Invalid JSON-RPC request"
      }
    })
  })
})

test("required protocol and method headers fail before handlers or subscriptions", async () => {
  const counters = freshCounters()
  await withServerLayer(validationProbeLayer(counters), options(), async (handler) => {
    const cases = [
      {
        request: rpcPost({
          id: "missing-version",
          method: "tools/call",
          params: toolCallParams(),
          protocolHeader: undefined,
          nameHeader: "side-effect-tool"
        }),
        message: "MCP protocol version header does not match request metadata"
      },
      {
        request: rpcPost({
          id: "mismatched-version",
          method: "tools/call",
          params: toolCallParams(),
          protocolHeader: "2099-01-01",
          nameHeader: "side-effect-tool"
        }),
        message: "MCP protocol version header does not match request metadata"
      },
      {
        request: rpcPost({
          id: "missing-method",
          method: "tools/call",
          params: toolCallParams(),
          methodHeader: undefined,
          nameHeader: "side-effect-tool"
        }),
        message: "MCP method header does not match the request method"
      },
      {
        request: rpcPost({
          id: "mismatched-method",
          method: "tools/call",
          params: toolCallParams(),
          methodHeader: "prompts/get",
          nameHeader: "side-effect-tool"
        }),
        message: "MCP method header does not match the request method"
      }
    ]

    const observations = []
    for (const entry of cases) {
      observations.push(await errorObservation(await handler(entry.request)))
    }

    const subscriptionResponse = await handler(rpcPost({
      id: "subscription-missing-version",
      method: "subscriptions/listen",
      params: {
        notifications: { toolsListChanged: true },
        _meta: requestMeta()
      },
      protocolHeader: undefined
    }))
    const subscriptionObservation = {
      status: subscriptionResponse.status,
      protocolVersion: subscriptionResponse.headers.get(
        McpModern.MCP_PROTOCOL_VERSION_HEADER
      )
    }
    await subscriptionResponse.body?.cancel()

    assert.deepEqual(
      { observations, subscriptionObservation, counters },
      {
        observations: cases.map((entry, index) => ({
          status: 400,
          protocolVersion,
          id: ["missing-version", "mismatched-version", "missing-method", "mismatched-method"][index],
          code: -32020,
          message: entry.message,
          data: undefined
        })),
        subscriptionObservation: { status: 400, protocolVersion },
        counters: freshCounters()
      }
    )
  })
})

test("required Mcp-Name headers fail for every generated name source before registry access", async () => {
  const counters = freshCounters()
  await withServerLayer(validationProbeLayer(counters), options(), async (handler) => {
    const methods = [
      { method: "tools/call", params: toolCallParams() },
      {
        method: "prompts/get",
        params: { name: "probe-prompt", arguments: {}, _meta: requestMeta() }
      },
      {
        method: "resources/read",
        params: { uri: "test://probe-resource", _meta: requestMeta() }
      }
    ]
    const observations = []
    const expected = []
    for (const { method, params } of methods) {
      const name = params.name ?? params.uri
      for (const variant of ["missing", "mismatched"]) {
        const id = `${method}-${variant}`
        observations.push(await errorObservation(await handler(rpcPost({
          id,
          method,
          params,
          nameHeader: variant === "missing" ? undefined : `${name}-wrong`
        }))))
        expected.push({
          status: 400,
          protocolVersion,
          id,
          code: -32020,
          message: variant === "missing"
            ? "Missing required MCP name header"
            : "MCP name header does not match the request body",
          data: undefined
        })
      }
    }
    assert.deepEqual(
      { observations, counters },
      { observations: expected, counters: freshCounters() }
    )
  })
})

test("equal unsupported body and header versions return typed supported-version data", async () => {
  const unsupported = "2099-01-01"
  await withServer(options(), async (handler) => {
    const response = await handler(rpcPost({
      id: "unsupported-version",
      method: "server/discover",
      params: { _meta: requestMeta(unsupported) },
      protocolHeader: unsupported
    }))
    assert.deepEqual(await errorObservation(response), {
      status: 400,
      protocolVersion,
      id: "unsupported-version",
      code: -32022,
      message: "Unsupported MCP protocol version",
      data: {
        requested: unsupported,
        supported: [protocolVersion]
      }
    })
  })
})

test("malformed generated params and request metadata return -32602 before side effects", async () => {
  const counters = freshCounters()
  await withServerLayer(validationProbeLayer(counters), options(), async (handler) => {
    const observations = []
    observations.push(await errorObservation(await handler(rpcPost({
      id: "missing-tool-name",
      method: "tools/call",
      params: { arguments: {}, _meta: requestMeta() }
    }))))
    observations.push(await errorObservation(await handler(rpcPost({
      id: "missing-client-capabilities",
      method: "server/discover",
      params: {
        _meta: {
          "io.modelcontextprotocol/protocolVersion": protocolVersion
        }
      }
    }))))

    assert.deepEqual(
      {
        observations: observations.map(({ message: _, ...entry }) => entry),
        counters
      },
      {
        observations: [
          {
            status: 400,
            protocolVersion,
            id: "missing-tool-name",
            code: -32602,
            data: undefined
          },
          {
            status: 400,
            protocolVersion,
            id: "missing-client-capabilities",
            code: -32602,
            data: undefined
          }
        ],
        counters: freshCounters()
      }
    )
  })
})

test("unknown generated request methods return safe 404 and -32601", async () => {
  await withServer(options(), async (handler) => {
    const response = await handler(rpcPost({
      id: "unknown-method",
      method: "attacker/unknown-secret",
      params: { _meta: requestMeta() }
    }))
    assert.deepEqual(await errorObservation(response), {
      status: 404,
      protocolVersion,
      id: "unknown-method",
      code: -32601,
      message: "Method not found",
      data: undefined
    })
  })
})

test("a strict valid request is owned by makeDispatcher with the exact authorization principal", async () => {
  const principal = {
    token: "synthetic-token",
    clientId: "principal-client",
    scopes: ["tools:call"],
    extra: { tenant: "tenant-a" }
  }
  const app = Layer.effectDiscard(Effect.gen(function*() {
    const server = yield* McpServer.McpServer
    yield* server.addTool({
      tool: new McpSchema.Tool({
        name: "dispatcher-probe",
        inputSchema: { type: "object", properties: {} }
      }),
      annotations: Context.empty(),
      handler: () => McpDispatcher.McpRequestContext.pipe(
        Effect.map((context) => emptyCallResult({
          authorizationPrincipal: context.authorizationPrincipal
        }))
      )
    })
  }))

  await withServerLayer(app, options(), async (handler) => {
    let observation
    try {
      const response = await handler(rpcPost({
        id: "dispatcher-principal",
        method: "tools/call",
        params: {
          name: "dispatcher-probe",
          arguments: {},
          _meta: requestMeta()
        },
        nameHeader: "dispatcher-probe"
      }), { authInfo: principal })
      const body = await response.json()
      observation = {
        status: response.status,
        id: body.id,
        structuredContent: body.result?.structuredContent
      }
    } catch (cause) {
      observation = { rejected: String(cause) }
    }
    assert.deepEqual(observation, {
      status: 200,
      id: "dispatcher-principal",
      structuredContent: { authorizationPrincipal: principal }
    })
  })
})

test("tools/list excludes invalid HTTP header tools with one constant-safe warning", async () => {
  const warnings = []
  const counters = new Map()
  await withServerLayer(httpToolLayer(counters), options({
    warningSink: (warning) => Effect.sync(() => warnings.push(warning))
  }), async (handler) => {
    const response = await handler(listToolsRequest("filter-http-tools"))
    const body = await response.json()
    assert.deepEqual({
      status: response.status,
      tools: body.result?.tools?.map((tool) => tool.name),
      warnings,
      counters: Object.fromEntries(counters)
    }, {
      status: 200,
      tools: ["custom-header", "empty-plan"],
      warnings: [{
        _tag: "InvalidHttpToolHeader",
        toolName: "invalid-header",
        reason: "unsupported-property-type"
      }],
      counters: {}
    })
  })
})

test("custom HTTP tool headers validate before handlers and preserve encoded values", async () => {
  const counters = new Map()
  await withServerLayer(httpToolLayer(counters), options(), async (handler) => {
    const argumentsValue = { context: { region: " eu " } }
    const encodedName = "=?base64?Y3VzdG9tLWhlYWRlcg==?="
    const encodedRegion = HttpMetadata.encodeHeaderValue(" eu ")
    const cases = [
      {
        id: "missing-custom-header",
        arguments: argumentsValue,
        customHeader: undefined,
        message: "Missing required HTTP metadata header for a tool argument"
      },
      {
        id: "unexpected-custom-header",
        arguments: {},
        customHeader: encodedRegion,
        message: "Unexpected HTTP metadata header for an omitted tool argument"
      },
      {
        id: "malformed-custom-header",
        arguments: argumentsValue,
        customHeader: "=?base64?%%%%?=",
        message: "HTTP metadata header contains invalid base64"
      },
      {
        id: "mismatched-custom-header",
        arguments: argumentsValue,
        customHeader: "us",
        message: "HTTP metadata header does not match the tool argument"
      }
    ]
    const observations = []
    for (const entry of cases) {
      observations.push(await errorObservation(await handler(rpcPost({
        id: entry.id,
        method: "tools/call",
        nameHeader: encodedName,
        params: {
          name: "custom-header",
          arguments: entry.arguments,
          _meta: requestMeta()
        },
        headers: entry.customHeader === undefined
          ? {}
          : { "Mcp-Param-Region": entry.customHeader }
      }))))
    }

    const validResponse = await handler(rpcPost({
      id: "valid-custom-header",
      method: "tools/call",
      nameHeader: encodedName,
      params: {
        name: "custom-header",
        arguments: argumentsValue,
        _meta: requestMeta()
      },
      headers: { "Mcp-Param-Region": encodedRegion }
    }))
    const validBody = await validResponse.json()

    assert.deepEqual({
      observations,
      valid: {
        status: validResponse.status,
        id: validBody.id,
        structuredContent: validBody.result?.structuredContent
      },
      counters: Object.fromEntries(counters)
    }, {
      observations: cases.map((entry) => ({
        status: 400,
        protocolVersion,
        id: entry.id,
        code: -32020,
        message: entry.message,
        data: undefined
      })),
      valid: {
        status: 200,
        id: "valid-custom-header",
        structuredContent: { arguments: argumentsValue }
      },
      counters: { "custom-header": 1 }
    })
  })
})

test("warning sink failures and defects cannot hide valid HTTP tool plans", async () => {
  const observations = []
  for (const warningSink of [
    () => Effect.fail(new Error("warning sink failure")),
    () => Effect.die(new Error("warning sink defect"))
  ]) {
    try {
      await withServerLayer(httpToolLayer(new Map()), options({ warningSink }), async (handler) => {
        const response = await handler(listToolsRequest(`warning-sink-${observations.length}`))
        const body = await response.json()
        observations.push({
          status: response.status,
          tools: body.result?.tools?.map((tool) => tool.name)
        })
      })
    } catch (cause) {
      observations.push({ rejected: String(cause) })
    }
  }
  assert.deepEqual(observations, [
    { status: 200, tools: ["custom-header", "empty-plan"] },
    { status: 200, tools: ["custom-header", "empty-plan"] }
  ])
})

test("ordinary requests default to prompt ordered SSE notifications and one terminal", async () => {
  const gate = await Effect.runPromise(Deferred.make())
  const lateGate = await Effect.runPromise(Deferred.make())
  let lateAttempt
  const toolName = "ordered-sse"
  const app = streamToolLayer(toolName, () => Effect.gen(function*() {
    const context = yield* McpDispatcher.McpRequestContext
    yield* context.notificationSink(progressNotification("first"))
    yield* context.notificationSink(progressNotification("second"))
    yield* Deferred.await(gate)
    lateAttempt = Effect.runPromiseExit(Deferred.await(lateGate).pipe(
      Effect.zipRight(context.notificationSink(progressNotification("too-late")))
    ))
    return emptyCallResult({ marker: "terminal" })
  }))

  await withServerLayer(app, options({ enableJsonResponse: undefined }), async (handler) => {
    const pending = handler(callToolRequest("sse-ordered", toolName))
    const prompt = await promptOutcome(pending)
    await release(gate)
    const response = prompt._tag === "Response" ? prompt.value : await pending
    const text = await response.text()
    await release(lateGate)
    await lateAttempt

    assert.equal(prompt._tag, "Response")
    assert.deepEqual({
      contentType: response.headers.get("content-type"),
      cacheControl: response.headers.get("cache-control"),
      buffering: response.headers.get("x-accel-buffering"),
      protocolVersion: response.headers.get(McpModern.MCP_PROTOCOL_VERSION_HEADER),
      connection: response.headers.get("connection"),
      session: response.headers.get("mcp-session-id"),
      resume: response.headers.get("last-event-id"),
      messages: parseSseMessages(text)
    }, {
      contentType: "text/event-stream",
      cacheControl: "no-cache",
      buffering: "no",
      protocolVersion,
      connection: null,
      session: null,
      resume: null,
      messages: [
        {
          jsonrpc: "2.0",
          method: "notifications/progress",
          params: { progressToken: "first", progress: 1, message: "first" }
        },
        {
          jsonrpc: "2.0",
          method: "notifications/progress",
          params: { progressToken: "second", progress: 1, message: "second" }
        },
        {
          jsonrpc: "2.0",
          id: "sse-ordered",
          result: {
            resultType: "complete",
            content: [],
            structuredContent: { marker: "terminal" }
          }
        }
      ]
    })
    assert.equal(text.includes("too-late"), false)
  })
})

test("JSON response mode rejects request-bound notifications with one safe terminal", async () => {
  const toolName = "json-notification"
  const app = streamToolLayer(toolName, () => McpDispatcher.McpRequestContext.pipe(
    Effect.flatMap((context) => context.notificationSink(progressNotification("must-not-leak"))),
    Effect.as(emptyCallResult({ shouldNotComplete: true }))
  ))
  await withServerLayer(app, options({ enableJsonResponse: true }), async (handler) => {
    const response = await handler(callToolRequest("json-notification", toolName))
    const text = await response.text()
    assert.deepEqual({
      status: response.status,
      contentType: response.headers.get("content-type")?.split(";", 1)[0],
      body: JSON.parse(text),
      leaked: text.includes("must-not-leak")
    }, {
      status: 500,
      contentType: "application/json",
      body: {
        jsonrpc: "2.0",
        id: "json-notification",
        error: {
          code: -32603,
          message: "Request-bound notifications require an SSE response"
        }
      },
      leaked: false
    })
  })
})

test("invalid output and handler defects produce one exact safe InternalError terminal", async () => {
  const invalidName = "invalid-output"
  const defectName = "defect-output"
  const app = Layer.effectDiscard(Effect.gen(function*() {
    const server = yield* McpServer.McpServer
    const entries = [
      {
        name: invalidName,
        handler: () => Effect.sync(() => {
          const cyclic = { resultType: "complete", content: [] }
          cyclic.self = cyclic
          return cyclic
        })
      },
      {
        name: defectName,
        handler: () => Effect.die(new Error("synthetic-secret-must-not-leak"))
      }
    ]
    for (const entry of entries) {
      yield* server.addTool({
        tool: new McpSchema.Tool({
          name: entry.name,
          inputSchema: { type: "object", properties: {} }
        }),
        annotations: Context.empty(),
        handler: entry.handler
      })
    }
  }))

  await withServerLayer(app, options({ enableJsonResponse: true }), async (handler) => {
    const observations = []
    for (const [id, name] of [
      ["invalid-terminal", invalidName],
      ["defect-terminal", defectName]
    ]) {
      const response = await handler(callToolRequest(id, name))
      const text = await response.text()
      const body = JSON.parse(text)
      observations.push({
        status: response.status,
        id: body.id,
        error: body.error,
        leaked: text.includes("synthetic-secret")
      })
    }
    assert.deepEqual(observations, [
      {
        status: 500,
        id: "invalid-terminal",
        error: { code: -32603, message: "Could not encode server result" },
        leaked: false
      },
      {
        status: 500,
        id: "defect-terminal",
        error: { code: -32603, message: "Request handler defect" },
        leaked: false
      }
    ])
  })
})

test("maxPendingFrames is validated and bounds unread SSE producers", async () => {
  const invalidOptions = []
  for (const maxPendingFrames of [0, -1, 1.5, Number.MAX_SAFE_INTEGER + 1]) {
    try {
      const web = StreamableHttpServerTransport.toWebHandler(
        Layer.empty,
        options({ maxPendingFrames })
      )
      invalidOptions.push({ maxPendingFrames, accepted: true })
      await web.dispose()
    } catch (cause) {
      invalidOptions.push({
        maxPendingFrames,
        name: cause?.name,
        message: cause?.message
      })
    }
  }

  const bounds = []
  for (const configuration of [
    { maxPendingFrames: 1, maximumProduced: 2 },
    { maxPendingFrames: undefined, maximumProduced: 17 }
  ]) {
    const produced = []
    const toolName = configuration.maxPendingFrames === undefined
      ? "default-bound"
      : "small-bound"
    const app = streamToolLayer(toolName, () => McpDispatcher.McpRequestContext.pipe(
      Effect.flatMap((context) => Effect.forEach(
        Array.from({ length: 40 }, (_, index) => index),
        (index) => context.notificationSink(progressNotification(`${toolName}-${index}`)).pipe(
          Effect.tap(() => Effect.sync(() => produced.push(index)))
        ),
        { discard: true }
      )),
      Effect.as(emptyCallResult({ source: toolName }))
    ))
    await withServerLayer(app, options({
      ...(configuration.maxPendingFrames === undefined
        ? {}
        : { maxPendingFrames: configuration.maxPendingFrames })
    }), async (handler) => {
      const pending = handler(callToolRequest(`bound-${toolName}`, toolName))
      const prompt = await promptOutcome(pending)
      if (prompt._tag === "Timeout") {
        bounds.push({ configuration, prompt: prompt._tag })
        return
      }
      const response = prompt.value
      await new Promise((resolve) => setTimeout(resolve, 30))
      bounds.push({
        configuration,
        prompt: prompt._tag,
        contentType: response.headers.get("content-type"),
        produced: produced.length,
        bounded: produced.length <= configuration.maximumProduced
      })
      await response.body?.cancel()
    })
  }
  assert.deepEqual({ invalidOptions, bounds }, {
    invalidOptions: [0, -1, 1.5, Number.MAX_SAFE_INTEGER + 1].map((maxPendingFrames) => ({
      maxPendingFrames,
      name: "RangeError",
      message: "maxPendingFrames must be a positive safe integer"
    })),
    bounds: [
      {
        configuration: { maxPendingFrames: 1, maximumProduced: 2 },
        prompt: "Response",
        contentType: "text/event-stream",
        produced: bounds[0]?.produced,
        bounded: true
      },
      {
        configuration: { maxPendingFrames: undefined, maximumProduced: 17 },
        prompt: "Response",
        contentType: "text/event-stream",
        produced: bounds[1]?.produced,
        bounded: true
      }
    ]
  })
})

test("cancelled response bodies reject a pending terminal without hanging or extra frames", async () => {
  const gate = await Effect.runPromise(Deferred.make())
  const completed = await Effect.runPromise(Deferred.make())
  const toolName = "cancel-terminal"
  const app = streamToolLayer(toolName, () => McpDispatcher.McpRequestContext.pipe(
    Effect.flatMap((context) => context.notificationSink(progressNotification("before-cancel"))),
    Effect.zipRight(Deferred.await(gate)),
    Effect.as(emptyCallResult({ source: "cancelled" })),
    Effect.ensuring(Deferred.succeed(completed, undefined).pipe(Effect.asVoid))
  ))
  await withServerLayer(app, options({ maxPendingFrames: 1 }), async (handler) => {
    const pending = handler(callToolRequest("cancel-terminal", toolName))
    const prompt = await promptOutcome(pending)
    if (prompt._tag === "Timeout") {
      await release(gate)
      await pending
    }
    assert.equal(prompt._tag, "Response")
    const response = prompt.value
    const reader = response.body.getReader()
    const first = await reader.read()
    assert.equal(new TextDecoder().decode(first.value).includes("before-cancel"), true)
    await reader.cancel()
    await release(gate)
    await Effect.runPromise(Deferred.await(completed))
  })
})

test("concurrent numeric and string IDs isolate ordinary SSE responses", async () => {
  const numericGate = await Effect.runPromise(Deferred.make())
  const stringGate = await Effect.runPromise(Deferred.make())
  const toolName = "id-isolation"
  const app = streamToolLayer(toolName, () => Effect.gen(function*() {
    const context = yield* McpDispatcher.McpRequestContext
    const numeric = typeof context.id === "number"
    const marker = numeric ? "numeric-only" : "string-only"
    yield* context.notificationSink(progressNotification(marker))
    yield* Deferred.await(numeric ? numericGate : stringGate)
    return emptyCallResult({ marker })
  }))

  await withServerLayer(app, options(), async (handler) => {
    const numericPending = handler(callToolRequest(1, toolName))
    const stringPending = handler(callToolRequest("1", toolName))
    const [numericPrompt, stringPrompt] = await Promise.all([
      promptOutcome(numericPending),
      promptOutcome(stringPending)
    ])
    await release(stringGate)
    await release(numericGate)
    const numericResponse = numericPrompt._tag === "Response"
      ? numericPrompt.value
      : await numericPending
    const stringResponse = stringPrompt._tag === "Response"
      ? stringPrompt.value
      : await stringPending
    const [numericText, stringText] = await Promise.all([
      numericResponse.text(),
      stringResponse.text()
    ])
    const numericMessages = numericText.endsWith("\n\n")
      ? parseSseMessages(numericText)
      : { invalidBody: numericText }
    const stringMessages = stringText.endsWith("\n\n")
      ? parseSseMessages(stringText)
      : { invalidBody: stringText }
    assert.deepEqual({
      prompt: [numericPrompt._tag, stringPrompt._tag],
      numeric: numericMessages,
      string: stringMessages
    }, {
      prompt: ["Response", "Response"],
      numeric: [
        {
          jsonrpc: "2.0",
          method: "notifications/progress",
          params: { progressToken: "numeric-only", progress: 1, message: "numeric-only" }
        },
        {
          jsonrpc: "2.0",
          id: 1,
          result: {
            resultType: "complete",
            content: [],
            structuredContent: { marker: "numeric-only" }
          }
        }
      ],
      string: [
        {
          jsonrpc: "2.0",
          method: "notifications/progress",
          params: { progressToken: "string-only", progress: 1, message: "string-only" }
        },
        {
          jsonrpc: "2.0",
          id: "1",
          result: {
            resultType: "complete",
            content: [],
            structuredContent: { marker: "string-only" }
          }
        }
      ]
    })
  })
})

test("extension notifications are typed, authorized, and isolated from core cancellation", async () => {
  const calls = []
  const principal = {
    token: "synthetic-extension-token",
    clientId: "extension-client",
    scopes: ["notifications:send"]
  }
  const notificationPost = (method, marker) => new Request("http://localhost/mcp", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      accept: "application/json, text/event-stream",
      [McpModern.MCP_PROTOCOL_VERSION_HEADER]: protocolVersion,
      [McpModern.MCP_METHOD_HEADER]: method
    },
    body: JSON.stringify({
      jsonrpc: "2.0",
      method,
      params: { marker, _meta: requestMeta() }
    })
  })
  await withServer(options({
    acceptNotification: (notification, context) => Effect.sync(() => {
      calls.push({ notification, context })
    }).pipe(
      notification.method === "example.com/failure"
        ? Effect.flatMap(() => Effect.fail(new McpSchema.InvalidParams({ message: "hook rejected" })))
        : notification.method === "example.com/defect"
          ? Effect.flatMap(() => Effect.die(new Error("hook defect")))
          : Effect.asVoid
    )
  }), async (handler) => {
    const observations = []
    for (const [method, marker] of [
      ["example.com/success", "success"],
      ["example.com/failure", "failure"],
      ["example.com/defect", "defect"],
      ["notifications/cancelled", "core"]
    ]) {
      const response = await handler(notificationPost(method, marker), { authInfo: principal })
      observations.push({
        method,
        status: response.status,
        body: await response.text(),
        protocolVersion: response.headers.get(McpModern.MCP_PROTOCOL_VERSION_HEADER)
      })
    }
    assert.deepEqual(observations, [
      { method: "example.com/success", status: 202, body: "", protocolVersion },
      { method: "example.com/failure", status: 400, body: "", protocolVersion },
      { method: "example.com/defect", status: 400, body: "", protocolVersion },
      { method: "notifications/cancelled", status: 400, body: "", protocolVersion }
    ])
    assert.deepEqual(calls.map(({ notification, context }) => ({
      notification,
      authorizationPrincipal: context.authorizationPrincipal
    })), [
      {
        notification: {
          _tag: "Notification",
          jsonrpc: "2.0",
          method: "example.com/success",
          params: { marker: "success", _meta: requestMeta() }
        },
        authorizationPrincipal: principal
      },
      {
        notification: {
          _tag: "Notification",
          jsonrpc: "2.0",
          method: "example.com/failure",
          params: { marker: "failure", _meta: requestMeta() }
        },
        authorizationPrincipal: principal
      },
      {
        notification: {
          _tag: "Notification",
          jsonrpc: "2.0",
          method: "example.com/defect",
          params: { marker: "defect", _meta: requestMeta() }
        },
        authorizationPrincipal: principal
      }
    ])
  })
})

test("legacy session and resume request headers are ignored and never echoed", async () => {
  await withServer(options(), async (handler) => {
    const response = await handler(post({
      headers: {
        "mcp-session-id": "legacy-session",
        "last-event-id": "legacy-resume"
      }
    }))
    assert.equal(response.status, 200)
    assertSelectedProtocol(response)
    assert.equal(response.headers.has("mcp-session-id"), false)
    assert.equal(response.headers.has("last-event-id"), false)
    assert.equal(response.headers.has("connection"), false)
  })
})
