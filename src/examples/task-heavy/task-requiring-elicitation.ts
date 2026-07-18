import * as Effect from "effect/Effect"
import * as McpSchema from "../../McpSchema.js"
import * as McpServer from "../../McpServer.js"
import { relatedTaskId } from "./helpers.js"

export const TaskRequiringElicitation = McpServer.tool({
  name: "task_requiring_elicitation",
  description: "Pauses a task for client elicitation and resumes after the response.",
  taskSupport: "required",
  content: (_params, request) =>
    Effect.gen(function*() {
      const server = yield* McpServer.McpServer
      const taskId = relatedTaskId(request._meta)
      if (taskId !== undefined) {
        yield* server.taskRuntime.transition(
          taskId,
          "input_required",
          "Waiting for user approval."
        )
      }
      return yield* Effect.fail(McpSchema.InternalError.notImplemented)
    })
})
