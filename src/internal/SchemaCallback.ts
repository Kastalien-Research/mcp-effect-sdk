import * as Cause from "effect/Cause"
import * as Effect from "effect/Effect"
import { SchemaValidationError } from "../McpErrors.js"

export const mapSchemaCause = <E>(
  cause: Cause.Cause<E>,
  original: Cause.Cause<E>,
  onFailure: (error: E, cause: Cause.Cause<E>) => SchemaValidationError,
  onDefect: (defect: unknown, cause: Cause.Cause<E>) => SchemaValidationError
): Cause.Cause<SchemaValidationError> => {
  switch (cause._tag) {
    case "Empty":
      return Cause.empty
    case "Fail":
      return Cause.fail(onFailure(cause.error, original))
    case "Die":
      return Cause.fail(onDefect(cause.defect, original))
    case "Interrupt":
      return Cause.interrupt(cause.fiberId)
    case "Sequential":
      return Cause.sequential(
        mapSchemaCause(cause.left, original, onFailure, onDefect),
        mapSchemaCause(cause.right, original, onFailure, onDefect)
      )
    case "Parallel":
      return Cause.parallel(
        mapSchemaCause(cause.left, original, onFailure, onDefect),
        mapSchemaCause(cause.right, original, onFailure, onDefect)
      )
  }
}

/** @internal Contains user callbacks without discarding Cause composition or interruption. */
export const containSchemaCallback = <A, E, R>(
  thunk: () => Effect.Effect<A, E, R>,
  onUnhandled: (cause: Cause.Cause<E>) => SchemaValidationError
): Effect.Effect<A, SchemaValidationError, R> => Effect.suspend(() => {
  const result = thunk()
  return Effect.isEffect(result)
    ? result
    : Effect.die(new TypeError("JSON Schema callback must return an Effect"))
}).pipe(Effect.catchAllCause((cause) => Effect.failCause(
  mapSchemaCause(
    cause,
    cause,
    (error, original) => error instanceof SchemaValidationError ? error : onUnhandled(original),
    (_defect, original) => onUnhandled(original)
  )
)))
