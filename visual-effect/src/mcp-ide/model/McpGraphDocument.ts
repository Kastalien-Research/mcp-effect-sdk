import { Data, Effect, Either } from "effect"
import { graphExecutionFingerprint } from "./GraphFingerprint"
import {
  compatibleEdgeKinds,
  decodeNodeConfig,
  defaultNodePresentation,
  formatNodeConfigError,
  GRAPH_EDGE_KINDS,
  GRAPH_NODE_KINDS,
  graphEdgeRegistry,
  graphNodeDefinition,
  graphNodePorts,
  inferCompatibleEdgeKind,
  isCompatibleEdge,
  type McpAppsProfile,
  type McpEdgeKind,
  McpEdgeKindSchema,
  type McpGraphEdge,
  type McpGraphNode,
  type McpGraphNodeFields,
  type McpNodeConfig,
  type McpNodeKind,
  McpNodeKindSchema,
} from "./GraphRegistry"

export {
  compatibleEdgeKinds,
  defaultNodePresentation,
  GRAPH_EDGE_KINDS,
  GRAPH_NODE_KINDS,
  graphEdgeRegistry,
  graphNodeDefinition,
  graphNodePorts,
  inferCompatibleEdgeKind,
  isCompatibleEdge,
  McpEdgeKindSchema,
  McpNodeKindSchema,
}
export type {
  McpAppsProfile,
  McpEdgeKind,
  McpGraphEdge,
  McpGraphNode,
  McpGraphNodeFields,
  McpNodeConfig,
  McpNodeKind,
}

export const MCP_GRAPH_SCHEMA_VERSION = "2" as const

export interface McpGraphDocument {
  readonly schemaVersion: typeof MCP_GRAPH_SCHEMA_VERSION
  readonly revision: string
  readonly id: string
  readonly name: string
  readonly description: string
  readonly nodes: ReadonlyArray<McpGraphNode>
  readonly edges: ReadonlyArray<McpGraphEdge>
}

export interface McpGraphNodeCandidate extends McpGraphNodeFields {
  readonly kind: McpNodeKind
  readonly config: unknown
}

export interface McpGraphDocumentCandidate {
  readonly schemaVersion: typeof MCP_GRAPH_SCHEMA_VERSION
  readonly revision: string
  readonly id: string
  readonly name: string
  readonly description: string
  readonly nodes: ReadonlyArray<McpGraphNodeCandidate>
  readonly edges: ReadonlyArray<McpGraphEdge>
}

export type McpGraphIssueCode =
  | "invalid-graph-id"
  | "invalid-node-config"
  | "duplicate-node-id"
  | "duplicate-edge-id"
  | "unknown-edge-source"
  | "unknown-edge-target"
  | "incompatible-edge"
  | "revision-mismatch"

export type McpGraphRepairActionId =
  | "change-graph-id"
  | "reset-node-config"
  | "rename-node"
  | "rename-edge"
  | "select-edge-source"
  | "select-edge-target"
  | "change-edge-kind"
  | "reconnect-edge"
  | "refresh-revision"

export interface McpGraphRepairAlternative {
  readonly id: string
  readonly label: string
  readonly value: string
}

export interface McpGraphRepair {
  readonly actionId: McpGraphRepairActionId
  readonly description: string
  readonly alternatives: ReadonlyArray<McpGraphRepairAlternative>
}

export interface McpGraphIssue {
  readonly code: McpGraphIssueCode
  readonly path: string
  readonly message: string
  readonly repair: McpGraphRepair
}

export class McpGraphValidationError extends Data.TaggedError("McpGraphValidationError")<{
  readonly issues: ReadonlyArray<McpGraphIssue>
}> {}

const duplicateValues = (values: ReadonlyArray<string>): ReadonlySet<string> => {
  const seen = new Set<string>()
  const duplicates = new Set<string>()

  for (const value of values) {
    if (seen.has(value)) duplicates.add(value)
    seen.add(value)
  }

  return duplicates
}

const nextAvailableIdentifier = (values: ReadonlyArray<string>, base: string): string => {
  const used = new Set(values)
  let suffix = 2
  while (used.has(`${base}-${suffix}`)) suffix += 1
  return `${base}-${suffix}`
}

const alternative = (id: string, label: string, value: string): McpGraphRepairAlternative => ({
  id,
  label,
  value,
})

export const validateGraphDocument = (
  document: McpGraphDocument | McpGraphDocumentCandidate,
): Effect.Effect<McpGraphDocument, McpGraphValidationError> =>
  Effect.gen(function* () {
    const issues: Array<McpGraphIssue> = []
    const decodedNodes: Array<McpGraphNode> = []
    const duplicateNodeIds = duplicateValues(document.nodes.map(node => node.id))
    const duplicateEdgeIds = duplicateValues(document.edges.map(edge => edge.id))
    const nodesById = new Map(document.nodes.map(node => [node.id, node]))

    if (document.id.trim().length === 0) {
      issues.push({
        code: "invalid-graph-id",
        path: "id",
        message: "Graph id must not be empty",
        repair: {
          actionId: "change-graph-id",
          description: "Choose a stable non-empty graph identifier",
          alternatives: [alternative("graph-id", "Use application-graph", "application-graph")],
        },
      })
    }

    for (const node of document.nodes) {
      const decoded = decodeNodeConfig(node.kind, node.config)
      if (Either.isLeft(decoded)) {
        const defaults = defaultNodePresentation(node.kind).config
        issues.push({
          code: "invalid-node-config",
          path: `nodes.${node.id}.config`,
          message: `Invalid ${node.kind} configuration: ${formatNodeConfigError(decoded.left)}`,
          repair: {
            actionId: "reset-node-config",
            description: `Replace the configuration with valid ${node.kind} defaults`,
            alternatives: [
              alternative(
                `${node.kind}-defaults`,
                `Use ${node.kind} defaults`,
                JSON.stringify(defaults),
              ),
            ],
          },
        })
      } else {
        decodedNodes.push({ ...node, config: decoded.right } as McpGraphNode)
      }
    }

    for (const nodeId of duplicateNodeIds) {
      const suggested = nextAvailableIdentifier(
        document.nodes.map(node => node.id),
        nodeId,
      )
      issues.push({
        code: "duplicate-node-id",
        path: `nodes.${nodeId}`,
        message: `Node id "${nodeId}" is used more than once`,
        repair: {
          actionId: "rename-node",
          description: "Give the duplicate node a unique stable identifier",
          alternatives: [alternative(suggested, `Rename to ${suggested}`, suggested)],
        },
      })
    }

    for (const edgeId of duplicateEdgeIds) {
      const suggested = nextAvailableIdentifier(
        document.edges.map(edge => edge.id),
        edgeId,
      )
      issues.push({
        code: "duplicate-edge-id",
        path: `edges.${edgeId}`,
        message: `Edge id "${edgeId}" is used more than once`,
        repair: {
          actionId: "rename-edge",
          description: "Give the duplicate edge a unique stable identifier",
          alternatives: [alternative(suggested, `Rename to ${suggested}`, suggested)],
        },
      })
    }

    for (const edge of document.edges) {
      const source = nodesById.get(edge.source)
      const target = nodesById.get(edge.target)

      if (!source) {
        const validSources = document.nodes.filter(candidate =>
          target ? isCompatibleEdge(edge.kind, candidate.kind, target.kind) : true,
        )
        issues.push({
          code: "unknown-edge-source",
          path: `edges.${edge.id}.source`,
          message: `Edge "${edge.id}" starts at unknown node "${edge.source}"`,
          repair: {
            actionId: "select-edge-source",
            description: "Select an existing compatible source node",
            alternatives: validSources.map(candidate =>
              alternative(candidate.id, `${candidate.label} (${candidate.kind})`, candidate.id),
            ),
          },
        })
      }

      if (!target) {
        const validTargets = document.nodes.filter(candidate =>
          source ? isCompatibleEdge(edge.kind, source.kind, candidate.kind) : true,
        )
        issues.push({
          code: "unknown-edge-target",
          path: `edges.${edge.id}.target`,
          message: `Edge "${edge.id}" targets unknown node "${edge.target}"`,
          repair: {
            actionId: "select-edge-target",
            description: "Select an existing compatible target node",
            alternatives: validTargets.map(candidate =>
              alternative(candidate.id, `${candidate.label} (${candidate.kind})`, candidate.id),
            ),
          },
        })
      }

      if (source && target && !isCompatibleEdge(edge.kind, source.kind, target.kind)) {
        const validKinds = compatibleEdgeKinds(source.kind, target.kind)
        issues.push({
          code: "incompatible-edge",
          path: `edges.${edge.id}`,
          message: `A "${edge.kind}" edge cannot connect ${source.kind} → ${target.kind}`,
          repair: {
            actionId: validKinds.length > 0 ? "change-edge-kind" : "reconnect-edge",
            description:
              validKinds.length > 0
                ? "Choose a compatible edge relationship"
                : "Reconnect one endpoint to a compatible node",
            alternatives: validKinds.map(kind =>
              alternative(kind, `Use ${graphEdgeRegistry[kind].label}`, kind),
            ),
          },
        })
      }
    }

    const expectedRevision = graphExecutionFingerprint(document)
    if (document.revision !== expectedRevision) {
      issues.push({
        code: "revision-mismatch",
        path: "revision",
        message: `Graph revision "${document.revision}" does not match executable content`,
        repair: {
          actionId: "refresh-revision",
          description: "Refresh the compatibility revision from executable graph content",
          alternatives: [
            alternative(expectedRevision, `Use ${expectedRevision}`, expectedRevision),
          ],
        },
      })
    }

    if (issues.length > 0) {
      return yield* new McpGraphValidationError({ issues })
    }

    return { ...document, nodes: decodedNodes } as McpGraphDocument
  })
