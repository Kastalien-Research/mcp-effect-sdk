import { Effect, Either } from "effect"
import { describe, expect, it } from "vitest"
import {
  applyGraphCommand,
  createGraphHistory,
  createPaletteNode,
  executeGraphCommand,
  inferEdgeKind,
  redoGraphHistory,
  undoGraphHistory,
} from "./authoring/GraphCommands"
import type { McpGraphDocument } from "./model/McpGraphDocument"
import { gatewayTaskScenario } from "./scenarios/gatewayTaskScenario"

const apply = (graph: McpGraphDocument, command: Parameters<typeof applyGraphCommand>[1]) =>
  Effect.runSync(applyGraphCommand(graph, command).pipe(Effect.either))

describe("MCP IDE graph commands", () => {
  it("adds, moves, and configures nodes as immutable graph documents", () => {
    const resource = createPaletteNode(gatewayTaskScenario.graph, "resource", { x: 520, y: 240 })
    const added = apply(gatewayTaskScenario.graph, { type: "node.add", node: resource })
    expect(Either.isRight(added)).toBe(true)
    if (Either.isLeft(added)) return

    const moved = apply(added.right, {
      type: "node.move",
      nodeId: resource.id,
      position: { x: 560, y: 220 },
    })
    expect(Either.isRight(moved)).toBe(true)
    if (Either.isLeft(moved)) return

    const configured = apply(moved.right, {
      type: "node.update",
      nodeId: resource.id,
      patch: {
        label: "Site observations",
        description: "Read the latest observations",
        config: { uri: "field://observations" },
      },
    })
    expect(Either.isRight(configured)).toBe(true)
    if (Either.isLeft(configured)) return

    expect(configured.right).not.toBe(gatewayTaskScenario.graph)
    expect(configured.right.nodes.find(node => node.id === resource.id)).toMatchObject({
      label: "Site observations",
      description: "Read the latest observations",
      position: { x: 560, y: 220 },
      config: { uri: "field://observations" },
    })
    expect(gatewayTaskScenario.graph.nodes).toHaveLength(5)
  })

  it("rejects incompatible typed connections without returning a candidate graph", () => {
    const result = apply(gatewayTaskScenario.graph, {
      type: "edge.connect",
      edge: {
        id: "tool-server",
        kind: "routes",
        source: "tool",
        target: "server",
      },
    })

    expect(Either.isLeft(result)).toBe(true)
    if (Either.isRight(result)) return
    expect(result.left._tag).toBe("McpGraphValidationError")
    if (result.left._tag === "McpGraphValidationError") {
      expect(result.left.issues[0]?.message).toBe('A "routes" edge cannot connect tool → server')
    }
  })

  it("duplicates a node and removes nodes with their incident edges atomically", () => {
    const duplicated = apply(gatewayTaskScenario.graph, {
      type: "node.duplicate",
      nodeId: "tool",
      duplicateId: "tool-copy",
      position: { x: 700, y: 210 },
    })
    expect(Either.isRight(duplicated)).toBe(true)
    if (Either.isLeft(duplicated)) return

    expect(duplicated.right.nodes.find(node => node.id === "tool-copy")).toMatchObject({
      kind: "tool",
      label: "research.site copy",
      position: { x: 700, y: 210 },
    })

    const removed = apply(duplicated.right, { type: "node.remove", nodeId: "tool" })
    expect(Either.isRight(removed)).toBe(true)
    if (Either.isLeft(removed)) return

    expect(removed.right.nodes.some(node => node.id === "tool")).toBe(false)
    expect(removed.right.edges.some(edge => edge.source === "tool" || edge.target === "tool")).toBe(
      false,
    )
    expect(removed.right.nodes.some(node => node.id === "tool-copy")).toBe(true)
  })

  it("undoes and redoes exact documents and clears redo after a new command", () => {
    const initial = createGraphHistory(gatewayTaskScenario.graph)
    const added = Effect.runSync(
      executeGraphCommand(initial, {
        type: "node.add",
        node: createPaletteNode(initial.present, "prompt", { x: 520, y: 250 }),
      }),
    )
    const moved = Effect.runSync(
      executeGraphCommand(added, {
        type: "node.move",
        nodeId: "prompt",
        position: { x: 600, y: 250 },
      }),
    )

    const undone = undoGraphHistory(moved)
    expect(undone.present).toEqual(added.present)
    expect(undone.future).toHaveLength(1)

    const redone = redoGraphHistory(undone)
    expect(redone.present).toEqual(moved.present)

    const branched = Effect.runSync(
      executeGraphCommand(undone, {
        type: "node.update",
        nodeId: "prompt",
        patch: { label: "Research prompt" },
      }),
    )
    expect(branched.future).toEqual([])
  })

  it("creates collision-free palette identifiers and infers valid edge kinds", () => {
    const first = createPaletteNode(gatewayTaskScenario.graph, "resource", { x: 0, y: 0 })
    const withFirst = {
      ...gatewayTaskScenario.graph,
      nodes: [...gatewayTaskScenario.graph.nodes, first],
    }
    const second = createPaletteNode(withFirst, "resource", { x: 0, y: 0 })

    expect(first.id).toBe("resource")
    expect(second.id).toBe("resource-2")
    expect(inferEdgeKind("server", "resource")).toBe("exposes")
    expect(inferEdgeKind("tool", "task")).toBe("starts")
    expect(inferEdgeKind("task", "client")).toBeUndefined()
  })
})
