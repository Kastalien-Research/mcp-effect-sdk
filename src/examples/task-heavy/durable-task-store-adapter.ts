import * as Fs from "node:fs/promises"
import * as Path from "node:path"
import * as Effect from "effect/Effect"
import * as McpSchema from "../../McpSchema.js"
import * as McpTasks from "../../McpTasks.js"
import { toolResult } from "./helpers.js"

export interface TaskSnapshotStore {
  readonly save: (task: McpSchema.Task) => Effect.Effect<void, Error>
  readonly list: Effect.Effect<ReadonlyArray<McpSchema.Task>, Error>
}

export const makeMemoryTaskSnapshotStore = (): TaskSnapshotStore => {
  const snapshots = new Map<string, McpSchema.Task>()
  return {
    save: (task) =>
      Effect.sync(() => {
        snapshots.set(task.taskId, task)
      }),
    list: Effect.sync(() => Array.from(snapshots.values()))
  }
}

export const makeFileTaskSnapshotStore = (directory: string): TaskSnapshotStore => ({
  save: (task) =>
    Effect.tryPromise({
      try: async () => {
        await Fs.mkdir(directory, { recursive: true })
        await Fs.writeFile(
          Path.join(directory, `${task.taskId}.json`),
          JSON.stringify(task, null, 2)
        )
      },
      catch: (error) => error instanceof Error ? error : new Error(String(error))
    }),
  list: Effect.tryPromise({
    try: async () => {
      const names = await Fs.readdir(directory).catch((error: unknown) => {
        if (isNotFound(error)) {
          return []
        }
        throw error
      })
      const tasks = await Promise.all(
        names
          .filter((name) => name.endsWith(".json"))
          .map((name) => Fs.readFile(Path.join(directory, name), "utf8"))
      )
      return tasks.map((task) => JSON.parse(task) as McpSchema.Task)
    },
    catch: (error) => error instanceof Error ? error : new Error(String(error))
  })
})

export const makeSnapshottingTaskRuntime = (
  store: TaskSnapshotStore
): Effect.Effect<McpTasks.McpTasks> =>
  McpTasks.McpTasks.make({
    notify: (task) =>
      store.save(task).pipe(
        Effect.catchCause(() => Effect.void)
      )
  })

export const durableTaskStoreAdapterBoundary = (
  store: TaskSnapshotStore
) =>
  Effect.gen(function*() {
    const runtime = yield* makeSnapshottingTaskRuntime(store)
    const created = yield* runtime.start({
      ttl: 60_000,
      effect: Effect.succeed(toolResult("Durable boundary task completed."))
    })
    yield* runtime.result({ taskId: created.task.taskId })
    const snapshots = yield* store.list

    return toolResult("Durable task store adapter boundary completed.", {
      inMemoryRuntimeOwnsLiveFibers: true,
      persistedSnapshots: snapshots.length,
      recoveredTaskIds: snapshots.map((task) => task.taskId)
    })
  })

const isNotFound = (error: unknown): boolean =>
  typeof error === "object" &&
  error !== null &&
  "code" in error &&
  error.code === "ENOENT"
