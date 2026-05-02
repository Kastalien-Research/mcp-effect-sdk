/**
 * Interface service for handling server-initiated sampling requests.
 *
 * Provide a Layer implementing this service to enable `sampling` in
 * the client's advertised capabilities. If omitted, the client will
 * not advertise sampling support and will return -32601 for any
 * incoming sampling/createMessage requests.
 */
import { Effect, Schema, ServiceMap } from "effect"
import { CreateMessage, CreateMessageResult, McpError } from "../McpSchema.js"

export class SamplingHandler extends ServiceMap.Service<
  SamplingHandler,
  {
    readonly handle: (
      params: Schema.Schema.Type<typeof CreateMessage.payloadSchema>
    ) => Effect.Effect<CreateMessageResult, unknown>
  }
>()("mcp/SamplingHandler") {}
