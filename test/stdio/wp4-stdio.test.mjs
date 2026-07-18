import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { test } from "node:test"
import { Deferred, Effect, Either, Fiber, Option, Stream } from "effect"
import * as StdioClientTransport from "../../dist/transport/StdioClientTransport.js"
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
  result: value
})

const bytes = (value) => encoder.encode(value)

const decode = (chunks, options) => StdioTransport.decode(
  Stream.fromIterable(chunks),
  options
).pipe(Stream.runCollect, Effect.map(Array.from))

test("stdio byte framing preserves split UTF-8, multi-message chunks, CRLF, and escaped newlines", async () => {
  const first = JSON.stringify({ ...request("one"), params: { label: "snowman ☃ and escaped\\nline" } })
  const second = JSON.stringify(success(2, { ok: true }))
  const all = bytes(`${first}\r\n${second}\n`)
  const splitAt = all.indexOf(0xe2) + 1
  const decoded = await Effect.runPromise(decode([
    all.subarray(0, 3),
    all.subarray(3, splitAt),
    all.subarray(splitAt, splitAt + 1),
    all.subarray(splitAt + 1)
  ]))

  assert.deepEqual(decoded, [
    { ...request("one"), params: { label: "snowman ☃ and escaped\\nline" } },
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
  const line = JSON.stringify(request("boundary"))
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
    const client = yield* StdioClientTransport.make({
      command: process.execPath,
      args: [childFixture, "echo"],
      stderrSink: (chunk) => Effect.sync(() => diagnostics.push(new TextDecoder().decode(chunk)))
    })
    const numeric = yield* client.request(request(1)).pipe(Stream.runCollect, Effect.forkScoped)
    const textual = yield* client.request(request("1")).pipe(Stream.runCollect, Effect.forkScoped)
    const numericFrames = Array.from(yield* Fiber.join(numeric))
    const textualFrames = Array.from(yield* Fiber.join(textual))
    assert.strictEqual(numericFrames.at(-1).response.id, 1)
    assert.strictEqual(textualFrames.at(-1).response.id, "1")
    assert.equal(numericFrames[0]._tag, "Notification")
    assert.equal(textualFrames[0]._tag, "Notification")

    const hanging = yield* client.request(request("cancel-me", "test/hang")).pipe(
      Stream.runCollect,
      Effect.either,
      Effect.forkScoped
    )
    yield* client.cancel("cancel-me", "operator stopped")
    const cancelled = yield* Fiber.join(hanging)
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
    return yield* Deferred.await(pidReady)
  })))

  assert.throws(() => process.kill(pid, 0), { code: "ESRCH" })
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
