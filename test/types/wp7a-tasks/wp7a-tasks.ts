import * as Schema from "effect/Schema"
import * as Root from "mcp-effect-sdk"
import * as Client from "mcp-effect-sdk/client"
import * as Protocol from "mcp-effect-sdk/protocol/2026-07-28"
import * as Server from "mcp-effect-sdk/server"
import {
  CancelTaskRequest,
  CancelTaskResult,
  CancelledTask,
  CompletedTask,
  CreateTaskResult,
  DetailedTask,
  FailedTask,
  GetTaskRequest,
  GetTaskResult,
  InputRequiredTask,
  Task,
  TaskStatus,
  TaskStatusNotification,
  TaskStatusNotificationParams,
  TaskSubscriptionAcknowledgedNotifications,
  TaskSubscriptionNotifications,
  TasksExtensionCapability,
  UpdateTaskRequest,
  UpdateTaskResult,
  WorkingTask
} from "mcp-effect-sdk/experimental/tasks"

type Equal<A, B> = (<T>() => T extends A ? 1 : 2) extends
  (<T>() => T extends B ? 1 : 2) ? true : false
type Assert<T extends true> = T

type _Status = Assert<Equal<TaskStatus,
  "working" | "input_required" | "completed" | "failed" | "cancelled">>
type _CreateDiscriminator = Assert<Equal<CreateTaskResult["resultType"], "task">>
type _GetDiscriminator = Assert<Equal<GetTaskResult["resultType"], "complete">>
type _UpdateDiscriminator = Assert<Equal<UpdateTaskResult["resultType"], "complete">>
type _CancelDiscriminator = Assert<Equal<CancelTaskResult["resultType"], "complete">>
type _GetMethod = Assert<Equal<GetTaskRequest["method"], "tasks/get">>
type _UpdateMethod = Assert<Equal<UpdateTaskRequest["method"], "tasks/update">>
type _CancelMethod = Assert<Equal<CancelTaskRequest["method"], "tasks/cancel">>
type _NotificationMethod = Assert<Equal<TaskStatusNotification["method"], "notifications/tasks">>
type _DetailedStatus = Assert<Equal<DetailedTask["status"], TaskStatus>>
type _Capability = Assert<Equal<TasksExtensionCapability[string], never>>

const task: Task = Schema.decodeUnknownSync(Task)({
  taskId: "task-1",
  status: "working",
  createdAt: "2026-07-21T12:30:00Z",
  lastUpdatedAt: "2026-07-21T12:31:00Z",
  ttlMs: null
})
const variants: ReadonlyArray<DetailedTask> = [
  task as WorkingTask,
  {} as InputRequiredTask,
  {} as CompletedTask,
  {} as FailedTask,
  {} as CancelledTask
]
const params: TaskStatusNotificationParams = {} as TaskStatusNotificationParams
const requested: TaskSubscriptionNotifications = { taskIds: ["task-1"], toolsListChanged: true }
const acknowledged: TaskSubscriptionAcknowledgedNotifications = { taskIds: ["task-1"] }

// @ts-expect-error Tasks are not exposed by the stable root
void Root.Task
// @ts-expect-error Tasks are not exposed by the stable client subpath
void Client.Task
// @ts-expect-error Tasks are not exposed by the stable server subpath
void Server.Task
// @ts-expect-error Tasks are not part of the generated stable protocol subpath
void Protocol.Task

void variants
void params
void requested
void acknowledged
void (null as unknown as _Status)
void (null as unknown as _CreateDiscriminator)
void (null as unknown as _GetDiscriminator)
void (null as unknown as _UpdateDiscriminator)
void (null as unknown as _CancelDiscriminator)
void (null as unknown as _GetMethod)
void (null as unknown as _UpdateMethod)
void (null as unknown as _CancelMethod)
void (null as unknown as _NotificationMethod)
void (null as unknown as _DetailedStatus)
void (null as unknown as _Capability)
