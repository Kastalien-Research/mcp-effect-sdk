import { createServer, type IncomingMessage, type ServerResponse } from "node:http"
import { randomUUID } from "node:crypto"
import { LATEST_PROTOCOL_VERSION } from "../generated/mcp/McpProtocol.generated.js"

const host = process.env.HOST ?? "127.0.0.1"
const port = Number(process.env.PORT ?? "3000")
const endpoint = "/mcp"
const sessionHeader = "mcp-session-id"
const protocolHeader = "mcp-protocol-version"

const testImageBase64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFBQIAX8jx0gAAAABJRU5ErkJggg=="
const testAudioBase64 = "UklGRiYAAABXQVZFZm10IBAAAAABAAEAQB8AAAB9AAACABAAZGF0YQIAAAA="

interface JsonRpcRequest {
  readonly jsonrpc: "2.0"
  readonly id?: string | number
  readonly method: string
  readonly params?: unknown
}

interface JsonRpcResponse {
  readonly jsonrpc: "2.0"
  readonly id: string | number
  readonly result?: unknown
  readonly error?: {
    readonly code: number
    readonly message: string
    readonly data?: unknown
  }
}

const sessions = new Set<string>()
const resourceSubscriptions = new Set<string>()

const tools = [
  {
    name: "test_simple_text",
    description: "Tests simple text content response",
    inputSchema: { type: "object", properties: {} }
  },
  {
    name: "test_image_content",
    description: "Tests image content response",
    inputSchema: { type: "object", properties: {} }
  },
  {
    name: "test_audio_content",
    description: "Tests audio content response",
    inputSchema: { type: "object", properties: {} }
  },
  {
    name: "test_embedded_resource",
    description: "Tests embedded resource content response",
    inputSchema: { type: "object", properties: {} }
  },
  {
    name: "test_multiple_content_types",
    description: "Tests response with multiple content types",
    inputSchema: { type: "object", properties: {} }
  },
  {
    name: "test_error_response",
    description: "Tests tool error responses",
    inputSchema: { type: "object", properties: {} }
  },
  {
    name: "test_logging",
    description: "Tests tool invocation while logging is enabled",
    inputSchema: { type: "object", properties: {} }
  },
  {
    name: "test_progress",
    description: "Tests progress-token compatible tool invocation",
    inputSchema: { type: "object", properties: {} }
  },
  {
    name: "test_sampling",
    description: "Tests sampling-capable tool invocation",
    inputSchema: { type: "object", properties: {} }
  },
  {
    name: "test_elicitation",
    description: "Tests elicitation-capable tool invocation",
    inputSchema: { type: "object", properties: {} }
  },
  {
    name: "json_schema_2020_12_tool",
    description: "Tool with JSON Schema 2020-12 features",
    inputSchema: {
      $schema: "https://json-schema.org/draft/2020-12/schema",
      type: "object",
      $defs: {
        address: {
          type: "object",
          properties: {
            street: { type: "string" },
            city: { type: "string" }
          }
        }
      },
      properties: {
        name: { type: "string" },
        address: { $ref: "#/$defs/address" }
      },
      additionalProperties: false
    }
  }
] as const

const resources = [
  {
    uri: "test://static-text",
    name: "Static text",
    description: "Static text resource for conformance testing",
    mimeType: "text/plain"
  },
  {
    uri: "test://static-binary",
    name: "Static binary",
    description: "Static binary resource for conformance testing",
    mimeType: "image/png"
  }
] as const

const resourceTemplates = [
  {
    uriTemplate: "test://template/{id}",
    name: "Template resource",
    description: "Template resource for conformance testing",
    mimeType: "text/plain"
  }
] as const

const prompts = [
  {
    name: "test_simple_prompt",
    description: "Simple prompt for conformance testing"
  },
  {
    name: "test_prompt_with_arguments",
    description: "Prompt with arguments for conformance testing",
    arguments: [
      { name: "arg1", description: "First test argument", required: true },
      { name: "arg2", description: "Second test argument", required: true }
    ]
  },
  {
    name: "test_prompt_embedded_resource",
    description: "Prompt with embedded resource content"
  },
  {
    name: "test_prompt_with_image",
    description: "Prompt with image content"
  }
] as const

const server = createServer((request, response) => {
  void handleRequest(request, response).catch((error: unknown) => {
    writeText(response, 500, `Internal server error: ${String(error)}`)
  })
})

server.listen(port, host, () => {
  const address = server.address()
  const resolvedPort = typeof address === "object" && address ? address.port : port
  console.log(`mcp-effect-sdk everything server running on http://${host}:${resolvedPort}${endpoint}`)
})

process.once("SIGTERM", () => {
  server.close(() => process.exit(0))
})

process.once("SIGINT", () => {
  server.close(() => process.exit(0))
})

async function handleRequest(request: IncomingMessage, response: ServerResponse): Promise<void> {
  if (request.url !== endpoint) {
    writeText(response, 404, "Not found")
    return
  }
  if (request.method === "GET") {
    writeText(response, 405, "GET SSE stream is not implemented by this example")
    return
  }
  if (request.method === "DELETE") {
    const sessionId = getHeader(request, sessionHeader)
    if (sessionId) sessions.delete(sessionId)
    response.writeHead(200)
    response.end()
    return
  }
  if (request.method !== "POST") {
    writeText(response, 405, "Method not allowed")
    return
  }

  const message = parseJsonRpcRequest(await readBody(request))
  if (!message) {
    writeText(response, 400, "Invalid JSON-RPC request")
    return
  }

  if (message.method !== "initialize" && message.id !== undefined) {
    const sessionId = getHeader(request, sessionHeader)
    if (!sessionId || !sessions.has(sessionId)) {
      writeText(response, 404, "MCP session does not exist")
      return
    }
  }

  if (message.id === undefined) {
    response.writeHead(202)
    response.end()
    return
  }

  const handled = handleMessage(message)
  if (handled.method === "initialize") {
    const sessionId = randomUUID()
    sessions.add(sessionId)
    writeJson(response, handled.response, {
      [sessionHeader]: sessionId,
      [protocolHeader]: LATEST_PROTOCOL_VERSION
    })
    return
  }
  writeJson(response, handled.response)
}

function handleMessage(message: JsonRpcRequest): {
  readonly method: string
  readonly response: JsonRpcResponse
} {
  try {
    switch (message.method) {
      case "initialize":
        return respond(message, {
          protocolVersion: LATEST_PROTOCOL_VERSION,
          capabilities: {
            completions: {},
            logging: {},
            prompts: { listChanged: true },
            resources: { listChanged: true, subscribe: true },
            tools: { listChanged: true }
          },
          serverInfo: {
            name: "mcp-effect-sdk-everything-server",
            version: "1.0.0"
          },
          instructions: "Everything-style conformance server for mcp-effect-sdk."
        })
      case "ping":
      case "logging/setLevel":
        return respond(message, {})
      case "tools/list":
        return respond(message, { tools })
      case "tools/call":
        return respond(message, callTool(getObject(message.params)))
      case "resources/list":
        return respond(message, { resources })
      case "resources/templates/list":
        return respond(message, { resourceTemplates })
      case "resources/read":
        return respond(message, readResource(getObject(message.params)))
      case "resources/subscribe":
        resourceSubscriptions.add(String(getObject(message.params)["uri"] ?? ""))
        return respond(message, {})
      case "resources/unsubscribe":
        resourceSubscriptions.delete(String(getObject(message.params)["uri"] ?? ""))
        return respond(message, {})
      case "prompts/list":
        return respond(message, { prompts })
      case "prompts/get":
        return respond(message, getPrompt(getObject(message.params)))
      case "completion/complete":
        return respond(message, {
          completion: {
            values: ["testValue1", "testValue2", "template-1"],
            total: 3,
            hasMore: false
          }
        })
      default:
        return respondError(message, -32601, `Method not found: ${message.method}`)
    }
  } catch (error: unknown) {
    return respondError(message, -32603, String(error))
  }
}

function callTool(params: Record<string, unknown>): unknown {
  switch (params["name"]) {
    case "test_simple_text":
      return textToolResult("This is a simple text response for testing.")
    case "test_image_content":
      return { content: [{ type: "image", data: testImageBase64, mimeType: "image/png" }] }
    case "test_audio_content":
      return { content: [{ type: "audio", data: testAudioBase64, mimeType: "audio/wav" }] }
    case "test_embedded_resource":
      return {
        content: [{
          type: "resource",
          resource: {
            uri: "test://embedded-resource",
            mimeType: "text/plain",
            text: "This is an embedded resource content."
          }
        }]
      }
    case "test_multiple_content_types":
      return {
        content: [
          { type: "text", text: "Multiple content types test:" },
          { type: "image", data: testImageBase64, mimeType: "image/png" },
          {
            type: "resource",
            resource: {
              uri: "test://embedded-resource",
              mimeType: "text/plain",
              text: "This is an embedded resource content."
            }
          }
        ]
      }
    case "test_error_response":
      return { isError: true, content: [{ type: "text", text: "Tool error for testing." }] }
    case "test_logging":
      return textToolResult("Logging test completed.")
    case "test_progress":
      return textToolResult("Progress test completed.")
    case "test_sampling":
      return textToolResult("Sampling test completed without client sampling.")
    case "test_elicitation":
      return textToolResult("Elicitation test completed without client elicitation.")
    case "json_schema_2020_12_tool":
      return textToolResult("JSON Schema 2020-12 tool response.")
    default:
      return { isError: true, content: [{ type: "text", text: "Unknown tool." }] }
  }
}

function readResource(params: Record<string, unknown>): unknown {
  const uri = String(params["uri"] ?? "")
  if (uri === "test://static-text") {
    return {
      contents: [{
        uri,
        mimeType: "text/plain",
        text: "This is the content of the static text resource."
      }]
    }
  }
  if (uri === "test://static-binary") {
    return {
      contents: [{
        uri,
        mimeType: "image/png",
        blob: testImageBase64
      }]
    }
  }
  if (uri.startsWith("test://template/")) {
    return {
      contents: [{
        uri,
        mimeType: "text/plain",
        text: `Template resource content for ${uri.slice("test://template/".length)}.`
      }]
    }
  }
  return { contents: [] }
}

function getPrompt(params: Record<string, unknown>): unknown {
  const name = String(params["name"] ?? "")
  const args = getObject(params["arguments"])
  switch (name) {
    case "test_simple_prompt":
      return {
        messages: [{
          role: "user",
          content: { type: "text", text: "This is a simple prompt for testing." }
        }]
      }
    case "test_prompt_with_arguments":
      return {
        messages: [{
          role: "user",
          content: {
            type: "text",
            text: `Prompt with arguments: arg1='${args["arg1"]}', arg2='${args["arg2"]}'`
          }
        }]
      }
    case "test_prompt_embedded_resource":
      return {
        messages: [{
          role: "user",
          content: {
            type: "resource",
            resource: {
              uri: "test://static-text",
              mimeType: "text/plain",
              text: "This is the content of the static text resource."
            }
          }
        }]
      }
    case "test_prompt_with_image":
      return {
        messages: [{
          role: "user",
          content: { type: "image", data: testImageBase64, mimeType: "image/png" }
        }]
      }
    default:
      return { messages: [] }
  }
}

function textToolResult(text: string): unknown {
  return { content: [{ type: "text", text }] }
}

function respond(message: JsonRpcRequest, result: unknown) {
  return { method: message.method, response: { jsonrpc: "2.0" as const, id: message.id!, result } }
}

function respondError(message: JsonRpcRequest, code: number, text: string) {
  return {
    method: message.method,
    response: { jsonrpc: "2.0" as const, id: message.id!, error: { code, message: text } }
  }
}

function getObject(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {}
}

function getHeader(request: IncomingMessage, name: string): string | undefined {
  const value = request.headers[name]
  return Array.isArray(value) ? value[0] : value
}

function parseJsonRpcRequest(text: string): JsonRpcRequest | undefined {
  const parsed = JSON.parse(text) as unknown
  const candidate = getObject(parsed)
  if (candidate["jsonrpc"] !== "2.0" || typeof candidate["method"] !== "string") {
    return undefined
  }
  return candidate as unknown as JsonRpcRequest
}

function readBody(request: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let body = ""
    request.setEncoding("utf8")
    request.on("data", (chunk: string) => {
      body += chunk
    })
    request.on("end", () => resolve(body))
    request.on("error", reject)
  })
}

function writeJson(
  response: ServerResponse,
  body: JsonRpcResponse,
  headers: Record<string, string> = {}
): void {
  response.writeHead(200, {
    "Content-Type": "application/json",
    ...headers
  })
  response.end(JSON.stringify(body))
}

function writeText(response: ServerResponse, status: number, body: string): void {
  response.writeHead(status, { "Content-Type": "text/plain" })
  response.end(body)
}
