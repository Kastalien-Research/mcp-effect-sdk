import { Effect, Either } from "effect"
import { describe, expect, it } from "vitest"
import { parseGraphDocument, serializeGraphDocument } from "./authoring/GraphDocumentIO"
import type { McpGraphDocument } from "./model/McpGraphDocument"
import { gatewayTaskScenario } from "./scenarios/gatewayTaskScenario"

describe("MCP IDE graph document I/O", () => {
  it("round-trips the versioned graph without losing authored data", () => {
    const encoded = serializeGraphDocument(gatewayTaskScenario.graph)
    const decoded = Effect.runSync(parseGraphDocument(encoded).pipe(Effect.either))

    expect(Either.isRight(decoded)).toBe(true)
    if (Either.isRight(decoded)) expect(decoded.right).toEqual(gatewayTaskScenario.graph)
  })

  it("distinguishes malformed JSON from unsupported graph documents", () => {
    const malformed = Effect.runSync(parseGraphDocument("{").pipe(Effect.either))
    expect(Either.isLeft(malformed)).toBe(true)
    if (Either.isLeft(malformed)) expect(malformed.left).toMatchObject({ code: "invalid-json" })

    const unsupported = Effect.runSync(
      parseGraphDocument(JSON.stringify({ schemaVersion: "99" })).pipe(Effect.either),
    )
    expect(Either.isLeft(unsupported)).toBe(true)
    if (Either.isLeft(unsupported)) {
      expect(unsupported.left).toMatchObject({ code: "unsupported-schema" })
    }
  })

  it("migrates schema v1 into a revisioned v2 document", () => {
    const { revision: _revision, ...current } = gatewayTaskScenario.graph as McpGraphDocument & {
      readonly revision?: string
    }
    const legacy = { ...current, schemaVersion: "1" }
    const result = Effect.runSync(parseGraphDocument(JSON.stringify(legacy)).pipe(Effect.either))

    expect(Either.isRight(result)).toBe(true)
    if (Either.isRight(result)) {
      expect(result.right.schemaVersion).toBe("2")
      expect(result.right.revision).toMatch(/^graph-v2-[0-9a-f]{8}$/)
    }
  })

  it("rejects a v2 document whose stored revision does not match executable content", () => {
    const result = Effect.runSync(
      parseGraphDocument(
        JSON.stringify({ ...gatewayTaskScenario.graph, revision: "graph-v2-00000000" }),
      ).pipe(Effect.either),
    )

    expect(Either.isLeft(result)).toBe(true)
    if (Either.isLeft(result) && result.left._tag === "McpGraphValidationError") {
      expect(result.left.issues).toContainEqual(
        expect.objectContaining({
          code: "revision-mismatch",
          path: "revision",
          repair: expect.objectContaining({ actionId: "refresh-revision" }),
        }),
      )
    }
  })

  it("adds explicit stable profiles while migrating v1 Apps nodes", () => {
    const legacy = {
      schemaVersion: "1",
      id: "apps",
      name: "Apps",
      description: "Legacy Apps graph",
      nodes: [
        {
          id: "resource",
          kind: "app-resource",
          label: "Resource",
          description: "UI resource",
          position: { x: 0, y: 0 },
          config: { uri: "ui://example/view" },
        },
        {
          id: "view",
          kind: "app-view",
          label: "View",
          description: "Sandboxed view",
          position: { x: 200, y: 0 },
          config: { sandbox: true },
        },
      ],
      edges: [{ id: "resource-view", kind: "renders", source: "resource", target: "view" }],
    }
    const result = Effect.runSync(parseGraphDocument(JSON.stringify(legacy)).pipe(Effect.either))

    expect(Either.isRight(result)).toBe(true)
    if (Either.isRight(result)) {
      expect(result.right.nodes.map(node => node.config)).toEqual([
        { uri: "ui://example/view", profile: "stable" },
        { sandbox: true, profile: "stable" },
      ])
    }
  })

  it("runs imported documents through protocol-aware graph validation", () => {
    const invalid = {
      ...gatewayTaskScenario.graph,
      edges: [
        ...gatewayTaskScenario.graph.edges,
        { id: "invalid", kind: "routes", source: "task", target: "client" },
      ],
    }
    const result = Effect.runSync(parseGraphDocument(JSON.stringify(invalid)).pipe(Effect.either))

    expect(Either.isLeft(result)).toBe(true)
    if (Either.isLeft(result)) expect(result.left._tag).toBe("McpGraphValidationError")
  })

  it.each([
    {
      label: "graph id",
      code: "invalid-graph-id",
      actionId: "change-graph-id",
      document: { ...gatewayTaskScenario.graph, id: " field-research-gateway " },
    },
    {
      label: "node id",
      code: "invalid-node-id",
      actionId: "rename-node",
      document: {
        ...gatewayTaskScenario.graph,
        nodes: gatewayTaskScenario.graph.nodes.map(node =>
          node.id === "client" ? { ...node, id: " client " } : node,
        ),
      },
    },
    {
      label: "edge id",
      code: "invalid-edge-id",
      actionId: "rename-edge",
      document: {
        ...gatewayTaskScenario.graph,
        edges: gatewayTaskScenario.graph.edges.map(edge =>
          edge.id === "client-gateway" ? { ...edge, id: " " } : edge,
        ),
      },
    },
    {
      label: "edge source",
      code: "invalid-edge-source",
      actionId: "select-edge-source",
      document: {
        ...gatewayTaskScenario.graph,
        edges: gatewayTaskScenario.graph.edges.map(edge =>
          edge.id === "client-gateway" ? { ...edge, source: " client " } : edge,
        ),
      },
    },
    {
      label: "edge target",
      code: "invalid-edge-target",
      actionId: "select-edge-target",
      document: {
        ...gatewayTaskScenario.graph,
        edges: gatewayTaskScenario.graph.edges.map(edge =>
          edge.id === "client-gateway" ? { ...edge, target: " " } : edge,
        ),
      },
    },
  ])("rejects a non-trimmed or empty $label at import", entry => {
    const result = Effect.runSync(
      parseGraphDocument(JSON.stringify(entry.document)).pipe(Effect.either),
    )

    expect(Either.isLeft(result)).toBe(true)
    if (Either.isLeft(result)) {
      expect(result.left._tag).toBe("McpGraphValidationError")
      if (result.left._tag === "McpGraphValidationError") {
        expect(result.left.issues).toContainEqual(
          expect.objectContaining({
            code: entry.code,
            repair: expect.objectContaining({ actionId: entry.actionId }),
          }),
        )
      }
    }
  })

  it("rejects duplicate executable edges during import", () => {
    const result = Effect.runSync(
      parseGraphDocument(
        JSON.stringify({
          ...gatewayTaskScenario.graph,
          edges: [
            ...gatewayTaskScenario.graph.edges,
            {
              id: "client-gateway-copy",
              kind: "transport",
              source: "client",
              target: "gateway",
            },
          ],
        }),
      ).pipe(Effect.either),
    )

    expect(Either.isLeft(result)).toBe(true)
    if (Either.isLeft(result) && result.left._tag === "McpGraphValidationError") {
      expect(result.left.issues).toContainEqual(
        expect.objectContaining({ code: "duplicate-executable-edge" }),
      )
    }
  })
})
