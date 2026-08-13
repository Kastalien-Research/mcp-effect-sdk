import { Buffer } from "node:buffer"
import { createServer, type IncomingMessage, type ServerResponse } from "node:http"
import * as NodeRuntime from "@effect/platform-node/NodeRuntime"
import * as Effect from "effect/Effect"
import * as Runtime from "effect/Runtime"
import { Server as LegacyHttp } from "mcp-effect-sdk/legacy/transport/http"
import type { LegacyRequestHandler, LegacyServer } from "mcp-effect-sdk/legacy/server"
import { McpSchema } from "mcp-effect-sdk/protocol/2025-11-25"

const host = process.env.HOST ?? "127.0.0.1"
const port = Number(process.env.PORT ?? "3000")
const path = "/mcp"
const image = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFBQIAX8jx0gAAAABJRU5ErkJggg=="
const audio = "UklGRiYAAABXQVZFZm10IBAAAAABAAEAQB8AAAB9AAACABAAZGF0YQIAAAA="
const imageBytes = new Uint8Array(Buffer.from(image, "base64"))
const audioBytes = new Uint8Array(Buffer.from(audio, "base64"))

const tools = [
  { name: "test_simple_text", description: "Returns text", inputSchema: { type: "object", properties: {} } },
  { name: "test_image_content", description: "Returns an image", inputSchema: { type: "object", properties: {} } },
  { name: "test_audio_content", description: "Returns audio", inputSchema: { type: "object", properties: {} } },
  {
    name: "test_embedded_resource",
    description: "Returns an embedded resource",
    inputSchema: { type: "object", properties: {} }
  },
  {
    name: "test_multiple_content_types",
    description: "Returns mixed content",
    inputSchema: { type: "object", properties: {} }
  },
  { name: "test_error_response", description: "Returns a tool error", inputSchema: { type: "object", properties: {} } },
  {
    name: "test_error_handling",
    description: "Raises a protocol error",
    inputSchema: { type: "object", properties: {} }
  },
  {
    name: "test_tool_with_logging",
    description: "Emits log messages",
    inputSchema: { type: "object", properties: {} }
  },
  { name: "test_logging_tool", description: "Emits log messages", inputSchema: { type: "object", properties: {} } },
  { name: "test_tool_with_progress", description: "Emits progress", inputSchema: { type: "object", properties: {} } },
  { name: "test_sampling", description: "Requests sampling", inputSchema: { type: "object", properties: {} } },
  {
    name: "test_tool_with_sampling",
    description: "Requests sampling",
    inputSchema: { type: "object", properties: {} }
  },
  { name: "test_elicitation", description: "Requests elicitation", inputSchema: { type: "object", properties: {} } },
  {
    name: "test_tool_with_elicitation",
    description: "Requests elicitation",
    inputSchema: { type: "object", properties: {} }
  },
  {
    name: "json_schema_2020_12_tool",
    description: "Exercises JSON Schema 2020-12",
    inputSchema: {
      $schema: "https://json-schema.org/draft/2020-12/schema",
      $defs: { address: { type: "object", $anchor: "address", properties: { street: { type: "string" } } } },
      type: "object",
      properties: { value: { type: "string" } },
      required: ["value"],
      additionalProperties: false
    }
  },
  {
    name: "test_elicitation_sep1034_defaults",
    description: "Tests elicitation defaults",
    inputSchema: { type: "object", properties: {} }
  },
  {
    name: "test_elicitation_sep1330_enums",
    description: "Tests elicitation enums",
    inputSchema: { type: "object", properties: {} }
  }
]

const main = Effect.scoped(
  Effect.gen(function* () {
    let legacyServer: LegacyServer | undefined
    const http = yield* LegacyHttp.make({
      path,
      serverInfo: new McpSchema.Implementation({ name: "mcp-effect-sdk-everything-2025", version: "1.0.0" }),
      capabilities: {
        logging: {},
        completions: {},
        tools: { listChanged: true },
        resources: { subscribe: true, listChanged: true },
        prompts: { listChanged: true },
        tasks: { list: {}, cancel: {}, requests: { tools: { call: {} } } }
      },
      allowedHosts: [`${host}:${port}`, `127.0.0.1:${port}`, `localhost:${port}`, `[::1]:${port}`],
      onSession: (server) =>
        Effect.sync(() => {
          legacyServer = server
        }),
      onMessage:
        process.env.MCP_LEGACY_DEBUG === "1"
          ? (direction, message) => Effect.sync(() => console.error(direction, message))
          : undefined,
      requestHandlers: {
        "logging/setLevel": () => Effect.succeed({}),
        "completion/complete": () => Effect.succeed({ completion: { values: ["completion-one", "completion-two"] } }),
        "tools/list": () => Effect.succeed({ tools }),
        "tools/call": (input: Parameters<LegacyRequestHandler>[0]) => {
          const params = input as {
            readonly name: string
            readonly _meta?: { readonly progressToken?: string | number }
          }
          const text = (value: string) => ({ type: "text", text: value })
          switch (params.name) {
            case "test_image_content":
              return Effect.succeed({ content: [{ type: "image", data: imageBytes, mimeType: "image/png" }] })
            case "test_audio_content":
              return Effect.succeed({ content: [{ type: "audio", data: audioBytes, mimeType: "audio/wav" }] })
            case "test_embedded_resource":
              return Effect.succeed({
                content: [
                  { type: "resource", resource: { uri: "test://embedded", text: "embedded", mimeType: "text/plain" } }
                ]
              })
            case "test_multiple_content_types":
              return Effect.succeed({
                content: [
                  text("text"),
                  { type: "image", data: imageBytes, mimeType: "image/png" },
                  { type: "audio", data: audioBytes, mimeType: "audio/wav" },
                  {
                    type: "resource",
                    resource: { uri: "test://mixed", text: "mixed resource", mimeType: "text/plain" }
                  }
                ]
              })
            case "test_error_response":
              return Effect.succeed({ isError: true, content: [text("intentional error")] })
            case "test_error_handling":
              return Effect.succeed({ isError: true, content: [text("intentional protocol error")] })
            case "test_tool_with_logging":
            case "test_logging_tool":
              return legacyServer === undefined
                ? Effect.succeed({ content: [text("logged")] })
                : Effect.forEach(
                    ["tool started", "tool working", "tool finished"],
                    (data) => legacyServer!.notify("notifications/message", { level: "info", data }),
                    { discard: true }
                  ).pipe(Effect.as({ content: [text("logged")] }))
            case "test_tool_with_progress":
              return legacyServer === undefined || params._meta?.progressToken === undefined
                ? Effect.succeed({ content: [text("progress complete")] })
                : Effect.forEach(
                    [0, 0.5, 1],
                    (progress) =>
                      legacyServer!.notify("notifications/progress", {
                        progressToken: params._meta!.progressToken!,
                        progress,
                        total: 1
                      }),
                    { discard: true }
                  ).pipe(
                    Effect.zipRight(Effect.sleep("25 millis")),
                    Effect.as({ content: [text("progress complete")] })
                  )
            case "test_sampling":
            case "test_tool_with_sampling":
              return legacyServer === undefined
                ? Effect.fail(new Error("server unavailable") as never)
                : legacyServer
                    .request("sampling/createMessage", {
                      messages: [{ role: "user", content: { type: "text", text: "Say hello" } }],
                      maxTokens: 32
                    })
                    .pipe(Effect.map((result) => ({ content: [text(JSON.stringify(result))] })))
            case "test_elicitation":
            case "test_tool_with_elicitation":
              return legacyServer === undefined
                ? Effect.fail(new Error("server unavailable") as never)
                : legacyServer
                    .request("elicitation/create", {
                      mode: "form",
                      message: "Provide a value",
                      requestedSchema: { type: "object", properties: { value: { type: "string", default: "default" } } }
                    })
                    .pipe(Effect.map((result) => ({ content: [text(JSON.stringify(result))] })))
            case "test_elicitation_sep1034_defaults":
              return legacyServer === undefined
                ? Effect.fail(new Error("server unavailable") as never)
                : legacyServer
                    .request("elicitation/create", {
                      mode: "form",
                      message: "Test defaults",
                      requestedSchema: {
                        type: "object",
                        properties: {
                          name: { type: "string", default: "John Doe" },
                          age: { type: "integer", default: 30 },
                          score: { type: "number", default: 95.5 },
                          status: { type: "string", enum: ["active", "inactive"], default: "active" },
                          verified: { type: "boolean", default: true }
                        }
                      }
                    })
                    .pipe(Effect.map((result) => ({ content: [text(JSON.stringify(result))] })))
            case "test_elicitation_sep1330_enums":
              return legacyServer === undefined
                ? Effect.fail(new Error("server unavailable") as never)
                : legacyServer
                    .request("elicitation/create", {
                      mode: "form",
                      message: "Test enums",
                      requestedSchema: {
                        type: "object",
                        properties: {
                          untitledSingle: { type: "string", enum: ["option1", "option2"] },
                          titledSingle: {
                            type: "string",
                            oneOf: [
                              { const: "value1", title: "Value 1" },
                              { const: "value2", title: "Value 2" }
                            ]
                          },
                          legacyEnum: { type: "string", enum: ["opt1", "opt2"], enumNames: ["Option 1", "Option 2"] },
                          untitledMulti: { type: "array", items: { type: "string", enum: ["option1", "option2"] } },
                          titledMulti: {
                            type: "array",
                            items: {
                              anyOf: [
                                { const: "value1", title: "Value 1" },
                                { const: "value2", title: "Value 2" }
                              ]
                            }
                          }
                        }
                      }
                    })
                    .pipe(Effect.map((result) => ({ content: [text(JSON.stringify(result))] })))
            default:
              return Effect.succeed({ content: [text("Hello from MCP 2025-11-25")] })
          }
        },
        "resources/list": () =>
          Effect.succeed({
            resources: [
              { uri: "test://static-text", name: "Static text", mimeType: "text/plain" },
              { uri: "test://static-binary", name: "Static binary", mimeType: "application/octet-stream" }
            ]
          }),
        "resources/templates/list": () =>
          Effect.succeed({
            resourceTemplates: [{ uriTemplate: "test://template/{id}/data", name: "Template resource" }]
          }),
        "resources/read": (input: Parameters<LegacyRequestHandler>[0]) => {
          const uri = (input as { readonly uri: string }).uri
          return Effect.succeed({
            contents:
              uri === "test://static-binary"
                ? [{ uri, blob: new Uint8Array(Buffer.from("binary")), mimeType: "application/octet-stream" }]
                : [{ uri, text: `Content for ${uri}`, mimeType: "text/plain" }]
          })
        },
        "resources/subscribe": () => Effect.succeed({}),
        "resources/unsubscribe": () => Effect.succeed({}),
        "prompts/list": () =>
          Effect.succeed({
            prompts: [
              { name: "test_simple_prompt", description: "Simple prompt" },
              {
                name: "test_prompt_with_arguments",
                description: "Prompt with arguments",
                arguments: [
                  { name: "arg1", required: true },
                  { name: "arg2", required: true }
                ]
              },
              { name: "test_prompt_with_embedded_resource", description: "Prompt with embedded resource" },
              { name: "test_prompt_with_image", description: "Prompt with image" }
            ]
          }),
        "prompts/get": (input: Parameters<LegacyRequestHandler>[0]) => {
          const params = input as { readonly name: string; readonly arguments?: Record<string, string> }
          if (params.name === "test_prompt_with_embedded_resource")
            return Effect.succeed({
              messages: [
                {
                  role: "user",
                  content: { type: "resource", resource: { uri: "test://prompt", text: "prompt resource" } }
                }
              ]
            })
          if (params.name === "test_prompt_with_image")
            return Effect.succeed({
              messages: [{ role: "user", content: { type: "image", data: imageBytes, mimeType: "image/png" } }]
            })
          return Effect.succeed({
            description: "Test prompt",
            messages: [
              {
                role: "user",
                content: {
                  type: "text",
                  text: [params.arguments?.arg1, params.arguments?.arg2].filter(Boolean).join(" ") || "simple prompt"
                }
              }
            ]
          })
        }
      },
      notificationHandlers: {}
    })
    // Each HTTP session owns its own LegacyServer. The conformance fixture uses
    // one session, whose handle enables server-initiated sampling/elicitation.
    const runtime = yield* Effect.runtime<never>()
    const server = createServer((request, response) => {
      void handle(request, response, (webRequest) => Runtime.runPromise(runtime)(http.handle(webRequest))).catch(
        (cause) => {
          if (!response.headersSent) response.writeHead(500)
          response.end(String(cause))
        }
      )
    })
    yield* Effect.acquireRelease(
      Effect.async<void, Error>((resume) => {
        server.once("error", (cause) => resume(Effect.fail(cause)))
        server.listen(port, host, () => {
          console.log(`MCP 2025-11-25 Everything server listening at http://${host}:${port}${path}`)
          resume(Effect.void)
        })
      }),
      () =>
        Effect.async<void>((resume) => {
          server.close(() => resume(Effect.void))
        })
    )
    yield* Effect.never
  })
)

NodeRuntime.runMain(main)

async function handle(
  request: IncomingMessage,
  response: ServerResponse,
  route: (request: Request) => Promise<Response>
) {
  const chunks: Buffer[] = []
  for await (const chunk of request) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk))
  const web = new Request(`http://${request.headers.host ?? `${host}:${port}`}${request.url ?? path}`, {
    method: request.method,
    headers: request.headers as HeadersInit,
    body: request.method === "GET" || request.method === "HEAD" ? undefined : Buffer.concat(chunks)
  })
  const result = await route(web)
  response.writeHead(result.status, Object.fromEntries(result.headers.entries()))
  if (result.body === null) return response.end()
  const reader = result.body.getReader()
  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    response.write(Buffer.from(value))
  }
  response.end()
}
