/** Migration-only service shape retained for source compatibility. */
import type { Effect } from "effect"
import { Context } from "effect"
import type { ListRootsResult } from "../McpSchema.js"

/** @deprecated Use InputRequiredPolicy roots handling. This tag installs no request routing. */
export class RootsProvider extends Context.Tag("mcp/RootsProvider")<
  RootsProvider,
  {
    readonly list: Effect.Effect<ListRootsResult, unknown>
  }
>() {}
