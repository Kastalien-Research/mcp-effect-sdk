import { Data, Effect } from "effect"
import {
  MCP_GRAPH_SCHEMA_VERSION,
  type McpEdgeKind,
  type McpGraphDocument,
  type McpGraphEdge,
  type McpGraphNode,
  type McpGraphValidationError,
  type McpNodeKind,
  validateGraphDocument,
} from "../model/McpGraphDocument"

export type McpGraphImportIssueCode = "invalid-json" | "invalid-document" | "unsupported-schema"

export class McpGraphImportError extends Data.TaggedError("McpGraphImportError")<{
  readonly code: McpGraphImportIssueCode
  readonly message: string
}> {}

const nodeKinds: ReadonlySet<string> = new Set<McpNodeKind>([
  "client",
  "gateway",
  "server",
  "tool",
  "resource",
  "prompt",
  "task",
  "app-host",
  "app-view",
  "app-resource",
])

const edgeKinds: ReadonlySet<string> = new Set<McpEdgeKind>([
  "transport",
  "routes",
  "exposes",
  "starts",
  "renders",
])

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value)

const isPosition = (value: unknown): value is McpGraphNode["position"] =>
  isRecord(value) &&
  typeof value.x === "number" &&
  Number.isFinite(value.x) &&
  typeof value.y === "number" &&
  Number.isFinite(value.y)

const isNode = (value: unknown): value is McpGraphNode =>
  isRecord(value) &&
  typeof value.id === "string" &&
  typeof value.kind === "string" &&
  nodeKinds.has(value.kind) &&
  typeof value.label === "string" &&
  typeof value.description === "string" &&
  isPosition(value.position) &&
  isRecord(value.config)

const isEdge = (value: unknown): value is McpGraphEdge =>
  isRecord(value) &&
  typeof value.id === "string" &&
  typeof value.kind === "string" &&
  edgeKinds.has(value.kind) &&
  typeof value.source === "string" &&
  typeof value.target === "string" &&
  (value.label === undefined || typeof value.label === "string")

const isGraphDocument = (value: unknown): value is McpGraphDocument =>
  isRecord(value) &&
  value.schemaVersion === MCP_GRAPH_SCHEMA_VERSION &&
  typeof value.id === "string" &&
  typeof value.name === "string" &&
  typeof value.description === "string" &&
  Array.isArray(value.nodes) &&
  value.nodes.every(isNode) &&
  Array.isArray(value.edges) &&
  value.edges.every(isEdge)

export const serializeGraphDocument = (graph: McpGraphDocument): string =>
  `${JSON.stringify(graph, null, 2)}\n`

const decodeGraphDocument = (
  value: unknown,
): Effect.Effect<McpGraphDocument, McpGraphImportError | McpGraphValidationError> => {
  if (isRecord(value) && typeof value.schemaVersion === "string") {
    if (value.schemaVersion !== MCP_GRAPH_SCHEMA_VERSION) {
      return Effect.fail(
        new McpGraphImportError({
          code: "unsupported-schema",
          message: `Graph schema version "${value.schemaVersion}" is not supported`,
        }),
      )
    }
  }

  if (!isGraphDocument(value)) {
    return Effect.fail(
      new McpGraphImportError({
        code: "invalid-document",
        message: "The imported JSON does not match the MCP graph document contract",
      }),
    )
  }

  return validateGraphDocument(value)
}

export const parseGraphDocument = (
  source: string,
): Effect.Effect<McpGraphDocument, McpGraphImportError | McpGraphValidationError> =>
  Effect.try({
    try: () => JSON.parse(source) as unknown,
    catch: () =>
      new McpGraphImportError({
        code: "invalid-json",
        message: "The imported graph is not valid JSON",
      }),
  }).pipe(Effect.flatMap(decodeGraphDocument))
