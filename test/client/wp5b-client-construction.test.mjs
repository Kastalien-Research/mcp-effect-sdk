import assert from "node:assert/strict"
import { test } from "node:test"
import * as Context from "effect/Context"
import * as Deferred from "effect/Deferred"
import * as Effect from "effect/Effect"
import * as Either from "effect/Either"
import * as Fiber from "effect/Fiber"
import * as Stream from "effect/Stream"
import * as McpClient from "../../dist/McpClient.js"

const CLIENT_INFO_KEY = "io.modelcontextprotocol/clientInfo"
const CLIENT_CAPABILITIES_KEY = "io.modelcontextprotocol/clientCapabilities"
const SERVER_INFO_KEY = "io.modelcontextprotocol/serverInfo"
const serverInfo = { name: "wp5b-test-server", version: "5.0.0" }

const success = (request, result) => ({
  _tag: "Success",
  response: {
    _tag: "SuccessResponse",
    jsonrpc: "2.0",
    id: request.id,
    result
  }
})

const discoverResult = () => ({
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
  _meta: { [SERVER_INFO_KEY]: serverInfo }
})

const completeResult = (method) => {
  switch (method) {
    case "tools/list":
      return { resultType: "complete", tools: [], ttlMs: 0, cacheScope: "private" }
    case "resources/list":
      return { resultType: "complete", resources: [], ttlMs: 0, cacheScope: "private" }
    default:
      throw new Error(`No WP5B fixture for ${method}`)
  }
}

const respondingTransport = (requests = []) => ({
  request: (request) => {
    requests.push(request)
    return Stream.succeed(success(
      request,
      request.method === "server/discover" ? discoverResult() : completeResult(request.method)
    ))
  }
})

const runClient = (options, use) => Effect.runPromise(Effect.scoped(Effect.gen(function*() {
  const client = yield* McpClient.make(options)
  return yield* use(client)
})))

test("object construction omits absent client info and profiles every request by its final method and id", async () => {
  const requests = []
  const capabilityContexts = []
  const extensionContexts = []
  const transport = respondingTransport(requests)

  await runClient({
    transport,
    capabilities: (context) => Effect.sync(() => {
      capabilityContexts.push(context)
      return {
        experimental: {
          "com.example/request-profile": {
            id: context.id,
            method: context.method
          }
        }
      }
    }),
    extensions: (context) => Effect.sync(() => {
      extensionContexts.push(context)
      return {
        "com.example/client-profile": {
          id: context.id,
          method: context.method
        }
      }
    })
  }, (client) => Effect.gen(function*() {
    yield* client.listTools()
    yield* client.listResources()
  }))

  const expectedContexts = [
    { id: 1, method: "server/discover" },
    { id: 2, method: "tools/list" },
    { id: 3, method: "resources/list" }
  ]
  assert.deepEqual(capabilityContexts, expectedContexts)
  assert.deepEqual(extensionContexts, expectedContexts)
  assert.deepEqual(requests.map(({ id, method }) => ({ id, method })), expectedContexts)

  for (const request of requests) {
    const metadata = request.params._meta
    assert.equal(Object.hasOwn(metadata, CLIENT_INFO_KEY), false)
    assert.deepEqual(metadata[CLIENT_CAPABILITIES_KEY], {
      experimental: {
        "com.example/request-profile": {
          id: request.id,
          method: request.method
        }
      },
      extensions: {
        "com.example/client-profile": {
          id: request.id,
          method: request.method
        }
      }
    })
  }
})

test("client info is exact-validated once and its canonical snapshot is attached to every request", async () => {
  const requests = []
  const clientInfo = {
    name: "wp5b-client",
    title: "WP5B client",
    version: "5.0.0"
  }

  await runClient({ transport: respondingTransport(requests), clientInfo }, (client) => Effect.gen(function*() {
    clientInfo.name = "mutated-after-construction"
    yield* client.listTools()
  }))

  for (const request of requests) {
    assert.deepEqual(request.params._meta[CLIENT_INFO_KEY], {
      name: "wp5b-client",
      title: "WP5B client",
      version: "5.0.0"
    })
  }

  for (const invalid of [
    { name: "missing-version" },
    Object.defineProperty({ version: "5.0.0" }, "name", {
      enumerable: true,
      get() {
        throw new Error("client info accessor must not escape")
      }
    })
  ]) {
    let transportCalls = 0
    const outcome = await Effect.runPromise(Effect.scoped(
      McpClient.make({
        clientInfo: invalid,
        transport: {
          request: () => {
            transportCalls += 1
            return Stream.empty
          }
        }
      }).pipe(Effect.either)
    ))
    assert.equal(Either.isLeft(outcome), true)
    assert.equal(outcome.left.reason, "Protocol")
    assert.notEqual(outcome.left.cause, undefined)
    assert.equal(transportCalls, 0)
  }
})

test("constructor properties are descriptor-snapshotted once and provider replacement after make has no effect", async () => {
  const requests = []
  const descriptorReads = new Map()
  const target = {
    transport: respondingTransport(requests),
    capabilities: () => Effect.succeed({
      experimental: { "com.example/original": { source: "original" } }
    }),
    extensions: () => Effect.succeed({
      "com.example/original": { source: "original" }
    })
  }
  const options = new Proxy(target, {
    get(_target, property) {
      throw new Error(`constructor property was read directly: ${String(property)}`)
    },
    getOwnPropertyDescriptor(current, property) {
      descriptorReads.set(property, (descriptorReads.get(property) ?? 0) + 1)
      return Reflect.getOwnPropertyDescriptor(current, property)
    },
    ownKeys: (current) => Reflect.ownKeys(current)
  })

  await runClient(options, (client) => Effect.gen(function*() {
    target.capabilities = () => Effect.succeed({
      experimental: { "com.example/replacement": { source: "replacement" } }
    })
    target.extensions = () => Effect.succeed({
      "com.example/replacement": { source: "replacement" }
    })
    yield* client.listTools()
  }))

  assert.deepEqual(Object.fromEntries(descriptorReads), {
    transport: 1,
    capabilities: 1,
    extensions: 1
  })
  for (const request of requests) {
    assert.deepEqual(request.params._meta[CLIENT_CAPABILITIES_KEY], {
      experimental: { "com.example/original": { source: "original" } },
      extensions: { "com.example/original": { source: "original" } }
    })
  }
})

test("accessor client constructor properties fail typed without invocation or transport", async (t) => {
  for (const property of ["clientInfo", "capabilities", "extensions"]) {
    await t.test(property, async () => {
      let getterCalls = 0
      let transportCalls = 0
      const options = {
        transport: {
          request: () => {
            transportCalls += 1
            return Stream.empty
          }
        }
      }
      Object.defineProperty(options, property, {
        enumerable: true,
        get() {
          getterCalls += 1
          if (getterCalls === 1) {
            return property === "clientInfo"
              ? { name: "temporal-client", version: "1" }
              : () => Effect.succeed({})
          }
          throw new Error(`temporal ${property} getter was reread`)
        }
      })

      const outcome = await Effect.runPromise(Effect.scoped(
        McpClient.make(options).pipe(Effect.either)
      ))
      assert.equal(Either.isLeft(outcome), true)
      assert.equal(outcome.left.reason, "Protocol")
      assert.equal(getterCalls, 0)
      assert.equal(transportCalls, 0)
    })
  }
})

test("provider environments are captured during make and are not required by returned methods", async () => {
  const Profile = Context.GenericTag("wp5b/Profile")
  const requests = []
  const transport = respondingTransport(requests)

  const result = await Effect.runPromise(Effect.scoped(Effect.gen(function*() {
    const client = yield* McpClient.make({
      transport,
      capabilities: (context) => Effect.map(Profile, (profile) => ({
        experimental: {
          "com.example/captured-profile": {
            name: profile.name,
            requestId: context.id
          }
        }
      })),
      extensions: (context) => Effect.map(Profile, (profile) => ({
        "com.example/captured-extension": {
          name: profile.name,
          requestId: context.id
        }
      }))
    }).pipe(Effect.provideService(Profile, { name: "captured" }))

    // The Profile service is intentionally not provided around this method.
    return yield* client.listTools()
  })))

  assert.equal(result.resultType, "complete")
  assert.deepEqual(
    requests[1].params._meta[CLIENT_CAPABILITIES_KEY].experimental,
    { "com.example/captured-profile": { name: "captured", requestId: 2 } }
  )
  assert.deepEqual(
    requests[1].params._meta[CLIENT_CAPABILITIES_KEY].extensions,
    { "com.example/captured-extension": { name: "captured", requestId: 2 } }
  )
})

test("Deferred-controlled concurrent providers preserve interleaving isolation", async () => {
  const requests = []
  const transport = respondingTransport(requests)
  await Effect.runPromise(Effect.scoped(Effect.gen(function*() {
    const capabilityEntered = {
      "tools/list": yield* Deferred.make(),
      "resources/list": yield* Deferred.make()
    }
    const capabilityRelease = {
      "tools/list": yield* Deferred.make(),
      "resources/list": yield* Deferred.make()
    }
    const extensionEntered = {
      "tools/list": yield* Deferred.make(),
      "resources/list": yield* Deferred.make()
    }
    const extensionRelease = {
      "tools/list": yield* Deferred.make(),
      "resources/list": yield* Deferred.make()
    }
    const client = yield* McpClient.make({
      transport,
      capabilities: (context) => context.method === "server/discover"
        ? Effect.succeed({})
        : Effect.gen(function*() {
            yield* Deferred.succeed(capabilityEntered[context.method], undefined)
            yield* Deferred.await(capabilityRelease[context.method])
            return { experimental: { "com.example/profile": { method: context.method } } }
          }),
      extensions: (context) => context.method === "server/discover"
        ? Effect.succeed({})
        : Effect.gen(function*() {
            yield* Deferred.succeed(extensionEntered[context.method], undefined)
            yield* Deferred.await(extensionRelease[context.method])
            return { "com.example/profile": { method: context.method } }
          })
    })

    const tools = yield* Effect.fork(client.listTools())
    const resources = yield* Effect.fork(client.listResources())
    yield* Deferred.await(capabilityEntered["tools/list"])
    yield* Deferred.await(capabilityEntered["resources/list"])
    yield* Deferred.succeed(capabilityRelease["tools/list"], undefined)
    yield* Deferred.await(extensionEntered["tools/list"])
    yield* Deferred.succeed(capabilityRelease["resources/list"], undefined)
    yield* Deferred.await(extensionEntered["resources/list"])
    yield* Deferred.succeed(extensionRelease["resources/list"], undefined)
    yield* Deferred.succeed(extensionRelease["tools/list"], undefined)
    yield* Fiber.join(tools)
    yield* Fiber.join(resources)
  })))

  const ordinary = requests.filter(({ method }) => method !== "server/discover")
  assert.equal(ordinary.length, 2)
  for (const request of ordinary) {
    assert.equal(
      request.params._meta[CLIENT_CAPABILITIES_KEY].experimental["com.example/profile"].method,
      request.method
    )
    assert.equal(
      request.params._meta[CLIENT_CAPABILITIES_KEY].extensions["com.example/profile"].method,
      request.method
    )
  }
  assert.notEqual(
    ordinary[0].params._meta[CLIENT_CAPABILITIES_KEY],
    ordinary[1].params._meta[CLIENT_CAPABILITIES_KEY]
  )
})

test("extension authority grammar and JSONObject settings are shared by client construction", async (t) => {
  const invalidNames = [
    ".example/demo",
    "1com.example/demo",
    "com..example/demo",
    "com.example./demo",
    "com.example/-bad",
    "com.example/bad-"
  ]
  const invalidSettings = [null, 1, "settings", []]
  for (const [label, extensions] of [
    ...invalidNames.map((name) => [`name ${name}`, { [name]: {} }]),
    ...invalidSettings.map((settings, index) => [
      `settings ${index}`,
      { "com.example/settings": settings }
    ])
  ]) {
    await t.test(label, async () => {
      let transportCalls = 0
      const outcome = await Effect.runPromise(Effect.scoped(McpClient.make({
        transport: {
          request: () => {
            transportCalls += 1
            return Stream.empty
          }
        },
        extensions: () => Effect.succeed(extensions)
      }).pipe(Effect.either)))
      assert.equal(Either.isLeft(outcome), true)
      assert.equal(outcome.left.reason, "Protocol")
      assert.equal(transportCalls, 0)
    })
  }

  const requests = []
  const valid = {
    "com.example/": { emptyName: true },
    "com.example/demo": { nested: [null, true, 1, "value"] },
    "org.example-1/member_name.v2": {}
  }
  await runClient({
    transport: respondingTransport(requests),
    extensions: () => Effect.succeed(valid)
  }, (client) => client.listTools())
  assert.deepEqual(
    requests[1].params._meta[CLIENT_CAPABILITIES_KEY].extensions,
    valid
  )
})

test("mutating a provider result after completion cannot alter the request snapshot", async () => {
  const shared = {
    experimental: {
      "com.example/snapshot": { value: 1 }
    }
  }
  let ordinaryRequest
  let release
  let enteredResolve
  const entered = new Promise((resolve) => {
    enteredResolve = resolve
  })
  const transport = {
    request: (request) => {
      if (request.method === "server/discover") {
        return Stream.succeed(success(request, discoverResult()))
      }
      ordinaryRequest = request
      return Stream.fromEffect(Effect.async((resume) => {
        release = () => resume(Effect.succeed(success(request, completeResult(request.method))))
        enteredResolve()
      }))
    }
  }

  const running = runClient({
    transport,
    capabilities: () => Effect.succeed(shared)
  }, (client) => client.listTools())

  await Promise.race([entered, running])
  shared.experimental["com.example/snapshot"].value = 99
  release()
  await running

  assert.deepEqual(
    ordinaryRequest.params._meta[CLIENT_CAPABILITIES_KEY].experimental,
    { "com.example/snapshot": { value: 1 } }
  )
})

test("input-required policy explicitly owns the roots capability", async () => {
  const requests = []
  const transport = respondingTransport(requests)

  await Effect.runPromise(Effect.scoped(
    Effect.gen(function*() {
      const client = yield* McpClient.make({
        transport,
        inputRequired: {
          mode: "automatic",
          roots: { list: Effect.succeed({ resultType: "complete", roots: [] }) }
        }
      })
      yield* client.listTools()
    })
  ))

  assert.deepEqual(requests[1].params._meta[CLIENT_CAPABILITIES_KEY].roots, {})
})

test("provider throws, failures, defects, and non-canonical outputs fail as Protocol errors before transport", async (t) => {
  const marker = new Error("provider marker")
  const cyclic = {}
  cyclic.self = cyclic
  const accessor = Object.defineProperty({}, "sampling", {
    enumerable: true,
    get() {
      throw marker
    }
  })
  const cases = [
    ["synchronous throw", { capabilities: () => { throw marker } }],
    ["Effect failure", { capabilities: () => Effect.fail(marker) }],
    ["Effect defect", { capabilities: () => Effect.die(marker) }],
    ["capability cycle", { capabilities: () => Effect.succeed(cyclic) }],
    ["capability accessor", { capabilities: () => Effect.succeed(accessor) }],
    ["ambiguous capability extensions", {
      capabilities: () => Effect.succeed({ extensions: { "com.example/ambiguous": {} } })
    }],
    ["malformed extension name", {
      extensions: () => Effect.succeed({ "not-namespaced": {} })
    }],
    ["non-JSON extension value", {
      extensions: () => Effect.succeed({ "com.example/non-json": { value: 1n } })
    }]
  ]

  for (const [label, providers] of cases) {
    await t.test(label, async () => {
      let transportCalls = 0
      const outcome = await Effect.runPromise(Effect.scoped(
        McpClient.make({
          transport: {
            request: () => {
              transportCalls += 1
              return Stream.empty
            }
          },
          ...providers
        }).pipe(Effect.either)
      ))
      assert.equal(Either.isLeft(outcome), true)
      assert.equal(outcome.left.reason, "Protocol")
      assert.notEqual(outcome.left.cause, undefined)
      assert.equal(transportCalls, 0)
    })
  }
})

test("transport failures remain Transport errors with their original cause", async () => {
  const marker = new Error("transport marker")
  const outcome = await Effect.runPromise(Effect.scoped(
    McpClient.make({
      transport: { request: () => Stream.fail(marker) }
    }).pipe(Effect.either)
  ))

  assert.equal(Either.isLeft(outcome), true)
  assert.equal(outcome.left.reason, "Transport")
  assert.equal(outcome.left.cause, marker)
})
