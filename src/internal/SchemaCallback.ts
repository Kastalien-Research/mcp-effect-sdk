import * as Cause from "effect/Cause"
import * as Effect from "effect/Effect"
import { SchemaValidationError } from "../McpErrors.js"

const typedFailureWithCompleteCause = <E>(
  error: unknown,
  original: Cause.Cause<E>,
  onUnhandled: (cause: Cause.Cause<E>) => SchemaValidationError
): SchemaValidationError => {
  try {
    if (!(error instanceof SchemaValidationError)) return onUnhandled(original)
    const existingCause = Object.getOwnPropertyDescriptor(error, "cause")
    if (existingCause !== undefined && "value" in existingCause && existingCause.value === original) {
      return error
    }
    const message = Object.getOwnPropertyDescriptor(error, "message")
    const data = Object.getOwnPropertyDescriptor(error, "data")
    if (
      message === undefined ||
      !("value" in message) ||
      typeof message.value !== "string" ||
      (data !== undefined && !("value" in data))
    ) {
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
): Cause.Cause<SchemaValidationError> =>
  Cause.fromReasons(
    cause.reasons.map((reason) => {
      switch (reason._tag) {
        case "Fail":
          return Cause.makeFailReason(onFailure(reason.error, original))
        case "Die":
          return Cause.makeFailReason(onDefect(reason.defect, original))
        case "Interrupt":
          return reason
      }
    })
  )

/** @internal Contains user callbacks without discarding Cause composition or interruption. */
export const containSchemaCallback = <A, E, R>(
  thunk: () => Effect.Effect<A, E, R>,
  onUnhandled: (cause: Cause.Cause<E>) => SchemaValidationError
): Effect.Effect<A, SchemaValidationError, R> =>
  Effect.suspend(() => {
    const result = thunk()
    return Effect.isEffect(result) ? result : Effect.die(new TypeError("JSON Schema callback must return an Effect"))
  }).pipe(
    Effect.catchCause((cause) =>
      Effect.failCause(
        mapSchemaCause(
          cause,
          cause,
          (error, original) => typedFailureWithCompleteCause(error, original, onUnhandled),
          (_defect, original) => onUnhandled(original)
        )
      )
    )
  )
