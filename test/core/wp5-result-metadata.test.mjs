import assert from "node:assert/strict"
import { test } from "node:test"
import * as Context from "effect/Context"
import * as Effect from "effect/Effect"
import * as Option from "effect/Option"
import * as Queue from "effect/Queue"
import * as McpModern from "../../dist/McpModern.js"
import * as McpSchema from "../../dist/McpSchema.js"
import * as McpServer from "../../dist/McpServer.js"

const SERVER_INFO_KEY = "io.modelcontextprotocol/serverInfo"
const serverInfo = { name: "wp5-metadata-server", version: "5.0.0" }

const validParams = (params = {}) => ({
  ...params,
  _meta: {
    "io.modelcontextprotocol/protocolVersion": "2026-07-28",
    "io.modelcontextprotocol/clientCapabilities": {
      tools: {},
      resources: {},
      prompts: {},
      completions: {}
    }
  }
})

const request = (id, method, params = {}) => ({
  _tag: "Request",
  jsonrpc: "2.0",
  id,
  method,
  params: validParams(params)
})

const resultMeta = (label) => ({
  "example.com/preserved": label,
  [SERVER_INFO_KEY]: new McpSchema.Implementation({ name: "handler-spoof", version: "0" })
})

const complete = (fields, label) => ({
  ...fields,
  resultType: "complete",
  serverInfo: { name: "top-level-spoof", version: "0" },
  _meta: resultMeta(label)
})

const makeServer = () => Effect.gen(function*() {
  const service = yield* McpServer.McpServer.makeWithOptions(serverInfo)
  const annotations = Context.empty()

  service.tools.push({
    tool: new McpSchema.Tool({ name: "echo", inputSchema: { type: "object" } }),
    annotations,
    handler: () => Effect.succeed(new McpSchema.CallToolResult(complete({
      content: [new McpSchema.TextContent({ type: "text", text: "echo" })]
    }, "tools/call")))
  })
  service.resources.push({
    resource: new McpSchema.Resource({ uri: "test://resource", name: "resource" }),
    annotations,
    read: () => Effect.succeed(new McpSchema.ReadResourceResult(complete({
      ttlMs: 0,
      cacheScope: "private",
      contents: [new McpSchema.TextResourceContents({ uri: "test://resource", text: "resource" })]
    }, "resources/read")))
  })
  yield* service.addResourceTemplate({
    template: new McpSchema.ResourceTemplate({ uriTemplate: "test://{id}", name: "template" }),
    annotations,
    match: () => undefined,
    read: () => Effect.die("template reads are not used"),
    completions: {
      id: () => Effect.succeed(new McpSchema.CompleteResult(complete({
        completion: { values: ["one"] }
      }, "completion/complete")))
    }
  })
  yield* service.addPrompt({
    prompt: new McpSchema.Prompt({ name: "prompt" }),
    annotations,
    get: () => Effect.succeed(new McpSchema.GetPromptResult(complete({ messages: [] }, "prompts/get"))),
    completions: {}
  })
  return service
})

const dispatchToolResult = async ({
  configuredServerInfo = serverInfo,
  result
}) => {
  const sent = []
  await Effect.runPromise(Effect.scoped(Effect.gen(function*() {
    const service = yield* McpServer.McpServer.makeWithOptions(configuredServerInfo)
    service.tools.push({
      tool: new McpSchema.Tool({ name: "hostile", inputSchema: { type: "object" } }),
      annotations: Context.empty(),
      handler: () => Effect.succeed(result)
    })
    const sendEvents = yield* Queue.unbounded()
    const dispatcher = yield* McpServer.makeDispatcher({
      send: (message) => Effect.sync(() => sent.push(message)).pipe(
        Effect.zipRight(Queue.offer(sendEvents, undefined)),
        Effect.asVoid
      )
    }).pipe(Effect.provideService(McpServer.McpServer, service))

    yield* dispatcher.accept(request("hostile-result", "tools/call", {
      name: "hostile",
      arguments: {}
    }))
    yield* Queue.take(sendEvents)
  })))
  assert.equal(sent.length, 1)
  return sent[0]
}

const hostileCallResult = ({ topLevel, reserved, prototypeFields = false }) => {
  const metadata = {}
  Object.defineProperty(metadata, "example.com/preserved", {
    enumerable: true,
    value: "metadata-extension"
  })
  if (prototypeFields) {
    Object.defineProperty(metadata, "__proto__", {
      enumerable: true,
      value: { metadataPrototype: "data-only" }
    })
  }
  if (reserved !== undefined) {
    Object.defineProperty(metadata, SERVER_INFO_KEY, {
      enumerable: true,
      ...(reserved.kind === "accessor"
        ? { get: reserved.get }
        : { value: reserved.value })
    })
  }

  const result = {
    resultType: "complete",
    content: [],
    "example.com/open": { preserved: true },
    _meta: metadata
  }
  if (prototypeFields) {
    Object.defineProperty(result, "__proto__", {
      enumerable: true,
      value: { resultPrototype: "data-only" }
    })
  }
  if (topLevel !== undefined) {
    Object.defineProperty(result, "serverInfo", {
      enumerable: true,
      ...(topLevel.kind === "accessor"
        ? { get: topLevel.get }
        : { value: topLevel.value })
    })
  }
  return result
}

const binaryCallResult = (data) => new McpSchema.CallToolResult({
  resultType: "complete",
  content: [new McpSchema.ImageContent({ type: "image", data, mimeType: "image/png" })]
})

const spoofedBytes = (descriptor) => {
  let descriptorRequests = 0
  let accessorReads = 0
  const value = new Proxy({}, {
    getPrototypeOf: () => Uint8Array.prototype,
    get: (_target, key) => key === "length" ? 1 : undefined,
    ownKeys: () => ["0"],
    getOwnPropertyDescriptor: (_target, key) => {
      if (key !== "0") return undefined
      descriptorRequests += 1
      return descriptor === "accessor"
        ? {
            configurable: true,
            enumerable: true,
            get() {
              accessorReads += 1
              return 7
            }
          }
        : { configurable: true, enumerable: true, value: descriptor, writable: true }
    }
  })
  return {
    value,
    descriptorRequests: () => descriptorRequests,
    accessorReads: () => accessorReads
  }
}

test("server owns result identity in _meta for every complete high-level result", async () => {
  const cases = [
    ["discover-id", "server/discover", {}, undefined],
    [2, "tools/list", {}, undefined],
    ["2", "tools/call", { name: "echo", arguments: {} }, "tools/call"],
    [3, "resources/list", {}, undefined],
    ["3", "resources/templates/list", {}, undefined],
    [4, "resources/read", { uri: "test://resource" }, "resources/read"],
    ["4", "prompts/list", {}, undefined],
    [5, "prompts/get", { name: "prompt", arguments: {} }, "prompts/get"],
    ["5", "completion/complete", {
      ref: { type: "ref/resource", uri: "test://{id}" },
      argument: { name: "id", value: "o" }
    }, "completion/complete"]
  ]

  const sent = []
  await Effect.runPromise(Effect.scoped(Effect.gen(function*() {
    const service = yield* makeServer()
    const sendEvents = yield* Queue.unbounded()
    const dispatcher = yield* McpServer.makeDispatcher({
      send: (message) => Effect.sync(() => sent.push(message)).pipe(
        Effect.zipRight(Queue.offer(sendEvents, undefined)),
        Effect.asVoid
      )
    }).pipe(Effect.provideService(McpServer.McpServer, service))

    for (const [id, method, params] of cases) {
      yield* dispatcher.accept(request(id, method, params))
      yield* Queue.take(sendEvents)
    }
  })))

  assert.equal(sent.length, cases.length)
  for (let index = 0; index < cases.length; index++) {
    const [id, method, , handlerLabel] = cases[index]
    const response = sent[index]
    assert.equal(response._tag, "SuccessResponse", `${method}: ${JSON.stringify(response)}`)
    assert.strictEqual(response.id, id, method)
    assert.equal(response.result.resultType, "complete", method)
    assert.deepEqual(response.result._meta[SERVER_INFO_KEY], serverInfo, method)
    assert.equal("serverInfo" in response.result, false, method)
    if (handlerLabel !== undefined) {
      assert.equal(response.result._meta["example.com/preserved"], handlerLabel, method)
    }
  }
})

test("serverInfoFromResult validates only the reserved own data metadata entry", () => {
  const valid = {
    resultType: "complete",
    serverInfo: { name: "ignored-top-level", version: "0" },
    _meta: { [SERVER_INFO_KEY]: serverInfo }
  }
  const decoded = McpModern.serverInfoFromResult(valid)
  assert.equal(Option.isSome(decoded), true)
  assert.deepEqual({ name: decoded.value.name, version: decoded.value.version }, serverInfo)

  for (const invalid of [
    { resultType: "complete", serverInfo },
    { resultType: "complete", _meta: {} },
    { resultType: "complete", _meta: { [SERVER_INFO_KEY]: { name: "missing-version" } } },
    null,
    "not-a-result"
  ]) {
    assert.equal(Option.isNone(McpModern.serverInfoFromResult(invalid)), true)
  }
})

test("serverInfoFromResult never invokes result, metadata, or identity accessors", () => {
  let reads = 0
  let proxyTraps = 0
  const resultAccessor = Object.defineProperty({}, "_meta", {
    enumerable: true,
    get() {
      reads += 1
      throw new Error("result accessor must not run")
    }
  })
  const metadataAccessor = Object.defineProperty({}, SERVER_INFO_KEY, {
    enumerable: true,
    get() {
      reads += 1
      throw new Error("metadata accessor must not run")
    }
  })
  const identityAccessor = {
    name: "hostile",
    get version() {
      reads += 1
      throw new Error("identity accessor must not run")
    }
  }
  const throwingProxy = new Proxy({}, {
    getOwnPropertyDescriptor() {
      proxyTraps += 1
      throw new Error("hostile proxy descriptor")
    }
  })

  assert.equal(Option.isNone(McpModern.serverInfoFromResult(resultAccessor)), true)
  assert.equal(Option.isNone(McpModern.serverInfoFromResult({ _meta: metadataAccessor })), true)
  assert.equal(Option.isNone(McpModern.serverInfoFromResult({
    _meta: { [SERVER_INFO_KEY]: identityAccessor }
  })), true)
  assert.equal(Option.isNone(McpModern.serverInfoFromResult(throwingProxy)), true)
  assert.equal(reads, 0)
  assert.equal(proxyTraps, 1)
})

test("handler-controlled identity spoof shapes cannot veto exact result encoding", async (t) => {
  let accessorReads = 0
  const cyclicTopLevel = { name: "cyclic", version: "0" }
  cyclicTopLevel.self = cyclicTopLevel
  const cyclicReserved = { name: "cyclic", version: "0" }
  cyclicReserved.self = cyclicReserved
  const cases = [
    ["invalid top-level", { topLevel: { kind: "value", value: { name: "missing-version" } } }],
    ["cyclic top-level", { topLevel: { kind: "value", value: cyclicTopLevel } }],
    ["accessor top-level", {
      topLevel: {
        kind: "accessor",
        get: () => {
          accessorReads += 1
          throw new Error("top-level serverInfo accessor must not run")
        }
      }
    }],
    ["invalid reserved metadata", {
      reserved: { kind: "value", value: { name: "missing-version" } }
    }],
    ["cyclic reserved metadata", {
      reserved: { kind: "value", value: cyclicReserved }
    }],
    ["accessor reserved metadata", {
      reserved: {
        kind: "accessor",
        get: () => {
          accessorReads += 1
          throw new Error("reserved serverInfo accessor must not run")
        }
      }
    }]
  ]

  for (const [label, hostile] of cases) {
    await t.test(label, async () => {
      const response = await dispatchToolResult({ result: hostileCallResult(hostile) })
      assert.equal(response._tag, "SuccessResponse")
      assert.deepEqual(response.result._meta[SERVER_INFO_KEY], serverInfo)
      assert.equal("serverInfo" in response.result, false)
      assert.deepEqual(response.result["example.com/open"], { preserved: true })
      assert.equal(response.result._meta["example.com/preserved"], "metadata-extension")
      assert.equal(Object.getPrototypeOf(response.result), Object.prototype)
      assert.equal(Object.getPrototypeOf(response.result._meta), Object.prototype)
    })
  }
  assert.equal(accessorReads, 0)
})

test("discarded identity keys are skipped before Proxy descriptor traps", async (t) => {
  await t.test("top-level serverInfo descriptor", async () => {
    let reservedDescriptorTraps = 0
    const target = hostileCallResult({
      topLevel: { kind: "value", value: { name: "handler-spoof", version: "0" } }
    })
    const result = new Proxy(target, {
      getOwnPropertyDescriptor(target, key) {
        if (key === "serverInfo") {
          reservedDescriptorTraps += 1
          throw new Error("top-level reserved descriptor must not be requested")
        }
        return Reflect.getOwnPropertyDescriptor(target, key)
      }
    })

    const response = await dispatchToolResult({ result })
    assert.equal(reservedDescriptorTraps, 0)
    assert.equal(response._tag, "SuccessResponse")
    assert.deepEqual(response.result._meta[SERVER_INFO_KEY], serverInfo)
    assert.equal("serverInfo" in response.result, false)
  })

  await t.test("reserved metadata identity descriptor", async () => {
    let reservedDescriptorTraps = 0
    const result = hostileCallResult({
      reserved: {
        kind: "value",
        value: { name: "handler-spoof", version: "0" }
      }
    })
    result._meta = new Proxy(result._meta, {
      getOwnPropertyDescriptor(target, key) {
        if (key === SERVER_INFO_KEY) {
          reservedDescriptorTraps += 1
          throw new Error("nested reserved descriptor must not be requested")
        }
        return Reflect.getOwnPropertyDescriptor(target, key)
      }
    })

    const response = await dispatchToolResult({ result })
    assert.equal(reservedDescriptorTraps, 0)
    assert.equal(response._tag, "SuccessResponse")
    assert.deepEqual(response.result._meta[SERVER_INFO_KEY], serverInfo)
    assert.equal(response.result._meta["example.com/preserved"], "metadata-extension")
  })
})

test("server binary sanitation requires the intrinsic Uint8Array brand before descriptors", async (t) => {
  await t.test("genuine bytes remain accepted and encode as exact base64", async () => {
    const response = await dispatchToolResult({ result: binaryCallResult(Uint8Array.from([1, 2, 3])) })
    assert.equal(response._tag, "SuccessResponse")
    assert.equal(response.result.content[0].data, "AQID")
  })

  class DerivedBytes extends Uint8Array {}
  const extraKeyBytes = Uint8Array.from([1])
  Object.defineProperty(extraKeyBytes, "extra", { enumerable: true, value: 2 })
  for (const [label, bytes] of [
    ["Uint8Array subclass", new DerivedBytes([1])],
    ["exact bytes with an extra own key", extraKeyBytes]
  ]) {
    await t.test(label, async () => {
      const response = await dispatchToolResult({ result: binaryCallResult(bytes) })
      assert.equal(response._tag, "ErrorResponse")
      assert.equal(response.error.code, -32603)
    })
  }

  for (const [label, descriptor] of [
    ["cooperative data descriptor spoof", 7],
    ["accessor descriptor spoof", "accessor"],
    ["invalid byte descriptor spoof", 256]
  ]) {
    await t.test(label, async () => {
      const spoof = spoofedBytes(descriptor)
      assert.equal(spoof.value instanceof Uint8Array, true)
      assert.equal(ArrayBuffer.isView(spoof.value), false)
      const response = await dispatchToolResult({ result: binaryCallResult(spoof.value) })
      assert.equal(spoof.descriptorRequests(), 0, "non-view spoof must not enter the byte-copy path")
      assert.equal(spoof.accessorReads(), 0)
      assert.equal(response._tag, "ErrorResponse")
      assert.equal(response.error.code, -32603)
    })
  }

  const typedArrayTag = Object.getOwnPropertyDescriptor(
    Object.getPrototypeOf(Uint8Array.prototype),
    Symbol.toStringTag
  ).get
  for (const [label, bytes, actualBrand] of [
    [
      "prototype-mutated Uint8ClampedArray",
      Object.setPrototypeOf(new Uint8ClampedArray([1, 2]), Uint8Array.prototype),
      "Uint8ClampedArray"
    ],
    [
      "prototype-mutated Int8Array",
      Object.setPrototypeOf(new Int8Array([1, 2]), Uint8Array.prototype),
      "Int8Array"
    ],
    [
      "prototype-mutated Uint16Array",
      Object.setPrototypeOf(new Uint16Array([1, 2]), Uint8Array.prototype),
      "Uint16Array"
    ]
  ]) {
    await t.test(label, async () => {
      assert.equal(ArrayBuffer.isView(bytes), true)
      assert.equal(Object.getPrototypeOf(bytes), Uint8Array.prototype)
      assert.equal(typedArrayTag.call(bytes), actualBrand)
      const response = await dispatchToolResult({ result: binaryCallResult(bytes) })
      assert.equal(response._tag, "ErrorResponse", "another typed-array brand must not be reinterpreted")
      assert.equal(response.error.code, -32603)
    })
  }

  const detachedBytes = Uint8Array.from([1, 2, 3])
  structuredClone(detachedBytes.buffer, { transfer: [detachedBytes.buffer] })
  const resizableBytes = new Uint8Array(new ArrayBuffer(2, { maxByteLength: 4 }))
  resizableBytes.set([1, 2])
  const sharedBytes = new Uint8Array(new SharedArrayBuffer(2))
  sharedBytes.set([1, 2])
  for (const [label, bytes] of [
    ["detached exact Uint8Array", detachedBytes],
    ["resizable-backed exact Uint8Array", resizableBytes],
    ["SharedArrayBuffer-backed exact Uint8Array", sharedBytes]
  ]) {
    await t.test(label, async () => {
      assert.equal(typedArrayTag.call(bytes), "Uint8Array")
      assert.equal(Object.getPrototypeOf(bytes), Uint8Array.prototype)
      const response = await dispatchToolResult({ result: binaryCallResult(bytes) })
      assert.equal(response._tag, "ErrorResponse", `${label} must not be snapshotted as ordinary bytes`)
      assert.equal(response.error.code, -32603)
    })
  }
})

test("open __proto__ fields remain data properties without altering result prototypes", async () => {
  const response = await dispatchToolResult({
    result: hostileCallResult({ prototypeFields: true })
  })
  assert.equal(response._tag, "SuccessResponse")
  assert.equal(Object.getPrototypeOf(response.result), Object.prototype)
  assert.equal(Object.getPrototypeOf(response.result._meta), Object.prototype)
  assert.equal(Object.hasOwn(response.result, "__proto__"), true)
  assert.equal(Object.hasOwn(response.result._meta, "__proto__"), true)
  assert.deepEqual(response.result["__proto__"], { resultPrototype: "data-only" })
  assert.deepEqual(response.result._meta["__proto__"], { metadataPrototype: "data-only" })
})

test("invalid configured server identity fails closed before metadata injection", async () => {
  const response = await dispatchToolResult({
    configuredServerInfo: { name: "missing-version" },
    result: hostileCallResult({})
  })
  assert.equal(response._tag, "ErrorResponse")
  assert.deepEqual(response.error, {
    code: -32603,
    message: "Could not encode server result"
  })
})
