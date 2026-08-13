/** In-memory core Tasks runtime for MCP 2025-11-25. */
import { randomUUID } from "node:crypto"
import * as Effect from "effect/Effect"
import * as Ref from "effect/Ref"
import type { Task, TaskStatus } from "../generated/mcp/2025-11-25/McpSchema.generated.js"
import { LegacyConnectionError, type LegacyRequestHandler } from "./Connection.js"

export interface LegacyTaskRecord {
  readonly task: Task
  readonly payload?: unknown
  readonly owner?: string
}

type LegacyTaskStatus = typeof TaskStatus.Type

export interface LegacyTaskStoreOptions {
  readonly defaultTtlMs?: number | null
  readonly pollIntervalMs?: number
  readonly pageSize?: number
  readonly now?: () => Date
  readonly id?: () => string
}

export interface LegacyTaskStore {
  readonly create: (options?: { readonly owner?: string; readonly ttlMs?: number | null }) => Effect.Effect<Task>
  readonly get: (taskId: string, owner?: string) => Effect.Effect<LegacyTaskRecord, LegacyConnectionError>
  readonly transition: (
    taskId: string,
    status: LegacyTaskStatus,
    options?: { readonly payload?: unknown; readonly statusMessage?: string; readonly owner?: string }
  ) => Effect.Effect<Task, LegacyConnectionError>
  readonly handlers: (owner?: string) => Readonly<Record<string, LegacyRequestHandler>>
}

const terminal = new Set<LegacyTaskStatus>(["cancelled", "completed", "failed"])
const transitions: Readonly<Record<LegacyTaskStatus, ReadonlySet<LegacyTaskStatus>>> = {
  working: new Set(["input_required", "completed", "failed", "cancelled"]),
  input_required: new Set(["working", "completed", "failed", "cancelled"]),
  completed: new Set(),
  failed: new Set(),
  cancelled: new Set()
}

const taskError = (message: string, code = -32602) => new LegacyConnectionError({ stage: "Protocol", message, code })

const cursor = (offset: number): string => Buffer.from(String(offset), "utf8").toString("base64url")
const cursorOffset = (value: unknown): number | undefined => {
  if (value === undefined) return 0
  if (typeof value !== "string") return undefined
  try {
    const parsed = Number(Buffer.from(value, "base64url").toString("utf8"))
    return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : undefined
  } catch {
    return undefined
  }
}

export const makeTaskStore = (options: LegacyTaskStoreOptions = {}): Effect.Effect<LegacyTaskStore> =>
  Effect.gen(function* () {
    const records = yield* Ref.make(new Map<string, LegacyTaskRecord>())
    const now = options.now ?? (() => new Date())
    const makeId = options.id ?? randomUUID
    const ttl = options.defaultTtlMs === undefined ? 60 * 60 * 1000 : options.defaultTtlMs
    const pageSize = Math.max(1, options.pageSize ?? 100)

    const prune = Ref.update(records, (current) => {
      const time = now().getTime()
      const next = new Map(current)
      for (const [id, record] of next) {
        if (record.task.ttl !== null && Date.parse(record.task.createdAt) + record.task.ttl <= time) next.delete(id)
      }
      return next
    })

    const get = (taskId: string, owner?: string): Effect.Effect<LegacyTaskRecord, LegacyConnectionError> =>
      prune.pipe(
        Effect.zipRight(Ref.get(records)),
        Effect.flatMap((current) => {
          const record = current.get(taskId)
          return record === undefined || (record.owner !== undefined && record.owner !== owner)
            ? Effect.fail(taskError("Task not found", -32602))
            : Effect.succeed(record)
        })
      )

    const create: LegacyTaskStore["create"] = (createOptions = {}) =>
      Effect.gen(function* () {
        yield* prune
        const timestamp = now().toISOString()
        const task = {
          taskId: makeId(),
          status: "working" as const,
          createdAt: timestamp,
          lastUpdatedAt: timestamp,
          ttl: createOptions.ttlMs === undefined ? ttl : createOptions.ttlMs,
          ...(options.pollIntervalMs === undefined ? {} : { pollInterval: options.pollIntervalMs })
        } as Task
        yield* Ref.update(records, (current) => {
          const next = new Map(current)
          next.set(task.taskId, { task, ...(createOptions.owner === undefined ? {} : { owner: createOptions.owner }) })
          return next
        })
        return task
      })

    const transition: LegacyTaskStore["transition"] = (taskId, status, transitionOptions = {}) =>
      Effect.gen(function* () {
        const record = yield* get(taskId, transitionOptions.owner)
        if (!transitions[record.task.status].has(status)) {
          return yield* Effect.fail(taskError(`Invalid task transition ${record.task.status} -> ${status}`))
        }
        const task = {
          ...record.task,
          status,
          lastUpdatedAt: now().toISOString(),
          ...(transitionOptions.statusMessage === undefined
            ? { statusMessage: record.task.statusMessage }
            : { statusMessage: transitionOptions.statusMessage })
        } as Task
        yield* Ref.update(records, (current) => {
          const next = new Map(current)
          next.set(taskId, {
            ...record,
            task,
            ...(transitionOptions.payload === undefined ? {} : { payload: transitionOptions.payload })
          })
          return next
        })
        return task
      })

    const handlers = (owner?: string): Readonly<Record<string, LegacyRequestHandler>> => ({
      "tasks/get": (params) =>
        get((params as { readonly taskId: string }).taskId, owner).pipe(Effect.map((record) => record.task)),
      "tasks/result": (params) =>
        get((params as { readonly taskId: string }).taskId, owner).pipe(
          Effect.flatMap((record) =>
            record.task.status === "completed" && record.payload !== undefined
              ? Effect.succeed(record.payload)
              : Effect.fail(taskError("Task result is not available"))
          )
        ),
      "tasks/list": (params) =>
        prune.pipe(
          Effect.zipRight(Ref.get(records)),
          Effect.flatMap((current) => {
            const offset = cursorOffset((params as { readonly cursor?: unknown } | undefined)?.cursor)
            if (offset === undefined) return Effect.fail(taskError("Invalid task cursor"))
            const visible = [...current.values()].filter(
              (record) => record.owner === undefined || record.owner === owner
            )
            const tasks = visible.slice(offset, offset + pageSize).map(({ task }) => task)
            const next = offset + tasks.length
            return Effect.succeed({ tasks, ...(next < visible.length ? { nextCursor: cursor(next) } : {}) })
          })
        ),
      "tasks/cancel": (params) =>
        get((params as { readonly taskId: string }).taskId, owner).pipe(
          Effect.flatMap((record) =>
            terminal.has(record.task.status)
              ? Effect.succeed(record.task)
              : transition(record.task.taskId, "cancelled", { owner, statusMessage: "Cancelled by peer" })
          )
        )
    })

    return { create, get, transition, handlers }
  })
