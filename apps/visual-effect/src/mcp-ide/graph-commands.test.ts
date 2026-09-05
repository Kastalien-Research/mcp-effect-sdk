import { Effect, Result } from "effect"
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
  Effect.runSync(applyGraphCommand(graph, command).pipe(Effect.result))

const revisionOf = (graph: McpGraphDocument): unknown =>
  (graph as McpGraphDocument & { readonly revision?: unknown }).revision

describe("MCP IDE graph commands", () => {
  it("adds, moves, and configures nodes as immutable graph documents", () => {
    const resource = createPaletteNode(gatewayTaskScenario.graph, "resource", { x: 520, y: 240 })
    const added = apply(gatewayTaskScenario.graph, { type: "node.add", node: resource })
    expect(Result.isSuccess(added)).toBe(true)
    if (Result.isFailure(added)) return

    const moved = apply(added.success, {
      type: "node.move",
      nodeId: resource.id,
      position: { x: 560, y: 220 },
    })
    expect(Result.isSuccess(moved)).toBe(true)
    if (Result.isFailure(moved)) return

    const configured = apply(moved.success, {
      type: "node.update",
      nodeId: resource.id,
      patch: {
        label: "Site observations",
        description: "Read the latest observations",
        config: { uri: "field://observations" },
      },
    })
    expect(Result.isSuccess(configured)).toBe(true)
    if (Result.isFailure(configured)) return

    expect(configured.success).not.toBe(gatewayTaskScenario.graph)
    expect(configured.success.nodes.find(node => node.id === resource.id)).toMatchObject({
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

    expect(Result.isFailure(result)).toBe(true)
    if (Result.isSuccess(result)) return
    expect(result.failure._tag).toBe("McpGraphValidationError")
    if (result.failure._tag === "McpGraphValidationError") {
      expect(result.failure.issues[0]?.message).toBe('A "routes" edge cannot connect tool → server')
    }
  })

  it("duplicates a node and removes nodes with their incident edges atomically", () => {
    const duplicated = apply(gatewayTaskScenario.graph, {
      type: "node.duplicate",
      nodeId: "tool",
      duplicateId: "tool-copy",
      position: { x: 700, y: 210 },
    })
    expect(Result.isSuccess(duplicated)).toBe(true)
    if (Result.isFailure(duplicated)) return

    expect(duplicated.success.nodes.find(node => node.id === "tool-copy")).toMatchObject({
      kind: "tool",
      label: "research.site copy",
      position: { x: 700, y: 210 },
    })

    const removed = apply(duplicated.success, { type: "node.remove", nodeId: "tool" })
    expect(Result.isSuccess(removed)).toBe(true)
    if (Result.isFailure(removed)) return

    expect(removed.success.nodes.some(node => node.id === "tool")).toBe(false)
    expect(
      removed.success.edges.some(edge => edge.source === "tool" || edge.target === "tool"),
    ).toBe(false)
    expect(removed.success.nodes.some(node => node.id === "tool-copy")).toBe(true)
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
    expect(inferEdgeKind("server", "app-resource")).toBe("exposes")
    expect(inferEdgeKind("tool", "app-resource")).toBe("renders")
    expect(inferEdgeKind("app-resource", "app-view")).toBe("renders")
    expect(inferEdgeKind("app-host", "app-view")).toBe("hosts")
    expect(inferEdgeKind("task", "client")).toBeUndefined()
  })

  it("creates valid typed defaults for every node kind with explicit Apps profiles", () => {
    const kinds = [
      "client",
      "gateway",
      "server",
      "tool",
      "resource",
      "prompt",
      "task",
      "app-resource",
      "app-view",
      "app-host",
    ] as const

    for (const kind of kinds) {
      const node = createPaletteNode(gatewayTaskScenario.graph, kind, { x: 0, y: 0 })
      const result = apply(gatewayTaskScenario.graph, { type: "node.add", node })
      expect(Result.isSuccess(result), kind).toBe(true)
      if (kind.startsWith("app-")) {
        expect(node.config).toMatchObject({ profile: "stable" })
      }
    }
  })

  it("keeps revision stable for layout and display edits but changes it for execution config", () => {
    const initialRevision = revisionOf(gatewayTaskScenario.graph)
    expect(initialRevision).toMatch(/^graph-v2-[0-9a-f]{8}$/)

    const moved = apply(gatewayTaskScenario.graph, {
      type: "node.move",
      nodeId: "tool",
      position: { x: 900, y: 400 },
    })
    expect(Result.isSuccess(moved)).toBe(true)
    if (Result.isFailure(moved)) return
    expect(revisionOf(moved.success)).toBe(initialRevision)

    const relabeled = apply(moved.success, {
      type: "node.update",
      nodeId: "tool",
      patch: { label: "Renamed tool", description: "Display-only copy" },
    })
    expect(Result.isSuccess(relabeled)).toBe(true)
    if (Result.isFailure(relabeled)) return
    expect(revisionOf(relabeled.success)).toBe(initialRevision)

    const configured = apply(relabeled.success, {
      type: "node.update",
      nodeId: "tool",
      patch: { config: { resultType: "content" } },
    })
    expect(Result.isSuccess(configured)).toBe(true)
    if (Result.isFailure(configured)) return
    expect(revisionOf(configured.success)).not.toBe(initialRevision)
  })

  it("rejects an invalid configuration without advancing history", () => {
    const history = createGraphHistory(gatewayTaskScenario.graph)
    const result = Effect.runSync(
      executeGraphCommand(history, {
        type: "node.update",
        nodeId: "task",
        patch: { config: { pollingIntervalMs: -1 } },
      }).pipe(Effect.result),
    )

    expect(Result.isFailure(result)).toBe(true)
    if (Result.isFailure(result) && result.failure._tag === "McpGraphValidationError") {
      expect(result.failure.issues).toContainEqual(
        expect.objectContaining({
          code: "invalid-node-config",
          repair: expect.objectContaining({ actionId: "reset-node-config" }),
        }),
      )
    }
    expect(history.present).toBe(gatewayTaskScenario.graph)
  })

  it("rejects whitespace node and edge identities with rename repairs", () => {
    const invalidNode = createPaletteNode(gatewayTaskScenario.graph, "prompt", { x: 0, y: 0 })
    const nodeResult = apply(gatewayTaskScenario.graph, {
      type: "node.add",
      node: { ...invalidNode, id: " prompt " },
    })

    expect(Result.isFailure(nodeResult)).toBe(true)
    if (Result.isFailure(nodeResult) && nodeResult.failure._tag === "McpGraphValidationError") {
      expect(nodeResult.failure.issues).toContainEqual(
        expect.objectContaining({
          code: "invalid-node-id",
          repair: expect.objectContaining({
            actionId: "rename-node",
            alternatives: expect.arrayContaining([expect.objectContaining({ value: "prompt" })]),
          }),
        }),
      )
    }

    const edgeResult = apply(gatewayTaskScenario.graph, {
      type: "edge.connect",
      edge: { id: " ", kind: "transport", source: "client", target: "server" },
    })

    expect(Result.isFailure(edgeResult)).toBe(true)
    if (Result.isFailure(edgeResult) && edgeResult.failure._tag === "McpGraphValidationError") {
      expect(edgeResult.failure.issues).toContainEqual(
        expect.objectContaining({
          code: "invalid-edge-id",
          repair: expect.objectContaining({ actionId: "rename-edge" }),
        }),
      )
    }
  })

  it("rejects a duplicate executable edge with remove-or-rewire guidance", () => {
    const result = apply(gatewayTaskScenario.graph, {
      type: "edge.connect",
      edge: {
        id: "client-gateway-again",
        kind: "transport",
        source: "client",
        target: "gateway",
      },
    })

    expect(Result.isFailure(result)).toBe(true)
    if (Result.isFailure(result) && result.failure._tag === "McpGraphValidationError") {
      expect(result.failure.issues).toContainEqual(
        expect.objectContaining({
          code: "duplicate-executable-edge",
          path: "edges.client-gateway-again",
          repair: expect.objectContaining({
            actionId: "remove-or-rewire-edge",
            alternatives: expect.arrayContaining([
              expect.objectContaining({ id: "remove-client-gateway-again" }),
              expect.objectContaining({ id: "rewire-client-gateway-again" }),
            ]),
          }),
        }),
      )
    }
  })
})
