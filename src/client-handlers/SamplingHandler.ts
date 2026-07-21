/** Migration-only service shape retained for source compatibility. */
import { Context, Effect, Schema } from "effect"
import { CreateMessage, CreateMessageResult } from "../McpSchema.js"

/** @deprecated Use InputRequiredPolicy sampling handling. This tag installs no request routing. */
export class SamplingHandler extends Context.Tag("mcp/SamplingHandler")<
  SamplingHandler,
  {
    readonly handle: (
      params: Schema.Schema.Type<typeof CreateMessage.payloadSchema>
    ) => Effect.Effect<CreateMessageResult, unknown>
  }
>() {}
