import { Buffer } from "node:buffer"
import { createServer, type IncomingMessage, type ServerResponse } from "node:http"
import * as Effect from "effect/Effect"
import * as Schema from "effect/Schema"
import type { TokenVerifierService } from "../auth/protected-resource.js"
import * as Deprecated from "../deprecated.js"
import { McpErrors, McpProtocol, McpSchema } from "../protocol/2026-07-28.js"
import * as McpServer from "../server.js"
import { StreamableHttpServerTransport } from "../transport/http.js"
import { jsonSchema202012Parameters } from "./everything-server-fixtures.js"

export const makeEverythingProtectedResourceOptions = (
  verifier: TokenVerifierService,
  protectedResource: string,
  resourceMetadata: string
) => ({
  authorization: { verifier, protectedResource, resourceMetadata },
  verifiedAuthorizationPrincipal: undefined
})

const host = process.env.HOST ?? "127.0.0.1"
const port = Number(process.env.PORT ?? "3000")
const endpoint = "/mcp"

const testImageBase64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFBQIAX8jx0gAAAABJRU5ErkJggg=="
const testAudioBase64 = "UklGRiYAAABXQVZFZm10IBAAAAABAAEAQB8AAAB9AAACABAAZGF0YQIAAAA="

const binary = (base64: string): Uint8Array => Uint8Array.from(Buffer.from(base64, "base64"))

const text = (value: string): McpSchema.TextContent =>
  McpSchema.TextContent.make({ type: "text", text: value })

const image = (): McpSchema.ImageContent =>
  McpSchema.ImageContent.make({
    type: "image",
    data: binary(testImageBase64),
    mimeType: "image/png"
  })

const audio = (): McpSchema.AudioContent =>
  McpSchema.AudioContent.make({
    type: "audio",
    data: binary(testAudioBase64),
    mimeType: "audio/wav"
  })

const embeddedResource = (uri = "test://embedded-resource"): McpSchema.EmbeddedResource =>
  McpSchema.EmbeddedResource.make({
    type: "resource",
    resource: McpSchema.TextResourceContents.make({
      uri,
      mimeType: "text/plain",
      text: "This is an embedded resource content."
    })
  })

const promptMessage = (
  content: typeof McpSchema.ContentBlock.Type
): McpSchema.PromptMessage =>
  McpSchema.PromptMessage.make({ role: "user", content })

const objectSchema = Schema.Struct({})

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value)

const elicitationInput = (
  message: string,
  properties: Record<string, unknown>,
  required: ReadonlyArray<string>
): typeof McpSchema.InputRequest.Type => ({
  method: "elicitation/create",
  params: {
    mode: "form",
    message,
    requestedSchema: { type: "object", properties, required }
  }
})

const samplingInput = (question: string, maxTokens: number): typeof McpSchema.InputRequest.Type => ({
  method: "sampling/createMessage",
  params: {
    messages: [{ role: "user", content: { type: "text", text: question } }],
    maxTokens
  }
})

const rootsInput = (): typeof McpSchema.InputRequest.Type => ({ method: "roots/list", params: {} })

const inputResponsesOf = (request: unknown): unknown =>
  isRecord(request) ? request.inputResponses : undefined

const requestStateOf = (request: unknown): string | undefined =>
  isRecord(request) && typeof request.requestState === "string" ? request.requestState : undefined

const acceptedForm = (responses: unknown, key: string): Record<string, unknown> | undefined => {
  if (!isRecord(responses)) return undefined
  const response = responses[key]
  if (!isRecord(response) || response.action !== "accept" || !isRecord(response.content)) return undefined
  return response.content
}

const acceptedString = (responses: unknown, key: string, field: string): string | undefined => {
  const content = acceptedForm(responses, key)
  return typeof content?.[field] === "string" ? content[field] : undefined
}

const acceptedSamplingText = (responses: unknown, key: string): string | undefined => {
  if (!isRecord(responses)) return undefined
  const response = responses[key]
  return isRecord(response) && isRecord(response.content) && response.content.type === "text" &&
    typeof response.content.text === "string"
    ? response.content.text
    : undefined
}

const acceptedRoots = (responses: unknown, key: string): ReadonlyArray<unknown> | undefined => {
  if (!isRecord(responses)) return undefined
  const response = responses[key]
  return isRecord(response) && Array.isArray(response.roots) ? response.roots : undefined
}

const inputRequired = (
  inputRequests: Record<string, typeof McpSchema.InputRequest.Type>,
  requestState?: string
) =>
  McpServer.requestInput({ inputRequests, ...(requestState === undefined ? {} : { requestState }) })

const nameInput = (message = "What is your name?") =>
  elicitationInput(message, { name: { type: "string" } }, ["name"])

const confirmInput = () =>
  elicitationInput("Please confirm", { ok: { type: "boolean" } }, ["ok"])

const everythingHandlers = Effect.gen(function*() {
    yield* McpServer.registerTool({
      name: "header_probe",
      description: "Tests HTTP custom header parameter handling",
      parameterSchema: Schema.Struct({
        value: Schema.optional(Schema.String.annotations({
          jsonSchema: { "x-mcp-header": "Value" }
        }))
      }),
      content: () => Effect.succeed("Header probe response.")
    })

    yield* McpServer.registerTool({
      name: "test_simple_text",
      description: "Tests simple text content response",
      content: () => Effect.succeed("This is a simple text response for testing.")
    })

    yield* McpServer.registerTool({
      name: "test_image_content",
      description: "Tests image content response",
      content: () => Effect.succeed([image()])
    })

    yield* McpServer.registerTool({
      name: "test_audio_content",
      description: "Tests audio content response",
      content: () => Effect.succeed([audio()])
    })

    yield* McpServer.registerTool({
      name: "test_embedded_resource",
      description: "Tests embedded resource content response",
      content: () => Effect.succeed([embeddedResource()])
    })

    yield* McpServer.registerTool({
      name: "test_multiple_content_types",
      description: "Tests response with multiple content types",
      content: () =>
        Effect.succeed([
          text("Multiple content types test:"),
          image(),
          embeddedResource("test://mixed-content-resource")
        ])
    })

    yield* McpServer.registerTool({
      name: "test_error_response",
      description: "Tests tool error responses",
      content: () =>
        Effect.succeed(new McpSchema.CallToolResult({
          resultType: "complete",
          isError: true,
          content: [text("Tool error for testing.")]
        }))
    })

    yield* McpServer.registerTool({
      name: "test_error_handling",
      description: "Tests thrown tool errors",
      content: () => Effect.fail(new Error("This tool intentionally returns an error for testing"))
    })

    yield* McpServer.registerTool({
      name: "test_tool_with_logging",
      description: "Tests tool invocation while logging is enabled",
      parameters: objectSchema.fields,
      content: () =>
        Effect.gen(function*() {
          yield* Deprecated.sendLoggingMessage({
            level: "info",
            logger: "everything-server",
            data: "Tool execution started"
          })
          yield* Deprecated.sendLoggingMessage({
            level: "info",
            logger: "everything-server",
            data: "Tool processing data"
          })
          yield* Deprecated.sendLoggingMessage({
            level: "info",
            logger: "everything-server",
            data: "Tool execution completed"
          })
          return "Tool with logging executed successfully"
        })
    })

    yield* McpServer.registerTool({
      name: "test_missing_capability",
      description: "Tests missing sampling capability handling",
      content: () => McpServer.requestInput({
        inputRequests: {
          sampling: samplingInput("Provide a minimal sampling response.", 1)
        }
      })
    })

    yield* McpServer.registerTool({
      name: "test_streaming_elicitation",
      description: "Tests a request-state-only incomplete result",
      content: () => McpServer.requestInput({ requestState: "streaming-elicitation" })
    })

    yield* McpServer.registerTool({
      name: "test_logging_tool",
      description: "Completes without logging when no log level is supplied",
      content: () => Effect.succeed("Logging tool completed.")
    })

    yield* McpServer.registerTool({
      name: "test_trigger_prompt_change",
      description: "Triggers a prompt list changed notification",
      content: () => McpServer.sendPromptListChanged.pipe(Effect.as("Prompt list changed."))
    })

    yield* McpServer.registerTool({
      name: "test_trigger_tool_change",
      description: "Triggers a tool list changed notification",
      content: () => McpServer.sendToolListChanged.pipe(Effect.as("Tool list changed."))
    })

    yield* McpServer.registerTool({
      name: "test_tool_with_progress",
      description: "Tests progress-token compatible tool invocation",
      parameters: objectSchema.fields,
      content: (_params, request) =>
        Effect.gen(function*() {
          const token = request._meta?.progressToken ?? "progress-test-1"
          yield* McpServer.sendProgress({
            progress: 0,
            total: 100,
            message: "Completed step 0 of 100"
          })
          yield* McpServer.sendProgress({
            progress: 50,
            total: 100,
            message: "Completed step 50 of 100"
          })
          yield* McpServer.sendProgress({
            progress: 100,
            total: 100,
            message: "Completed step 100 of 100"
          })
          return `Progress test completed: ${String(token)}`
        })
    })

    yield* McpServer.registerTool({
      name: "test_input_required_result_elicitation",
      description: "Tests an ephemeral elicitation input-required flow",
      content: (_params, request) => {
        const name = acceptedString(inputResponsesOf(request), "user_name", "name")
        return name === undefined
          ? inputRequired({ user_name: nameInput() })
          : Effect.succeed(`Hello, ${name}!`)
      }
    })

    yield* McpServer.registerTool({
      name: "test_input_required_result_sampling",
      description: "Tests an ephemeral sampling input-required flow",
      content: (_params, request) => {
        const response = acceptedSamplingText(inputResponsesOf(request), "capital_question")
        return response === undefined
          ? inputRequired({ capital_question: samplingInput("What is the capital of France?", 100) })
          : Effect.succeed(response)
      }
    })

    yield* McpServer.registerTool({
      name: "test_input_required_result_list_roots",
      description: "Tests an ephemeral roots input-required flow",
      content: (_params, request) => {
        const roots = acceptedRoots(inputResponsesOf(request), "client_roots")
        return roots === undefined
          ? inputRequired({ client_roots: rootsInput() })
          : Effect.succeed(`Received ${roots.length} client roots.`)
      }
    })

    yield* McpServer.registerTool({
      name: "test_input_required_result_request_state",
      description: "Tests request state round-tripping for input-required results",
      content: (_params, request) =>
        requestStateOf(request) === "request-state-ok" &&
          acceptedForm(inputResponsesOf(request), "confirm") !== undefined
          ? Effect.succeed("state-ok")
          : inputRequired({ confirm: confirmInput() }, "request-state-ok")
    })

    yield* McpServer.registerTool({
      name: "test_input_required_result_multiple_inputs",
      description: "Tests multiple input-required requests in one round",
      content: (_params, request) => {
        const inputResponses = inputResponsesOf(request)
        const complete = requestStateOf(request) === "multiple-inputs-state" &&
          acceptedString(inputResponses, "user_name", "name") !== undefined &&
          acceptedSamplingText(inputResponses, "greeting") !== undefined &&
          acceptedRoots(inputResponses, "client_roots") !== undefined
        return complete
          ? Effect.succeed("All input responses received.")
          : inputRequired({
              user_name: nameInput(),
              greeting: samplingInput("Generate a greeting", 50),
              client_roots: rootsInput()
            }, "multiple-inputs-state")
      }
    })

    yield* McpServer.registerTool({
      name: "test_input_required_result_multi_round",
      description: "Tests a multi-round input-required flow",
      content: (_params, request) => {
        const inputResponses = inputResponsesOf(request)
        if (requestStateOf(request) === "multi-round-2" &&
          acceptedString(inputResponses, "step2", "color") !== undefined) {
          return Effect.succeed("Multi-round input complete.")
        }
        if (requestStateOf(request) === "multi-round-1" &&
          acceptedString(inputResponses, "step1", "name") !== undefined) {
          return inputRequired({
            step2: elicitationInput(
              "Step 2: What is your favorite color?",
              { color: { type: "string" } },
              ["color"]
            )
          }, "multi-round-2")
        }
        return inputRequired({ step1: nameInput("Step 1: What is your name?") }, "multi-round-1")
      }
    })

    yield* McpServer.registerTool({
      name: "test_input_required_result_tampered_state",
      description: "Tests rejection of tampered input-required state",
      content: (_params, request) => {
        const inputResponses = inputResponsesOf(request)
        if (inputResponses !== undefined || requestStateOf(request) !== undefined) {
          if (requestStateOf(request) !== "tamper-proof-state") {
            return Effect.fail(new McpErrors.InvalidParams({
              message: "Input-required request state failed integrity verification"
            }))
          }
          return acceptedForm(inputResponses, "confirm") === undefined
            ? inputRequired({ confirm: confirmInput() }, "tamper-proof-state")
            : Effect.succeed("State accepted.")
        }
        return inputRequired({ confirm: confirmInput() }, "tamper-proof-state")
      }
    })

    yield* McpServer.registerTool({
      name: "test_input_required_result_capabilities",
      description: "Tests capability-aware input-required requests",
      content: () => Effect.gen(function*() {
        const capabilities = yield* McpServer.clientCapabilities
        const requests: Record<string, typeof McpSchema.InputRequest.Type> = {}
        if (isRecord(capabilities)) {
          if (isRecord(capabilities.sampling)) {
            requests.capital_question = samplingInput("What is the capital of France?", 100)
          }
          if (isRecord(capabilities.elicitation)) {
            requests.user_name = nameInput()
          }
          if (isRecord(capabilities.roots)) {
            requests.client_roots = rootsInput()
          }
        }
        return yield* inputRequired(requests)
      })
    })

    // Removed in MCP 2026-07-28 (stateless draft): test_sampling, test_elicitation,
    // test_elicitation_sep1034_defaults and test_elicitation_sep1330_enums. Their
    // handlers call McpServer.sample / elicit / elicitRaw, which are server-initiated
    // requests. The draft removed server→client requests (replaced by MRTR /
    // InputRequiredResult), so these now fail with InternalError. See
    // docs/draft-2026-07-28-migration.md.

    yield* McpServer.registerTool({
      name: "json_schema_2020_12_tool",
      description: "Tool with JSON Schema 2020-12 features",
      parameterSchema: jsonSchema202012Parameters,
      content: () => Effect.succeed("JSON Schema 2020-12 tool response.")
    })

    yield* McpServer.registerResource({
      uri: "test://static-text",
      name: "Static text",
      description: "Static text resource for conformance testing",
      mimeType: "text/plain",
      content: Effect.succeed({
        contents: [{
          uri: "test://static-text",
          mimeType: "text/plain",
          text: "This is the content of the static text resource."
        }]
      })
    })

    yield* McpServer.registerResource({
      uri: "test://static-binary",
      name: "Static binary",
      description: "Static binary resource for conformance testing",
      mimeType: "image/png",
      content: Effect.succeed({
        contents: [{
          uri: "test://static-binary",
          mimeType: "image/png",
          blob: binary(testImageBase64)
        }]
      })
    })

    const idParam = McpServer.param("id", Schema.String)
    yield* McpServer.registerResource`test://template/${idParam}/data`({
      name: "Template resource",
      description: "Template resource for conformance testing",
      mimeType: "application/json",
      completion: {
        id: () => Effect.succeed(["template-1", "template-2"])
      },
      content: (uri, id) =>
        Effect.succeed({
          contents: [{
            uri,
            mimeType: "application/json",
            text: JSON.stringify({
              id,
              templateTest: true,
              data: `Data for ID: ${id}`
            })
          }]
        })
    })

    yield* McpServer.registerPrompt({
      name: "test_simple_prompt",
      description: "Simple prompt for conformance testing",
      content: () => Effect.succeed("This is a simple prompt for testing.")
    })

    yield* McpServer.registerPrompt({
      name: "test_prompt_with_arguments",
      description: "Prompt with arguments for conformance testing",
      parameters: {
        arg1: Schema.String,
        arg2: Schema.String
      },
      content: (params) =>
        Effect.succeed(`Prompt with arguments: arg1='${params.arg1}', arg2='${params.arg2}'`)
    })

    yield* McpServer.registerPrompt({
      name: "test_prompt_with_embedded_resource",
      description: "Prompt with embedded resource content",
      parameters: {
        resourceUri: Schema.optional(Schema.String)
      },
      content: (params) =>
        Effect.succeed([
          promptMessage(embeddedResource(params.resourceUri ?? "test://static-text")),
          promptMessage(text("Please process the embedded resource above."))
        ])
    })

    yield* McpServer.registerPrompt({
      name: "test_prompt_with_image",
      description: "Prompt with image content",
      content: () =>
        Effect.succeed([
          promptMessage(image()),
          promptMessage(text("Please analyze the image above."))
        ])
    })

    yield* McpServer.registerPrompt({
      name: "test_input_required_result_prompt",
      description: "Tests a prompt that requires elicited input",
      content: () => Effect.gen(function*() {
        const context = yield* McpServer.McpRequestContext
        const params = isRecord(context.request.params) ? context.request.params : {}
        const promptContext = acceptedString(params.inputResponses, "user_context", "context")
        return promptContext === undefined
          ? yield* inputRequired({
              user_context: elicitationInput(
                "What context should the prompt use?",
                { context: { type: "string" } },
                ["context"]
              )
            })
          : `Prompt context: ${promptContext}`
      })
    })
})

const { dispose, handler } = StreamableHttpServerTransport.toWebHandler(
  Effect.runSync(McpServer.make({
    serverInfo: {
      name: "mcp-effect-sdk-everything-server",
      version: "1.0.0"
    },
    handlers: everythingHandlers,
    instructions: "Everything example server for the MCP 2026-07-28 stateless draft.",
    supportedProtocolVersions: [McpProtocol.LATEST_PROTOCOL_VERSION]
  })),
  {
    path: endpoint,
    enableJsonResponse: true,
    allowedOrigins: [
      `http://127.0.0.1:${port}`,
      `http://localhost:${port}`,
      `http://[::1]:${port}`
    ]
  }
)

const server = createServer((request, response) => {
  void handleRequest(request, response).catch((error: unknown) => {
    if (response.headersSent || response.writableEnded) {
      response.destroy(error instanceof Error ? error : new Error(String(error)))
      return
    }
    writeText(response, 500, `Internal server error: ${String(error)}`)
  })
})

server.listen(port, host, () => {
  const address = server.address()
  const resolvedPort = typeof address === "object" && address ? address.port : port
  console.log(`mcp-effect-sdk everything server running on http://${host}:${resolvedPort}${endpoint}`)
})

process.once("SIGTERM", () => {
  dispose()
  server.close(() => process.exit(0))
})

process.once("SIGINT", () => {
  dispose()
  server.close(() => process.exit(0))
})

async function handleRequest(request: IncomingMessage, response: ServerResponse): Promise<void> {
  if (hasInvalidLocalhostHeaders(request)) {
    writeText(response, 403, "Forbidden Host or Origin header")
    return
  }

  const webRequest = await toWebRequest(request)
  const webResponse = await handler(webRequest)
  await writeWebResponse(response, webResponse)
}

async function writeWebResponse(response: ServerResponse, webResponse: Response): Promise<void> {
  response.writeHead(
    webResponse.status,
    webResponse.statusText,
    Object.fromEntries(webResponse.headers.entries())
  )
  if (!webResponse.body) {
    response.end()
    return
  }

  const reader = webResponse.body.getReader()
  try {
    while (!response.writableEnded) {
      const { done, value } = await reader.read()
      if (done) {
        break
      }
      await writeChunk(response, value)
    }
  } finally {
    reader.releaseLock()
  }
  if (!response.writableEnded) {
    response.end()
  }
}

function writeChunk(response: ServerResponse, chunk: Uint8Array): Promise<void> {
  return new Promise((resolve, reject) => {
    const written = response.write(Buffer.from(chunk), (error) => {
      if (error) {
        reject(error)
      } else {
        resolve()
      }
    })
    if (!written) {
      response.once("drain", resolve)
    }
  })
}

async function toWebRequest(request: IncomingMessage): Promise<Request> {
  const url = `http://${request.headers.host ?? `${host}:${port}`}${request.url ?? "/"}`
  const body = request.method === "GET" || request.method === "HEAD"
    ? undefined
    : await readBody(request)
  return new Request(url, {
    method: request.method,
    headers: request.headers as HeadersInit,
    body: body ? new Uint8Array(body) : undefined
  })
}

function hasInvalidLocalhostHeaders(request: IncomingMessage): boolean {
  const hostHeader = getHeader(request, "host")
  if (!hostHeader || !isAllowedHost(hostHeader)) {
    return true
  }

  const originHeader = getHeader(request, "origin")
  if (!originHeader) {
    return false
  }
  try {
    return !isAllowedHost(new URL(originHeader).host)
  } catch {
    return true
  }
}

function isAllowedHost(value: string): boolean {
  const allowed = new Set([
    `${host}:${port}`,
    `127.0.0.1:${port}`,
    `localhost:${port}`,
    `[::1]:${port}`
  ])
  return allowed.has(value.toLowerCase())
}

function getHeader(request: IncomingMessage, name: string): string | undefined {
  const value = request.headers[name]
  return Array.isArray(value) ? value[0] : value
}

function readBody(request: IncomingMessage): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Array<Buffer> = []
    request.on("data", (chunk: Buffer | string) => {
      chunks.push(typeof chunk === "string" ? Buffer.from(chunk) : chunk)
    })
    request.on("end", () => resolve(Buffer.concat(chunks)))
    request.on("error", reject)
  })
}

function writeText(response: ServerResponse, status: number, body: string): void {
  response.writeHead(status, { "Content-Type": "text/plain" })
  response.end(body)
}
