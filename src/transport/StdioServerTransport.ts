/**
 * MCP stdio server transport.
 *
 * This is the package-local server-side stdio transport surface. It delegates
 * to the SDK server runtime instead of defining protocol behavior separately.
 */
import { createInterface } from "node:readline"
import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"
import * as Queue from "effect/Queue"
import * as Stream from "effect/Stream"
import * as McpServer from "../McpServer.js"

export interface StdioServerTransportOptions {
  readonly name: string
  readonly version: string
  readonly extensions?: McpServer.ExtensionCapabilities | undefined
}

/**
 * Create a stdio-backed MCP server layer.
 */
export const layer = (
  options: StdioServerTransportOptions
) => McpServer.layerStdio(options).pipe(Layer.provide(Layer.scoped(
  McpServer.StdioServerIO,
  Effect.acquireRelease(
    Effect.gen(function*() {
      const lines = yield* Queue.unbounded<string>()
      const input = createInterface({ input: process.stdin, terminal: false })
      input.on("line", (line) => Effect.runFork(Queue.offer(lines, line)))
      input.on("close", () => Effect.runFork(Queue.shutdown(lines)))
      return {
        lines: Stream.fromQueue(lines),
        writeLine: (line: string) => Effect.async<void>((resume) => {
          process.stdout.write(`${line}\n`, (error) => {
            resume(error ? Effect.die(error) : Effect.void)
          })
        }),
        input
      }
    }),
    ({ input }) => Effect.sync(() => input.close())
  ).pipe(Effect.map(({ lines, writeLine }) => ({ lines, writeLine })))
)))
