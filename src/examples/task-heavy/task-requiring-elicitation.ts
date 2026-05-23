import * as Effect from "effect/Effect"
import * as Schema from "effect/Schema"
import * as McpServer from "../../McpServer.js"
import { relatedTaskId, toolResult } from "./helpers.js"

const Approval = Schema.Struct({
  approved: Schema.Boolean,
  note: Schema.optionalKey(Schema.String)
})

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
      const response = yield* McpServer.elicit({
        message: "Approve the generated change before the task continues.",
        schema: Approval
      })
      if (taskId !== undefined) {
        yield* server.taskRuntime.transition(taskId, "working", "Approval received.")
      }
      return toolResult("Elicitation task resumed.", {
        approved: response.approved,
        note: response.note ?? null
      })
    })
})
