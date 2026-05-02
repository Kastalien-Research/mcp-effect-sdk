/**
 * MCP stdio transport.
 *
 * Spawns a child process and communicates via newline-delimited
 * JSON over stdin/stdout. Provides an RpcClient.Protocol.
 */
import { spawn } from "node:child_process"
import type { Buffer } from "node:buffer"
import * as RpcClient from "@effect/rpc/RpcClient"
import { Effect, Queue, Scope, Stream } from "effect"
import { McpClientError } from "../McpClientError.js"
import { mcpNdJson } from "../McpSerialization.js"

export interface StdioTransportOptions {
  readonly command: string
  readonly args?: ReadonlyArray<string>
  readonly cwd?: string
  readonly env?: Record<string, string>
}

/**
 * Spawn a child process and return an RpcClient.Protocol that
 * communicates via newline-delimited JSON on stdin/stdout.
 *
 * Requires `Scope` — the child process is killed on scope exit.
 */
export const make = (
  options: StdioTransportOptions
): Effect.Effect<
  RpcClient.Protocol["Type"],
  McpClientError,
  Scope.Scope
> =>
  Effect.gen(function* () {
    const { command, args = [], cwd, env } = options

    // Spawn child process
    const child = yield* Effect.try({
      try: () =>
        spawn(command, [...args], {
          stdio: ["pipe", "pipe", "pipe"],
          cwd,
          env: env
            ? { ...process.env, ...env }
            : undefined
        }),
      catch: (err) =>
        new McpClientError({
          reason: "Transport",
          message: `Failed to spawn ${command}: ${err}`,
          cause: err
        })
    })

    // Kill on scope exit
    yield* Effect.addFinalizer(() =>
      Effect.sync(() => {
        if (!child.killed) child.kill("SIGTERM")
      })
    )

    // Serialization parser
    const parser = mcpNdJson.unsafeMake()

    // Stderr → debug log (best-effort)
    child.stderr?.on("data", (chunk: Buffer) => {
      Effect.runFork(
        Effect.logDebug(
          `[stdio:${child.pid}] ${chunk.toString().trimEnd()}`
        )
      )
    })

    // Incoming message queue (stdout → queue)
    const incoming = yield* Queue.unbounded<unknown>()
    let buffer = ""

    child.stdout!.on("data", (chunk: Buffer) => {
      buffer += chunk.toString()
      const lines = buffer.split("\n")
      buffer = lines.pop()!
      for (const line of lines) {
        if (!line.trim()) continue
        try {
          for (const msg of parser.decode(line)) {
            incoming.unsafeOffer(msg)
          }
        } catch {
          // Skip malformed messages
        }
      }
    })

    child.stdout!.on("close", () => {
      Effect.runFork(Queue.shutdown(incoming))
    })

    child.stdout!.on("error", () => {
      Effect.runFork(Queue.shutdown(incoming))
    })

    // Protocol
    const send: RpcClient.Protocol["Type"]["send"] = (msg) =>
      Effect.async<void, never>((resume) => {
        const encoded = parser.encode(msg)
        if (!encoded) {
          resume(Effect.void)
          return
        }
        const data =
          typeof encoded === "string"
            ? encoded
            : new TextDecoder().decode(encoded as Uint8Array)
        child.stdin!.write(data, (err) => {
          if (err) {
            resume(
              Effect.die(
                new McpClientError({
                  reason: "Transport",
                  message: `Write failed: ${err.message}`,
                  cause: err
                })
              )
            )
          } else {
            resume(Effect.void)
          }
        })
      })

    const run: RpcClient.Protocol["Type"]["run"] = (f) =>
      Stream.fromQueue(incoming).pipe(
        Stream.runForEach((msg) => f(msg as never)),
        Effect.andThen(Effect.never)
      ) as Effect.Effect<never>

    return {
      send,
      run,
      supportsAck: false,
      supportsTransferables: false
    } satisfies RpcClient.Protocol["Type"]
  })
