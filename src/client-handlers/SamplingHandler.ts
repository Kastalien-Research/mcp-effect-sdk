/** Migration-only service shape retained for source compatibility. */
import type { Effect, Schema } from "effect"
import { Context } from "effect"
import type { CreateMessage, CreateMessageResult } from "../McpSchema.js"

/** @deprecated Use InputRequiredPolicy sampling handling. This tag installs no request routing. */
export class SamplingHandler extends Context.Service<
  SamplingHandler,
  {
    readonly handle: (
      params: Schema.Schema.Type<typeof CreateMessage.payloadSchema>
    ) => Effect.Effect<CreateMessageResult, unknown>
  }
>()("mcp/SamplingHandler") {}
