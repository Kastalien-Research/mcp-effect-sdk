import { Duration, Effect, Fiber } from "effect"
import type { McpGraphDocument } from "../model/McpGraphDocument"
import type {
  McpNodeExecutionState,
  McpTraceDocument,
  McpTraceSnapshot,
} from "../model/McpTraceDocument"

export interface TraceReplayScheduler {
  readonly sleep: (delayMs: number) => Effect.Effect<void>
}

export const liveTraceReplayScheduler: TraceReplayScheduler = {
  sleep: delayMs => Effect.sleep(Duration.millis(delayMs)),
}

const initialSnapshot = (graph: McpGraphDocument): McpTraceSnapshot => ({
  status: "idle",
  cursor: -1,
  appliedEvents: [],
  nodeStates: new Map<string, McpNodeExecutionState>(graph.nodes.map(node => [node.id, "idle"])),
})

export class TraceReplay {
  private snapshot: McpTraceSnapshot
  private readonly listeners = new Set<() => void>()
  private readonly events
  private fiber: Fiber.RuntimeFiber<void, never> | null = null
  private generation = 0

  constructor(
    private readonly graph: McpGraphDocument,
    trace: McpTraceDocument,
    private readonly scheduler: TraceReplayScheduler = liveTraceReplayScheduler,
  ) {
    this.snapshot = initialSnapshot(graph)
    this.events = [...trace.events].sort((left, right) => left.sequence - right.sequence)
  }

  getSnapshot(): McpTraceSnapshot {
    return this.snapshot
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener)
    return () => {
      this.listeners.delete(listener)
    }
  }

  async run(): Promise<void> {
    if (this.snapshot.status === "running") return
    if (this.snapshot.status !== "idle") this.reset()

    const generation = ++this.generation
    this.updateSnapshot({ ...this.snapshot, status: "running" })

    const replay = Effect.gen(
      function* (this: TraceReplay) {
        let previousAtMs = 0

        for (const [cursor, event] of this.events.entries()) {
          const delayMs = Math.max(0, event.atMs - previousAtMs)
          yield* this.scheduler.sleep(delayMs)

          if (this.generation !== generation || this.snapshot.status !== "running") return
          this.applyEvent(cursor, event)
          previousAtMs = event.atMs
        }

        if (this.generation === generation && this.snapshot.status === "running") {
          this.updateSnapshot({ ...this.snapshot, status: "completed" })
        }
      }.bind(this),
    )

    const fiber = Effect.runFork(replay)
    this.fiber = fiber
    await Effect.runPromise(Fiber.await(fiber))
    if (this.fiber === fiber) this.fiber = null
  }

  cancel(): void {
    if (this.snapshot.status !== "running") return

    this.generation += 1
    const nodeKindById = new Map(this.graph.nodes.map(node => [node.id, node.kind]))
    const nodeStates = new Map(this.snapshot.nodeStates)

    for (const [nodeId, state] of nodeStates) {
      if (state === "active" || state === "waiting" || state === "input-required") {
        nodeStates.set(nodeId, nodeKindById.get(nodeId) === "task" ? "cancelled" : "interrupted")
      }
    }

    this.updateSnapshot({ ...this.snapshot, status: "cancelled", nodeStates })

    const fiber = this.fiber
    this.fiber = null
    if (fiber) Effect.runFork(Fiber.interrupt(fiber))
  }

  reset(): void {
    this.generation += 1
    const fiber = this.fiber
    this.fiber = null
    if (fiber) Effect.runFork(Fiber.interrupt(fiber))
    this.updateSnapshot(initialSnapshot(this.graph))
  }

  private applyEvent(cursor: number, event: McpTraceDocument["events"][number]): void {
    const nodeStates = new Map(this.snapshot.nodeStates)
    const nextState = stateForEvent(event.kind)
    if (nextState) nodeStates.set(event.nodeId, nextState)

    this.updateSnapshot({
      ...this.snapshot,
      cursor,
      appliedEvents: [...this.snapshot.appliedEvents, event],
      nodeStates,
    })
  }

  private updateSnapshot(snapshot: McpTraceSnapshot): void {
    this.snapshot = snapshot
    this.listeners.forEach(listener => {
      listener()
    })
  }
}

const stateForEvent = (
  kind: McpTraceDocument["events"][number]["kind"],
): McpNodeExecutionState | undefined => {
  switch (kind) {
    case "node.started":
      return "active"
    case "node.waiting":
      return "waiting"
    case "node.input-required":
      return "input-required"
    case "node.completed":
      return "completed"
    case "node.failed":
      return "failed"
    case "node.cancelled":
      return "cancelled"
    case "node.interrupted":
      return "interrupted"
    case "message.sent":
    case "message.received":
      return undefined
  }
}
