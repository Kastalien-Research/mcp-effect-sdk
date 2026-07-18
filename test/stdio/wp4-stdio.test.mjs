import assert from "node:assert/strict"
import { spawn } from "node:child_process"
import { readFileSync } from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { test } from "node:test"
import { Cause, Context, Deferred, Effect, Either, Fiber, Layer, Option, Queue, Stream } from "effect"
import * as McpSchema from "../../dist/McpSchema.js"
import * as McpServer from "../../dist/McpServer.js"
import * as StdioClientTransport from "../../dist/transport/StdioClientTransport.js"
import * as StdioServerTransport from "../../dist/transport/StdioServerTransport.js"
import * as StdioTransport from "../../dist/transport/StdioTransport.js"

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..")
const encoder = new TextEncoder()
const childFixture = path.join(root, "test/stdio/fixtures/stdio-child.mjs")
const serverDiagnosticFixture = path.join(root, "test/stdio/fixtures/stdio-server-diagnostic.mjs")

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
      Effect.forkScoped
    )
    yield* Deferred.await(hangingStarted)
    yield* Fiber.interrupt(hanging)
    assert.deepEqual(Object.keys(client), ["request"])
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
    const firstResult = yield* Fiber.join(first).pipe(Effect.timeoutOption("1 second"))
    const secondResult = yield* Fiber.join(second).pipe(Effect.timeoutOption("1 second"))
    assert.equal(Option.isSome(firstResult), true)
    assert.equal(Option.isSome(secondResult), true)
    assert.equal(Either.isLeft(firstResult.value), true)
    assert.equal(Either.isLeft(secondResult.value), true)
    assert.equal(firstResult.value.left._tag, "TransportError")
    assert.equal(firstResult.value.left.cause.stage, "Decode")
    assert.strictEqual(secondResult.value.left.cause, firstResult.value.left.cause)
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
    const result = yield* Fiber.join(active)
    assert.equal(Either.isLeft(result), true)
    assert.equal(result.left.cause.stage, "Exit")
    assert.equal(result.left.cause.exitCode, 23)
    assert.equal(result.left.cause.signal, null)
  })))
})

test("post-spawn child stdin EPIPE closes and fans out without an unhandled error event", async () => {
  await Effect.runPromise(Effect.scoped(Effect.gen(function*() {
    const stdinClosed = yield* Deferred.make()
    const client = yield* StdioClientTransport.make({
      command: process.execPath,
      args: [childFixture, "close-after-first"],
      stderrSink: (chunk) => new TextDecoder().decode(chunk).includes("stdin-closed")
        ? Deferred.succeed(stdinClosed, undefined).pipe(Effect.asVoid)
        : Effect.void
    })
    const active = yield* client.request(request("epipe", "test/hang")).pipe(
      Stream.runCollect,
      Effect.either,
      Effect.forkScoped
    )
    yield* Deferred.await(stdinClosed).pipe(Effect.timeout("1 second"))
    yield* Effect.yieldNow()
    const writers = yield* Effect.forEach([0, 1, 2, 3], (index) => client.request(
      request(`epipe-${index}`)
    ).pipe(Stream.runCollect, Effect.either, Effect.forkScoped))
    const result = yield* Fiber.join(active).pipe(Effect.timeoutOption("1 second"))
    assert.equal(Option.isSome(result), true)
    assert.equal(Either.isLeft(result.value), true)
    assert.equal(result.value.left.cause.stage, "Write")
    for (const writer of writers) {
      const writerResult = yield* Fiber.join(writer).pipe(Effect.timeoutOption("1 second"))
      assert.equal(Option.isSome(writerResult), true)
      assert.equal(Either.isLeft(writerResult.value), true)
      assert.strictEqual(writerResult.value.left.cause, result.value.left.cause)
    }
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
    yield* McpServer.registerTool({
      name: "registered",
      content: () => Effect.succeed("registered")
    }).pipe(Effect.provideService(McpServer.McpServer, service))
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
    if (Option.isNone(framed)) {
      const stopped = yield* Fiber.join(running).pipe(Effect.either, Effect.timeoutOption("100 millis"))
      if (Option.isSome(stopped) && Either.isLeft(stopped.value)) {
        const dispatcherFailure = stopped.value.left.cause
        const sendFailure = dispatcherFailure?._tag === "ServerDispatchFailure"
          ? Cause.failureOption(dispatcherFailure.cause)
          : Option.none()
        assert.fail(Option.isSome(sendFailure)
          ? `server send failed at ${sendFailure.value.stage}: ${sendFailure.value.message}; ${sendFailure.value.cause?.message}; ${sendFailure.value.cause?.cause?.message}`
          : `server stopped at ${stopped.value.left.stage}: ${stopped.value.left.message}`)
      }
      assert.fail("server did not emit a terminal response")
    }
    const response = JSON.parse(new TextDecoder().decode(framed.value))
    assert.strictEqual(response.id, "server-id")
    assert.equal(response.result.resultType, "complete")
    assert.deepEqual(response.result.tools.map(({ name }) => name), ["registered"])
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

test("stdio subscriptions validate before side effects and stay exact-ID owned until cancellation", async () => {
  await Effect.runPromise(Effect.scoped(Effect.gen(function*() {
    const input = yield* Queue.unbounded()
    const output = yield* Queue.unbounded()
    const service = yield* McpServer.McpServer.makeWithOptions({
      name: "stdio-subscription-test",
      version: "1.0.0"
    })
    const opened = []
    const closed = []
    const originalOpen = service.openSubscription
    service.openSubscription = (id, filter, sink) => {
      opened.push(id)
      const close = originalOpen(id, filter, sink)
      return () => {
        closed.push(id)
        close()
      }
    }
    const running = yield* StdioServerTransport.run({
      input: Stream.fromQueue(input),
      write: (chunk) => Queue.offer(output, new Uint8Array(chunk)).pipe(Effect.asVoid)
    }).pipe(
      Effect.provideService(McpServer.McpServer, service),
      Effect.forkScoped
    )
    const send = (message) => Queue.offer(input, bytes(`${JSON.stringify(wire(message))}\n`))
    const take = () => Queue.take(output).pipe(
      Effect.timeoutOption("1 second"),
      Effect.map((framed) => Option.map(framed, (chunk) => JSON.parse(new TextDecoder().decode(chunk))))
    )
    const expectNone = () => Queue.take(output).pipe(
      Effect.timeoutOption("30 millis"),
      Effect.map((value) => assert.equal(Option.isNone(value), true, "unexpected stdio subscription frame"))
    )

    const invalidParams = [
      { notifications: { toolsListChanged: true } },
      {
        notifications: { toolsListChanged: true },
        _meta: {
          "io.modelcontextprotocol/clientCapabilities": {},
          "io.modelcontextprotocol/protocolVersion": 20260728
        }
      }
    ]
    for (let index = 0; index < invalidParams.length; index++) {
      yield* Queue.offer(input, bytes(`${JSON.stringify({
        jsonrpc: "2.0",
        id: `invalid-sub-${index}`,
        method: "subscriptions/listen",
        params: invalidParams[index]
      })}\n`))
      const terminal = yield* take()
      assert.equal(Option.isSome(terminal), true)
      assert.strictEqual(terminal.value.id, `invalid-sub-${index}`)
      assert.equal(terminal.value.error.code, -32602)
      yield* expectNone()
    }
    assert.deepEqual(opened, [])
    yield* service.publish({ tag: "notifications/tools/list_changed", payload: {} })
    yield* expectNone()

    for (const id of [1, "1"]) {
      yield* send({
        ...request(id, "subscriptions/listen"),
        params: validParams({ notifications: { toolsListChanged: true } })
      })
      const acknowledged = yield* take()
      assert.equal(Option.isSome(acknowledged), true, `subscription was not acknowledged; opened=${JSON.stringify(opened)}`)
      assert.equal(acknowledged.value.method, "notifications/subscriptions/acknowledged")
      assert.strictEqual(
        acknowledged.value.params._meta["io.modelcontextprotocol/subscriptionId"],
        id
      )
      yield* expectNone()
    }
    assert.deepEqual(opened, [1, "1"])

    yield* service.publish({ tag: "notifications/tools/list_changed", payload: {} })
    const published = [yield* take(), yield* take()].map((value) =>
      value.value.params._meta["io.modelcontextprotocol/subscriptionId"])
    assert.deepEqual(published, [1, "1"])

    yield* send({
      ...request(1, "subscriptions/listen"),
      params: validParams({ notifications: { toolsListChanged: true } })
    })
    yield* expectNone()
    assert.deepEqual(opened, [1, "1"])
    assert.deepEqual(closed, [])

    yield* send({
      _tag: "Notification",
      jsonrpc: "2.0",
      method: "notifications/cancelled",
      params: { requestId: 1 }
    })
    yield* expectNone()
    assert.deepEqual(closed, [1])

    yield* service.publish({ tag: "notifications/tools/list_changed", payload: {} })
    const remaining = yield* take()
    assert.equal(Option.isSome(remaining), true)
    assert.strictEqual(
      remaining.value.params._meta["io.modelcontextprotocol/subscriptionId"],
      "1"
    )
    yield* expectNone()

    yield* send({
      _tag: "Notification",
      jsonrpc: "2.0",
      method: "notifications/cancelled",
      params: { requestId: "1" }
    })
    yield* expectNone()
    assert.deepEqual(closed, [1, "1"])
    yield* Fiber.interrupt(running)
  })))
})

test("invalid registry results become exact-id InternalError terminals without weakening JSON", async () => {
  await Effect.runPromise(Effect.scoped(Effect.gen(function*() {
    const input = yield* Queue.unbounded()
    const output = yield* Queue.unbounded()
    const service = yield* McpServer.McpServer.makeWithOptions({
      name: "stdio-invalid-result-test",
      version: "1.0.0"
    })
    const entry = {
      tool: {},
      annotations: Context.empty(),
      handler: () => Effect.die("tools/list must not invoke handlers")
    }
    service.tools.push(entry)
    const running = yield* StdioServerTransport.run({
      input: Stream.fromQueue(input),
      write: (chunk) => Queue.offer(output, new Uint8Array(chunk)).pipe(Effect.asVoid)
    }).pipe(
      Effect.provideService(McpServer.McpServer, service),
      Effect.forkScoped
    )

    const cycle = {}
    cycle.self = cycle
    const accessor = {}
    Object.defineProperty(accessor, "value", {
      enumerable: true,
      get: () => { throw new Error("must not invoke result accessors") }
    })
    const hostilePrototype = Object.create({ inherited: true })
    hostilePrototype.value = "not plain"
    const invalidValues = [
      [undefined],
      Number.NaN,
      Symbol("invalid"),
      () => "invalid",
      cycle,
      accessor,
      hostilePrototype
    ]

    for (let index = 0; index < invalidValues.length; index++) {
      entry.tool = new McpSchema.Tool({
        name: `invalid-${index}`,
        inputSchema: { type: "object" },
        vendorExtension: invalidValues[index]
      })
      yield* Queue.offer(input, bytes(`${JSON.stringify(wire({
        ...request(`invalid-${index}`),
        params: validParams()
      }))}\n`))
      const framed = yield* Queue.take(output).pipe(Effect.timeoutOption("1 second"))
      assert.equal(Option.isSome(framed), true, `invalid result ${index} killed the transport`)
      const terminal = JSON.parse(new TextDecoder().decode(framed.value))
      assert.strictEqual(terminal.id, `invalid-${index}`)
      assert.equal(terminal.error.code, -32603)
    }

    entry.tool = new McpSchema.Tool({ name: "valid-after-errors", inputSchema: { type: "object" } })
    yield* Queue.offer(input, bytes(`${JSON.stringify(wire({
      ...request("valid-after-errors"),
      params: validParams()
    }))}\n`))
    const recovered = yield* Queue.take(output).pipe(Effect.timeoutOption("1 second"))
    assert.equal(Option.isSome(recovered), true)
    assert.equal(JSON.parse(new TextDecoder().decode(recovered.value)).result.tools[0].name, "valid-after-errors")
    yield* Fiber.interrupt(running)
  })))
})

test("stdio server layer reports background transport failure only through its stderr sink", async () => {
  await Effect.runPromise(Effect.scoped(Effect.gen(function*() {
    const input = yield* Queue.unbounded()
    const reported = yield* Deferred.make()
    yield* StdioServerTransport.layer({
      name: "stdio-layer-test",
      version: "1.0.0",
      input: Stream.fromQueue(input),
      write: () => Effect.fail("fixture write failed"),
      stderrSink: (chunk) => Deferred.succeed(reported, new Uint8Array(chunk)).pipe(Effect.asVoid)
    }).pipe(Layer.build)
    yield* Queue.offer(input, bytes(`${JSON.stringify(wire({
      ...request("layer-failure"),
      params: validParams()
    }))}\n`))
    const diagnostic = yield* Deferred.await(reported).pipe(Effect.timeoutOption("1 second"))
    assert.equal(Option.isSome(diagnostic), true, "layer abandoned its failed transport fiber")
    assert.equal(
      new TextDecoder().decode(diagnostic.value),
      "mcp-effect-sdk: stdio server transport terminated at Write\n"
    )
  })))
})

test("default stderr diagnostics preserve the primary stage and survive a broken diagnostic pipe", async () => {
  const runFixture = (breakStderr) => new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [serverDiagnosticFixture], {
      stdio: ["pipe", "pipe", "pipe"]
    })
    let stdout = ""
    let stderr = ""
    let started = false
    const timeout = setTimeout(() => {
      child.kill("SIGKILL")
      reject(new Error("stdio diagnostic fixture hung"))
    }, 2_000)
    child.stdin.on("error", () => {})
    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString("utf8")
    })
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString("utf8")
      if (started || !stderr.includes("ready\n")) return
      started = true
      child.stdout.destroy()
      if (breakStderr) child.stderr.destroy()
      setTimeout(() => child.stdin.write(`${JSON.stringify(wire({
        ...request("diagnostic"),
        params: validParams()
      }))}\n`), 20)
    })
    child.once("error", (cause) => {
      clearTimeout(timeout)
      reject(cause)
    })
    child.once("exit", (code, signal) => {
      clearTimeout(timeout)
      resolve({ code, signal, stdout, stderr })
    })
  })

  const working = await runFixture(false)
  assert.equal(working.code, 0)
  assert.equal(working.signal, null)
  assert.equal(working.stdout, "")
  assert.equal(
    working.stderr,
    "ready\nmcp-effect-sdk: stdio server transport terminated at Write\n"
  )

  const broken = await runFixture(true)
  assert.equal(broken.code, 0, "broken process.stderr escaped as an unhandled error event")
  assert.equal(broken.signal, null)
  assert.equal(broken.stdout, "")
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

  const client = active.find(([relative]) => relative.endsWith("StdioClientTransport.ts"))[1]
  assert.doesNotMatch(client, /makeCompatibilityProtocol|readonly notifications:|sendNotification|readonly cancel:|readonly closed:/)
})

test("McpServer no longer owns an active duplicate stdio protocol loop", () => {
  const source = readFileSync(path.join(root, "src/McpServer.ts"), "utf8")
  assert.equal(/\bstdioLoop\b/.test(source), false)
  assert.equal(/\bStdioServerIO\b/.test(source), false)
  assert.equal(/\blayerStdio\b/.test(source), false)
})

test("process stream bridges use bounded event queues ahead of byte framing", () => {
  for (const relative of [
    "src/transport/StdioClientTransport.ts",
    "src/transport/StdioServerTransport.ts"
  ]) {
    const source = readFileSync(path.join(root, relative), "utf8")
    assert.equal(/bufferSize:\s*"unbounded"/.test(source), false, relative)
    assert.match(source, /bufferSize:\s*16/, relative)
    assert.match(source, /strategy:\s*"suspend"/, relative)
  }
})

test("post-spawn process and writable error events have scoped supervisors", () => {
  const client = readFileSync(path.join(root, "src/transport/StdioClientTransport.ts"), "utf8")
  const server = readFileSync(path.join(root, "src/transport/StdioServerTransport.ts"), "utf8")
  assert.match(client, /scopedErrorEvents\(child,/)
  assert.match(client, /scopedErrorEvents\(child\.stdin,/)
  assert.match(server, /scopedErrorEvents\(process\.stdout,/)
  assert.match(server, /scopedErrorEvents\(process\.stderr,/)
  for (const [relative, source] of [
    ["src/transport/StdioClientTransport.ts", client],
    ["src/transport/StdioServerTransport.ts", server]
  ]) {
    assert.match(source, /\.on\("error", onError\)/, relative)
    assert.match(source, /\.off\("error", onError\)/, relative)
  }
})
