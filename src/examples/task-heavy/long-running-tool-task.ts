import * as Effect from "effect/Effect"
import * as McpServer from "../../McpServer.js"
import { toolResult } from "./helpers.js"

export const LongRunningToolTask = McpServer.tool({
  name: "long_running_report",
  description: "Creates a report through task-augmented tools/call execution.",
  taskSupport: "required",
  content: () =>
    Effect.sleep(25).pipe(
      Effect.as(toolResult("Report completed.", { reportId: "quarterly", format: "markdown" }))
    )
})

export const startLongRunningReport = Effect.gen(function*() {
  const server = yield* McpServer.McpServer
  return yield* server.callTool({
    name: "long_running_report",
    arguments: {},
    task: { ttl: 60_000 }
  })
})
