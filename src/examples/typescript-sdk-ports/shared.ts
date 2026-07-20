import * as Effect from "effect/Effect"
import type * as McpClient from "../../McpClient.js"
import * as McpSchema from "../../McpSchema.js"

/** The outcome of porting one official TypeScript SDK example story. */
export type PortStatus =
  | "ported"
  | "partial"
  | "blocked"
  | "already-covered"
  | "excluded-legacy"
  | "support-code"

export interface PortDiagnostic {
  readonly story: string
  readonly upstream: string
  readonly status: PortStatus
  readonly local?: string | undefined
  readonly demonstrates: ReadonlyArray<string>
  readonly problems: ReadonlyArray<string>
}

export const text = (value: string): McpSchema.TextContent =>
  McpSchema.TextContent.makeUnsafe({ type: "text", text: value })

export const promptMessage = (value: string): McpSchema.PromptMessage =>
  McpSchema.PromptMessage.makeUnsafe({ role: "user", content: text(value) })

export function assert(
  condition: unknown,
  message: string
): asserts condition {
  if (!condition) {
    throw new Error(`Official SDK example assertion failed: ${message}`)
  }
}

export const firstText = (
  result: McpSchema.CallToolResult
): string | undefined => {
  const first = result.content[0]
  return first?.type === "text" ? first.text : undefined
}

export type ClientScenario = (
  client: McpClient.McpClient
) => Effect.Effect<void, unknown, unknown>
