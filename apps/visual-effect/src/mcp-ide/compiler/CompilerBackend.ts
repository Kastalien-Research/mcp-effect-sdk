import { Data, Effect } from "effect"
import { compareCodePoints, type McpProject, type McpProjectIssue, sortIssues } from "./McpProject"

export interface McpGeneratedFile {
  readonly path: string
  readonly mediaType: "application/json" | "text/markdown" | "text/typescript"
  readonly text: string
}

export class McpProjectRenderError extends Data.TaggedError("McpProjectRenderError")<{
  readonly backendId: string
  readonly issues: ReadonlyArray<McpProjectIssue>
}> {}

export interface CompilerBackend {
  readonly id: string
  readonly version: string
  readonly render: (
    project: McpProject,
  ) => Effect.Effect<ReadonlyArray<McpGeneratedFile>, McpProjectRenderError>
}

const issue = (
  code: string,
  path: string,
  explanation: string,
  repairId: string,
  repairLabel: string,
): McpProjectIssue => ({
  code,
  severity: "error",
  path,
  explanation,
  repairs: [{ id: repairId, label: repairLabel }],
})

export const effectScaffoldIssues = (project: McpProject): ReadonlyArray<McpProjectIssue> => {
  const issues: Array<McpProjectIssue> = []
  const serverIds = new Set(project.servers.map(server => server.id))
  const coreCapabilityIds = new Set(project.capabilities.map(capability => capability.id))
  const directTransports = project.transports.filter(
    transport => transport.target.kind === "server" && serverIds.has(transport.target.id),
  )
  const directExposures = project.exposures.filter(
    exposure =>
      serverIds.has(exposure.serverId) &&
      coreCapabilityIds.has(exposure.target.id) &&
      exposure.target.kind !== "app-resource",
  )

  if (project.servers.length !== 1) {
    issues.push(
      issue(
        "server-count",
        "servers",
        "The scaffold backend requires exactly one server",
        "keep-one-server",
        "Keep one direct vertical server",
      ),
    )
  }
  if (directTransports.length === 0 && project.transports.length === 0) {
    issues.push(
      issue(
        "direct-client-required",
        "clients",
        "The scaffold backend requires at least one client transported directly to the server",
        "connect-client-directly",
        "Connect a client directly to the server",
      ),
    )
  }
  if (directExposures.length === 0) {
    issues.push(
      issue(
        "direct-capability-required",
        "capabilities",
        "The scaffold backend requires at least one directly exposed tool, resource, or prompt",
        "expose-core-capability",
        "Expose a tool, resource, or prompt from the server",
      ),
    )
  }

  for (const client of project.clients) {
    if (!project.transports.some(transport => transport.clientId === client.id)) {
      issues.push(
        issue(
          "detached-client",
          `clients.${client.id}`,
          "The client has no transport edge",
          "connect-client",
          "Connect the client to the vertical server",
        ),
      )
    }
  }
  for (const server of project.servers) {
    const participates =
      project.transports.some(
        transport => transport.target.kind === "server" && transport.target.id === server.id,
      ) ||
      project.routes.some(
        route => route.target.kind === "server" && route.target.id === server.id,
      ) ||
      project.exposures.some(exposure => exposure.serverId === server.id)
    if (!participates) {
      issues.push(
        issue(
          "detached-server",
          `servers.${server.id}`,
          "The server has no transport, route, or exposed capability",
          "connect-server",
          "Connect the server and expose a core capability",
        ),
      )
    }
  }
  for (const capability of project.capabilities) {
    const owners = project.exposures.filter(exposure => exposure.target.id === capability.id)
    if (owners.length === 0) {
      issues.push(
        issue(
          "detached-capability",
          `capabilities.${capability.id}`,
          "The capability is not exposed by a server",
          "expose-capability",
          "Add an exposes edge from the server",
        ),
      )
    }
    if (new Set(owners.map(owner => owner.serverId)).size > 1) {
      issues.push(
        issue(
          "conflicting-server-ownership",
          `capabilities.${capability.id}`,
          "The capability is exposed by more than one server",
          "choose-capability-owner",
          "Keep exactly one owning server exposure",
        ),
      )
    }
    if (capability.kind === "tool" && capability.resultType === "task") {
      issues.push(
        issue(
          "unsupported-task-result",
          `capabilities.${capability.id}`,
          "Task-valued tool results require the reconciled Tasks backend",
          "use-content-result",
          "Use a content result or wait for the Tasks backend",
        ),
      )
    }
  }
  for (const gateway of project.gateways) {
    issues.push(
      issue(
        "unsupported-gateway",
        `gateways.${gateway.id}`,
        "Gateway execution is represented in IR but unsupported by this scaffold backend",
        "remove-gateway",
        "Connect clients directly to one vertical server",
      ),
    )
  }
  for (const transport of project.transports) {
    if (transport.target.kind !== "server") {
      issues.push(
        issue(
          "unsupported-indirect-transport",
          `transports.${transport.id}`,
          "Indirect client transport is represented in IR but unsupported by this backend",
          "connect-client-directly",
          "Connect the client directly to the server",
        ),
      )
    }
  }
  for (const route of project.routes) {
    issues.push(
      issue(
        "unsupported-route",
        `routes.${route.id}`,
        "Gateway routing is represented in IR but unsupported by this scaffold backend",
        "remove-route",
        "Replace the route with a direct client-to-server transport",
      ),
    )
  }
  for (const task of project.tasks) {
    issues.push(
      issue(
        "unsupported-task",
        `tasks.${task.id}`,
        "Task execution requires the reconciled Tasks backend",
        "remove-task",
        "Remove the Task declaration or wait for the Tasks backend",
      ),
    )
  }
  for (const start of project.taskStarts) {
    issues.push(
      issue(
        "unsupported-task-start",
        `taskStarts.${start.id}`,
        "Task start relationships cannot be lowered by this scaffold backend",
        "remove-task-start",
        "Remove the starts edge or wait for the Tasks backend",
      ),
    )
  }
  for (const resource of project.apps.resources) {
    issues.push(
      issue(
        "unsupported-app-resource",
        `apps.resources.${resource.id}`,
        "Apps resources remain explicit until an accepted Apps backend is available",
        "remove-app-resource",
        "Remove the Apps resource or wait for the Apps backend",
      ),
    )
  }
  for (const view of project.apps.views) {
    issues.push(
      issue(
        "unsupported-app-view",
        `apps.views.${view.id}`,
        "Apps views remain explicit until an accepted Apps backend is available",
        "remove-app-view",
        "Remove the Apps view or wait for the Apps backend",
      ),
    )
  }
  for (const host of project.apps.hosts) {
    issues.push(
      issue(
        "unsupported-app-host",
        `apps.hosts.${host.id}`,
        "Apps hosts remain explicit until an accepted Apps backend is available",
        "remove-app-host",
        "Remove the Apps host or wait for the Apps backend",
      ),
    )
  }
  for (const exposure of project.exposures) {
    if (exposure.target.kind === "app-resource") {
      issues.push(
        issue(
          "unsupported-app-exposure",
          `exposures.${exposure.id}`,
          "Apps resource exposure cannot be lowered by this scaffold backend",
          "remove-app-exposure",
          "Remove the Apps exposure or wait for the Apps backend",
        ),
      )
    }
  }
  for (const link of project.apps.renderLinks) {
    issues.push(
      issue(
        "unsupported-app-render",
        `apps.renderLinks.${link.id}`,
        "Apps rendering relationships cannot be lowered by this scaffold backend",
        "remove-app-render",
        "Remove the renders edge or wait for the Apps backend",
      ),
    )
  }
  for (const link of project.apps.hostLinks) {
    issues.push(
      issue(
        "unsupported-app-hosting",
        `apps.hostLinks.${link.id}`,
        "Apps hosting relationships cannot be lowered by this scaffold backend",
        "remove-app-hosting",
        "Remove the hosts edge or wait for the Apps backend",
      ),
    )
  }

  return sortIssues(issues)
}

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

const renderScaffoldFiles = (project: McpProject): ReadonlyArray<McpGeneratedFile> =>
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
  ].sort((left, right) =>
    compareCodePoints(left.path, right.path),
  ) as ReadonlyArray<McpGeneratedFile>

export const effectScaffoldV1: CompilerBackend = {
  id: "effect-scaffold-v1",
  version: "1",
  render: project => {
    const issues = effectScaffoldIssues(project)
    return issues.length > 0
      ? Effect.fail(new McpProjectRenderError({ backendId: "effect-scaffold-v1", issues }))
      : Effect.succeed(renderScaffoldFiles(project))
  },
}
