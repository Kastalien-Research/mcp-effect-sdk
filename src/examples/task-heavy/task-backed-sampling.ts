import * as Effect from "effect/Effect"
import * as McpSchema from "../../McpSchema.js"
import * as McpServer from "../../McpServer.js"

export const TaskBackedSampling = McpServer.tool({
  name: "task_backed_sampling",
  description: "Runs sampling/createMessage from inside a task-backed tool call.",
  taskSupport: "required",
  content: () => Effect.fail(McpSchema.InternalError.notImplemented)
})

export const taskBackedSamplingClientResult = new McpSchema.CreateMessageResult({
  model: "example-local-model",
  stopReason: "endTurn"
})
