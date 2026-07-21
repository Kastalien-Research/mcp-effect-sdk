import { Duration, Effect, Fiber } from "effect"
import type { McpGraphDocument } from "../model/McpGraphDocument"
import type {
  McpNodeExecutionState,
  McpTraceDocument,
  McpTraceEvent,
  McpTraceReplayStatus,
  McpTraceSnapshot,
} from "../model/McpTraceDocument"
import { validateTraceDocument } from "../model/McpTraceDocument"
import { traceEventDefinition } from "../model/TraceRegistry"

export interface TraceReplayScheduler {
  readonly sleep: (delayMs: number) => Effect.Effect<void>
}

export const liveTraceReplayScheduler: TraceReplayScheduler = {
  sleep: delayMs => Effect.sleep(Duration.millis(delayMs)),
}

/** Detaches already-sanitized portable data; the identity map also bounds cyclic adversarial input. */
const cloneAndFreezePortableValue = (value: unknown, clones: WeakMap<object, object>): unknown => {
  if (typeof value !== "object" || value === null) return value

  const existing = clones.get(value)
  if (existing) return existing

  if (Array.isArray(value)) {
    const clone: Array<unknown> = []
    clones.set(value, clone)
    for (const child of value) clone.push(cloneAndFreezePortableValue(child, clones))
    return Object.freeze(clone)
  }

  const clone: Record<string, unknown> = {}
  clones.set(value, clone)
  for (const [key, child] of Object.entries(value)) {
    Object.defineProperty(clone, key, {
      value: cloneAndFreezePortableValue(child, clones),
      enumerable: true,
      configurable: true,
      writable: true,
    })
  }
  return Object.freeze(clone)
}

const cloneAndFreezeEvents = (
  events: ReadonlyArray<McpTraceEvent>,
): ReadonlyArray<McpTraceEvent> => {
  const clones = new WeakMap<object, object>()
  return Object.freeze(
    events.map(event => cloneAndFreezePortableValue(event, clones) as McpTraceEvent),
  )
}

export class TraceReplay {
  private snapshot: McpTraceSnapshot
  private readonly listeners = new Set<() => void>()
  private readonly events: ReadonlyArray<McpTraceEvent>
  private fiber: Fiber.RuntimeFiber<void, never> | null = null
  private generation = 0

  static make(
    graph: McpGraphDocument,
    trace: McpTraceDocument,
    scheduler: TraceReplayScheduler = liveTraceReplayScheduler,
  ) {
    return validateTraceDocument(graph, trace).pipe(
      Effect.map(validTrace => new TraceReplay(graph, validTrace, scheduler)),
    )
  }

  private constructor(
    private readonly graph: McpGraphDocument,
    trace: McpTraceDocument,
    private readonly scheduler: TraceReplayScheduler = liveTraceReplayScheduler,
  ) {
    this.events = cloneAndFreezeEvents(
      [...trace.events].sort((left, right) => left.sequence - right.sequence),
    )
    this.snapshot = this.projectSnapshot(-1, "idle")
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
    if (this.snapshot.status !== "idle") return
    await this.startRunning()
  }

  pause(): void {
    if (this.snapshot.status !== "running") return
    this.invalidateActiveRun()
    this.updateSnapshot(this.projectSnapshot(this.snapshot.cursor, "paused"))
  }

  async resume(): Promise<void> {
    if (this.snapshot.status !== "paused") return
    await this.startRunning()
  }

  step(): void {
    if (this.snapshot.status !== "idle" && this.snapshot.status !== "paused") return
    this.invalidateActiveRun()
    const nextCursor = this.snapshot.cursor + 1
    if (nextCursor >= this.events.length) {
      this.updateSnapshot(this.projectSnapshot(this.events.length - 1, "completed"))
      return
    }
    const status = nextCursor === this.events.length - 1 ? "completed" : "paused"
    this.updateSnapshot(this.projectSnapshot(nextCursor, status))
  }

  seek(cursor: number): void {
    if (!Number.isInteger(cursor) || cursor < -1 || cursor >= this.events.length) return
    this.invalidateActiveRun()
    if (cursor === -1) {
      this.updateSnapshot(this.projectSnapshot(-1, "idle"))
      return
    }
    const status = cursor === this.events.length - 1 ? "completed" : "paused"
    this.updateSnapshot(this.projectSnapshot(cursor, status))
  }

  cancel(): void {
    if (this.snapshot.status !== "running" && this.snapshot.status !== "paused") return

    this.invalidateActiveRun()
    const nodeKindById = new Map(this.graph.nodes.map(node => [node.id, node.kind]))
    const nodeStates = new Map(this.snapshot.nodeStates)

    for (const [nodeId, state] of nodeStates) {
      if (state === "active" || state === "waiting" || state === "input-required") {
        nodeStates.set(nodeId, nodeKindById.get(nodeId) === "task" ? "cancelled" : "interrupted")
      }
    }

    this.updateSnapshot({ ...this.snapshot, status: "cancelled", nodeStates })
  }

  reset(): void {
    this.invalidateActiveRun()
    this.updateSnapshot(this.projectSnapshot(-1, "idle"))
  }

  private async startRunning(): Promise<void> {
    const generation = this.invalidateActiveRun()
    if (this.events.length === 0 || this.snapshot.cursor >= this.events.length - 1) {
      this.updateSnapshot(this.projectSnapshot(this.events.length - 1, "completed"))
      return
    }
    this.updateSnapshot(this.projectSnapshot(this.snapshot.cursor, "running"))

    const replay = Effect.gen(
      function* (this: TraceReplay) {
        for (let cursor = this.snapshot.cursor + 1; cursor < this.events.length; cursor += 1) {
          if (this.generation !== generation || this.snapshot.status !== "running") return
          const event = this.events[cursor]
          if (!event) return
          const previousAtMs = cursor === 0 ? 0 : (this.events[cursor - 1]?.atMs ?? 0)
          yield* this.scheduler.sleep(Math.max(0, event.atMs - previousAtMs))

          if (this.generation !== generation || this.snapshot.status !== "running") return
          this.updateSnapshot(this.projectSnapshot(cursor, "running"))
        }

        if (this.generation === generation && this.snapshot.status === "running") {
          this.updateSnapshot(this.projectSnapshot(this.events.length - 1, "completed"))
        }
      }.bind(this),
    )

    const fiber = Effect.runFork(replay)
    this.fiber = fiber
    await Effect.runPromise(Fiber.await(fiber))
    if (this.fiber === fiber) this.fiber = null
  }

  private projectSnapshot(cursor: number, status: McpTraceReplayStatus): McpTraceSnapshot {
    const appliedEvents = this.events.slice(0, cursor + 1)
    const nodeStates = new Map<string, McpNodeExecutionState>(
      this.graph.nodes.map(node => [node.id, "idle"]),
    )

    for (const event of appliedEvents) {
      const nextState = traceEventDefinition(event.kind).nodeState
      if (nextState) nodeStates.set(event.nodeId, nextState)
    }

    return {
      status,
      cursor,
      appliedEvents,
      nodeStates,
    }
  }

  private invalidateActiveRun(): number {
    const generation = ++this.generation
    const fiber = this.fiber
    this.fiber = null
    if (fiber) Effect.runFork(Fiber.interrupt(fiber))
    return generation
  }

  private updateSnapshot(snapshot: McpTraceSnapshot): void {
    this.snapshot = snapshot
    this.listeners.forEach(listener => {
      listener()
    })
  }
}
