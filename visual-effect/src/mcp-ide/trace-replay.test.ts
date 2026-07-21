import { Deferred, Effect, Either } from "effect"
import { describe, expect, it, vi } from "vitest"
import { type McpTraceDocument, validateTraceDocument } from "./model/McpTraceDocument"
import { gatewayTaskScenario } from "./scenarios/gatewayTaskScenario"
import { TraceReplay, type TraceReplayScheduler } from "./trace/TraceReplay"

const makeReplay = (
  trace: McpTraceDocument = gatewayTaskScenario.trace,
  scheduler: TraceReplayScheduler = { sleep: () => Effect.void },
) => Effect.runSync(TraceReplay.make(gatewayTaskScenario.graph, trace, scheduler))

const makeControlledScheduler = () => {
  const sleeps: Array<{
    readonly delayMs: number
    readonly gate: Deferred.Deferred<void>
  }> = []
  const scheduler: TraceReplayScheduler = {
    sleep: delayMs => {
      if (delayMs === 0) return Effect.void
      const gate = Effect.runSync(Deferred.make<void>())
      sleeps.push({ delayMs, gate })
      return Deferred.await(gate)
    },
  }
  return { scheduler, sleeps }
}

describe("MCP trace replay", () => {
  it("rejects duplicate sequence numbers and events for unknown graph nodes", () => {
    const [firstEvent] = gatewayTaskScenario.trace.events
    if (!firstEvent) throw new Error("fixture requires an event")

    const result = Effect.runSync(
      validateTraceDocument(gatewayTaskScenario.graph, {
        ...gatewayTaskScenario.trace,
        events: [
          ...gatewayTaskScenario.trace.events,
          { ...firstEvent, id: "event-duplicate-sequence" },
          { ...firstEvent, id: "event-unknown-node", sequence: 99, nodeId: "unknown-node" },
        ],
      }).pipe(Effect.either),
    )

    expect(Either.isLeft(result)).toBe(true)
    if (Either.isLeft(result)) {
      expect(result.left.issues).toEqual(
        expect.arrayContaining([
          {
            code: "duplicate-event-sequence",
            path: "events.sequence.0",
            message: "Trace sequence 0 is used more than once",
          },
          {
            code: "unknown-event-node",
            path: "events.event-unknown-node.nodeId",
            message: 'Trace event "event-unknown-node" references unknown node "unknown-node"',
          },
        ]),
      )
    }
  })

  it("rejects a trace for another graph and duplicate event identifiers", () => {
    const [firstEvent] = gatewayTaskScenario.trace.events
    if (!firstEvent) throw new Error("fixture requires an event")

    const result = Effect.runSync(
      validateTraceDocument(gatewayTaskScenario.graph, {
        ...gatewayTaskScenario.trace,
        graphId: "another-graph",
        events: [...gatewayTaskScenario.trace.events, { ...firstEvent, sequence: 99 }],
      }).pipe(Effect.either),
    )

    expect(Either.isLeft(result)).toBe(true)
    if (Either.isLeft(result)) {
      expect(result.left.issues).toEqual(
        expect.arrayContaining([
          {
            code: "graph-id-mismatch",
            path: "graphId",
            message:
              'Trace targets graph "another-graph" but the active graph is "field-research-gateway"',
          },
          {
            code: "duplicate-event-id",
            path: "events.event-01",
            message: 'Trace event id "event-01" is used more than once',
          },
        ]),
      )
    }
  })

  it("rejects unknown edges and registry-incoherent family or channel metadata", () => {
    const [firstEvent] = gatewayTaskScenario.trace.events
    if (!firstEvent) throw new Error("fixture requires an event")
    const result = Effect.runSync(
      validateTraceDocument(gatewayTaskScenario.graph, {
        ...gatewayTaskScenario.trace,
        events: [
          {
            ...firstEvent,
            edgeId: "unknown-edge",
            family: "wire",
            channel: "apps",
          },
        ],
      }).pipe(Effect.either),
    )

    expect(Either.isLeft(result)).toBe(true)
    if (Either.isLeft(result)) {
      expect(result.left.issues.map(issue => issue.code)).toEqual([
        "unknown-event-edge",
        "event-family-mismatch",
        "event-channel-mismatch",
      ])
    }
  })

  it("rejects ambiguous trace, event, correlation, and span identifiers directly", () => {
    const [firstEvent] = gatewayTaskScenario.trace.events
    if (!firstEvent) throw new Error("fixture requires an event")
    const result = Effect.runSync(
      validateTraceDocument(gatewayTaskScenario.graph, {
        ...gatewayTaskScenario.trace,
        id: " ",
        events: [
          {
            ...firstEvent,
            id: "event\u0000id",
            correlationId: "",
            spanId: "span\nvalue",
            parentSpanId: "s".repeat(129),
          },
        ],
      }).pipe(Effect.either),
    )

    expect(Either.isLeft(result)).toBe(true)
    if (Either.isLeft(result)) {
      expect(result.left.issues.map(issue => issue.code)).toEqual([
        "invalid-trace-id",
        "invalid-event-id",
        "invalid-correlation-id",
        "invalid-span-id",
        "invalid-parent-span-id",
      ])
    }
  })

  it("rejects invalid graph-owned references during direct trace validation", () => {
    const [firstEvent] = gatewayTaskScenario.trace.events
    if (!firstEvent) throw new Error("fixture requires an event")
    const result = Effect.runSync(
      validateTraceDocument(gatewayTaskScenario.graph, {
        ...gatewayTaskScenario.trace,
        graphId: "g".repeat(257),
        graphRevision: "revision\u0000value",
        events: [
          {
            ...firstEvent,
            nodeId: "n".repeat(257),
            edgeId: "edge\u0085value",
          },
        ],
      }).pipe(Effect.either),
    )

    expect(Either.isLeft(result)).toBe(true)
    if (Either.isLeft(result)) {
      expect(result.left.issues).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ code: "invalid-trace-graph-id", path: "graphId" }),
          expect.objectContaining({ code: "invalid-trace-graph-revision", path: "graphRevision" }),
          expect.objectContaining({ code: "invalid-event-node-id", path: "events.0.nodeId" }),
          expect.objectContaining({ code: "invalid-event-edge-id", path: "events.0.edgeId" }),
        ]),
      )
    }
  })

  it("applies events in stable sequence order and derives final node states", async () => {
    const replay = makeReplay(
      {
        ...gatewayTaskScenario.trace,
        events: [...gatewayTaskScenario.trace.events].reverse(),
      },
      { sleep: () => Effect.void },
    )

    await replay.run()

    const snapshot = replay.getSnapshot()
    expect(snapshot.status).toBe("completed")
    expect(snapshot.appliedEvents.map(event => event.sequence)).toEqual(
      gatewayTaskScenario.trace.events.map(event => event.sequence),
    )
    expect(Object.fromEntries(snapshot.nodeStates)).toMatchObject({
      client: "completed",
      gateway: "completed",
      server: "completed",
      tool: "completed",
      task: "completed",
    })
  })

  it("notifies subscribers as causally linked events are applied", async () => {
    const replay = makeReplay()
    const cursors: Array<number> = []
    const unsubscribe = replay.subscribe(() => {
      cursors.push(replay.getSnapshot().cursor)
    })

    await replay.run()
    unsubscribe()

    expect(cursors).toContain(0)
    expect(cursors.at(-1)).toBe(gatewayTaskScenario.trace.events.length - 1)
  })

  it("interrupts active nodes and never applies later completion after cancellation", async () => {
    const gate = Effect.runSync(Deferred.make<void>())
    const replay = makeReplay(gatewayTaskScenario.trace, {
      sleep: delayMs => (delayMs === 0 ? Effect.void : Deferred.await(gate)),
    })

    const run = replay.run()
    await vi.waitFor(() => {
      expect(replay.getSnapshot().cursor).toBe(0)
    })

    replay.cancel()
    await run

    const snapshot = replay.getSnapshot()
    expect(snapshot.status).toBe("cancelled")
    expect(snapshot.nodeStates.get("client")).toBe("interrupted")
    expect(snapshot.appliedEvents.some(event => event.kind === "runtime.completed")).toBe(false)
  })

  it("resets the run, timeline, and derived node state", async () => {
    const replay = makeReplay()

    await replay.run()
    replay.reset()

    const snapshot = replay.getSnapshot()
    expect(snapshot.status).toBe("idle")
    expect(snapshot.cursor).toBe(-1)
    expect(snapshot.appliedEvents).toEqual([])
    expect(new Set(snapshot.nodeStates.values())).toEqual(new Set(["idle"]))
  })

  it("rejects an incompatible graph revision before a replay controller exists", () => {
    const result = Effect.runSync(
      TraceReplay.make(gatewayTaskScenario.graph, {
        ...gatewayTaskScenario.trace,
        graphRevision: "graph-v2-stale000",
      }).pipe(Effect.either),
    )

    expect(Either.isLeft(result)).toBe(true)
    if (Either.isLeft(result)) {
      expect(result.left.issues).toEqual(
        expect.arrayContaining([expect.objectContaining({ code: "graph-revision-mismatch" })]),
      )
    }
  })

  it("pauses during sleep before a later event can land", async () => {
    const { scheduler, sleeps } = makeControlledScheduler()
    const replay = makeReplay(gatewayTaskScenario.trace, scheduler)

    const running = replay.run()
    await vi.waitFor(() => {
      expect(replay.getSnapshot().cursor).toBe(0)
      expect(sleeps).toHaveLength(1)
    })

    replay.pause()
    const pendingSleep = sleeps[0]
    if (!pendingSleep) throw new Error("expected a pending replay sleep")
    Effect.runSync(Deferred.succeed(pendingSleep.gate, undefined))
    await running

    expect(replay.getSnapshot()).toMatchObject({ status: "paused", cursor: 0 })
    expect(replay.getSnapshot().appliedEvents.map(event => event.id)).toEqual(["event-01"])
  })

  it("does not schedule the next delay after a synchronous subscriber pauses", async () => {
    let delayedSleeps = 0
    const replay = makeReplay(gatewayTaskScenario.trace, {
      sleep: delayMs => {
        if (delayMs === 0) return Effect.void
        delayedSleeps += 1
        return Effect.never
      },
    })
    const unsubscribe = replay.subscribe(() => {
      if (replay.getSnapshot().cursor === 0) replay.pause()
    })

    await replay.run()
    unsubscribe()

    expect(replay.getSnapshot()).toMatchObject({ status: "paused", cursor: 0 })
    expect(delayedSleeps).toBe(0)
  })

  it("resumes at the next event and restarts its full pending delay", async () => {
    const { scheduler, sleeps } = makeControlledScheduler()
    const replay = makeReplay(gatewayTaskScenario.trace, scheduler)

    const firstRun = replay.run()
    await vi.waitFor(() => expect(sleeps).toHaveLength(1))
    replay.pause()
    await firstRun

    const resumed = replay.resume()
    await vi.waitFor(() => expect(sleeps).toHaveLength(2))
    expect(sleeps[1]?.delayMs).toBe(220)
    const restartedSleep = sleeps[1]
    if (!restartedSleep) throw new Error("expected the restarted replay sleep")
    Effect.runSync(Deferred.succeed(restartedSleep.gate, undefined))
    await vi.waitFor(() => expect(replay.getSnapshot().cursor).toBe(1))
    replay.pause()
    await resumed

    expect(replay.getSnapshot().appliedEvents.map(event => event.id)).toEqual([
      "event-01",
      "event-02",
    ])
  })

  it("steps exactly one event and stays paused until the final event completes", () => {
    const replay = makeReplay()

    replay.step()
    expect(replay.getSnapshot()).toMatchObject({ status: "paused", cursor: 0 })
    replay.step()
    expect(replay.getSnapshot()).toMatchObject({ status: "paused", cursor: 1 })
    expect(replay.getSnapshot().appliedEvents).toHaveLength(2)

    replay.seek(gatewayTaskScenario.trace.events.length - 2)
    replay.step()
    expect(replay.getSnapshot()).toMatchObject({
      status: "completed",
      cursor: gatewayTaskScenario.trace.events.length - 1,
    })
  })

  it("seeks forward and backward by deriving node state from the exact event prefix", () => {
    const replay = makeReplay()

    replay.seek(8)
    expect(replay.getSnapshot()).toMatchObject({ status: "paused", cursor: 8 })
    expect(replay.getSnapshot().appliedEvents).toHaveLength(9)
    expect(replay.getSnapshot().nodeStates.get("task")).toBe("completed")

    replay.seek(2)
    expect(replay.getSnapshot()).toMatchObject({ status: "paused", cursor: 2 })
    expect(replay.getSnapshot().appliedEvents).toHaveLength(3)
    expect(replay.getSnapshot().nodeStates.get("gateway")).toBe("active")
    expect(replay.getSnapshot().nodeStates.get("task")).toBe("idle")

    const beforeInvalidSeek = replay.getSnapshot()
    replay.seek(99)
    expect(replay.getSnapshot()).toBe(beforeInvalidSeek)
  })

  it("seeks -1 to the exact initial idle snapshot and preserves identity at invalid boundaries", () => {
    const replay = makeReplay()
    const initial = replay.getSnapshot()
    replay.step()
    const applied = replay.getSnapshot()

    replay.seek(-1)
    const rewound = replay.getSnapshot()
    expect(rewound).not.toBe(applied)
    expect(rewound).toEqual(initial)
    expect(rewound).toMatchObject({ status: "idle", cursor: -1, appliedEvents: [] })
    expect(new Set(rewound.nodeStates.values())).toEqual(new Set(["idle"]))

    replay.seek(-2)
    expect(replay.getSnapshot()).toBe(rewound)
    replay.seek(gatewayTaskScenario.trace.events.length)
    expect(replay.getSnapshot()).toBe(rewound)
  })

  it("seeks -1 to idle for an empty trace and rejects its first out-of-range event", () => {
    const replay = makeReplay({
      ...gatewayTaskScenario.trace,
      id: "empty-trace",
      events: [],
    })

    replay.seek(-1)
    const initial = replay.getSnapshot()
    expect(initial).toMatchObject({ status: "idle", cursor: -1, appliedEvents: [] })
    expect(new Set(initial.nodeStates.values())).toEqual(new Set(["idle"]))
    replay.seek(0)
    expect(replay.getSnapshot()).toBe(initial)
  })

  it("cancels paused and running replays and keeps terminal states inert", async () => {
    const pausedReplay = makeReplay()
    pausedReplay.step()
    pausedReplay.cancel()
    expect(pausedReplay.getSnapshot()).toMatchObject({ status: "cancelled", cursor: 0 })
    pausedReplay.step()
    await pausedReplay.run()
    await pausedReplay.resume()
    expect(pausedReplay.getSnapshot()).toMatchObject({ status: "cancelled", cursor: 0 })

    const { scheduler, sleeps } = makeControlledScheduler()
    const runningReplay = makeReplay(gatewayTaskScenario.trace, scheduler)
    const running = runningReplay.run()
    await vi.waitFor(() => expect(sleeps).toHaveLength(1))
    runningReplay.cancel()
    await running
    expect(runningReplay.getSnapshot()).toMatchObject({ status: "cancelled", cursor: 0 })

    pausedReplay.seek(1)
    expect(pausedReplay.getSnapshot()).toMatchObject({ status: "paused", cursor: 1 })
    pausedReplay.reset()
    expect(pausedReplay.getSnapshot()).toMatchObject({ status: "idle", cursor: -1 })
  })

  it("keeps completed terminal transitions inert until reset or explicit seek", async () => {
    const replay = makeReplay()
    replay.seek(gatewayTaskScenario.trace.events.length - 1)
    const completed = replay.getSnapshot()
    expect(completed.status).toBe("completed")

    replay.step()
    expect(replay.getSnapshot()).toBe(completed)
    await replay.run()
    expect(replay.getSnapshot()).toBe(completed)
    await replay.resume()
    expect(replay.getSnapshot()).toBe(completed)

    replay.seek(0)
    expect(replay.getSnapshot()).toMatchObject({ status: "paused", cursor: 0 })
    replay.step()
    expect(replay.getSnapshot()).toMatchObject({ status: "paused", cursor: 1 })

    replay.reset()
    expect(replay.getSnapshot()).toMatchObject({ status: "idle", cursor: -1 })
    replay.step()
    expect(replay.getSnapshot()).toMatchObject({ status: "paused", cursor: 0 })
  })

  it("detaches and freezes nested payload arrays and cyclic object graphs at ingress", () => {
    const nested: Record<string, unknown> = { value: "before" }
    nested.self = nested
    const list: Array<unknown> = [nested]
    const payload = { nested, list }
    const [baseEvent] = gatewayTaskScenario.trace.events
    if (!baseEvent) throw new Error("fixture requires an event")
    const replay = makeReplay({
      ...gatewayTaskScenario.trace,
      id: "owned-payload-trace",
      events: [{ ...baseEvent, payload }],
    })

    nested.value = "after"
    list.push("after")
    replay.step()
    const captured = replay.getSnapshot().appliedEvents[0]?.payload as {
      readonly nested: Readonly<Record<string, unknown>>
      readonly list: ReadonlyArray<unknown>
    }

    expect(captured.nested.value).toBe("before")
    expect(captured.list).toHaveLength(1)
    expect(captured.nested).not.toBe(nested)
    expect(captured.nested.self).toBe(captured.nested)
    expect(Object.isFrozen(captured)).toBe(true)
    expect(Object.isFrozen(captured.nested)).toBe(true)
    expect(Object.isFrozen(captured.list)).toBe(true)
  })

  it("preserves portable object keys without changing the clone prototype", () => {
    const payload = JSON.parse('{"__proto__":{"value":"before"}}') as Record<string, unknown>
    const [baseEvent] = gatewayTaskScenario.trace.events
    if (!baseEvent) throw new Error("fixture requires an event")
    const replay = makeReplay({
      ...gatewayTaskScenario.trace,
      id: "owned-special-key-trace",
      events: [{ ...baseEvent, payload }],
    })

    const sourceValue = payload.__proto__ as { value: string }
    sourceValue.value = "after"
    replay.step()
    const captured = replay.getSnapshot().appliedEvents[0]?.payload

    expect(Object.hasOwn(captured ?? {}, "__proto__")).toBe(true)
    expect((captured?.__proto__ as { value: string }).value).toBe("before")
    expect(Object.getPrototypeOf(captured)).toBe(Object.prototype)
  })

  it("detaches and freezes nested protocol headers at ingress", () => {
    const accept = { format: { value: "before" } }
    const headers = { accept }
    const baseEvent = gatewayTaskScenario.trace.events[1]
    if (!baseEvent) throw new Error("fixture requires a protocol event")
    const replay = makeReplay({
      ...gatewayTaskScenario.trace,
      id: "owned-headers-trace",
      events: [{ ...baseEvent, protocol: { ...baseEvent.protocol, headers } }],
    })

    accept.format.value = "after"
    replay.step()
    const captured = replay.getSnapshot().appliedEvents[0]?.protocol?.headers as {
      readonly accept: { readonly format: { readonly value: string } }
    }

    expect(captured.accept.format.value).toBe("before")
    expect(captured.accept).not.toBe(accept)
    expect(Object.isFrozen(captured)).toBe(true)
    expect(Object.isFrozen(captured.accept)).toBe(true)
    expect(Object.isFrozen(captured.accept.format)).toBe(true)
  })

  it("detaches and freezes nested runtime causes at ingress", () => {
    const failure = { message: "before" }
    const cause = { failures: [failure] }
    const baseEvent = gatewayTaskScenario.trace.events[2]
    if (!baseEvent) throw new Error("fixture requires a runtime event")
    const replay = makeReplay({
      ...gatewayTaskScenario.trace,
      id: "owned-cause-trace",
      events: [{ ...baseEvent, runtime: { ...baseEvent.runtime, cause } }],
    })

    failure.message = "after"
    cause.failures.push({ message: "after" })
    replay.step()
    const captured = replay.getSnapshot().appliedEvents[0]?.runtime?.cause as {
      readonly failures: ReadonlyArray<{ readonly message: string }>
    }

    expect(captured.failures.map(item => item.message)).toEqual(["before"])
    expect(captured.failures).not.toBe(cause.failures)
    expect(Object.isFrozen(captured)).toBe(true)
    expect(Object.isFrozen(captured.failures)).toBe(true)
    expect(Object.isFrozen(captured.failures[0])).toBe(true)
  })

  it("rejects a stale sleeper completion after a running seek changes generation", async () => {
    const sleepers: Array<() => void> = []
    const replay = makeReplay(gatewayTaskScenario.trace, {
      sleep: delayMs =>
        delayMs === 0
          ? Effect.void
          : Effect.promise(
              () =>
                new Promise<void>(resolve => {
                  sleepers.push(resolve)
                }),
            ),
    })

    const running = replay.run()
    await vi.waitFor(() => expect(sleepers).toHaveLength(1))
    replay.seek(5)
    sleepers[0]?.()
    await running

    expect(replay.getSnapshot()).toMatchObject({ status: "paused", cursor: 5 })
    expect(replay.getSnapshot().appliedEvents).toHaveLength(6)
  })
})
