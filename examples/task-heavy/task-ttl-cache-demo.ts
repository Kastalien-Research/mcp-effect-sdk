import * as Effect from "effect/Effect"
import * as Schema from "effect/Schema"
import * as Tasks from "mcp-effect-sdk/experimental/tasks"
import { task, toolResult } from "./helpers.js"

export const taskTtlCacheDemo = Effect.fn("example.tasks.ttl")(function* () {
  const shortLived = yield* Schema.decodeUnknownEffect(Tasks.Task)(
    task("ttl-demo", "working", {
      ttlMs: 10,
      pollIntervalMs: 25
    })
  )

  return toolResult("Task TTL fields validated.", {
    ttlMs: shortLived.ttlMs,
    pollIntervalMs: shortLived.pollIntervalMs
  })
})
