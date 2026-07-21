import { Deferred, Effect } from "effect"
import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, describe, expect, it, vi } from "vitest"
import { parseProjectBundle } from "./authoring/McpProjectBundleIO"
import { InspectorPanel } from "./components/InspectorPanel"
import { McpIdeApp } from "./McpIdeApp"
import { withGraphRevision } from "./model/GraphFingerprint"
import type { McpGraphDocument, McpGraphNode } from "./model/McpGraphDocument"
import type { McpTraceDocument, McpTraceEvent } from "./model/McpTraceDocument"
import { gatewayTaskScenario } from "./scenarios/gatewayTaskScenario"
import { TraceReplay, type TraceReplayScheduler } from "./trace/TraceReplay"

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })

describe("MCP IDE shell", () => {
  let root: Root | undefined
  let container: HTMLDivElement | undefined

  afterEach(() => {
    if (root) act(() => root?.unmount())
    container?.remove()
    root = undefined
    container = undefined
  })

  const renderApp = async (replay?: TraceReplay) => {
    container = document.createElement("div")
    document.body.append(container)
    root = createRoot(container)
    await act(async () => {
      root?.render(<McpIdeApp {...(replay ? { replay } : {})} />)
    })
    return container
  }

  const makeReplay = (scheduler: TraceReplayScheduler = { sleep: () => Effect.void }) =>
    Effect.runSync(
      TraceReplay.make(gatewayTaskScenario.graph, gatewayTaskScenario.trace, scheduler),
    )

  const renderInspector = async (
    graph: McpGraphDocument,
    trace: McpTraceDocument,
    event: McpTraceEvent,
    node?: McpGraphNode,
  ) => {
    Effect.runSync(TraceReplay.make(graph, trace, { sleep: () => Effect.void }))
    container = document.createElement("div")
    document.body.append(container)
    root = createRoot(container)
    await act(async () => {
      root?.render(
        <InspectorPanel graph={graph} trace={trace} event={event} {...(node ? { node } : {})} />,
      )
    })
    return container
  }

  const click = (view: HTMLElement, selector: string) => {
    const button = view.querySelector<HTMLButtonElement>(selector)
    if (!button) throw new Error(`control was not rendered: ${selector}`)
    act(() => button.click())
    return button
  }

  const enterValue = (element: HTMLInputElement | HTMLTextAreaElement, value: string) => {
    const prototype =
      element instanceof HTMLTextAreaElement
        ? HTMLTextAreaElement.prototype
        : HTMLInputElement.prototype
    const setter = Object.getOwnPropertyDescriptor(prototype, "value")?.set
    if (!setter) throw new Error("native value setter is unavailable")
    act(() => {
      setter.call(element, value)
      element.dispatchEvent(new Event("input", { bubbles: true }))
    })
  }

  const selectValue = (element: HTMLSelectElement, value: string) => {
    const setter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value")?.set
    if (!setter) throw new Error("native select value setter is unavailable")
    act(() => {
      setter.call(element, value)
      element.dispatchEvent(new Event("change", { bubbles: true }))
    })
  }

  it("replaces the active document with fresh beginner and professional templates", async () => {
    const view = await renderApp()
    const template = view.querySelector<HTMLSelectElement>('[data-testid="template-select"]')
    if (!template) throw new Error("template selector was not rendered")

    selectValue(template, "beginner-tool")
    click(view, '[data-testid="apply-template"]')
    expect(view.textContent).toContain("Beginner tool server")
    expect(view.textContent).toContain("3 NODES")
    expect(view.textContent).toContain("0 COMMANDS")

    click(view, '[data-testid="palette-resource"]')
    expect(view.textContent).toContain("4 NODES")

    selectValue(template, "pro-gateway-tasks-apps")
    click(view, '[data-testid="apply-template"]')
    expect(view.textContent).toContain("Professional gateway, Tasks, and Apps")
    expect(view.textContent).toContain("8 NODES")
    expect(view.textContent).toContain("0 COMMANDS")
  })

  it("filters the professional fixture to Apps and projects only explicit lifecycle data", async () => {
    const view = await renderApp()
    const template = view.querySelector<HTMLSelectElement>('[data-testid="template-select"]')
    if (!template) throw new Error("template selector was not rendered")
    selectValue(template, "pro-gateway-tasks-apps")
    click(view, '[data-testid="apply-template"]')
    click(view, '[data-testid="mode-trace"]')
    click(view, '[data-testid="timeline-filter-apps"]')

    expect(view.querySelectorAll('[data-testid^="timeline-apps-"]')).toHaveLength(6)
    expect(view.querySelector('[data-testid^="timeline-event-"]')).toBeNull()
    expect(view.textContent).toContain("APPS LIFECYCLE")
    expect(view.textContent).toContain("stable")
    expect(view.textContent).toContain("STABLE PROFILE FIXTURE")
    expect(view.textContent).toContain("CONTRACT-SHAPED")
    expect(view.textContent).toContain("ui://field-operations/observations")
    expect(view.textContent).toContain("CONSENT ALLOWED")
    expect(view.textContent).toContain("VIEW CLOSED")
  })

  it("keeps the Apps preview visibly fixture-only and inert until accepted WP9", async () => {
    const view = await renderApp()
    const template = view.querySelector<HTMLSelectElement>('[data-testid="template-select"]')
    if (!template) throw new Error("template selector was not rendered")
    selectValue(template, "pro-gateway-tasks-apps")
    click(view, '[data-testid="apply-template"]')
    click(view, '[data-testid="mode-trace"]')

    const preview = view.querySelector<HTMLButtonElement>('[data-testid="apps-preview-disabled"]')
    expect(preview?.disabled).toBe(true)
    expect(view.textContent).toContain("FIXTURE ONLY")
    expect(view.textContent).toContain("UNAVAILABLE UNTIL ACCEPTED WP9")
    expect(view.querySelector("iframe")).toBeNull()
  })

  it("resets the Apps filter when a beginner template replaces the professional trace", async () => {
    const view = await renderApp()
    const template = view.querySelector<HTMLSelectElement>('[data-testid="template-select"]')
    if (!template) throw new Error("template selector was not rendered")
    click(view, '[data-testid="apply-template"]')
    click(view, '[data-testid="mode-trace"]')
    click(view, '[data-testid="timeline-filter-apps"]')
    expect(view.querySelectorAll('[data-testid^="timeline-apps-"]')).toHaveLength(6)

    selectValue(template, "beginner-tool")
    click(view, '[data-testid="apply-template"]')
    click(view, '[data-testid="mode-trace"]')

    expect(view.querySelectorAll('[data-testid^="timeline-event-"]')).toHaveLength(6)
    expect(
      view.querySelector<HTMLButtonElement>('[data-testid="timeline-filter-apps"]')?.disabled,
    ).toBe(true)
    expect(view.textContent).not.toContain("0 / 0 EVENTS")
  })

  it("renders the editable authored topology as the default workbench mode", async () => {
    const replay = makeReplay()
    const view = await renderApp(replay)

    expect(view.textContent).toContain("EFFECT MCP IDE")
    expect(view.textContent).toContain("EDITABLE GRAPH")
    expect(view.textContent).toContain("NODE PALETTE")
    expect(view.textContent).toContain("Research client")
    expect(view.textContent).toContain("Capability gateway")
    expect(view.textContent).toContain("Site research task")
  })

  it("runs the trace to completion and reports the applied event count", async () => {
    const replay = makeReplay()
    const view = await renderApp(replay)
    click(view, '[data-testid="mode-trace"]')
    const runButton = view.querySelector<HTMLButtonElement>('[data-testid="run-trace"]')
    if (!runButton) throw new Error("run control was not rendered")

    await act(async () => {
      runButton.click()
      await vi.waitFor(() => expect(replay.getSnapshot().status).toBe("completed"))
    })

    expect(view.textContent).toContain("RUN COMPLETE")
    expect(view.textContent).toContain(`${gatewayTaskScenario.trace.events.length} / 14 EVENTS`)
  })

  it("cancels an in-flight trace and exposes interrupted state", async () => {
    const gate = Effect.runSync(Deferred.make<void>())
    const replay = makeReplay({
      sleep: delayMs => (delayMs === 0 ? Effect.void : Deferred.await(gate)),
    })
    const view = await renderApp(replay)
    click(view, '[data-testid="mode-trace"]')
    const runButton = view.querySelector<HTMLButtonElement>('[data-testid="run-trace"]')
    if (!runButton) throw new Error("run control was not rendered")

    await act(async () => {
      runButton.click()
      await vi.waitFor(() => expect(replay.getSnapshot().cursor).toBe(0))
    })

    const cancelButton = view.querySelector<HTMLButtonElement>('[data-testid="cancel-trace"]')
    if (!cancelButton) throw new Error("cancel control was not rendered")
    act(() => cancelButton.click())

    expect(view.textContent).toContain("RUN CANCELLED")
    expect(view.textContent).toContain("INTERRUPTED")
  })

  it("authors nodes and valid typed connections with undo and redo", async () => {
    const replay = makeReplay()
    const view = await renderApp(replay)

    expect(view.textContent).toContain("NODE PALETTE")
    click(view, '[data-testid="palette-resource"]')
    expect(view.textContent).toContain("6 NODES")

    click(view, '[data-testid="connect-from-server"]')
    click(view, '[data-testid="connect-to-resource"]')
    expect(view.textContent).toContain("exposes ← server")
    expect(view.textContent).toContain("5 EDGES")

    click(view, '[data-testid="undo-graph"]')
    expect(view.textContent).toContain("4 EDGES")
    click(view, '[data-testid="redo-graph"]')
    expect(view.textContent).toContain("5 EDGES")
  })

  it("blocks fixture trace replay when authored edits remove a referenced node", async () => {
    const replay = makeReplay()
    const view = await renderApp(replay)

    click(view, '[data-testid="node-client"]')
    click(view, '[data-testid="remove-node"]')
    click(view, '[data-testid="mode-trace"]')

    expect(view.textContent).toContain("TRACE INCOMPATIBLE")
    const runButton = view.querySelector<HTMLButtonElement>('[data-testid="run-trace"]')
    expect(runButton?.disabled).toBe(true)
  })

  it("configures nodes and imports a replacement versioned graph document", async () => {
    const replay = makeReplay()
    const view = await renderApp(replay)
    const label = view.querySelector<HTMLInputElement>(".node-config-form input")
    const config = view.querySelector<HTMLTextAreaElement>(".config-editor")
    if (!label || !config) throw new Error("node configuration form was not rendered")

    enterValue(label, "Remote research client")
    enterValue(config, JSON.stringify({ transport: "stdio" }, null, 2))
    click(view, '[data-testid="save-node"]')
    expect(view.textContent).toContain("Remote research client")
    expect(view.querySelector<HTMLTextAreaElement>(".config-editor")?.value).toContain('"stdio"')

    click(view, '[data-testid="open-graph-json"]')
    const documentEditor = view.querySelector<HTMLTextAreaElement>('[data-testid="graph-json"]')
    if (!documentEditor) throw new Error("graph document editor was not rendered")
    enterValue(
      documentEditor,
      JSON.stringify({ ...gatewayTaskScenario.graph, name: "Imported field workflow" }),
    )
    click(view, '[data-testid="import-graph"]')
    expect(view.textContent).toContain("Imported field workflow")
    expect(view.textContent).toContain("0 COMMANDS")
  })

  it("renders rejected configuration issues with structured repair guidance", async () => {
    const replay = makeReplay()
    const view = await renderApp(replay)
    const config = view.querySelector<HTMLTextAreaElement>(".config-editor")
    if (!config) throw new Error("node configuration form was not rendered")

    enterValue(config, JSON.stringify({ transport: "websocket" }, null, 2))
    click(view, '[data-testid="save-node"]')

    const issue = view.querySelector('[data-testid="graph-issue-invalid-node-config"]')
    expect(issue?.textContent).toContain("Invalid client configuration")
    expect(issue?.textContent).toContain("Replace the configuration with valid client defaults")
    expect(issue?.textContent).toContain("Use client defaults")
  })

  it("renders structured repair guidance for a rejected graph import", async () => {
    const replay = makeReplay()
    const view = await renderApp(replay)

    click(view, '[data-testid="open-graph-json"]')
    const documentEditor = view.querySelector<HTMLTextAreaElement>('[data-testid="graph-json"]')
    if (!documentEditor) throw new Error("graph document editor was not rendered")
    enterValue(
      documentEditor,
      JSON.stringify({ ...gatewayTaskScenario.graph, revision: "graph-v2-00000000" }),
    )
    click(view, '[data-testid="import-graph"]')

    const issue = view.querySelector('[data-testid="graph-issue-revision-mismatch"]')
    expect(issue?.textContent).toContain("revision-mismatch / revision")
    expect(issue?.textContent).toContain("refresh-revision")
    expect(issue?.textContent).toContain(
      "Refresh the compatibility revision from executable graph content",
    )
    expect(issue?.textContent).toMatch(/Use graph-v2-[0-9a-f]{8}/)
  })

  it("imports a trace through the redaction boundary and replays that trace from state", async () => {
    const view = await renderApp()
    click(view, '[data-testid="open-graph-json"]')
    click(view, '[data-testid="document-trace"]')
    const editor = view.querySelector<HTMLTextAreaElement>('[data-testid="trace-json"]')
    if (!editor) throw new Error("trace document editor was not rendered")
    const imported = {
      ...gatewayTaskScenario.trace,
      id: "imported-safe-run",
      name: "Imported safe trace",
      events: [
        {
          ...gatewayTaskScenario.trace.events[0],
          payload: { accessToken: "must-not-enter-state", result: "visible" },
        },
      ],
    }

    enterValue(editor, JSON.stringify(imported))
    click(view, '[data-testid="import-document"]')

    const sanitized = view.querySelector<HTMLTextAreaElement>('[data-testid="trace-json"]')?.value
    expect(sanitized).toContain("Imported safe trace")
    expect(sanitized).toContain('"$mcpTraceRedaction": "sensitive-key"')
    expect(sanitized).not.toContain("must-not-enter-state")

    click(view, '[data-testid="mode-trace"]')
    const runButton = view.querySelector<HTMLButtonElement>('[data-testid="run-trace"]')
    if (!runButton) throw new Error("run control was not rendered")
    await act(async () => {
      runButton.click()
      await vi.waitFor(() => expect(view.textContent).toContain("1 / 1 EVENTS"))
    })
  })

  it("never copies raw edits and imports a graph plus trace bundle atomically", async () => {
    const writeText = vi.fn<(source: string) => Promise<void>>().mockResolvedValue(undefined)
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText } })
    const view = await renderApp()
    click(view, '[data-testid="open-graph-json"]')
    click(view, '[data-testid="document-trace"]')
    const traceEditor = view.querySelector<HTMLTextAreaElement>('[data-testid="trace-json"]')
    if (!traceEditor) throw new Error("trace document editor was not rendered")
    enterValue(traceEditor, JSON.stringify({ authorization: "raw-editor-secret" }))
    const copyButton = view.querySelector<HTMLButtonElement>('[data-testid="copy-document"]')
    if (!copyButton) throw new Error("copy document control was not rendered")
    await act(async () => {
      copyButton.click()
      await vi.waitFor(() => expect(writeText).toHaveBeenCalled())
    })
    expect(writeText.mock.calls[0]?.[0]).not.toContain("raw-editor-secret")

    click(view, '[data-testid="document-bundle"]')
    const bundleEditor = view.querySelector<HTMLTextAreaElement>('[data-testid="bundle-json"]')
    if (!bundleEditor) throw new Error("bundle document editor was not rendered")
    enterValue(
      bundleEditor,
      JSON.stringify({
        schemaVersion: "1",
        kind: "mcp-project-bundle",
        graph: { ...gatewayTaskScenario.graph, name: "Imported bundle graph" },
        trace: {
          ...gatewayTaskScenario.trace,
          name: "Imported bundle trace",
          events: [gatewayTaskScenario.trace.events[0]],
        },
      }),
    )
    click(view, '[data-testid="import-document"]')

    expect(view.textContent).toContain("Imported bundle graph")
    click(view, '[data-testid="document-trace"]')
    expect(view.querySelector<HTMLTextAreaElement>('[data-testid="trace-json"]')?.value).toContain(
      "Imported bundle trace",
    )
  })

  it("exports a graph-only bundle when an executable edit makes the trace incompatible", async () => {
    const view = await renderApp()
    click(view, '[data-testid="node-client"]')
    click(view, '[data-testid="remove-node"]')
    click(view, '[data-testid="open-graph-json"]')
    click(view, '[data-testid="document-bundle"]')

    expect(view.querySelector('[data-testid="bundle-compatibility"]')?.textContent).toContain(
      "GRAPH ONLY",
    )
    const source = view.querySelector<HTMLTextAreaElement>('[data-testid="bundle-json"]')?.value
    if (!source) throw new Error("bundle document source was not rendered")
    const bundle = Effect.runSync(parseProjectBundle(source))

    expect(bundle.graph.nodes.some(node => node.id === "client")).toBe(false)
    expect(bundle).not.toHaveProperty("trace")
  })

  it("exposes accessible pause, resume, step, cancel, and reset controls", async () => {
    const replay = makeReplay({
      sleep: delayMs => (delayMs === 0 ? Effect.void : Effect.never),
    })
    const view = await renderApp(replay)
    click(view, '[data-testid="mode-trace"]')

    await act(async () => {
      click(view, '[data-testid="run-trace"]')
      await vi.waitFor(() => expect(replay.getSnapshot().cursor).toBe(0))
    })
    expect(view.querySelector('[data-testid="pause-trace"]')?.textContent).toContain("PAUSE")

    click(view, '[data-testid="pause-trace"]')
    expect(view.textContent).toContain("TRACE PAUSED")
    expect(view.querySelector('[data-testid="resume-trace"]')?.textContent).toContain("RESUME")
    expect(view.querySelector('[data-testid="step-trace"]')?.textContent).toContain("STEP")

    click(view, '[data-testid="resume-trace"]')
    await vi.waitFor(() => expect(replay.getSnapshot().status).toBe("running"))
    click(view, '[data-testid="pause-trace"]')
    click(view, '[data-testid="step-trace"]')
    expect(replay.getSnapshot()).toMatchObject({ status: "paused", cursor: 1 })

    click(view, '[data-testid="cancel-trace"]')
    expect(view.textContent).toContain("RUN CANCELLED")
    click(view, '[data-testid="reset-trace"]')
    expect(replay.getSnapshot()).toMatchObject({ status: "idle", cursor: -1 })
  })

  it("seeks pending timeline rows and marks the selected event as current", async () => {
    const replay = makeReplay()
    const view = await renderApp(replay)
    click(view, '[data-testid="mode-trace"]')

    const pending = view.querySelector<HTMLButtonElement>('[data-testid="timeline-event-10"]')
    expect(pending?.disabled).toBe(false)
    expect(pending?.getAttribute("aria-label")).toContain("pending")
    click(view, '[data-testid="timeline-event-10"]')

    expect(replay.getSnapshot()).toMatchObject({ status: "paused", cursor: 9 })
    expect(pending?.dataset.current).toBe("true")
    expect(pending?.dataset.selected).toBe("true")
    expect(pending?.getAttribute("aria-current")).toBe("step")
    expect(view.textContent).toContain("Tool produced final result")
  })

  it("inspects accepted protocol, correlation, span, runtime, and edge traversal data", async () => {
    const replay = makeReplay()
    const view = await renderApp(replay)
    click(view, '[data-testid="mode-trace"]')
    click(view, '[data-testid="timeline-event-02"]')

    expect(view.textContent).toContain("PROTOCOL METADATA")
    expect(view.textContent).toContain("tools/call")
    expect(view.textContent).toContain("accept")
    expect(view.textContent).toContain("application/json")

    click(view, '[data-testid="timeline-event-04"]')
    expect(view.textContent).toContain("REQUEST / RESULT PAIRING")
    expect(view.textContent).toContain("Client received CallToolResult")
    expect(view.textContent).toContain("SPAN CONTEXT")
    expect(view.textContent).toContain("rpc-17-server")
    expect(view.textContent).toContain("rpc-17-gateway")
    expect(view.textContent).toContain("EDGE TRAVERSAL")
    expect(view.textContent).toContain("gateway → server")

    click(view, '[data-testid="timeline-event-03"]')
    expect(view.textContent).toContain("RUNTIME CONTEXT")
    expect(view.textContent).toContain("fiber-gateway-17")
  })

  it("renders only graph and trace supplied Apps profile, sandbox, and policy data", async () => {
    const appNode = {
      id: "app-view",
      kind: "app-view",
      label: "Inspection view",
      description: "Accepted Apps view",
      position: { x: 0, y: 0 },
      config: { sandbox: true, profile: "stable" },
    } as const satisfies McpGraphNode
    const graph = withGraphRevision({
      ...gatewayTaskScenario.graph,
      nodes: [...gatewayTaskScenario.graph.nodes, appNode],
    }) satisfies McpGraphDocument
    const event = {
      id: "event-app-policy",
      sequence: 14,
      atMs: 3300,
      nodeId: appNode.id,
      kind: "apps.policy-allowed",
      family: "apps",
      channel: "apps",
      summary: "Host accepted declared sandbox",
      payload: { policy: "declared-sandbox" },
    } as const satisfies McpTraceEvent
    const trace = {
      ...gatewayTaskScenario.trace,
      graphRevision: graph.revision,
      events: [...gatewayTaskScenario.trace.events, event],
    } satisfies McpTraceDocument

    const inspector = await renderInspector(graph, trace, event, appNode)

    expect(inspector.textContent).toContain("APPS DECLARATIONS")
    expect(inspector.textContent).toContain("stable")
    expect(inspector.textContent).toContain("SANDBOXED")
    expect(inspector.textContent).toContain("POLICY ALLOWED")
    expect(inspector.textContent).not.toContain("Negotiated")
  })

  it("inspects an accepted sanitized runtime cause as secondary read-only data", async () => {
    const baseEvent = gatewayTaskScenario.trace.events[2]
    const event = {
      ...baseEvent,
      runtime: {
        ...baseEvent.runtime,
        cause: { _tag: "Failure", message: "sanitized-cause" },
      },
    } satisfies McpTraceEvent
    const trace = {
      ...gatewayTaskScenario.trace,
      events: [event],
    } satisfies McpTraceDocument
    const inspector = await renderInspector(gatewayTaskScenario.graph, trace, event)

    expect(inspector.textContent).toContain("SANITIZED CAUSE")
    expect(inspector.textContent).toContain("READ ONLY")
    expect(inspector.textContent).toContain("sanitized-cause")
  })

  it("inspects an accepted Apps resource URI without inferring lifecycle state", async () => {
    const appResource = {
      id: "app-resource",
      kind: "app-resource",
      label: "Inspection resource",
      description: "Accepted Apps resource",
      position: { x: 0, y: 0 },
      config: { uri: "ui://inspection/resource", profile: "preview" },
    } as const satisfies McpGraphNode
    const graph = withGraphRevision({
      ...gatewayTaskScenario.graph,
      nodes: [...gatewayTaskScenario.graph.nodes, appResource],
    }) satisfies McpGraphDocument
    const event = {
      id: "event-app-resource",
      sequence: 14,
      atMs: 3300,
      nodeId: appResource.id,
      kind: "apps.resource-linked",
      family: "apps",
      channel: "apps",
      summary: "UI resource linked",
      payload: {},
    } as const satisfies McpTraceEvent
    const trace = {
      ...gatewayTaskScenario.trace,
      graphRevision: graph.revision,
      events: [...gatewayTaskScenario.trace.events, event],
    } satisfies McpTraceDocument
    const inspector = await renderInspector(graph, trace, event, appResource)

    expect(inspector.textContent).toContain("RESOURCE URI")
    expect(inspector.textContent).toContain("ui://inspection/resource")
    expect(inspector.textContent).toContain("preview")
    expect(inspector.textContent).not.toContain("VIEW READY")
  })
})
