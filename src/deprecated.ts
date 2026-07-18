/**
 * Explicit compatibility boundary for client hooks retained during the
 * MCP 2026-07-28 clean break. These hooks preserve existing behavior only;
 * they do not restore legacy transports or server-initiated request routing.
 */
import * as Effect from "effect/Effect"
import * as McpServer from "./McpServer.js"
import { SERVER_NOTIFICATION_METHOD_BY_TYPE } from "./generated/mcp/2026-07-28/McpProtocol.generated.js"

/** @deprecated Use MRTR input handling when the modern client API exposes it. */
export { ElicitationHandler } from "./client-handlers/ElicitationHandler.js"
/** @deprecated Roots are no longer a core server-initiated request. */
export { RootsProvider } from "./client-handlers/RootsProvider.js"
/** @deprecated Use MRTR input handling when the modern client API exposes it. */
export { SamplingHandler } from "./client-handlers/SamplingHandler.js"

/** @deprecated Prefer request-scoped logging metadata and modern notification APIs. */
export const sendLoggingMessage = (payload: unknown): Effect.Effect<void, never, McpServer.McpServer> =>
  McpServer.McpServer.pipe(
    Effect.flatMap((server) => server.publish({
      tag: SERVER_NOTIFICATION_METHOD_BY_TYPE.LoggingMessageNotification,
      payload
    })),
    Effect.asVoid
  )
