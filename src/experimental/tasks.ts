/**
 * Experimental Effect schemas for the `io.modelcontextprotocol/tasks` extension.
 *
 * This entrypoint is intentionally outside the package's stable SemVer surface.
 * It overlays the pinned Tasks extension on the MCP 2026-07-28 core schemas.
 */
import * as Schema from "effect/Schema"
import * as Core from "../generated/mcp/2026-07-28/McpSchema.generated.js"
import { MISSING_REQUIRED_CLIENT_CAPABILITY_ERROR_CODE } from "../McpModern.js"
import {
  cloneStrictJson,
  invalidStrictJson
} from "../internal/StrictJson.js"

export const TASKS_EXTENSION_ID = "io.modelcontextprotocol/tasks" as const
export const TASKS_EXTENSION_REVISION = "2c1425d9a288b9b1f489430fe1e00bb392b47e48" as const
export const TASKS_STABILITY = "experimental" as const
export const TASKS_SUPPORTED_AUGMENTED_METHODS = Object.freeze(["tools/call"] as const)
export const TASKS_MISSING_REQUIRED_CLIENT_CAPABILITY_ERROR_CODE =
  MISSING_REQUIRED_CLIENT_CAPABILITY_ERROR_CODE

const strict = { parseOptions: { onExcessProperty: "error" as const } }

const TaskId = Schema.String.pipe(Schema.filter(
  (value) => value.trim().length > 0,
  { message: () => "Expected a non-empty task identifier" }
))

const isIso8601Timestamp = (value: string): boolean => {
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,9}))?(Z|[+-]\d{2}:\d{2})$/.exec(value)
  if (match === null) return false
  const [, yearText, monthText, dayText, hourText, minuteText, secondText, , zone] = match
  const year = Number(yearText)
  const month = Number(monthText)
  const day = Number(dayText)
  const hour = Number(hourText)
  const minute = Number(minuteText)
  const second = Number(secondText)
  if (month < 1 || month > 12 || hour > 23 || minute > 59 || second > 59) return false
  const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate()
  if (day < 1 || day > lastDay) return false
  if (zone !== "Z") {
    const zoneHour = Number(zone.slice(1, 3))
    const zoneMinute = Number(zone.slice(4, 6))
    if (zoneHour > 23 || zoneMinute > 59) return false
  }
  return Number.isFinite(Date.parse(value))
}

const Timestamp = Schema.String.pipe(Schema.filter(
  isIso8601Timestamp,
  { message: () => "Expected an ISO 8601 timestamp with a timezone" }
))

const TtlMilliseconds = Schema.Int.pipe(Schema.filter(
  (value) => Number.isSafeInteger(value) && value >= 0,
  { message: () => "Expected non-negative integer milliseconds" }
))

const PollIntervalMilliseconds = Schema.Int.pipe(Schema.filter(
  (value) => Number.isSafeInteger(value) && value > 0,
  { message: () => "Expected positive integer milliseconds" }
))

const StrictJsonObject = Schema.Unknown.pipe(Schema.filter(
  (value): value is Core.JSONObject => {
    const cloned = cloneStrictJson(value)
    return cloned !== invalidStrictJson && typeof cloned === "object" && cloned !== null && !Array.isArray(cloned)
  },
  { message: () => "Expected a plain JSON object" }
))

const taskFields = {
  taskId: TaskId,
  statusMessage: Schema.optional(Schema.String),
  createdAt: Timestamp,
  lastUpdatedAt: Timestamp,
  ttlMs: Schema.Union(TtlMilliseconds, Schema.Null),
  pollIntervalMs: Schema.optional(PollIntervalMilliseconds)
} as const

const resultFields = {
  _meta: Schema.optional(Core.ResultMetaObject),
  resultType: Schema.Literal("complete")
} as const

const notificationFields = {
  _meta: Schema.optional(Core.NotificationMetaObject)
} as const

export const TaskStatus = Schema.Literal(
  "working",
  "input_required",
  "completed",
  "failed",
  "cancelled"
)
export type TaskStatus = typeof TaskStatus.Type

export const Task = Schema.Struct({
  ...taskFields,
  status: TaskStatus
}).annotations(strict)
export type Task = typeof Task.Type

export const WorkingTask = Schema.Struct({
  ...taskFields,
  status: Schema.Literal("working")
}).annotations(strict)
export type WorkingTask = typeof WorkingTask.Type

export const InputRequiredTask = Schema.Struct({
  ...taskFields,
  status: Schema.Literal("input_required"),
  inputRequests: Core.InputRequests
}).annotations(strict)
export type InputRequiredTask = typeof InputRequiredTask.Type

export const CompletedTask = Schema.Struct({
  ...taskFields,
  status: Schema.Literal("completed"),
  result: StrictJsonObject
}).annotations(strict)
export type CompletedTask = typeof CompletedTask.Type

export const FailedTask = Schema.Struct({
  ...taskFields,
  status: Schema.Literal("failed"),
  error: StrictJsonObject
}).annotations(strict)
export type FailedTask = typeof FailedTask.Type

export const CancelledTask = Schema.Struct({
  ...taskFields,
  status: Schema.Literal("cancelled")
}).annotations(strict)
export type CancelledTask = typeof CancelledTask.Type

export const DetailedTask = Schema.Union(
  WorkingTask,
  InputRequiredTask,
  CompletedTask,
  FailedTask,
  CancelledTask
)
export type DetailedTask = typeof DetailedTask.Type

export const CreateTaskResult = Schema.Struct({
  _meta: Schema.optional(Core.ResultMetaObject),
  resultType: Schema.Literal("task"),
  ...taskFields,
  status: TaskStatus
}).annotations(strict)
export type CreateTaskResult = typeof CreateTaskResult.Type

const taskRequestParams = {
  _meta: Core.RequestMetaObject,
  taskId: TaskId
} as const

export const GetTaskRequest = Schema.Struct({
  jsonrpc: Schema.Literal("2.0"),
  id: Core.RequestId,
  method: Schema.Literal("tasks/get"),
  params: Schema.Struct(taskRequestParams).annotations(strict)
}).annotations(strict)
export type GetTaskRequest = typeof GetTaskRequest.Type

export const GetTaskResult = Schema.Union(
  Schema.Struct({ ...resultFields, ...taskFields, status: Schema.Literal("working") }).annotations(strict),
  Schema.Struct({
    ...resultFields,
    ...taskFields,
    status: Schema.Literal("input_required"),
    inputRequests: Core.InputRequests
  }).annotations(strict),
  Schema.Struct({
    ...resultFields,
    ...taskFields,
    status: Schema.Literal("completed"),
    result: StrictJsonObject
  }).annotations(strict),
  Schema.Struct({
    ...resultFields,
    ...taskFields,
    status: Schema.Literal("failed"),
    error: StrictJsonObject
  }).annotations(strict),
  Schema.Struct({ ...resultFields, ...taskFields, status: Schema.Literal("cancelled") }).annotations(strict)
)
export type GetTaskResult = typeof GetTaskResult.Type

export const UpdateTaskRequest = Schema.Struct({
  jsonrpc: Schema.Literal("2.0"),
  id: Core.RequestId,
  method: Schema.Literal("tasks/update"),
  params: Schema.Struct({
    ...taskRequestParams,
    inputResponses: Core.InputResponses
  }).annotations(strict)
}).annotations(strict)
export type UpdateTaskRequest = typeof UpdateTaskRequest.Type

export const UpdateTaskResult = Schema.Struct(resultFields).annotations(strict)
export type UpdateTaskResult = typeof UpdateTaskResult.Type

export const CancelTaskRequest = Schema.Struct({
  jsonrpc: Schema.Literal("2.0"),
  id: Core.RequestId,
  method: Schema.Literal("tasks/cancel"),
  params: Schema.Struct(taskRequestParams).annotations(strict)
}).annotations(strict)
export type CancelTaskRequest = typeof CancelTaskRequest.Type

export const CancelTaskResult = Schema.Struct(resultFields).annotations(strict)
export type CancelTaskResult = typeof CancelTaskResult.Type

export const TaskStatusNotificationParams = Schema.Union(
  Schema.Struct({ ...notificationFields, ...taskFields, status: Schema.Literal("working") }).annotations(strict),
  Schema.Struct({
    ...notificationFields,
    ...taskFields,
    status: Schema.Literal("input_required"),
    inputRequests: Core.InputRequests
  }).annotations(strict),
  Schema.Struct({
    ...notificationFields,
    ...taskFields,
    status: Schema.Literal("completed"),
    result: StrictJsonObject
  }).annotations(strict),
  Schema.Struct({
    ...notificationFields,
    ...taskFields,
    status: Schema.Literal("failed"),
    error: StrictJsonObject
  }).annotations(strict),
  Schema.Struct({ ...notificationFields, ...taskFields, status: Schema.Literal("cancelled") }).annotations(strict)
)
export type TaskStatusNotificationParams = typeof TaskStatusNotificationParams.Type

export const TaskStatusNotification = Schema.Struct({
  jsonrpc: Schema.Literal("2.0"),
  method: Schema.Literal("notifications/tasks"),
  params: TaskStatusNotificationParams
}).annotations(strict)
export type TaskStatusNotification = typeof TaskStatusNotification.Type

const TaskIds = Schema.Array(TaskId)

export type TaskSubscriptionNotifications = Core.SubscriptionFilter & {
  readonly taskIds?: ReadonlyArray<string> | undefined
}

const isTaskSubscriptionNotifications = (
  value: unknown
): value is TaskSubscriptionNotifications => {
  const cloned = cloneStrictJson(value)
  if (cloned === invalidStrictJson || typeof cloned !== "object" || cloned === null || Array.isArray(cloned)) {
    return false
  }
  const { taskIds, ...coreNotifications } = cloned as Record<string, Core.JSONValue>
  if (taskIds !== undefined && Schema.decodeUnknownEither(TaskIds)(taskIds)._tag === "Left") return false
  return Schema.decodeUnknownEither(Core.SubscriptionFilter)(coreNotifications)._tag === "Right"
}

export const TaskSubscriptionNotifications: Schema.Schema<
  TaskSubscriptionNotifications,
  unknown
> = Schema.Unknown.pipe(Schema.filter(
  isTaskSubscriptionNotifications,
  { message: () => "Expected core subscription notifications with optional task IDs" }
))

export type TaskSubscriptionAcknowledgedNotifications = TaskSubscriptionNotifications

export const TaskSubscriptionAcknowledgedNotifications: Schema.Schema<
  TaskSubscriptionAcknowledgedNotifications,
  unknown
> = TaskSubscriptionNotifications

export type TasksExtensionCapability = Readonly<Record<string, never>>

export const TasksExtensionCapability: Schema.Schema<
  TasksExtensionCapability,
  unknown
> = Schema.Unknown.pipe(Schema.filter(
  (value): value is TasksExtensionCapability => {
    const cloned = cloneStrictJson(value)
    return cloned !== invalidStrictJson && typeof cloned === "object" && cloned !== null &&
      !Array.isArray(cloned) && Object.keys(cloned).length === 0
  },
  { message: () => "Expected an empty Tasks extension capability object" }
))
