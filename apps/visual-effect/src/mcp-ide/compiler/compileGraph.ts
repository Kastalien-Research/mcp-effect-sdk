import { Effect } from "effect"
import { type McpGraphDocument, validateGraphDocument } from "../model/McpGraphDocument"
import {
  type McpProject,
  type McpProjectAppHost,
  type McpProjectAppHostLink,
  type McpProjectAppRenderLink,
  type McpProjectAppResource,
  type McpProjectAppView,
  type McpProjectCapability,
  type McpProjectClient,
  McpProjectCompilationError,
  type McpProjectExposure,
  type McpProjectGateway,
  type McpProjectIssue,
  type McpProjectRoute,
  type McpProjectServer,
  type McpProjectTask,
  type McpProjectTaskStart,
  type McpProjectTransport,
  sortById,
  sortIssues,
} from "./McpProject"

const repair = (id: string, label: string) => [{ id, label }] as const

const unsafeUriIssue = (path: string): McpProjectIssue => ({
  code: "unsafe-resource-uri",
  severity: "error",
  path,
  explanation: "Resource URI credentials, query parameters, and fragments are not compiler input",
  repairs: repair(
    "remove-sensitive-uri-components",
    "Use a URI without userinfo, query, or fragment",
  ),
})

const uriHasSensitiveComponents = (uri: string): boolean => {
  try {
    const parsed = new URL(uri)
    return (
      parsed.username.length > 0 ||
      parsed.password.length > 0 ||
      parsed.search.length > 0 ||
      parsed.hash.length > 0
    )
  } catch {
    return true
  }
}

const presentation = (node: {
  readonly id: string
  readonly label: string
  readonly description: string
}) => ({
  id: node.id,
  label: node.label,
  description: node.description,
})

const compilationGraphIssues = (error: {
  readonly issues: ReadonlyArray<{ readonly code: string; readonly path: string }>
}): McpProjectCompilationError =>
  new McpProjectCompilationError({
    issues: sortIssues(
      error.issues.map(issue => ({
        code: `graph-${issue.code}`,
        severity: "error" as const,
        path: issue.path,
        explanation: "The graph must pass versioned validation before compilation",
        repairs: repair("repair-graph", "Apply the graph issue repair before compiling"),
      })),
    ),
  })

export const compileGraph = (
  input: McpGraphDocument,
): Effect.Effect<McpProject, McpProjectCompilationError> =>
  Effect.gen(function* () {
    const graph = yield* validateGraphDocument(input).pipe(Effect.mapError(compilationGraphIssues))
    const uriIssues = graph.nodes.flatMap(node => {
      if (node.kind !== "resource" && node.kind !== "app-resource") return []
      return uriHasSensitiveComponents(node.config.uri)
        ? [unsafeUriIssue(`nodes.${node.id}.config.uri`)]
        : []
    })
    if (uriIssues.length > 0) {
      return yield* new McpProjectCompilationError({ issues: sortIssues(uriIssues) })
    }

    const nodesById = new Map(graph.nodes.map(node => [node.id, node]))
    const clients = sortById(
      graph.nodes.flatMap(
        (node): ReadonlyArray<McpProjectClient> =>
          node.kind === "client"
            ? [{ kind: "client", ...presentation(node), transport: node.config.transport }]
            : [],
      ),
    )
    const gateways = sortById(
      graph.nodes.flatMap(
        (node): ReadonlyArray<McpProjectGateway> =>
          node.kind === "gateway"
            ? [{ kind: "gateway", ...presentation(node), strategy: node.config.strategy }]
            : [],
      ),
    )
    const servers = sortById(
      graph.nodes.flatMap(
        (node): ReadonlyArray<McpProjectServer> =>
          node.kind === "server"
            ? [{ kind: "server", ...presentation(node), domain: node.config.domain }]
            : [],
      ),
    )
    const capabilities = sortById(
      graph.nodes.flatMap((node): ReadonlyArray<McpProjectCapability> => {
        switch (node.kind) {
          case "tool":
            return [{ kind: "tool", ...presentation(node), resultType: node.config.resultType }]
          case "resource":
            return [{ kind: "resource", ...presentation(node), uri: node.config.uri }]
          case "prompt":
            return [{ kind: "prompt", ...presentation(node), name: node.config.name }]
          default:
            return []
        }
      }),
    )
    const tasks = sortById(
      graph.nodes.flatMap(
        (node): ReadonlyArray<McpProjectTask> =>
          node.kind === "task"
            ? [
                {
                  kind: "task",
                  ...presentation(node),
                  pollingIntervalMs: node.config.pollingIntervalMs,
                },
              ]
            : [],
      ),
    )
    const resources = sortById(
      graph.nodes.flatMap(
        (node): ReadonlyArray<McpProjectAppResource> =>
          node.kind === "app-resource"
            ? [
                {
                  kind: "app-resource",
                  ...presentation(node),
                  uri: node.config.uri,
                  profile: node.config.profile,
                },
              ]
            : [],
      ),
    )
    const views = sortById(
      graph.nodes.flatMap(
        (node): ReadonlyArray<McpProjectAppView> =>
          node.kind === "app-view"
            ? [
                {
                  kind: "app-view",
                  ...presentation(node),
                  profile: node.config.profile,
                  sandbox: node.config.sandbox,
                },
              ]
            : [],
      ),
    )
    const hosts = sortById(
      graph.nodes.flatMap(
        (node): ReadonlyArray<McpProjectAppHost> =>
          node.kind === "app-host"
            ? [{ kind: "app-host", ...presentation(node), profile: node.config.profile }]
            : [],
      ),
    )

    const transports: Array<McpProjectTransport> = []
    const routes: Array<McpProjectRoute> = []
    const exposures: Array<McpProjectExposure> = []
    const taskStarts: Array<McpProjectTaskStart> = []
    const renderLinks: Array<McpProjectAppRenderLink> = []
    const hostLinks: Array<McpProjectAppHostLink> = []

    for (const edge of sortById(graph.edges)) {
      const source = nodesById.get(edge.source)
      const target = nodesById.get(edge.target)
      if (!source || !target) continue

      switch (edge.kind) {
        case "transport":
          if (source.kind === "client" && (target.kind === "gateway" || target.kind === "server")) {
            transports.push({
              kind: source.config.transport,
              id: edge.id,
              clientId: source.id,
              target: { kind: target.kind, id: target.id },
            })
          } else if (
            source.kind === "gateway" &&
            (target.kind === "gateway" || target.kind === "server")
          ) {
            routes.push({
              kind: "gateway-transport",
              id: edge.id,
              gatewayId: source.id,
              target: { kind: target.kind, id: target.id },
            })
          }
          break
        case "routes":
          if (
            source.kind === "gateway" &&
            (target.kind === "gateway" || target.kind === "server")
          ) {
            routes.push({
              kind: "gateway-route",
              id: edge.id,
              gatewayId: source.id,
              target: { kind: target.kind, id: target.id },
            })
          }
          break
        case "exposes":
          if (
            source.kind === "server" &&
            (target.kind === "tool" ||
              target.kind === "resource" ||
              target.kind === "prompt" ||
              target.kind === "app-resource")
          ) {
            exposures.push({
              kind: "exposure",
              id: edge.id,
              serverId: source.id,
              target: { kind: target.kind, id: target.id },
            })
          }
          break
        case "starts":
          if (source.kind === "tool" && target.kind === "task") {
            taskStarts.push({
              kind: "task-start",
              id: edge.id,
              toolId: source.id,
              taskId: target.id,
            })
          }
          break
        case "renders":
          if (
            (source.kind === "tool" && target.kind === "app-resource") ||
            (source.kind === "app-resource" && target.kind === "app-view")
          ) {
            renderLinks.push({
              kind: "app-render",
              id: edge.id,
              source: { kind: source.kind, id: source.id },
              target: { kind: target.kind, id: target.id },
            })
          }
          break
        case "hosts":
          if (source.kind === "app-host" && target.kind === "app-view") {
            hostLinks.push({
              kind: "app-hosting",
              id: edge.id,
              hostId: source.id,
              viewId: target.id,
            })
          }
          break
      }
    }

    const coreCapabilityKinds = new Map(
      capabilities.map(capability => [capability.id, capability.kind]),
    )
    const handlers = sortById(
      exposures.flatMap(exposure => {
        const capabilityKind = coreCapabilityKinds.get(exposure.target.id)
        return capabilityKind
          ? [
              {
                kind: `${capabilityKind}-handler` as const,
                id: `handler:${exposure.serverId}:${exposure.target.id}`,
                serverId: exposure.serverId,
                capabilityId: exposure.target.id,
                implementation: "required" as const,
              },
            ]
          : []
      }),
    )
    const requiredEnvironmentInputs = clients.some(client => client.transport === "streamable-http")
      ? ([
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
        ] as const)
      : []

    return {
      schemaVersion: "1",
      kind: "mcp-effect-project",
      source: {
        graphSchemaVersion: graph.schemaVersion,
        graphId: graph.id,
        graphRevision: graph.revision,
      },
      clients,
      gateways,
      servers,
      transports: sortById(transports),
      capabilities,
      exposures: sortById(exposures),
      handlers,
      routes: sortById(routes),
      tasks,
      taskStarts: sortById(taskStarts),
      apps: {
        resources,
        views,
        hosts,
        renderLinks: sortById(renderLinks),
        hostLinks: sortById(hostLinks),
      },
      requiredEnvironmentInputs,
    }
  })
