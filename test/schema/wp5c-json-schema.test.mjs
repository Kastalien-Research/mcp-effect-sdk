import assert from "node:assert/strict"
import { test } from "node:test"
import * as Cause from "effect/Cause"
import * as Effect from "effect/Effect"
import * as Either from "effect/Either"
import * as Exit from "effect/Exit"
import * as Fiber from "effect/Fiber"
import * as FiberId from "effect/FiberId"
import * as TestClock from "effect/TestClock"
import * as TestContext from "effect/TestContext"
import { SchemaValidationError } from "../../dist/McpErrors.js"
import * as Server from "../../dist/server.js"

const encoder = new TextEncoder()
const canonicalBytes = (value) => encoder.encode(JSON.stringify(value))

const validator = () => {
  assert.equal(typeof Server.JsonSchemaValidator, "function", "JsonSchemaValidator export is absent")
  assert.equal(typeof Server.JsonSchemaValidator.default?.compile, "function")
  return Server.JsonSchemaValidator.default
}

const compile = (schema, resolver) => validator().compile({
  schema,
  ...(resolver === undefined ? {} : { resolver })
})

const resolverTag = () => {
  assert.equal(typeof Server.JsonSchemaResolver, "function", "JsonSchemaResolver export is absent")
  assert.equal(typeof Server.JsonSchemaResolver.make, "function")
  return Server.JsonSchemaResolver
}

const result = (compiled, value) => Effect.runPromise(compiled.validate(value).pipe(Effect.either))

const mixedCallbackCause = (label, order) => {
  const failure = Cause.fail(new Error(`${label}-failure-secret`))
  const defect = Cause.die(new Error(`${label}-defect-secret`))
  const interruption = Cause.interrupt(FiberId.runtime(71, 1))
  return order === "parallel"
    ? Cause.parallel(Cause.sequential(failure, defect), interruption)
    : Cause.sequential(Cause.parallel(failure, defect), interruption)
}

const assertMixedSchemaCause = (exit, original) => {
  assert.equal(Exit.isFailure(exit), true)
  assert.equal(Cause.isInterrupted(exit.cause), true)
  assert.equal(Cause.isInterruptedOnly(exit.cause), false)
  const failures = Array.from(Cause.failures(exit.cause))
  assert.equal(failures.length, 2)
  assert.equal(failures.every((failure) => failure instanceof SchemaValidationError), true)
  assert.equal(failures.every((failure) => failure.cause === original), true)
  assert.equal(Array.from(Cause.defects(exit.cause)).length, 0)
}

const makeResolver = async ({ documents, calls = [], ...policy }) => {
  return Effect.runPromise(resolverTag().make({
    allowedSchemes: ["https"],
    allowedHosts: ["schemas.example"],
    maxDepth: 8,
    maxBytes: 1_048_576,
    maxRedirects: 3,
    timeoutMs: 5_000,
    ...policy,
    load: (uri) => Effect.sync(() => {
      calls.push(uri)
      const document = documents.get(uri)
      if (document === undefined) throw new Error(`unexpected schema ${uri}`)
      return document.bytes === undefined
        ? { bytes: canonicalBytes(document), finalUri: uri, redirects: [] }
        : document
    })
  }))
}

test("validator is 2020-12, accepts arbitrary JSON, and evaluates local refs", async () => {
  const schema = {
    $schema: "https://json-schema.org/draft/2020-12/schema#",
    $defs: {
      node: {
        $dynamicAnchor: "node",
        type: "object",
        properties: {
          value: { type: ["string", "number", "boolean", "null"] },
          child: { $dynamicRef: "#node" }
        },
        required: ["value"],
        unevaluatedProperties: false
      }
    },
    $ref: "#/$defs/node"
  }
  const compiled = await Effect.runPromise(compile(schema))
  assert.equal(Either.isRight(await result(compiled, { value: null, child: { value: 1 } })), true)
  assert.equal(Either.isLeft(await result(compiled, { value: [], extra: true })), true)

  for (const [schemaValue, valid, invalid] of [
    [{ type: "array", items: { type: "integer" } }, [1, 2], [1, 2.5]],
    [{ type: "string" }, "ok", 1],
    [{ type: "null" }, null, false],
    [true, { anything: [1, null] }, undefined],
    [false, undefined, "anything"]
  ]) {
    const item = await Effect.runPromise(compile(schemaValue))
    if (valid !== undefined) assert.equal(Either.isRight(await result(item, valid)), true)
    if (invalid !== undefined) assert.equal(Either.isLeft(await result(item, invalid)), true)
  }
})

test("dialect is exact and external resolution is disabled by default", async () => {
  await Effect.runPromise(compile({ type: "string" }))
  await Effect.runPromise(compile({ $schema: "https://json-schema.org/draft/2020-12/schema", type: "string" }))
  for (const dialect of [
    "http://json-schema.org/draft-07/schema#",
    "https://schemas.example/unknown"
  ]) {
    const outcome = await Effect.runPromiseExit(compile({ $schema: dialect, type: "string" }))
    assert.equal(Exit.isFailure(outcome), true)
  }
  const blocked = await Effect.runPromiseExit(compile({ $ref: "https://schemas.example/value" }))
  assert.equal(Exit.isFailure(blocked), true)
})

test("resolver honors nested ids and ignores refs hidden in unknown annotations", async () => {
  const calls = []
  const resolver = await makeResolver({
    calls,
    documents: new Map([
      ["https://schemas.example/root/child.json", {
        $id: "https://schemas.example/nested/base.json",
        $defs: { text: { $anchor: "text", type: "string" } },
        allOf: [{ $ref: "next.json" }, { $ref: "#text" }],
        "x-example": { $ref: "https://schemas.example/must-not-load" }
      }],
      ["https://schemas.example/nested/next.json", { type: "string", minLength: 2 }]
    ])
  })
  const compiled = await Effect.runPromise(compile({
    $id: "https://schemas.example/root/schema.json",
    $ref: "child.json"
  }, resolver))
  assert.equal(Either.isRight(await result(compiled, "ok")), true)
  assert.equal(Either.isLeft(await result(compiled, "x")), true)
  assert.deepEqual(calls, [
    "https://schemas.example/root/child.json",
    "https://schemas.example/nested/next.json"
  ])
})

test("Ajv 2020 compatibility traversal resolves only evaluated schema positions", async () => {
  const calls = []
  const dependencyUri = "https://schemas.example/compat/dependency.json"
  const definitionUri = "https://schemas.example/compat/definition.json"
  const resolver = await makeResolver({
    calls,
    documents: new Map([
      [dependencyUri, {
        type: "object",
        properties: { dependencyValue: { const: true } },
        required: ["dependencyValue"]
      }],
      [definitionUri, { type: "string", minLength: 2 }]
    ])
  })
  const compiled = await Effect.runPromise(compile({
    type: "object",
    properties: {
      trigger: true,
      legacy: { $ref: "#/definitions/legacy" }
    },
    dependencies: {
      trigger: { $ref: dependencyUri },
      arrayTrigger: ["trigger", "https://schemas.example/must-not-load-array-entry"]
    },
    definitions: {
      legacy: { $ref: definitionUri }
    },
    "x-annotation": { $ref: "https://schemas.example/must-not-load-annotation" }
  }, resolver))

  assert.equal(calls.length, 2)
  assert.deepEqual(new Set(calls), new Set([dependencyUri, definitionUri]))
  assert.equal(Either.isRight(await result(compiled, {
    trigger: true,
    dependencyValue: true,
    legacy: "ok"
  })), true)
  assert.equal(Either.isLeft(await result(compiled, {
    trigger: true,
    legacy: "x"
  })), true)
})

test("Ajv 2020 compatibility rejects legacy recursive keywords without external resolution", async () => {
  const calls = []
  const resolver = await makeResolver({ calls, documents: new Map() })
  for (const schema of [
    { $recursiveAnchor: true },
    { $recursiveRef: "https://schemas.example/must-not-load-recursive" }
  ]) {
    assert.equal(Exit.isFailure(await Effect.runPromiseExit(compile(schema, resolver))), true)
  }
  assert.deepEqual(calls, [])
})

test("embedded resource ids keep same-document references local", async () => {
  const calls = []
  const resolver = await makeResolver({ calls, documents: new Map() })
  const compiled = await Effect.runPromise(compile({
    $id: "https://schemas.example/root.json",
    $defs: {
      embedded: {
        $id: "embedded.json",
        $defs: { text: { $anchor: "text", type: "string" } },
        type: "object",
        properties: { value: { $ref: "embedded.json#text" } },
        required: ["value"]
      }
    },
    $ref: "#/$defs/embedded"
  }, resolver))
  assert.equal(Either.isRight(await result(compiled, { value: "local" })), true)
  assert.deepEqual(calls, [])
})

test("external reference cycles are canonically deduplicated", async () => {
  const calls = []
  const resolver = await makeResolver({
    calls,
    maxDepth: 3,
    documents: new Map([
      ["https://schemas.example/a", {
        $id: "https://schemas.example/a",
        anyOf: [
          { type: "string" },
          {
            type: "object",
            properties: { next: { $ref: "https://schemas.example/b" } },
            required: ["next"],
            additionalProperties: false
          }
        ]
      }],
      ["https://schemas.example/b", {
        $id: "https://schemas.example/b",
        anyOf: [
          { type: "number" },
          {
            type: "object",
            properties: { next: { $ref: "https://schemas.example/a" } },
            required: ["next"],
            additionalProperties: false
          }
        ]
      }]
    ])
  })
  const compiled = await Effect.runPromise(compile({ $ref: "https://schemas.example/a" }, resolver))
  assert.equal(Either.isRight(await result(compiled, { next: { next: "cycle-terminates" } })), true)
  assert.deepEqual(calls, ["https://schemas.example/a", "https://schemas.example/b"])
})

test("resolver enforces depth, byte, and redirect equality then rejects the first excess", async () => {
  const a = { $id: "https://schemas.example/a", $ref: "https://schemas.example/b" }
  const b = { $id: "https://schemas.example/b", type: "string" }
  const root = { $ref: "https://schemas.example/a" }
  const documents = new Map([
    ["https://schemas.example/a", a],
    ["https://schemas.example/b", b]
  ])
  const exactBytes = canonicalBytes(root).byteLength + canonicalBytes(a).byteLength + canonicalBytes(b).byteLength
  const exact = await makeResolver({ documents, maxDepth: 2, maxBytes: exactBytes })
  await Effect.runPromise(compile(root, exact))
  for (const policy of [{ maxDepth: 1 }, { maxBytes: exactBytes - 1 }]) {
    const bounded = await makeResolver({ documents, ...policy })
    assert.equal(Exit.isFailure(await Effect.runPromiseExit(compile(root, bounded))), true)
  }

  const redirectDocument = { type: "string" }
  const redirected = new Map([["https://schemas.example/start", {
    bytes: canonicalBytes(redirectDocument),
    redirects: ["https://schemas.example/hop-one", "https://schemas.example/hop-two"],
    finalUri: "https://schemas.example/final"
  }]])
  await Effect.runPromise(compile(
    { $ref: "https://schemas.example/start" },
    await makeResolver({ documents: redirected, maxRedirects: 2 })
  ))
  assert.equal(Exit.isFailure(await Effect.runPromiseExit(compile(
    { $ref: "https://schemas.example/start" },
    await makeResolver({ documents: redirected, maxRedirects: 1 })
  ))), true)

  await Effect.runPromise(compile(
    { $ref: "https://schemas.example/start" },
    await makeResolver({
      documents: new Map([["https://schemas.example/start", {
        bytes: canonicalBytes(redirectDocument), redirects: [], finalUri: "https://schemas.example/start"
      }]]),
      maxRedirects: 0
    })
  ))
  assert.equal(Exit.isFailure(await Effect.runPromiseExit(compile(
    { $ref: "https://schemas.example/start" },
    await makeResolver({ documents: redirected, maxRedirects: 0 })
  ))), true)
})

test("resolver defaults are normalized and redirect final URI aliases compile once", async () => {
  const calls = []
  const aliasing = await Effect.runPromise(resolverTag().make({
    allowedSchemes: ["https"],
    allowedHosts: ["schemas.example"],
    load: (uri) => Effect.sync(() => {
      calls.push(uri)
      assert.equal(uri, "https://schemas.example/start")
      return {
        bytes: canonicalBytes({ type: "string" }),
        redirects: [],
        finalUri: "https://schemas.example/final"
      }
    })
  }))
  assert.deepEqual(aliasing.policy, {
    allowedSchemes: ["https"],
    allowedHosts: ["schemas.example"],
    maxDepth: 8,
    maxBytes: 1_048_576,
    maxRedirects: 3,
    timeoutMs: 5_000
  })
  const compiled = await Effect.runPromise(compile({
    allOf: [
      { $ref: "https://schemas.example/start" },
      { $ref: "https://schemas.example/final" }
    ]
  }, aliasing))
  assert.equal(Either.isRight(await result(compiled, "aliased")), true)
  assert.deepEqual(calls, ["https://schemas.example/start"])
})

test("root byte budget counts canonical caller bytes before accepted dialect normalization", async () => {
  const schema = {
    $schema: "https://json-schema.org/draft/2020-12/schema#",
    type: "string"
  }
  assert.equal(canonicalBytes(schema).byteLength, 75)
  const bounded = (maxBytes) => makeResolver({
    maxBytes,
    maxRedirects: 0,
    documents: new Map()
  })
  await Effect.runPromise(compile(schema, await bounded(75)))
  assert.equal(Exit.isFailure(await Effect.runPromiseExit(
    compile(schema, await bounded(74))
  )), true)
})

test("retrieval URI and distinct loaded root id are canonical aliases", async () => {
  const calls = []
  const retrieval = "https://schemas.example/retrieval"
  const canonical = "https://schemas.example/canonical"
  const resolver = await makeResolver({
    calls,
    documents: new Map([[retrieval, {
      $id: canonical,
      type: "string"
    }]])
  })
  const compiled = await Effect.runPromise(compile({
    allOf: [{ $ref: retrieval }, { $ref: canonical }]
  }, resolver))
  assert.equal(Either.isRight(await result(compiled, "aliased")), true)
  assert.deepEqual(calls, [retrieval])
})

test("resolver rejects request, redirect, and final URI allowlist escapes", async () => {
  for (const [ref, resolved] of [
    ["http://schemas.example/start", undefined],
    ["https://evil.example/start", undefined],
    ["https://schemas.example/start", {
      bytes: canonicalBytes({ type: "string" }),
      redirects: ["https://evil.example/hop"],
      finalUri: "https://schemas.example/final"
    }],
    ["https://schemas.example/start", {
      bytes: canonicalBytes({ type: "string" }),
      redirects: [],
      finalUri: "https://evil.example/final"
    }]
  ]) {
    const documents = new Map(resolved === undefined ? [] : [[ref, resolved]])
    const resolver = await makeResolver({ documents })
    assert.equal(Exit.isFailure(await Effect.runPromiseExit(compile({ $ref: ref }, resolver))), true)
  }
})

test("one deterministic total timeout accepts equality and rejects the first millisecond over", async () => {
  const attempt = (timeoutMs) => Effect.gen(function*() {
    const resolver = yield* resolverTag().make({
      allowedSchemes: ["https"], allowedHosts: ["schemas.example"],
      maxDepth: 1, maxBytes: 1024, maxRedirects: 1, timeoutMs,
      load: (uri) => Effect.sleep("5 seconds").pipe(Effect.as({
        bytes: canonicalBytes({ $id: uri, type: "string" }),
        finalUri: uri,
        redirects: []
      }))
    })
    const fiber = yield* compile({ $ref: "https://schemas.example/value" }, resolver).pipe(Effect.fork)
    yield* Effect.yieldNow()
    yield* TestClock.adjust("5 seconds")
    return yield* Fiber.await(fiber)
  }).pipe(Effect.provide(TestContext.TestContext))

  assert.equal(Exit.isSuccess(await Effect.runPromise(attempt(5_000))), true)
  const over = await Effect.runPromise(attempt(4_999))
  assert.equal(Exit.isFailure(over), true)
  const failure = Cause.failureOption(over.cause)
  assert.equal(failure._tag, "Some")
  assert.equal(failure.value instanceof SchemaValidationError, true)
})

test("hostile schemas and instances fail closed without invoking accessors or exposing values", async () => {
  let reads = 0
  const hostileSchema = { type: "object" }
  Object.defineProperty(hostileSchema, "properties", {
    enumerable: true,
    get() { reads += 1; return {} }
  })
  const schemaExit = await Effect.runPromiseExit(compile(hostileSchema))
  assert.equal(Exit.isFailure(schemaExit), true)
  assert.equal(reads, 0)

  const cycle = {}
  cycle.self = cycle
  const cyclicExit = await Effect.runPromiseExit(compile(cycle))
  assert.equal(Exit.isFailure(cyclicExit), true)

  const hostileProxy = new Proxy({}, {
    ownKeys() { throw new Error("proxy-trap-secret") }
  })
  const proxySchemaExit = await Effect.runPromiseExit(compile(hostileProxy))
  assert.equal(Exit.isFailure(proxySchemaExit), true)

  const compiled = await Effect.runPromise(compile({ type: "object", properties: { secret: { type: "string" } } }))
  const hostileValue = {}
  Object.defineProperty(hostileValue, "secret", {
    enumerable: true,
    get() { reads += 1; return "do-not-read-or-report" }
  })
  const invalid = await result(compiled, hostileValue)
  assert.equal(Either.isLeft(invalid), true)
  assert.equal(reads, 0)
  assert.equal(JSON.stringify(invalid.left).includes("do-not-read-or-report"), false)

  const symbolValue = { visible: true }
  symbolValue[Symbol("hidden")] = true
  const sparse = new Array(1)
  const cyclicValue = {}
  cyclicValue.self = cyclicValue
  for (const value of [
    hostileProxy,
    symbolValue,
    sparse,
    { value: Number.NaN },
    { value: Number.POSITIVE_INFINITY },
    cyclicValue
  ]) {
    const permissive = await Effect.runPromise(compile(true))
    assert.equal(Either.isLeft(await result(permissive, value)), true)
  }
})

test("schema and instance inputs are never mutated", async () => {
  const schema = {
    type: "object",
    properties: { nested: { type: "array", items: { type: "integer" } } },
    required: ["nested"],
    additionalProperties: false
  }
  const value = { nested: [1, 2] }
  const beforeSchema = JSON.stringify(schema)
  const beforeValue = JSON.stringify(value)
  const compiled = await Effect.runPromise(compile(schema))
  assert.equal(Either.isRight(await result(compiled, value)), true)
  assert.equal(JSON.stringify(schema), beforeSchema)
  assert.equal(JSON.stringify(value), beforeValue)
})

test("validation and resolution diagnostics are value-free while failures and defects retain Causes", async () => {
  const instance = "instance-sensitive-secret"
  const local = await Effect.runPromise(compile({ const: "schema-sensitive-secret" }))
  const mismatch = await result(local, instance)
  assert.equal(Either.isLeft(mismatch), true)
  const mismatchDiagnostic = JSON.stringify(mismatch.left)
  assert.equal(mismatchDiagnostic.includes(instance), false)
  assert.equal(mismatchDiagnostic.includes("schema-sensitive-secret"), false)

  const resolver = await Effect.runPromise(resolverTag().make({
    allowedSchemes: ["https"], allowedHosts: ["schemas.example"],
    maxDepth: 1, maxBytes: 1024, maxRedirects: 1, timeoutMs: 100,
    load: () => Effect.fail(new Error("resolver-sensitive-secret"))
  }))
  const failed = await Effect.runPromiseExit(compile({ $ref: "https://schemas.example/value" }, resolver))
  assert.equal(Exit.isFailure(failed), true)
  const failure = Cause.failureOption(failed.cause)
  assert.equal(failure._tag, "Some")
  assert.equal(failure.value instanceof SchemaValidationError, true)
  assert.equal(failure.value.cause !== undefined, true)
  assert.equal(JSON.stringify(failure.value).includes("resolver-sensitive-secret"), false)

  const defectResolver = await Effect.runPromise(resolverTag().make({
    allowedSchemes: ["https"], allowedHosts: ["schemas.example"],
    maxDepth: 1, maxBytes: 1024, maxRedirects: 1, timeoutMs: 100,
    load: () => Effect.die(new Error("resolver-defect-secret"))
  }))
  const defect = await Effect.runPromiseExit(compile({ $ref: "https://schemas.example/value" }, defectResolver))
  assert.equal(Exit.isFailure(defect), true)
  const defectFailure = Cause.failureOption(defect.cause)
  assert.equal(defectFailure._tag, "Some")
  assert.equal(defectFailure.value instanceof SchemaValidationError, true)
  assert.equal(defectFailure.value.cause !== undefined, true)
  assert.equal(JSON.stringify(defectFailure.value).includes("resolver-defect-secret"), false)

  const malformedResolver = await Effect.runPromise(resolverTag().make({
    allowedSchemes: ["https"], allowedHosts: ["schemas.example"],
    maxDepth: 1, maxBytes: 1024, maxRedirects: 1, timeoutMs: 100,
    load: (uri) => Effect.succeed({
      bytes: encoder.encode('{"response-sensitive-secret":'),
      finalUri: uri,
      redirects: []
    })
  }))
  const malformed = await Effect.runPromiseExit(compile({
    $ref: "https://schemas.example/value?token=uri-sensitive-secret#fragment-sensitive-secret"
  }, malformedResolver))
  assert.equal(Exit.isFailure(malformed), true)
  const malformedFailure = Cause.failureOption(malformed.cause)
  assert.equal(malformedFailure._tag, "Some")
  const safeDiagnostic = JSON.stringify(malformedFailure.value)
  for (const secret of ["response-sensitive-secret", "uri-sensitive-secret", "fragment-sensitive-secret"]) {
    assert.equal(safeDiagnostic.includes(secret), false)
  }

  const interruptedResolver = await Effect.runPromise(resolverTag().make({
    allowedSchemes: ["https"], allowedHosts: ["schemas.example"],
    maxDepth: 1, maxBytes: 1024, maxRedirects: 1, timeoutMs: 100,
    load: () => Effect.interrupt
  }))
  const interrupted = await Effect.runPromiseExit(compile(
    { $ref: "https://schemas.example/value" }, interruptedResolver
  ))
  assert.equal(Exit.isFailure(interrupted), true)
  assert.equal(Cause.isInterruptedOnly(interrupted.cause), true)
})

test("resolver callback throws and non-Effect returns become typed failures with local Causes", async (t) => {
  const policy = {
    allowedSchemes: ["https"], allowedHosts: ["schemas.example"],
    maxDepth: 1, maxBytes: 1024, maxRedirects: 0, timeoutMs: 100
  }
  const cases = [
    ["loader throw", async () => Effect.runPromise(resolverTag().make({
      ...policy,
      load: () => { throw new Error("loader-local-cause") }
    }))],
    ["loader non-Effect", async () => Effect.runPromise(resolverTag().make({
      ...policy,
      load: () => ({
        bytes: canonicalBytes({ type: "string" }),
        finalUri: "https://schemas.example/value",
        redirects: []
      })
    }))],
    ["custom resolve throw", async () => ({
      policy,
      resolve: () => { throw new Error("resolver-local-cause") }
    })],
    ["custom resolve non-Effect", async () => ({
      policy,
      resolve: () => ({
        bytes: canonicalBytes({ type: "string" }),
        finalUri: "https://schemas.example/value",
        redirects: []
      })
    })]
  ]
  for (const [label, service] of cases) {
    await t.test(label, async () => {
      const exit = await Effect.runPromiseExit(compile(
        { $ref: "https://schemas.example/value" },
        await service()
      ))
      assert.equal(Exit.isFailure(exit), true)
      const failure = Cause.failureOption(exit.cause)
      assert.equal(failure._tag, "Some")
      assert.equal(failure.value instanceof SchemaValidationError, true)
      assert.notEqual(failure.value.cause, undefined)
    })
  }
})

test("mixed resolver callback Causes retain typed failures, defects, interruption, and composition", async (t) => {
  const policy = {
    allowedSchemes: ["https"], allowedHosts: ["schemas.example"],
    maxDepth: 1, maxBytes: 1024, maxRedirects: 0, timeoutMs: 100
  }
  for (const [label, order, service] of [
    ["loader", "parallel", async (cause) => Effect.runPromise(resolverTag().make({
      ...policy,
      load: () => Effect.failCause(cause)
    }))],
    ["custom resolver", "sequential", async (cause) => ({
      policy,
      resolve: () => Effect.failCause(cause)
    })]
  ]) {
    await t.test(label, async () => {
      const original = mixedCallbackCause(label, order)
      const exit = await Effect.runPromiseExit(compile(
        { $ref: "https://schemas.example/value" },
        await service(original)
      ))
      assertMixedSchemaCause(exit, original)
    })
  }
})
