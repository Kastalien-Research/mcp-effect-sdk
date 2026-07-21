import { Data, Effect } from "effect"
import { parseGraphDocument } from "../authoring/GraphDocumentIO"
import type { McpAppsProfile, McpGraphDocument } from "../model/McpGraphDocument"
import {
  MCP_TRACE_SCHEMA_VERSION,
  type McpTraceDocument,
  type McpTraceEvent,
  validateTraceDocument,
} from "../model/McpTraceDocument"
import { isTraceIdentifier, isTraceLabel, isTraceReference } from "../model/TraceCodecs"
import {
  isMcpTraceEventKind,
  type McpTraceEventKind,
  traceEventDefinition,
} from "../model/TraceRegistry"

export const APPS_EXTENSION_ID = "io.modelcontextprotocol/ui" as const
export const APPS_STABLE_RESOURCE_MIME_TYPE = "text/html;profile=mcp-app" as const
export const APPS_STABLE_UI_PROTOCOL_VERSION = "2026-01-26" as const
export const APPS_FIXTURE_SCHEMA_VERSION = "1" as const

export type AppsFixtureContract =
  | {
      readonly status: "stable-profile-fixture"
      readonly mimeType: typeof APPS_STABLE_RESOURCE_MIME_TYPE
      readonly uiProtocolVersion: typeof APPS_STABLE_UI_PROTOCOL_VERSION
    }
  | {
      readonly status: "unqualified"
      readonly reason: "fixture data pending accepted WP9"
    }

export type AppsPolicyDeclaration =
  | { readonly kind: "none"; readonly outcome: "not-applicable" }
  | { readonly kind: "consent" | "policy"; readonly outcome: "allowed" | "denied" }

export interface AppsFixtureProvenance {
  readonly source: "declared-fixture"
  readonly fixtureId: string
  readonly declaration: "fixture-only"
}

export interface AppsResourceLinkage {
  readonly uri: string
  readonly nodeId: string
  readonly linkedNodeIds: ReadonlyArray<string>
}

export interface AppsPublicEvent {
  readonly id: string
  readonly sequence: number
  readonly atMs: number
  readonly nodeId: string
  readonly kind: McpTraceEventKind
  readonly summary: string
  readonly correlationId: string
  readonly policy: AppsPolicyDeclaration
}

export interface DecodedAppsPublicSession {
  readonly schemaVersion: typeof APPS_FIXTURE_SCHEMA_VERSION
  readonly kind: "mcp-apps-public-session"
  readonly id: string
  readonly name: string
  readonly extensionId: typeof APPS_EXTENSION_ID
  readonly profile: McpAppsProfile
  readonly contract: AppsFixtureContract
  readonly provenance: AppsFixtureProvenance
  readonly graph: McpGraphDocument
  readonly resource: AppsResourceLinkage
  readonly events: ReadonlyArray<AppsPublicEvent>
  readonly normalize: () => Effect.Effect<McpTraceDocument, AppsTraceAdapterError>
}

export interface AppsTraceAdapter {
  readonly decode: (
    input: unknown,
  ) => Effect.Effect<DecodedAppsPublicSession, AppsTraceAdapterError>
}

export interface AppsPublicEventSource<Error = never> {
  readonly read: Effect.Effect<unknown, Error>
}

export interface AdaptedAppsPublicSession {
  readonly profile: McpAppsProfile
  readonly contract: AppsFixtureContract
  readonly graph: McpGraphDocument
  readonly trace: McpTraceDocument
}

export class AppsTraceAdapterError extends Data.TaggedError("AppsTraceAdapterError")<{
  readonly path: string
  readonly message: string
}> {}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value)

const fail = (path: string, message: string): AppsTraceAdapterError =>
  new AppsTraceAdapterError({ path, message })

const hasOnlyKeys = (value: Record<string, unknown>, keys: ReadonlyArray<string>): boolean => {
  const accepted = new Set(keys)
  return Object.keys(value).every(key => accepted.has(key))
}

const decodeContract = (
  value: unknown,
  profile: McpAppsProfile,
): AppsFixtureContract | undefined => {
  if (!isRecord(value)) return undefined
  if (profile === "stable") {
    if (
      !hasOnlyKeys(value, ["status", "mimeType", "uiProtocolVersion"]) ||
      value.status !== "stable-profile-fixture" ||
      value.mimeType !== APPS_STABLE_RESOURCE_MIME_TYPE ||
      value.uiProtocolVersion !== APPS_STABLE_UI_PROTOCOL_VERSION
    ) {
      return undefined
    }
    return {
      status: "stable-profile-fixture",
      mimeType: APPS_STABLE_RESOURCE_MIME_TYPE,
      uiProtocolVersion: APPS_STABLE_UI_PROTOCOL_VERSION,
    }
  }
  if (
    !hasOnlyKeys(value, ["status", "reason"]) ||
    value.status !== "unqualified" ||
    value.reason !== "fixture data pending accepted WP9"
  ) {
    return undefined
  }
  return { status: "unqualified", reason: "fixture data pending accepted WP9" }
}

const decodeProvenance = (value: unknown): AppsFixtureProvenance | undefined => {
  if (
    !isRecord(value) ||
    !hasOnlyKeys(value, ["source", "fixtureId", "declaration"]) ||
    value.source !== "declared-fixture" ||
    !isTraceIdentifier(value.fixtureId) ||
    value.declaration !== "fixture-only"
  ) {
    return undefined
  }
  return { source: "declared-fixture", fixtureId: value.fixtureId, declaration: "fixture-only" }
}

const isUiResourceUri = (value: unknown): value is string => {
  if (typeof value !== "string" || !value.startsWith("ui://")) return false
  try {
    return new URL(value).protocol === "ui:"
  } catch {
    return false
  }
}

const decodeResource = (value: unknown): AppsResourceLinkage | undefined => {
  if (
    !isRecord(value) ||
    !hasOnlyKeys(value, ["uri", "nodeId", "linkedNodeIds"]) ||
    !isUiResourceUri(value.uri) ||
    !isTraceReference(value.nodeId) ||
    !Array.isArray(value.linkedNodeIds) ||
    value.linkedNodeIds.length === 0 ||
    !value.linkedNodeIds.every(isTraceReference)
  ) {
    return undefined
  }
  return {
    uri: value.uri,
    nodeId: value.nodeId,
    linkedNodeIds: Array.from(value.linkedNodeIds),
  }
}

const decodePolicy = (value: unknown): AppsPolicyDeclaration | undefined => {
  if (!isRecord(value) || !hasOnlyKeys(value, ["kind", "outcome"])) return undefined
  if (value.kind === "none" && value.outcome === "not-applicable") {
    return { kind: "none", outcome: "not-applicable" }
  }
  if (
    (value.kind === "consent" || value.kind === "policy") &&
    (value.outcome === "allowed" || value.outcome === "denied")
  ) {
    return { kind: value.kind, outcome: value.outcome }
  }
  return undefined
}

const policyMatchesKind = (kind: McpTraceEventKind, policy: AppsPolicyDeclaration): boolean => {
  if (!kind.startsWith("apps.consent-") && !kind.startsWith("apps.policy-")) {
    return policy.kind === "none" && policy.outcome === "not-applicable"
  }
  const [subject, outcome] = kind.slice("apps.".length).split("-")
  return policy.kind === subject && policy.outcome === outcome
}

const decodeEvent = (value: unknown): AppsPublicEvent | undefined => {
  if (
    !isRecord(value) ||
    !hasOnlyKeys(value, [
      "id",
      "sequence",
      "atMs",
      "nodeId",
      "kind",
      "summary",
      "correlationId",
      "policy",
    ]) ||
    !isTraceIdentifier(value.id) ||
    !Number.isInteger(value.sequence) ||
    typeof value.sequence !== "number" ||
    value.sequence < 0 ||
    typeof value.atMs !== "number" ||
    !Number.isFinite(value.atMs) ||
    value.atMs < 0 ||
    !isTraceReference(value.nodeId) ||
    typeof value.kind !== "string" ||
    !isMcpTraceEventKind(value.kind) ||
    traceEventDefinition(value.kind).family !== "apps" ||
    !isTraceLabel(value.summary) ||
    !isTraceIdentifier(value.correlationId)
  ) {
    return undefined
  }
  const policy = decodePolicy(value.policy)
  if (!policy || !policyMatchesKind(value.kind, policy)) return undefined
  return {
    id: value.id,
    sequence: value.sequence,
    atMs: value.atMs,
    nodeId: value.nodeId,
    kind: value.kind,
    summary: value.summary,
    correlationId: value.correlationId,
    policy,
  }
}

const isAppNode = (node: McpGraphDocument["nodes"][number]) =>
  node.kind === "app-host" || node.kind === "app-view" || node.kind === "app-resource"

const validateGraphLinkage = (
  graph: McpGraphDocument,
  profile: McpAppsProfile,
  resource: AppsResourceLinkage,
  events: ReadonlyArray<AppsPublicEvent>,
): Effect.Effect<void, AppsTraceAdapterError> => {
  const appNodes = graph.nodes.filter(isAppNode)
  if (appNodes.length === 0 || appNodes.some(node => node.config.profile !== profile)) {
    return Effect.fail(
      fail("graph.nodes", "Every Apps graph node must declare the session profile"),
    )
  }
  const resourceNode = graph.nodes.find(node => node.id === resource.nodeId)
  if (
    resourceNode?.kind !== "app-resource" ||
    resourceNode.config.profile !== profile ||
    resourceNode.config.uri !== resource.uri
  ) {
    return Effect.fail(fail("resource", "Resource linkage must match an explicit Apps resource"))
  }
  const nodes = new Set(graph.nodes.map(node => node.id))
  const appNodeIds = new Set(appNodes.map(node => node.id))
  const directlyLinked = new Set(
    graph.edges.flatMap(edge =>
      edge.source === resource.nodeId
        ? [edge.target]
        : edge.target === resource.nodeId
          ? [edge.source]
          : [],
    ),
  )
  if (
    resource.linkedNodeIds.some(nodeId => !nodes.has(nodeId) || !directlyLinked.has(nodeId)) ||
    events.some(event => !nodes.has(event.nodeId) || !appNodeIds.has(event.nodeId))
  ) {
    return Effect.fail(
      fail(
        "resource.linkedNodeIds",
        "Resource and event linkage must reference connected Apps nodes",
      ),
    )
  }
  return Effect.void
}

const normalizeTrace = (
  graph: McpGraphDocument,
  input: {
    readonly id: string
    readonly name: string
    readonly extensionId: typeof APPS_EXTENSION_ID
    readonly profile: McpAppsProfile
    readonly contract: AppsFixtureContract
    readonly provenance: AppsFixtureProvenance
    readonly resource: AppsResourceLinkage
    readonly events: ReadonlyArray<AppsPublicEvent>
  },
): Effect.Effect<McpTraceDocument, AppsTraceAdapterError> => {
  const events: ReadonlyArray<McpTraceEvent> = input.events.map(event => {
    const definition = traceEventDefinition(event.kind)
    return {
      id: event.id,
      sequence: event.sequence,
      atMs: event.atMs,
      nodeId: event.nodeId,
      kind: event.kind,
      family: definition.family,
      channel: definition.channel,
      summary: event.summary,
      correlationId: event.correlationId,
      payload: {
        extensionId: input.extensionId,
        profile: input.profile,
        contract: input.contract,
        provenance: input.provenance,
        resource: input.resource,
        policy: event.policy,
      },
    }
  })
  const trace: McpTraceDocument = {
    schemaVersion: MCP_TRACE_SCHEMA_VERSION,
    id: input.id,
    graphId: graph.id,
    graphRevision: graph.revision,
    name: input.name,
    provenance: { redactionPolicy: "allowlist-v1", redactions: [], migrations: [] },
    events,
  }
  return validateTraceDocument(graph, trace).pipe(
    Effect.mapError(error => fail("events", error.issues.map(issue => issue.message).join(" · "))),
  )
}

export const decodeAppsPublicSession = (
  input: unknown,
): Effect.Effect<DecodedAppsPublicSession, AppsTraceAdapterError> =>
  Effect.gen(function* () {
    if (
      !isRecord(input) ||
      !hasOnlyKeys(input, [
        "schemaVersion",
        "kind",
        "id",
        "name",
        "extensionId",
        "profile",
        "contract",
        "provenance",
        "graph",
        "resource",
        "events",
      ]) ||
      input.schemaVersion !== APPS_FIXTURE_SCHEMA_VERSION ||
      input.kind !== "mcp-apps-public-session" ||
      !isTraceIdentifier(input.id) ||
      !isTraceLabel(input.name) ||
      input.extensionId !== APPS_EXTENSION_ID ||
      (input.profile !== "stable" && input.profile !== "preview") ||
      !Array.isArray(input.events)
    ) {
      return yield* fail("$", "Input does not match the versioned Apps public session contract")
    }
    const profile: McpAppsProfile = input.profile
    const contract = decodeContract(input.contract, profile)
    const provenance = decodeProvenance(input.provenance)
    const resource = decodeResource(input.resource)
    const events = Array.from(input.events, decodeEvent)
    if (!contract) return yield* fail("contract", "Profile fixture contract is invalid")
    if (!provenance) return yield* fail("provenance", "Fixture provenance is invalid")
    if (!resource) return yield* fail("resource", "Resource linkage is invalid")
    if (events.some(event => event === undefined)) {
      return yield* fail("events", "Apps events must be semantic, correlated, and policy-explicit")
    }
    const graphSource = yield* Effect.try({
      try: () => {
        const source = JSON.stringify(input.graph)
        if (source === undefined) throw new Error("Graph is not JSON serializable")
        return source
      },
      catch: () => fail("graph", "Apps fixture graph must be portable JSON"),
    })
    const graph = yield* parseGraphDocument(graphSource).pipe(
      Effect.mapError(error => fail("graph", error.message ?? "Apps fixture graph is invalid")),
    )
    const decodedEvents = events as ReadonlyArray<AppsPublicEvent>
    yield* validateGraphLinkage(graph, profile, resource, decodedEvents)
    const normalizedInput = {
      id: input.id,
      name: input.name,
      extensionId: APPS_EXTENSION_ID,
      profile,
      contract,
      provenance,
      resource,
      events: decodedEvents,
    }
    return {
      schemaVersion: APPS_FIXTURE_SCHEMA_VERSION,
      kind: "mcp-apps-public-session",
      ...normalizedInput,
      graph,
      normalize: () => normalizeTrace(graph, normalizedInput),
    }
  })

export const publicAppsTraceAdapter: AppsTraceAdapter = { decode: decodeAppsPublicSession }

export const adaptAppsPublicEventSource = <Error>(
  source: AppsPublicEventSource<Error>,
): Effect.Effect<AdaptedAppsPublicSession, Error | AppsTraceAdapterError> =>
  source.read.pipe(
    Effect.flatMap(input => publicAppsTraceAdapter.decode(input)),
    Effect.flatMap(session =>
      session.normalize().pipe(
        Effect.map(trace => ({
          profile: session.profile,
          contract: session.contract,
          graph: session.graph,
          trace,
        })),
      ),
    ),
  )

export interface AppsTraceProjection {
  readonly profile: McpAppsProfile
  readonly contract: AppsFixtureContract
  readonly provenance: AppsFixtureProvenance
  readonly resource: AppsResourceLinkage
  readonly policy: AppsPolicyDeclaration
}

export const projectAppsTraceEvent = (event: McpTraceEvent): AppsTraceProjection | undefined => {
  if (event.family !== "apps" || event.channel !== "apps" || !isRecord(event.payload)) {
    return undefined
  }
  const profile = event.payload.profile
  if (profile !== "stable" && profile !== "preview") return undefined
  const contract = decodeContract(event.payload.contract, profile)
  const provenance = decodeProvenance(event.payload.provenance)
  const resource = decodeResource(event.payload.resource)
  const policy = decodePolicy(event.payload.policy)
  if (!contract || !provenance || !resource || !policy || !policyMatchesKind(event.kind, policy)) {
    return undefined
  }
  return { profile, contract, provenance, resource, policy }
}
