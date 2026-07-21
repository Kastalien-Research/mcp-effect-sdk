import assert from "node:assert/strict"
import test from "node:test"

import * as Either from "effect/Either"
import * as Schema from "effect/Schema"

import * as Tasks from "../../dist/experimental/tasks.js"

const requestMeta = {
  "io.modelcontextprotocol/clientCapabilities": {
    extensions: { "io.modelcontextprotocol/tasks": {} }
  },
  "io.modelcontextprotocol/protocolVersion": "2026-07-28"
}

const baseTask = {
  taskId: "task-123",
  createdAt: "2026-07-21T12:30:00Z",
  lastUpdatedAt: "2026-07-21T12:31:00Z",
  ttlMs: 60_000,
  pollIntervalMs: 1_000
}

const inputRequest = {
  method: "roots/list",
  params: { _meta: requestMeta }
}

const inputResponse = {
  resultType: "complete",
  roots: [{ uri: "file:///workspace", name: "workspace" }]
}

const detailedTasks = [
  { ...baseTask, status: "working", statusMessage: "running" },
  { ...baseTask, status: "input_required", inputRequests: { roots: inputRequest } },
  { ...baseTask, status: "completed", result: { content: [{ type: "text", text: "done" }] } },
  { ...baseTask, status: "failed", error: { code: -32603, message: "failed", data: null } },
  { ...baseTask, status: "cancelled" }
]

const roundTrip = (schema, wire) =>
  Schema.encodeSync(schema)(Schema.decodeUnknownSync(schema)(wire))

const fails = (schema, wire) =>
  Either.isLeft(Schema.decodeUnknownEither(schema)(wire))

test("Tasks constants pin the experimental extension contract", () => {
  assert.equal(Tasks.TASKS_EXTENSION_ID, "io.modelcontextprotocol/tasks")
  assert.equal(Tasks.TASKS_EXTENSION_REVISION, "2c1425d9a288b9b1f489430fe1e00bb392b47e48")
  assert.equal(Tasks.TASKS_STABILITY, "experimental")
  assert.deepEqual(Tasks.TASKS_SUPPORTED_AUGMENTED_METHODS, ["tools/call"])
  assert.equal(Tasks.TASKS_MISSING_REQUIRED_CLIENT_CAPABILITY_ERROR_CODE, -32021)
})

test("Task and every status-specific DetailedTask round trip", () => {
  for (const task of detailedTasks) {
    const summary = {
      taskId: task.taskId,
      status: task.status,
      statusMessage: task.statusMessage,
      createdAt: task.createdAt,
      lastUpdatedAt: task.lastUpdatedAt,
      ttlMs: task.ttlMs,
      pollIntervalMs: task.pollIntervalMs
    }
    if (summary.statusMessage === undefined) delete summary.statusMessage
    assert.deepEqual(roundTrip(Tasks.Task, summary), summary)
    assert.deepEqual(roundTrip(Tasks.DetailedTask, task), task)
    const statusSchema = {
      working: Tasks.WorkingTask,
      input_required: Tasks.InputRequiredTask,
      completed: Tasks.CompletedTask,
      failed: Tasks.FailedTask,
      cancelled: Tasks.CancelledTask
    }[task.status]
    assert.deepEqual(roundTrip(statusSchema, task), task)
  }

  assert.deepEqual(roundTrip(Tasks.Task, { ...baseTask, status: "working", ttlMs: null }), {
    ...baseTask,
    status: "working",
    ttlMs: null
  })
})

test("CreateTaskResult is flat and preserves the task discriminator", () => {
  const result = { resultType: "task", ...baseTask, status: "working" }
  assert.deepEqual(roundTrip(Tasks.CreateTaskResult, result), result)
  assert.equal(fails(Tasks.CreateTaskResult, { resultType: "task", task: { ...baseTask, status: "working" } }), true)
  assert.equal(fails(Tasks.CreateTaskResult, { ...baseTask, status: "working" }), true)
  assert.equal(fails(Tasks.CreateTaskResult, { resultType: "complete", ...baseTask, status: "working" }), true)
})

test("tasks/get round trips every detailed status with mandatory core request metadata", () => {
  const request = {
    jsonrpc: "2.0",
    id: "get-1",
    method: "tasks/get",
    params: { _meta: requestMeta, taskId: baseTask.taskId }
  }
  assert.deepEqual(roundTrip(Tasks.GetTaskRequest, request), request)

  for (const task of detailedTasks) {
    const result = { resultType: "complete", ...task }
    assert.deepEqual(roundTrip(Tasks.GetTaskResult, result), result)
  }
})

test("tasks/update and tasks/cancel round trip exact complete acknowledgements", () => {
  const updateRequest = {
    jsonrpc: "2.0",
    id: 2,
    method: "tasks/update",
    params: {
      _meta: requestMeta,
      taskId: baseTask.taskId,
      inputResponses: { roots: inputResponse }
    }
  }
  const cancelRequest = {
    jsonrpc: "2.0",
    id: 3,
    method: "tasks/cancel",
    params: { _meta: requestMeta, taskId: baseTask.taskId }
  }
  const acknowledgement = { resultType: "complete" }

  assert.deepEqual(roundTrip(Tasks.UpdateTaskRequest, updateRequest), updateRequest)
  assert.deepEqual(roundTrip(Tasks.UpdateTaskResult, acknowledgement), acknowledgement)
  assert.deepEqual(roundTrip(Tasks.CancelTaskRequest, cancelRequest), cancelRequest)
  assert.deepEqual(roundTrip(Tasks.CancelTaskResult, acknowledgement), acknowledgement)
  assert.equal(fails(Tasks.UpdateTaskResult, {}), true)
  assert.equal(fails(Tasks.CancelTaskResult, { resultType: "task" }), true)
  assert.equal(fails(Tasks.CancelTaskResult, { resultType: "complete", taskId: "unexpected" }), true)
})

test("notifications/tasks round trips every detailed status and core subscription metadata", () => {
  for (const task of detailedTasks) {
    const notification = {
      jsonrpc: "2.0",
      method: "notifications/tasks",
      params: {
        _meta: { "io.modelcontextprotocol/subscriptionId": "subscription-1" },
        ...task
      }
    }
    assert.deepEqual(roundTrip(Tasks.TaskStatusNotification, notification), notification)
    assert.deepEqual(roundTrip(Tasks.TaskStatusNotificationParams, notification.params), notification.params)
  }

  const requested = {
    taskIds: ["task-123"],
    toolsListChanged: true,
    resourceSubscriptions: ["file:///workspace"]
  }
  const acknowledged = { taskIds: ["task-123"], promptsListChanged: true }
  assert.deepEqual(roundTrip(Tasks.TaskSubscriptionNotifications, requested), requested)
  assert.deepEqual(roundTrip(Tasks.TaskSubscriptionAcknowledgedNotifications, acknowledged), acknowledged)
  assert.equal(fails(Tasks.TaskSubscriptionNotifications, { taskIds: [""] }), true)
  assert.deepEqual(roundTrip(Tasks.TasksExtensionCapability, {}), {})
  assert.equal(fails(Tasks.TasksExtensionCapability, { enabled: true }), true)
})

test("status-specific schemas reject illegal payload fields", () => {
  const illegal = [
    [{ ...baseTask, status: "working", result: {} }, Tasks.WorkingTask],
    [{ ...baseTask, status: "input_required" }, Tasks.InputRequiredTask],
    [{ ...baseTask, status: "completed", result: {}, error: {} }, Tasks.CompletedTask],
    [{ ...baseTask, status: "failed", error: {}, result: {} }, Tasks.FailedTask],
    [{ ...baseTask, status: "cancelled", inputRequests: {} }, Tasks.CancelledTask]
  ]
  for (const [wire, schema] of illegal) {
    assert.equal(fails(schema, wire), true)
    assert.equal(fails(Tasks.DetailedTask, wire), true)
  }
})

test("operation schemas reject absent or wrong result discriminators and obsolete methods", () => {
  assert.equal(fails(Tasks.GetTaskResult, { ...detailedTasks[0] }), true)
  assert.equal(fails(Tasks.GetTaskResult, { resultType: "task", ...detailedTasks[0] }), true)

  for (const method of ["tasks/list", "tasks/result"]) {
    const obsolete = {
      jsonrpc: "2.0",
      id: 1,
      method,
      params: { _meta: requestMeta, taskId: baseTask.taskId }
    }
    assert.equal(fails(Tasks.GetTaskRequest, obsolete), true)
    assert.equal(fails(Tasks.UpdateTaskRequest, obsolete), true)
    assert.equal(fails(Tasks.CancelTaskRequest, obsolete), true)
  }

  for (const [schema, method, extraParams] of [
    [Tasks.GetTaskRequest, "tasks/get", {}],
    [Tasks.UpdateTaskRequest, "tasks/update", { inputResponses: {} }],
    [Tasks.CancelTaskRequest, "tasks/cancel", {}]
  ]) {
    assert.equal(fails(schema, {
      jsonrpc: "2.0",
      id: 1,
      method,
      params: { taskId: baseTask.taskId, ...extraParams }
    }), true)
  }
})

test("task identifiers, timestamps, TTL, and poll intervals are validated", () => {
  const invalidPatches = [
    { taskId: "" },
    { taskId: 42 },
    { createdAt: "not-a-timestamp" },
    { createdAt: "2026-02-30T12:00:00Z" },
    { lastUpdatedAt: "2026-07-21" },
    { ttlMs: -1 },
    { ttlMs: 1.5 },
    { pollIntervalMs: 0 },
    { pollIntervalMs: 1.5 }
  ]
  for (const patch of invalidPatches) {
    assert.equal(fails(Tasks.Task, { ...baseTask, status: "working", ...patch }), true, JSON.stringify(patch))
  }
})

test("completed results and failed errors reject non-JSON data", () => {
  const nonJson = [
    { value: undefined },
    { value: 1n },
    { value: Number.NaN },
    { value: Number.POSITIVE_INFINITY },
    { value: () => "nope" },
    { value: new Date() }
  ]
  const cyclic = {}
  cyclic.self = cyclic
  nonJson.push(cyclic)

  for (const value of nonJson) {
    assert.equal(fails(Tasks.CompletedTask, { ...baseTask, status: "completed", result: value }), true)
    assert.equal(fails(Tasks.FailedTask, { ...baseTask, status: "failed", error: value }), true)
  }
})
