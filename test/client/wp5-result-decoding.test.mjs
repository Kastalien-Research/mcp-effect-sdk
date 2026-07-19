import assert from "node:assert/strict"
import { test } from "node:test"
import * as Effect from "effect/Effect"
import * as Either from "effect/Either"
import * as Option from "effect/Option"
import * as Schema from "effect/Schema"
import * as Stream from "effect/Stream"
import * as McpClient from "../../dist/McpClient.js"
import { TransportError } from "../../dist/McpErrors.js"
import * as McpSchema from "../../dist/McpSchema.js"
import { RootsProvider } from "../../dist/client-handlers/RootsProvider.js"
import { CLIENT_REQUEST_RESULT_CODEC_BY_METHOD } from "../../dist/generated/mcp/2026-07-28/McpProtocol.generated.js"

const SERVER_INFO_KEY = "io.modelcontextprotocol/serverInfo"
const serverInfo = { name: "wp5-client-server", version: "5.0.0" }

const success = (request, result) => ({
  _tag: "Success",
  response: {
    _tag: "SuccessResponse",
    jsonrpc: "2.0",
    id: request.id,
    result
  }
})

const discoverResult = (overrides = {}) => ({
  resultType: "complete",
  supportedVersions: ["2026-07-28"],
  capabilities: {
    tools: {},
    resources: {},
    prompts: {},
    completions: {}
  },
  ttlMs: 0,
  cacheScope: "private",
  _meta: { [SERVER_INFO_KEY]: serverInfo },
  ...overrides
})

const completeByMethod = {
  "tools/list": { resultType: "complete", tools: [], ttlMs: 0, cacheScope: "private" },
  "tools/call": { resultType: "complete", content: [] },
  "resources/list": { resultType: "complete", resources: [], ttlMs: 0, cacheScope: "private" },
  "resources/templates/list": {
    resultType: "complete",
    resourceTemplates: [],
    ttlMs: 0,
    cacheScope: "private"
  },
  "resources/read": { resultType: "complete", contents: [], ttlMs: 0, cacheScope: "private" },
  "prompts/list": { resultType: "complete", prompts: [], ttlMs: 0, cacheScope: "private" },
  "prompts/get": { resultType: "complete", messages: [] },
  "completion/complete": { resultType: "complete", completion: { values: [] } }
}

const makeClient = (transport) => McpClient.make(transport, {
  clientInfo: { name: "wp5-client", version: "5.0.0" }
})

const requestForMethod = (client, method) => {
  switch (method) {
    case "tools/list": return client.listTools()
    case "tools/call": return client.callTool({ name: "echo", arguments: {} })
    case "resources/list": return client.listResources()
    case "resources/templates/list": return client.listResourceTemplates()
    case "resources/read": return client.readResource({ uri: "test://resource" })
    case "prompts/list": return client.listPrompts()
    case "prompts/get": return client.getPrompt({ name: "prompt" })
    case "completion/complete": return client.complete({
      ref: { type: "ref/prompt", name: "prompt" },
      argument: { name: "argument", value: "v" }
    })
    default: throw new Error(`unknown test method ${method}`)
  }
}

const clientOutcomeForResult = (method, result) => Effect.runPromise(Effect.scoped(Effect.gen(function*() {
  const transport = {
    request: (request) => Stream.succeed(success(
      request,
      request.method === "server/discover" ? discoverResult() : result
    ))
  }
  const client = yield* makeClient(transport)
  return yield* requestForMethod(client, method).pipe(Effect.either)
})))

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

test("client decodes every complete high-level result with its exact generated method codec", async () => {
  const requests = []
  const transport = {
    request: (request) => {
      requests.push(request)
      const result = request.method === "server/discover"
        ? discoverResult({
            instructions: "",
            serverInfo: { name: "ignored-top-level", version: "0" }
          })
        : completeByMethod[request.method]
      return Stream.succeed(success(request, result))
    }
  }

  await Effect.runPromise(Effect.scoped(Effect.gen(function*() {
    const client = yield* makeClient(transport)
    const discoveredInfo = yield* client.serverInfo
    assert.equal(Option.isSome(discoveredInfo), true)
    assert.deepEqual({
      name: discoveredInfo.value.name,
      version: discoveredInfo.value.version
    }, serverInfo)
    const instructions = yield* client.instructions
    assert.equal(Option.isSome(instructions), true)
    assert.equal(instructions.value, "")
    for (const method of Object.keys(completeByMethod)) {
      const result = yield* requestForMethod(client, method)
      assert.equal(result.resultType, "complete", method)
    }
  })))

  assert.deepEqual(requests.map(({ method }) => method), [
    "server/discover",
    ...Object.keys(completeByMethod)
  ])
})

test("client accepts decoded exact result classes containing binary schema data", async (t) => {
  const cases = [
    {
      label: "resources/read blob",
      method: "resources/read",
      wire: {
        resultType: "complete",
        contents: [{
          uri: "test://binary-resource",
          mimeType: "application/octet-stream",
          blob: "AQID"
        }],
        ttlMs: 0,
        cacheScope: "private"
      },
      inspect: (result) => result.contents[0].blob
    },
    {
      label: "tools/call image content",
      method: "tools/call",
      wire: {
        resultType: "complete",
        content: [{ type: "image", data: "BAUG", mimeType: "image/png" }]
      },
      inspect: (result) => result.content[0].data
    },
    {
      label: "prompts/get audio content",
      method: "prompts/get",
      wire: {
        resultType: "complete",
        messages: [{
          role: "assistant",
          content: { type: "audio", data: "BwgJ", mimeType: "audio/wav" }
        }]
      },
      inspect: (result) => result.messages[0].content.data
    }
  ]

  for (const fixture of cases) {
    await t.test(fixture.label, async () => {
      const codec = CLIENT_REQUEST_RESULT_CODEC_BY_METHOD[fixture.method]
      const decoded = Schema.decodeUnknownSync(codec)(fixture.wire)
      assert.ok(fixture.inspect(decoded) instanceof Uint8Array)
      assert.deepEqual(Schema.encodeSync(codec)(decoded), fixture.wire)

      const transport = {
        request: (request) => Stream.succeed(success(
          request,
          request.method === "server/discover" ? discoverResult() : decoded
        ))
      }
      const outcome = await Effect.runPromise(Effect.scoped(Effect.gen(function*() {
        const client = yield* makeClient(transport)
        return yield* requestForMethod(client, fixture.method).pipe(Effect.either)
      })))
      assert.equal(
        Either.isRight(outcome),
        true,
        `client rejected exact decoded ${fixture.label} as ${Either.isLeft(outcome) ? outcome.left.reason : "unknown"}`
      )
      assert.ok(fixture.inspect(outcome.right) instanceof Uint8Array)
      assert.deepEqual(Schema.encodeSync(codec)(outcome.right), fixture.wire)
    })
  }
})

test("decoded result Unknown and open fields require a canonical strict-wire snapshot", async (t) => {
  const runtimeBytes = () => Uint8Array.from([9, 8, 7])
  const cases = [
    {
      label: "tools/call structuredContent",
      method: "tools/call",
      result: () => new McpSchema.CallToolResult({
        resultType: "complete",
        content: [],
        structuredContent: runtimeBytes()
      })
    },
    {
      label: "tools/call result metadata",
      method: "tools/call",
      result: () => new McpSchema.CallToolResult({
        resultType: "complete",
        content: [],
        _meta: { "example.com/runtime": runtimeBytes() }
      })
    },
    {
      label: "tools/call open result field",
      method: "tools/call",
      result: () => new McpSchema.CallToolResult({
        resultType: "complete",
        content: [],
        "example.com/runtime": runtimeBytes()
      })
    }
  ]

  for (const fixture of cases) {
    await t.test(fixture.label, async () => {
      const result = fixture.result()
      const codec = CLIENT_REQUEST_RESULT_CODEC_BY_METHOD[fixture.method]
      assert.equal(Either.isRight(Schema.validateEither(codec)(result)), true)
      const outcome = await clientOutcomeForResult(fixture.method, result)
      assert.equal(Either.isLeft(outcome), true, `${fixture.label} must not cross the JSON wire boundary`)
      assert.equal(outcome.left.reason, "Protocol")
    })
  }
})

test("decoded InputRequiredResult is canonicalized through its exact wire codec", async (t) => {
  await t.test("valid JSON open fields round-trip before MRTR retry", async () => {
    const decoded = new McpSchema.InputRequiredResult({
      resultType: "input_required",
      requestState: "canonical-state",
      "example.com/open": { nested: [1, true, null] }
    })
    const wire = Schema.encodeSync(McpSchema.InputRequiredResult)(decoded)
    assert.deepEqual(Schema.decodeUnknownSync(McpSchema.InputRequiredResult)(wire), decoded)
    let attempts = 0
    const transport = {
      request: (request) => {
        if (request.method === "server/discover") return Stream.succeed(success(request, discoverResult()))
        attempts += 1
        return Stream.succeed(success(
          request,
          attempts === 1 ? decoded : completeByMethod[request.method]
        ))
      }
    }
    const result = await Effect.runPromise(Effect.scoped(Effect.gen(function*() {
      const client = yield* makeClient(transport)
      return yield* client.callTool({ name: "echo", arguments: {} })
    })))
    assert.equal(result.resultType, "complete")
    assert.equal(attempts, 2)
  })

  await t.test("non-JSON open fields fail before MRTR retry", async () => {
    const decoded = new McpSchema.InputRequiredResult({
      resultType: "input_required",
      requestState: "non-canonical-state",
      "example.com/runtime": Uint8Array.from([1, 2, 3])
    })
    assert.equal(Either.isRight(Schema.validateEither(McpSchema.InputRequiredResult)(decoded)), true)
    let attempts = 0
    const transport = {
      request: (request) => {
        if (request.method === "server/discover") return Stream.succeed(success(request, discoverResult()))
        attempts += 1
        return Stream.succeed(success(
          request,
          attempts === 1 ? decoded : completeByMethod[request.method]
        ))
      }
    }
    const outcome = await Effect.runPromise(Effect.scoped(Effect.gen(function*() {
      const client = yield* makeClient(transport)
      return yield* client.callTool({ name: "echo", arguments: {} }).pipe(Effect.either)
    })))
    assert.equal(Either.isLeft(outcome), true)
    assert.equal(outcome.left.reason, "Protocol")
    assert.equal(attempts, 1)
  })
})

test("client binary cloning requires the intrinsic Uint8Array brand before descriptors", async (t) => {
  const outcomeForBytes = (blob) => clientOutcomeForResult("resources/read", new McpSchema.ReadResourceResult({
    resultType: "complete",
    contents: [new McpSchema.BlobResourceContents({ uri: "test://binary", blob })],
    ttlMs: 0,
    cacheScope: "private"
  }))

  await t.test("genuine bytes remain accepted", async () => {
    const outcome = await outcomeForBytes(Uint8Array.from([1, 2, 3]))
    assert.equal(Either.isRight(outcome), true)
    assert.deepEqual(outcome.right.contents[0].blob, Uint8Array.from([1, 2, 3]))
  })

  class DerivedBytes extends Uint8Array {}
  const extraKeyBytes = Uint8Array.from([1])
  Object.defineProperty(extraKeyBytes, "extra", { enumerable: true, value: 2 })
  for (const [label, bytes] of [
    ["Uint8Array subclass", new DerivedBytes([1])],
    ["exact bytes with an extra own key", extraKeyBytes]
  ]) {
    await t.test(label, async () => {
      const outcome = await outcomeForBytes(bytes)
      assert.equal(Either.isLeft(outcome), true)
      assert.equal(outcome.left.reason, "Protocol")
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
      const outcome = await outcomeForBytes(spoof.value)
      assert.equal(spoof.descriptorRequests(), 0, "non-view spoof must not enter the byte-copy path")
      assert.equal(spoof.accessorReads(), 0)
      assert.equal(Either.isLeft(outcome), true)
      assert.equal(outcome.left.reason, "Protocol")
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
      const outcome = await outcomeForBytes(bytes)
      assert.equal(Either.isLeft(outcome), true, "another typed-array brand must not be reinterpreted")
      assert.equal(outcome.left.reason, "Protocol")
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
      const outcome = await outcomeForBytes(bytes)
      assert.equal(Either.isLeft(outcome), true, `${label} must not be snapshotted as ordinary bytes`)
      assert.equal(outcome.left.reason, "Protocol")
    })
  }
})

test("top-level discovery identity is ignored when result metadata is absent", async () => {
  const { _meta: _metadata, ...withoutMetadata } = discoverResult({ serverInfo })
  const transport = {
    request: (request) => Stream.succeed(success(request, withoutMetadata))
  }
  const observed = await Effect.runPromise(Effect.scoped(Effect.gen(function*() {
    const client = yield* makeClient(transport)
    return yield* client.serverInfo
  })))
  assert.equal(Option.isNone(observed), true)
})

test("mixed discovery data canonicalizes a decoded reserved server identity", async () => {
  const mixed = discoverResult({
    _meta: { [SERVER_INFO_KEY]: new McpSchema.Implementation(serverInfo) }
  })
  const transport = {
    request: (request) => Stream.succeed(success(request, mixed))
  }
  const observed = await Effect.runPromise(Effect.scoped(Effect.gen(function*() {
    const client = yield* makeClient(transport)
    return yield* client.serverInfo
  })))
  assert.equal(Option.isSome(observed), true)
  assert.deepEqual({ name: observed.value.name, version: observed.value.version }, serverInfo)
})

test("invalid complete result, cache, and discriminator shapes fail as typed protocol errors", async () => {
  const invalidByMethod = {
    "tools/list": { resultType: "complete", tools: [], ttlMs: 0 },
    "tools/call": { resultType: "complete" },
    "resources/list": { resultType: "complete", resources: [], ttlMs: -1, cacheScope: "private" },
    "resources/templates/list": {
      resultType: "wrong",
      resourceTemplates: [],
      ttlMs: 0,
      cacheScope: "private"
    },
    "resources/read": { resultType: "complete", ttlMs: 0, cacheScope: "private" },
    "prompts/list": { resultType: "complete", prompts: "not-an-array", ttlMs: 0, cacheScope: "private" },
    "prompts/get": { resultType: "complete" },
    "completion/complete": { resultType: "complete" }
  }

  for (const [method, invalid] of Object.entries(invalidByMethod)) {
    const transport = {
      request: (request) => Stream.succeed(success(
        request,
        request.method === "server/discover" ? discoverResult() : invalid
      ))
    }
    const failure = await Effect.runPromise(Effect.scoped(Effect.gen(function*() {
      const client = yield* makeClient(transport)
      return yield* requestForMethod(client, method).pipe(Effect.either)
    })))
    assert.equal(Either.isLeft(failure), true, method)
    assert.equal(failure.left.reason, "Protocol", method)
    assert.ok(failure.left.cause, method)
  }
})

test("invalid discovery fails construction through the exact generated codec", async () => {
  const transport = {
    request: (request) => Stream.succeed(success(request, discoverResult({ cacheScope: "shared" })))
  }
  const failure = await Effect.runPromise(Effect.scoped(makeClient(transport).pipe(Effect.either)))
  assert.equal(Either.isLeft(failure), true)
  assert.equal(failure.left.reason, "Protocol")
  assert.ok(failure.left.cause)
})

test("hostile discovery metadata accessors and proxies fail as typed protocol errors", async (t) => {
  let metadataReads = 0
  let proxyTraps = 0
  const metadataAccessor = discoverResult()
  Object.defineProperty(metadataAccessor, "_meta", {
    enumerable: true,
    get() {
      metadataReads += 1
      throw new Error("hostile discovery metadata getter")
    }
  })
  const throwingProxy = new Proxy(discoverResult(), {
    ownKeys() {
      proxyTraps += 1
      throw new Error("hostile discovery proxy")
    }
  })

  for (const [label, result] of [
    ["metadata accessor", metadataAccessor],
    ["throwing proxy", throwingProxy]
  ]) {
    await t.test(label, async () => {
      const transport = {
        request: (request) => Stream.succeed(success(request, result))
      }
      const failure = await Effect.runPromise(Effect.scoped(makeClient(transport).pipe(Effect.either)))
      assert.equal(Either.isLeft(failure), true)
      assert.equal(failure.left._tag, "McpClientError")
      assert.equal(failure.left.reason, "Protocol")
      assert.ok(failure.left.cause)
      assert.notStrictEqual(failure.left.cause, result)
    })
  }
  assert.equal(metadataReads, 0)
  assert.ok(proxyTraps > 0)
})

test("hostile ordinary result metadata accessors and proxies fail as typed protocol errors", async (t) => {
  let metadataReads = 0
  let proxyTraps = 0
  const metadataAccessor = { ...completeByMethod["tools/list"] }
  Object.defineProperty(metadataAccessor, "_meta", {
    enumerable: true,
    get() {
      metadataReads += 1
      throw new Error("hostile tools/list metadata getter")
    }
  })
  const throwingProxy = new Proxy({ ...completeByMethod["tools/list"] }, {
    ownKeys() {
      proxyTraps += 1
      throw new Error("hostile tools/list proxy")
    }
  })

  for (const [label, result] of [
    ["metadata accessor", metadataAccessor],
    ["throwing proxy", throwingProxy]
  ]) {
    await t.test(label, async () => {
      const transport = {
        request: (request) => Stream.succeed(success(
          request,
          request.method === "server/discover" ? discoverResult() : result
        ))
      }
      const failure = await Effect.runPromise(Effect.scoped(Effect.gen(function*() {
        const client = yield* makeClient(transport)
        return yield* client.listTools().pipe(Effect.either)
      })))
      assert.equal(Either.isLeft(failure), true)
      assert.equal(failure.left._tag, "McpClientError")
      assert.equal(failure.left.reason, "Protocol")
      assert.ok(failure.left.cause)
      assert.notStrictEqual(failure.left.cause, result)
    })
  }
  assert.equal(metadataReads, 0)
  assert.ok(proxyTraps > 0)
})

test("valid input_required results remain discriminated through automatic MRTR for all allowed methods", async () => {
  const attempts = new Map()
  const transport = {
    request: (request) => {
      if (request.method === "server/discover") return Stream.succeed(success(request, discoverResult()))
      const attempt = (attempts.get(request.method) ?? 0) + 1
      attempts.set(request.method, attempt)
      return Stream.succeed(success(request, attempt === 1
        ? {
            resultType: "input_required",
            requestState: `state:${request.method}`,
            inputRequests: { roots: { method: "roots/list", params: {} } }
          }
        : completeByMethod[request.method]))
    }
  }

  await Effect.runPromise(Effect.scoped(Effect.gen(function*() {
    const client = yield* makeClient(transport)
    for (const method of ["prompts/get", "resources/read", "tools/call"]) {
      const result = yield* requestForMethod(client, method)
      assert.equal(result.resultType, "complete", method)
    }
  }).pipe(Effect.provideService(RootsProvider, {
    list: Effect.succeed({ resultType: "complete", roots: [] })
  }))))

  assert.deepEqual(Object.fromEntries(attempts), {
    "prompts/get": 2,
    "resources/read": 2,
    "tools/call": 2
  })
})

test("malformed input_required fails once as a protocol error before MRTR handling", async () => {
  let attempts = 0
  const transport = {
    request: (request) => {
      if (request.method === "server/discover") return Stream.succeed(success(request, discoverResult()))
      attempts += 1
      return Stream.succeed(success(request, { resultType: "input_required" }))
    }
  }
  const failure = await Effect.runPromise(Effect.scoped(Effect.gen(function*() {
    const client = yield* makeClient(transport)
    return yield* client.callTool({ name: "echo", arguments: {} }).pipe(Effect.either)
  })))
  assert.equal(Either.isLeft(failure), true)
  assert.equal(failure.left.reason, "Protocol")
  assert.ok(failure.left.cause)
  assert.equal(attempts, 1)
})

test("result decoding never masks the original transport failure Cause", async () => {
  const original = new TransportError({ message: "fixture transport failure", cause: { stage: "read" } })
  const transport = {
    request: (request) => request.method === "server/discover"
      ? Stream.succeed(success(request, discoverResult()))
      : Stream.fail(original)
  }
  const failure = await Effect.runPromise(Effect.scoped(Effect.gen(function*() {
    const client = yield* makeClient(transport)
    return yield* client.listTools().pipe(Effect.either)
  })))
  assert.equal(Either.isLeft(failure), true)
  assert.equal(failure.left.reason, "Transport")
  assert.strictEqual(failure.left.cause, original)
})
