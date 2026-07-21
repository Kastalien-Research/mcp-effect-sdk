import { Data, Effect, Either, Schema } from "effect"
import { withGraphRevision } from "../model/GraphFingerprint"
import {
  GraphIdentifierSchema,
  MCP_GRAPH_SCHEMA_VERSION,
  McpEdgeKindSchema,
  type McpGraphDocument,
  type McpGraphDocumentCandidate,
  type McpGraphEdge,
  type McpGraphValidationError,
  McpNodeKindSchema,
  validateGraphDocument,
} from "../model/McpGraphDocument"

export type McpGraphImportIssueCode = "invalid-json" | "invalid-document" | "unsupported-schema"

export class McpGraphImportError extends Data.TaggedError("McpGraphImportError")<{
  readonly code: McpGraphImportIssueCode
  readonly message: string
}> {}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value)

const PositionSchema = Schema.Struct({
  x: Schema.Number.pipe(Schema.finite()),
  y: Schema.Number.pipe(Schema.finite()),
})

const NodeSchema = Schema.Struct({
  id: GraphIdentifierSchema,
  kind: McpNodeKindSchema,
  label: Schema.String,
  description: Schema.String,
  position: PositionSchema,
  config: Schema.Unknown,
})

const EdgeSchema = Schema.Struct({
  id: GraphIdentifierSchema,
  kind: McpEdgeKindSchema,
  source: GraphIdentifierSchema,
  target: GraphIdentifierSchema,
  label: Schema.optional(Schema.String),
})

const DocumentFields = {
  id: GraphIdentifierSchema,
  name: Schema.String,
  description: Schema.String,
  nodes: Schema.Array(NodeSchema),
  edges: Schema.Array(EdgeSchema),
}

const LooseNodeSchema = Schema.Struct({
  id: Schema.String,
  kind: McpNodeKindSchema,
  label: Schema.String,
  description: Schema.String,
  position: PositionSchema,
  config: Schema.Unknown,
})

const LooseEdgeSchema = Schema.Struct({
  id: Schema.String,
  kind: McpEdgeKindSchema,
  source: Schema.String,
  target: Schema.String,
  label: Schema.optional(Schema.String),
})

const LooseDocumentFields = {
  id: Schema.String,
  name: Schema.String,
  description: Schema.String,
  nodes: Schema.Array(LooseNodeSchema),
  edges: Schema.Array(LooseEdgeSchema),
}

const GraphDocumentV1Schema = Schema.Struct({
  schemaVersion: Schema.Literal("1"),
  ...DocumentFields,
})

const LooseGraphDocumentV1Schema = Schema.Struct({
  schemaVersion: Schema.Literal("1"),
  ...LooseDocumentFields,
})

const GraphDocumentV2Schema = Schema.Struct({
  schemaVersion: Schema.Literal(MCP_GRAPH_SCHEMA_VERSION),
  revision: Schema.String,
  ...DocumentFields,
})

const LooseGraphDocumentV2Schema = Schema.Struct({
  schemaVersion: Schema.Literal(MCP_GRAPH_SCHEMA_VERSION),
  revision: Schema.String,
  ...LooseDocumentFields,
})

type GraphDocumentV1 = Schema.Schema.Type<typeof GraphDocumentV1Schema>

const decodeOptions = { errors: "all", onExcessProperty: "error" } as const

const migrateNodeConfig = (node: GraphDocumentV1["nodes"][number]) => {
  if (node.kind !== "app-resource" && node.kind !== "app-view" && node.kind !== "app-host") {
    return node
  }

  const config = isRecord(node.config) ? node.config : {}
  return { ...node, config: { profile: "stable", ...config } }
}

const migrateV1Graph = (document: GraphDocumentV1): McpGraphDocumentCandidate =>
  withGraphRevision({
    ...document,
    schemaVersion: MCP_GRAPH_SCHEMA_VERSION,
    nodes: document.nodes.map(migrateNodeConfig),
    edges: document.edges as ReadonlyArray<McpGraphEdge>,
  }) as McpGraphDocumentCandidate

export const serializeGraphDocument = (graph: McpGraphDocument): string =>
  `${JSON.stringify(graph, null, 2)}\n`

const decodeGraphDocument = (
  value: unknown,
): Effect.Effect<McpGraphDocument, McpGraphImportError | McpGraphValidationError> => {
  if (isRecord(value) && typeof value.schemaVersion === "string") {
    if (value.schemaVersion !== "1" && value.schemaVersion !== MCP_GRAPH_SCHEMA_VERSION) {
      return Effect.fail(
        new McpGraphImportError({
          code: "unsupported-schema",
          message: `Graph schema version "${value.schemaVersion}" is not supported`,
        }),
      )
    }
  }

  let document: McpGraphDocumentCandidate
  if (isRecord(value) && value.schemaVersion === "1") {
    let decoded = Schema.decodeUnknownEither(GraphDocumentV1Schema, decodeOptions)(value)
    if (Either.isLeft(decoded)) {
      decoded = Schema.decodeUnknownEither(LooseGraphDocumentV1Schema, decodeOptions)(value)
    }
    if (Either.isLeft(decoded)) return invalidDocument()
    document = migrateV1Graph(decoded.right)
  } else {
    let decoded = Schema.decodeUnknownEither(GraphDocumentV2Schema, decodeOptions)(value)
    if (Either.isLeft(decoded)) {
      decoded = Schema.decodeUnknownEither(LooseGraphDocumentV2Schema, decodeOptions)(value)
    }
    if (Either.isLeft(decoded)) return invalidDocument()
    document = decoded.right as McpGraphDocumentCandidate
  }

  return validateGraphDocument(document)
}

const reconstructGraphContractFields = (value: unknown): unknown => {
  if (!isRecord(value)) return value
  return {
    schemaVersion: value.schemaVersion,
    revision: value.revision,
    id: value.id,
    name: value.name,
    description: value.description,
    nodes: Array.isArray(value.nodes)
      ? value.nodes.map(node =>
          isRecord(node)
            ? {
                id: node.id,
                kind: node.kind,
                label: node.label,
                description: node.description,
                position: isRecord(node.position)
                  ? { x: node.position.x, y: node.position.y }
                  : node.position,
                config: node.config,
              }
            : node,
        )
      : value.nodes,
    edges: Array.isArray(value.edges)
      ? value.edges.map(edge =>
          isRecord(edge)
            ? {
                id: edge.id,
                kind: edge.kind,
                source: edge.source,
                target: edge.target,
                ...(edge.label !== undefined ? { label: edge.label } : {}),
              }
            : edge,
        )
      : value.edges,
  }
}

/** Validates and reconstructs only graph-v2 portable contract fields. */
export const makePortableGraphDocument = (
  graph: McpGraphDocument,
): Effect.Effect<McpGraphDocument, McpGraphImportError | McpGraphValidationError> =>
  decodeGraphDocument(reconstructGraphContractFields(graph))

const invalidDocument = (): Effect.Effect<never, McpGraphImportError> =>
  Effect.fail(
    new McpGraphImportError({
      code: "invalid-document",
      message: "The imported JSON does not match the MCP graph document contract",
    }),
  )

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
