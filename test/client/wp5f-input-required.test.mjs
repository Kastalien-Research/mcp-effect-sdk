import assert from "node:assert/strict"
import { test } from "node:test"
import Ajv from "ajv"
import addFormats from "ajv-formats"
import * as Cause from "effect/Cause"
import * as Effect from "effect/Effect"
import * as Either from "effect/Either"
import * as FiberId from "effect/FiberId"
import * as Stream from "effect/Stream"
import * as Client from "../../dist/client.js"

const success = (request, result) => ({
  _tag: "Success",
  response: { _tag: "SuccessResponse", jsonrpc: "2.0", id: request.id, result }
})

const discover = {
  resultType: "complete",
  supportedVersions: ["2026-07-28"],
  capabilities: { tools: {}, prompts: {}, resources: {} },
  ttlMs: 0,
  cacheScope: "public"
}

const complete = {
  "tools/call": { resultType: "complete", content: [{ type: "text", text: "done" }] },
  "prompts/get": { resultType: "complete", messages: [] },
  "resources/read": {
    resultType: "complete", contents: [], ttlMs: 0, cacheScope: "private"
  }
}

const scopedClient = (transport, inputRequired, capabilities) => Effect.scoped(Client.make({
  transport,
  ...(inputRequired === undefined ? {} : { inputRequired }),
  ...(capabilities === undefined ? {} : { capabilities })
}))

test("stable InputRequiredPolicy exposes automatic and manual construction", () => {
  assert.equal(typeof Client.InputRequiredPolicy?.automatic, "function")
  assert.equal(Client.InputRequiredPolicy?.manual?.mode, "manual")
  assert.equal(Client.InputRequiredPolicy.automatic({ mode: "manual" }).mode, "automatic")
  let getterReads = 0
  assert.throws(() => Client.InputRequiredPolicy.automatic(Object.defineProperty({}, "maxRounds", {
    enumerable: true,
    get: () => { getterReads++; return 1 }
  })))
  assert.equal(getterReads, 0)
})

test("manual mode sends once and permits an exact caller-owned continuation", async () => {
  const calls = []
  const transport = {
    request: (request) => {
      if (request.method === "server/discover") return Stream.succeed(success(request, discover))
      calls.push(request)
      return Stream.succeed(success(request, calls.length === 1
        ? {
            resultType: "input_required",
            requestState: "state-1",
            inputRequests: {
              approval: {
                method: "elicitation/create",
                params: {
                  mode: "form",
                  message: "Approve?",
                  requestedSchema: { type: "object", properties: {} }
                }
              }
            }
          }
        : complete[request.method]))
    }
  }
  const client = await Effect.runPromise(scopedClient(
    transport,
    { mode: "manual" },
    () => Effect.succeed({ elicitation: { form: {} } })
  ))
  const first = await Effect.runPromise(client.callTool({ name: "manual", arguments: {} }))
  assert.equal(first.resultType, "input_required")
  assert.equal(calls.length, 1)
  const second = await Effect.runPromise(client.callTool({
    name: "manual",
    arguments: {},
    requestState: first.requestState,
    inputResponses: { approval: { action: "accept", content: {} } }
  }))
  assert.equal(second.resultType, "complete")
  assert.equal(calls.length, 2)
  assert.equal(calls[1].params.requestState, "state-1")
  assert.deepEqual(calls[1].params.inputResponses, {
    approval: { action: "accept", content: {} }
  })
})

test("default automatic policy handles at most ten input_required results", async () => {
  let inputs = 0
  let handlerCalls = 0
  const ids = []
  const transport = {
    request: (request) => {
      if (request.method === "server/discover") return Stream.succeed(success(request, discover))
      ids.push(request.id)
      inputs += 1
      return Stream.succeed(success(request, {
        resultType: "input_required",
        requestState: `round-${inputs}`,
        inputRequests: { roots: { method: "roots/list", params: {} } }
      }))
    }
  }
  const program = Effect.scoped(Effect.gen(function*() {
    const client = yield* Client.make({
      transport,
      inputRequired: {
        mode: "automatic",
        roots: { list: Effect.sync(() => { handlerCalls += 1; return { roots: [] } }) }
      }
    })
    return yield* client.callTool({ name: "bounded", arguments: {} }).pipe(Effect.either)
  }))
  const outcome = await Effect.runPromise(program)
  assert.equal(Either.isLeft(outcome), true)
  assert.equal(outcome.left.reason, "InputRequired")
  assert.equal(outcome.left.cause?._tag, "InputRequiredError")
  assert.equal(outcome.left.cause?.reason, "RoundLimit")
  assert.equal(inputs, 11)
  assert.equal(handlerCalls, 10)
  assert.equal(new Set(ids).size, 11)
})

test("automatic MRTR preserves exact keys/state, bounds concurrency, supports resume and reentrancy", async () => {
  const calls = []
  let active = 0
  let peak = 0
  let nestedComplete = false
  let client
  const keys = ["", "__proto__", "café", ...Array.from({ length: 5 }, (_, i) => `k${i}`)]
  const inputRequests = Object.create(null)
  for (const key of keys) Object.defineProperty(inputRequests, key, {
    enumerable: true,
    value: { method: "roots/list", params: {} }
  })
  const transport = {
    request: (request) => {
      if (request.method === "server/discover") return Stream.succeed(success(request, discover))
      calls.push(request)
      if (request.params.name === "nested") {
        return Stream.succeed(success(request, complete["tools/call"]))
      }
      if (calls.filter((call) => call.params.name === "outer").length === 1) {
        return Stream.succeed(success(request, {
          resultType: "input_required",
          requestState: "exact-state",
          inputRequests
        }))
      }
      return Stream.succeed(success(request, complete[request.method]))
    }
  }
  const program = Effect.scoped(Effect.gen(function*() {
    client = yield* Client.make({
      transport,
      inputRequired: {
        mode: "automatic",
        maxConcurrency: 4,
        roots: {
          list: Effect.acquireUseRelease(
            Effect.sync(() => { active += 1; peak = Math.max(peak, active) }),
            () => nestedComplete
              ? Effect.succeed({ roots: [] })
              : client.callTool({ name: "nested", arguments: {} }).pipe(
                  Effect.tap(() => Effect.sync(() => { nestedComplete = true })),
                  Effect.as({ roots: [] })
                ),
            () => Effect.sync(() => { active -= 1 })
          )
        }
      }
    })
    return yield* client.callTool({
      name: "outer",
      arguments: {},
      requestState: "resume-state",
      inputResponses: { prior: { roots: [] } }
    })
  }))
  const result = await Effect.runPromise(program)
  assert.equal(result.resultType, "complete")
  assert.equal(peak <= 4, true)
  assert.equal(nestedComplete, true)
  const outer = calls.filter((call) => call.params.name === "outer")
  assert.equal(outer[0].params.requestState, "resume-state")
  assert.equal(outer[1].params.requestState, "exact-state")
  assert.deepEqual(Reflect.ownKeys(outer[1].params.inputResponses), keys)
  assert.equal(Object.hasOwn(outer[1].params.inputResponses, "__proto__"), true)
  assert.equal(Object.hasOwn(outer[1].params.inputResponses, "prior"), false)
})

test("automatic policy rejects overload, URL by default, invalid form output, and capability conflicts", async (t) => {
  await t.test("more than 32 requests sheds before handlers", async () => {
    let handled = 0
    const inputRequests = Object.fromEntries(Array.from({ length: 33 }, (_, i) => [
      `r${i}`, { method: "roots/list", params: {} }
    ]))
    const transport = { request: (request) => Stream.succeed(success(request,
      request.method === "server/discover" ? discover : {
        resultType: "input_required", inputRequests, requestState: "shed"
      })) }
    const outcome = await Effect.runPromise(Effect.scoped(Effect.gen(function*() {
      const client = yield* Client.make({
        transport,
        inputRequired: { mode: "automatic", roots: { list: Effect.sync(() => { handled++; return { roots: [] } }) } }
      })
      return yield* client.callTool({ name: "overload", arguments: {} }).pipe(Effect.either)
    })))
    assert.equal(Either.isLeft(outcome), true)
    assert.equal(outcome.left.cause?.reason, "Overloaded")
    assert.equal(handled, 0)
  })

  await t.test("URL elicitation is denied without explicit URL handler", async () => {
    let attempts = 0
    const transport = { request: (request) => {
      if (request.method === "server/discover") return Stream.succeed(success(request, discover))
      attempts++
      return Stream.succeed(success(request, {
        resultType: "input_required",
        inputRequests: { url: { method: "elicitation/create", params: {
          mode: "url", message: "Continue", url: "https://example.test"
        } } }
      }))
    } }
    const outcome = await Effect.runPromise(Effect.scoped(Effect.gen(function*() {
      const client = yield* Client.make({
        transport,
        inputRequired: {
          mode: "automatic",
          elicitation: { form: () => Effect.succeed({ action: "decline" }) }
        }
      })
      return yield* client.callTool({ name: "url", arguments: {} }).pipe(Effect.either)
    })))
    assert.equal(Either.isLeft(outcome), true)
    assert.equal(outcome.left.cause?.reason, "MissingHandler")
    assert.equal(attempts, 1)
  })

  await t.test("accepted form content must satisfy requested schema", async () => {
    const transport = { request: (request) => Stream.succeed(success(request,
      request.method === "server/discover" ? discover : {
        resultType: "input_required",
        inputRequests: { form: { method: "elicitation/create", params: {
          mode: "form", message: "Age", requestedSchema: {
            type: "object", required: ["age"], properties: {
              age: { type: "integer", minimum: 18 }
            }
          }
        } } }
      })) }
    const outcome = await Effect.runPromise(Effect.scoped(Effect.gen(function*() {
      const client = yield* Client.make({ transport, inputRequired: {
        mode: "automatic",
        elicitation: { form: () => Effect.succeed({ action: "accept", content: { age: 12 } }) }
      } })
      return yield* client.callTool({ name: "form", arguments: {} }).pipe(Effect.either)
    })))
    assert.equal(Either.isLeft(outcome), true)
    assert.equal(outcome.left.cause?.reason, "InvalidInputResponse")
  })

  await t.test("form formats and code-point lengths follow the generated restricted schema", async () => {
    const ajv = new Ajv({ strict: true })
    addFormats(ajv, { mode: "full" })
    for (const [format, content, expected] of [
      ["date", "2024-02-29", true],
      ["date", "2023-02-29", false],
      ["date", "2024-13-01", false],
      ["date-time", "2024-06-30T23:59:60Z", true],
      ["date-time", "2024-01-01T00:00:00+23:59", true],
      ["date-time", "2024-01-01T00:00:00+24:00", false],
      ["date-time", "2024-01-01T00:00:00", false],
      ["email", "a@example.com", true],
      ["email", `${"a".repeat(65)}@example.com`, true],
      ["email", "a..b@example.com", false],
      ["email", "a@localhost", false],
      ["uri", "https://example.com/a%20b", true],
      ["uri", "urn:example:test", true],
      ["uri", "http://[v1.fe]/", true],
      ["uri", "http://[::1]/", true],
      ["uri", "http://", true],
      ["uri", "http://example.com:99999/", true],
      ["uri", "http://999.999.999.999/", true],
      ["uri", "http://user@@example.com/", true],
      ["uri", "foo:a", true],
      ["uri", "foo:", false],
      ["uri", "foo:?q", false],
      ["uri", "foo:#f", false],
      ["uri", "http://[v1.]/", false],
      ["uri", "https://example.com/%ZZ", false],
      ["uri", "https://example.com/é", false],
      ["uri", "https://例え.テスト/道", false],
      ["uri", "relative/path", false]
    ]) {
      const oracle = ajv.compile({ type: "string", format })
      assert.equal(oracle(content), expected, `ajv-formats oracle: ${format} ${content}`)
      let attempts = 0
      const transport = { request: (request) => {
        if (request.method === "server/discover") return Stream.succeed(success(request, discover))
        attempts++
        return Stream.succeed(success(request, attempts === 1 ? {
          resultType: "input_required",
          inputRequests: { form: { method: "elicitation/create", params: {
            mode: "form", message: "Value", requestedSchema: {
              type: "object", required: ["value"], properties: {
                value: { type: "string", format }
              }
            }
          } } }
        } : complete[request.method]))
      } }
      const outcome = await Effect.runPromise(Effect.scoped(Effect.gen(function*() {
        const client = yield* Client.make({ transport, inputRequired: {
          mode: "automatic",
          elicitation: { form: () => Effect.succeed({ action: "accept", content: { value: content } }) }
        } })
        return yield* client.callTool({ name: `format-${format}`, arguments: {} }).pipe(Effect.either)
      })))
      assert.equal(outcome._tag, expected ? "Right" : "Left", `${format} ${content}`)
      assert.equal(attempts, expected ? 2 : 1, `${format} ${content}`)
      if (!expected) assert.equal(outcome.left.cause?.reason, "InvalidInputResponse", format)
    }

    let attempts = 0
    const transport = { request: (request) => {
      if (request.method === "server/discover") return Stream.succeed(success(request, discover))
      attempts++
      return Stream.succeed(success(request, attempts === 1 ? {
        resultType: "input_required",
        inputRequests: { form: { method: "elicitation/create", params: {
          mode: "form", message: "One character", requestedSchema: {
            type: "object", required: ["value"], properties: {
              value: { type: "string", minLength: 1, maxLength: 1 }
            }
          }
        } } }
      } : complete[request.method]))
    } }
    const result = await Effect.runPromise(Effect.scoped(Effect.gen(function*() {
      const client = yield* Client.make({ transport, inputRequired: {
        mode: "automatic",
        elicitation: { form: () => Effect.succeed({ action: "accept", content: { value: "😀" } }) }
      } })
      return yield* client.callTool({ name: "code-point", arguments: {} })
    })))
    assert.equal(result.resultType, "complete")
    assert.equal(attempts, 2)
  })

  await t.test("automatic policy owns advertised input capabilities", async () => {
    let targetCalls = 0
    const transport = { request: (request) => {
      if (request.method !== "server/discover") targetCalls++
      return Stream.succeed(success(request, request.method === "server/discover" ? discover : complete[request.method]))
    } }
    const outcome = await Effect.runPromise(Effect.scoped(Client.make({
      transport,
      inputRequired: { mode: "automatic", roots: { list: Effect.succeed({ roots: [] }) } },
      capabilities: () => Effect.succeed({ roots: { conflicting: true } })
    }).pipe(Effect.either)))
    assert.equal(Either.isLeft(outcome), true)
    assert.equal(outcome.left.reason, "Protocol")
    assert.equal(targetCalls, 0)
  })
})

test("handler failure contains the original Cause while pure and mixed interruption stay interruption", async () => {
  const marker = new Error("handler failure")
  const transport = { request: (request) => Stream.succeed(success(request,
    request.method === "server/discover" ? discover : {
      resultType: "input_required",
      inputRequests: { roots: { method: "roots/list", params: {} } }
    })) }
  const exit = await Effect.runPromiseExit(Effect.scoped(Effect.gen(function*() {
    const client = yield* Client.make({ transport, inputRequired: {
      mode: "automatic", roots: { list: Effect.fail(marker) }
    } })
    return yield* client.callTool({ name: "cause", arguments: {} })
  })))
  assert.equal(exit._tag, "Failure")
  const failures = Array.from(Cause.failures(exit.cause))
  assert.equal(failures[0]?.reason, "InputRequired")
  assert.equal(failures[0]?.cause?._tag, "InputRequiredError")
  assert.ok(failures[0]?.cause?.cause)

  for (const handler of [
    Effect.interrupt,
    Effect.failCause(Cause.parallel(Cause.fail(marker), Cause.interrupt(FiberId.make(1, 0))))
  ]) {
    const interrupted = await Effect.runPromiseExit(Effect.scoped(Effect.gen(function*() {
      const client = yield* Client.make({ transport, inputRequired: {
        mode: "automatic", roots: { list: handler }
      } })
      return yield* client.callTool({ name: "interrupt", arguments: {} })
    })))
    assert.equal(interrupted._tag, "Failure")
    assert.equal(Array.from(Cause.interruptors(interrupted.cause)).length > 0, true)
  }
})
