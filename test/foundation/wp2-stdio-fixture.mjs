import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"
import * as McpServer from "../../dist/McpServer.js"
import * as StdioServerTransport from "../../dist/transport/StdioServerTransport.js"

const app = Layer.mergeAll(
  McpServer.tool({
    name: "emit-list-change",
    content: () => McpServer.sendToolListChanged.pipe(Effect.as("emitted"))
  }),
  McpServer.tool({
    name: "stdio-tool",
    content: () => Effect.succeed("stdio")
  })
)

const server = Layer.mergeAll(
  app,
  StdioServerTransport.layer()
).pipe(Layer.provide(McpServer.layer({
  serverInfo: { name: "stdio-review", version: "1.0.0" },
  handlers: Effect.void
})))

await Effect.runPromise(Layer.launch(server))
