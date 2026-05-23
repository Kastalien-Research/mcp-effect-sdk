import * as Effect from "effect/Effect"
import * as McpServer from "../../McpServer.js"
import { toolResult } from "./helpers.js"

export const TaskWithProgress = McpServer.tool({
  name: "task_with_progress",
  description: "Reports progress with one progress token for the task lifetime.",
  taskSupport: "optional",
  content: (_params, request) =>
    Effect.gen(function*() {
      const progressToken = request._meta?.progressToken ?? "task-with-progress"
      yield* McpServer.sendProgress({
        progressToken,
        progress: 0,
        total: 3,
        message: "Queued"
      })
      yield* Effect.sleep(5)
      yield* McpServer.sendProgress({
        progressToken,
        progress: 2,
        total: 3,
        message: "Processing"
      })
      yield* Effect.sleep(5)
      yield* McpServer.sendProgress({
        progressToken,
        progress: 3,
        total: 3,
        message: "Finalizing"
      })
      return toolResult("Progress task completed.", { progressToken })
    })
})
