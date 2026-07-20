import { Effect, Either } from "effect"
import { describe, expect, it } from "vitest"
import { gatewayTaskScenario } from "./scenarios/gatewayTaskScenario"
import {
  type McpGraphDocument,
  validateGraphDocument,
} from "./model/McpGraphDocument"

const validate = (document: McpGraphDocument) =>
  Effect.runSync(validateGraphDocument(document).pipe(Effect.either))

describe("MCP IDE graph document", () => {
  it("accepts the versioned client, gateway, server, tool, and Task topology", () => {
    const result = validate(gatewayTaskScenario.graph)

    expect(Either.isRight(result)).toBe(true)
    if (Either.isRight(result)) {
      expect(result.right.schemaVersion).toBe("1")
      expect(result.right.nodes.map(node => node.kind)).toEqual([
        "client",
        "gateway",
        "server",
        "tool",
        "task",
      ])
    }
  })

  it("reports duplicate node identifiers", () => {
    const [client] = gatewayTaskScenario.graph.nodes
    if (!client) throw new Error("fixture requires a client")

    const result = validate({
      ...gatewayTaskScenario.graph,
      nodes: [...gatewayTaskScenario.graph.nodes, { ...client }],
    })

    expect(Either.isLeft(result)).toBe(true)
    if (Either.isLeft(result)) {
      expect(result.left.issues).toContainEqual({
        code: "duplicate-node-id",
        path: "nodes.client",
        message: 'Node id "client" is used more than once',
      })
    }
  })

  it("reports edges that reference nodes outside the document", () => {
    const result = validate({
      ...gatewayTaskScenario.graph,
      edges: [
        ...gatewayTaskScenario.graph.edges,
        {
          id: "edge-missing-target",
          kind: "routes",
          source: "gateway",
          target: "missing-server",
        },
      ],
    })

    expect(Either.isLeft(result)).toBe(true)
    if (Either.isLeft(result)) {
      expect(result.left.issues).toContainEqual({
        code: "unknown-edge-target",
        path: "edges.edge-missing-target.target",
        message: 'Edge "edge-missing-target" targets unknown node "missing-server"',
      })
    }
  })

  it("reports duplicate edge identifiers and unknown sources together", () => {
    const [firstEdge] = gatewayTaskScenario.graph.edges
    if (!firstEdge) throw new Error("fixture requires an edge")

    const result = validate({
      ...gatewayTaskScenario.graph,
      edges: [
        ...gatewayTaskScenario.graph.edges,
        { ...firstEdge },
        {
          id: "edge-missing-source",
          kind: "transport",
          source: "missing-client",
          target: "gateway",
        },
      ],
    })

    expect(Either.isLeft(result)).toBe(true)
    if (Either.isLeft(result)) {
      expect(result.left.issues).toEqual(
        expect.arrayContaining([
          {
            code: "duplicate-edge-id",
            path: "edges.client-gateway",
            message: 'Edge id "client-gateway" is used more than once',
          },
          {
            code: "unknown-edge-source",
            path: "edges.edge-missing-source.source",
            message: 'Edge "edge-missing-source" starts at unknown node "missing-client"',
          },
        ]),
      )
    }
  })

  it("rejects wiring whose node roles are incompatible with its edge kind", () => {
    const result = validate({
      ...gatewayTaskScenario.graph,
      edges: [
        ...gatewayTaskScenario.graph.edges,
        {
          id: "edge-invalid-route",
          kind: "routes",
          source: "tool",
          target: "server",
        },
      ],
    })

    expect(Either.isLeft(result)).toBe(true)
    if (Either.isLeft(result)) {
      expect(result.left.issues).toContainEqual({
        code: "incompatible-edge",
        path: "edges.edge-invalid-route",
        message: 'A "routes" edge cannot connect tool → server',
      })
    }
  })
})
