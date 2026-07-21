import { Data } from "effect"

export type McpClientErrorReason =
  | "Transport"
  | "Protocol"
  | "CapabilityNotSupported"
  | "Timeout"
  | "Cache"
  // Raised when the negotiated server does not advertise this client's
  // protocol version in its `server/discover` response (2026-07-28 draft).
  | "UnsupportedProtocolVersion"
  // Raised when a server returns an `input_required` (MRTR) interim result.
  // Full multi-round-trip retry handling is tracked as follow-up work.
  | "InputRequired"

export class McpClientError extends Data.TaggedError(
  "McpClientError"
)<{
  readonly reason: McpClientErrorReason
  readonly message: string
  readonly cause?: unknown
}> {}
