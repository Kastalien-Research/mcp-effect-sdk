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

  it("renders the authored topology and labels the data source as fixture replay", async () => {
    const replay = new TraceReplay(gatewayTaskScenario.graph, gatewayTaskScenario.trace, {
      sleep: () => Effect.void,
    })
    const view = await renderApp(replay)

    expect(view.textContent).toContain("EFFECT MCP IDE")
    expect(view.textContent).toContain("FIXTURE REPLAY")
    expect(view.textContent).toContain("Research client")
    expect(view.textContent).toContain("Capability gateway")
    expect(view.textContent).toContain("Site research task")
  })

  it("runs the trace to completion and reports the applied event count", async () => {
    const replay = new TraceReplay(gatewayTaskScenario.graph, gatewayTaskScenario.trace, {
      sleep: () => Effect.void,
    })
    const view = await renderApp(replay)
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
})
