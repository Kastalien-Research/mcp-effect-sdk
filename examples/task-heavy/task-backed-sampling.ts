import * as Schema from "effect/Schema"
import * as Tasks from "mcp-effect-sdk/experimental/tasks"
import { McpSchema } from "mcp-effect-sdk/protocol/2026-07-28"
import { task } from "./helpers.js"

export const taskBackedSamplingCapability = Schema.decodeUnknownSync(
  Tasks.TasksExtensionCapability
)({})

export const taskBackedSampling = Schema.decodeUnknownSync(Tasks.CreateTaskResult)({
  ...task("sampling-task"),
  resultType: "task"
})

export const taskBackedSamplingClientResult = new McpSchema.CreateMessageResult({
  content: new McpSchema.TextContent({
    type: "text",
    text: "Example task-backed sampling response"
  }),
  model: "example-local-model",
  role: "assistant",
  stopReason: "endTurn"
})
