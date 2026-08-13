/** Duplex newline-delimited stdio adapter for MCP 2025-11-25. */
import * as Effect from "effect/Effect"
import type * as Scope from "effect/Scope"
import * as Stream from "effect/Stream"
import * as Either from "effect/Either"
import type { JsonRpcMessage } from "../McpWire.js"
import * as StdioTransport from "../transport/StdioTransport.js"
import { decodeJsonRpcText, encodeJsonRpcText } from "./LegacyWire.js"
import type { LegacyDuplexTransport } from "./Connection.js"

export interface LegacyStdioOptions<E, W = E> extends StdioTransport.StdioFramingOptions {
  readonly input: Stream.Stream<Uint8Array, E>
  readonly write: (bytes: Uint8Array) => Effect.Effect<void, W>
  readonly close?: Effect.Effect<void, W>
}

export const make = <E, W = E>(
  options: LegacyStdioOptions<E, W>
): Effect.Effect<LegacyDuplexTransport<E | W | StdioTransport.StdioTransportError>, never, Scope.Scope> =>
  Effect.gen(function* () {
    const writer = yield* StdioTransport.makeWriter({
      write: options.write,
      ...(options.close === undefined ? {} : { close: options.close })
    })
    return {
      messages: options.input.pipe(
        Stream.decodeText(),
        Stream.splitLines,
        Stream.mapEffect((line) => {
          const decoded = decodeJsonRpcText(line)
          return Either.isLeft(decoded)
            ? Effect.fail(
                new StdioTransport.StdioTransportError({
                  stage: "Decode",
                  message: decoded.left.message,
                  cause: decoded.left
                })
              )
            : Effect.succeed(decoded.right)
        })
      ),
      send: (message: JsonRpcMessage) => {
        const encoded = encodeJsonRpcText(message)
        return Either.isLeft(encoded)
          ? Effect.fail(
              new StdioTransport.StdioTransportError({
                stage: "Write",
                message: encoded.left.message,
                cause: encoded.left
              })
            )
          : options.write(new TextEncoder().encode(`${encoded.right}\n`))
      },
      close: writer.close
    }
  })
