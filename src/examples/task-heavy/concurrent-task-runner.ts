import * as Effect from "effect/Effect"
import * as Ref from "effect/Ref"
import * as Semaphore from "effect/Semaphore"
import * as McpTasks from "../../McpTasks.js"
import { toolResult } from "./helpers.js"

const runJob = (
  id: string,
  active: Ref.Ref<number>,
  maxObserved: Ref.Ref<number>,
  permits: Semaphore.Semaphore
) =>
  Semaphore.withPermit(permits)(
    Effect.gen(function*() {
      const nowActive = yield* Ref.updateAndGet(active, (value) => value + 1)
      yield* Ref.update(maxObserved, (value) => Math.max(value, nowActive))
      yield* Effect.sleep(10)
      yield* Ref.update(active, (value) => value - 1)
      return toolResult(`Job ${id} completed.`, { jobId: id })
    })
  )

export const concurrentTaskRunner = Effect.gen(function*() {
  const runtime = yield* McpTasks.McpTasks.make()
  const active = yield* Ref.make(0)
  const maxObserved = yield* Ref.make(0)
  const permits = yield* Semaphore.make(2)

  const one = yield* runtime.start({ effect: runJob("one", active, maxObserved, permits) })
  const two = yield* runtime.start({ effect: runJob("two", active, maxObserved, permits) })
  const three = yield* runtime.start({ effect: runJob("three", active, maxObserved, permits) })
  const listed = yield* runtime.list(undefined)

  yield* runtime.result({ taskId: one.task.taskId })
  yield* runtime.result({ taskId: two.task.taskId })
  yield* runtime.result({ taskId: three.task.taskId })

  return toolResult("Concurrent task runner completed.", {
    taskCount: listed.tasks.length,
    maxObservedConcurrency: yield* Ref.get(maxObserved)
  })
})
