import { Data, Effect } from "effect"
import { withGraphRevision } from "../model/GraphFingerprint"
import {
  defaultNodePresentation,
  inferCompatibleEdgeKind,
  type McpEdgeKind,
  type McpGraphDocument,
  type McpGraphEdge,
  type McpGraphNode,
  type McpGraphValidationError,
  type McpNodeKind,
  validateGraphDocument,
} from "../model/McpGraphDocument"

type NodePatch = Partial<Pick<McpGraphNode, "label" | "description">> & {
  readonly config?: unknown
}

export type McpGraphCommand =
  | { readonly type: "node.add"; readonly node: McpGraphNode }
  | {
      readonly type: "node.move"
      readonly nodeId: string
      readonly position: McpGraphNode["position"]
    }
  | { readonly type: "node.update"; readonly nodeId: string; readonly patch: NodePatch }
  | {
      readonly type: "node.duplicate"
      readonly nodeId: string
      readonly duplicateId: string
      readonly position: McpGraphNode["position"]
    }
  | { readonly type: "node.remove"; readonly nodeId: string }
  | { readonly type: "edge.connect"; readonly edge: McpGraphEdge }
  | { readonly type: "edge.remove"; readonly edgeId: string }

export type McpGraphCommandIssueCode = "unknown-node" | "unknown-edge"

export class McpGraphCommandError extends Data.TaggedError("McpGraphCommandError")<{
  readonly code: McpGraphCommandIssueCode
  readonly message: string
}> {}

export interface McpGraphHistory {
  readonly past: ReadonlyArray<McpGraphDocument>
  readonly present: McpGraphDocument
  readonly future: ReadonlyArray<McpGraphDocument>
}

export type McpGraphCommandFailure = McpGraphCommandError | McpGraphValidationError

const updateNode = (
  graph: McpGraphDocument,
  nodeId: string,
  update: (node: McpGraphNode) => McpGraphNode,
): Effect.Effect<McpGraphDocument, McpGraphCommandError> => {
  if (!graph.nodes.some(node => node.id === nodeId)) {
    return new McpGraphCommandError({
      code: "unknown-node",
      message: `Cannot edit unknown node "${nodeId}"`,
    })
  }

  return Effect.succeed({
    ...graph,
    nodes: graph.nodes.map(node => (node.id === nodeId ? update(node) : node)),
  })
}

const candidateForCommand = (
  graph: McpGraphDocument,
  command: McpGraphCommand,
): Effect.Effect<McpGraphDocument, McpGraphCommandError> => {
  switch (command.type) {
    case "node.add":
      return Effect.succeed({ ...graph, nodes: [...graph.nodes, command.node] })

    case "node.move":
      return updateNode(graph, command.nodeId, node => ({
        ...node,
        position: { ...command.position },
      }))

    case "node.update":
      return updateNode(
        graph,
        command.nodeId,
        node =>
          ({
            ...node,
            ...command.patch,
            ...(command.patch.config && typeof command.patch.config === "object"
              ? { config: { ...command.patch.config } }
              : command.patch.config === undefined
                ? {}
                : { config: command.patch.config }),
          }) as McpGraphNode,
      )

    case "node.duplicate": {
      const source = graph.nodes.find(node => node.id === command.nodeId)
      if (!source) {
        return new McpGraphCommandError({
          code: "unknown-node",
          message: `Cannot duplicate unknown node "${command.nodeId}"`,
        })
      }

      const duplicate = {
        ...source,
        id: command.duplicateId,
        label: `${source.label} copy`,
        position: { ...command.position },
        config: { ...source.config },
      } as McpGraphNode

      return Effect.succeed({
        ...graph,
        nodes: [...graph.nodes, duplicate],
      })
    }

    case "node.remove":
      if (!graph.nodes.some(node => node.id === command.nodeId)) {
        return new McpGraphCommandError({
          code: "unknown-node",
          message: `Cannot remove unknown node "${command.nodeId}"`,
        })
      }
      return Effect.succeed({
        ...graph,
        nodes: graph.nodes.filter(node => node.id !== command.nodeId),
        edges: graph.edges.filter(
          edge => edge.source !== command.nodeId && edge.target !== command.nodeId,
        ),
      })

    case "edge.connect":
      return Effect.succeed({ ...graph, edges: [...graph.edges, command.edge] })

    case "edge.remove":
      if (!graph.edges.some(edge => edge.id === command.edgeId)) {
        return new McpGraphCommandError({
          code: "unknown-edge",
          message: `Cannot remove unknown edge "${command.edgeId}"`,
        })
      }
      return Effect.succeed({
        ...graph,
        edges: graph.edges.filter(edge => edge.id !== command.edgeId),
      })
  }
}

export const applyGraphCommand = (
  graph: McpGraphDocument,
  command: McpGraphCommand,
): Effect.Effect<McpGraphDocument, McpGraphCommandFailure> =>
  candidateForCommand(graph, command).pipe(
    Effect.map(withGraphRevision),
    Effect.flatMap(validateGraphDocument),
  )

export const createGraphHistory = (graph: McpGraphDocument): McpGraphHistory => ({
  past: [],
  present: graph,
  future: [],
})

export const executeGraphCommand = (
  history: McpGraphHistory,
  command: McpGraphCommand,
): Effect.Effect<McpGraphHistory, McpGraphCommandFailure> =>
  applyGraphCommand(history.present, command).pipe(
    Effect.map(present => ({
      past: [...history.past, history.present],
      present,
      future: [],
    })),
  )

export const undoGraphHistory = (history: McpGraphHistory): McpGraphHistory => {
  const present = history.past.at(-1)
  if (!present) return history

  return {
    past: history.past.slice(0, -1),
    present,
    future: [history.present, ...history.future],
  }
}

export const redoGraphHistory = (history: McpGraphHistory): McpGraphHistory => {
  const [present, ...future] = history.future
  if (!present) return history

  return {
    past: [...history.past, history.present],
    present,
    future,
  }
}

const nextAvailableId = (graph: McpGraphDocument, base: string): string => {
  const ids = new Set(graph.nodes.map(node => node.id))
  if (!ids.has(base)) return base

  let suffix = 2
  while (ids.has(`${base}-${suffix}`)) suffix += 1
  return `${base}-${suffix}`
}

export const createPaletteNode = (
  graph: McpGraphDocument,
  kind: McpNodeKind,
  position: McpGraphNode["position"],
): McpGraphNode =>
  ({
    id: nextAvailableId(graph, kind),
    kind,
    ...defaultNodePresentation(kind),
    position: { ...position },
  }) as McpGraphNode

export const inferEdgeKind = (
  source: McpNodeKind,
  target: McpNodeKind,
): McpEdgeKind | undefined => {
  return inferCompatibleEdgeKind(source, target)
}

export const createEdgeId = (graph: McpGraphDocument, source: string, target: string): string => {
  const base = `${source}-${target}`
  const ids = new Set(graph.edges.map(edge => edge.id))
  if (!ids.has(base)) return base

  let suffix = 2
  while (ids.has(`${base}-${suffix}`)) suffix += 1
  return `${base}-${suffix}`
}
