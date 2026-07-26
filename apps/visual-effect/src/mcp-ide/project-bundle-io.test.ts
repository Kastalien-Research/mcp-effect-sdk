import { Effect, Either } from "effect"
import { describe, expect, it } from "vitest"
import {
  makeProjectBundle,
  parseProjectBundle,
  serializeProjectBundle,
} from "./authoring/McpProjectBundleIO"
import { withGraphRevision } from "./model/GraphFingerprint"
import { GRAPH_IDENTIFIER_MAX_LENGTH, type McpGraphDocument } from "./model/McpGraphDocument"
import type { McpTraceDocument } from "./model/McpTraceDocument"
import { gatewayTaskScenario } from "./scenarios/gatewayTaskScenario"

const graphAndTraceWithBoundaryReferences = (
  length: number,
): { readonly graph: McpGraphDocument; readonly trace: McpTraceDocument } => {
  const graphId = "g".repeat(length)
  const nodeId = "n".repeat(length)
  const edgeId = "e".repeat(length)
  const graph = withGraphRevision({
    ...gatewayTaskScenario.graph,
    id: graphId,
    nodes: gatewayTaskScenario.graph.nodes.map(node =>
      node.id === "client" ? { ...node, id: nodeId } : node,
    ),
    edges: gatewayTaskScenario.graph.edges.map(edge => ({
      ...edge,
      id: edge.id === "client-gateway" ? edgeId : edge.id,
      source: edge.source === "client" ? nodeId : edge.source,
      target: edge.target,
    })),
  })
  return {
    graph,
    trace: {
      ...gatewayTaskScenario.trace,
      graphId,
      graphRevision: graph.revision,
      events: (
        gatewayTaskScenario.trace.events as ReadonlyArray<McpTraceDocument["events"][number]>
      ).map(event => ({
        ...event,
        nodeId: event.nodeId === "client" ? nodeId : event.nodeId,
        ...(event.edgeId === "client-gateway" ? { edgeId } : {}),
      })),
    },
  }
}

describe("MCP graph and trace bundle I/O", () => {
  it("round trips a deterministic versioned graph and trace bundle", () => {
    const bundle = {
      schemaVersion: "1" as const,
      kind: "mcp-project-bundle" as const,
      graph: gatewayTaskScenario.graph,
      trace: gatewayTaskScenario.trace,
    }
    const source = Effect.runSync(serializeProjectBundle(bundle))
    const parsed = Effect.runSync(parseProjectBundle(source))

    expect(parsed).toEqual(bundle)
    expect(Effect.runSync(serializeProjectBundle(parsed))).toBe(source)
    expect(source).not.toMatch(/\/Users\/|\/private\/tmp|createdAt|exportedAt/)
  })

  it("round trips a bundle whose graph-owned references are at the shared maximum", () => {
    const { graph, trace } = graphAndTraceWithBoundaryReferences(GRAPH_IDENTIFIER_MAX_LENGTH)
    const source = Effect.runSync(
      serializeProjectBundle({
        schemaVersion: "1",
        kind: "mcp-project-bundle",
        graph,
        trace,
      }),
    )
    const parsed = Effect.runSync(parseProjectBundle(source))

    expect(parsed).toEqual({
      schemaVersion: "1",
      kind: "mcp-project-bundle",
      graph,
      trace,
    })
  })

  it("rejects a bundle whose graph-owned references exceed the shared maximum", () => {
    const { graph, trace } = graphAndTraceWithBoundaryReferences(GRAPH_IDENTIFIER_MAX_LENGTH + 1)
    const result = Effect.runSync(
      serializeProjectBundle({
        schemaVersion: "1",
        kind: "mcp-project-bundle",
        graph,
        trace,
      }).pipe(Effect.either),
    )

    expect(Either.isLeft(result)).toBe(true)
    if (Either.isLeft(result)) expect(result.left._tag).toBe("McpGraphValidationError")
  })

  it("accepts a graph-only bundle", () => {
    const bundle = {
      schemaVersion: "1" as const,
      kind: "mcp-project-bundle" as const,
      graph: gatewayTaskScenario.graph,
    }

    const source = Effect.runSync(serializeProjectBundle(bundle))
    expect(Effect.runSync(parseProjectBundle(source))).toEqual(bundle)
  })

  it("validates a bundled trace against that bundle's exact graph", () => {
    const changedGraph = withGraphRevision({
      ...gatewayTaskScenario.graph,
      edges: gatewayTaskScenario.graph.edges.slice(0, -1),
    })
    const source = JSON.stringify({
      schemaVersion: "1",
      kind: "mcp-project-bundle",
      graph: changedGraph,
      trace: gatewayTaskScenario.trace,
    })
    const result = Effect.runSync(parseProjectBundle(source).pipe(Effect.either))

    expect(Either.isLeft(result)).toBe(true)
    if (Either.isLeft(result)) {
      expect(result.left._tag).toBe("McpTraceValidationError")
    }
  })

  it("defensively redacts imported and exported bundled traces", () => {
    const source = JSON.stringify({
      schemaVersion: "1",
      kind: "mcp-project-bundle",
      graph: gatewayTaskScenario.graph,
      trace: {
        ...gatewayTaskScenario.trace,
        events: gatewayTaskScenario.trace.events.map((event, index) =>
          index === 0 ? { ...event, payload: { clientSecret: "bundle-secret" } } : event,
        ),
      },
    })
    const parsed = Effect.runSync(parseProjectBundle(source))
    const exported = Effect.runSync(serializeProjectBundle(parsed))

    expect(JSON.stringify(parsed)).not.toContain("bundle-secret")
    expect(exported).not.toContain("bundle-secret")
    expect(parsed.trace?.provenance.redactions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          eventId: "event-01",
          path: "/events/0/payload/clientSecret",
          reason: "sensitive-key",
        }),
      ]),
    )
  })

  it("rejects constructing or serializing a bundle with a stale trace", () => {
    const changedGraph = withGraphRevision({
      ...gatewayTaskScenario.graph,
      edges: gatewayTaskScenario.graph.edges.slice(0, -1),
    })
    const candidate = {
      schemaVersion: "1" as const,
      kind: "mcp-project-bundle" as const,
      graph: changedGraph,
      trace: gatewayTaskScenario.trace,
    }

    const construction = Effect.runSync(
      makeProjectBundle(changedGraph, gatewayTaskScenario.trace).pipe(Effect.either),
    )
    const serialization = Effect.runSync(serializeProjectBundle(candidate).pipe(Effect.either))

    expect(Either.isLeft(construction)).toBe(true)
    if (Either.isLeft(construction)) expect(construction.left._tag).toBe("McpTraceValidationError")
    expect(Either.isLeft(serialization)).toBe(true)
    if (Either.isLeft(serialization))
      expect(serialization.left._tag).toBe("McpTraceValidationError")
  })

  it("reconstructs graph contract fields so type-cast extras cannot export", () => {
    const rawSecret = "graph-extra-secret"
    const graph = {
      ...gatewayTaskScenario.graph,
      debug: { token: rawSecret },
      nodes: gatewayTaskScenario.graph.nodes.map((node, index) =>
        index === 0 ? { ...node, debug: { token: rawSecret } } : node,
      ),
    } as unknown as typeof gatewayTaskScenario.graph
    const source = Effect.runSync(
      serializeProjectBundle({
        schemaVersion: "1",
        kind: "mcp-project-bundle",
        graph,
      }),
    )

    expect(source).not.toContain(rawSecret)
    expect(source).not.toContain('"debug"')
    expect(Effect.runSync(parseProjectBundle(source)).graph).toEqual(gatewayTaskScenario.graph)
  })

  it("rejects unsupported bundle schema versions", () => {
    const result = Effect.runSync(
      parseProjectBundle(
        JSON.stringify({
          schemaVersion: "2",
          kind: "mcp-project-bundle",
          graph: gatewayTaskScenario.graph,
        }),
      ).pipe(Effect.either),
    )

    expect(Either.isLeft(result)).toBe(true)
    if (Either.isLeft(result)) {
      expect(result.left).toMatchObject({
        _tag: "McpProjectBundleImportError",
        code: "unsupported-schema",
      })
    }
  })
})
