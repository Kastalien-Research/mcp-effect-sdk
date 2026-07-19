import assert from "node:assert/strict"
import { test } from "node:test"
import * as Effect from "effect/Effect"
import * as Cause from "effect/Cause"
import * as Exit from "effect/Exit"
import * as Queue from "effect/Queue"
import * as ServerApi from "../../dist/server.js"
import * as McpServer from "../../dist/McpServer.js"

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
    { name: "error-invalid", outputSchema: schema, content: () => Effect.succeed({ isError: true, content: [], structuredContent: { value: 1 } }) }
  ])

  for (const name of ["invalid", "missing", "hostile", "error-invalid"]) {
    const response = await call(server, name)
    assert.equal(response._tag, "ErrorResponse", `${name}: ${JSON.stringify(response)}`)
    assert.equal(response.error.code, -32602)
    assert.equal(response.error.message, "Tool output failed JSON Schema validation")
    assert.equal(JSON.stringify(response).includes(SERVER_INFO_KEY), false)
    assert.equal(JSON.stringify(response).includes("must-not-run"), false)
  }
  assert.equal(getterReads, 0)
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
