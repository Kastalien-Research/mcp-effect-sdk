import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"
import * as McpServer from "../../dist/McpServer.js"
import * as StdioServerTransport from "../../dist/transport/StdioServerTransport.js"

const app = McpServer.tool({
  name: "stdio-tool",
  content: () => Effect.succeed("stdio")
})

const server = app.pipe(Layer.provide(StdioServerTransport.layer({
  name: "stdio-review",
  version: "1.0.0"
})))

await Effect.runPromise(Layer.launch(server))
