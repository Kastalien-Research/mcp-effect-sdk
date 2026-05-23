import * as Effect from "effect/Effect"
import * as McpSchema from "../../McpSchema.js"
import * as McpServer from "../../McpServer.js"
import { text, toolResult } from "./helpers.js"

export const TaskBackedSampling = McpServer.tool({
  name: "task_backed_sampling",
  description: "Runs sampling/createMessage from inside a task-backed tool call.",
  taskSupport: "required",
  content: () =>
    Effect.gen(function*() {
      const sampled = yield* McpServer.sample({
        messages: [{
          role: "user",
          content: text("Summarize why task-backed sampling needs polling.")
        }],
        maxTokens: 120,
        metadata: { example: "task-backed-sampling" }
      })

      return toolResult("Sampling completed for task.", {
        model: sampled.model,
        stopReason: sampled.stopReason ?? null
      })
    })
})

export const taskBackedSamplingClientResult = new McpSchema.CreateMessageResult({
  model: "example-local-model",
  stopReason: "endTurn"
})
