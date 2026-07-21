import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import path from "node:path"
import test from "node:test"
import { fileURLToPath } from "node:url"

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..")
const packageJson = JSON.parse(readFileSync(path.join(root, "package.json"), "utf8"))

const expectedRuntimeExports = [
  "CancelTaskRequest",
  "CancelTaskResult",
  "CancelledTask",
  "CompletedTask",
  "CreateTaskResult",
  "DetailedTask",
  "FailedTask",
  "GetTaskRequest",
  "GetTaskResult",
  "InputRequiredTask",
  "TASKS_EXTENSION_ID",
  "TASKS_EXTENSION_REVISION",
  "TASKS_MISSING_REQUIRED_CLIENT_CAPABILITY_ERROR_CODE",
  "TASKS_STABILITY",
  "TASKS_SUPPORTED_AUGMENTED_METHODS",
  "Task",
  "TaskStatus",
  "TaskStatusNotification",
  "TaskStatusNotificationParams",
  "TaskSubscriptionAcknowledgedNotifications",
  "TaskSubscriptionNotifications",
  "TasksExtensionCapability",
  "UpdateTaskRequest",
  "UpdateTaskResult",
  "WorkingTask"
].sort()

test("only the experimental Tasks subpath is published", async () => {
  assert.deepEqual(packageJson.exports["./experimental/tasks"], {
    import: "./dist/experimental/tasks.js",
    types: "./dist/experimental/tasks.d.ts"
  })

  const tasks = await import("mcp-effect-sdk/experimental/tasks")
  assert.deepEqual(Object.keys(tasks).sort(), expectedRuntimeExports)

  for (const stable of ["mcp-effect-sdk", "mcp-effect-sdk/client", "mcp-effect-sdk/server", "mcp-effect-sdk/protocol/2026-07-28"]) {
    const api = await import(stable)
    assert.equal("Task" in api, false, stable)
    assert.equal("McpTasks" in api, false, stable)
    assert.equal("TASKS_EXTENSION_ID" in api, false, stable)
  }
})

test("the public Tasks documentation marks the pinned surface experimental", () => {
  const docs = readFileSync(path.join(root, "docs/extensions.md"), "utf8")
  assert.match(docs, /mcp-effect-sdk\/experimental\/tasks/)
  assert.match(docs, /2c1425d9a288b9b1f489430fe1e00bb392b47e48/)
  assert.match(docs, /outside (?:the )?stable SemVer/i)
})
