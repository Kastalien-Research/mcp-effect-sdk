import assert from "node:assert/strict"
import test from "node:test"
import * as Effect from "effect/Effect"
import * as Stream from "effect/Stream"
import { make } from "../../dist/legacy/LegacyStdio.js"

test("2025-11-25 stdio decodes and encodes newline-delimited JSON-RPC", async () => {
  const writes = []
  await Effect.runPromise(
    Effect.scoped(
      Effect.gen(function* () {
        const transport = yield* make({
          input: Stream.fromIterable([
            new TextEncoder().encode('{"jsonrpc":"2.0","method":"notifications/initialized"}\n')
          ]),
          write: (bytes) => Effect.sync(() => writes.push(new TextDecoder().decode(bytes)))
        })
        const received = yield* Stream.runHead(transport.messages)
        assert.equal(received._tag, "Some")
        assert.equal(received.value._tag, "Notification")
        assert.equal(received.value.method, "notifications/initialized")

        yield* transport.send({
          _tag: "Request",
          jsonrpc: "2.0",
          id: "client-1",
          method: "ping"
        })
      })
    )
  )
  assert.deepEqual(writes, ['{"jsonrpc":"2.0","id":"client-1","method":"ping"}\n'])
})
