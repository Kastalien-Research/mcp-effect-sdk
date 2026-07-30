import * as Effect from "effect/Effect"
import * as Schema from "effect/Schema"
import * as Tasks from "mcp-effect-sdk/experimental/tasks"
import { task, toolResult } from "./helpers.js"

export const taskWithProgress = Effect.fn("example.tasks.status-notifications")(function* () {
  const notifications = yield* Effect.forEach(["Queued", "Processing", "Finalizing"], (statusMessage, index) =>
    Schema.decodeUnknown(Tasks.TaskStatusNotification)({
      jsonrpc: "2.0",
      method: "notifications/tasks",
      params: {
        ...task("progress-task", "working", {
          statusMessage,
          lastUpdatedAt: `2026-07-28T00:00:0${index}.000Z`
        })
      }
    })
  )

  return toolResult("Task status notifications validated.", {
    notificationCount: notifications.length,
    finalStatusMessage: notifications.at(-1)?.params.statusMessage
  })
})
