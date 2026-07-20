import { Data, Effect } from "effect"

export const MCP_GRAPH_SCHEMA_VERSION = "1" as const

export type McpNodeKind =
  | "client"
  | "gateway"
  | "server"
  | "tool"
  | "resource"
  | "prompt"
  | "task"
  | "app-host"
  | "app-view"
  | "app-resource"

export type McpEdgeKind = "transport" | "routes" | "exposes" | "starts" | "renders"

export interface McpGraphNode {
  readonly id: string
  readonly kind: McpNodeKind
  readonly label: string
  readonly description: string
  readonly position: {
    readonly x: number
    readonly y: number
  }
  readonly config: Readonly<Record<string, unknown>>
}

export interface McpGraphEdge {
  readonly id: string
  readonly kind: McpEdgeKind
  readonly source: string
  readonly target: string
  readonly label?: string
}

export interface McpGraphDocument {
  readonly schemaVersion: typeof MCP_GRAPH_SCHEMA_VERSION
  readonly id: string
  readonly name: string
  readonly description: string
  readonly nodes: ReadonlyArray<McpGraphNode>
  readonly edges: ReadonlyArray<McpGraphEdge>
}

export type McpGraphIssueCode =
  | "duplicate-node-id"
  | "duplicate-edge-id"
  | "unknown-edge-source"
  | "unknown-edge-target"
  | "incompatible-edge"

export interface McpGraphIssue {
  readonly code: McpGraphIssueCode
  readonly path: string
  readonly message: string
}

export class McpGraphValidationError extends Data.TaggedError("McpGraphValidationError")<{
  readonly issues: ReadonlyArray<McpGraphIssue>
}> {}

interface EdgeCompatibility {
  readonly sources: ReadonlySet<McpNodeKind>
  readonly targets: ReadonlySet<McpNodeKind>
}

const edgeCompatibility: Record<McpEdgeKind, EdgeCompatibility> = {
  transport: {
    sources: new Set(["client", "gateway"]),
    targets: new Set(["gateway", "server"]),
  },
  routes: {
    sources: new Set(["gateway"]),
    targets: new Set(["gateway", "server"]),
  },
  exposes: {
    sources: new Set(["server"]),
    targets: new Set(["tool", "resource", "prompt"]),
  },
  starts: {
    sources: new Set(["tool"]),
    targets: new Set(["task"]),
  },
  renders: {
    sources: new Set(["tool"]),
    targets: new Set(["app-resource"]),
  },
}

const duplicateValues = (values: ReadonlyArray<string>): ReadonlySet<string> => {
  const seen = new Set<string>()
  const duplicates = new Set<string>()

  for (const value of values) {
    if (seen.has(value)) duplicates.add(value)
    seen.add(value)
  }

  return duplicates
}

export const validateGraphDocument = (
  document: McpGraphDocument,
): Effect.Effect<McpGraphDocument, McpGraphValidationError> =>
  Effect.gen(function* () {
    const issues: Array<McpGraphIssue> = []
    const duplicateNodeIds = duplicateValues(document.nodes.map(node => node.id))
    const duplicateEdgeIds = duplicateValues(document.edges.map(edge => edge.id))
    const nodesById = new Map(document.nodes.map(node => [node.id, node]))

    for (const nodeId of duplicateNodeIds) {
      issues.push({
        code: "duplicate-node-id",
        path: `nodes.${nodeId}`,
        message: `Node id "${nodeId}" is used more than once`,
      })
    }

    for (const edgeId of duplicateEdgeIds) {
      issues.push({
        code: "duplicate-edge-id",
        path: `edges.${edgeId}`,
        message: `Edge id "${edgeId}" is used more than once`,
      })
    }

    for (const edge of document.edges) {
      const source = nodesById.get(edge.source)
      const target = nodesById.get(edge.target)

      if (!source) {
        issues.push({
          code: "unknown-edge-source",
          path: `edges.${edge.id}.source`,
          message: `Edge "${edge.id}" starts at unknown node "${edge.source}"`,
        })
      }

      if (!target) {
        issues.push({
          code: "unknown-edge-target",
          path: `edges.${edge.id}.target`,
          message: `Edge "${edge.id}" targets unknown node "${edge.target}"`,
        })
      }

      if (source && target) {
        const compatibility = edgeCompatibility[edge.kind]
        if (!compatibility.sources.has(source.kind) || !compatibility.targets.has(target.kind)) {
          issues.push({
            code: "incompatible-edge",
            path: `edges.${edge.id}`,
            message: `A "${edge.kind}" edge cannot connect ${source.kind} → ${target.kind}`,
          })
        }
      }
    }

    if (issues.length > 0) {
      return yield* new McpGraphValidationError({ issues })
    }

    return document
  })
