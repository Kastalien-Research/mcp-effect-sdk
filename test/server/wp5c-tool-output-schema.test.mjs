import assert from "node:assert/strict"
import { test } from "node:test"
import * as Effect from "effect/Effect"
import * as Cause from "effect/Cause"
import * as Exit from "effect/Exit"
import * as FiberId from "effect/FiberId"
import * as Queue from "effect/Queue"
import * as Schema from "effect/Schema"
import * as ServerApi from "../../dist/server.js"
import * as McpServer from "../../dist/McpServer.js"
import * as McpSchema from "../../dist/McpSchema.js"
import { SchemaValidationError } from "../../dist/McpErrors.js"

const SERVER_INFO_KEY = "io.modelcontextprotocol/serverInfo"
const request = (id, method, params = {}) => ({
  _tag: "Request",
  jsonrpc: "2.0",
  id,
  method,
  params: {
    ...params,
    _meta: {
      "io.modelcontextprotocol/protocolVersion": "2026-07-28",
      "io.modelcontextprotocol/clientCapabilities": { tools: {} }
    }
  }
})

const dispatch = (server, message) => Effect.runPromise(Effect.scoped(Effect.gen(function*() {
  const sent = yield* Queue.unbounded()
  const dispatcher = yield* McpServer.makeDispatcher({
    send: (response) => Queue.offer(sent, response).pipe(Effect.asVoid)
  }).pipe(Effect.provideService(McpServer.McpServer, server))
  yield* dispatcher.accept(message)
  return yield* Queue.take(sent)
})))

const makeServer = (registrations, options = {}) => Effect.runPromise(McpServer.make({
  serverInfo: { name: "wp5c-output-server", version: "5.0.0" },
  handlers: Effect.gen(function*() {
    for (const registration of registrations) yield* McpServer.registerTool(registration)
  }),
  ...options
}))

const call = (server, name, id = name) => dispatch(server, request(id, "tools/call", {
  name,
  arguments: {}
}))

const localClient = McpSchema.McpServerClient.of({
  clientId: "wp5c-local",
  requestContext: { protocolVersion: "2026-07-28", capabilities: { tools: {} } }
})

const callLocalExit = (server, name) => Effect.runPromiseExit(server.callTool({
  name,
  arguments: {}
}).pipe(Effect.provideService(McpSchema.McpServerClient, localClient)))

const mixedCallbackCause = (label, order) => {
  const failure = Cause.fail(new Error(`${label}-failure-sensitive-secret`))
  const defect = Cause.die(new Error(`${label}-defect-sensitive-secret`))
  const interruption = Cause.interrupt(FiberId.runtime(72, 1))
  return order === "parallel"
    ? Cause.parallel(Cause.sequential(failure, defect), interruption)
    : Cause.sequential(Cause.parallel(failure, defect), interruption)
}

const originalCauseIn = (error, original) => error?.cause === original || error?.cause?.cause === original

const assertMixedSchemaCause = (exit, original) => {
  assert.equal(Exit.isFailure(exit), true)
  assert.equal(Cause.isInterrupted(exit.cause), true)
  assert.equal(Cause.isInterruptedOnly(exit.cause), false)
  const failures = Array.from(Cause.failures(exit.cause))
  assert.equal(failures.length, 2)
  assert.equal(failures.every((failure) => failure instanceof SchemaValidationError), true)
  assert.equal(failures.every((failure) => originalCauseIn(failure, original)), true)
  assert.equal(Array.from(Cause.defects(exit.cause)).length, 0)
}

const typedMixedCallbackCause = (label, order, existingCause) => {
  const error = new SchemaValidationError({
    message: `${label}-typed-message-sensitive-secret`,
    data: { semantic: `${label}-typed-data-sensitive-secret` },
    ...(existingCause === undefined ? {} : { cause: existingCause })
  })
  const interruption = Cause.interrupt(FiberId.runtime(74, 1))
  return {
    error,
    cause: order === "parallel"
      ? Cause.parallel(Cause.fail(error), interruption)
      : Cause.sequential(Cause.fail(error), interruption)
  }
}

const hostileTypedMixedCallbackCause = (label, order) => {
  const source = new SchemaValidationError({
    message: `${label}-hostile-message-sensitive-secret`,
    data: { semantic: `${label}-hostile-data-sensitive-secret` }
  })
  const state = { getPrototypeOf: 0 }
  const hostile = new Proxy(source, {
    getPrototypeOf() {
      state.getPrototypeOf += 1
      throw new Error(`${label}-prototype-trap-sensitive-secret`)
    }
  })
  const interruption = Cause.interrupt(FiberId.runtime(76, 1))
  return {
    cause: order === "parallel"
      ? Cause.parallel(Cause.fail(hostile), interruption)
      : Cause.sequential(Cause.fail(hostile), interruption),
    hostile,
    source,
    state
  }
}

const DEEP_CAUSE_DEPTH = 12_000

const deepMixedCallbackCause = (label) => {
  const source = new Error(`${label}-deep-failure-sensitive-secret`)
  const interruption = Cause.interrupt(FiberId.runtime(78, 1))
  let cause = Cause.parallel(Cause.fail(source), interruption)
  for (let depth = 0; depth < DEEP_CAUSE_DEPTH; depth++) {
    cause = Cause.sequential(interruption, cause)
  }
  return { cause, interruption, source }
}

const causeShape = (cause) => {
  const shape = { Empty: 0, Fail: 0, Die: 0, Interrupt: 0, Sequential: 0, Parallel: 0 }
  const pending = [cause]
  while (pending.length > 0) {
    const current = pending.pop()
    shape[current._tag] += 1
    if (current._tag === "Sequential" || current._tag === "Parallel") {
      pending.push(current.right, current.left)
    }
  }
  return shape
}

const assertSharedDeepInterruption = (cause) => {
  let current = cause
  let shared
  for (let depth = 0; depth < DEEP_CAUSE_DEPTH; depth++) {
    assert.equal(current._tag, "Sequential")
    assert.equal(current.left._tag, "Interrupt")
    shared ??= current.left
    assert.equal(current.left, shared)
    current = current.right
  }
  assert.equal(current._tag, "Parallel")
  assert.equal(current.right, shared)
}

const semanticFailureIn = (failure, source) => failure?.message === source.message
  ? failure
  : failure?.cause instanceof SchemaValidationError && failure.cause.message === source.message
    ? failure.cause
    : undefined

const assertTypedMixedSchemaCause = (exit, original, source, sourceCause = undefined) => {
  assert.equal(Exit.isFailure(exit), true)
  assert.equal(Cause.isInterrupted(exit.cause), true)
  assert.equal(Cause.isInterruptedOnly(exit.cause), false)
  const failures = Array.from(Cause.failures(exit.cause))
  assert.equal(failures.length, 1)
  assert.equal(failures[0] instanceof SchemaValidationError, true)
  const semantic = semanticFailureIn(failures[0], source)
  assert.notEqual(semantic, undefined)
  assert.notEqual(semantic, source)
  assert.equal(semantic.message, source.message)
  assert.deepEqual(semantic.data, source.data)
  assert.equal(semantic.cause, original)
  assert.equal(source.cause, sourceCause)
}

test("invalid advertised output schema fails typed during registration before later handlers", async () => {
  let continued = false
  const outcome = await Effect.runPromiseExit(McpServer.make({
    serverInfo: { name: "wp5c-invalid-schema", version: "5.0.0" },
    handlers: Effect.gen(function*() {
      yield* McpServer.registerTool({
        name: "invalid-schema",
        outputSchema: {
          $schema: "http://json-schema.org/draft-07/schema#",
          type: "string"
        },
        content: () => Effect.succeed({ content: [], structuredContent: "never" })
      })
      continued = true
    })
  }))
  assert.equal(Exit.isFailure(outcome), true)
  const failure = Cause.failureOption(outcome.cause)
  assert.equal(failure._tag, "Some")
  assert.equal(failure.value?._tag, "SchemaValidationError")
  assert.equal(continued, false)
})

test("tool output schema is snapshotted at registration and advertised unchanged", async () => {
  assert.equal(typeof ServerApi.JsonSchemaValidator, "function", "WP5C server surface is absent")
  const outputSchema = {
    $schema: "https://json-schema.org/draft/2020-12/schema",
    type: "object",
    properties: { value: { type: "string" } },
    required: ["value"],
    additionalProperties: false
  }
  const expected = structuredClone(outputSchema)
  const server = await makeServer([{
    name: "snapshotted",
    outputSchema,
    content: () => Effect.succeed({ content: [], structuredContent: { value: "original" } })
  }])
  outputSchema.properties.value.type = "number"
  outputSchema.required.push("mutated")

  const listed = await dispatch(server, request("list", "tools/list"))
  assert.equal(listed._tag, "SuccessResponse")
  assert.deepEqual(listed.result.tools[0].outputSchema, expected)
  assert.equal((await call(server, "snapshotted"))._tag, "SuccessResponse")
})

test("tool output validation accepts every JSON shape allowed by its schema", async () => {
  const cases = [
    ["object", { type: "object", properties: { ok: { const: true } }, required: ["ok"] }, { ok: true }],
    ["array", { type: "array", items: { type: "integer" } }, [1, 2]],
    ["string", { type: "string", minLength: 1 }, "value"],
    ["null", { type: "null" }, null]
  ]
  const server = await makeServer(cases.map(([name, outputSchema, structuredContent]) => ({
    name,
    outputSchema,
    content: () => Effect.succeed({ content: [], structuredContent })
  })))
  for (const [name] of cases) {
    const response = await call(server, name)
    assert.equal(response._tag, "SuccessResponse", `${name}: ${JSON.stringify(response)}`)
    assert.equal(response.result.resultType, "complete")
    assert.deepEqual(response.result._meta[SERVER_INFO_KEY], {
      name: "wp5c-output-server",
      version: "5.0.0"
    })
  }
})

test("invalid, missing, hostile, and isError structured outputs fail before success metadata", async () => {
  let getterReads = 0
  const hostile = {}
  Object.defineProperty(hostile, "value", {
    enumerable: true,
    get() { getterReads += 1; return "must-not-run" }
  })
  const accessorResult = { content: [] }
  Object.defineProperty(accessorResult, "structuredContent", {
    enumerable: true,
    get() { getterReads += 1; return { value: "must-not-run" } }
  })
  const inheritedResult = Object.create({ structuredContent: { value: "inherited" } })
  inheritedResult.content = []
  const schema = {
    type: "object",
    properties: { value: { type: "string" } },
    required: ["value"],
    additionalProperties: false
  }
  const server = await makeServer([
    { name: "invalid", outputSchema: schema, content: () => Effect.succeed({ content: [], structuredContent: { value: 1 } }) },
    { name: "missing", outputSchema: schema, content: () => Effect.succeed({ content: [] }) },
    { name: "hostile", outputSchema: schema, content: () => Effect.succeed({ content: [], structuredContent: hostile }) },
    { name: "accessor", outputSchema: schema, content: () => Effect.succeed(accessorResult) },
    { name: "inherited", outputSchema: schema, content: () => Effect.succeed(inheritedResult) },
    { name: "error-invalid", outputSchema: schema, content: () => Effect.succeed({ isError: true, content: [], structuredContent: { value: 1 } }) }
  ])

  for (const name of ["invalid", "missing", "hostile", "accessor", "inherited", "error-invalid"]) {
    const response = await call(server, name)
    assert.equal(response._tag, "ErrorResponse", `${name}: ${JSON.stringify(response)}`)
    assert.equal(response.error.code, -32602)
    assert.equal(response.error.message, "Tool output failed JSON Schema validation")
    assert.equal(JSON.stringify(response).includes(SERVER_INFO_KEY), false)
    assert.equal(JSON.stringify(response).includes("must-not-run"), false)
  }
  assert.equal(getterReads, 0)
})

test("server construction snapshots validator and resolver methods before handlers run", async () => {
  const encoder = new TextEncoder()
  const validator = {
    compile: (options) => ServerApi.JsonSchemaValidator.default.compile(options)
  }
  const resolver = {
    policy: {
      allowedSchemes: ["https"], allowedHosts: ["schemas.example"],
      maxDepth: 1, maxBytes: 1024, maxRedirects: 0, timeoutMs: 100
    },
    resolve: (uri) => Effect.succeed({
      bytes: encoder.encode(JSON.stringify({ $id: uri, type: "string" })),
      finalUri: uri,
      redirects: []
    })
  }
  const server = await Effect.runPromise(McpServer.make({
    serverInfo: { name: "wp5c-snapshot-services", version: "5.0.0" },
    jsonSchemaValidator: validator,
    jsonSchemaResolver: resolver,
    handlers: Effect.sync(() => {
      validator.compile = () => Effect.die(new Error("mutated validator"))
      resolver.resolve = () => Effect.die(new Error("mutated resolver"))
    }).pipe(Effect.zipRight(McpServer.registerTool({
      name: "snapshotted-services",
      outputSchema: { $ref: "https://schemas.example/output" },
      content: () => Effect.succeed({ content: [], structuredContent: "ok" })
    })))
  }))
  assert.equal((await call(server, "snapshotted-services"))._tag, "SuccessResponse")
})

test("schema diagnostics and arbitrary custom validator data stay local-only", async (t) => {
  const uri = "https://schemas.example/output?token=wire-sensitive-secret"
  const encoder = new TextEncoder()
  const resolver = await Effect.runPromise(ServerApi.JsonSchemaResolver.make({
    allowedSchemes: ["https"], allowedHosts: ["schemas.example"],
    maxDepth: 1, maxBytes: 1024, maxRedirects: 0, timeoutMs: 100,
    load: () => Effect.succeed({
      bytes: encoder.encode(JSON.stringify({ $id: uri, const: "expected" })),
      finalUri: uri,
      redirects: []
    })
  }))
  await t.test("external Ajv schemaPath", async () => {
    const external = await makeServer([{
      name: "external-diagnostic",
      outputSchema: { $ref: uri },
      content: () => Effect.succeed({ content: [], structuredContent: "actual" })
    }], { jsonSchemaResolver: resolver })
    const externalWire = JSON.stringify(await call(external, "external-diagnostic"))
    assert.equal(externalWire.includes("wire-sensitive-secret"), false)
    assert.equal(externalWire.includes("schemas.example"), false)
  })

  await t.test("custom validator arbitrary data", async () => {
    const arbitrarySecret = "custom-validator-sensitive-secret"
    const custom = await makeServer([{
      name: "custom-diagnostic",
      outputSchema: { type: "string" },
      content: () => Effect.succeed({ content: [], structuredContent: "value" })
    }], {
      jsonSchemaValidator: {
        compile: () => Effect.succeed({
          validate: () => Effect.fail(new SchemaValidationError({
            message: "custom validator rejected output",
            data: { arbitrarySecret }
          }))
        })
      }
    })
    const customWire = JSON.stringify(await call(custom, "custom-diagnostic"))
    assert.equal(customWire.includes(arbitrarySecret), false)
  })
})

test("validator callback throws and non-Effect returns are typed, Cause-preserving failures", async (t) => {
  for (const [label, compile] of [
    ["compile throw", () => { throw new Error("compile-local-cause") }],
    ["compile non-Effect", () => ({ validate: () => Effect.void })]
  ]) {
    await t.test(label, async () => {
      let continued = false
      const exit = await Effect.runPromiseExit(McpServer.make({
        serverInfo: { name: `wp5c-${label}`, version: "5.0.0" },
        jsonSchemaValidator: { compile },
        handlers: McpServer.registerTool({
          name: label,
          outputSchema: { type: "string" },
          content: () => Effect.succeed({ content: [], structuredContent: "ok" })
        }).pipe(Effect.zipRight(Effect.sync(() => { continued = true })))
      }))
      assert.equal(Exit.isFailure(exit), true)
      const failure = Cause.failureOption(exit.cause)
      assert.equal(failure._tag, "Some")
      assert.equal(failure.value instanceof SchemaValidationError, true)
      assert.notEqual(failure.value.cause, undefined)
      assert.equal(continued, false)
    })
  }

  for (const [label, validate] of [
    ["validate throw", () => { throw new Error("validate-local-cause") }],
    ["validate non-Effect", () => undefined]
  ]) {
    await t.test(label, async () => {
      const server = await makeServer([{
        name: label,
        outputSchema: { type: "string" },
        content: () => Effect.succeed({ content: [], structuredContent: "ok" })
      }], {
        jsonSchemaValidator: { compile: () => Effect.succeed({ validate }) }
      })
      const exit = await callLocalExit(server, label)
      assert.equal(Exit.isFailure(exit), true)
      const failure = Cause.failureOption(exit.cause)
      assert.equal(failure._tag, "Some")
      assert.equal(failure.value instanceof SchemaValidationError, true)
      assert.notEqual(failure.value.cause, undefined)
      const wire = await call(server, label)
      assert.equal(wire._tag, "ErrorResponse")
      assert.equal(wire.error.code, -32602)
    })
  }
})

test("mixed validator callback Causes preserve typed local structure and safe tool wire", async (t) => {
  await t.test("compile", async () => {
    const original = mixedCallbackCause("compile", "parallel")
    const exit = await Effect.runPromiseExit(McpServer.make({
      serverInfo: { name: "wp5c-mixed-compile", version: "5.0.0" },
      jsonSchemaValidator: {
        compile: () => Effect.failCause(original)
      },
      handlers: McpServer.registerTool({
        name: "mixed-compile",
        outputSchema: { type: "string" },
        content: () => Effect.succeed({ content: [], structuredContent: "ok" })
      })
    }))
    assertMixedSchemaCause(exit, original)
  })

  await t.test("validate", async () => {
    const original = mixedCallbackCause("validate", "sequential")
    const server = await makeServer([{
      name: "mixed-validate",
      outputSchema: { type: "string" },
      content: () => Effect.succeed({ content: [], structuredContent: "ok" })
    }], {
      jsonSchemaValidator: {
        compile: () => Effect.succeed({
          validate: () => Effect.failCause(original)
        })
      }
    })
    assertMixedSchemaCause(await callLocalExit(server, "mixed-validate"), original)

    const wire = await call(server, "mixed-validate")
    assert.equal(wire._tag, "ErrorResponse")
    assert.equal(wire.error.code, -32602)
    const encoded = JSON.stringify(wire)
    assert.equal(encoded.includes("failure-sensitive-secret"), false)
    assert.equal(encoded.includes("defect-sensitive-secret"), false)
  })
})

test("typed validator failures gain the complete mixed Cause without leaking tool wire", async (t) => {
  await t.test("compile", async () => {
    const { cause, error } = typedMixedCallbackCause("typed-compile", "parallel")
    const before = JSON.stringify(error)
    const exit = await Effect.runPromiseExit(McpServer.make({
      serverInfo: { name: "wp5c-typed-mixed-compile", version: "5.0.0" },
      jsonSchemaValidator: { compile: () => Effect.failCause(cause) },
      handlers: McpServer.registerTool({
        name: "typed-mixed-compile",
        outputSchema: { type: "string" },
        content: () => Effect.succeed({ content: [], structuredContent: "ok" })
      })
    }))
    assertTypedMixedSchemaCause(exit, cause, error)
    assert.equal(JSON.stringify(error), before)
  })

  await t.test("validate", async () => {
    const { cause, error } = typedMixedCallbackCause("typed-validate", "sequential")
    const before = JSON.stringify(error)
    const server = await makeServer([{
      name: "typed-mixed-validate",
      outputSchema: { type: "string" },
      content: () => Effect.succeed({ content: [], structuredContent: "ok" })
    }], {
      jsonSchemaValidator: {
        compile: () => Effect.succeed({ validate: () => Effect.failCause(cause) })
      }
    })
    assertTypedMixedSchemaCause(await callLocalExit(server, "typed-mixed-validate"), cause, error)
    assert.equal(JSON.stringify(error), before)

    const wire = await call(server, "typed-mixed-validate")
    assert.equal(wire._tag, "ErrorResponse")
    assert.equal(wire.error.code, -32602)
    assert.equal(wire.error.message, "Tool output failed JSON Schema validation")
    const encoded = JSON.stringify(wire)
    assert.equal(encoded.includes("typed-message-sensitive-secret"), false)
    assert.equal(encoded.includes("typed-data-sensitive-secret"), false)
  })
})

test("typed validator failures replace a distinct existing Cause without leaking tool wire", async (t) => {
  await t.test("compile", async () => {
    const existingCause = Cause.fail(new Error("typed-compile-existing-cause-sensitive-secret"))
    const { cause, error } = typedMixedCallbackCause(
      "typed-compile-existing Cause",
      "parallel",
      existingCause
    )
    const sourceCauseDescriptor = Object.getOwnPropertyDescriptor(error, "cause")
    const exit = await Effect.runPromiseExit(McpServer.make({
      serverInfo: { name: "wp5c-typed-existing-compile", version: "5.0.0" },
      jsonSchemaValidator: { compile: () => Effect.failCause(cause) },
      handlers: McpServer.registerTool({
        name: "typed-existing-compile",
        outputSchema: { type: "string" },
        content: () => Effect.succeed({ content: [], structuredContent: "ok" })
      })
    }))
    assertTypedMixedSchemaCause(exit, cause, error, existingCause)
    assert.deepEqual(Object.getOwnPropertyDescriptor(error, "cause"), sourceCauseDescriptor)
  })

  await t.test("validate", async () => {
    const existingCause = Cause.fail(new Error("typed-validate-existing-cause-sensitive-secret"))
    const { cause, error } = typedMixedCallbackCause(
      "typed-validate-existing Cause",
      "sequential",
      existingCause
    )
    const sourceCauseDescriptor = Object.getOwnPropertyDescriptor(error, "cause")
    const server = await makeServer([{
      name: "typed-existing-validate",
      outputSchema: { type: "string" },
      content: () => Effect.succeed({ content: [], structuredContent: "ok" })
    }], {
      jsonSchemaValidator: {
        compile: () => Effect.succeed({ validate: () => Effect.failCause(cause) })
      }
    })
    assertTypedMixedSchemaCause(
      await callLocalExit(server, "typed-existing-validate"),
      cause,
      error,
      existingCause
    )
    assert.deepEqual(Object.getOwnPropertyDescriptor(error, "cause"), sourceCauseDescriptor)

    const wire = await call(server, "typed-existing-validate")
    assert.equal(wire._tag, "ErrorResponse")
    assert.equal(wire.error.code, -32602)
    assert.equal(wire.error.message, "Tool output failed JSON Schema validation")
    const encoded = JSON.stringify(wire)
    assert.equal(encoded.includes("typed-validate-existing-cause-sensitive-secret"), false)
    assert.equal(encoded.includes("typed-message-sensitive-secret"), false)
    assert.equal(encoded.includes("typed-data-sensitive-secret"), false)
  })
})

test("hostile typed validator failures preserve mixed Causes without leaking or mutation", async (t) => {
  await t.test("compile", async () => {
    const { cause, hostile, source, state } = hostileTypedMixedCallbackCause(
      "hostile-typed-compile",
      "parallel"
    )
    const before = JSON.stringify(source)
    const exit = await Effect.runPromiseExit(McpServer.make({
      serverInfo: { name: "wp5c-hostile-typed-compile", version: "5.0.0" },
      jsonSchemaValidator: { compile: () => Effect.failCause(cause) },
      handlers: McpServer.registerTool({
        name: "hostile-typed-compile",
        outputSchema: { type: "string" },
        content: () => Effect.succeed({ content: [], structuredContent: "ok" })
      })
    }))
    assert.equal(Exit.isFailure(exit), true)
    assert.equal(Cause.isInterrupted(exit.cause), true)
    assert.equal(Cause.isInterruptedOnly(exit.cause), false)
    const failures = Array.from(Cause.failures(exit.cause))
    assert.equal(failures.length, 1)
    assert.equal(failures[0] instanceof SchemaValidationError, true)
    assert.notEqual(failures[0], hostile)
    assert.equal(failures[0].cause, cause)
    assert.equal(failures[0].message.includes("sensitive-secret"), false)
    assert.equal((JSON.stringify(failures[0].data) ?? "").includes("sensitive-secret"), false)
    assert.equal(JSON.stringify(source), before)
    assert.equal(source.cause, undefined)
    assert.equal(state.getPrototypeOf > 0, true)
  })

  await t.test("validate", async () => {
    const { cause, hostile, source, state } = hostileTypedMixedCallbackCause(
      "hostile-typed-validate",
      "sequential"
    )
    const before = JSON.stringify(source)
    const server = await makeServer([{
      name: "hostile-typed-validate",
      outputSchema: { type: "string" },
      content: () => Effect.succeed({ content: [], structuredContent: "ok" })
    }], {
      jsonSchemaValidator: {
        compile: () => Effect.succeed({ validate: () => Effect.failCause(cause) })
      }
    })
    const exit = await callLocalExit(server, "hostile-typed-validate")
    assert.equal(Exit.isFailure(exit), true)
    assert.equal(Cause.isInterrupted(exit.cause), true)
    assert.equal(Cause.isInterruptedOnly(exit.cause), false)
    const failures = Array.from(Cause.failures(exit.cause))
    assert.equal(failures.length, 1)
    assert.equal(failures[0] instanceof SchemaValidationError, true)
    assert.notEqual(failures[0], hostile)
    assert.equal(originalCauseIn(failures[0], cause), true)
    assert.equal(JSON.stringify(source), before)
    assert.equal(source.cause, undefined)
    assert.equal(state.getPrototypeOf > 0, true)

    const wire = await call(server, "hostile-typed-validate")
    assert.equal(wire._tag, "ErrorResponse")
    assert.equal(wire.error.code, -32602)
    const encoded = JSON.stringify(wire)
    assert.equal(encoded.includes("hostile-message-sensitive-secret"), false)
    assert.equal(encoded.includes("hostile-data-sensitive-secret"), false)
    assert.equal(encoded.includes("prototype-trap-sensitive-secret"), false)
  })
})

test("deep validator callback Causes remain stack-safe, composed, and DAG-preserving", async (t) => {
  await t.test("compile", async () => {
    const { cause, source } = deepMixedCallbackCause("deep-compile")
    const sourceMessage = source.message
    const started = performance.now()
    const exit = await Effect.runPromiseExit(McpServer.make({
      serverInfo: { name: "wp5c-deep-compile", version: "5.0.0" },
      jsonSchemaValidator: { compile: () => Effect.failCause(cause) },
      handlers: McpServer.registerTool({
        name: "deep-compile",
        outputSchema: { type: "string" },
        content: () => Effect.succeed({ content: [], structuredContent: "ok" })
      })
    }))
    assert.equal(performance.now() - started < 10_000, true)
    assert.equal(Exit.isFailure(exit), true)
    assert.equal(Cause.isInterrupted(exit.cause), true)
    assert.equal(Cause.isInterruptedOnly(exit.cause), false)
    assert.equal(Array.from(Cause.defects(exit.cause)).length, 0)
    const failures = Array.from(Cause.failures(exit.cause))
    assert.equal(failures.length, 1)
    assert.equal(failures[0] instanceof SchemaValidationError, true)
    assert.equal(failures[0].cause, cause)
    assert.equal(failures[0].message.includes("sensitive-secret"), false)
    assert.equal((JSON.stringify(failures[0].data) ?? "").includes("sensitive-secret"), false)
    assert.deepEqual(causeShape(exit.cause), causeShape(cause))
    assertSharedDeepInterruption(exit.cause)
    assert.equal(source.message, sourceMessage)
  })

  await t.test("validate", async () => {
    const { cause, source } = deepMixedCallbackCause("deep-validate")
    const sourceMessage = source.message
    const server = await makeServer([{
      name: "deep-validate",
      outputSchema: { type: "string" },
      content: () => Effect.succeed({ content: [], structuredContent: "ok" })
    }], {
      jsonSchemaValidator: {
        compile: () => Effect.succeed({ validate: () => Effect.failCause(cause) })
      }
    })
    const started = performance.now()
    const exit = await callLocalExit(server, "deep-validate")
    assert.equal(performance.now() - started < 10_000, true)
    assert.equal(Exit.isFailure(exit), true)
    assert.equal(Cause.isInterrupted(exit.cause), true)
    assert.equal(Cause.isInterruptedOnly(exit.cause), false)
    assert.equal(Array.from(Cause.defects(exit.cause)).length, 0)
    const failures = Array.from(Cause.failures(exit.cause))
    assert.equal(failures.length, 1)
    assert.equal(failures[0] instanceof SchemaValidationError, true)
    assert.equal(originalCauseIn(failures[0], cause), true)
    assert.deepEqual(causeShape(exit.cause), causeShape(cause))
    assertSharedDeepInterruption(exit.cause)
    assert.equal(source.message, sourceMessage)

    const wire = await call(server, "deep-validate")
    assert.equal(wire._tag, "ErrorResponse")
    assert.equal(wire.error.code, -32602)
    const encoded = JSON.stringify(wire)
    assert.equal(encoded.includes("deep-failure-sensitive-secret"), false)
  })
})

test("compiled validate is an owned data method snapshotted at registration", async (t) => {
  const getterState = { count: 0 }
  const getterCompiled = {}
  Object.defineProperty(getterCompiled, "validate", {
    enumerable: true,
    get() { getterState.count += 1; return () => Effect.void }
  })
  for (const [label, compiled, state] of [
    ["getter", getterCompiled, getterState],
    ["non-function", { validate: true }, { count: 0 }]
  ]) {
    await t.test(label, async () => {
      let continued = false
      const exit = await Effect.runPromiseExit(McpServer.make({
        serverInfo: { name: `wp5c-compiled-${label}`, version: "5.0.0" },
        jsonSchemaValidator: { compile: () => Effect.succeed(compiled) },
        handlers: McpServer.registerTool({
          name: label,
          outputSchema: { type: "string" },
          content: () => Effect.succeed({ content: [], structuredContent: "ok" })
        }).pipe(Effect.zipRight(Effect.sync(() => { continued = true })))
      }))
      assert.equal(Exit.isFailure(exit), true)
      assert.equal(continued, false)
      assert.equal(state.count, 0)
    })
  }

  await t.test("later mutation", async () => {
    const compiled = { validate: () => Effect.void }
    const server = await makeServer([{
      name: "owned-validate",
      outputSchema: { type: "string" },
      content: () => Effect.succeed({ content: [], structuredContent: "ok" })
    }], { jsonSchemaValidator: { compile: () => Effect.succeed(compiled) } })
    compiled.validate = () => { throw new Error("mutated compiled validator") }
    assert.equal((await call(server, "owned-validate"))._tag, "SuccessResponse")
  })
})

test("generated tool input schemas explicitly use JSON Schema 2020-12 tuple keywords", async () => {
  const server = await makeServer([{
    name: "tuple-input",
    parameters: { pair: Schema.Tuple(Schema.String, Schema.Number) },
    content: () => Effect.succeed({ content: [] })
  }])
  const inputSchema = server.tools[0].tool.inputSchema
  assert.equal(inputSchema.$schema, "https://json-schema.org/draft/2020-12/schema")
  const pair = inputSchema.properties.pair
  assert.equal(Array.isArray(pair.prefixItems), true)
  assert.deepEqual(pair.prefixItems.map(({ type }) => type), ["string", "number"])
  assert.equal(pair.items, false)
  assert.equal(Array.isArray(pair.items), false)
})

test("tool argument decoding rejects properties forbidden by advertised input schema", async () => {
  const server = await makeServer([{
    name: "exact-input",
    parameters: { known: Schema.String },
    content: ({ known }) => Effect.succeed({ content: [], structuredContent: { known } })
  }])
  const response = await dispatch(server, request("excess-input", "tools/call", {
    name: "exact-input",
    arguments: { known: "accepted", excess: "must-not-be-stripped" }
  }))
  assert.equal(response._tag, "ErrorResponse")
  assert.equal(response.error.code, -32602)
})

test("unsupported Effect parameter schemas fail registration as local typed errors", async () => {
  let continued = false
  const unsupported = Schema.declare((value) => typeof value === "string")
  const exit = await Effect.runPromiseExit(McpServer.make({
    serverInfo: { name: "wp5c-unsupported-input", version: "5.0.0" },
    handlers: McpServer.registerTool({
      name: "unsupported-input",
      parameters: { unsupported },
      content: () => Effect.succeed({ content: [] })
    }).pipe(Effect.zipRight(Effect.sync(() => { continued = true })))
  }))
  assert.equal(Exit.isFailure(exit), true)
  const failure = Cause.failureOption(exit.cause)
  assert.equal(failure._tag, "Some")
  assert.equal(failure.value instanceof SchemaValidationError, true)
  assert.notEqual(failure.value.cause, undefined)
  assert.equal(continued, false)
})

test("tools without output schemas and ordinary handler failures retain in-band behavior", async () => {
  const server = await makeServer([
    { name: "untyped", content: () => Effect.succeed({ content: [], structuredContent: { open: [1, null] } }) },
    { name: "business-error", content: () => Effect.fail(new Error("expected business failure")) }
  ])
  const open = await call(server, "untyped")
  assert.equal(open._tag, "SuccessResponse")
  assert.deepEqual(open.result.structuredContent, { open: [1, null] })

  const business = await call(server, "business-error")
  assert.equal(business._tag, "SuccessResponse")
  assert.equal(business.result.isError, true)
  assert.equal(business.result.content[0].text, "expected business failure")
})

test("compiled schemas and resolvers are isolated across concurrent servers", async () => {
  assert.equal(typeof ServerApi.JsonSchemaResolver, "function")
  const encoder = new TextEncoder()
  const resolver = (type) => Effect.runPromise(ServerApi.JsonSchemaResolver.make({
    allowedSchemes: ["https"], allowedHosts: ["schemas.example"],
    maxDepth: 1, maxBytes: 1024, maxRedirects: 1, timeoutMs: 100,
    load: (uri) => Effect.succeed({
      bytes: encoder.encode(JSON.stringify({ $id: uri, type })),
      finalUri: uri,
      redirects: []
    })
  }))
  const registration = (structuredContent) => ({
    name: "isolated",
    outputSchema: { $ref: "https://schemas.example/output" },
    content: () => Effect.succeed({ content: [], structuredContent })
  })
  const [stringServer, numberServer] = await Promise.all([
    resolver("string").then((jsonSchemaResolver) => makeServer([registration("ok")], { jsonSchemaResolver })),
    resolver("number").then((jsonSchemaResolver) => makeServer([registration(1)], { jsonSchemaResolver }))
  ])
  const [stringResult, numberResult] = await Promise.all([
    call(stringServer, "isolated", "string-server"),
    call(numberServer, "isolated", "number-server")
  ])
  assert.equal(stringResult._tag, "SuccessResponse")
  assert.equal(numberResult._tag, "SuccessResponse")
})
