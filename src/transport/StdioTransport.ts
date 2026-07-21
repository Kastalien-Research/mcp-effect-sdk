/** Effect-native MCP stdio byte framing and serialized line writing. */
import * as Cause from "effect/Cause"
import * as Data from "effect/Data"
import * as Effect from "effect/Effect"
import * as Either from "effect/Either"
import * as Ref from "effect/Ref"
import * as Scope from "effect/Scope"
import * as Stream from "effect/Stream"
import * as McpWire from "../McpWire.js"

export const DEFAULT_MAX_LINE_BYTES = 1024 * 1024

export type StdioTransportStage =
  | "Spawn"
  | "Write"
  | "Decode"
  | "Protocol"
  | "FrameTooLarge"
  | "Stdout"
  | "Child"
  | "Exit"
  | "Eof"
  | "Closed"

export class StdioTransportError extends Data.TaggedError("StdioTransportError")<{
  readonly stage: StdioTransportStage
  readonly message: string
  readonly exitCode?: number | null
  readonly signal?: string | null
  readonly cause?: unknown
}> {}

export class StdioTransportClose extends Data.TaggedClass("StdioTransportClose")<{
  readonly stage: StdioTransportStage
  readonly message: string
  readonly exitCode?: number | null
  readonly signal?: string | null
  readonly cause?: unknown
}> {}

export interface StdioFramingOptions {
  readonly maxLineBytes?: number
}

interface DecoderState {
  readonly buffered: Uint8Array
}

const emptyBytes: Uint8Array = new Uint8Array(0)
const lineFeed = 0x0a
const carriageReturn = 0x0d

const framingError = (
  stage: StdioTransportStage,
  message: string,
  cause?: unknown
): StdioTransportError => new StdioTransportError({
  stage,
  message,
  ...(cause === undefined ? {} : { cause })
})

const append = (left: Uint8Array, right: Uint8Array): Uint8Array => {
  if (left.byteLength === 0) return right.slice()
  if (right.byteLength === 0) return left
  const output = new Uint8Array(left.byteLength + right.byteLength)
  output.set(left)
  output.set(right, left.byteLength)
  return output
}

const decodeLine = (line: Uint8Array): Effect.Effect<McpWire.JsonRpcMessage, StdioTransportError> => {
  const decoded = McpWire.decodeJsonRpcBytes(line)
  return Either.isLeft(decoded)
    ? Effect.fail(framingError("Decode", "Invalid stdio JSON-RPC frame", decoded.left))
    : Effect.succeed(decoded.right)
}

const consumeChunk = (
  state: DecoderState,
  chunk: Uint8Array,
  maxLineBytes: number
): Effect.Effect<readonly [DecoderState, ReadonlyArray<McpWire.JsonRpcMessage>], StdioTransportError> =>
  Effect.gen(function*() {
    let buffered = state.buffered
    let offset = 0
    const messages: Array<McpWire.JsonRpcMessage> = []

    while (offset < chunk.byteLength) {
      const newline = chunk.indexOf(lineFeed, offset)
      const end = newline === -1 ? chunk.byteLength : newline
      const segment = chunk.subarray(offset, end)
      const combinedLength = buffered.byteLength + segment.byteLength

      if (newline === -1) {
        const last = segment.byteLength > 0
          ? segment[segment.byteLength - 1]
          : buffered[buffered.byteLength - 1]
        if (combinedLength > maxLineBytes + 1 ||
          (combinedLength === maxLineBytes + 1 && last !== carriageReturn)) {
          return yield* Effect.fail(framingError(
            "FrameTooLarge",
            "Stdio frame exceeds maxLineBytes"
          ))
        }
        buffered = append(buffered, segment)
        offset = end
        continue
      }

      const hasCr = segment.byteLength > 0
        ? segment[segment.byteLength - 1] === carriageReturn
        : buffered[buffered.byteLength - 1] === carriageReturn
      const contentLength = combinedLength - (hasCr ? 1 : 0)
      if (contentLength > maxLineBytes) {
        return yield* Effect.fail(framingError(
          "FrameTooLarge",
          "Stdio frame exceeds maxLineBytes"
        ))
      }
      const framed = append(buffered, segment)
      const line = hasCr ? framed.subarray(0, framed.byteLength - 1) : framed
      messages.push(yield* decodeLine(line))
      buffered = emptyBytes
      offset = newline + 1
    }

    return [{ buffered }, messages] as const
  })

/** Decode exactly one JSON-RPC message per newline from arbitrary byte chunks. */
export const decode = <E, R>(
  chunks: Stream.Stream<Uint8Array, E, R>,
  options: StdioFramingOptions = {}
): Stream.Stream<McpWire.JsonRpcMessage, E | StdioTransportError, R> => {
  const maxLineBytes = options.maxLineBytes ?? DEFAULT_MAX_LINE_BYTES
  const validatedMax = Number.isSafeInteger(maxLineBytes) && maxLineBytes >= 0
    ? maxLineBytes
    : DEFAULT_MAX_LINE_BYTES
  const withEof = Stream.concat(
    chunks.pipe(Stream.map((chunk) => chunk as Uint8Array | undefined)),
    Stream.succeed(undefined)
  )
  const framed: Stream.Stream<
    ReadonlyArray<McpWire.JsonRpcMessage>,
    E | StdioTransportError,
    R
  > = Stream.mapAccumEffect(
    withEof,
    { buffered: emptyBytes } satisfies DecoderState,
    (state, chunk) => chunk === undefined
      ? state.buffered.byteLength === 0
        ? Effect.succeed([state, []] as const)
        : Effect.fail(framingError("Eof", "Unterminated stdio frame at EOF"))
      : consumeChunk(state, chunk, validatedMax)
  )
  return Stream.flatMap(framed, (messages) => Stream.fromIterable(messages))
}

export interface StdioWriter {
  readonly send: (message: McpWire.JsonRpcMessage) => Effect.Effect<void, StdioTransportError>
  readonly close: Effect.Effect<void, StdioTransportError>
}

export const makeWriter = <WriteError, CloseError = never>(options: {
  readonly write: (bytes: Uint8Array) => Effect.Effect<void, WriteError>
  readonly close?: Effect.Effect<void, CloseError>
}): Effect.Effect<StdioWriter, never, Scope.Scope> => Effect.gen(function*() {
  const semaphore = yield* Effect.makeSemaphore(1)
  const closed = yield* Ref.make(false)

  const failCause = (stage: StdioTransportStage, message: string) =>
    (cause: Cause.Cause<WriteError | CloseError>): Effect.Effect<never, StdioTransportError> =>
      Cause.isInterruptedOnly(cause)
        ? Effect.failCause(cause as Cause.Cause<StdioTransportError>)
        : Effect.fail(framingError(stage, message, cause))

  const close = semaphore.withPermits(1)(Ref.getAndSet(closed, true).pipe(
    Effect.flatMap((wasClosed) => wasClosed
      ? Effect.void
      : (options.close ?? Effect.void).pipe(
        Effect.catchAllCause(failCause("Closed", "Could not close stdio writer"))
      ))
  ))

  const send = (message: McpWire.JsonRpcMessage): Effect.Effect<void, StdioTransportError> =>
    semaphore.withPermits(1)(Ref.get(closed).pipe(
      Effect.flatMap((isClosed) => {
        if (isClosed) return Effect.fail(framingError("Closed", "Stdio writer is closed"))
        const encoded = McpWire.encodeJsonRpcBytes(message)
        if (Either.isLeft(encoded)) {
          return Effect.fail(framingError("Write", "Could not encode stdio JSON-RPC frame", encoded.left))
        }
        const line = new Uint8Array(encoded.right.byteLength + 1)
        line.set(encoded.right)
        line[line.byteLength - 1] = lineFeed
        return options.write(line).pipe(
          Effect.catchAllCause(failCause("Write", "Could not write stdio frame"))
        )
      })
    ))

  yield* Effect.addFinalizer(() => close.pipe(Effect.catchAllCause(() => Effect.void)))
  return { send, close }
})
