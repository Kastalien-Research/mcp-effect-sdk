import { Effect, Layer } from "effect"
import * as StdioServerTransport from "../../../dist/transport/StdioServerTransport.js"

await Effect.runPromise(Effect.scoped(Effect.gen(function*() {
  yield* StdioServerTransport.layer({
    name: "stdio-diagnostic-fixture",
    version: "1.0.0"
  }).pipe(Layer.build)
  process.stderr.write("ready\n")
  yield* Effect.sleep("500 millis")
})))
