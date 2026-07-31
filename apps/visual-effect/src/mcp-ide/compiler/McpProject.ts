import { Data } from "effect"
import type { McpAppsProfile } from "../model/McpGraphDocument"

export const MCP_PROJECT_SCHEMA_VERSION = "1" as const

export interface McpProjectSource {
  readonly graphSchemaVersion: "2"
  readonly graphId: string
  readonly graphRevision: string
}

interface PresentationFields {
  readonly id: string
  readonly label: string
  readonly description: string
}

export interface McpProjectClient extends PresentationFields {
  readonly kind: "client"
  readonly transport: "streamable-http" | "stdio"
}

export interface McpProjectGateway extends PresentationFields {
  readonly kind: "gateway"
  readonly strategy: "capability"
}

export interface McpProjectServer extends PresentationFields {
  readonly kind: "server"
  readonly domain: string
}

export type McpTransportTarget =
  | { readonly kind: "gateway"; readonly id: string }
  | { readonly kind: "server"; readonly id: string }

export interface McpProjectTransport {
  readonly kind: "streamable-http" | "stdio"
  readonly id: string
  readonly clientId: string
  readonly target: McpTransportTarget
}

export type McpProjectCapability =
  | (PresentationFields & {
      readonly kind: "tool"
      readonly resultType: "content" | "task"
    })
  | (PresentationFields & {
      readonly kind: "resource"
      readonly uri: string
    })
  | (PresentationFields & {
      readonly kind: "prompt"
      readonly name: string
    })

export type McpExposureTarget =
  | { readonly kind: "tool" | "resource" | "prompt"; readonly id: string }
  | { readonly kind: "app-resource"; readonly id: string }

export interface McpProjectExposure {
  readonly kind: "exposure"
  readonly id: string
  readonly serverId: string
  readonly target: McpExposureTarget
}

export type McpHandlerRequirement =
  | {
      readonly kind: "tool-handler"
      readonly id: string
      readonly serverId: string
      readonly capabilityId: string
      readonly implementation: "required"
    }
  | {
      readonly kind: "resource-handler"
      readonly id: string
      readonly serverId: string
      readonly capabilityId: string
      readonly implementation: "required"
    }
  | {
      readonly kind: "prompt-handler"
      readonly id: string
      readonly serverId: string
      readonly capabilityId: string
      readonly implementation: "required"
    }

export type McpProjectRoute =
  | {
      readonly kind: "gateway-route"
      readonly id: string
      readonly gatewayId: string
      readonly target: { readonly kind: "gateway" | "server"; readonly id: string }
    }
  | {
      readonly kind: "gateway-transport"
      readonly id: string
      readonly gatewayId: string
      readonly target: { readonly kind: "gateway" | "server"; readonly id: string }
    }

export interface McpProjectTask extends PresentationFields {
  readonly kind: "task"
  readonly pollingIntervalMs: number
}

export interface McpProjectTaskStart {
  readonly kind: "task-start"
  readonly id: string
  readonly toolId: string
  readonly taskId: string
}

export interface McpProjectAppResource extends PresentationFields {
  readonly kind: "app-resource"
  readonly uri: string
  readonly profile: McpAppsProfile
}

export interface McpProjectAppView extends PresentationFields {
  readonly kind: "app-view"
  readonly profile: McpAppsProfile
  readonly sandbox: boolean
}

export interface McpProjectAppHost extends PresentationFields {
  readonly kind: "app-host"
  readonly profile: McpAppsProfile
}

export interface McpProjectAppRenderLink {
  readonly kind: "app-render"
  readonly id: string
  readonly source:
    | { readonly kind: "tool"; readonly id: string }
    | { readonly kind: "app-resource"; readonly id: string }
  readonly target:
    | { readonly kind: "app-resource"; readonly id: string }
    | { readonly kind: "app-view"; readonly id: string }
}

export interface McpProjectAppHostLink {
  readonly kind: "app-hosting"
  readonly id: string
  readonly hostId: string
  readonly viewId: string
}

export interface McpProjectApps {
  readonly resources: ReadonlyArray<McpProjectAppResource>
  readonly views: ReadonlyArray<McpProjectAppView>
  readonly hosts: ReadonlyArray<McpProjectAppHost>
  readonly renderLinks: ReadonlyArray<McpProjectAppRenderLink>
  readonly hostLinks: ReadonlyArray<McpProjectAppHostLink>
}

export interface McpProjectEnvironmentInput {
  readonly kind: "environment-input"
  readonly name: "MCP_HOST" | "MCP_PORT"
  readonly purpose: string
  readonly required: true
}

export interface McpProject {
  readonly schemaVersion: typeof MCP_PROJECT_SCHEMA_VERSION
  readonly kind: "mcp-effect-project"
  readonly source: McpProjectSource
  readonly clients: ReadonlyArray<McpProjectClient>
  readonly gateways: ReadonlyArray<McpProjectGateway>
  readonly servers: ReadonlyArray<McpProjectServer>
  readonly transports: ReadonlyArray<McpProjectTransport>
  readonly capabilities: ReadonlyArray<McpProjectCapability>
  readonly exposures: ReadonlyArray<McpProjectExposure>
  readonly handlers: ReadonlyArray<McpHandlerRequirement>
  readonly routes: ReadonlyArray<McpProjectRoute>
  readonly tasks: ReadonlyArray<McpProjectTask>
  readonly taskStarts: ReadonlyArray<McpProjectTaskStart>
  readonly apps: McpProjectApps
  readonly requiredEnvironmentInputs: ReadonlyArray<McpProjectEnvironmentInput>
}

export interface McpProjectRepairChoice {
  readonly id: string
  readonly label: string
}

export interface McpProjectIssue {
  readonly code: string
  readonly severity: "error"
  readonly path: string
  readonly explanation: string
  readonly repairs: ReadonlyArray<McpProjectRepairChoice>
}

export class McpProjectCompilationError extends Data.TaggedError("McpProjectCompilationError")<{
  readonly issues: ReadonlyArray<McpProjectIssue>
}> {}

export const compareCodePoints = (left: string, right: string): number =>
  left < right ? -1 : left > right ? 1 : 0

export const sortById = <Value extends { readonly id: string }>(
  values: ReadonlyArray<Value>,
): ReadonlyArray<Value> => [...values].sort((left, right) => compareCodePoints(left.id, right.id))

export const sortIssues = (
  issues: ReadonlyArray<McpProjectIssue>,
): ReadonlyArray<McpProjectIssue> =>
  [...issues].sort(
    (left, right) =>
      compareCodePoints(left.path, right.path) || compareCodePoints(left.code, right.code),
  )
