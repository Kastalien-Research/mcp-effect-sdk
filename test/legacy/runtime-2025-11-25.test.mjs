import assert from "node:assert/strict"
import test from "node:test"
import * as Effect from "effect/Effect"
import { makeLogging } from "../../dist/legacy/LegacyLogging.js"
import { makeResourceSubscriptions } from "../../dist/legacy/LegacyResources.js"
import { makeTaskStore } from "../../dist/legacy/LegacyTasks.js"

test("legacy task store enforces ownership, transitions, retention, cancellation, and pagination", async () => {
  let now = new Date("2026-01-01T00:00:00.000Z")
  let sequence = 0
  await Effect.runPromise(
    Effect.gen(function* () {
      const store = yield* makeTaskStore({
        now: () => now,
        id: () => `task-${++sequence}`,
        defaultTtlMs: 1000,
        pageSize: 1
      })
      const first = yield* store.create({ owner: "alice" })
      const second = yield* store.create({ owner: "alice", ttlMs: null })
      assert.equal(first.status, "working")
      assert.equal((yield* store.get(first.taskId, "alice")).task.taskId, first.taskId)
      assert.equal((yield* store.get(first.taskId, "bob").pipe(Effect.either))._tag, "Left")

      yield* store.transition(first.taskId, "input_required", { owner: "alice" })
      yield* store.transition(first.taskId, "working", { owner: "alice" })
      yield* store.transition(first.taskId, "completed", { owner: "alice", payload: { answer: 42 } })
      assert.deepEqual(yield* store.handlers("alice")["tasks/result"]({ taskId: first.taskId }, {}), { answer: 42 })
      assert.equal(
        (yield* store.transition(first.taskId, "working", { owner: "alice" }).pipe(Effect.either))._tag,
        "Left"
      )

      const page = yield* store.handlers("alice")["tasks/list"]({}, {})
      assert.equal(page.tasks.length, 1)
      assert.equal(typeof page.nextCursor, "string")
      const next = yield* store.handlers("alice")["tasks/list"]({ cursor: page.nextCursor }, {})
      assert.equal(next.tasks.length, 1)

      const cancelled = yield* store.handlers("alice")["tasks/cancel"]({ taskId: second.taskId }, {})
      assert.equal(cancelled.status, "cancelled")
      now = new Date("2026-01-01T00:00:02.000Z")
      assert.equal((yield* store.get(first.taskId, "alice").pipe(Effect.either))._tag, "Left")
      assert.equal((yield* store.get(second.taskId, "alice")).task.status, "cancelled")
    })
  )
})

test("legacy resources deliver updates only while subscribed", async () => {
  const notifications = []
  await Effect.runPromise(
    Effect.gen(function* () {
      const subscriptions = yield* makeResourceSubscriptions({
        notify: (_method, params) => Effect.sync(() => notifications.push(params))
      })
      const uri = "file:///workspace/readme.md"
      assert.equal(yield* subscriptions.publishUpdated(uri), false)
      yield* subscriptions.handlers["resources/subscribe"]({ uri }, {})
      assert.equal(yield* subscriptions.publishUpdated(uri), true)
      yield* subscriptions.handlers["resources/unsubscribe"]({ uri }, {})
      assert.equal(yield* subscriptions.publishUpdated(uri), false)
      assert.deepEqual(notifications, [{ uri }])
    })
  )
})

test("legacy logging applies the negotiated minimum level", async () => {
  const messages = []
  await Effect.runPromise(
    Effect.gen(function* () {
      const logging = yield* makeLogging({
        notify: (_method, params) => Effect.sync(() => messages.push(params))
      })
      assert.equal(yield* logging.log({ level: "debug", data: "hidden" }), false)
      yield* logging.handler({ level: "warning" }, {})
      assert.equal(yield* logging.log({ level: "info", data: "hidden" }), false)
      assert.equal(yield* logging.log({ level: "error", data: "shown" }), true)
      assert.deepEqual(messages, [{ level: "error", data: "shown" }])
    })
  )
})
