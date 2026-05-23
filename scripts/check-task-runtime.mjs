import assert from "node:assert/strict"
import * as Deferred from "effect/Deferred"
import * as Effect from "effect/Effect"
import * as Exit from "effect/Exit"
import * as Fiber from "effect/Fiber"
import * as ServiceMap from "effect/ServiceMap"
import * as McpSchema from "../dist/McpSchema.js"
import * as McpServer from "../dist/McpServer.js"
import * as McpTasks from "../dist/McpTasks.js"

const tool = (name, taskSupport) =>
  new McpSchema.Tool({
    name,
    inputSchema: { type: "object" },
    execution: { taskSupport }
  })

const result = (text) =>
  new McpSchema.CallToolResult({
    content: [{ type: "text", text }]
  })

const assertFails = async (effect, message) => {
  const exit = await Effect.runPromise(Effect.exit(effect))
  assert.equal(Exit.isFailure(exit), true, message)
}

await Effect.runPromise(Effect.scoped(Effect.gen(function*() {
  const server = yield* McpServer.McpServer.make
  const release = yield* Deferred.make()

  yield* server.addTool({
    tool: tool("optional", "optional"),
    annotations: ServiceMap.empty(),
    handle: () =>
      Deferred.await(release).pipe(
        Effect.as(result("finished"))
      )
  })

  yield* server.addTool({
    tool: tool("required", "required"),
    annotations: ServiceMap.empty(),
    handle: () => Effect.succeed(result("required"))
  })

  yield* server.addTool({
    tool: tool("forbidden", "forbidden"),
    annotations: ServiceMap.empty(),
    handle: () => Effect.succeed(result("forbidden"))
  })

  yield* McpServer.registerTool({
    name: "registered_optional",
    description: "High-level tool registration exposes task support",
    taskSupport: "optional",
    content: (_params, request) => {
      const related = request._meta?.[McpTasks.RELATED_TASK_META_KEY]
      return Effect.succeed(result(`registered task support ${related.taskId}`))
    }
  }).pipe(Effect.provideService(McpServer.McpServer, server))

  assert.equal(server.hasTaskTools(), true)
  const registered = server.tools.find(({ tool }) => tool.name === "registered_optional")
  assert.equal(registered.tool.execution.taskSupport, "optional")

  const direct = yield* server.callTool({ name: "forbidden", arguments: {} })
  assert.equal(direct.content[0].text, "forbidden")

  const requiredDirectExit = yield* Effect.exit(server.callTool({ name: "required", arguments: {} }))
  assert.equal(Exit.isFailure(requiredDirectExit), true, "required task tools reject non-task calls")

  const forbiddenTaskExit = yield* Effect.exit(
    server.callTool({ name: "forbidden", arguments: {}, task: { ttl: 1000 } })
  )
  assert.equal(Exit.isFailure(forbiddenTaskExit), true, "forbidden task tools reject task calls")

  const created = yield* server.callTool({
    name: "optional",
    arguments: {},
    task: { ttl: 5000 }
  })
  assert.equal(created.task.status, "working")
  assert.equal(typeof created.task.taskId, "string")

  const current = yield* server.taskRuntime.get({ taskId: created.task.taskId })
  assert.equal(current.status, "working")

  let resultSettled = false
  const resultFiber = yield* Effect.forkChild(
    server.taskRuntime.result({ taskId: created.task.taskId }).pipe(
      Effect.tap(() => Effect.sync(() => {
        resultSettled = true
      }))
    )
  )
  yield* Effect.promise(() => new Promise((resolve) => setTimeout(resolve, 10)))
  assert.equal(resultSettled, false, "tasks/result blocks while a task is non-terminal")

  yield* Deferred.succeed(release, undefined)
  const payload = yield* Fiber.join(resultFiber)
  assert.equal(payload.content[0].text, "finished")
  assert.deepEqual(payload._meta[McpTasks.RELATED_TASK_META_KEY], {
    taskId: created.task.taskId
  })

  const completed = yield* server.taskRuntime.get({ taskId: created.task.taskId })
  assert.equal(completed.status, "completed")

  const registeredCreated = yield* server.callTool({
    name: "registered_optional",
    arguments: {},
    task: { ttl: 5000 }
  })
  const registeredPayload = yield* server.taskRuntime.result({
    taskId: registeredCreated.task.taskId
  })
  assert.equal(
    registeredPayload.content[0].text,
    `registered task support ${registeredCreated.task.taskId}`
  )
})))

const cancelRuntime = await Effect.runPromise(McpTasks.McpTasks.make())
const cancellable = await Effect.runPromise(cancelRuntime.start({
  ttl: 5000,
  effect: Effect.never
}))
const cancelled = await Effect.runPromise(cancelRuntime.cancel({ taskId: cancellable.task.taskId }))
assert.equal(cancelled.status, "cancelled")
await assertFails(
  cancelRuntime.result({ taskId: cancellable.task.taskId }),
  "cancelled task result returns the stored terminal error"
)
await assertFails(
  cancelRuntime.transition(cancellable.task.taskId, "working"),
  "terminal tasks reject further transitions"
)

const pagedRuntime = await Effect.runPromise(McpTasks.McpTasks.make({ pageSize: 1 }))
await Effect.runPromise(pagedRuntime.start({ effect: Effect.succeed(result("one")) }))
await Effect.runPromise(pagedRuntime.start({ effect: Effect.succeed(result("two")) }))
const firstPage = await Effect.runPromise(pagedRuntime.list(undefined))
assert.equal(firstPage.tasks.length, 1)
assert.equal(firstPage.nextCursor, "1")
const secondPage = await Effect.runPromise(pagedRuntime.list({ cursor: firstPage.nextCursor }))
assert.equal(secondPage.tasks.length, 1)
assert.equal(secondPage.nextCursor, undefined)

const ttlRuntime = await Effect.runPromise(McpTasks.McpTasks.make())
const expiring = await Effect.runPromise(ttlRuntime.start({
  ttl: 1,
  effect: Effect.succeed(result("expired"))
}))
await new Promise((resolve) => setTimeout(resolve, 5))
await assertFails(
  ttlRuntime.get({ taskId: expiring.task.taskId }),
  "ttl-expired tasks are no longer retrievable"
)

console.log("Task runtime checks passed.")
