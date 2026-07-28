/**
 * Interface service for providing roots to the server.
 *
 * Provide a Layer implementing this service to enable `roots` in
 * the client's advertised capabilities. If omitted, the client will
 * not advertise roots support and will return -32601 for any
 * incoming roots/list requests.
 */
import { Context, Effect } from "effect"
import { ListRootsResult } from "../McpSchema.js"

export class RootsProvider extends Context.Tag("mcp/RootsProvider")<
  RootsProvider,
  {
    readonly list: Effect.Effect<ListRootsResult, unknown>
  }
>() {}
