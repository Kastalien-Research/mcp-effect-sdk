import assert from "node:assert/strict"
import { test } from "node:test"
import * as Effect from "effect/Effect"
import * as Context from "effect/Context"
import * as SchemaGetter from "effect/SchemaGetter"
import * as Cause from "effect/Cause"
import * as Exit from "effect/Exit"
import * as Queue from "effect/Queue"
import * as Schema from "effect/Schema"
import * as ServerApi from "../../dist/server.js"
import * as McpServer from "../../dist/McpServer.js"
import * as McpSchema from "../../dist/McpSchema.js"
import { SchemaValidationError } from "../../dist/McpErrors.js"
import { jsonSchema202012Parameters } from "../../dist/examples/everything-server-fixtures.js"

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

const dispatch = (server, message) =>
  Effect.runPromise(
    Effect.scoped(
      Effect.gen(function* () {
        const sent = yield* Queue.unbounded()
        const dispatcher = yield* McpServer.makeDispatcher({
          send: (response) => Queue.offer(sent, response).pipe(Effect.asVoid),
          transport: "stdio"
        }).pipe(Effect.provideService(McpServer.McpServer, server))
        yield* dispatcher.accept(message)
        return yield* Queue.take(sent)
      })
    )
  )

const makeServer = (registrations, options = {}) =>
  Effect.runPromise(
    McpServer.make({
      serverInfo: { name: "wp5c-output-server", version: "5.0.0" },
      handlers: Effect.gen(function* () {
        for (const registration of registrations) yield* McpServer.registerTool(registration)
      }),
      ...options
    })
  )

const call = (server, name, id = name) =>
  dispatch(
    server,
    request(id, "tools/call", {
      name,
      arguments: {}
    })
  )

const localClient = McpSchema.McpServerClient.of({
  clientId: "wp5c-local",
  requestContext: { protocolVersion: "2026-07-28", capabilities: { tools: {} } }
})

const callLocalExit = (server, name) =>
  Effect.runPromiseExit(
    server
      .callTool({
        name,
        arguments: {}
      })
      .pipe(Effect.provideService(McpSchema.McpServerClient, localClient))
  )

const causeFailures = (cause) => cause.reasons.filter(Cause.isFailReason).map((reason) => reason.error)
const causeDefects = (cause) => cause.reasons.filter(Cause.isDieReason).map((reason) => reason.defect)

const mixedCallbackCause = (label, order) => {
  const failure = Cause.fail(new Error(`${label}-failure-sensitive-secret`))
  const defect = Cause.die(new Error(`${label}-defect-sensitive-secret`))
  const interruption = Cause.interrupt(72)
  return order === "failure-first"
    ? Cause.combine(Cause.combine(failure, defect), interruption)
    : Cause.combine(interruption, Cause.combine(defect, failure))
}

const originalCauseIn = (error, original) => error?.cause === original || error?.cause?.cause === original

const assertMixedSchemaCause = (exit, original) => {
  assert.equal(Exit.isFailure(exit), true)
  assert.equal(Cause.hasInterrupts(exit.cause), true)
  assert.equal(Cause.hasInterruptsOnly(exit.cause), false)
  const failures = Array.from(causeFailures(exit.cause))
  assert.equal(failures.length, 2)
  assert.equal(
    failures.every((failure) => failure instanceof SchemaValidationError),
    true
  )
  assert.equal(
    failures.every((failure) => originalCauseIn(failure, original)),
    true
  )
  assert.equal(Array.from(causeDefects(exit.cause)).length, 0)
}

const typedMixedCallbackCause = (label, order, existingCause) => {
  const error = new SchemaValidationError({
    message: `${label}-typed-message-sensitive-secret`,
    data: { semantic: `${label}-typed-data-sensitive-secret` },
    ...(existingCause === undefined ? {} : { cause: existingCause })
  })
  const interruption = Cause.interrupt(74)
  return {
    error,
    cause:
      order === "failure-first"
        ? Cause.combine(Cause.fail(error), interruption)
        : Cause.combine(interruption, Cause.fail(error))
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
  const interruption = Cause.interrupt(76)
  return {
    cause:
      order === "failure-first"
        ? Cause.fromReasons([Cause.makeFailReason(hostile), ...interruption.reasons])
        : Cause.fromReasons([...interruption.reasons, Cause.makeFailReason(hostile)]),
    hostile,
    source,
    state
  }
}

const LARGE_CAUSE_INTERRUPTS = 12_001

const largeMixedCallbackCause = (label) => {
  const source = new Error(`${label}-large-failure-sensitive-secret`)
  const interruption = Cause.makeInterruptReason(77)
  const cause = Cause.fromReasons([
    Cause.makeFailReason(source),
    ...Array.from({ length: LARGE_CAUSE_INTERRUPTS }, () => interruption)
  ])
  return { cause, interruption, source }
}

const reasonKinds = (cause) => cause.reasons.map((reason) => reason._tag)

const assertSharedInterruptionReasons = (cause, original) => {
  const expected = original.reasons.filter(Cause.isInterruptReason)
  const actual = cause.reasons.filter(Cause.isInterruptReason)
  assert.equal(actual.length, LARGE_CAUSE_INTERRUPTS)
  for (let index = 0; index < actual.length; index++) {
    assert.equal(actual[index], expected[index])
    assert.equal(actual[index], expected[0])
  }
}

const semanticFailureIn = (failure, source) =>
  failure?.message === source.message
    ? failure
    : failure?.cause instanceof SchemaValidationError && failure.cause.message === source.message
      ? failure.cause
      : undefined

const assertTypedMixedSchemaCause = (exit, original, source, sourceCause = undefined) => {
  assert.equal(Exit.isFailure(exit), true)
  assert.equal(Cause.hasInterrupts(exit.cause), true)
  assert.equal(Cause.hasInterruptsOnly(exit.cause), false)
  const failures = Array.from(causeFailures(exit.cause))
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
  const outcome = await Effect.runPromiseExit(
    McpServer.make({
      serverInfo: { name: "wp5c-invalid-schema", version: "5.0.0" },
      handlers: Effect.gen(function* () {
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
    })
  )
  assert.equal(Exit.isFailure(outcome), true)
  const failure = Cause.findErrorOption(outcome.cause)
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
  const server = await makeServer([
    {
      name: "snapshotted",
      outputSchema,
      content: () => Effect.succeed({ content: [], structuredContent: { value: "original" } })
    }
  ])
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
  const server = await makeServer(
    cases.map(([name, outputSchema, structuredContent]) => ({
      name,
      outputSchema,
      content: () => Effect.succeed({ content: [], structuredContent })
    }))
  )
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
    get() {
      getterReads += 1
      return "must-not-run"
    }
  })
  const accessorResult = { content: [] }
  Object.defineProperty(accessorResult, "structuredContent", {
    enumerable: true,
    get() {
      getterReads += 1
      return { value: "must-not-run" }
    }
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
    {
      name: "invalid",
      outputSchema: schema,
      content: () => Effect.succeed({ content: [], structuredContent: { value: 1 } })
    },
    { name: "missing", outputSchema: schema, content: () => Effect.succeed({ content: [] }) },
    {
      name: "hostile",
      outputSchema: schema,
      content: () => Effect.succeed({ content: [], structuredContent: hostile })
    },
    { name: "accessor", outputSchema: schema, content: () => Effect.succeed(accessorResult) },
    { name: "inherited", outputSchema: schema, content: () => Effect.succeed(inheritedResult) },
    {
      name: "error-invalid",
      outputSchema: schema,
      content: () => Effect.succeed({ isError: true, content: [], structuredContent: { value: 1 } })
    }
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
      allowedSchemes: ["https"],
      allowedHosts: ["schemas.example"],
      maxDepth: 1,
      maxBytes: 1024,
      maxRedirects: 0,
      timeoutMs: 100
    },
    resolve: (uri) =>
      Effect.succeed({
        bytes: encoder.encode(JSON.stringify({ $id: uri, type: "string" })),
        finalUri: uri,
        redirects: []
      })
  }
  const server = await Effect.runPromise(
    McpServer.make({
      serverInfo: { name: "wp5c-snapshot-services", version: "5.0.0" },
      jsonSchemaValidator: validator,
      jsonSchemaResolver: resolver,
      handlers: Effect.sync(() => {
        validator.compile = () => Effect.die(new Error("mutated validator"))
        resolver.resolve = () => Effect.die(new Error("mutated resolver"))
      }).pipe(
        Effect.andThen(
          McpServer.registerTool({
            name: "snapshotted-services",
            outputSchema: { $ref: "https://schemas.example/output" },
            content: () => Effect.succeed({ content: [], structuredContent: "ok" })
          })
        )
      )
    })
  )
  assert.equal((await call(server, "snapshotted-services"))._tag, "SuccessResponse")
})

test("schema diagnostics and arbitrary custom validator data stay local-only", async (t) => {
  const uri = "https://schemas.example/output?token=wire-sensitive-secret"
  const encoder = new TextEncoder()
  const resolver = await Effect.runPromise(
    ServerApi.JsonSchemaResolver.make({
      allowedSchemes: ["https"],
      allowedHosts: ["schemas.example"],
      maxDepth: 1,
      maxBytes: 1024,
      maxRedirects: 0,
      timeoutMs: 100,
      load: () =>
        Effect.succeed({
          bytes: encoder.encode(JSON.stringify({ $id: uri, const: "expected" })),
          finalUri: uri,
          redirects: []
        })
    })
  )
  await t.test("external Ajv schemaPath", async () => {
    const external = await makeServer(
      [
        {
          name: "external-diagnostic",
          outputSchema: { $ref: uri },
          content: () => Effect.succeed({ content: [], structuredContent: "actual" })
        }
      ],
      { jsonSchemaResolver: resolver }
    )
    const externalWire = JSON.stringify(await call(external, "external-diagnostic"))
    assert.equal(externalWire.includes("wire-sensitive-secret"), false)
    assert.equal(externalWire.includes("schemas.example"), false)
  })

  await t.test("custom validator arbitrary data", async () => {
    const arbitrarySecret = "custom-validator-sensitive-secret"
    const custom = await makeServer(
      [
        {
          name: "custom-diagnostic",
          outputSchema: { type: "string" },
          content: () => Effect.succeed({ content: [], structuredContent: "value" })
        }
      ],
      {
        jsonSchemaValidator: {
          compile: () =>
            Effect.succeed({
              validate: () =>
                Effect.fail(
                  new SchemaValidationError({
                    message: "custom validator rejected output",
                    data: { arbitrarySecret }
                  })
                )
            })
        }
      }
    )
    const customWire = JSON.stringify(await call(custom, "custom-diagnostic"))
    assert.equal(customWire.includes(arbitrarySecret), false)
  })
})

test("validator callback throws and non-Effect returns are typed, Cause-preserving failures", async (t) => {
  for (const [label, compile] of [
    [
      "compile throw",
      () => {
        throw new Error("compile-local-cause")
      }
    ],
    ["compile non-Effect", () => ({ validate: () => Effect.void })]
  ]) {
    await t.test(label, async () => {
      let continued = false
      const exit = await Effect.runPromiseExit(
        McpServer.make({
          serverInfo: { name: `wp5c-${label}`, version: "5.0.0" },
          jsonSchemaValidator: { compile },
          handlers: McpServer.registerTool({
            name: label,
            outputSchema: { type: "string" },
            content: () => Effect.succeed({ content: [], structuredContent: "ok" })
          }).pipe(
            Effect.andThen(
              Effect.sync(() => {
                continued = true
              })
            )
          )
        })
      )
      assert.equal(Exit.isFailure(exit), true)
      const failure = Cause.findErrorOption(exit.cause)
      assert.equal(failure._tag, "Some")
      assert.equal(failure.value instanceof SchemaValidationError, true)
      assert.notEqual(failure.value.cause, undefined)
      assert.equal(continued, false)
    })
  }

  for (const [label, validate] of [
    [
      "validate throw",
      () => {
        throw new Error("validate-local-cause")
      }
    ],
    ["validate non-Effect", () => undefined]
  ]) {
    await t.test(label, async () => {
      const server = await makeServer(
        [
          {
            name: label,
            outputSchema: { type: "string" },
            content: () => Effect.succeed({ content: [], structuredContent: "ok" })
          }
        ],
        {
          jsonSchemaValidator: { compile: () => Effect.succeed({ validate }) }
        }
      )
      const exit = await callLocalExit(server, label)
      assert.equal(Exit.isFailure(exit), true)
      const failure = Cause.findErrorOption(exit.cause)
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
    const original = mixedCallbackCause("compile", "failure-first")
    const exit = await Effect.runPromiseExit(
      McpServer.make({
        serverInfo: { name: "wp5c-mixed-compile", version: "5.0.0" },
        jsonSchemaValidator: {
          compile: () => Effect.failCause(original)
        },
        handlers: McpServer.registerTool({
          name: "mixed-compile",
          outputSchema: { type: "string" },
          content: () => Effect.succeed({ content: [], structuredContent: "ok" })
        })
      })
    )
    assertMixedSchemaCause(exit, original)
  })

  await t.test("validate", async () => {
    const original = mixedCallbackCause("validate", "interrupt-first")
    const server = await makeServer(
      [
        {
          name: "mixed-validate",
          outputSchema: { type: "string" },
          content: () => Effect.succeed({ content: [], structuredContent: "ok" })
        }
      ],
      {
        jsonSchemaValidator: {
          compile: () =>
            Effect.succeed({
              validate: () => Effect.failCause(original)
            })
        }
      }
    )
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
    const { cause, error } = typedMixedCallbackCause("typed-compile", "failure-first")
    const before = JSON.stringify(error)
    const exit = await Effect.runPromiseExit(
      McpServer.make({
        serverInfo: { name: "wp5c-typed-mixed-compile", version: "5.0.0" },
        jsonSchemaValidator: { compile: () => Effect.failCause(cause) },
        handlers: McpServer.registerTool({
          name: "typed-mixed-compile",
          outputSchema: { type: "string" },
          content: () => Effect.succeed({ content: [], structuredContent: "ok" })
        })
      })
    )
    assertTypedMixedSchemaCause(exit, cause, error)
    assert.equal(JSON.stringify(error), before)
  })

  await t.test("validate", async () => {
    const { cause, error } = typedMixedCallbackCause("typed-validate", "interrupt-first")
    const before = JSON.stringify(error)
    const server = await makeServer(
      [
        {
          name: "typed-mixed-validate",
          outputSchema: { type: "string" },
          content: () => Effect.succeed({ content: [], structuredContent: "ok" })
        }
      ],
      {
        jsonSchemaValidator: {
          compile: () => Effect.succeed({ validate: () => Effect.failCause(cause) })
        }
      }
    )
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
    const { cause, error } = typedMixedCallbackCause("typed-compile-existing Cause", "failure-first", existingCause)
    const sourceCauseDescriptor = Object.getOwnPropertyDescriptor(error, "cause")
    const exit = await Effect.runPromiseExit(
      McpServer.make({
        serverInfo: { name: "wp5c-typed-existing-compile", version: "5.0.0" },
        jsonSchemaValidator: { compile: () => Effect.failCause(cause) },
        handlers: McpServer.registerTool({
          name: "typed-existing-compile",
          outputSchema: { type: "string" },
          content: () => Effect.succeed({ content: [], structuredContent: "ok" })
        })
      })
    )
    assertTypedMixedSchemaCause(exit, cause, error, existingCause)
    assert.deepEqual(Object.getOwnPropertyDescriptor(error, "cause"), sourceCauseDescriptor)
  })

  await t.test("validate", async () => {
    const existingCause = Cause.fail(new Error("typed-validate-existing-cause-sensitive-secret"))
    const { cause, error } = typedMixedCallbackCause("typed-validate-existing Cause", "interrupt-first", existingCause)
    const sourceCauseDescriptor = Object.getOwnPropertyDescriptor(error, "cause")
    const server = await makeServer(
      [
        {
          name: "typed-existing-validate",
          outputSchema: { type: "string" },
          content: () => Effect.succeed({ content: [], structuredContent: "ok" })
        }
      ],
      {
        jsonSchemaValidator: {
          compile: () => Effect.succeed({ validate: () => Effect.failCause(cause) })
        }
      }
    )
    assertTypedMixedSchemaCause(await callLocalExit(server, "typed-existing-validate"), cause, error, existingCause)
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
    const { cause, hostile, source, state } = hostileTypedMixedCallbackCause("hostile-typed-compile", "failure-first")
    const before = JSON.stringify(source)
    const exit = await Effect.runPromiseExit(
      McpServer.make({
        serverInfo: { name: "wp5c-hostile-typed-compile", version: "5.0.0" },
        jsonSchemaValidator: { compile: () => Effect.failCause(cause) },
        handlers: McpServer.registerTool({
          name: "hostile-typed-compile",
          outputSchema: { type: "string" },
          content: () => Effect.succeed({ content: [], structuredContent: "ok" })
        })
      })
    )
    assert.equal(Exit.isFailure(exit), true)
    assert.equal(Cause.hasInterrupts(exit.cause), true)
    assert.equal(Cause.hasInterruptsOnly(exit.cause), false)
    const failures = Array.from(causeFailures(exit.cause))
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
      "interrupt-first"
    )
    const before = JSON.stringify(source)
    const server = await makeServer(
      [
        {
          name: "hostile-typed-validate",
          outputSchema: { type: "string" },
          content: () => Effect.succeed({ content: [], structuredContent: "ok" })
        }
      ],
      {
        jsonSchemaValidator: {
          compile: () => Effect.succeed({ validate: () => Effect.failCause(cause) })
        }
      }
    )
    const exit = await callLocalExit(server, "hostile-typed-validate")
    assert.equal(Exit.isFailure(exit), true)
    assert.equal(Cause.hasInterrupts(exit.cause), true)
    assert.equal(Cause.hasInterruptsOnly(exit.cause), false)
    const failures = Array.from(causeFailures(exit.cause))
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

test("large validator callback Causes preserve every reason and shared interruption identity", async (t) => {
  await t.test("compile", async () => {
    const { cause, source } = largeMixedCallbackCause("deep-compile")
    const sourceMessage = source.message
    const started = performance.now()
    const exit = await Effect.runPromiseExit(
      McpServer.make({
        serverInfo: { name: "wp5c-deep-compile", version: "5.0.0" },
        jsonSchemaValidator: { compile: () => Effect.failCause(cause) },
        handlers: McpServer.registerTool({
          name: "deep-compile",
          outputSchema: { type: "string" },
          content: () => Effect.succeed({ content: [], structuredContent: "ok" })
        })
      })
    )
    assert.equal(performance.now() - started < 10_000, true)
    assert.equal(Exit.isFailure(exit), true)
    assert.equal(Cause.hasInterrupts(exit.cause), true)
    assert.equal(Cause.hasInterruptsOnly(exit.cause), false)
    assert.equal(Array.from(causeDefects(exit.cause)).length, 0)
    const failures = Array.from(causeFailures(exit.cause))
    assert.equal(failures.length, 1)
    assert.equal(failures[0] instanceof SchemaValidationError, true)
    assert.equal(failures[0].cause, cause)
    assert.equal(failures[0].message.includes("sensitive-secret"), false)
    assert.equal((JSON.stringify(failures[0].data) ?? "").includes("sensitive-secret"), false)
    assert.deepEqual(reasonKinds(exit.cause), reasonKinds(cause))
    assertSharedInterruptionReasons(exit.cause, cause)
    assert.equal(source.message, sourceMessage)
  })

  await t.test("validate", async () => {
    const { cause, source } = largeMixedCallbackCause("deep-validate")
    const sourceMessage = source.message
    const server = await makeServer(
      [
        {
          name: "deep-validate",
          outputSchema: { type: "string" },
          content: () => Effect.succeed({ content: [], structuredContent: "ok" })
        }
      ],
      {
        jsonSchemaValidator: {
          compile: () => Effect.succeed({ validate: () => Effect.failCause(cause) })
        }
      }
    )
    const started = performance.now()
    const exit = await callLocalExit(server, "deep-validate")
    assert.equal(performance.now() - started < 10_000, true)
    assert.equal(Exit.isFailure(exit), true)
    assert.equal(Cause.hasInterrupts(exit.cause), true)
    assert.equal(Cause.hasInterruptsOnly(exit.cause), false)
    assert.equal(Array.from(causeDefects(exit.cause)).length, 0)
    const failures = Array.from(causeFailures(exit.cause))
    assert.equal(failures.length, 1)
    assert.equal(failures[0] instanceof SchemaValidationError, true)
    assert.equal(originalCauseIn(failures[0], cause), true)
    assert.deepEqual(reasonKinds(exit.cause), reasonKinds(cause))
    assertSharedInterruptionReasons(exit.cause, cause)
    assert.equal(source.message, sourceMessage)

    const wire = await call(server, "deep-validate")
    assert.equal(wire._tag, "ErrorResponse")
    assert.equal(wire.error.code, -32602)
    const encoded = JSON.stringify(wire)
    assert.equal(encoded.includes("large-failure-sensitive-secret"), false)
  })
})

test("compiled validate is an owned data method snapshotted at registration", async (t) => {
  const getterState = { count: 0 }
  const getterCompiled = {}
  Object.defineProperty(getterCompiled, "validate", {
    enumerable: true,
    get() {
      getterState.count += 1
      return () => Effect.void
    }
  })
  for (const [label, compiled, state] of [
    ["getter", getterCompiled, getterState],
    ["non-function", { validate: true }, { count: 0 }]
  ]) {
    await t.test(label, async () => {
      let continued = false
      const exit = await Effect.runPromiseExit(
        McpServer.make({
          serverInfo: { name: `wp5c-compiled-${label}`, version: "5.0.0" },
          jsonSchemaValidator: { compile: () => Effect.succeed(compiled) },
          handlers: McpServer.registerTool({
            name: label,
            outputSchema: { type: "string" },
            content: () => Effect.succeed({ content: [], structuredContent: "ok" })
          }).pipe(
            Effect.andThen(
              Effect.sync(() => {
                continued = true
              })
            )
          )
        })
      )
      assert.equal(Exit.isFailure(exit), true)
      assert.equal(continued, false)
      assert.equal(state.count, 0)
    })
  }

  await t.test("later mutation", async () => {
    const compiled = { validate: () => Effect.void }
    const server = await makeServer(
      [
        {
          name: "owned-validate",
          outputSchema: { type: "string" },
          content: () => Effect.succeed({ content: [], structuredContent: "ok" })
        }
      ],
      { jsonSchemaValidator: { compile: () => Effect.succeed(compiled) } }
    )
    compiled.validate = () => {
      throw new Error("mutated compiled validator")
    }
    assert.equal((await call(server, "owned-validate"))._tag, "SuccessResponse")
  })
})

test("generated tool input schemas explicitly use JSON Schema 2020-12 tuple keywords", async () => {
  const server = await makeServer([
    {
      name: "tuple-input",
      parameters: { pair: Schema.Tuple([Schema.String, Schema.Finite]) },
      content: () => Effect.succeed({ content: [] })
    }
  ])
  const inputSchema = server.tools[0].tool.inputSchema
  assert.equal(inputSchema.$schema, "https://json-schema.org/draft/2020-12/schema")
  const pair = inputSchema.properties.pair
  assert.equal(Array.isArray(pair.prefixItems), true)
  assert.deepEqual(
    pair.prefixItems.map(({ type }) => type),
    ["string", "number"]
  )
  assert.equal(Array.isArray(pair.items), false)
  const compiled = await Effect.runPromise(ServerApi.JsonSchemaValidator.default.compile({ schema: inputSchema }))
  for (const [argumentsValue, accepted] of [
    [{ pair: ["ok", 1] }, true],
    [{ pair: ["missing"] }, false],
    [{ pair: ["extra", 1, true] }, false]
  ]) {
    assert.equal(Exit.isSuccess(await Effect.runPromiseExit(compiled.validate(argumentsValue))), accepted)
  }
})

test("the Everything fixture preserves root applicators and anchored definitions with matching validation", async () => {
  const server = await makeServer([
    {
      name: "json_schema_2020_12_tool",
      parameterSchema: jsonSchema202012Parameters,
      content: () => Effect.succeed("accepted")
    }
  ])
  const listed = await dispatch(server, request("fixture-list", "tools/list"))
  assert.equal(listed._tag, "SuccessResponse")
  const inputSchema = listed.result.tools[0].inputSchema
  assert.equal(inputSchema.$defs.address.$anchor, "addressDef")
  assert.equal(inputSchema.properties.address.$ref, "#/$defs/address")
  assert.deepEqual(inputSchema.allOf, [{ anyOf: [{ required: ["phone"] }, { required: ["email"] }] }])
  assert.deepEqual(inputSchema.if, { properties: { contactMethod: { const: "phone" } }, required: ["contactMethod"] })
  assert.deepEqual(inputSchema.then, { required: ["phone"] })
  assert.deepEqual(inputSchema.else, { required: ["email"] })
  const compiled = await Effect.runPromise(ServerApi.JsonSchemaValidator.default.compile({ schema: inputSchema }))
  for (const [index, value] of [
    { email: "test@example.com" },
    { contactMethod: "phone", phone: "+1-555-0100", address: { street: "Main", city: "Test" } }
  ].entries()) {
    await Effect.runPromise(compiled.validate(value))
    const called = await dispatch(
      server,
      request(`fixture-valid-${index}`, "tools/call", {
        name: "json_schema_2020_12_tool",
        arguments: value
      })
    )
    assert.equal(called._tag, "SuccessResponse")
    assert.equal(called.result.content[0].text, "accepted")
  }
  for (const [index, value] of [
    {},
    { contactMethod: "phone", email: "test@example.com" },
    { contactMethod: "email", phone: "+1-555-0100" },
    { email: "test@example.com", address: { city: "Test" } },
    { email: "test@example.com", unknown: true },
    { email: null }
  ].entries()) {
    assert.equal((await Effect.runPromiseExit(compiled.validate(value)))._tag, "Failure")
    const called = await dispatch(
      server,
      request(`fixture-invalid-${index}`, "tools/call", {
        name: "json_schema_2020_12_tool",
        arguments: value
      })
    )
    assert.equal(called._tag, "ErrorResponse")
    assert.equal(called.error.code, -32602)
  }
})

test("complete tool input schemas preserve native named object and class references", async () => {
  class ClassInput extends Schema.Class("ToolClassInput")({ value: Schema.String }) {}
  const server = await makeServer([
    {
      name: "named-input",
      parameterSchema: Schema.Struct({ value: Schema.String }).annotate({ identifier: "ToolNamedInput" }),
      content: ({ value }) => Effect.succeed(value)
    },
    {
      name: "class-input",
      parameterSchema: ClassInput,
      content: (input) => {
        assert.equal(input instanceof ClassInput, true)
        return Effect.succeed(input.value)
      }
    }
  ])
  const listed = await dispatch(server, request("named-list", "tools/list"))
  assert.equal(listed._tag, "SuccessResponse")
  for (const tool of listed.result.tools) {
    assert.equal(tool.inputSchema.type, "object")
    assert.equal(typeof tool.inputSchema.$ref, "string")
    assert.equal(typeof tool.inputSchema.$defs, "object")
    const compiled = await Effect.runPromise(
      ServerApi.JsonSchemaValidator.default.compile({ schema: tool.inputSchema })
    )
    await Effect.runPromise(compiled.validate({ value: "ok" }))
    assert.equal((await Effect.runPromiseExit(compiled.validate({ value: 1 })))._tag, "Failure")
    const result = await dispatch(
      server,
      request(tool.name, "tools/call", { name: tool.name, arguments: { value: "ok" } })
    )
    assert.equal(result._tag, "SuccessResponse")
    assert.equal(result.result.content[0].text, "ok")
  }
})

test("recursive tool schemas register and decode nested children through their JSON codec", async () => {
  let tree
  tree = Schema.Struct({
    value: Schema.NumberFromString.check(Schema.isFinite()),
    children: Schema.Array(Schema.suspend(() => tree))
  }).annotate({ identifier: "RecursiveToolInput" })
  const values = (node) => [node.value, ...node.children.flatMap(values)]
  const server = await makeServer([
    {
      name: "recursive-input",
      parameterSchema: tree,
      content: (input) => {
        const decoded = values(input)
        assert.deepEqual(decoded, [1, 2, 3])
        return Effect.succeed({ content: [], structuredContent: { values: decoded } })
      }
    }
  ])
  const input = {
    value: "1",
    children: [{ value: "2", children: [{ value: "3", children: [] }] }]
  }
  const compiled = await Effect.runPromise(
    ServerApi.JsonSchemaValidator.default.compile({ schema: server.tools[0].tool.inputSchema })
  )
  await Effect.runPromise(compiled.validate(input))
  const response = await dispatch(
    server,
    request("recursive-call", "tools/call", { name: "recursive-input", arguments: input })
  )
  assert.equal(response._tag, "SuccessResponse")
  assert.deepEqual(response.result.structuredContent, { values: [1, 2, 3] })

  const invalid = { value: "1", children: [{ value: "not-a-number", children: [] }] }
  const rejected = await dispatch(
    server,
    request("recursive-invalid", "tools/call", { name: "recursive-input", arguments: invalid })
  )
  assert.equal(rejected._tag, "ErrorResponse")
  assert.equal(rejected.error.code, -32602)
})

test("recursive tool schemas still reject nested opaque declarations during registration", async () => {
  let tree
  tree = Schema.Struct({
    opaque: Schema.declare((value) => typeof value === "string"),
    children: Schema.Array(Schema.suspend(() => tree))
  }).annotate({ identifier: "OpaqueRecursiveToolInput" })
  let continued = false
  const exit = await Effect.runPromiseExit(
    McpServer.make({
      serverInfo: { name: "nested-opaque-input", version: "1" },
      handlers: McpServer.registerTool({
        name: "nested-opaque",
        parameterSchema: Schema.Struct({ tree }),
        content: () => Effect.succeed("unreachable")
      }).pipe(
        Effect.andThen(
          Effect.sync(() => {
            continued = true
          })
        )
      )
    })
  )
  assert.equal(Exit.isFailure(exit), true)
  const failure = Cause.findErrorOption(exit.cause)
  assert.equal(failure._tag, "Some")
  assert.equal(failure.value instanceof SchemaValidationError, true)
  assert.equal(continued, false)
})

test("tool and prompt input codecs retain decoding services captured during registration", async () => {
  const Offset = Context.Service("wp5c/input-codec-offset")
  const value = Schema.String.pipe(
    Schema.decodeTo(Schema.Finite, {
      decode: SchemaGetter.transformOrFail((input) => Offset.pipe(Effect.map((offset) => Number(input) + offset))),
      encode: SchemaGetter.transform(String)
    })
  )
  const server = await Effect.runPromise(
    McpServer.make({
      serverInfo: { name: "schema-context-server", version: "1" },
      handlers: Effect.gen(function* () {
        yield* McpServer.registerTool({
          name: "fields-context",
          parameters: { value },
          content: ({ value }) => Effect.succeed(String(value))
        })
        yield* McpServer.registerTool({
          name: "root-context",
          parameterSchema: Schema.Struct({ value }),
          content: ({ value }) => Effect.succeed(String(value))
        })
        yield* McpServer.registerPrompt({
          name: "prompt-context",
          parameters: { value },
          content: ({ value }) => Effect.succeed(String(value))
        })
      })
    }).pipe(Effect.provideService(Offset, 4))
  )
  for (const name of ["fields-context", "root-context"]) {
    const result = await dispatch(server, request(name, "tools/call", { name, arguments: { value: "5" } }))
    assert.equal(result._tag, "SuccessResponse")
    assert.equal(result.result.content[0].text, "9")
  }
  const promptResult = await dispatch(
    server,
    request("prompt-context", "prompts/get", {
      name: "prompt-context",
      arguments: { value: "5" }
    })
  )
  assert.equal(promptResult._tag, "SuccessResponse")
  assert.equal(promptResult.result.messages[0].content.text, "9")
})

test("tool input decoding agrees with Effect 4 canonical JSON number encodings", async () => {
  let handled = 0
  const server = await makeServer([
    {
      name: "canonical-number",
      parameters: { value: Schema.Number },
      outputSchema: { type: "string" },
      content: ({ value }) => {
        handled += 1
        return Effect.succeed({ content: [], structuredContent: String(value) })
      }
    }
  ])
  const compiled = await Effect.runPromise(
    ServerApi.JsonSchemaValidator.default.compile({ schema: server.tools[0].tool.inputSchema })
  )
  for (const value of [1, "Infinity", "-Infinity", "NaN"]) {
    const argumentsValue = { value }
    assert.equal(Exit.isSuccess(await Effect.runPromiseExit(compiled.validate(argumentsValue))), true)
    const response = await dispatch(
      server,
      request(`canonical-${value}`, "tools/call", { name: "canonical-number", arguments: argumentsValue })
    )
    assert.equal(response._tag, "SuccessResponse")
    assert.equal(response.result.structuredContent, String(value))
  }
  const invalid = { value: "not-a-number" }
  assert.equal(Exit.isFailure(await Effect.runPromiseExit(compiled.validate(invalid))), true)
  const rejected = await dispatch(
    server,
    request("canonical-invalid", "tools/call", { name: "canonical-number", arguments: invalid })
  )
  assert.equal(rejected._tag, "ErrorResponse")
  assert.equal(rejected.error.code, -32602)
  assert.equal(handled, 4)
})

test("tool argument decoding rejects properties forbidden by advertised input schema", async () => {
  const server = await makeServer([
    {
      name: "exact-input",
      parameters: { known: Schema.String },
      content: ({ known }) => Effect.succeed({ content: [], structuredContent: { known } })
    }
  ])
  const response = await dispatch(
    server,
    request("excess-input", "tools/call", {
      name: "exact-input",
      arguments: { known: "accepted", excess: "must-not-be-stripped" }
    })
  )
  assert.equal(response._tag, "ErrorResponse")
  assert.equal(response.error.code, -32602)
})

test("unsupported Effect parameter schemas fail registration as local typed errors", async () => {
  let continued = false
  const unsupported = Schema.declare((value) => typeof value === "string")
  const exit = await Effect.runPromiseExit(
    McpServer.make({
      serverInfo: { name: "wp5c-unsupported-input", version: "5.0.0" },
      handlers: McpServer.registerTool({
        name: "unsupported-input",
        parameters: { unsupported },
        content: () => Effect.succeed({ content: [] })
      }).pipe(
        Effect.andThen(
          Effect.sync(() => {
            continued = true
          })
        )
      )
    })
  )
  assert.equal(Exit.isFailure(exit), true)
  const failure = Cause.findErrorOption(exit.cause)
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
  const resolver = (type) =>
    Effect.runPromise(
      ServerApi.JsonSchemaResolver.make({
        allowedSchemes: ["https"],
        allowedHosts: ["schemas.example"],
        maxDepth: 1,
        maxBytes: 1024,
        maxRedirects: 1,
        timeoutMs: 100,
        load: (uri) =>
          Effect.succeed({
            bytes: encoder.encode(JSON.stringify({ $id: uri, type })),
            finalUri: uri,
            redirects: []
          })
      })
    )
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
