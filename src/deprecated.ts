/**
 * Explicit compatibility boundary for Roots, Sampling, and Logging hooks
 * retained during the MCP 2026-07-28 clean break. These hooks preserve
 * migration symbols only; they do not restore legacy transports or
 * server-initiated request routing.
 */
import * as Effect from "effect/Effect"
import * as McpServer from "./McpServer.js"
import type { SchemaValidationError } from "./McpErrors.js"
import type { LoggingMessageNotificationParams } from "./generated/mcp/2026-07-28/McpSchema.generated.js"

/** @deprecated Use InputRequiredPolicy roots handling. Standalone server requests are not supported. */
export { RootsProvider } from "./client-handlers/RootsProvider.js"
/** @deprecated Use InputRequiredPolicy sampling handling. Standalone server requests are not supported. */
export { SamplingHandler } from "./client-handlers/SamplingHandler.js"

/** @deprecated Prefer request-scoped logging metadata and modern notification APIs. */
export const sendLoggingMessage = (
  payload: LoggingMessageNotificationParams
): Effect.Effect<void, SchemaValidationError, McpServer.McpRequestContext> =>
  McpServer.McpRequestContext.pipe(Effect.flatMap((context) => context.reportLoggingMessage(payload)))
