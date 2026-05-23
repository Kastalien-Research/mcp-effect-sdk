import * as Effect from "effect/Effect"
import * as Exit from "effect/Exit"
import * as McpTasks from "../../McpTasks.js"
import { isRecord, toolResult } from "./helpers.js"

export const taskTtlCacheDemo = Effect.gen(function*() {
  const runtime = yield* McpTasks.McpTasks.make({ pollInterval: 25 })
  const created = yield* runtime.start({
    ttl: 10,
    effect: Effect.succeed(toolResult("Cached task payload."))
  })
  const payload = yield* runtime.result({ taskId: created.task.taskId })

  yield* Effect.sleep(20)

  const expiredLookup = yield* Effect.exit(
    runtime.get({ taskId: created.task.taskId })
  )

  return toolResult("Task TTL/cache demo completed.", {
    payloadText: readPayloadText(payload.content),
    pollInterval: created.task.pollInterval,
    taskExpired: Exit.isFailure(expiredLookup)
  })
})

const readPayloadText = (content: unknown): string | null => {
  if (!Array.isArray(content)) {
    return null
  }
  const [first] = content
  if (!isRecord(first)) {
    return null
  }
  return typeof first.text === "string" ? first.text : null
}
