import assert from "node:assert/strict"
import { test } from "node:test"
import * as Deferred from "effect/Deferred"
import * as Effect from "effect/Effect"
import * as McpServer from "../../dist/server.js"
import * as McpSchema from "../../dist/McpSchema.js"

const request = (id, method, params, capabilities = {}) => ({
  _tag: "Request",
  jsonrpc: "2.0",
  id,
  method,
  params: {
    ...params,
    _meta: {
      "io.modelcontextprotocol/clientCapabilities": capabilities,
      "io.modelcontextprotocol/protocolVersion": "2026-07-28"
    }
  }
})

const runRequest = (server, message) => Effect.scoped(Effect.gen(function*() {
  const sent = []
  const terminal = yield* Deferred.make()
  const dispatcher = yield* McpServer.makeDispatcher({
    send: (frame) => Effect.sync(() => { sent.push(frame) }).pipe(
      Effect.zipRight(frame._tag === "Notification"
        ? Effect.void
        : Deferred.succeed(terminal, undefined).pipe(Effect.asVoid))
    )
  }).pipe(Effect.provideService(McpServer.McpServer, server))
  yield* dispatcher.accept(message)
  yield* Deferred.await(terminal).pipe(Effect.timeout("1 second"))
  return sent.at(-1)
}))

test("requestInput emits exact generated continuation only for allowed methods and capabilities", async () => {
  assert.equal(typeof McpServer.requestInput, "function")
  const seen = []
  const handlers = Effect.all([
    McpServer.registerTool({
      name: "approval",
      content: () => Effect.gen(function*() {
        const context = yield* McpServer.McpRequestContext
        seen.push(context.request.params)
        if (context.request.params.requestState === undefined) {
          const inputRequests = Object.create(null)
          Object.defineProperty(inputRequests, "__proto__", {
            value: {
              method: "elicitation/create",
              params: {
                mode: "form",
                message: "Approve?",
                requestedSchema: { type: "object", properties: {} }
              }
            },
            enumerable: true
          })
          return yield* McpServer.requestInput({
            inputRequests,
            requestState: "server-state"
          })
        }
        return "done"
      })
    }),
    McpServer.registerPrompt({
      name: "approval",
      content: () => McpServer.requestInput({ requestState: "prompt-state" })
    }),
    McpServer.registerResource({
      uri: "test://approval",
      name: "approval",
      content: McpServer.requestInput({ requestState: "resource-state" })
    })
  ], { discard: true })
  const server = await Effect.runPromise(McpServer.make({
    serverInfo: { name: "wp5f", version: "1" }, handlers
  }))
  const capabilities = { elicitation: { form: {} } }
  const first = await Effect.runPromise(runRequest(server,
    request(1, "tools/call", { name: "approval", arguments: {} }, capabilities)))
  assert.equal(first._tag, "SuccessResponse")
  assert.equal(first.result.resultType, "input_required")
  assert.equal(first.result.requestState, "server-state")
  assert.equal(Object.hasOwn(first.result.inputRequests, "__proto__"), true)
  const second = await Effect.runPromise(runRequest(server, request(2, "tools/call", {
    name: "approval",
    arguments: {},
    requestState: first.result.requestState,
    inputResponses: Object.defineProperty(Object.create(null), "__proto__", {
      value: { action: "accept", content: {} },
      enumerable: true
    })
  }, capabilities)))
  assert.equal(second.result.resultType, "complete")
  assert.equal(seen[1].requestState, "server-state")
  assert.equal(Object.hasOwn(seen[1].inputResponses, "__proto__"), true)

  for (const [id, method, params] of [
    [3, "prompts/get", { name: "approval" }],
    [4, "resources/read", { uri: "test://approval" }]
  ]) {
    const result = await Effect.runPromise(runRequest(server, request(id, method, params, capabilities)))
    assert.equal(result.result.resultType, "input_required")
  }
})

test("requestInput rejects missing mode capability, overload, and forbidden parent methods", async (t) => {
  const make = (effect, name = "failure") => McpServer.make({
    serverInfo: { name: "wp5f", version: "1" },
    handlers: McpServer.registerTool({ name, content: () => effect })
  })
  await t.test("URL capability missing", async () => {
    const server = await Effect.runPromise(make(McpServer.requestInput({
      inputRequests: { url: { method: "elicitation/create", params: {
        mode: "url", message: "Continue", url: "https://example.test"
      } } }
    })))
    const terminal = await Effect.runPromise(runRequest(server,
      request(1, "tools/call", { name: "failure", arguments: {} }, { elicitation: { form: {} } })))
    assert.equal(terminal._tag, "ErrorResponse")
    assert.equal(terminal.error.code, -32021)
  })

  await t.test("more than 32 input requests", async () => {
    const inputRequests = Object.fromEntries(Array.from({ length: 33 }, (_, i) => [
      `r${i}`, { method: "roots/list", params: {} }
    ]))
    const server = await Effect.runPromise(make(McpServer.requestInput({ inputRequests })))
    const terminal = await Effect.runPromise(runRequest(server,
      request(2, "tools/call", { name: "failure", arguments: {} }, { roots: {} })))
    assert.equal(terminal._tag, "ErrorResponse")
    assert.equal(terminal.error.code, -32602)
  })

  await t.test("non-string requestState is InvalidParams rather than a defect", async () => {
    const server = await Effect.runPromise(make(McpServer.requestInput({ requestState: 42 })))
    const terminal = await Effect.runPromise(runRequest(server,
      request(3, "tools/call", { name: "failure", arguments: {} })))
    assert.equal(terminal._tag, "ErrorResponse")
    assert.equal(terminal.error.code, -32602)
  })

  await t.test("resource templates preserve missing-capability errors", async () => {
    const id = McpSchema.param("id", McpSchema.Cursor)
    const handlers = McpServer.registerResource`test://template/${id}`({
      name: "template",
      content: () => McpServer.requestInput({
        inputRequests: { roots: { method: "roots/list", params: {} } }
      })
    })
    const server = await Effect.runPromise(McpServer.make({
      serverInfo: { name: "wp5f", version: "1" }, handlers
    }))
    const terminal = await Effect.runPromise(runRequest(server,
      request(4, "resources/read", { uri: "test://template/value" })))
    assert.equal(terminal._tag, "ErrorResponse")
    assert.equal(terminal.error.code, -32021)
  })

  await t.test("list method cannot emit input_required", async () => {
    const forbidden = request(5, "tools/list", {})
    const outcome = await Effect.runPromise(McpServer.requestInput({
      requestState: "forbidden"
    }).pipe(
      Effect.provideService(McpServer.McpRequestContext, {
        request: forbidden,
        id: 4,
        protocolVersion: "2026-07-28",
        clientCapabilities: {},
        extensions: undefined,
        clientInfo: undefined,
        authorizationPrincipal: undefined,
        progressToken: { _id: "Option", _tag: "None" },
        cancelled: Effect.never,
        isCancelled: Effect.succeed(false),
        reportProgress: () => Effect.void,
        annotations: new Map()
      }),
      Effect.either
    ))
    assert.equal(outcome._tag, "Left")
    assert.equal(outcome.left._tag, "InvalidParams")
  })
})
