import * as Effect from "effect/Effect"
import * as Schema from "effect/Schema"
import * as Tasks from "mcp-effect-sdk/experimental/tasks"
import { McpSchema } from "mcp-effect-sdk/protocol/2026-07-28"
import { task, toolResult } from "./helpers.js"

export const taskRequiringElicitation = Effect.fn("example.tasks.input-required")(function* () {
  const pending = yield* Schema.decodeUnknownEffect(Tasks.InputRequiredTask)({
    ...task("approval-task", "input_required"),
    status: "input_required",
    inputRequests: {
      approval: new McpSchema.ElicitRequest({
        method: "elicitation/create",
        params: {
          message: "Approve the task",
          requestedSchema: {
            type: "object",
            properties: {
              approved: { type: "boolean" }
            },
            required: ["approved"]
          }
        }
      })
    }
  })

  return toolResult("Input-required task payload validated.", {
    taskId: pending.taskId,
    inputRequestCount: Object.keys(pending.inputRequests).length
  })
})
