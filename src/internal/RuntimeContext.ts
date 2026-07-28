import * as FiberRef from "effect/FiberRef"
import * as Effect from "effect/Effect"

/** Request-local annotations shared by direct dispatch and scoped streams. */
export const currentRequestAnnotations = FiberRef.unsafeMake<Readonly<Record<string, unknown>>>({})

export const withRequestAnnotations = <A, E, R>(
  annotations: Readonly<Record<string, unknown>>,
  effect: Effect.Effect<A, E, R>
): Effect.Effect<A, E, R> => Effect.locally(effect, currentRequestAnnotations, annotations)
