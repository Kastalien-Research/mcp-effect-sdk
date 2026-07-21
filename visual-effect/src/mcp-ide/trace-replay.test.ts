import { Deferred, Effect, Either } from "effect"
import { describe, expect, it, vi } from "vitest"
import { validateTraceDocument } from "./model/McpTraceDocument"
import { gatewayTaskScenario } from "./scenarios/gatewayTaskScenario"
import { TraceReplay } from "./trace/TraceReplay"

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
    const replay = new TraceReplay(
      gatewayTaskScenario.graph,
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
    const replay = new TraceReplay(gatewayTaskScenario.graph, gatewayTaskScenario.trace, {
      sleep: () => Effect.void,
    })
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
    const replay = new TraceReplay(gatewayTaskScenario.graph, gatewayTaskScenario.trace, {
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
    const replay = new TraceReplay(gatewayTaskScenario.graph, gatewayTaskScenario.trace, {
      sleep: () => Effect.void,
    })

    await replay.run()
    replay.reset()

    const snapshot = replay.getSnapshot()
    expect(snapshot.status).toBe("idle")
    expect(snapshot.cursor).toBe(-1)
    expect(snapshot.appliedEvents).toEqual([])
    expect(new Set(snapshot.nodeStates.values())).toEqual(new Set(["idle"]))
  })
})
