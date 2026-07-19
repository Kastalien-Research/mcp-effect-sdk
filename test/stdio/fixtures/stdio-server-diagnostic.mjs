import { Effect, Layer } from "effect"
import * as McpServer from "../../../dist/McpServer.js"
import * as StdioServerTransport from "../../../dist/transport/StdioServerTransport.js"

await Effect.runPromise(Effect.scoped(Effect.gen(function*() {
  yield* StdioServerTransport.layer().pipe(
    Layer.provide(McpServer.layer({
      serverInfo: { name: "stdio-diagnostic-fixture", version: "1.0.0" },
      handlers: Effect.void
    })),
    Layer.build
  )
  process.stderr.write("ready\n")
  yield* Effect.sleep("500 millis")
})))
