import assert from "node:assert/strict"
import { once } from "node:events"
import { readFileSync } from "node:fs"
import { createServer, request as nodeRequest } from "node:http"
import { Readable } from "node:stream"
import { test } from "node:test"
import * as HttpApp from "@effect/platform/HttpApp"
import * as HttpRouter from "@effect/platform/HttpRouter"
import * as Cause from "effect/Cause"
import * as Context from "effect/Context"
import * as Deferred from "effect/Deferred"
import * as Effect from "effect/Effect"
import * as Exit from "effect/Exit"
import * as Fiber from "effect/Fiber"
import * as Layer from "effect/Layer"
import * as ManagedRuntime from "effect/ManagedRuntime"
import * as Queue from "effect/Queue"
import * as Scope from "effect/Scope"
import * as EffectPlatform from "../../dist/integrations/EffectPlatform.js"
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

const withEffectPlatform = async (serverOptions, run) => {
  const runtime = ManagedRuntime.make(
    EffectPlatform.layer(serverOptions).pipe(
      Layer.provideMerge(HttpRouter.Default.Live)
    )
  )
  try {
    const router = await runtime.runPromise(HttpRouter.Default.router)
    await run(HttpApp.toWebHandler(router), runtime)
  } finally {
    await runtime.dispose()
  }
}

const assertSelectedProtocol = (response) => {
  assert.equal(
    response.headers.get(McpModern.MCP_PROTOCOL_VERSION_HEADER),
    protocolVersion
  )
}

test("Effect Platform routes every method through the exact modern handler", async () => {
  await withEffectPlatform(options({
    enableJsonResponse: false,
    allowedOrigins: ["https://allowed.example"]
  }), async (handler) => {
    const forbidden = await handler(post({ origin: "https://forbidden.example" }))
    assert.equal(forbidden.status, 403)
    assertSelectedProtocol(forbidden)

    const rejectedMethod = await handler(new Request("http://localhost/mcp", {
      method: "GET",
      headers: { [McpModern.MCP_PROTOCOL_VERSION_HEADER]: protocolVersion }
    }))
    assert.equal(rejectedMethod.status, 405)
    assert.equal(rejectedMethod.headers.get("allow"), "POST")
    assertSelectedProtocol(rejectedMethod)

    const streamed = await handler(post({ origin: "https://allowed.example" }))
    assert.equal(streamed.status, 200)
    assert.match(streamed.headers.get("content-type") ?? "", /^text\/event-stream/)
    assertSelectedProtocol(streamed)
    const cursor = makeSseCursor(streamed)
    const frame = await cursor.next()
    assert.equal(frame._tag, "Message")
    assert.equal(frame.value.id, "server-boundary")
    assert.equal(frame.value.result.serverInfo.name, "wp4-http-server")
  })
})

test("legacy McpServer HTTP routes and Effect Platform bypasses are absent", () => {
  assert.equal("handleWebRequest" in McpServer, false)
  assert.equal("layerHttp" in McpServer, false)
  assert.equal("HttpRouteRegistry" in McpServer, false)
  assert.equal("httpRouteRegistryLayer" in EffectPlatform, false)

  const serverSource = readFileSync("src/McpServer.ts", "utf8")
  const platformSource = readFileSync("src/integrations/EffectPlatform.ts", "utf8")
  const transportSource = readFileSync("src/transport/StreamableHttpServerTransport.ts", "utf8")
  for (const forbidden of [
    "export const handleWebRequest",
    "export const layerHttp",
    "export class HttpRouteRegistry",
    "const subscriptionResponse",
    "const subscriptionAcknowledged",
    "const sseMessage"
  ]) {
    assert.equal(serverSource.includes(forbidden), false, `legacy server source remains: ${forbidden}`)
  }
  assert.equal(platformSource.includes("StreamableHttpServerTransport.makeScopedHandler"), true)
  assert.equal(platformSource.includes("router.all(options.path"), true)
  assert.equal(platformSource.includes("McpServer.layerHttp"), false)
  assert.equal(transportSource.includes("const failSubscriptionStream ="), true)
})

test("server notifications retain bounded observation and live subscription delivery", async () => {
  const serverSource = readFileSync("src/McpServer.ts", "utf8")
  const server = await Effect.runPromise(McpServer.McpServer.make)
  assert.notEqual(server.notificationsQueue, undefined)
  assert.equal(Queue.capacity(server.notificationsQueue), 64)
  const received = []
  const close = server.openSubscription("queue-guard", {
    toolsListChanged: true
  }, (notification) => Effect.sync(() => {
    received.push(notification)
  }))

  for (let sequence = 1; sequence <= 70; sequence++) {
    await Effect.runPromise(server.publish({
      tag: "notifications/tools/list_changed",
      payload: { sequence }
    }))
  }
  close()
  await Effect.runPromise(server.publish({
    tag: "notifications/tools/list_changed",
    payload: { sequence: 71 }
  }))

  assert.equal(received.length, 70)
  assert.deepEqual(received[69], {
    tag: "notifications/tools/list_changed",
    payload: {
      sequence: 70,
      _meta: { "io.modelcontextprotocol/subscriptionId": "queue-guard" }
    }
  })
  assert.equal(await Effect.runPromise(Queue.size(server.notificationsQueue)), 64)
  assert.equal(serverSource.includes("Queue.unbounded<ServerNotification>"), false)
  assert.equal(serverSource.includes("Queue.sliding<ServerNotification>(64)"), true)
})

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

const subscriptionRequest = (id, notifications, overrides = {}) => rpcPost({
  id,
  method: "subscriptions/listen",
  params: { notifications, _meta: requestMeta() },
  ...overrides
})

const makeSseCursor = (response) => {
  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let buffered = ""
  let pendingRead
  const next = async (timeoutMs = 250) => {
    while (!buffered.includes("\n\n")) {
      if (pendingRead === undefined) {
        pendingRead = reader.read().finally(() => {
          pendingRead = undefined
        })
      }
      const outcome = await promptOutcome(pendingRead, timeoutMs)
      if (outcome._tag === "Timeout") return outcome
      if (outcome.value.done) return { _tag: "Done" }
      buffered += decoder.decode(outcome.value.value, { stream: true })
    }
    const boundary = buffered.indexOf("\n\n")
    const frame = buffered.slice(0, boundary)
    buffered = buffered.slice(boundary + 2)
    const lines = frame.split("\n")
    assert.deepEqual(lines.slice(0, 1), ["event: message"])
    assert.equal(lines.length, 2)
    assert.equal(lines[1].startsWith("data: "), true)
    return { _tag: "Message", value: JSON.parse(lines[1].slice(6)) }
  }
  return { reader, next }
}

const subscriptionProbe = ({ onOpen } = {}) => {
  const opened = []
  const closed = []
  let service
  const layer = Layer.effectDiscard(Effect.gen(function*() {
    service = yield* McpServer.McpServer
    const openSubscription = service.openSubscription
    service.openSubscription = (id, filter, sink) => {
      opened.push({ id, filter: JSON.parse(JSON.stringify(filter)) })
      const close = openSubscription(id, filter, sink)
      onOpen?.({ id, filter, sink, service })
      let active = true
      return () => {
        if (!active) return
        active = false
        closed.push(id)
        close()
      }
    }
  }))
  return {
    layer,
    opened,
    closed,
    service: () => service
  }
}

const waitUntil = async (predicate, timeoutMs = 500) => {
  const started = Date.now()
  while (!predicate()) {
    if (Date.now() - started >= timeoutMs) return false
    await new Promise((resolve) => setTimeout(resolve, 5))
  }
  return true
}

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

test("raw Web routing matches the configured pathname exactly and permits queries", async () => {
  const makeRequest = (pathname) => {
    let cancelled = 0
    const body = new ReadableStream({
      start(controller) {
        controller.enqueue(new TextEncoder().encode(JSON.stringify(requestBody())))
        controller.close()
      },
      cancel() {
        cancelled++
      }
    })
    return {
      body,
      cancelled: () => cancelled,
      request: new Request(`http://localhost${pathname}`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          accept: "application/json, text/event-stream",
          [McpModern.MCP_PROTOCOL_VERSION_HEADER]: protocolVersion,
          [McpModern.MCP_METHOD_HEADER]: "server/discover"
        },
        body,
        duplex: "half"
      })
    }
  }

  await withServer(options(), async (handler) => {
    const wrong = [makeRequest("/not-mcp"), makeRequest("/mcp/")]
    const wrongResponses = await Promise.all(wrong.map(({ request }) => handler(request)))
    const query = await handler(makeRequest("/mcp?trace=exact-path").request)

    assert.deepEqual(await Promise.all(wrongResponses.map(async (response, index) => ({
      status: response.status,
      body: await response.text(),
      cancelled: wrong[index].cancelled(),
      locked: wrong[index].body.locked
    }))), [
      { status: 404, body: "", cancelled: 1, locked: false },
      { status: 404, body: "", cancelled: 1, locked: false }
    ])
    assert.equal(query.status, 200)
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

test("early preflight rejections cancel and unlock unconsumed request bodies", async () => {
  const cases = [
    {
      name: "origin",
      status: 403,
      request: { headers: { origin: "https://attacker.invalid" } }
    },
    {
      name: "host",
      status: 403,
      options: { enableDnsRebindingProtection: true, allowedHosts: ["localhost"] },
      request: { headers: { host: "attacker.invalid" } }
    },
    {
      name: "method",
      status: 405,
      request: { method: "DELETE" }
    },
    {
      name: "content-type",
      status: 415,
      request: { headers: { "content-type": "text/plain" } }
    },
    {
      name: "accept",
      status: 406,
      request: { headers: { accept: "application/json" } }
    }
  ]
  const observations = []

  for (const fixture of cases) {
    let cancelled = 0
    const body = new ReadableStream({
      start(controller) {
        controller.enqueue(new Uint8Array([1]))
      },
      cancel() {
        cancelled++
      }
    })
    await withServer(options(fixture.options), async (handler) => {
      const headers = {
        "content-type": "application/json",
        accept: "application/json, text/event-stream",
        [McpModern.MCP_PROTOCOL_VERSION_HEADER]: protocolVersion,
        [McpModern.MCP_METHOD_HEADER]: "server/discover",
        ...fixture.request.headers
      }
      const response = await handler(new Request("http://localhost/mcp", {
        method: fixture.request.method ?? "POST",
        headers,
        body,
        duplex: "half"
      }))
      observations.push({
        name: fixture.name,
        status: response.status,
        body: await response.text(),
        allow: response.headers.get("allow"),
        cancelled,
        locked: body.locked
      })
    })
  }

  assert.deepEqual(observations, cases.map((fixture) => ({
    name: fixture.name,
    status: fixture.status,
    body: "",
    allow: fixture.name === "method" ? "POST" : null,
    cancelled: 1,
    locked: false
  })))
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

test("outbound SSE validates known notifications while preserving extensions", async () => {
  const malformedCompleted = await Effect.runPromise(Deferred.make())
  const app = Layer.mergeAll(
    streamToolLayer("malformed-known-notification", () => McpDispatcher.McpRequestContext.pipe(
      Effect.flatMap((context) => context.notificationSink({
        _tag: "Notification",
        jsonrpc: "2.0",
        method: "notifications/progress",
        params: { progress: 1 }
      })),
      Effect.as(emptyCallResult({ shouldNotComplete: true })),
      Effect.ensuring(Deferred.succeed(malformedCompleted, undefined).pipe(Effect.asVoid))
    )),
    streamToolLayer("extension-notification", () => McpDispatcher.McpRequestContext.pipe(
      Effect.flatMap((context) => context.notificationSink({
        _tag: "Notification",
        jsonrpc: "2.0",
        method: "example.com/outbound",
        params: { marker: "extension" }
      })),
      Effect.as(emptyCallResult({ marker: "terminal" }))
    ))
  )

  await withServerLayer(app, options({ enableJsonResponse: undefined }), async (handler) => {
    const malformed = await handler(callToolRequest(
      "malformed-known-notification",
      "malformed-known-notification"
    ))
    const reader = malformed.body.getReader()
    const malformedRead = await promptOutcome(reader.read().then(
      () => ({ _tag: "Resolved" }),
      (cause) => ({ _tag: "Rejected", cause })
    ), 500)
    assert.equal(malformedRead._tag, "Response")
    assert.equal(malformedRead.value._tag, "Rejected")
    assert.match(String(malformedRead.value.cause), /HTTP response stream failed/)
    assert.equal((await promptOutcome(
      Effect.runPromise(Deferred.await(malformedCompleted)),
      500
    ))._tag, "Response")

    const extension = await handler(callToolRequest(
      "extension-notification",
      "extension-notification"
    ))
    assert.deepEqual(parseSseMessages(await extension.text()), [
      {
        jsonrpc: "2.0",
        method: "example.com/outbound",
        params: { marker: "extension" }
      },
      {
        jsonrpc: "2.0",
        id: "extension-notification",
        result: {
          resultType: "complete",
          content: [],
          structuredContent: { marker: "terminal" }
        }
      }
    ])
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
      enableJsonResponse: undefined,
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
  await withServerLayer(app, options({
    enableJsonResponse: undefined,
    maxPendingFrames: 1
  }), async (handler) => {
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

  await withServerLayer(app, options({ enableJsonResponse: undefined }), async (handler) => {
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

test("subscriptions validate before registry effects and always acknowledge on prompt SSE", async () => {
  const probe = subscriptionProbe()
  await withServerLayer(probe.layer, options({ enableJsonResponse: true }), async (handler) => {
    const invalidRequests = [
      subscriptionRequest("invalid-filter-type", { toolsListChanged: "yes" }),
      subscriptionRequest("invalid-resource-filter", { resourceSubscriptions: "test://one" }),
      subscriptionRequest("invalid-method-header", { toolsListChanged: true }, {
        methodHeader: "tools/list"
      })
    ]
    const invalid = []
    for (const request of invalidRequests) {
      invalid.push(await errorObservation(await handler(request)))
    }

    const acceptedFilter = {
      toolsListChanged: true,
      resourceSubscriptions: ["test://one"]
    }
    const pending = handler(subscriptionRequest("listen-json-override", acceptedFilter))
    const prompt = await promptOutcome(pending)
    let acknowledged = prompt
    let headers
    if (prompt._tag === "Response") {
      headers = {
        contentType: prompt.value.headers.get("content-type"),
        cacheControl: prompt.value.headers.get("cache-control"),
        buffering: prompt.value.headers.get("x-accel-buffering"),
        protocolVersion: prompt.value.headers.get(McpModern.MCP_PROTOCOL_VERSION_HEADER),
        connection: prompt.value.headers.get("connection"),
        session: prompt.value.headers.get("mcp-session-id"),
        resume: prompt.value.headers.get("last-event-id")
      }
      const cursor = makeSseCursor(prompt.value)
      acknowledged = await cursor.next()
      await cursor.reader.cancel()
    } else {
      pending.catch(() => undefined)
    }

    assert.deepEqual({
      invalid: invalid.map(({ message: _, ...entry }) => entry),
      prompt: prompt._tag,
      headers,
      acknowledged,
      opened: probe.opened
    }, {
      invalid: [
        {
          status: 400,
          protocolVersion,
          id: "invalid-filter-type",
          code: -32602,
          data: undefined
        },
        {
          status: 400,
          protocolVersion,
          id: "invalid-resource-filter",
          code: -32602,
          data: undefined
        },
        {
          status: 400,
          protocolVersion,
          id: "invalid-method-header",
          code: -32020,
          data: undefined
        }
      ],
      prompt: "Response",
      headers: {
        contentType: "text/event-stream",
        cacheControl: "no-cache",
        buffering: "no",
        protocolVersion,
        connection: null,
        session: null,
        resume: null
      },
      acknowledged: {
        _tag: "Message",
        value: {
          jsonrpc: "2.0",
          method: "notifications/subscriptions/acknowledged",
          params: {
            notifications: acceptedFilter,
            _meta: {
              "io.modelcontextprotocol/subscriptionId": "listen-json-override"
            }
          }
        }
      },
      opened: [{ id: "listen-json-override", filter: acceptedFilter }]
    })
  })
})

test("subscription acknowledgement wins registration races and filters every later frame", async () => {
  let racePublish
  const probe = subscriptionProbe({
    onOpen: ({ service }) => {
      racePublish = Effect.runPromise(service.publish({
        tag: "notifications/tools/list_changed",
        payload: { source: "open-race" }
      }))
    }
  })
  const filter = {
    toolsListChanged: true,
    resourcesListChanged: false,
    resourceSubscriptions: ["test://selected"]
  }
  await withServerLayer(probe.layer, options({ enableJsonResponse: undefined }), async (handler) => {
    const response = await handler(subscriptionRequest(7, filter))
    const cursor = makeSseCursor(response)
    const acknowledged = await cursor.next()
    await racePublish

    {
      await Effect.runPromise(probe.service().publish({
        tag: "notifications/prompts/list_changed",
        payload: { source: "unselected-prompt" }
      }))
      await Effect.runPromise(probe.service().publish({
        tag: "notifications/resources/updated",
        payload: { uri: "test://other", source: "unselected-resource" }
      }))
      await Effect.runPromise(probe.service().publish({
        tag: "notifications/progress",
        payload: { progressToken: "request-only", progress: 1 }
      }))
      await Effect.runPromise(probe.service().publish({
        tag: "notifications/message",
        payload: { level: "info", data: "request-only" }
      }))
      await Effect.runPromise(probe.service().publish({
        tag: "notifications/resources/updated",
        payload: { uri: "test://selected", source: "selected-resource" }
      }))
    }

    const raced = await cursor.next()
    const resource = await cursor.next()
    await cursor.reader.cancel()
    await cursor.reader.cancel()
    const closed = await waitUntil(() => probe.closed.length === 1)
    const laterPublish = await promptOutcome(Effect.runPromise(probe.service().publish({
      tag: "notifications/tools/list_changed",
      payload: { source: "after-close" }
    })))

    assert.deepEqual({
      acknowledged,
      raced,
      resource,
      closed,
      closeCalls: probe.closed,
      laterPublish: laterPublish._tag
    }, {
      acknowledged: {
        _tag: "Message",
        value: {
          jsonrpc: "2.0",
          method: "notifications/subscriptions/acknowledged",
          params: {
            notifications: filter,
            _meta: { "io.modelcontextprotocol/subscriptionId": 7 }
          }
        }
      },
      raced: {
        _tag: "Message",
        value: {
          jsonrpc: "2.0",
          method: "notifications/tools/list_changed",
          params: {
            source: "open-race",
            _meta: { "io.modelcontextprotocol/subscriptionId": 7 }
          }
        }
      },
      resource: {
        _tag: "Message",
        value: {
          jsonrpc: "2.0",
          method: "notifications/resources/updated",
          params: {
            uri: "test://selected",
            source: "selected-resource",
            _meta: { "io.modelcontextprotocol/subscriptionId": 7 }
          }
        }
      },
      closed: true,
      closeCalls: [7],
      laterPublish: "Response"
    })
  })
})

test("independent numeric and string subscriptions never cross filtered streams", async () => {
  const probe = subscriptionProbe()
  await withServerLayer(probe.layer, options({ enableJsonResponse: undefined }), async (handler) => {
    const numericResponse = await handler(subscriptionRequest(1, { toolsListChanged: true }))
    const stringResponse = await handler(subscriptionRequest("1", { promptsListChanged: true }))
    const numeric = makeSseCursor(numericResponse)
    const string = makeSseCursor(stringResponse)
    const acknowledgements = await Promise.all([numeric.next(), string.next()])
    if (acknowledgements.some((entry) => entry._tag !== "Message")) {
      await Promise.all([
        numeric.reader.cancel().catch(() => undefined),
        string.reader.cancel().catch(() => undefined)
      ])
      assert.deepEqual(
        acknowledgements.map((entry) => entry._tag),
        ["Message", "Message"]
      )
      return
    }

    await Effect.runPromise(probe.service().publish({
      tag: "notifications/prompts/list_changed",
      payload: { lane: "string" }
    }))
    await Effect.runPromise(probe.service().publish({
      tag: "notifications/tools/list_changed",
      payload: { lane: "numeric" }
    }))
    const [numericFrame, stringFrame] = await Promise.all([numeric.next(), string.next()])

    await numeric.reader.cancel()
    await Effect.runPromise(probe.service().publish({
      tag: "notifications/tools/list_changed",
      payload: { lane: "closed-numeric" }
    }))
    await Effect.runPromise(probe.service().publish({
      tag: "notifications/prompts/list_changed",
      payload: { lane: "surviving-string" }
    }))
    const surviving = await string.next()
    await string.reader.cancel()
    await waitUntil(() => probe.closed.length === 2)

    assert.deepEqual({
      acknowledgements: acknowledgements.map((entry) => entry.value?.params?._meta?.[
        "io.modelcontextprotocol/subscriptionId"
      ]),
      numericFrame,
      stringFrame,
      surviving,
      closed: probe.closed
    }, {
      acknowledgements: [1, "1"],
      numericFrame: {
        _tag: "Message",
        value: {
          jsonrpc: "2.0",
          method: "notifications/tools/list_changed",
          params: {
            lane: "numeric",
            _meta: { "io.modelcontextprotocol/subscriptionId": 1 }
          }
        }
      },
      stringFrame: {
        _tag: "Message",
        value: {
          jsonrpc: "2.0",
          method: "notifications/prompts/list_changed",
          params: {
            lane: "string",
            _meta: { "io.modelcontextprotocol/subscriptionId": "1" }
          }
        }
      },
      surviving: {
        _tag: "Message",
        value: {
          jsonrpc: "2.0",
          method: "notifications/prompts/list_changed",
          params: {
            lane: "surviving-string",
            _meta: { "io.modelcontextprotocol/subscriptionId": "1" }
          }
        }
      },
      closed: [1, "1"]
    })
  })
})

test("disposing the Web handler closes active subscription streams idempotently", async () => {
  const probe = subscriptionProbe()
  const web = StreamableHttpServerTransport.toWebHandler(
    probe.layer,
    options({ enableJsonResponse: undefined })
  )
  let cursor
  try {
    const response = await web.handler(subscriptionRequest("dispose-listen", {
      toolsListChanged: true
    }))
    cursor = makeSseCursor(response)
    const acknowledged = await cursor.next()
    await web.dispose()
    await web.dispose()
    const closed = await waitUntil(() => probe.closed.length === 1)
    const later = await promptOutcome(Effect.runPromise(probe.service().publish({
      tag: "notifications/tools/list_changed",
      payload: { source: "after-dispose" }
    })))
    assert.deepEqual({
      acknowledged: acknowledged._tag,
      closed,
      closeCalls: probe.closed,
      later: later._tag
    }, {
      acknowledged: "Message",
      closed: true,
      closeCalls: ["dispose-listen"],
      later: "Response"
    })
  } finally {
    await cursor?.reader.cancel().catch(() => undefined)
    await web.dispose()
  }
})

test("real Node HTTP bridge streams subscriptions incrementally and cleans abrupt sockets", {
  timeout: 5_000
}, async () => {
  const probe = subscriptionProbe()
  const web = StreamableHttpServerTransport.toWebHandler(
    probe.layer,
    options({ enableJsonResponse: true })
  )
  const bridge = createServer((incoming, outgoing) => {
    void (async () => {
      const controller = new AbortController()
      const request = new Request(`http://127.0.0.1${incoming.url}`, {
        method: incoming.method,
        headers: incoming.headers,
        body: Readable.toWeb(incoming),
        duplex: "half",
        signal: controller.signal
      })
      const response = await web.handler(request)
      outgoing.writeHead(response.status, Object.fromEntries(response.headers))
      if (response.body === null) {
        outgoing.end()
        return
      }
      const reader = response.body.getReader()
      let ended = false
      const close = () => {
        if (ended) return
        controller.abort()
        void reader.cancel().catch(() => undefined)
      }
      outgoing.once("close", close)
      try {
        while (true) {
          const next = await reader.read()
          if (next.done) break
          for (let offset = 0; offset < next.value.byteLength; offset += 3) {
            if (outgoing.destroyed) return
            outgoing.write(Buffer.from(next.value.subarray(offset, offset + 3)))
          }
        }
        ended = true
        outgoing.end()
      } finally {
        outgoing.off("close", close)
      }
    })().catch((cause) => {
      if (!outgoing.headersSent) outgoing.writeHead(500)
      outgoing.end(String(cause))
    })
  })

  const frames = []
  const waiters = []
  let buffered = ""
  const deliver = () => {
    while (buffered.includes("\n\n")) {
      const boundary = buffered.indexOf("\n\n")
      const frame = buffered.slice(0, boundary)
      buffered = buffered.slice(boundary + 2)
      const data = frame.split("\n").find((line) => line.startsWith("data: "))
      frames.push(JSON.parse(data.slice(6)))
      waiters.shift()?.()
    }
  }
  const nextFrame = async () => {
    if (frames.length === 0) {
      const ready = new Promise((resolve) => waiters.push(resolve))
      const outcome = await promptOutcome(ready, 750)
      if (outcome._tag === "Timeout") return outcome
    }
    return { _tag: "Message", value: frames.shift() }
  }

  let clientResponse
  let clientRequest
  try {
    bridge.listen(0, "127.0.0.1")
    await once(bridge, "listening")
    const address = bridge.address()
    const body = JSON.stringify({
      jsonrpc: "2.0",
      id: "node-listen",
      method: "subscriptions/listen",
      params: {
        notifications: { toolsListChanged: true },
        _meta: requestMeta()
      }
    })
    const responsePending = new Promise((resolve, reject) => {
      clientRequest = nodeRequest({
        hostname: "127.0.0.1",
        port: address.port,
        path: "/mcp",
        method: "POST",
        headers: {
          "content-type": "application/json",
          accept: "application/json, text/event-stream",
          [McpModern.MCP_PROTOCOL_VERSION_HEADER]: protocolVersion,
          [McpModern.MCP_METHOD_HEADER]: "subscriptions/listen",
          "content-length": Buffer.byteLength(body)
        }
      }, resolve)
      clientRequest.once("error", reject)
      clientRequest.end(body)
    })
    const responseOutcome = await promptOutcome(responsePending, 750)
    if (responseOutcome._tag === "Timeout") {
      clientRequest.destroy()
      assert.fail("Node bridge did not receive subscription headers promptly")
    }
    clientResponse = responseOutcome.value
    clientResponse.on("data", (chunk) => {
      buffered += chunk.toString("utf8")
      deliver()
    })

    const acknowledged = await nextFrame()
    await Effect.runPromise(probe.service().publish({
      tag: "notifications/tools/list_changed",
      payload: { source: "node-incremental" }
    }))
    const published = await nextFrame()
    const endedBeforeClose = clientResponse.complete
    clientResponse.destroy()
    const closed = await waitUntil(() => probe.closed.length === 1, 1_000)
    const later = await promptOutcome(Effect.runPromise(probe.service().publish({
      tag: "notifications/tools/list_changed",
      payload: { source: "after-socket-close" }
    })), 750)

    assert.deepEqual({
      status: clientResponse.statusCode,
      contentType: clientResponse.headers["content-type"],
      acknowledged: acknowledged._tag,
      published: published.value?.params?.source,
      endedBeforeClose,
      closed,
      closeCalls: probe.closed,
      later: later._tag
    }, {
      status: 200,
      contentType: "text/event-stream",
      acknowledged: "Message",
      published: "node-incremental",
      endedBeforeClose: false,
      closed: true,
      closeCalls: ["node-listen"],
      later: "Response"
    })
  } finally {
    clientRequest?.destroy()
    clientResponse?.destroy()
    await web.dispose()
    await new Promise((resolve) => bridge.close(resolve))
  }
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

test("extension notifications complete generic preflight before hook side effects", async () => {
  const firstVersion = protocolVersion
  const secondVersion = "2026-08-01"
  const calls = []
  const notification = ({
    protocolHeader = firstVersion,
    methodHeader = "example.com/review",
    bodyVersion = firstVersion,
    includeMeta = true
  } = {}) => {
    const headers = new Headers({
      "content-type": "application/json",
      accept: "application/json, text/event-stream",
      "x-extension-mirror": "exact-review-value"
    })
    if (protocolHeader !== null) headers.set(McpModern.MCP_PROTOCOL_VERSION_HEADER, protocolHeader)
    if (methodHeader !== null) headers.set(McpModern.MCP_METHOD_HEADER, methodHeader)
    return new Request("http://localhost/mcp", {
      method: "POST",
      headers,
      body: JSON.stringify({
        jsonrpc: "2.0",
        method: "example.com/review",
        params: {
          marker: "review",
          ...(includeMeta ? { _meta: requestMeta(bodyVersion) } : {})
        }
      })
    })
  }

  await withServer(options({
    supportedProtocolVersions: [firstVersion, secondVersion],
    acceptNotification: (_message, context) => Effect.sync(() => {
      calls.push(context)
    })
  }), async (handler) => {
    const rejected = []
    for (const request of [
      notification({ protocolHeader: null }),
      notification({ includeMeta: false }),
      notification({ methodHeader: null }),
      notification({ methodHeader: "example.com/other" }),
      notification({ protocolHeader: secondVersion, bodyVersion: firstVersion }),
      notification({ protocolHeader: "2099-01-01", bodyVersion: "2099-01-01" })
    ]) {
      const response = await handler(request)
      rejected.push({
        status: response.status,
        body: await response.text(),
        version: response.headers.get(McpModern.MCP_PROTOCOL_VERSION_HEADER)
      })
    }
    assert.deepEqual(rejected, Array.from({ length: 6 }, () => ({
      status: 400,
      body: "",
      version: firstVersion
    })))
    assert.equal(calls.length, 0)

    const accepted = await handler(notification({
      protocolHeader: secondVersion,
      bodyVersion: secondVersion
    }))
    assert.equal(accepted.status, 202)
    assert.equal(accepted.headers.get(McpModern.MCP_PROTOCOL_VERSION_HEADER), secondVersion)
    assert.equal(calls.length, 1)
    assert.equal(calls[0].requestHeaders["x-extension-mirror"], "exact-review-value")
    assert.equal(Object.isFrozen(calls[0].requestHeaders), true)
  })
})

test("protocol response selection promotes only fully accepted versions", async () => {
  const firstVersion = protocolVersion
  const secondVersion = "2026-08-01"
  await withServer(options({
    supportedProtocolVersions: [firstVersion, secondVersion]
  }), async (handler) => {
    const mismatch = await handler(rpcPost({
      id: "version-mismatch",
      method: "server/discover",
      protocolHeader: secondVersion,
      params: { _meta: requestMeta(firstVersion) }
    }))
    assert.equal(mismatch.status, 400)
    assert.equal(mismatch.headers.get(McpModern.MCP_PROTOCOL_VERSION_HEADER), firstVersion)

    const invalidParams = await handler(rpcPost({
      id: "invalid-second",
      method: "tools/call",
      protocolHeader: secondVersion,
      methodHeader: "tools/call",
      nameHeader: "not-a-string-body",
      params: { name: 42, arguments: {}, _meta: requestMeta(secondVersion) }
    }))
    assert.equal(invalidParams.status, 400)
    assert.equal(invalidParams.headers.get(McpModern.MCP_PROTOCOL_VERSION_HEADER), firstVersion)

    const accepted = await handler(rpcPost({
      id: "accepted-second",
      method: "server/discover",
      protocolHeader: secondVersion,
      params: { _meta: requestMeta(secondVersion) }
    }))
    assert.equal(accepted.status, 200)
    assert.equal(accepted.headers.get(McpModern.MCP_PROTOCOL_VERSION_HEADER), secondVersion)
  })
})

test("Accept requires both exact positive-quality media ranges", async () => {
  await withServer(options(), async (handler) => {
    for (const accept of [
      "application/json;q=0, text/event-stream",
      "application/json, text/event-stream;q=0",
      "application/json;q=nope, text/event-stream",
      "application/json;q=1.1, text/event-stream",
      "application/json; charset=utf-8, text/event-stream",
      "application/*, text/event-stream",
      "application/json, */*"
    ]) {
      const response = await handler(post({ headers: { accept } }))
      assert.equal(response.status, 406, accept)
      assert.equal(await response.text(), "", accept)
    }
    const accepted = await handler(post({
      headers: { accept: "application/json;q=0.2, text/event-stream;q=1" }
    }))
    assert.equal(accepted.status, 200)
  })
})

test("parsed bodies and early oversized uploads honor the raw Content-Length bound", async () => {
  let dispatched = 0
  const app = Layer.effectDiscard(Effect.gen(function*() {
    const server = yield* McpServer.McpServer
    const makeDispatcher = server.makeDispatcher
    server.makeDispatcher = (...args) => Effect.sync(() => {
      dispatched++
    }).pipe(Effect.zipRight(makeDispatcher(...args)))
  }))
  await withServerLayer(app, options({ maxBodyBytes: 64 }), async (handler) => {
    const parsed = requestBody()
    const parsedResponse = await handler(new Request("http://localhost/mcp", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        accept: "application/json, text/event-stream",
        [McpModern.MCP_PROTOCOL_VERSION_HEADER]: protocolVersion,
        [McpModern.MCP_METHOD_HEADER]: "server/discover",
        "content-length": "65"
      }
    }), { parsedBody: parsed })
    assert.equal(parsedResponse.status, 413)
    assert.equal(await parsedResponse.text(), "")
    assert.equal(dispatched, 0)

    let cancelled = 0
    const body = new ReadableStream({
      cancel() {
        cancelled++
      }
    })
    const early = await handler(new Request("http://localhost/mcp", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        accept: "application/json, text/event-stream",
        [McpModern.MCP_PROTOCOL_VERSION_HEADER]: protocolVersion,
        [McpModern.MCP_METHOD_HEADER]: "server/discover",
        "content-length": "65"
      },
      body,
      duplex: "half"
    }))
    assert.equal(early.status, 413)
    assert.equal(cancelled, 1)
    assert.equal(body.locked, false)
    assert.equal(dispatched, 0)
  })
})

test("parsed bodies cannot bypass maxBodyBytes through an undeclared raw upload", async () => {
  let cancelled = 0
  const body = new ReadableStream({
    start(controller) {
      controller.enqueue(new Uint8Array(4096))
    },
    cancel() {
      cancelled++
    }
  })

  await withServer(options({ maxBodyBytes: 512 }), async (handler) => {
    const response = await handler(new Request("http://localhost/mcp", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        accept: "application/json, text/event-stream",
        [McpModern.MCP_PROTOCOL_VERSION_HEADER]: protocolVersion,
        [McpModern.MCP_METHOD_HEADER]: "server/discover"
      },
      body,
      duplex: "half"
    }), { parsedBody: requestBody() })

    assert.equal(response.status, 413)
    assert.equal(await response.text(), "")
    assert.equal(cancelled, 1)
    assert.equal(body.locked, false)
  })
})

test("aborting a stalled upload cancels and unlocks its request body", async () => {
  let cancelled = 0
  const body = new ReadableStream({
    cancel() {
      cancelled++
    }
  })
  const abort = new AbortController()
  const web = StreamableHttpServerTransport.toWebHandler(Layer.empty, options())
  try {
    const pending = web.handler(new Request("http://localhost/mcp", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        accept: "application/json, text/event-stream",
        [McpModern.MCP_PROTOCOL_VERSION_HEADER]: protocolVersion,
        [McpModern.MCP_METHOD_HEADER]: "server/discover"
      },
      body,
      duplex: "half",
      signal: abort.signal
    })).catch(() => undefined)
    await new Promise((resolve) => setTimeout(resolve, 10))
    abort.abort()
    assert.equal((await promptOutcome(pending, 500))._tag, "Response")
    assert.equal(await waitUntil(() => cancelled === 1), true)
    assert.equal(body.locked, false)
  } finally {
    await web.dispose()
  }
})

test("Host validation accepts only a strict RFC authority", async () => {
  const invalid = [
    "localhost@evil.example",
    "evil.example@localhost",
    "localhost/path",
    "localhost?query",
    "localhost#fragment",
    "localhost\\evil.example",
    " localhost",
    "localhost ",
    "localhost,evil.example",
    "localhost:bad",
    "localhost:80:90"
  ]
  for (const host of invalid) {
    assert.equal(
      StreamableHttpServerTransport.validateHostHeader(host, ["localhost", "127.0.0.1", "[::1]"]).ok,
      false,
      host
    )
  }
  for (const host of ["localhost", "localhost:8080", "127.0.0.1:3000", "[::1]:9000"]) {
    assert.equal(
      StreamableHttpServerTransport.validateHostHeader(host, ["localhost", "127.0.0.1", "[::1]"]).ok,
      true,
      host
    )
  }

  const counters = freshCounters()
  await withServerLayer(validationProbeLayer(counters), options({
    enableDnsRebindingProtection: true,
    allowedHosts: ["localhost"]
  }), async (handler) => {
    const response = await handler(post({ headers: { host: "evil.example@localhost" } }))
    assert.equal(response.status, 403)
    assert.equal(await response.text(), "")
    assert.deepEqual(counters, freshCounters())
  })
})

test("Effect Platform Layer disposal closes subscription and pending ordinary streams", async () => {
  await withEffectPlatform(options({ enableJsonResponse: false }), async (handler, runtime) => {
    const server = await runtime.runPromise(McpServer.McpServer)
    let closed = 0
    const openSubscription = server.openSubscription
    server.openSubscription = (...args) => {
      const close = openSubscription(...args)
      return () => {
        closed++
        close()
      }
    }
    await server.addTool({
      tool: new McpSchema.Tool({
        name: "platform-never",
        inputSchema: { type: "object", properties: {} }
      }),
      annotations: Context.empty(),
      handler: () => Effect.never
    }).pipe(Effect.runPromise)
    const subscription = makeSseCursor(await handler(subscriptionRequest("platform-dispose", {
      toolsListChanged: true
    })))
    assert.equal((await subscription.next())._tag, "Message")

    const ordinary = makeSseCursor(await handler(callToolRequest("platform-pending", "platform-never")))
    assert.equal((await ordinary.next(25))._tag, "Timeout")

    await runtime.dispose()
    assert.equal((await subscription.next(500))._tag, "Done")
    assert.equal((await ordinary.next(500))._tag, "Done")
    assert.equal(closed, 1)
    assert.equal((await promptOutcome(Effect.runPromise(server.publish({
      tag: "notifications/tools/list_changed",
      payload: { after: "dispose" }
    })), 250))._tag, "Response")
  })
})

test("Effect-native handle derives response ownership from its caller scope", async () => {
  const server = await Effect.runPromise(McpServer.McpServer.makeWithOptions(options()))
  const originalOpen = server.openSubscription
  let closed = 0
  server.openSubscription = (...args) => {
    const close = originalOpen(...args)
    return () => {
      closed++
      close()
    }
  }
  const scope = await Effect.runPromise(Scope.make())
  let cursor
  try {
    const response = await Effect.runPromise(Scope.extend(
      StreamableHttpServerTransport.handle(
        subscriptionRequest("effect-handle-scope", { toolsListChanged: true }),
        options({ enableJsonResponse: false })
      ).pipe(Effect.provideService(McpServer.McpServer, server)),
      scope
    ))
    cursor = makeSseCursor(response)
    assert.equal((await cursor.next())._tag, "Message")

    await Effect.runPromise(Scope.close(scope, Exit.void))
    assert.equal((await cursor.next(500))._tag, "Done")
    assert.equal(closed, 1)

    const transportSource = readFileSync(
      "src/transport/StreamableHttpServerTransport.ts",
      "utf8"
    )
    assert.equal(transportSource.includes("Scope.make("), false)
  } finally {
    await cursor?.reader.cancel().catch(() => undefined)
    await Effect.runPromise(Scope.close(scope, Exit.void))
  }
})

test("subscription encoding failure closes ownership and publish interruption stays interrupted", async () => {
  const probe = subscriptionProbe()
  await withServerLayer(probe.layer, options({ maxPendingFrames: 1 }), async (handler) => {
    const response = await handler(subscriptionRequest("cyclic", { toolsListChanged: true }))
    const cursor = makeSseCursor(response)
    assert.equal((await cursor.next())._tag, "Message")
    const cyclic = {}
    cyclic.self = cyclic
    const invalidPublishes = await promptOutcome(Promise.all([
      Effect.runPromise(probe.service().publish({
        tag: "notifications/tools/list_changed",
        payload: cyclic
      })),
      Effect.runPromise(probe.service().publish({
        tag: "notifications/tools/list_changed",
        payload: cyclic
      }))
    ]), 500)
    assert.equal(invalidPublishes._tag, "Response")
    const streamFailure = await promptOutcome(
      cursor.reader.read().then(
        () => ({ _tag: "Resolved" }),
        (cause) => ({ _tag: "Rejected", cause })
      ),
      500
    )
    assert.equal(streamFailure._tag, "Response")
    assert.equal(streamFailure.value._tag, "Rejected")
    assert.match(String(streamFailure.value.cause), /HTTP response stream failed/)
    assert.equal(await waitUntil(() => probe.closed.length === 1), true)
    assert.equal((await promptOutcome(Effect.runPromise(probe.service().publish({
      tag: "notifications/tools/list_changed",
      payload: { later: true }
    })), 250))._tag, "Response")

    const unread = await handler(subscriptionRequest("blocked", { toolsListChanged: true }))
    assert.equal((await promptOutcome(Effect.runPromise(probe.service().publish({
      tag: "notifications/tools/list_changed",
      payload: { fillsBoundedQueue: true }
    })), 250))._tag, "Response")
    const interrupted = await Effect.runPromise(Effect.scoped(Effect.gen(function*() {
      const fiber = yield* probe.service().publish({
        tag: "notifications/tools/list_changed",
        payload: { blocked: true }
      }).pipe(Effect.forkScoped)
      yield* Effect.sleep("10 millis")
      return yield* Fiber.interrupt(fiber)
    })))
    assert.equal(interrupted._tag, "Failure")
    assert.equal(Cause.isInterruptedOnly(interrupted.cause), true)
    await unread.body.cancel()
  })
})
