/** Modern interaction ports: parallel calls, notifications, and mutable state. */
import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"
import * as Ref from "effect/Ref"
import * as Schema from "effect/Schema"
import type * as McpClient from "../../McpClient.js"
import * as McpSchema from "../../McpSchema.js"
import * as McpServer from "../../McpServer.js"
import { assert, firstText, text } from "./shared.js"

export const parallelCallsServer = Layer.effectDiscard(
  McpServer.registerTool({
    name: "delay",
    description: "Wait for the requested duration and return its label.",
    parameters: {
      label: Schema.String,
      delayMs: Schema.Number
    },
    content: ({ label, delayMs }) =>
      Effect.sleep(delayMs).pipe(Effect.as(label))
  })
)

export const runParallelCallsClient = (
  client: McpClient.McpClient
): Effect.Effect<void, unknown> =>
  Effect.gen(function*() {
    const results = yield* Effect.all(
      [
        client.callTool({ name: "delay", arguments: { label: "one", delayMs: 10 } }),
        client.callTool({ name: "delay", arguments: { label: "two", delayMs: 5 } }),
        client.callTool({ name: "delay", arguments: { label: "three", delayMs: 1 } })
      ],
      { concurrency: "unbounded" }
    )
    assert(results.map(firstText).join(",") === "one,two,three", "parallel calls preserve result order")
  })

export const streamingServer = Layer.effectDiscard(
  McpServer.registerTool({
    name: "countdown",
    description: "Counts down while emitting progress and logging notifications.",
    parameters: {
      n: Schema.Number,
      delayMs: Schema.optionalKey(Schema.Number)
    },
    content: ({ n, delayMs = 5 }, request) =>
      Effect.gen(function*() {
        const progressToken = request._meta?.progressToken
        for (let completed = 1; completed <= n; completed++) {
          yield* Effect.sleep(delayMs)
          yield* McpServer.sendLoggingMessage({
            level: "info",
            logger: "streaming-example",
            data: { completed, total: n }
          })
          if (progressToken !== undefined) {
            yield* McpServer.sendProgress({
              progressToken,
              progress: completed,
              total: n,
              message: `step ${completed}/${n}`
            })
          }
        }
        return new McpSchema.CallToolResult({
          content: [text(`completed ${n} steps`)],
          structuredContent: { completed: n, total: n, cancelled: false }
        })
      })
  })
)

export const subscriptionsServer = Layer.effectDiscard(
  Effect.gen(function*() {
    yield* McpServer.registerTool({
      name: "greet",
      description: "Returns a greeting.",
      parameters: { name: Schema.String },
      content: ({ name }) => Effect.succeed(`Hello, ${name}!`)
    })
    yield* McpServer.registerTool({
      name: "flip_tools",
      description: "Publishes a tools/list_changed event.",
      content: () =>
        McpServer.sendToolListChanged.pipe(
          Effect.as("tools/list_changed published")
        )
    })
  })
)

export const runSubscriptionsClient = (
  client: McpClient.McpClient
): Effect.Effect<void, unknown> =>
  Effect.gen(function*() {
    yield* client.subscriptionsListen({ toolsListChanged: true })
    const result = yield* client.callTool({ name: "flip_tools", arguments: {} })
    assert(firstText(result) === "tools/list_changed published", "subscription trigger tool succeeds")
  })

export const stickyNotesServer = Layer.effectDiscard(
  Effect.gen(function*() {
    const notes = yield* Ref.make(new Map<string, string>())
    const nextId = yield* Ref.make(1)

    yield* McpServer.registerResource`note://${McpSchema.param("id", Schema.String)}`({
      name: "sticky-note",
      description: "Read one sticky note by id.",
      content: (uri, id) =>
        Ref.get(notes).pipe(
          Effect.map((current) => ({
            contents: [{
              uri,
              mimeType: "text/plain",
              text: current.get(id) ?? `Unknown note: ${id}`
            }]
          }))
        )
    })
    yield* McpServer.registerTool({
      name: "add_note",
      description: "Add a sticky note.",
      parameters: { text: Schema.String },
      content: ({ text: body }) =>
        Effect.gen(function*() {
          const id = String(yield* Ref.getAndUpdate(nextId, (value) => value + 1))
          yield* Ref.update(notes, (current) => {
            const updated = new Map(current)
            updated.set(id, body)
            return updated
          })
          yield* McpServer.sendResourceListChanged
          return new McpSchema.CallToolResult({
            content: [text(`Added note ${id}`)],
            structuredContent: { id, uri: `note://${id}` }
          })
        })
    })
    yield* McpServer.registerTool({
      name: "remove_note",
      description: "Remove one sticky note.",
      parameters: { id: Schema.String },
      content: ({ id }) =>
        Effect.gen(function*() {
          const existed = yield* Ref.modify(notes, (current) => {
            const updated = new Map(current)
            const found = updated.delete(id)
            return [found, updated] as const
          })
          yield* McpServer.sendResourceListChanged
          return existed ? `Removed note ${id}` : `Unknown note ${id}`
        })
    })
  })
)
