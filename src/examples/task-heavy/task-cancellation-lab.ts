import * as Effect from "effect/Effect"
import * as Exit from "effect/Exit"
import * as McpTasks from "../../McpTasks.js"
import { toolResult } from "./helpers.js"

export const taskCancellationLab = Effect.gen(function*() {
  const runtime = yield* McpTasks.McpTasks.make()
  const created = yield* runtime.start({
    ttl: 30_000,
    effect: Effect.never
  })
  const beforeCancel = yield* runtime.get({ taskId: created.task.taskId })
  const cancelled = yield* runtime.cancel({ taskId: created.task.taskId })
  const terminalTransition = yield* Effect.exit(
    runtime.transition(created.task.taskId, "completed")
  )
  const cancelledPayload = yield* Effect.exit(
    runtime.result({ taskId: created.task.taskId })
  )

  return toolResult("Cancellation lab completed.", {
    beforeCancelStatus: beforeCancel.status,
    cancelledStatus: cancelled.status,
    rejectsTerminalTransition: Exit.isFailure(terminalTransition),
    rejectsCancelledPayload: Exit.isFailure(cancelledPayload)
  })
})
