import { Effect, Either } from "effect"
import { describe, expect, it } from "vitest"
import { withGraphRevision } from "../model/GraphFingerprint"
import type { McpGraphDocument, McpGraphNode } from "../model/McpGraphDocument"
import { instantiateBeginnerToolTemplate } from "../templates/beginnerTool"
import { makeProfessionalGraph } from "../templates/proGatewayTasksApps"
import { type CompilerBackend, effectScaffoldV1, McpProjectRenderError } from "./CompilerBackend"
import { compileGraph } from "./compileGraph"
import type { McpProject } from "./McpProject"
import { renderProject } from "./renderProject"

const compile = (graph: McpGraphDocument): McpProject => Effect.runSync(compileGraph(graph))

const beginnerGraph = (): McpGraphDocument =>
  Effect.runSync(instantiateBeginnerToolTemplate()).graph

const expectedBeginnerProject = (graph: McpGraphDocument): McpProject => ({
  schemaVersion: "1",
  kind: "mcp-effect-project",
  source: {
    graphSchemaVersion: "2",
    graphId: "beginner-tool-server",
    graphRevision: graph.revision,
  },
  clients: [
    {
      kind: "client",
      id: "client",
      label: "Starter client",
      description: "Calls the hello tool",
      transport: "streamable-http",
    },
  ],
  gateways: [],
  servers: [
    {
      kind: "server",
      id: "server",
      label: "Hello server",
      description: "A beginner-friendly vertical MCP server",
      domain: "hello",
    },
  ],
  transports: [
    {
      kind: "streamable-http",
      id: "client-server",
      clientId: "client",
      target: { kind: "server", id: "server" },
    },
  ],
  capabilities: [
    {
      kind: "tool",
      id: "tool",
      label: "hello.world",
      description: "Returns a small content result",
      resultType: "content",
    },
  ],
  exposures: [
    {
      kind: "exposure",
      id: "server-tool",
      serverId: "server",
      target: { kind: "tool", id: "tool" },
    },
  ],
  handlers: [
    {
      kind: "tool-handler",
      id: "handler:server:tool",
      serverId: "server",
      capabilityId: "tool",
      implementation: "required",
    },
  ],
  routes: [],
  tasks: [],
  taskStarts: [],
  apps: { resources: [], views: [], hosts: [], renderLinks: [], hostLinks: [] },
  requiredEnvironmentInputs: [
    {
      kind: "environment-input",
      name: "MCP_HOST",
      purpose: "Streamable HTTP bind host",
      required: true,
    },
    {
      kind: "environment-input",
      name: "MCP_PORT",
      purpose: "Streamable HTTP bind port",
      required: true,
    },
  ],
})

const expectedProfessionalProject = (graph: McpGraphDocument): McpProject => ({
  schemaVersion: "1",
  kind: "mcp-effect-project",
  source: {
    graphSchemaVersion: "2",
    graphId: "professional-gateway-tasks-apps",
    graphRevision: graph.revision,
  },
  clients: [
    {
      kind: "client",
      id: "client",
      label: "Operations client",
      description: "Calls the field operations gateway",
      transport: "streamable-http",
    },
  ],
  gateways: [
    {
      kind: "gateway",
      id: "gateway",
      label: "Capability gateway",
      description: "Routes by advertised capability",
      strategy: "capability",
    },
  ],
  servers: [
    {
      kind: "server",
      id: "server",
      label: "Field operations",
      description: "Vertical server for field observations",
      domain: "field-operations",
    },
  ],
  transports: [
    {
      kind: "streamable-http",
      id: "client-gateway",
      clientId: "client",
      target: { kind: "gateway", id: "gateway" },
    },
  ],
  capabilities: [
    {
      kind: "tool",
      id: "tool",
      label: "observations.collect",
      description: "Starts an asynchronous collection task",
      resultType: "task",
    },
  ],
  exposures: [
    {
      kind: "exposure",
      id: "server-app-resource",
      serverId: "server",
      target: { kind: "app-resource", id: "app-resource" },
    },
    {
      kind: "exposure",
      id: "server-tool",
      serverId: "server",
      target: { kind: "tool", id: "tool" },
    },
  ],
  handlers: [
    {
      kind: "tool-handler",
      id: "handler:server:tool",
      serverId: "server",
      capabilityId: "tool",
      implementation: "required",
    },
  ],
  routes: [
    {
      kind: "gateway-route",
      id: "gateway-server",
      gatewayId: "gateway",
      target: { kind: "server", id: "server" },
    },
  ],
  tasks: [
    {
      kind: "task",
      id: "task",
      label: "Collection task",
      description: "Tracks asynchronous field work",
      pollingIntervalMs: 1000,
    },
  ],
  taskStarts: [{ kind: "task-start", id: "tool-task", toolId: "tool", taskId: "task" }],
  apps: {
    resources: [
      {
        kind: "app-resource",
        id: "app-resource",
        label: "Observations UI resource",
        description: "Fixture linkage for the observations view",
        uri: "ui://field-operations/observations",
        profile: "stable",
      },
    ],
    views: [
      {
        kind: "app-view",
        id: "app-view",
        label: "Observations view",
        description: "Stable-profile fixture view",
        profile: "stable",
        sandbox: true,
      },
    ],
    hosts: [
      {
        kind: "app-host",
        id: "app-host",
        label: "Operations host",
        description: "Fixture-only host declaration",
        profile: "stable",
      },
    ],
    renderLinks: [
      {
        kind: "app-render",
        id: "app-resource-view",
        source: { kind: "app-resource", id: "app-resource" },
        target: { kind: "app-view", id: "app-view" },
      },
      {
        kind: "app-render",
        id: "tool-app-resource",
        source: { kind: "tool", id: "tool" },
        target: { kind: "app-resource", id: "app-resource" },
      },
    ],
    hostLinks: [
      {
        kind: "app-hosting",
        id: "app-host-view",
        hostId: "app-host",
        viewId: "app-view",
      },
    ],
  },
  requiredEnvironmentInputs: [
    {
      kind: "environment-input",
      name: "MCP_HOST",
      purpose: "Streamable HTTP bind host",
      required: true,
    },
    {
      kind: "environment-input",
      name: "MCP_PORT",
      purpose: "Streamable HTTP bind port",
      required: true,
    },
  ],
})

const readme = `# Inspectable Effect MCP scaffold

This deterministic project is an inspectable Effect 3 scaffold, not a runnable MCP server.
Every handler is an explicit typed failure until application behavior is implemented.

## Run

The executable Effect MCP SDK backend is pending upstream reconciliation. There is no run command in this scaffold.

## Verify

Inspect \`mcp-project.json\`, then review every declaration in \`src/project.ts\` and every placeholder in \`src/handlers.ts\`.
The file \`test/project.spec.ts\` documents the required failure-only placeholder contract.
Typecheck those TypeScript files in an Effect 3 workspace; this scaffold intentionally provides no server run command.
`

const projectSource = (project: McpProject): string =>
  `export const project = ${JSON.stringify(project, null, 2)} as const\n`

const handlerSource = (project: McpProject): string => `import { Data, Effect } from "effect"

export class HandlerNotImplemented extends Data.TaggedError("HandlerNotImplemented")<{
  readonly handlerId: string
}> {}

export const handlerRequirements = ${JSON.stringify(project.handlers, null, 2)} as const

export const makeHandlerPlaceholder = (
  handler: (typeof handlerRequirements)[number],
): Effect.Effect<never, HandlerNotImplemented> =>
  Effect.fail(new HandlerNotImplemented({ handlerId: handler.id }))
`

const testSource = `import { Effect, Either } from "effect"
import { handlerRequirements, makeHandlerPlaceholder } from "../src/handlers"

for (const handler of handlerRequirements) {
  const result = Effect.runSync(makeHandlerPlaceholder(handler).pipe(Effect.either))
  if (Either.isRight(result)) throw new Error("placeholder handlers must not report success")
}
`

const expectedFiles = (project: McpProject) =>
  [
    { path: "README.md", mediaType: "text/markdown", text: readme },
    {
      path: "mcp-project.json",
      mediaType: "application/json",
      text: `${JSON.stringify(project, null, 2)}\n`,
    },
    { path: "src/handlers.ts", mediaType: "text/typescript", text: handlerSource(project) },
    { path: "src/project.ts", mediaType: "text/typescript", text: projectSource(project) },
    { path: "test/project.spec.ts", mediaType: "text/typescript", text: testSource },
  ] as const

const node = <Kind extends McpGraphNode["kind"]>(
  value: Extract<McpGraphNode, { readonly kind: Kind }>,
) => value

const makeDirectGraph = (
  options: { readonly transport?: "streamable-http" | "stdio" } = {},
): McpGraphDocument =>
  withGraphRevision({
    schemaVersion: "2",
    id: "direct-project",
    name: "Direct project",
    description: "One direct vertical server",
    nodes: [
      node({
        id: "client",
        kind: "client",
        label: "Client",
        description: "Direct client",
        position: { x: 0, y: 0 },
        config: { transport: options.transport ?? "streamable-http" },
      }),
      node({
        id: "server",
        kind: "server",
        label: "Server",
        description: "Direct server",
        position: { x: 1, y: 0 },
        config: { domain: "direct" },
      }),
      node({
        id: "tool",
        kind: "tool",
        label: "tool",
        description: "Tool",
        position: { x: 2, y: 0 },
        config: { resultType: "content" },
      }),
    ],
    edges: [
      { id: "client-server", kind: "transport", source: "client", target: "server" },
      { id: "server-tool", kind: "exposes", source: "server", target: "tool" },
    ],
  })

describe("MCP project compiler", () => {
  it("compiles the beginner template to the complete canonical backend-neutral IR", () => {
    const graph = beginnerGraph()
    expect(compile(graph)).toEqual(expectedBeginnerProject(graph))
  })

  it("compiles the professional template without dropping gateway, Task, or explicit Apps semantics", () => {
    const graph = makeProfessionalGraph()
    expect(compile(graph)).toEqual(expectedProfessionalProject(graph))
  })

  it("keeps gateway-origin transport edges as explicit routing without inventing transport config", () => {
    const professional = makeProfessionalGraph()
    const graph = withGraphRevision({
      ...professional,
      edges: professional.edges.map(edge =>
        edge.id === "gateway-server" ? { ...edge, kind: "transport" as const } : edge,
      ),
    })
    const project = compile(graph)

    expect(project.routes).toEqual([
      {
        kind: "gateway-transport",
        id: "gateway-server",
        gatewayId: "gateway",
        target: { kind: "server", id: "server" },
      },
    ])
    expect(project.transports).toEqual([
      {
        kind: "streamable-http",
        id: "client-gateway",
        clientId: "client",
        target: { kind: "gateway", id: "gateway" },
      },
    ])
  })

  it("renders every deterministic byte of the direct streamable-http scaffold", () => {
    const graph = beginnerGraph()
    const project = compile(graph)
    const first = Effect.runSync(renderProject(project))
    const second = Effect.runSync(renderProject(compile(graph)))

    expect(first).toEqual({
      schemaVersion: "1",
      kind: "rendered-mcp-project",
      backend: { id: "effect-scaffold-v1", version: "1" },
      source: project.source,
      files: expectedFiles(project),
    })
    expect(second).toEqual(first)
    expect(first.files.map(file => file.path)).toEqual([
      "README.md",
      "mcp-project.json",
      "src/handlers.ts",
      "src/project.ts",
      "test/project.spec.ts",
    ])
    expect(first.files.every(file => !file.path.includes("..") && !file.path.startsWith("/"))).toBe(
      true,
    )
  })

  it("supports stdio without inventing network environment inputs", () => {
    const project = compile(makeDirectGraph({ transport: "stdio" }))
    expect(project.transports).toEqual([
      {
        kind: "stdio",
        id: "client-server",
        clientId: "client",
        target: { kind: "server", id: "server" },
      },
    ])
    expect(project.requiredEnvironmentInputs).toEqual([])
    expect(Effect.runSync(renderProject(project)).files).toEqual(expectedFiles(project))
  })

  it("derives direct tool, resource, and prompt handlers only from exposes edges", () => {
    const base = makeDirectGraph({ transport: "stdio" })
    const graph = withGraphRevision({
      ...base,
      name: `Quotes " slash / Unicode λ`,
      nodes: [
        ...base.nodes,
        node({
          id: "resource",
          kind: "resource",
          label: `Resource "λ"`,
          description: "Line one\nLine two",
          position: { x: 3, y: 0 },
          config: { uri: "resource://docs/λ/path" },
        }),
        node({
          id: "prompt",
          kind: "prompt",
          label: "Prompt",
          description: "Prompt description",
          position: { x: 4, y: 0 },
          config: { name: `say "hello"\nnow` },
        }),
      ],
      edges: [
        ...base.edges,
        { id: "server-resource", kind: "exposes" as const, source: "server", target: "resource" },
        { id: "server-prompt", kind: "exposes" as const, source: "server", target: "prompt" },
      ],
    })
    const project = compile(graph)
    const rendered = Effect.runSync(renderProject(project))

    expect(project.capabilities.map(capability => capability.kind)).toEqual([
      "prompt",
      "resource",
      "tool",
    ])
    expect(project.handlers.map(handler => handler.kind)).toEqual([
      "prompt-handler",
      "resource-handler",
      "tool-handler",
    ])
    expect(rendered.files).toEqual(expectedFiles(project))
    expect(
      JSON.parse(rendered.files.find(file => file.path === "mcp-project.json")?.text ?? ""),
    ).toEqual(project)
  })

  it("returns the complete professional backend issue set with repairs and no partial files", () => {
    const result = Effect.runSync(
      renderProject(compile(makeProfessionalGraph())).pipe(Effect.either),
    )
    expect(Either.isLeft(result)).toBe(true)
    if (Either.isRight(result)) return

    expect(result.left).toBeInstanceOf(McpProjectRenderError)
    expect(result.left.issues.map(issue => `${issue.code}@${issue.path}`)).toEqual([
      "unsupported-app-hosting@apps.hostLinks.app-host-view",
      "unsupported-app-host@apps.hosts.app-host",
      "unsupported-app-render@apps.renderLinks.app-resource-view",
      "unsupported-app-render@apps.renderLinks.tool-app-resource",
      "unsupported-app-resource@apps.resources.app-resource",
      "unsupported-app-view@apps.views.app-view",
      "unsupported-task-result@capabilities.tool",
      "unsupported-app-exposure@exposures.server-app-resource",
      "unsupported-gateway@gateways.gateway",
      "unsupported-route@routes.gateway-server",
      "unsupported-task-start@taskStarts.tool-task",
      "unsupported-task@tasks.task",
      "unsupported-indirect-transport@transports.client-gateway",
    ])
    expect(result.left.issues.every(issue => issue.repairs.length > 0)).toBe(true)
    expect(result.left).not.toHaveProperty("files")
  })

  it("returns the bounded zero, multiple, detached, and conflicting ownership issue batches", () => {
    const empty = withGraphRevision({
      schemaVersion: "2" as const,
      id: "empty",
      name: "Empty",
      description: "Empty",
      nodes: [],
      edges: [],
    })
    const detachedBase = makeDirectGraph({ transport: "stdio" })
    const detached = withGraphRevision({ ...detachedBase, edges: [] })
    const multiple = withGraphRevision({
      ...makeDirectGraph({ transport: "stdio" }),
      nodes: [
        ...makeDirectGraph({ transport: "stdio" }).nodes,
        node({
          id: "server-b",
          kind: "server",
          label: "Server B",
          description: "Second owner",
          position: { x: 5, y: 0 },
          config: { domain: "second" },
        }),
      ],
      edges: [
        ...makeDirectGraph({ transport: "stdio" }).edges,
        { id: "server-b-tool", kind: "exposes" as const, source: "server-b", target: "tool" },
      ],
    })

    const issues = (graph: McpGraphDocument) => {
      const result = Effect.runSync(renderProject(compile(graph)).pipe(Effect.either))
      if (Either.isRight(result)) throw new Error("expected backend issues")
      return result.left.issues.map(issue => `${issue.code}@${issue.path}`)
    }

    expect(issues(empty)).toEqual([
      "direct-capability-required@capabilities",
      "direct-client-required@clients",
      "server-count@servers",
    ])
    expect(issues(detached)).toEqual([
      "direct-capability-required@capabilities",
      "detached-capability@capabilities.tool",
      "direct-client-required@clients",
      "detached-client@clients.client",
      "detached-server@servers.server",
    ])
    expect(issues(multiple)).toEqual([
      "conflicting-server-ownership@capabilities.tool",
      "server-count@servers",
    ])
  })

  it("keeps invalid graphs, malformed references, and backend failures in typed Effect channels", () => {
    const invalidRevision = { ...makeDirectGraph(), revision: "stale" }
    const malformed = withGraphRevision({
      ...makeDirectGraph(),
      edges: [
        {
          id: "client-server",
          kind: "transport",
          source: "client",
          target: "missing-server",
        },
      ],
    } as McpGraphDocument)
    const invalid = Effect.runSync(compileGraph(invalidRevision).pipe(Effect.either))
    const missing = Effect.runSync(compileGraph(malformed).pipe(Effect.either))

    expect(Either.isLeft(invalid) && invalid.left._tag).toBe("McpProjectCompilationError")
    expect(Either.isLeft(missing) && missing.left._tag).toBe("McpProjectCompilationError")

    const backendIssue = {
      code: "backend-unavailable",
      severity: "error",
      path: "backend",
      explanation: "The selected backend is unavailable",
      repairs: [{ id: "select-backend", label: "Select an available backend" }],
    } as const
    const failingBackend: CompilerBackend = {
      id: "failing-backend",
      version: "1",
      render: () =>
        Effect.fail(
          new McpProjectRenderError({ backendId: "failing-backend", issues: [backendIssue] }),
        ),
    }
    const failed = Effect.runSync(
      renderProject(compile(makeDirectGraph()), failingBackend).pipe(Effect.either),
    )
    expect(Either.isLeft(failed) && failed.left).toEqual(
      new McpProjectRenderError({ backendId: "failing-backend", issues: [backendIssue] }),
    )
    expect(effectScaffoldV1.id).toBe("effect-scaffold-v1")
  })

  it.each([
    "https://user:RAW_SECRET@example.test/data",
    "https://example.test/data?token=RAW_SECRET",
    "https://example.test/data#RAW_SECRET",
    "ui://user:RAW_SECRET@example.test/view",
    "ui://example.test/view?token=RAW_SECRET",
    "ui://example.test/view#RAW_SECRET",
  ])("rejects secret-bearing URI components without echoing them: %s", uri => {
    const base = makeDirectGraph({ transport: "stdio" })
    const isApp = uri.startsWith("ui:")
    const unsafeNode = isApp
      ? node({
          id: "unsafe",
          kind: "app-resource",
          label: "Unsafe app resource",
          description: "Must be rejected",
          position: { x: 4, y: 0 },
          config: { uri, profile: "stable" },
        })
      : node({
          id: "unsafe",
          kind: "resource",
          label: "Unsafe resource",
          description: "Must be rejected",
          position: { x: 4, y: 0 },
          config: { uri },
        })
    const graph = withGraphRevision({
      ...base,
      nodes: [...base.nodes, unsafeNode],
      edges: [
        ...base.edges,
        { id: "server-unsafe", kind: "exposes" as const, source: "server", target: "unsafe" },
      ],
    })
    const result = Effect.runSync(compileGraph(graph).pipe(Effect.either))

    expect(Either.isLeft(result) && result.left._tag).toBe("McpProjectCompilationError")
    expect(JSON.stringify(result)).not.toContain("RAW_SECRET")
    expect(JSON.stringify(result)).not.toContain(uri)
  })

  it("does not ingest ambient environment, time, random, machine paths, or fixture payloads", () => {
    const sentinel = "AMBIENT_RAW_SECRET_SENTINEL"
    process.env.MCP_COMPILER_SENTINEL = sentinel
    try {
      const project = compile(makeDirectGraph())
      const rendered = Effect.runSync(renderProject(project))
      const output = JSON.stringify(rendered)

      expect(output).not.toContain(sentinel)
      expect(output).not.toContain(process.cwd())
      expect(output).not.toMatch(/20\d\d-\d\d-\d\dT/)
      expect(output).not.toContain("Hello from Effect MCP")
      expect(output).not.toContain("Math.random")
    } finally {
      delete process.env.MCP_COMPILER_SENTINEL
    }
  })
})
