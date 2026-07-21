import { Effect } from "effect"
import { describe, expect, it } from "vitest"
import { serializeProjectBundle } from "../authoring/McpProjectBundleIO"
import {
  instantiateTemplate,
  MCP_IDE_TEMPLATE_REGISTRY_VERSION,
  mcpIdeTemplateRegistry,
} from "./TemplateRegistry"

describe("MCP IDE template registry", () => {
  it("publishes immutable versioned beginner and professional entries", () => {
    expect(MCP_IDE_TEMPLATE_REGISTRY_VERSION).toBe("1")
    expect(mcpIdeTemplateRegistry.map(template => template.id)).toEqual([
      "beginner-tool",
      "pro-gateway-tasks-apps",
    ])
    expect(mcpIdeTemplateRegistry.map(template => template.level)).toEqual([
      "beginner",
      "professional",
    ])
    expect(Object.isFrozen(mcpIdeTemplateRegistry)).toBe(true)
    expect(mcpIdeTemplateRegistry.every(Object.isFrozen)).toBe(true)
  })

  it.each([
    "beginner-tool",
    "pro-gateway-tasks-apps",
  ] as const)("instantiates fresh deterministic %s bundles", templateId => {
    const first = Effect.runSync(instantiateTemplate(templateId))
    const second = Effect.runSync(instantiateTemplate(templateId))
    const firstBytes = Effect.runSync(serializeProjectBundle(first))
    const secondBytes = Effect.runSync(serializeProjectBundle(second))

    expect(firstBytes).toBe(secondBytes)
    expect(first).not.toBe(second)
    expect(first.graph).not.toBe(second.graph)
    expect(first.trace).not.toBe(second.trace)
    expect(first.trace).toMatchObject({
      graphId: first.graph.id,
      graphRevision: first.graph.revision,
    })
  })

  it("keeps the beginner topology small and the professional topology explicit", () => {
    const beginner = Effect.runSync(instantiateTemplate("beginner-tool"))
    const professional = Effect.runSync(instantiateTemplate("pro-gateway-tasks-apps"))

    expect(beginner.graph.nodes.map(node => node.kind)).toEqual(["client", "server", "tool"])
    expect(beginner.trace?.events.some(event => event.family === "apps")).toBe(false)

    expect(professional.graph.nodes.map(node => node.kind)).toEqual(
      expect.arrayContaining([
        "client",
        "gateway",
        "server",
        "tool",
        "task",
        "app-resource",
        "app-view",
        "app-host",
      ]),
    )
    expect(professional.trace?.events.some(event => event.family === "tasks")).toBe(true)
    expect(professional.trace?.events.some(event => event.family === "apps")).toBe(true)
  })
})
