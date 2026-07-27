import assert from "node:assert/strict"
import path from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"
import { test } from "node:test"
import { Deferred, Effect, Option } from "effect"

/** Mirrors `test/dispatcher/wp4-dispatcher.test.mjs`: the dispatcher refuses a
 * request whose params lack the draft `_meta` envelope, so a span test that
 * omitted it would be testing rejection rather than instrumentation. */
const mcpRequest = (id, method) => ({
  _tag: "Request",
  jsonrpc: "2.0",
  id,
  method,
  params: {
    _meta: {
      "io.modelcontextprotocol/clientCapabilities": {},
      "io.modelcontextprotocol/protocolVersion": "2026-07-28"
    }
  }
})

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..")

let dispatcher
let spans
let loadError
try {
  dispatcher = await import(pathToFileURL(path.join(root, "dist/McpDispatcher.js")).href)
  spans = await import(pathToFileURL(path.join(root, "dist/observability/Spans.js")).href)
} catch (error) {
  loadError = error
}

const requireModules = () => {
  assert.ifError(loadError)
  assert.ok(dispatcher, "McpDispatcher module must exist")
  assert.ok(spans, "observability/Spans module must exist")
}

/**
 * Drives one request through a real server dispatcher and reports the span that
 * was current while the handler ran. Reading `Effect.currentSpan` from inside
 * the handler is what makes this a test of the instrumentation rather than of a
 * tracer double: if the `withSpan` wrapper is removed, no span is current and
 * the assertions fail.
 */
const captureHandlerSpan = (request) =>
  Effect.gen(function* () {
    const captured = yield* Deferred.make()
    const served = yield* dispatcher.makeServerDispatcher({
      send: () => Effect.void,
      handle: () =>
        Effect.gen(function* () {
          const span = yield* Effect.currentSpan.pipe(Effect.option)
          yield* Deferred.succeed(
            captured,
            Option.match(span, {
              onNone: () => undefined,
              // `Span.attributes` is a ReadonlyMap, not a record — spreading it
              // silently yields `{}` and every attribute assertion passes
              // vacuously against `undefined`.
              onSome: (value) => ({ name: value.name, attributes: Object.fromEntries(value.attributes) })
            })
          )
          return { resultType: "complete" }
        })
    })
    yield* served.accept(request)
    // Bounded: if `accept` rejects the request before dispatch, the handler
    // never runs and an unbounded await would hang the suite instead of
    // reporting which request shape was refused.
    return yield* Deferred.await(captured).pipe(
      Effect.timeoutFail({
        duration: "5 seconds",
        onTimeout: () => new Error(`handler never ran for ${request.method}; request was refused before dispatch`)
      })
    )
  }).pipe(Effect.scoped)

test("server dispatch runs the handler inside an mcp.server.dispatch span", async () => {
  requireModules()

  const captured = await Effect.runPromise(captureHandlerSpan(mcpRequest(7, "tools/list")))

  assert.ok(captured, "a span must be current while the request handler runs")
  assert.equal(captured.name, spans.SpanName.serverDispatch)
  assert.equal(captured.attributes[spans.SpanAttribute.method], "tools/list")
  assert.equal(captured.attributes[spans.SpanAttribute.requestId], "7")
})

test("span attributes carry protocol metadata and never carry secrets", async () => {
  requireModules()

  const captured = await Effect.runPromise(captureHandlerSpan(mcpRequest(1, "tools/list")))

  // A trace routinely leaves the trust boundary that the payload does not, so
  // the guard is on the whole attribute bag rather than on a known bad key.
  const forbidden = /token|secret|authorization|password|credential|cookie|api[_-]?key/i
  for (const [key, value] of Object.entries(captured.attributes)) {
    assert.ok(!forbidden.test(key), `span attribute key must not look secret-bearing: ${key}`)
    assert.ok(!forbidden.test(String(value)), `span attribute ${key} must not carry a secret-looking value`)
    assert.ok(key.startsWith("mcp."), `span attribute ${key} must use the mcp. namespace`)
  }
})

test("requestIdAttribute reports absent ids without inventing one", () => {
  requireModules()

  assert.equal(spans.requestIdAttribute(7), "7")
  assert.equal(spans.requestIdAttribute("abc"), "abc")
  // Notifications have no id; "(none)" keeps a trace from implying one was sent.
  assert.equal(spans.requestIdAttribute(undefined), "(none)")
  assert.equal(spans.requestIdAttribute(null), "(none)")
})
