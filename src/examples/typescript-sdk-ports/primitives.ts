/**
 * Effect-native ports of the official SDK's tools, prompts, resources, and
 * schema-validator stories. The transport is intentionally supplied by the
 * caller so the same registration layer can run over stdio or HTTP.
 */
import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"
import * as Ref from "effect/Ref"
import * as Schema from "effect/Schema"
import type * as McpClient from "../../McpClient.js"
import * as McpSchema from "../../McpSchema.js"
import * as McpServer from "../../McpServer.js"
import { assert, firstText, promptMessage, text } from "./shared.js"

const operation = Schema.Literals(["add", "sub", "mul"])

export const toolsServer = Layer.effectDiscard(
  Effect.gen(function*() {
    yield* McpServer.registerTool({
      name: "calc",
      description: "Apply an arithmetic operation to two numbers.",
      parameters: {
        op: operation,
        a: Schema.Number,
        b: Schema.Number
      },
      content: ({ op, a, b }) => {
        const result = op === "add" ? a + b : op === "sub" ? a - b : a * b
        return Effect.succeed(new McpSchema.CallToolResult({
          content: [text(`${a} ${op} ${b} = ${result}`)],
          structuredContent: { op, result }
        }))
      }
    })
    yield* McpServer.registerTool({
      name: "echo",
      description: "Echoes the input.",
      parameters: { text: Schema.String },
      content: ({ text }) => Effect.succeed(text)
    })
  })
)

export const runToolsClient = (
  client: McpClient.McpClient
): Effect.Effect<void, unknown> =>
  Effect.gen(function*() {
    const listed = yield* client.listTools()
    assert(listed.tools.some((tool) => tool.name === "calc"), "calc is listed")
    assert(listed.tools.some((tool) => tool.name === "echo"), "echo is listed")
    const result = yield* client.callTool({
      name: "calc",
      arguments: { op: "add", a: 2, b: 3 }
    })
    assert(firstText(result) === "2 add 3 = 5", "calc returns the expected text")
    const structured = result.structuredContent as Record<string, unknown> | undefined
    assert(structured?.result === 5, "calc returns structured output")
  })

const languages = ["python", "typescript", "rust", "go"]

export const promptsServer = McpServer.prompt({
    name: "review-code",
    description: "Review code for quality and idioms.",
    parameters: {
      language: Schema.String,
      code: Schema.String
    },
    completion: {
      language: (value) =>
        Effect.succeed(languages.filter((language) => language.startsWith(value)))
    },
    content: ({ language, code }) =>
      Effect.succeed([
        promptMessage(`Review this ${language} code for quality and idioms:\n\n${code}`)
      ])
  })

export const runPromptsClient = (
  client: McpClient.McpClient
): Effect.Effect<void, unknown> =>
  Effect.gen(function*() {
    const listed = yield* client.listPrompts()
    assert(listed.prompts.some((prompt) => prompt.name === "review-code"), "review-code is listed")
    const completion = yield* client.complete({
      ref: { type: "ref/prompt", name: "review-code" },
      argument: { name: "language", value: "ru" }
    })
    assert(completion.completion.values.includes("rust"), "prompt completion suggests rust")
    const result = yield* client.getPrompt({
      name: "review-code",
      arguments: { language: "rust", code: "fn main() {}" }
    })
    assert(result.messages.length === 1, "review-code returns one message")
  })

const counterUri = "counter://value"

export const resourcesServer = Layer.effectDiscard(
  Effect.gen(function*() {
    const counter = yield* Ref.make(0)
    yield* McpServer.registerResource({
      uri: "config://app",
      name: "app-config",
      description: "Static application config.",
      mimeType: "application/json",
      content: Effect.succeed('{"feature":true}')
    })
    yield* McpServer.registerResource`greeting://${McpSchema.param("name", Schema.String)}`({
      name: "greeting",
      description: "A greeting for the named subject.",
      completion: {
        name: (value) => Effect.succeed(["world", "Effect"].filter((name) => name.startsWith(value)))
      },
      content: (_uri, name) => Effect.succeed(`Hello, ${name}!`)
    })
    yield* McpServer.registerResource({
      uri: counterUri,
      name: "counter",
      description: "A number the increment tool bumps.",
      mimeType: "text/plain",
      content: Ref.get(counter).pipe(Effect.map(String))
    })
    yield* McpServer.registerTool({
      name: "increment",
      description: `Bump ${counterUri} by one.`,
      content: () =>
        Effect.gen(function*() {
          const value = yield* Ref.updateAndGet(counter, (current) => current + 1)
          yield* McpServer.sendResourceUpdated({ uri: counterUri })
          return String(value)
        })
    })
  })
)

export const runResourcesClient = (
  client: McpClient.McpClient
): Effect.Effect<void, unknown> =>
  Effect.gen(function*() {
    const listed = yield* client.listResources()
    assert(listed.resources.some((resource) => resource.uri === "config://app"), "config resource is listed")
    const templates = yield* client.listResourceTemplates()
    assert(templates.resourceTemplates.some((resource) => resource.uriTemplate === "greeting://{name}"), "greeting template is listed")
    const greeting = yield* client.readResource({ uri: "greeting://world" })
    assert(greeting.contents.length === 1, "templated greeting can be read")
    yield* client.subscriptionsListen({ resourceSubscriptions: [counterUri] })
    yield* client.callTool({ name: "increment", arguments: {} })
    const counter = yield* client.readResource({ uri: counterUri })
    assert(counter.contents.length === 1, "mutable counter can be read")
  })

export const schemaValidatorsServer = Layer.effectDiscard(
  Effect.gen(function*() {
    for (const name of ["effect-schema-greet", "effect-schema-weather"]) {
      yield* McpServer.registerTool({
        name,
        description: "Demonstrates the SDK's Effect Schema validator boundary.",
        parameters: { name: Schema.String },
        content: ({ name }) => Effect.succeed(`Hello, ${name}!`)
      })
    }
  })
)
