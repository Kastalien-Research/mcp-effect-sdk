import assert from "node:assert/strict"
import { test } from "node:test"
import * as Deferred from "effect/Deferred"
import * as Effect from "effect/Effect"
import * as Exit from "effect/Exit"
import * as Schema from "effect/Schema"
import * as McpServer from "../../dist/server.js"
import { jsonSchema202012Parameters } from "../../dist/examples/everything-server-fixtures.js"

const request = (id, name, args) => ({
  _tag: "Request",
  jsonrpc: "2.0",
  id,
  method: "tools/call",
  params: {
    name,
    arguments: args,
    _meta: {
      "io.modelcontextprotocol/clientCapabilities": {},
      "io.modelcontextprotocol/clientInfo": { name: "tier1-test", version: "1" },
      "io.modelcontextprotocol/protocolVersion": "2026-07-28"
    }
  }
})

const dispatch = (server, message) => Effect.scoped(Effect.gen(function*() {
  const terminal = yield* Deferred.make()
  const dispatcher = yield* McpServer.makeDispatcher({
    send: (frame) => frame._tag === "Notification"
      ? Effect.void
      : Deferred.succeed(terminal, frame).pipe(Effect.asVoid)
  }).pipe(Effect.provideService(McpServer.McpServer, server))
  yield* dispatcher.accept(message)
  return yield* Deferred.await(terminal).pipe(Effect.timeout("1 second"))
}))

test("registerTool preserves JSON Schema 2020-12 annotations from an Effect root schema", async () => {
  const seen = []
  const server = await Effect.runPromise(McpServer.make({
    serverInfo: { name: "raw-schema", version: "1" },
    handlers: McpServer.registerTool({
      name: "raw-schema",
      parameterSchema: jsonSchema202012Parameters,
      content: (params) => Effect.sync(() => {
        seen.push(params)
        return "ok"
      })
    })
  }))

  const inputSchema = server.tools[0].tool.inputSchema
  assert.equal(inputSchema.$schema, "https://json-schema.org/draft/2020-12/schema")
  assert.equal(inputSchema.$defs.address.$anchor, "addressDef")
  assert.equal(inputSchema.additionalProperties, false)
  assert.deepEqual(inputSchema.allOf, [{ anyOf: [{ required: ["phone"] }, { required: ["email"] }] }])
  assert.deepEqual(inputSchema.if, {
    properties: { contactMethod: { const: "phone" } },
    required: ["contactMethod"]
  })
  assert.deepEqual(inputSchema.then, { required: ["phone"] })
  assert.deepEqual(inputSchema.else, { required: ["email"] })
  const valid = await Effect.runPromise(dispatch(server, request("valid", "raw-schema", {
    contactMethod: "phone",
    phone: "123"
  })))
  assert.equal(valid._tag, "SuccessResponse")
  assert.deepEqual(seen, [{ contactMethod: "phone", phone: "123" }])

  const invalid = await Effect.runPromise(dispatch(server, request("invalid", "raw-schema", {
    contactMethod: "phone",
    email: "not-a-phone"
  })))
  assert.equal(invalid._tag, "ErrorResponse")
  assert.equal(invalid.error.code, -32602)
  assert.equal(seen.length, 1)

  const invalidElse = await Effect.runPromise(dispatch(server, request("invalid-else", "raw-schema", {
    contactMethod: "email",
    phone: "not-an-email"
  })))
  assert.equal(invalidElse._tag, "ErrorResponse")
  assert.equal(invalidElse.error.code, -32602)
  assert.equal(seen.length, 1)
})

test("registerTool rejects ambiguous or non-object Effect parameter schemas", async (t) => {
  await t.test("parameters and parameterSchema are mutually exclusive", async () => {
    const exit = await Effect.runPromiseExit(McpServer.make({
      serverInfo: { name: "ambiguous-schema", version: "1" },
      handlers: McpServer.registerTool({
        name: "ambiguous-schema",
        parameters: {},
        parameterSchema: Schema.Struct({}),
        content: () => Effect.succeed("unreachable")
      })
    }))
    assert.equal(Exit.isFailure(exit), true)
  })

  await t.test("explicit undefined parameters preserve the no-argument shorthand", async () => {
    const server = await Effect.runPromise(McpServer.make({
      serverInfo: { name: "undefined-fields", version: "1" },
      handlers: McpServer.registerTool({
        name: "undefined-fields",
        parameters: undefined,
        content: () => Effect.succeed("ok")
      })
    }))
    assert.equal(server.tools[0].tool.inputSchema.type, "object")
  })

  await t.test("undefined parameters do not conflict with a root schema", async () => {
    const server = await Effect.runPromise(McpServer.make({
      serverInfo: { name: "undefined-fields-root", version: "1" },
      handlers: McpServer.registerTool({
        name: "undefined-fields-root",
        parameters: undefined,
        parameterSchema: Schema.Struct({ value: Schema.String }),
        content: () => Effect.succeed("ok")
      })
    }))
    assert.deepEqual(server.tools[0].tool.inputSchema.required, ["value"])
  })

  await t.test("scalar root schemas cannot be advertised as object tool inputs", async () => {
    const exit = await Effect.runPromiseExit(McpServer.make({
      serverInfo: { name: "scalar-schema", version: "1" },
      handlers: McpServer.registerTool({
        name: "scalar-schema",
        parameterSchema: Schema.String,
        content: () => Effect.succeed("unreachable")
      })
    }))
    assert.equal(Exit.isFailure(exit), true)
  })
})
