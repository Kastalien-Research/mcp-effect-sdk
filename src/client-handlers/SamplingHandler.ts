/**
 * Interface service for handling server-initiated sampling requests.
 *
 * Provide a Layer implementing this service to enable `sampling` in
 * the client's advertised capabilities. If omitted, the client will
 * not advertise sampling support and will return -32601 for any
 * incoming sampling/createMessage requests.
 */
import { Context, Effect, Schema } from "effect"
import { CreateMessage, CreateMessageResult } from "../McpSchema.js"

export class SamplingHandler extends Context.Tag("mcp/SamplingHandler")<
  SamplingHandler,
  {
    readonly handle: (
      params: Schema.Schema.Type<typeof CreateMessage.payloadSchema>
    ) => Effect.Effect<CreateMessageResult, unknown>
  }
>() {}
