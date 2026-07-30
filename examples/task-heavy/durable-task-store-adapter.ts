import * as Fs from "node:fs/promises"
import * as Path from "node:path"
import * as Effect from "effect/Effect"
import * as Schema from "effect/Schema"
import * as Tasks from "mcp-effect-sdk/experimental/tasks"

export interface TaskSnapshotStore {
  readonly save: (task: Tasks.Task) => Effect.Effect<void, Error>
  readonly list: Effect.Effect<ReadonlyArray<Tasks.Task>, Error>
}

export const makeMemoryTaskSnapshotStore = (): TaskSnapshotStore => {
  const snapshots = new Map<string, Tasks.Task>()
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
        await Fs.writeFile(Path.join(directory, `${task.taskId}.json`), JSON.stringify(task, null, 2))
      },
      catch: toError
    }),
  list: Effect.tryPromise({
    try: async () => {
      const names = await Fs.readdir(directory).catch((error: unknown) => {
        if (isNotFound(error)) return []
        throw error
      })
      return names.filter((name) => name.endsWith(".json"))
    },
    catch: toError
  }).pipe(
    Effect.flatMap((names) =>
      Effect.forEach(names, (name) =>
        Effect.tryPromise({
          try: () => Fs.readFile(Path.join(directory, name), "utf8"),
          catch: toError
        }).pipe(
          Effect.flatMap((source) =>
            Schema.decodeUnknown(Tasks.Task)(JSON.parse(source)).pipe(
              Effect.mapError(toError)
            )
          )
        )
      )
    )
  )
})

const isNotFound = (error: unknown): boolean =>
  typeof error === "object" &&
  error !== null &&
  "code" in error &&
  error.code === "ENOENT"

const toError = (error: unknown): Error =>
  error instanceof Error ? error : new Error(String(error))
