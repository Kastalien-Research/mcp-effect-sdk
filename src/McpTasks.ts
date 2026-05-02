/**
 * Runtime kernel for stable MCP task execution.
 *
 * Protocol shape comes from the generated MCP schema facade. This module owns
 * only task lifecycle state, result correlation, cancellation, and listing.
 *
 * @since 4.0.0
 */
import * as Deferred from "effect/Deferred"
import * as Effect from "effect/Effect"
import * as Fiber from "effect/Fiber"
import {
  CancelTaskResult,
  GetTaskResult,
  InternalError,
  InvalidParams,
  ListTasksResult,
  Task as TaskSchema
} from "./McpSchema.js"
import type {
  CallToolResult,
  CreateTaskResult,
  GetTaskPayloadResult,
  Task,
  TaskStatus
} from "./McpSchema.js"
import { CreateTaskResult as CreateTaskResultSchema } from "./McpSchema.js"

export const RELATED_TASK_META_KEY = "io.modelcontextprotocol/related-task" as const

export type ToolTaskSupport = "forbidden" | "optional" | "required"

export type TaskTerminalStatus = Extract<TaskStatus, "completed" | "failed" | "cancelled">

export interface TaskRuntimeOptions {
  readonly pollInterval?: number | undefined
  readonly pageSize?: number | undefined
  readonly notify?: ((task: Task) => Effect.Effect<void, never>) | undefined
}

export interface StartTaskOptions<R> {
  readonly ttl?: number | undefined
  readonly statusMessage?: string | undefined
  readonly effect: Effect.Effect<CallToolResult, InternalError | InvalidParams, R>
}

interface TaskEntry {
  readonly result: Deferred.Deferred<GetTaskPayloadResult, InternalError | InvalidParams>
  readonly startedAtMs: number
  task: Task
  fiber?: Fiber.Fiber<void, never> | undefined
}

const defaultPollInterval = 500
const defaultPageSize = 50

export const isTerminalStatus = (status: TaskStatus): status is TaskTerminalStatus =>
  status === "completed" || status === "failed" || status === "cancelled"

export const canTransition = (from: TaskStatus, to: TaskStatus): boolean => {
  if (isTerminalStatus(from)) {
    return false
  }
  if (from === to) {
    return true
  }
  switch (from) {
    case "working":
      return to === "input_required" || isTerminalStatus(to)
    case "input_required":
      return to === "working" || isTerminalStatus(to)
  }
}

export class McpTasks {
  private readonly tasks = new Map<string, TaskEntry>()
  private readonly pollInterval: number
  private readonly pageSize: number
  private readonly notify?: (task: Task) => Effect.Effect<void, never>

  private constructor(options: TaskRuntimeOptions) {
    this.pollInterval = options.pollInterval ?? defaultPollInterval
    this.pageSize = options.pageSize ?? defaultPageSize
    this.notify = options.notify
  }

  /**
   * @since 4.0.0
   */
  static readonly make = (options: TaskRuntimeOptions = {}): Effect.Effect<McpTasks> =>
    Effect.succeed(new McpTasks(options))

  /**
   * Start a task and return the protocol `CreateTaskResult` immediately.
   *
   * @since 4.0.0
   */
  readonly start = <R>(options: StartTaskOptions<R>): Effect.Effect<CreateTaskResult, never, R> =>
  {
    const self = this
    return Effect.gen(function*() {
      const taskId = globalThis.crypto.randomUUID()
      const now = Date.now()
      const task = self.makeTask(taskId, now, "working", options.ttl ?? null, options.statusMessage)
      const result = yield* Deferred.make<GetTaskPayloadResult, InternalError | InvalidParams>()
      const entry: TaskEntry = {
        result,
        startedAtMs: now,
        task
      }
      self.tasks.set(taskId, entry)
      yield* self.notifyTask(task)

      const run = options.effect.pipe(
        Effect.map((toolResult) => withRelatedTaskMeta(toolResult, taskId)),
        Effect.matchCauseEffect({
          onFailure: () =>
            self.failTask(taskId, new InternalError({ message: `Task ${taskId} failed` })),
          onSuccess: (payload) => self.completeTask(taskId, payload)
        })
      )
      entry.fiber = yield* Effect.forkDetach(run)

      return new CreateTaskResultSchema({ task })
    })
  }

  /**
   * Retrieve current task state.
   *
   * @since 4.0.0
   */
  readonly get = (
    request: { readonly taskId: string }
  ): Effect.Effect<GetTaskResult, InvalidParams> =>
  {
    const self = this
    return Effect.gen(function*() {
      const entry = yield* self.requireTask(request.taskId)
      return new GetTaskResult(entry.task)
    })
  }

  /**
   * Wait until a task reaches a terminal state, then return its stored result.
   *
   * @since 4.0.0
   */
  readonly result = (
    request: { readonly taskId: string }
  ): Effect.Effect<GetTaskPayloadResult, InternalError | InvalidParams> =>
  {
    const self = this
    return Effect.gen(function*() {
      const entry = yield* self.requireTask(request.taskId)
      return yield* Deferred.await(entry.result)
    })
  }

  /**
   * List tasks with opaque numeric cursors.
   *
   * @since 4.0.0
   */
  readonly list = (
    request: { readonly cursor?: string } | undefined
  ): Effect.Effect<ListTasksResult, InvalidParams> =>
  {
    const self = this
    return Effect.gen(function*() {
      self.cleanupExpired()
      const start = yield* parseCursor(request?.cursor, self.tasks.size)
      const entries = Array.from(self.tasks.values())
      const page = entries.slice(start, start + self.pageSize)
      const next = start + self.pageSize < entries.length ? String(start + self.pageSize) : undefined
      return new ListTasksResult({
        tasks: page.map((entry) => entry.task),
        nextCursor: next
      })
    })
  }

  /**
   * Cancel a non-terminal task.
   *
   * @since 4.0.0
   */
  readonly cancel = (
    request: { readonly taskId: string }
  ): Effect.Effect<CancelTaskResult, InvalidParams> =>
  {
    const self = this
    return Effect.gen(function*() {
      const entry = yield* self.requireTask(request.taskId)
      if (isTerminalStatus(entry.task.status)) {
        return yield* new InvalidParams({ message: `Task ${request.taskId} is already terminal` })
      }
      yield* self.transition(request.taskId, "cancelled", "The task was cancelled by request.")
      if (entry.fiber) {
        yield* Fiber.interrupt(entry.fiber)
      }
      yield* Deferred.fail(
        entry.result,
        new InvalidParams({ message: `Task ${request.taskId} was cancelled` })
      )
      return new CancelTaskResult(entry.task)
    })
  }

  /**
   * Transition a task after validating the stable MCP task state machine.
   *
   * @since 4.0.0
   */
  readonly transition = (
    taskId: string,
    status: TaskStatus,
    statusMessage?: string | undefined
  ): Effect.Effect<Task, InvalidParams> =>
  {
    const self = this
    return Effect.gen(function*() {
      const entry = yield* self.requireTask(taskId)
      if (!canTransition(entry.task.status, status)) {
        return yield* new InvalidParams({
          message: `Invalid task transition from ${entry.task.status} to ${status}`
        })
      }
      entry.task = {
        ...entry.task,
        status,
        statusMessage,
        lastUpdatedAt: new Date().toISOString()
      }
      yield* self.notifyTask(entry.task)
      return entry.task
    })
  }

  private readonly completeTask = (
    taskId: string,
    result: GetTaskPayloadResult
  ): Effect.Effect<void, never> =>
  {
    const self = this
    return Effect.gen(function*() {
      const entry = self.tasks.get(taskId)
      if (!entry || isTerminalStatus(entry.task.status)) {
        return
      }
      const task = yield* self.transition(taskId, "completed", "The task completed.")
      yield* Deferred.succeed(entry.result, result)
      entry.task = task
    }).pipe(Effect.catchCause(() => Effect.void))
  }

  private readonly failTask = (
    taskId: string,
    error: InternalError | InvalidParams
  ): Effect.Effect<void, never> =>
  {
    const self = this
    return Effect.gen(function*() {
      const entry = self.tasks.get(taskId)
      if (!entry || isTerminalStatus(entry.task.status)) {
        return
      }
      const task = yield* self.transition(taskId, "failed", error.message)
      yield* Deferred.fail(entry.result, error)
      entry.task = task
    }).pipe(Effect.catchCause(() => Effect.void))
  }

  private readonly requireTask = (
    taskId: string
  ): Effect.Effect<TaskEntry, InvalidParams> =>
    Effect.suspend(() => {
      this.cleanupExpired()
      const entry = this.tasks.get(taskId)
      return entry ?
        Effect.succeed(entry) :
        Effect.fail(new InvalidParams({ message: `Task ${taskId} not found` }))
    })

  private readonly makeTask = (
    taskId: string,
    now: number,
    status: TaskStatus,
    ttl: number | null,
    statusMessage?: string | undefined
  ): Task => ({
    taskId,
    status,
    statusMessage,
    createdAt: new Date(now).toISOString(),
    lastUpdatedAt: new Date(now).toISOString(),
    ttl,
    pollInterval: this.pollInterval
  })

  private readonly notifyTask = (task: Task): Effect.Effect<void, never> =>
    this.notify?.(task) ?? Effect.void

  private cleanupExpired() {
    const now = Date.now()
    for (const [taskId, entry] of this.tasks) {
      const expiresAt = entry.task.ttl === null ? undefined : entry.startedAtMs + entry.task.ttl
      if (expiresAt !== undefined && expiresAt <= now) {
        this.tasks.delete(taskId)
      }
    }
  }
}

const parseCursor = (
  cursor: string | undefined,
  size: number
): Effect.Effect<number, InvalidParams> => {
  if (cursor === undefined) {
    return Effect.succeed(0)
  }
  const parsed = Number(cursor)
  if (!Number.isInteger(parsed) || parsed < 0 || parsed > size) {
    return Effect.fail(new InvalidParams({ message: `Invalid task cursor` }))
  }
  return Effect.succeed(parsed)
}

const withRelatedTaskMeta = (
  result: CallToolResult,
  taskId: string
): GetTaskPayloadResult => {
  const record = result as unknown as Record<string, unknown>
  const meta = record["_meta"]
  const metaRecord = isRecord(meta) ? meta : {}
  return {
    ...record,
    _meta: {
      ...metaRecord,
      [RELATED_TASK_META_KEY]: { taskId }
    }
  }
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value)
