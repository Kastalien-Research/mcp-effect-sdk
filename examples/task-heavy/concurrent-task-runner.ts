import * as Effect from "effect/Effect"
import * as Schema from "effect/Schema"
import * as Tasks from "mcp-effect-sdk/experimental/tasks"
import { task, toolResult } from "./helpers.js"

const runJob = (id: string) =>
  Effect.sleep(10).pipe(
    Effect.as(
      Schema.decodeUnknownSync(Tasks.DetailedTask)({
        ...task(id, "completed"),
        status: "completed",
        result: { message: `Job ${id} completed.` }
      })
    )
  )

export const concurrentTaskRunner = Effect.fn("example.tasks.concurrent")(function* () {
  const completed = yield* Effect.all(["one", "two", "three"].map(runJob), {
    concurrency: 2
  })
  return toolResult("Concurrent task extension example completed.", {
    taskCount: completed.length,
    statuses: completed.map((entry: Tasks.DetailedTask) => entry.status)
  })
})
