import * as McpSchema from "../../src/McpSchema.js"
import { RELATED_TASK_META_KEY } from "../../src/McpTasks.js"

export const text = (value: string): McpSchema.TextContent =>
  McpSchema.TextContent.makeUnsafe({ type: "text", text: value })

export const toolResult = (
  message: string,
  structuredContent?: Record<string, unknown> | undefined
): McpSchema.CallToolResult =>
  new McpSchema.CallToolResult({
    content: [text(message)],
    structuredContent
  })

export const relatedTaskId = (meta: unknown): string | undefined => {
  if (!isRecord(meta)) {
    return undefined
  }
  const related = meta[RELATED_TASK_META_KEY]
  if (!isRecord(related)) {
    return undefined
  }
  return typeof related.taskId === "string" ? related.taskId : undefined
}

export const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value)
