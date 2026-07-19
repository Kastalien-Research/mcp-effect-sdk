import * as Cause from "effect/Cause"
import * as Effect from "effect/Effect"
import { SchemaValidationError } from "../McpErrors.js"

const typedFailureWithCompleteCause = <E>(
  error: SchemaValidationError,
  original: Cause.Cause<E>,
  onUnhandled: (cause: Cause.Cause<E>) => SchemaValidationError
): SchemaValidationError => {
  try {
    const existingCause = Object.getOwnPropertyDescriptor(error, "cause")
    if (existingCause !== undefined && "value" in existingCause && existingCause.value === original) {
      return error
    }
    const message = Object.getOwnPropertyDescriptor(error, "message")
    const data = Object.getOwnPropertyDescriptor(error, "data")
    if (message === undefined || !("value" in message) || typeof message.value !== "string" ||
      (data !== undefined && !("value" in data))) {
      return onUnhandled(original)
    }
    const completed = new SchemaValidationError({
      message: message.value,
      ...(data === undefined ? {} : { data: data.value }),
      cause: original
    })
    Object.defineProperty(completed, "cause", {
      configurable: true,
      enumerable: false,
      value: original,
      writable: false
    })
    return completed
  } catch {
    return onUnhandled(original)
  }
}

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
    (error, original) => error instanceof SchemaValidationError
      ? typedFailureWithCompleteCause(error, original, onUnhandled)
      : onUnhandled(original),
    (_defect, original) => onUnhandled(original)
  )
)))
