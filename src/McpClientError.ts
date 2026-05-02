import { Data } from "effect"

export type McpClientErrorReason =
  | "Transport"
  | "Protocol"
  | "NotInitialized"
  | "CapabilityNotSupported"
  | "Timeout"
  | "SessionExpired"

export class McpClientError extends Data.TaggedError(
  "McpClientError"
)<{
  readonly reason: McpClientErrorReason
  readonly message: string
  readonly cause?: unknown
}> {}
