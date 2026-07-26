import { Data, Effect, Either } from "effect"
import { graphExecutionFingerprint } from "./GraphFingerprint"
import {
  compatibleEdgeKinds,
  decodeNodeConfig,
  defaultNodePresentation,
  formatNodeConfigError,
  GRAPH_EDGE_KINDS,
  GRAPH_IDENTIFIER_MAX_LENGTH,
  GRAPH_NODE_KINDS,
  GraphIdentifierSchema,
  graphEdgeRegistry,
  graphNodeDefinition,
  graphNodePorts,
  inferCompatibleEdgeKind,
  isCompatibleEdge,
  isGraphIdentifier,
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
  GRAPH_IDENTIFIER_MAX_LENGTH,
  GRAPH_NODE_KINDS,
  GraphIdentifierSchema,
  graphEdgeRegistry,
  graphNodeDefinition,
  graphNodePorts,
  inferCompatibleEdgeKind,
  isCompatibleEdge,
  isGraphIdentifier,
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
  | "invalid-node-id"
  | "invalid-edge-id"
  | "invalid-edge-source"
  | "invalid-edge-target"
  | "invalid-node-config"
  | "duplicate-node-id"
  | "duplicate-edge-id"
  | "duplicate-executable-edge"
  | "unknown-edge-source"
  | "unknown-edge-target"
  | "incompatible-edge"
  | "incompatible-app-profile"
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
  | "remove-or-rewire-edge"
  | "change-app-profile"
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
  if (!used.has(base)) return base

  let suffix = 2
  while (used.has(`${base}-${suffix}`)) suffix += 1
  return `${base}-${suffix}`
}

const identifierSuggestion = (
  value: string,
  values: ReadonlyArray<string>,
  fallback: string,
): string => {
  const trimmed = value.trim()
  return nextAvailableIdentifier(values, isGraphIdentifier(trimmed) ? trimmed : fallback)
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
    const nodeIds = document.nodes.map(node => node.id)
    const edgeIds = document.edges.map(edge => edge.id)
    const duplicateNodeIds = duplicateValues(nodeIds.filter(isGraphIdentifier))
    const duplicateEdgeIds = duplicateValues(edgeIds.filter(isGraphIdentifier))
    const nodesById = new Map(
      document.nodes.filter(node => isGraphIdentifier(node.id)).map(node => [node.id, node]),
    )

    if (!isGraphIdentifier(document.id)) {
      const suggested = identifierSuggestion(document.id, [document.id], "application-graph")
      issues.push({
        code: "invalid-graph-id",
        path: "id",
        message: `Graph id must be trimmed, non-empty, control-free, and at most ${GRAPH_IDENTIFIER_MAX_LENGTH} characters`,
        repair: {
          actionId: "change-graph-id",
          description: "Choose a stable non-empty graph identifier",
          alternatives: [alternative(suggested, `Use ${suggested}`, suggested)],
        },
      })
    }

    for (const [index, node] of document.nodes.entries()) {
      if (!isGraphIdentifier(node.id)) {
        const suggested = identifierSuggestion(node.id, nodeIds, `node-${index + 1}`)
        issues.push({
          code: "invalid-node-id",
          path: `nodes.${index}.id`,
          message: `Node id must be trimmed, non-empty, control-free, and at most ${GRAPH_IDENTIFIER_MAX_LENGTH} characters`,
          repair: {
            actionId: "rename-node",
            description: "Give the node a trimmed non-empty stable identifier",
            alternatives: [alternative(suggested, `Rename to ${suggested}`, suggested)],
          },
        })
      }

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
      const suggested = nextAvailableIdentifier(nodeIds, nodeId)
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
      const suggested = nextAvailableIdentifier(edgeIds, edgeId)
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

    const decodedNodesById = new Map(decodedNodes.map(node => [node.id, node]))
    const executableEdges = new Map<string, string>()

    for (const [index, edge] of document.edges.entries()) {
      const validEdgeId = isGraphIdentifier(edge.id)
      const validSourceId = isGraphIdentifier(edge.source)
      const validTargetId = isGraphIdentifier(edge.target)
      const edgePath = validEdgeId ? `edges.${edge.id}` : `edges.${index}`
      const source = validSourceId ? nodesById.get(edge.source) : undefined
      const target = validTargetId ? nodesById.get(edge.target) : undefined

      if (!validEdgeId) {
        const suggested = identifierSuggestion(edge.id, edgeIds, `edge-${index + 1}`)
        issues.push({
          code: "invalid-edge-id",
          path: `${edgePath}.id`,
          message: `Edge id must be trimmed, non-empty, control-free, and at most ${GRAPH_IDENTIFIER_MAX_LENGTH} characters`,
          repair: {
            actionId: "rename-edge",
            description: "Give the edge a trimmed non-empty stable identifier",
            alternatives: [alternative(suggested, `Rename to ${suggested}`, suggested)],
          },
        })
      }

      if (!validSourceId) {
        issues.push({
          code: "invalid-edge-source",
          path: `${edgePath}.source`,
          message: `Edge source must be a trimmed, non-empty, control-free node identifier of at most ${GRAPH_IDENTIFIER_MAX_LENGTH} characters`,
          repair: {
            actionId: "select-edge-source",
            description: "Select an existing compatible source node",
            alternatives: document.nodes
              .filter(
                candidate =>
                  isGraphIdentifier(candidate.id) &&
                  (target ? isCompatibleEdge(edge.kind, candidate.kind, target.kind) : true),
              )
              .map(candidate =>
                alternative(candidate.id, `${candidate.label} (${candidate.kind})`, candidate.id),
              ),
          },
        })
      }

      if (!validTargetId) {
        issues.push({
          code: "invalid-edge-target",
          path: `${edgePath}.target`,
          message: `Edge target must be a trimmed, non-empty, control-free node identifier of at most ${GRAPH_IDENTIFIER_MAX_LENGTH} characters`,
          repair: {
            actionId: "select-edge-target",
            description: "Select an existing compatible target node",
            alternatives: document.nodes
              .filter(
                candidate =>
                  isGraphIdentifier(candidate.id) &&
                  (source ? isCompatibleEdge(edge.kind, source.kind, candidate.kind) : true),
              )
              .map(candidate =>
                alternative(candidate.id, `${candidate.label} (${candidate.kind})`, candidate.id),
              ),
          },
        })
      }

      if (validSourceId && !source) {
        const validSources = document.nodes.filter(candidate =>
          target ? isCompatibleEdge(edge.kind, candidate.kind, target.kind) : true,
        )
        issues.push({
          code: "unknown-edge-source",
          path: `${edgePath}.source`,
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

      if (validTargetId && !target) {
        const validTargets = document.nodes.filter(candidate =>
          source ? isCompatibleEdge(edge.kind, source.kind, candidate.kind) : true,
        )
        issues.push({
          code: "unknown-edge-target",
          path: `${edgePath}.target`,
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
          path: edgePath,
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

      if (
        validEdgeId &&
        source &&
        target &&
        isCompatibleEdge(edge.kind, source.kind, target.kind)
      ) {
        const executableKey = JSON.stringify([edge.kind, edge.source, edge.target])
        const firstEdgeId = executableEdges.get(executableKey)
        if (firstEdgeId !== undefined) {
          issues.push({
            code: "duplicate-executable-edge",
            path: edgePath,
            message: `Edge "${edge.id}" duplicates executable edge "${firstEdgeId}"`,
            repair: {
              actionId: "remove-or-rewire-edge",
              description: "Remove the duplicate edge or reconnect one endpoint",
              alternatives: [
                alternative(`remove-${edge.id}`, `Remove ${edge.id}`, edge.id),
                alternative(
                  `rewire-${edge.id}`,
                  `Reconnect ${edge.id} to a different endpoint`,
                  edge.id,
                ),
              ],
            },
          })
        } else {
          executableEdges.set(executableKey, edge.id)
        }
      }

      const decodedSource = decodedNodesById.get(edge.source)
      const decodedTarget = decodedNodesById.get(edge.target)
      const isAppsProfileEdge =
        (edge.kind === "renders" &&
          decodedSource?.kind === "app-resource" &&
          decodedTarget?.kind === "app-view") ||
        (edge.kind === "hosts" &&
          decodedSource?.kind === "app-host" &&
          decodedTarget?.kind === "app-view")

      if (isAppsProfileEdge && decodedSource.config.profile !== decodedTarget.config.profile) {
        const sourceProfile = decodedSource.config.profile
        const targetProfile = decodedTarget.config.profile
        issues.push({
          code: "incompatible-app-profile",
          path: edgePath,
          message: `Apps profile mismatch: ${decodedSource.kind} is ${sourceProfile} while app-view is ${targetProfile}`,
          repair: {
            actionId: "change-app-profile",
            description: "Align the Apps profiles or reconnect this edge",
            alternatives: [
              alternative(
                `set-${decodedSource.id}-profile-${targetProfile}`,
                `Set ${decodedSource.label} to ${targetProfile}`,
                targetProfile,
              ),
              alternative(
                `set-${decodedTarget.id}-profile-${sourceProfile}`,
                `Set ${decodedTarget.label} to ${sourceProfile}`,
                sourceProfile,
              ),
              alternative(
                `reconnect-${edge.id}`,
                `Reconnect ${edge.id} to a matching Apps profile`,
                edge.id,
              ),
            ],
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
