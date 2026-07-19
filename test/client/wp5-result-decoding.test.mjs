import assert from "node:assert/strict"
import { test } from "node:test"
import * as Effect from "effect/Effect"
import * as Either from "effect/Either"
import * as Option from "effect/Option"
import * as Stream from "effect/Stream"
import * as McpClient from "../../dist/McpClient.js"
import { TransportError } from "../../dist/McpErrors.js"
import { RootsProvider } from "../../dist/client-handlers/RootsProvider.js"

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
