import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { test } from "node:test"
import { Deferred, Effect, Either, Fiber, Option, Queue, Stream } from "effect"
import * as McpServer from "../../dist/McpServer.js"
import * as StdioClientTransport from "../../dist/transport/StdioClientTransport.js"
import * as StdioServerTransport from "../../dist/transport/StdioServerTransport.js"
import * as StdioTransport from "../../dist/transport/StdioTransport.js"

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..")
const encoder = new TextEncoder()
const childFixture = path.join(root, "test/stdio/fixtures/stdio-child.mjs")

const request = (id, method = "tools/list") => ({
  _tag: "Request",
  jsonrpc: "2.0",
  id,
  method,
  params: {}
})

const success = (id, value = {}) => ({
  _tag: "SuccessResponse",
  jsonrpc: "2.0",
  id,
  result: { resultType: "complete", ...value }
})

const wire = ({ _tag: _ignored, ...message }) => message

const bytes = (value) => encoder.encode(value)

const validParams = (params = {}) => ({
  ...params,
  _meta: {
    "io.modelcontextprotocol/clientCapabilities": {},
    "io.modelcontextprotocol/protocolVersion": "2026-07-28"
  }
})

const decode = (chunks, options) => StdioTransport.decode(
  Stream.fromIterable(chunks),
  options
).pipe(Stream.runCollect, Effect.map(Array.from))

test("stdio byte framing preserves split UTF-8, multi-message chunks, CRLF, and escaped newlines", async () => {
  const first = JSON.stringify(wire({ ...request("one", "fixture/method"), params: { label: "snowman ☃ and escaped\\nline" } }))
  const second = JSON.stringify(wire(success(2, { ok: true })))
  const all = bytes(`${first}\r\n${second}\n`)
  const splitAt = all.indexOf(0xe2) + 1
  const decoded = await Effect.runPromise(decode([
    all.subarray(0, 3),
    all.subarray(3, splitAt),
    all.subarray(splitAt, splitAt + 1),
    all.subarray(splitAt + 1)
  ]))

  assert.deepEqual(decoded, [
    { ...request("one", "fixture/method"), params: { label: "snowman ☃ and escaped\\nline" } },
    success(2, { ok: true })
  ])
})

test("stdio framing fails closed for malformed, blank, batch, invalid UTF-8, and unterminated input", async () => {
  const cases = [
    { name: "malformed", chunks: [bytes("{bad}\n")], stage: "Decode" },
    { name: "blank", chunks: [bytes("\n")], stage: "Decode" },
    { name: "batch", chunks: [bytes("[]\n")], stage: "Decode" },
    { name: "invalid utf8", chunks: [Uint8Array.from([0xc3, 0x28, 0x0a])], stage: "Decode" },
    { name: "unterminated", chunks: [bytes(JSON.stringify(request(1)))], stage: "Eof" }
  ]

  for (const testCase of cases) {
    const result = await Effect.runPromise(decode(testCase.chunks).pipe(Effect.either))
    assert.equal(Either.isLeft(result), true, testCase.name)
    assert.equal(result.left._tag, "StdioTransportError", testCase.name)
    assert.equal(result.left.stage, testCase.stage, testCase.name)
    assert.equal(typeof result.left.message, "string", testCase.name)
  }
})

test("maxLineBytes accepts the exact byte boundary excluding LF and optional CR", async () => {
  const line = JSON.stringify(wire(request("boundary", "fixture/method")))
  const maxLineBytes = bytes(line).byteLength
  const acceptedLf = await Effect.runPromise(decode([bytes(`${line}\n`)], { maxLineBytes }))
  const acceptedCrlf = await Effect.runPromise(decode([bytes(`${line}\r\n`)], { maxLineBytes }))
  assert.equal(acceptedLf.length, 1)
  assert.equal(acceptedCrlf.length, 1)

  for (const framed of [`${line} \n`, `${line} \r\n`]) {
    const rejected = await Effect.runPromise(decode([bytes(framed)], { maxLineBytes }).pipe(Effect.either))
    assert.equal(Either.isLeft(rejected), true)
    assert.equal(rejected.left.stage, "FrameTooLarge")
  }

  const unterminated = await Effect.runPromise(decode([
    bytes(line),
    bytes(" ")
  ], { maxLineBytes }).pipe(Effect.either))
  assert.equal(Either.isLeft(unterminated), true)
  assert.equal(unterminated.left.stage, "FrameTooLarge")
})

test("serialized writer emits complete lines in call order and rejects post-close writes", async () => {
  const writes = []
  let activeWrites = 0
  let maxActiveWrites = 0
  await Effect.runPromise(Effect.scoped(Effect.gen(function*() {
    const writer = yield* StdioTransport.makeWriter({
      write: (chunk) => Effect.gen(function*() {
        activeWrites += 1
        maxActiveWrites = Math.max(maxActiveWrites, activeWrites)
        yield* Effect.yieldNow()
        writes.push(new Uint8Array(chunk))
        activeWrites -= 1
      })
    })
    yield* Effect.all([
      writer.send(success("a", { order: 1 })),
      writer.send(success("b", { order: 2 })),
      writer.send(success("c", { order: 3 }))
    ], { concurrency: "unbounded" })
    yield* writer.close
    const afterClose = yield* writer.send(success("late")).pipe(Effect.either)
    assert.equal(Either.isLeft(afterClose), true)
    assert.equal(afterClose.left.stage, "Closed")
  })))

  assert.equal(maxActiveWrites, 1)
  const output = writes.map((chunk) => new TextDecoder().decode(chunk)).join("")
  assert.deepEqual(output.trimEnd().split("\n").map(JSON.parse).map(({ id }) => id), ["a", "b", "c"])
  assert.equal(output.endsWith("\n"), true)
})

test("modern stdio client preserves exact mixed IDs, notifications, cancellation, and stderr separation", async () => {
  const diagnostics = []
  await Effect.runPromise(Effect.scoped(Effect.gen(function*() {
    const hangingStarted = yield* Deferred.make()
    const client = yield* StdioClientTransport.make({
      command: process.execPath,
      args: [childFixture, "echo"],
      stderrSink: (chunk) => {
        const diagnostic = new TextDecoder().decode(chunk)
        return Effect.sync(() => diagnostics.push(diagnostic)).pipe(
          Effect.zipRight(diagnostic.includes("started:cancel-me")
            ? Deferred.succeed(hangingStarted, undefined).pipe(Effect.asVoid)
            : Effect.void)
        )
      }
    })
    const numeric = yield* client.request(request(1)).pipe(Stream.runCollect, Effect.forkScoped)
    const textual = yield* client.request(request("1")).pipe(Stream.runCollect, Effect.forkScoped)
    const numericDone = yield* Fiber.join(numeric).pipe(Effect.timeoutOption("1 second"))
    const textualDone = yield* Fiber.join(textual).pipe(Effect.timeoutOption("1 second"))
    assert.equal(Option.isSome(numericDone), true, "numeric request did not complete")
    assert.equal(Option.isSome(textualDone), true, "text request did not complete")
    const numericFrames = Array.from(numericDone.value)
    const textualFrames = Array.from(textualDone.value)
    assert.strictEqual(numericFrames.at(-1).response.id, 1)
    assert.strictEqual(textualFrames.at(-1).response.id, "1")
    assert.equal(numericFrames[0]._tag, "Notification")
    assert.equal(textualFrames[0]._tag, "Notification")

    const hanging = yield* client.request(request("cancel-me", "test/hang")).pipe(
      Stream.runCollect,
      Effect.either,
      Effect.forkScoped
    )
    yield* Deferred.await(hangingStarted)
    yield* client.cancel("cancel-me", "operator stopped")
    const cancelledDone = yield* Fiber.join(hanging).pipe(Effect.timeoutOption("1 second"))
    assert.equal(Option.isSome(cancelledDone), true, "cancelled request did not complete")
    const cancelled = cancelledDone.value
    assert.equal(Either.isLeft(cancelled), true)
    assert.equal(cancelled.left._tag, "RequestCancelledError")
    assert.strictEqual(cancelled.left.requestId, "cancel-me")

    const global = yield* client.notifications.pipe(
      Stream.fromQueue,
      Stream.take(1),
      Stream.runCollect,
      Effect.timeoutOption("1 second")
    )
    assert.equal(Option.isSome(global), true)
  })))
  assert.equal(diagnostics.join("").includes("fixture diagnostic"), true)
  assert.equal(diagnostics.join("").includes("cancel:string:cancel-me"), true)
})

test("stdout noise closes the client and fails every active request with the first typed cause", async () => {
  await Effect.runPromise(Effect.scoped(Effect.gen(function*() {
    const client = yield* StdioClientTransport.make({
      command: process.execPath,
      args: [childFixture, "noise"]
    })
    const first = yield* client.request(request("first")).pipe(Stream.runCollect, Effect.either, Effect.forkScoped)
    const second = yield* client.request(request("second")).pipe(Stream.runCollect, Effect.either, Effect.forkScoped)
    const close = yield* client.closed.pipe(Effect.timeoutOption("1 second"))
    assert.equal(Option.isSome(close), true)
    assert.equal(close.value.stage, "Decode")
    for (const fiber of [first, second]) {
      const result = yield* Fiber.join(fiber)
      assert.equal(Either.isLeft(result), true)
      assert.equal(result.left._tag, "TransportError")
      assert.strictEqual(result.left.cause, close.value)
    }
  })))
})

test("spawn and premature child exit preserve safe typed diagnostics", async () => {
  const missing = await Effect.runPromise(Effect.scoped(
    StdioClientTransport.make({ command: path.join(root, "does-not-exist") }).pipe(Effect.either)
  ))
  assert.equal(Either.isLeft(missing), true)
  assert.equal(missing.left.stage, "Spawn")

  await Effect.runPromise(Effect.scoped(Effect.gen(function*() {
    const client = yield* StdioClientTransport.make({
      command: process.execPath,
      args: [childFixture, "exit"]
    })
    const active = yield* client.request(request("exit-active")).pipe(Stream.runCollect, Effect.either, Effect.forkScoped)
    const close = yield* client.closed
    assert.equal(close.stage, "Exit")
    assert.equal(close.exitCode, 23)
    assert.equal(close.signal, null)
    const result = yield* Fiber.join(active)
    assert.equal(Either.isLeft(result), true)
    assert.strictEqual(result.left.cause, close)
  })))
})

test("scope cleanup escalates from SIGTERM without hanging or orphaning the child", { timeout: 5_000 }, async () => {
  const pid = await Effect.runPromise(Effect.scoped(Effect.gen(function*() {
    const pidReady = yield* Deferred.make()
    yield* StdioClientTransport.make({
      command: process.execPath,
      args: [childFixture, "stubborn"],
      gracefulShutdownTimeoutMs: 50,
      forceKillTimeoutMs: 250,
      stderrSink: (chunk) => {
        const match = new TextDecoder().decode(chunk).match(/pid:(\d+)/)
        return match ? Deferred.succeed(pidReady, Number(match[1])).pipe(Effect.asVoid) : Effect.void
      }
    })
    const observedPid = yield* Deferred.await(pidReady).pipe(Effect.timeoutOption("1 second"))
    assert.equal(Option.isSome(observedPid), true, "stubborn child pid was not observed on stderr")
    return observedPid.value
  })))

  assert.throws(() => process.kill(pid, 0), { code: "ESRCH" })
})

test("modern stdio server routes decoded messages through the shared dispatcher", async () => {
  await Effect.runPromise(Effect.scoped(Effect.gen(function*() {
    const input = yield* Queue.unbounded()
    const output = yield* Queue.unbounded()
    const service = yield* McpServer.McpServer.makeWithOptions({
      name: "stdio-test",
      version: "1.0.0"
    })
    const running = yield* StdioServerTransport.run({
      input: Stream.fromQueue(input),
      write: (chunk) => Queue.offer(output, new Uint8Array(chunk)).pipe(Effect.asVoid)
    }).pipe(
      Effect.provideService(McpServer.McpServer, service),
      Effect.forkScoped
    )
    yield* Queue.offer(input, bytes(`${JSON.stringify(wire({
      ...request("server-id"),
      params: validParams()
    }))}\n`))
    const framed = yield* Queue.take(output).pipe(Effect.timeoutOption("1 second"))
    assert.equal(Option.isSome(framed), true, "server did not emit a terminal response")
    const response = JSON.parse(new TextDecoder().decode(framed.value))
    assert.strictEqual(response.id, "server-id")
    assert.equal(response.result.resultType, "complete")
    assert.deepEqual(response.result.tools, [])
    yield* Fiber.interrupt(running)
  })))
})

test("modern stdio server fails closed without null-id responses for invalid framing", async () => {
  const writes = []
  const result = await Effect.runPromise(Effect.scoped(Effect.gen(function*() {
    const service = yield* McpServer.McpServer.makeWithOptions({
      name: "stdio-test",
      version: "1.0.0"
    })
    return yield* StdioServerTransport.run({
      input: Stream.succeed(bytes("{not-json\n")),
      write: (chunk) => Effect.sync(() => writes.push(new Uint8Array(chunk)))
    }).pipe(
      Effect.provideService(McpServer.McpServer, service),
      Effect.either
    )
  })))
  assert.equal(Either.isLeft(result), true)
  assert.equal(result.left.stage, "Decode")
  assert.deepEqual(writes, [])
})

test("modern stdio server surfaces supervised terminal write failure", async () => {
  await Effect.runPromise(Effect.scoped(Effect.gen(function*() {
    const input = yield* Queue.unbounded()
    const service = yield* McpServer.McpServer.makeWithOptions({
      name: "stdio-test",
      version: "1.0.0"
    })
    const running = yield* StdioServerTransport.run({
      input: Stream.fromQueue(input),
      write: () => Effect.fail("fixture write failed")
    }).pipe(
      Effect.provideService(McpServer.McpServer, service),
      Effect.either,
      Effect.forkScoped
    )
    yield* Queue.offer(input, bytes(`${JSON.stringify(wire({
      ...request(23),
      params: validParams()
    }))}\n`))
    const done = yield* Fiber.join(running).pipe(Effect.timeoutOption("1 second"))
    assert.equal(Option.isSome(done), true, "server did not supervise terminal write failure")
    assert.equal(Either.isLeft(done.value), true)
    assert.equal(done.value.left.stage, "Write")
  })))
})

test("active stdio sources reject legacy framing and unsafe event bridges", () => {
  const active = [
    "src/transport/StdioTransport.ts",
    "src/transport/StdioClientTransport.ts",
    "src/transport/StdioServerTransport.ts"
  ].map((relative) => [relative, readFileSync(path.join(root, relative), "utf8")])
  const forbidden = [
    ["mcpNdJson", /mcpNdJson/],
    ["chunk.toString", /chunk\.toString\s*\(/],
    ["Effect.runFork", /Effect\.runFork/],
    ["Effect.runSync", /Effect\.runSync/],
    ["silent parse catch", /catch\s*\{\s*(?:\/\/[^\n]*\n\s*)?\}/],
    ["unbounded string buffer", /buffer\s*\+=/],
    ["readline string framing", /node:readline/]
  ]
  const violations = []
  for (const [relative, source] of active) {
    for (const [label, pattern] of forbidden) {
      if (pattern.test(source)) violations.push(`${relative}: ${label}`)
    }
  }
  assert.deepEqual(violations, [])
})

test("McpServer no longer owns an active duplicate stdio protocol loop", () => {
  const source = readFileSync(path.join(root, "src/McpServer.ts"), "utf8")
  assert.equal(/\bstdioLoop\b/.test(source), false)
  assert.equal(/\bStdioServerIO\b/.test(source), false)
  assert.equal(/\blayerStdio\b/.test(source), false)
})
