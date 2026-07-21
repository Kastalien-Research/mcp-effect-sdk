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
  const mapped = new Map<Cause.Cause<E>, Cause.Cause<SchemaValidationError>>()
  const pending: Array<{ readonly cause: Cause.Cause<E>; readonly expanded: boolean }> = [
    { cause, expanded: false }
  ]

  while (pending.length > 0) {
    const frame = pending.pop()!
    const current = frame.cause
    if (mapped.has(current)) continue

    switch (current._tag) {
      case "Empty":
        mapped.set(current, Cause.empty)
        break
      case "Fail":
        mapped.set(current, Cause.fail(onFailure(current.error, original)))
        break
      case "Die":
        mapped.set(current, Cause.fail(onDefect(current.defect, original)))
        break
      case "Interrupt":
        mapped.set(current, Cause.interrupt(current.fiberId))
        break
      case "Sequential":
      case "Parallel":
        if (!frame.expanded) {
          pending.push({ cause: current, expanded: true })
          if (!mapped.has(current.right)) pending.push({ cause: current.right, expanded: false })
          if (!mapped.has(current.left)) pending.push({ cause: current.left, expanded: false })
          break
        }
        mapped.set(
          current,
          current._tag === "Sequential"
            ? Cause.sequential(mapped.get(current.left)!, mapped.get(current.right)!)
            : Cause.parallel(mapped.get(current.left)!, mapped.get(current.right)!)
        )
        break
    }
  }

  return mapped.get(cause)!
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
    (error, original) => typedFailureWithCompleteCause(error, original, onUnhandled),
    (_defect, original) => onUnhandled(original)
  )
)))
