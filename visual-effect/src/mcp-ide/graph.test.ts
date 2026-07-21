import { Effect, Either } from "effect"
import { describe, expect, it } from "vitest"
import {
  compatibleEdgeKinds,
  type McpGraphDocument,
  type McpNodeKind,
  validateGraphDocument,
} from "./model/McpGraphDocument"
import { gatewayTaskScenario } from "./scenarios/gatewayTaskScenario"

const validate = (document: McpGraphDocument) =>
  Effect.runSync(validateGraphDocument(document).pipe(Effect.either))

describe("MCP IDE graph document", () => {
  it("accepts the versioned client, gateway, server, tool, and Task topology", () => {
    const result = validate(gatewayTaskScenario.graph)

    expect(Either.isRight(result)).toBe(true)
    if (Either.isRight(result)) {
      expect(result.right.schemaVersion).toBe("2")
      expect(result.right.revision).toMatch(/^graph-v2-[0-9a-f]{8}$/)
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
      expect(result.left.issues).toContainEqual(
        expect.objectContaining({
          code: "duplicate-node-id",
          path: "nodes.client",
          message: 'Node id "client" is used more than once',
          repair: expect.objectContaining({ actionId: "rename-node" }),
        }),
      )
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
      expect(result.left.issues).toContainEqual(
        expect.objectContaining({
          code: "unknown-edge-target",
          path: "edges.edge-missing-target.target",
          message: 'Edge "edge-missing-target" targets unknown node "missing-server"',
          repair: expect.objectContaining({ actionId: "select-edge-target" }),
        }),
      )
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
          expect.objectContaining({
            code: "duplicate-edge-id",
            path: "edges.client-gateway",
            message: 'Edge id "client-gateway" is used more than once',
            repair: expect.objectContaining({ actionId: "rename-edge" }),
          }),
          expect.objectContaining({
            code: "unknown-edge-source",
            path: "edges.edge-missing-source.source",
            message: 'Edge "edge-missing-source" starts at unknown node "missing-client"',
            repair: expect.objectContaining({ actionId: "select-edge-source" }),
          }),
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
      expect(result.left.issues).toContainEqual(
        expect.objectContaining({
          code: "incompatible-edge",
          path: "edges.edge-invalid-route",
          message: 'A "routes" edge cannot connect tool → server',
          repair: expect.objectContaining({ actionId: "reconnect-edge" }),
        }),
      )
    }
  })

  it("offers compatible edge kinds when only the relationship is invalid", () => {
    const result = validate({
      ...gatewayTaskScenario.graph,
      edges: [
        ...gatewayTaskScenario.graph.edges,
        {
          id: "edge-wrong-kind",
          kind: "exposes",
          source: "gateway",
          target: "server",
        },
      ],
    })

    expect(Either.isLeft(result)).toBe(true)
    if (Either.isLeft(result)) {
      expect(result.left.issues).toContainEqual(
        expect.objectContaining({
          code: "incompatible-edge",
          repair: {
            actionId: "change-edge-kind",
            description: "Choose a compatible edge relationship",
            alternatives: [
              { id: "transport", label: "Use Transport", value: "transport" },
              { id: "routes", label: "Use Routes", value: "routes" },
            ],
          },
        }),
      )
    }
  })

  const invalidConfigs: ReadonlyArray<{
    readonly kind: McpNodeKind
    readonly config: Readonly<Record<string, unknown>>
  }> = [
    { kind: "client", config: { transport: "websocket" } },
    { kind: "gateway", config: { strategy: "random" } },
    { kind: "server", config: { domain: "" } },
    { kind: "tool", config: { resultType: "unknown" } },
    { kind: "resource", config: { uri: "" } },
    { kind: "prompt", config: { name: "" } },
    { kind: "task", config: { pollingIntervalMs: 0 } },
    { kind: "app-resource", config: { uri: "ui://example/view" } },
    { kind: "app-view", config: { sandbox: true } },
    { kind: "app-host", config: { profile: "inferred" } },
  ]

  it.each(invalidConfigs)("rejects invalid $kind configuration with a reset repair", entry => {
    const node = gatewayTaskScenario.graph.nodes.find(candidate => candidate.kind === "tool")
    if (!node) throw new Error("fixture requires a tool")

    const result = validate({
      ...gatewayTaskScenario.graph,
      nodes: [
        ...gatewayTaskScenario.graph.nodes.filter(candidate => candidate.id !== node.id),
        {
          ...node,
          id: `invalid-${entry.kind}`,
          kind: entry.kind,
          config: entry.config,
        },
      ],
      edges: gatewayTaskScenario.graph.edges.filter(
        edge => edge.source !== node.id && edge.target !== node.id,
      ),
    } as McpGraphDocument)

    expect(Either.isLeft(result)).toBe(true)
    if (Either.isLeft(result)) {
      expect(result.left.issues).toContainEqual(
        expect.objectContaining({
          code: "invalid-node-config",
          path: `nodes.invalid-${entry.kind}.config`,
          repair: expect.objectContaining({
            actionId: "reset-node-config",
            alternatives: expect.arrayContaining([
              expect.objectContaining({ id: `${entry.kind}-defaults` }),
            ]),
          }),
        }),
      )
    }
  })

  it("defines every allowed and forbidden node pair from one compatibility contract", () => {
    const kinds: ReadonlyArray<McpNodeKind> = [
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
    ]
    const allowed = new Map<string, ReadonlyArray<string>>([
      ["client→gateway", ["transport"]],
      ["client→server", ["transport"]],
      ["gateway→gateway", ["transport", "routes"]],
      ["gateway→server", ["transport", "routes"]],
      ["server→tool", ["exposes"]],
      ["server→resource", ["exposes"]],
      ["server→prompt", ["exposes"]],
      ["server→app-resource", ["exposes"]],
      ["tool→task", ["starts"]],
      ["tool→app-resource", ["renders"]],
      ["app-resource→app-view", ["renders"]],
      ["app-host→app-view", ["hosts"]],
    ])

    for (const source of kinds) {
      for (const target of kinds) {
        expect(compatibleEdgeKinds(source, target), `${source} → ${target}`).toEqual(
          allowed.get(`${source}→${target}`) ?? [],
        )
      }
    }
  })
})
