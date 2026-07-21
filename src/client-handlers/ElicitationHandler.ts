/**
 * Interface service for handling server-initiated elicitation requests.
 *
 * Provide a Layer implementing this service to enable `elicitation` in
 * the client's advertised capabilities. If omitted, the client will
 * not advertise elicitation support and will return -32601 for any
 * incoming elicitation/create requests.
 */
import { Context, Effect, Schema } from "effect"
import { Elicit, ElicitResult } from "../McpSchema.js"

type ElicitPayload = Schema.Schema.Type<
  typeof Elicit.payloadSchema
>

export class ElicitationHandler extends Context.Tag("mcp/ElicitationHandler")<
  ElicitationHandler,
  {
    readonly handle: (
      params: ElicitPayload
    ) => Effect.Effect<typeof ElicitResult.Type, unknown>
  }
>() {}
