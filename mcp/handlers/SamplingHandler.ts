/**
 * Interface service for handling server-initiated sampling requests.
 *
 * Provide a Layer implementing this service to enable `sampling` in
 * the client's advertised capabilities. If omitted, the client will
 * not advertise sampling support and will return -32601 for any
 * incoming sampling/createMessage requests.
 */
import { Effect, Schema } from "effect"
import { CreateMessage, CreateMessageResult, McpError } from "../McpSchema.js"

type CreateMessagePayload = Schema.Schema.Type<
  typeof CreateMessage.payloadSchema
>

export class SamplingHandler extends Effect.Tag(
  "mcp/SamplingHandler"
)<
  SamplingHandler,
  {
    readonly handle: (
      params: CreateMessagePayload
    ) => Effect.Effect<CreateMessageResult, McpError>
  }
>() {}
