import assert from "node:assert/strict"
import { Effect, Queue, Schema } from "effect"
import {
  ElicitationHandler,
  McpSchema,
  McpServer,
  RootsProvider,
  SamplingHandler
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
      ["echo"]
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
