import * as Effect from "effect/Effect"
import * as Schema from "effect/Schema"
import * as Tasks from "mcp-effect-sdk/experimental/tasks"
import { requestMeta, task, toolResult } from "./helpers.js"

export const taskCancellationLab = Effect.fn("example.tasks.cancellation")(function* () {
  const beforeCancel = task("cancel-demo")
  const request = yield* Schema.decodeUnknownEffect(Tasks.CancelTaskRequest)({
    jsonrpc: "2.0",
    id: "cancel-demo",
    method: "tasks/cancel",
    params: {
      _meta: requestMeta,
      taskId: beforeCancel.taskId
    }
  })
  const cancelled = Schema.decodeUnknownSync(Tasks.DetailedTask)({
    ...beforeCancel,
    status: "cancelled"
  })

  return toolResult("Cancellation extension payloads validated.", {
    requestMethod: request.method,
    beforeCancelStatus: beforeCancel.status,
    cancelledStatus: cancelled.status
  })
})
