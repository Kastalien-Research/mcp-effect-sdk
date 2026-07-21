import { Effect } from "effect"
import type { AppsTraceAdapterError } from "../apps/AppsTraceAdapter"
import type { McpProjectBundle, McpProjectBundleFailure } from "../authoring/McpProjectBundleIO"
import { instantiateBeginnerToolTemplate } from "./beginnerTool"
import { instantiateProGatewayTasksAppsTemplate } from "./proGatewayTasksApps"

export const MCP_IDE_TEMPLATE_REGISTRY_VERSION = "1" as const

export type McpIdeTemplateId = "beginner-tool" | "pro-gateway-tasks-apps"

export interface McpIdeTemplateDefinition {
  readonly id: McpIdeTemplateId
  readonly version: "1"
  readonly level: "beginner" | "professional"
  readonly label: string
  readonly description: string
  readonly instantiate: () => Effect.Effect<
    McpProjectBundle,
    McpProjectBundleFailure | AppsTraceAdapterError
  >
}

const defineTemplate = (template: McpIdeTemplateDefinition): McpIdeTemplateDefinition =>
  Object.freeze(template)

export const mcpIdeTemplateRegistry: ReadonlyArray<McpIdeTemplateDefinition> = Object.freeze([
  defineTemplate({
    id: "beginner-tool",
    version: "1",
    level: "beginner",
    label: "Beginner tool server",
    description: "A client, one vertical server, and one content-returning tool",
    instantiate: instantiateBeginnerToolTemplate,
  }),
  defineTemplate({
    id: "pro-gateway-tasks-apps",
    version: "1",
    level: "professional",
    label: "Professional gateway + Tasks + Apps",
    description: "Gateway routing, a task-backed tool, and stable-profile Apps fixture data",
    instantiate: instantiateProGatewayTasksAppsTemplate,
  }),
])

export const isMcpIdeTemplateId = (value: string): value is McpIdeTemplateId =>
  mcpIdeTemplateRegistry.some(template => template.id === value)

export const instantiateTemplate = (
  templateId: McpIdeTemplateId,
): Effect.Effect<McpProjectBundle, McpProjectBundleFailure | AppsTraceAdapterError> => {
  const template = mcpIdeTemplateRegistry.find(candidate => candidate.id === templateId)
  return template ? template.instantiate() : Effect.dieMessage(`Unknown template: ${templateId}`)
}
