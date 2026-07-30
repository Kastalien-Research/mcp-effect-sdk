import * as Schema from "effect/Schema"
import * as Tasks from "mcp-effect-sdk/experimental/tasks"
import { McpSchema } from "mcp-effect-sdk/protocol/2026-07-28"

export const taskTimestamp = "2026-07-28T00:00:00.000Z"

export const task = (
  taskId: string,
  status: Tasks.TaskStatus = "working",
  overrides: Partial<Tasks.Task> = {}
): Tasks.Task =>
  Schema.decodeUnknownSync(Tasks.Task)({
    taskId,
    status,
    createdAt: taskTimestamp,
    lastUpdatedAt: taskTimestamp,
    ttlMs: 60_000,
    pollIntervalMs: 500,
    ...overrides
  })

export const text = (value: string): McpSchema.TextContent =>
  new McpSchema.TextContent({ type: "text", text: value })

export const toolResult = (
  message: string,
  structuredContent?: Record<string, unknown> | undefined
): McpSchema.CallToolResult =>
  new McpSchema.CallToolResult({
    resultType: "complete",
    content: [text(message)],
    structuredContent
  })

export const requestMeta = {
  "io.modelcontextprotocol/protocolVersion": "2026-07-28",
  "io.modelcontextprotocol/clientCapabilities": {
    extensions: {
      [Tasks.TASKS_EXTENSION_ID]: {}
    }
  }
} as const

export const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value)
