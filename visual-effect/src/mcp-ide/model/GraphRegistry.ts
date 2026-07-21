import { Either, ParseResult, Schema } from "effect"

export type McpAppsProfile = "stable" | "preview"

export const GraphIdentifierSchema = Schema.String.pipe(Schema.trimmed(), Schema.minLength(1))

const TrimmedNonEmptyString = Schema.String.pipe(Schema.trimmed(), Schema.minLength(1))
const AbsoluteUri = TrimmedNonEmptyString.pipe(
  Schema.filter(
    value => {
      try {
        return new URL(value).protocol.length > 1
      } catch {
        return false
      }
    },
    { message: () => "Expected an absolute URI" },
  ),
)
const UiResourceUri = AbsoluteUri.pipe(
  Schema.filter(value => value.startsWith("ui://") && new URL(value).protocol === "ui:", {
    message: () => 'Expected a "ui://" URI',
  }),
)
const PositiveInteger = Schema.Number.pipe(Schema.finite(), Schema.int(), Schema.positive())
const AppsProfile = Schema.Literal("stable", "preview")

export const isGraphIdentifier = (value: string): boolean =>
  Either.isRight(Schema.decodeUnknownEither(GraphIdentifierSchema)(value))

const defineNode = <Kind extends string, ConfigSchema extends Schema.Schema.Any>(definition: {
  readonly kind: Kind
  readonly configSchema: ConfigSchema
  readonly defaultConfig: Schema.Schema.Type<ConfigSchema>
  readonly defaultLabel: string
  readonly defaultDescription: string
  readonly paletteGroup: "protocol" | "capabilities" | "runtime-apps"
  readonly paletteLabel: string
  readonly displayLabel: string
  readonly signal: string
}) => definition

export const graphNodeRegistry = {
  client: defineNode({
    kind: "client",
    configSchema: Schema.Struct({
      transport: Schema.Literal("streamable-http", "stdio"),
    }),
    defaultConfig: { transport: "streamable-http" },
    defaultLabel: "MCP client",
    defaultDescription: "Initiates requests to an MCP server",
    paletteGroup: "protocol",
    paletteLabel: "Client",
    displayLabel: "MCP CLIENT",
    signal: "HTTP",
  }),
  gateway: defineNode({
    kind: "gateway",
    configSchema: Schema.Struct({ strategy: Schema.Literal("capability") }),
    defaultConfig: { strategy: "capability" },
    defaultLabel: "Capability gateway",
    defaultDescription: "Routes MCP capabilities to a target server",
    paletteGroup: "protocol",
    paletteLabel: "Gateway",
    displayLabel: "GATEWAY",
    signal: "ROUTE",
  }),
  server: defineNode({
    kind: "server",
    configSchema: Schema.Struct({ domain: TrimmedNonEmptyString }),
    defaultConfig: { domain: "application" },
    defaultLabel: "MCP server",
    defaultDescription: "Composes capabilities for an application domain",
    paletteGroup: "protocol",
    paletteLabel: "Server",
    displayLabel: "MCP SERVER",
    signal: "VERTICAL",
  }),
  tool: defineNode({
    kind: "tool",
    configSchema: Schema.Struct({ resultType: Schema.Literal("content", "task") }),
    defaultConfig: { resultType: "content" },
    defaultLabel: "tool.call",
    defaultDescription: "Performs an action in the world",
    paletteGroup: "capabilities",
    paletteLabel: "Tool",
    displayLabel: "TOOL",
    signal: "CALL",
  }),
  resource: defineNode({
    kind: "resource",
    configSchema: Schema.Struct({ uri: AbsoluteUri }),
    defaultConfig: { uri: "resource://example" },
    defaultLabel: "Resource",
    defaultDescription: "Exposes readable application context",
    paletteGroup: "capabilities",
    paletteLabel: "Resource",
    displayLabel: "RESOURCE",
    signal: "READ",
  }),
  prompt: defineNode({
    kind: "prompt",
    configSchema: Schema.Struct({ name: TrimmedNonEmptyString }),
    defaultConfig: { name: "example-prompt" },
    defaultLabel: "Prompt",
    defaultDescription: "Provides a reusable prompt template",
    paletteGroup: "capabilities",
    paletteLabel: "Prompt",
    displayLabel: "PROMPT",
    signal: "GET",
  }),
  task: defineNode({
    kind: "task",
    configSchema: Schema.Struct({ pollingIntervalMs: PositiveInteger }),
    defaultConfig: { pollingIntervalMs: 1000 },
    defaultLabel: "Async task",
    defaultDescription: "Tracks long-running work and elicitation",
    paletteGroup: "runtime-apps",
    paletteLabel: "Task",
    displayLabel: "ASYNC TASK",
    signal: "POLL",
  }),
  "app-host": defineNode({
    kind: "app-host",
    configSchema: Schema.Struct({ profile: AppsProfile }),
    defaultConfig: { profile: "stable" },
    defaultLabel: "Apps host",
    defaultDescription: "Hosts sandboxed MCP App views",
    paletteGroup: "runtime-apps",
    paletteLabel: "App host",
    displayLabel: "APPS HOST",
    signal: "HOST",
  }),
  "app-view": defineNode({
    kind: "app-view",
    configSchema: Schema.Struct({ sandbox: Schema.Boolean, profile: AppsProfile }),
    defaultConfig: { sandbox: true, profile: "stable" },
    defaultLabel: "App view",
    defaultDescription: "Renders interactive MCP App UI",
    paletteGroup: "runtime-apps",
    paletteLabel: "App view",
    displayLabel: "APPS VIEW",
    signal: "VIEW",
  }),
  "app-resource": defineNode({
    kind: "app-resource",
    configSchema: Schema.Struct({ uri: UiResourceUri, profile: AppsProfile }),
    defaultConfig: { uri: "ui://example/view", profile: "stable" },
    defaultLabel: "UI resource",
    defaultDescription: "Links a tool result to an MCP App resource",
    paletteGroup: "runtime-apps",
    paletteLabel: "UI resource",
    displayLabel: "UI RESOURCE",
    signal: "UI://",
  }),
} as const

export type McpNodeKind = keyof typeof graphNodeRegistry

type ConfigSchemaFor<Kind extends McpNodeKind> = (typeof graphNodeRegistry)[Kind]["configSchema"]

export type McpNodeConfig<Kind extends McpNodeKind = McpNodeKind> = Kind extends McpNodeKind
  ? Schema.Schema.Type<ConfigSchemaFor<Kind>>
  : never

export interface McpGraphNodeFields {
  readonly id: string
  readonly label: string
  readonly description: string
  readonly position: {
    readonly x: number
    readonly y: number
  }
}

export type McpGraphNode = {
  readonly [Kind in McpNodeKind]: McpGraphNodeFields & {
    readonly kind: Kind
    readonly config: McpNodeConfig<Kind>
  }
}[McpNodeKind]

const nodeKinds = Object.keys(graphNodeRegistry) as [McpNodeKind, ...Array<McpNodeKind>]

export const GRAPH_NODE_KINDS: ReadonlyArray<McpNodeKind> = nodeKinds
export const McpNodeKindSchema = Schema.Literal(...nodeKinds)

export const graphNodeDefinition = <Kind extends McpNodeKind>(kind: Kind) => graphNodeRegistry[kind]

export const defaultNodePresentation = <Kind extends McpNodeKind>(kind: Kind) => {
  const definition = graphNodeRegistry[kind]
  return {
    label: definition.defaultLabel,
    description: definition.defaultDescription,
    config: { ...definition.defaultConfig } as McpNodeConfig<Kind>,
  }
}

export const decodeNodeConfig = <Kind extends McpNodeKind>(
  kind: Kind,
  input: unknown,
): Either.Either<McpNodeConfig<Kind>, ParseResult.ParseError> =>
  Schema.decodeUnknownEither(
    graphNodeRegistry[kind].configSchema as unknown as Schema.Schema<McpNodeConfig<Kind>, unknown>,
    {
      errors: "all",
      onExcessProperty: "error",
    },
  )(input)

export const formatNodeConfigError = (error: ParseResult.ParseError): string =>
  ParseResult.TreeFormatter.formatErrorSync(error)

const defineEdge = <Pairs extends ReadonlyArray<readonly [McpNodeKind, McpNodeKind]>>(definition: {
  readonly label: string
  readonly inferencePriority: number
  readonly pairs: Pairs
}) => definition

export const graphEdgeRegistry = {
  transport: defineEdge({
    label: "Transport",
    inferencePriority: 20,
    pairs: [
      ["client", "gateway"],
      ["client", "server"],
      ["gateway", "gateway"],
      ["gateway", "server"],
    ],
  }),
  routes: defineEdge({
    label: "Routes",
    inferencePriority: 10,
    pairs: [
      ["gateway", "gateway"],
      ["gateway", "server"],
    ],
  }),
  exposes: defineEdge({
    label: "Exposes",
    inferencePriority: 30,
    pairs: [
      ["server", "tool"],
      ["server", "resource"],
      ["server", "prompt"],
      ["server", "app-resource"],
    ],
  }),
  starts: defineEdge({
    label: "Starts",
    inferencePriority: 40,
    pairs: [["tool", "task"]],
  }),
  renders: defineEdge({
    label: "Renders",
    inferencePriority: 50,
    pairs: [
      ["tool", "app-resource"],
      ["app-resource", "app-view"],
    ],
  }),
  hosts: defineEdge({
    label: "Hosts",
    inferencePriority: 60,
    pairs: [["app-host", "app-view"]],
  }),
} as const

export type McpEdgeKind = keyof typeof graphEdgeRegistry

export interface McpGraphEdge {
  readonly id: string
  readonly kind: McpEdgeKind
  readonly source: string
  readonly target: string
  readonly label?: string
}

const edgeKinds = Object.keys(graphEdgeRegistry) as [McpEdgeKind, ...Array<McpEdgeKind>]

export const GRAPH_EDGE_KINDS: ReadonlyArray<McpEdgeKind> = edgeKinds
export const McpEdgeKindSchema = Schema.Literal(...edgeKinds)

const hasPair = (
  pairs: ReadonlyArray<readonly [McpNodeKind, McpNodeKind]>,
  source: McpNodeKind,
  target: McpNodeKind,
): boolean => pairs.some(pair => pair[0] === source && pair[1] === target)

export const isCompatibleEdge = (
  kind: McpEdgeKind,
  source: McpNodeKind,
  target: McpNodeKind,
): boolean => hasPair(graphEdgeRegistry[kind].pairs, source, target)

export const compatibleEdgeKinds = (
  source: McpNodeKind,
  target: McpNodeKind,
): ReadonlyArray<McpEdgeKind> => edgeKinds.filter(kind => isCompatibleEdge(kind, source, target))

export const inferCompatibleEdgeKind = (
  source: McpNodeKind,
  target: McpNodeKind,
): McpEdgeKind | undefined =>
  compatibleEdgeKinds(source, target).toSorted(
    (left, right) =>
      graphEdgeRegistry[left].inferencePriority - graphEdgeRegistry[right].inferencePriority,
  )[0]

export const graphNodePorts = (
  kind: McpNodeKind,
): { readonly input: boolean; readonly output: boolean } => ({
  input: edgeKinds.some(edgeKind =>
    graphEdgeRegistry[edgeKind].pairs.some(pair => pair[1] === kind),
  ),
  output: edgeKinds.some(edgeKind =>
    graphEdgeRegistry[edgeKind].pairs.some(pair => pair[0] === kind),
  ),
})
