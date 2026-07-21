import { Deferred, Effect } from "effect"
import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, describe, expect, it, vi } from "vitest"
import { McpIdeApp } from "./McpIdeApp"
import { gatewayTaskScenario } from "./scenarios/gatewayTaskScenario"
import { TraceReplay } from "./trace/TraceReplay"

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

  const renderApp = async (replay: TraceReplay) => {
    container = document.createElement("div")
    document.body.append(container)
    root = createRoot(container)
    await act(async () => {
      root?.render(<McpIdeApp replay={replay} />)
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

  it("renders the editable authored topology as the default workbench mode", async () => {
    const replay = new TraceReplay(gatewayTaskScenario.graph, gatewayTaskScenario.trace, {
      sleep: () => Effect.void,
    })
    const view = await renderApp(replay)

    expect(view.textContent).toContain("EFFECT MCP IDE")
    expect(view.textContent).toContain("EDITABLE GRAPH")
    expect(view.textContent).toContain("NODE PALETTE")
    expect(view.textContent).toContain("Research client")
    expect(view.textContent).toContain("Capability gateway")
    expect(view.textContent).toContain("Site research task")
  })

  it("runs the trace to completion and reports the applied event count", async () => {
    const replay = new TraceReplay(gatewayTaskScenario.graph, gatewayTaskScenario.trace, {
      sleep: () => Effect.void,
    })
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
    const replay = new TraceReplay(gatewayTaskScenario.graph, gatewayTaskScenario.trace, {
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
    const replay = new TraceReplay(gatewayTaskScenario.graph, gatewayTaskScenario.trace, {
      sleep: () => Effect.void,
    })
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
    const replay = new TraceReplay(gatewayTaskScenario.graph, gatewayTaskScenario.trace, {
      sleep: () => Effect.void,
    })
    const view = await renderApp(replay)

    click(view, '[data-testid="node-client"]')
    click(view, '[data-testid="remove-node"]')
    click(view, '[data-testid="mode-trace"]')

    expect(view.textContent).toContain("TRACE INCOMPATIBLE")
    const runButton = view.querySelector<HTMLButtonElement>('[data-testid="run-trace"]')
    expect(runButton?.disabled).toBe(true)
  })

  it("configures nodes and imports a replacement versioned graph document", async () => {
    const replay = new TraceReplay(gatewayTaskScenario.graph, gatewayTaskScenario.trace, {
      sleep: () => Effect.void,
    })
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
    const replay = new TraceReplay(gatewayTaskScenario.graph, gatewayTaskScenario.trace, {
      sleep: () => Effect.void,
    })
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
    const replay = new TraceReplay(gatewayTaskScenario.graph, gatewayTaskScenario.trace, {
      sleep: () => Effect.void,
    })
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
})
