import { Effect, Either } from "effect"
import { describe, expect, it } from "vitest"
import { parseTraceDocument, serializeTraceDocument } from "./authoring/TraceDocumentIO"
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

describe("MCP trace document I/O", () => {
  it("round trips trace v2 deterministically against its exact graph revision", () => {
    const source = serializeTraceDocument(gatewayTaskScenario.trace)
    const parsed = Effect.runSync(parseTraceDocument(source, gatewayTaskScenario.graph))

    expect(parsed).toEqual(gatewayTaskScenario.trace)
    expect(serializeTraceDocument(parsed)).toBe(source)
  })

  it("round trips every graph-valid boundary reference through trace serialization and parsing", () => {
    const { graph, trace } = graphAndTraceWithBoundaryReferences(GRAPH_IDENTIFIER_MAX_LENGTH)
    const source = serializeTraceDocument(trace)
    const parsed = Effect.runSync(parseTraceDocument(source, graph))

    expect(parsed).toEqual(trace)
    expect(serializeTraceDocument(parsed)).toBe(source)
  })

  it("rejects maximum + 1 graph references during trace parsing", () => {
    const { graph, trace } = graphAndTraceWithBoundaryReferences(GRAPH_IDENTIFIER_MAX_LENGTH + 1)
    const result = Effect.runSync(
      parseTraceDocument(JSON.stringify(trace), graph).pipe(Effect.either),
    )

    expect(Either.isLeft(result)).toBe(true)
    if (Either.isLeft(result)) {
      expect(result.left).toMatchObject({ _tag: "McpTraceImportError", code: "invalid-document" })
    }
  })

  it("rejects a trace bound to stale executable graph content", () => {
    const graph = withGraphRevision({
      ...gatewayTaskScenario.graph,
      nodes: gatewayTaskScenario.graph.nodes.map(node =>
        node.id === "gateway" ? { ...node, config: { strategy: "capability" as const } } : node,
      ),
      edges: gatewayTaskScenario.graph.edges.slice(0, -1),
    })
    const result = Effect.runSync(
      parseTraceDocument(serializeTraceDocument(gatewayTaskScenario.trace), graph).pipe(
        Effect.either,
      ),
    )

    expect(Either.isLeft(result)).toBe(true)
    if (Either.isLeft(result)) {
      expect(result.left._tag).toBe("McpTraceValidationError")
      if (result.left._tag === "McpTraceValidationError") {
        expect(result.left.issues).toEqual(
          expect.arrayContaining([
            expect.objectContaining({ code: "graph-revision-mismatch", path: "graphRevision" }),
          ]),
        )
      }
    }
  })

  it("requires explicit legacy rebind and records the target revision in provenance", () => {
    const legacy = {
      schemaVersion: "1",
      id: "legacy-run",
      graphId: gatewayTaskScenario.graph.id,
      name: "Legacy run",
      events: [
        {
          id: "legacy-event",
          sequence: 0,
          atMs: 0,
          nodeId: "client",
          kind: "node.started",
          channel: "effect",
          summary: "Legacy client start",
          payload: { accessToken: "raw-legacy-token" },
        },
      ],
    }
    const source = JSON.stringify(legacy)
    const rejected = Effect.runSync(
      parseTraceDocument(source, gatewayTaskScenario.graph).pipe(Effect.either),
    )

    expect(Either.isLeft(rejected)).toBe(true)
    if (Either.isLeft(rejected)) {
      expect(rejected.left).toMatchObject({
        _tag: "McpTraceImportError",
        code: "legacy-rebind-required",
      })
    }

    const rebound = Effect.runSync(
      parseTraceDocument(source, gatewayTaskScenario.graph, { allowLegacyRebind: true }),
    )
    const reboundSource = serializeTraceDocument(rebound)

    expect(rebound).toMatchObject({
      schemaVersion: "2",
      graphId: gatewayTaskScenario.graph.id,
      graphRevision: gatewayTaskScenario.graph.revision,
      provenance: {
        migrations: [
          {
            kind: "legacy-v1-rebind",
            sourceGraphId: gatewayTaskScenario.graph.id,
            targetGraphId: gatewayTaskScenario.graph.id,
            targetGraphRevision: gatewayTaskScenario.graph.revision,
          },
        ],
      },
    })
    expect(rebound.events[0]).toMatchObject({
      kind: "runtime.started",
      family: "runtime",
      channel: "effect",
    })
    expect(reboundSource).not.toContain("raw-legacy-token")
  })

  it("reports unsupported trace schema versions distinctly", () => {
    const result = Effect.runSync(
      parseTraceDocument(
        JSON.stringify({ ...gatewayTaskScenario.trace, schemaVersion: "99" }),
        gatewayTaskScenario.graph,
      ).pipe(Effect.either),
    )

    expect(Either.isLeft(result)).toBe(true)
    if (Either.isLeft(result)) {
      expect(result.left).toMatchObject({
        _tag: "McpTraceImportError",
        code: "unsupported-schema",
      })
    }
  })

  it.each([
    ["blank trace id", { id: "   " }],
    ["control in trace id", { id: "trace\u0000id" }],
    ["overlong trace id", { id: "t".repeat(129) }],
    ["blank event id", { events: [{ ...gatewayTaskScenario.trace.events[0], id: " " }] }],
    [
      "control in correlation id",
      { events: [{ ...gatewayTaskScenario.trace.events[0], correlationId: "rpc\n17" }] },
    ],
    ["blank span id", { events: [{ ...gatewayTaskScenario.trace.events[0], spanId: "" }] }],
    [
      "overlong parent span id",
      { events: [{ ...gatewayTaskScenario.trace.events[0], parentSpanId: "s".repeat(129) }] },
    ],
    ["overlong trace label", { name: "n".repeat(513) }],
    [
      "overlong event summary",
      { events: [{ ...gatewayTaskScenario.trace.events[0], summary: "s".repeat(513) }] },
    ],
    [
      "non-string protocol method",
      { events: [{ ...gatewayTaskScenario.trace.events[0], protocol: { method: { raw: true } } }] },
    ],
  ])("rejects %s", (_label, patch) => {
    const source = JSON.stringify({ ...gatewayTaskScenario.trace, ...patch })
    const result = Effect.runSync(
      parseTraceDocument(source, gatewayTaskScenario.graph).pipe(Effect.either),
    )

    expect(Either.isLeft(result)).toBe(true)
    if (Either.isLeft(result)) {
      expect(result.left).toMatchObject({ _tag: "McpTraceImportError", code: "invalid-document" })
    }
  })
})
