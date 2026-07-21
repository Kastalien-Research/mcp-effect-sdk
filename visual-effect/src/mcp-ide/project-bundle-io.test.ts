import { Effect, Either } from "effect"
import { describe, expect, it } from "vitest"
import { parseProjectBundle, serializeProjectBundle } from "./authoring/McpProjectBundleIO"
import { withGraphRevision } from "./model/GraphFingerprint"
import { gatewayTaskScenario } from "./scenarios/gatewayTaskScenario"

describe("MCP graph and trace bundle I/O", () => {
  it("round trips a deterministic versioned graph and trace bundle", () => {
    const bundle = {
      schemaVersion: "1" as const,
      kind: "mcp-project-bundle" as const,
      graph: gatewayTaskScenario.graph,
      trace: gatewayTaskScenario.trace,
    }
    const source = serializeProjectBundle(bundle)
    const parsed = Effect.runSync(parseProjectBundle(source))

    expect(parsed).toEqual(bundle)
    expect(serializeProjectBundle(parsed)).toBe(source)
    expect(source).not.toMatch(/\/Users\/|\/private\/tmp|createdAt|exportedAt/)
  })

  it("accepts a graph-only bundle", () => {
    const bundle = {
      schemaVersion: "1" as const,
      kind: "mcp-project-bundle" as const,
      graph: gatewayTaskScenario.graph,
    }

    expect(Effect.runSync(parseProjectBundle(serializeProjectBundle(bundle)))).toEqual(bundle)
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
    const exported = serializeProjectBundle(parsed)

    expect(JSON.stringify(parsed)).not.toContain("bundle-secret")
    expect(exported).not.toContain("bundle-secret")
    expect(parsed.trace?.provenance.redactions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          eventId: "event-01",
          path: "events.event-01.payload.clientSecret",
          reason: "sensitive-key",
        }),
      ]),
    )
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
