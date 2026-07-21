import { Data, Effect } from "effect"
import type { McpGraphDocument, McpGraphValidationError } from "../model/McpGraphDocument"
import type { McpTraceDocument, McpTraceValidationError } from "../model/McpTraceDocument"
import { validateTraceDocument } from "../model/McpTraceDocument"
import { canonicalizePortableJson, sanitizeTraceDocument } from "../trace/TraceRedaction"
import type { McpGraphImportError } from "./GraphDocumentIO"
import { makePortableGraphDocument, parseGraphDocument } from "./GraphDocumentIO"
import {
  decodeTraceDocument,
  type McpTraceImportError,
  type ParseTraceDocumentOptions,
} from "./TraceDocumentIO"

export const MCP_PROJECT_BUNDLE_SCHEMA_VERSION = "1" as const
export const MCP_PROJECT_BUNDLE_KIND = "mcp-project-bundle" as const

export interface McpProjectBundle {
  readonly schemaVersion: typeof MCP_PROJECT_BUNDLE_SCHEMA_VERSION
  readonly kind: typeof MCP_PROJECT_BUNDLE_KIND
  readonly graph: McpGraphDocument
  readonly trace?: McpTraceDocument
}

export const makeProjectBundle = (
  graph: McpGraphDocument,
  trace?: McpTraceDocument,
): Effect.Effect<McpProjectBundle, McpProjectBundleFailure> =>
  Effect.gen(function* () {
    const portableGraph = yield* makePortableGraphDocument(graph)
    if (!trace) {
      return {
        schemaVersion: MCP_PROJECT_BUNDLE_SCHEMA_VERSION,
        kind: MCP_PROJECT_BUNDLE_KIND,
        graph: portableGraph,
      }
    }
    const portableTrace = yield* validateTraceDocument(portableGraph, sanitizeTraceDocument(trace))
    return {
      schemaVersion: MCP_PROJECT_BUNDLE_SCHEMA_VERSION,
      kind: MCP_PROJECT_BUNDLE_KIND,
      graph: portableGraph,
      trace: portableTrace,
    }
  })

export type McpProjectBundleImportIssueCode =
  | "invalid-json"
  | "invalid-document"
  | "unsupported-schema"

export class McpProjectBundleImportError extends Data.TaggedError("McpProjectBundleImportError")<{
  readonly code: McpProjectBundleImportIssueCode
  readonly message: string
}> {}

export type McpProjectBundleFailure =
  | McpProjectBundleImportError
  | McpGraphImportError
  | McpGraphValidationError
  | McpTraceImportError
  | McpTraceValidationError

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value)

const decodeProjectBundle = (
  value: unknown,
  options: ParseTraceDocumentOptions,
): Effect.Effect<McpProjectBundle, McpProjectBundleFailure> => {
  if (!isRecord(value)) {
    return Effect.fail(
      new McpProjectBundleImportError({
        code: "invalid-document",
        message: "The imported JSON does not match the MCP project bundle contract",
      }),
    )
  }
  if (
    typeof value.schemaVersion === "string" &&
    value.schemaVersion !== MCP_PROJECT_BUNDLE_SCHEMA_VERSION
  ) {
    return Effect.fail(
      new McpProjectBundleImportError({
        code: "unsupported-schema",
        message: `Project bundle schema version "${value.schemaVersion}" is not supported`,
      }),
    )
  }
  if (
    value.schemaVersion !== MCP_PROJECT_BUNDLE_SCHEMA_VERSION ||
    value.kind !== MCP_PROJECT_BUNDLE_KIND ||
    !Object.hasOwn(value, "graph")
  ) {
    return Effect.fail(
      new McpProjectBundleImportError({
        code: "invalid-document",
        message: "The imported JSON does not match the MCP project bundle contract",
      }),
    )
  }

  return Effect.gen(function* () {
    // Graph validation is intentionally first; a trace is never decoded against ambient state.
    const graph = yield* parseGraphDocument(JSON.stringify(value.graph))
    if (value.trace === undefined) {
      return {
        schemaVersion: MCP_PROJECT_BUNDLE_SCHEMA_VERSION,
        kind: MCP_PROJECT_BUNDLE_KIND,
        graph,
      }
    }
    const trace = yield* decodeTraceDocument(value.trace, graph, options)
    return {
      schemaVersion: MCP_PROJECT_BUNDLE_SCHEMA_VERSION,
      kind: MCP_PROJECT_BUNDLE_KIND,
      graph,
      trace,
    }
  })
}

export const serializeProjectBundle = (
  bundle: McpProjectBundle,
): Effect.Effect<string, McpProjectBundleFailure> =>
  makeProjectBundle(bundle.graph, bundle.trace).pipe(
    Effect.map(portable => `${JSON.stringify(canonicalizePortableJson(portable), null, 2)}\n`),
  )

export const parseProjectBundle = (
  source: string,
  options: ParseTraceDocumentOptions = {},
): Effect.Effect<McpProjectBundle, McpProjectBundleFailure> =>
  Effect.try({
    try: () => JSON.parse(source) as unknown,
    catch: () =>
      new McpProjectBundleImportError({
        code: "invalid-json",
        message: "The imported project bundle is not valid JSON",
      }),
  }).pipe(Effect.flatMap(value => decodeProjectBundle(value, options)))
