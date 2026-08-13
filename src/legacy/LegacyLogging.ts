/** Connection-scoped logging level state for MCP 2025-11-25. */
import * as Effect from "effect/Effect"
import * as Ref from "effect/Ref"
import type { LoggingLevel, LoggingMessageNotificationParams } from "../generated/mcp/2025-11-25/McpSchema.generated.js"
import { LegacyConnectionError, type LegacyRequestHandler } from "./Connection.js"

type Level = typeof LoggingLevel.Type
const levels: ReadonlyArray<Level> = ["debug", "info", "notice", "warning", "error", "critical", "alert", "emergency"]

export interface LegacyLogging {
  readonly handler: LegacyRequestHandler
  readonly level: Effect.Effect<Level>
  readonly log: (params: LoggingMessageNotificationParams) => Effect.Effect<boolean, LegacyConnectionError>
}

export const makeLogging = (options: {
  readonly notify: (
    method: "notifications/message",
    params: LoggingMessageNotificationParams
  ) => Effect.Effect<void, LegacyConnectionError>
  readonly initialLevel?: Level
}): Effect.Effect<LegacyLogging> =>
  Effect.gen(function* () {
    const level = yield* Ref.make<Level>(options.initialLevel ?? "info")
    const handler: LegacyRequestHandler = (params) => {
      const next = (params as { readonly level?: unknown }).level
      return typeof next === "string" && levels.includes(next as Level)
        ? Ref.set(level, next as Level).pipe(Effect.as({}))
        : Effect.fail(new LegacyConnectionError({ stage: "Protocol", code: -32602, message: "Invalid log level" }))
    }
    return {
      handler,
      level: Ref.get(level),
      log: (params) =>
        Ref.get(level).pipe(
          Effect.flatMap((minimum) =>
            levels.indexOf(params.level) >= levels.indexOf(minimum)
              ? options.notify("notifications/message", params).pipe(Effect.as(true))
              : Effect.succeed(false)
          )
        )
    }
  })
