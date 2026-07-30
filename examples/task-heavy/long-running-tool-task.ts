import * as Effect from "effect/Effect"
import * as Schema from "effect/Schema"
import * as Tasks from "mcp-effect-sdk/experimental/tasks"
import { task, toolResult } from "./helpers.js"

export const longRunningToolTask = Effect.fn("example.tasks.long-running")(function* () {
  yield* Effect.sleep(25)
  return Schema.decodeUnknownSync(Tasks.DetailedTask)({
    ...task("quarterly-report", "completed"),
    status: "completed",
    result: {
      reportId: "quarterly",
      format: "markdown"
    }
  })
})

export const startLongRunningReport = longRunningToolTask().pipe(
  Effect.map((completed) =>
    toolResult("Report completed.", {
      taskId: completed.taskId,
      status: completed.status
    })
  )
)
