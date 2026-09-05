import * as Context from "effect/Context"
import * as Effect from "effect/Effect"

/** Request-local annotations shared by direct dispatch and scoped streams. */
export const currentRequestAnnotations = Context.Reference<Readonly<Record<string, unknown>>>(
  "mcp/RequestAnnotations",
  { defaultValue: () => ({}) }
)

export const withRequestAnnotations = <A, E, R>(
  annotations: Readonly<Record<string, unknown>>,
  effect: Effect.Effect<A, E, R>
): Effect.Effect<A, E, R> => Effect.provideService(effect, currentRequestAnnotations, annotations)
