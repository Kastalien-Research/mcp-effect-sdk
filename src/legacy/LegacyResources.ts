/** Connection-scoped resource subscriptions for MCP 2025-11-25. */
import * as Effect from "effect/Effect"
import * as Ref from "effect/Ref"
import { LegacyConnectionError, type LegacyRequestHandler } from "./Connection.js"

export interface LegacyResourceSubscriptions {
  readonly handlers: Readonly<Record<string, LegacyRequestHandler>>
  readonly isSubscribed: (uri: string) => Effect.Effect<boolean>
  readonly publishUpdated: (uri: string) => Effect.Effect<boolean, LegacyConnectionError>
  readonly clear: Effect.Effect<void>
}

const invalidUri = (message: string) => new LegacyConnectionError({ stage: "Protocol", code: -32602, message })

const validateUri = (value: unknown): Effect.Effect<string, LegacyConnectionError> => {
  if (typeof value !== "string" || value.length === 0) return Effect.fail(invalidUri("Resource URI is required"))
  try {
    new URL(value)
    return Effect.succeed(value)
  } catch {
    return Effect.fail(invalidUri("Resource URI must be an absolute URI"))
  }
}

export const makeResourceSubscriptions = (options: {
  readonly notify: (
    method: "notifications/resources/updated",
    params: { readonly uri: string }
  ) => Effect.Effect<void, LegacyConnectionError>
}): Effect.Effect<LegacyResourceSubscriptions> =>
  Effect.gen(function* () {
    const uris = yield* Ref.make(new Set<string>())
    const subscribe: LegacyRequestHandler = (params) =>
      validateUri((params as { readonly uri?: unknown }).uri).pipe(
        Effect.flatMap((uri) =>
          Ref.update(uris, (current) => {
            const next = new Set(current)
            next.add(uri)
            return next
          })
        ),
        Effect.as({})
      )
    const unsubscribe: LegacyRequestHandler = (params) =>
      validateUri((params as { readonly uri?: unknown }).uri).pipe(
        Effect.flatMap((uri) =>
          Ref.update(uris, (current) => {
            const next = new Set(current)
            next.delete(uri)
            return next
          })
        ),
        Effect.as({})
      )
    return {
      handlers: {
        "resources/subscribe": subscribe,
        "resources/unsubscribe": unsubscribe
      },
      isSubscribed: (uri) => Ref.get(uris).pipe(Effect.map((current) => current.has(uri))),
      publishUpdated: (uri) =>
        Ref.get(uris).pipe(
          Effect.flatMap((current) =>
            current.has(uri)
              ? options.notify("notifications/resources/updated", { uri }).pipe(Effect.as(true))
              : Effect.succeed(false)
          )
        ),
      clear: Ref.set(uris, new Set())
    }
  })
