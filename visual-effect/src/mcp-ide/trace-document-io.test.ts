import { Effect, Either } from "effect"
import { describe, expect, it } from "vitest"
import { parseTraceDocument, serializeTraceDocument } from "./authoring/TraceDocumentIO"
import { withGraphRevision } from "./model/GraphFingerprint"
import { gatewayTaskScenario } from "./scenarios/gatewayTaskScenario"

describe("MCP trace document I/O", () => {
  it("round trips trace v2 deterministically against its exact graph revision", () => {
    const source = serializeTraceDocument(gatewayTaskScenario.trace)
    const parsed = Effect.runSync(parseTraceDocument(source, gatewayTaskScenario.graph))

    expect(parsed).toEqual(gatewayTaskScenario.trace)
    expect(serializeTraceDocument(parsed)).toBe(source)
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
})
