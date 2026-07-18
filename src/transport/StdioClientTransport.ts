/** Dispatcher-native scoped MCP stdio client transport. */
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process"
import type { Buffer } from "node:buffer"
import * as Cause from "effect/Cause"
import * as Deferred from "effect/Deferred"
import * as Effect from "effect/Effect"
import * as Either from "effect/Either"
import * as Fiber from "effect/Fiber"
import * as Option from "effect/Option"
import * as Queue from "effect/Queue"
import * as Ref from "effect/Ref"
import * as Scope from "effect/Scope"
import * as Stream from "effect/Stream"
import { McpClientError } from "../McpClientError.js"
import type { McpClientProtocol } from "../McpClientProtocol.js"
import * as McpDispatcher from "../McpDispatcher.js"
import type {
  JsonRpcId,
  JsonRpcMessage,
  JsonRpcNotification,
  JsonRpcRequest
} from "../McpWire.js"
import * as StdioTransport from "./StdioTransport.js"

export interface StdioClientTransportOptions extends StdioTransport.StdioFramingOptions {
  readonly command: string
  readonly args?: ReadonlyArray<string>
  readonly cwd?: string
  readonly env?: Record<string, string>
  readonly stderrSink?: (chunk: Uint8Array) => Effect.Effect<void>
  readonly gracefulShutdownTimeoutMs?: number
  readonly forceKillTimeoutMs?: number
}

export interface StdioClient {
  readonly request: McpDispatcher.ClientDispatcher["request"]
  readonly notifications: Queue.Dequeue<JsonRpcNotification>
  readonly sendNotification: (
    notification: JsonRpcNotification
  ) => Effect.Effect<void, StdioTransport.StdioTransportError>
  readonly cancel: (
    id: JsonRpcId,
    reason?: string
  ) => Effect.Effect<void, StdioTransport.StdioTransportError>
  readonly closed: Effect.Effect<StdioTransport.StdioTransportClose>
}

const transportError = (
  stage: StdioTransport.StdioTransportStage,
  message: string,
  cause?: unknown
): StdioTransport.StdioTransportError => new StdioTransport.StdioTransportError({
  stage,
  message,
  ...(cause === undefined ? {} : { cause })
})

const spawnChild = (
  options: StdioClientTransportOptions
): Effect.Effect<ChildProcessWithoutNullStreams, StdioTransport.StdioTransportError> =>
  Effect.async((resume) => {
    let child: ChildProcessWithoutNullStreams
    let settled = false
    try {
      child = spawn(options.command, [...(options.args ?? [])], {
        stdio: ["pipe", "pipe", "pipe"],
        cwd: options.cwd,
        env: options.env
      })
    } catch (cause) {
      resume(Effect.fail(transportError("Spawn", "Could not spawn stdio child", cause)))
      return
    }
    const cleanup = () => {
      child.off("spawn", onSpawn)
      child.off("error", onError)
    }
    const onSpawn = () => {
      settled = true
      cleanup()
      resume(Effect.succeed(child))
    }
    const onError = (cause: Error) => {
      settled = true
      cleanup()
      resume(Effect.fail(transportError("Spawn", "Could not spawn stdio child", cause)))
    }
    child.once("spawn", onSpawn)
    child.once("error", onError)
    return Effect.sync(() => {
      cleanup()
      if (!settled && child.exitCode === null) child.kill("SIGKILL")
    })
  })

interface ExitInfo {
  readonly code: number | null
  readonly signal: NodeJS.Signals | null
}

const awaitExit = (child: ChildProcessWithoutNullStreams): Effect.Effect<ExitInfo> => {
  if (child.exitCode !== null || child.signalCode !== null) {
    return Effect.succeed({ code: child.exitCode, signal: child.signalCode })
  }
  return Effect.async((resume) => {
    const onExit = (code: number | null, signal: NodeJS.Signals | null) => {
      cleanup()
      resume(Effect.succeed({ code, signal }))
    }
    const cleanup = () => child.off("exit", onExit)
    child.once("exit", onExit)
    return Effect.sync(cleanup)
  })
}

const terminateChild = (
  child: ChildProcessWithoutNullStreams,
  options: StdioClientTransportOptions
): Effect.Effect<void> => Effect.gen(function*() {
  if (child.exitCode !== null || child.signalCode !== null) return
  yield* Effect.sync(() => {
    if (!child.stdin.destroyed) child.stdin.end()
    child.kill("SIGTERM")
  })
  const graceful = yield* awaitExit(child).pipe(
    Effect.interruptible,
    Effect.timeoutOption(`${options.gracefulShutdownTimeoutMs ?? 500} millis`)
  )
  if (Option.isSome(graceful)) return
  yield* Effect.sync(() => {
    if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL")
  })
  yield* awaitExit(child).pipe(
    Effect.interruptible,
    Effect.timeoutOption(`${options.forceKillTimeoutMs ?? 500} millis`),
    Effect.asVoid
  )
})

const readable = (
  child: ChildProcessWithoutNullStreams,
  source: "stdout" | "stderr"
): Stream.Stream<Uint8Array, StdioTransport.StdioTransportError> =>
  Stream.asyncPush<Uint8Array, StdioTransport.StdioTransportError>((emit) => {
    const input = child[source]
    const onData = (chunk: Buffer) => {
      emit.single(new Uint8Array(chunk))
    }
    const onEnd = () => emit.end()
    const onError = (cause: Error) => emit.fail(transportError(
      source === "stdout" ? "Stdout" : "Child",
      `Could not read child ${source}`,
      cause
    ))
    return Effect.acquireRelease(
      Effect.sync(() => {
        input.on("data", onData)
        input.once("end", onEnd)
        input.once("error", onError)
      }),
      () => Effect.sync(() => {
        input.off("data", onData)
        input.off("end", onEnd)
        input.off("error", onError)
      })
    )
  }, { bufferSize: "unbounded" })

const writeChild = (
  child: ChildProcessWithoutNullStreams,
  bytes: Uint8Array
): Effect.Effect<void, StdioTransport.StdioTransportError> =>
  Effect.async((resume) => {
    if (child.stdin.destroyed || !child.stdin.writable) {
      resume(Effect.fail(transportError("Write", "Child stdin is not writable")))
      return
    }
    try {
      child.stdin.write(bytes, (cause) => resume(cause
        ? Effect.fail(transportError("Write", "Could not write child stdin", cause))
        : Effect.void))
    } catch (cause) {
      resume(Effect.fail(transportError("Write", "Could not write child stdin", cause)))
    }
  })

const toClose = (
  error: StdioTransport.StdioTransportError
): StdioTransport.StdioTransportClose => new StdioTransport.StdioTransportClose({
  stage: error.stage,
  message: error.message,
  exitCode: error.exitCode,
  signal: error.signal,
  cause: error
})

export const make = (
  options: StdioClientTransportOptions
): Effect.Effect<StdioClient, StdioTransport.StdioTransportError, Scope.Scope> =>
  Effect.gen(function*() {
    const child = yield* Effect.acquireRelease(spawnChild(options), (child) => terminateChild(child, options))
    const stopping = yield* Ref.make(false)
    const closeSignal = yield* Deferred.make<StdioTransport.StdioTransportClose>()
    const writer = yield* StdioTransport.makeWriter({
      write: (bytes) => writeChild(child, bytes),
      close: Effect.sync(() => {
        if (!child.stdin.destroyed) child.stdin.end()
      })
    })
    const dispatcherReady = yield* Deferred.make<McpDispatcher.ClientDispatcher>()

    const publishClose = (
      close: StdioTransport.StdioTransportClose
    ): Effect.Effect<void> => Deferred.succeed(closeSignal, close).pipe(
      Effect.flatMap((won) => won
        ? Ref.set(stopping, true).pipe(
          Effect.zipRight(Deferred.await(dispatcherReady)),
          Effect.flatMap((dispatcher) => dispatcher.close(close)),
          Effect.zipRight(writer.close.pipe(Effect.catchAllCause(() => Effect.void))),
          Effect.zipRight(terminateChild(child, options))
        )
        : Effect.void)
    )

    const sendMessage = (message: JsonRpcMessage): Effect.Effect<void, StdioTransport.StdioTransportError> =>
      writer.send(message).pipe(
        Effect.tapError((error) => publishClose(toClose(error)))
      )

    const dispatcher = yield* McpDispatcher.makeClientDispatcher({ send: sendMessage })
    yield* Deferred.succeed(dispatcherReady, dispatcher)

    const inbound = StdioTransport.decode(readable(child, "stdout"), {
      maxLineBytes: options.maxLineBytes
    }).pipe(
      Stream.runForEach((message) => dispatcher.accept(message).pipe(
        Effect.mapError((cause) => transportError("Protocol", "Unsupported inbound stdio message", cause))
      )),
      Effect.matchCauseEffect({
        onFailure: (cause) => {
          if (Cause.isInterruptedOnly(cause)) return Effect.void
          const failure = Cause.failureOption(cause)
          const error = Option.isSome(failure)
            ? failure.value
            : transportError("Stdout", "Child stdout reader failed", cause)
          return publishClose(toClose(error))
        },
        onSuccess: () => Ref.get(stopping).pipe(Effect.flatMap((isStopping) => {
          if (isStopping) return Effect.void
          return Deferred.await(exitInfo).pipe(
            Effect.timeoutOption("10 millis"),
            Effect.flatMap((exit) => Option.match(exit, {
              onNone: () => publishClose(new StdioTransport.StdioTransportClose({
                stage: "Eof",
                message: "Unexpected EOF from child stdout"
              })),
              onSome: ({ code, signal }) => publishClose(new StdioTransport.StdioTransportClose({
                stage: "Exit",
                message: "Stdio child exited",
                exitCode: code,
                signal
              }))
            }))
          )
        }))
      })
    )

    const exitInfo = yield* Deferred.make<ExitInfo>()
    yield* awaitExit(child).pipe(
      Effect.flatMap((exit) => Deferred.succeed(exitInfo, exit).pipe(
        Effect.zipRight(Ref.get(stopping)),
        Effect.flatMap((isStopping) => isStopping
          ? Effect.void
          : publishClose(new StdioTransport.StdioTransportClose({
            stage: "Exit",
            message: "Stdio child exited",
            exitCode: exit.code,
            signal: exit.signal
          })))
      )),
      Effect.forkScoped
    )
    yield* inbound.pipe(Effect.forkScoped)

    const stderrSink = options.stderrSink ?? ((chunk: Uint8Array) =>
      Effect.logDebug(new TextDecoder().decode(chunk)))
    yield* readable(child, "stderr").pipe(
      Stream.runForEach(stderrSink),
      Effect.catchAllCause(() => Effect.void),
      Effect.forkScoped
    )

    yield* Effect.addFinalizer(() => Ref.set(stopping, true).pipe(
      Effect.zipRight(Deferred.succeed(closeSignal, new StdioTransport.StdioTransportClose({
        stage: "Closed",
        message: "Stdio client scope closed"
      }))),
      Effect.zipRight(terminateChild(child, options)),
      Effect.asVoid
    ))

    const sendNotification = (notification: JsonRpcNotification) => sendMessage(notification)
    const cancel = (id: JsonRpcId, reason?: string) => dispatcher.cancel(id, reason).pipe(
      Effect.zipRight(sendNotification({
        _tag: "Notification",
        jsonrpc: "2.0",
        method: "notifications/cancelled",
        params: { requestId: id, ...(reason === undefined ? {} : { reason }) }
      }))
    )

    return {
      request: dispatcher.request,
      notifications: dispatcher.notifications,
      sendNotification,
      cancel,
      closed: Deferred.await(closeSignal)
    }
  })

const asClientError = (cause: unknown): McpClientError => cause instanceof McpClientError
  ? cause
  : new McpClientError({ reason: "Transport", message: "Stdio compatibility transport failed", cause })

/** Narrow bridge for the legacy high-level McpClient pending Task 4D removal. */
export const makeCompatibilityProtocol = (
  options: StdioClientTransportOptions
): Effect.Effect<McpClientProtocol, StdioTransport.StdioTransportError, Scope.Scope> =>
  Effect.gen(function*() {
    const scope = yield* Effect.scope
    const client = yield* make(options)
    const handler = yield* Deferred.make<(message: Record<string, unknown>) => Effect.Effect<void>>()
    const notifications = yield* Queue.unbounded<{ readonly tag: string; readonly payload: unknown }>()
    const serverRequests = yield* Queue.unbounded<never>()

    yield* Stream.fromQueue(client.notifications).pipe(
      Stream.runForEach((notification) => Queue.offer(notifications, {
        tag: notification.method,
        payload: notification.params
      })),
      Effect.forkIn(scope)
    )

    const send = (raw: Record<string, unknown>): Effect.Effect<void, McpClientError> => {
      const id = raw["id"]
      const method = raw["tag"]
      if (typeof method !== "string") {
        return Effect.fail(new McpClientError({ reason: "Protocol", message: "Invalid compatibility message" }))
      }
      if (id === undefined) {
        const payload = raw["payload"]
        return client.sendNotification({
          _tag: "Notification",
          jsonrpc: "2.0",
          method,
          params: typeof payload === "object" && payload !== null && !Array.isArray(payload)
            ? payload as Record<string, unknown>
            : {}
        }).pipe(Effect.mapError(asClientError))
      }
      if (typeof id !== "string" && typeof id !== "number") {
        return Effect.fail(new McpClientError({ reason: "Protocol", message: "Invalid compatibility request id" }))
      }
      const request: JsonRpcRequest = {
        _tag: "Request",
        jsonrpc: "2.0",
        id,
        method,
        params: typeof raw["payload"] === "object" && raw["payload"] !== null && !Array.isArray(raw["payload"])
          ? raw["payload"] as Record<string, unknown>
          : {}
      }
      return client.request(request).pipe(
        Stream.runForEach((frame) => frame._tag === "Notification"
          ? Queue.offer(notifications, {
            tag: frame.notification.method,
            payload: frame.notification.params
          }).pipe(Effect.asVoid)
          : Deferred.await(handler).pipe(Effect.flatMap((handle) => handle({
            _tag: "Exit",
            requestId: id,
            exit: frame._tag === "Success"
              ? { _tag: "Success", value: frame.response.result }
              : { _tag: "Failure", cause: { _tag: "Fail", error: frame.response.error } }
          })))),
        Effect.catchAll((error) => Deferred.await(handler).pipe(Effect.flatMap((handle) => handle({
          _tag: "Exit",
          requestId: id,
          exit: { _tag: "Failure", cause: { _tag: "Fail", error } }
        })))),
        Effect.forkIn(scope),
        Effect.asVoid,
        Effect.mapError(asClientError)
      )
    }

    return {
      clientProtocol: {
        send,
        run: (handle) => Deferred.succeed(handler, handle).pipe(Effect.zipRight(Effect.never)),
        supportsAck: false,
        supportsTransferables: false
      },
      notifications,
      serverRequests,
      respond: () => Effect.fail(new McpClientError({
        reason: "Protocol",
        message: "Server-initiated requests are unsupported on the modern draft"
      })),
      respondError: () => Effect.fail(new McpClientError({
        reason: "Protocol",
        message: "Server-initiated requests are unsupported on the modern draft"
      }))
    }
  })
