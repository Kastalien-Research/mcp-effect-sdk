import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, describe, expect, it, vi } from "vitest"
import type { McpTraceEvent } from "./model/McpTraceDocument"
import { inputRequiredScenario } from "./scenarios/inputRequiredScenario"
import { MrtrControls } from "./tasks/MrtrControls"

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })

describe("fixture-only MRTR keyed controls", () => {
  let root: Root | undefined
  let container: HTMLDivElement | undefined

  afterEach(() => {
    if (root) act(() => root?.unmount())
    container?.remove()
    root = undefined
    container = undefined
  })

  const render = async (
    event: McpTraceEvent,
    onSubmit: (eventId: string, responseKeys: ReadonlyArray<string>) => boolean,
  ) => {
    container = document.createElement("div")
    document.body.append(container)
    root = createRoot(container)
    await act(async () => {
      root?.render(
        <MrtrControls trace={inputRequiredScenario.trace} event={event} onSubmit={onSubmit} />,
      )
    })
    return container
  }

  const enter = (element: HTMLTextAreaElement, value: string) => {
    const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")?.set
    if (!setter) throw new Error("native value setter is unavailable")
    act(() => {
      setter.call(element, value)
      element.dispatchEvent(new Event("input", { bubbles: true }))
    })
  }

  const required = inputRequiredScenario.trace.events.find(
    event => event.kind === "mrtr.input-required",
  )
  if (!required) throw new Error("fixture requires an input event")

  it("edits exact empty, Unicode, and own __proto__ keys without retaining submitted values", async () => {
    const marker = "ephemeral-special-key-marker"
    const inputRequests = JSON.parse(
      '{"":{"method":"roots/list","label":"Empty"},"設定":{"method":"sampling/createMessage","label":"Unicode"},"__proto__":{"method":"elicitation/create","label":"Prototype"}}',
    ) as Record<string, unknown>
    const event = {
      ...required,
      payload: { ...required.payload, inputRequests },
    } as McpTraceEvent
    const onSubmit = vi.fn(() => true)
    const view = await render(event, onSubmit)
    const editors = [
      view.querySelector<HTMLTextAreaElement>('[data-testid="mrtr-draft-"]'),
      view.querySelector<HTMLTextAreaElement>('[data-testid="mrtr-draft-設定"]'),
      view.querySelector<HTMLTextAreaElement>('[data-testid="mrtr-draft-__proto__"]'),
    ]
    const [emptyEditor, unicodeEditor, prototypeEditor] = editors
    if (!emptyEditor || !unicodeEditor || !prototypeEditor) {
      throw new Error("all exact keyed editors are required")
    }

    enter(emptyEditor, "not-json")
    enter(unicodeEditor, JSON.stringify(marker))
    enter(prototypeEditor, "true")
    act(() => view.querySelector<HTMLButtonElement>('[data-testid="submit-mrtr-input"]')?.click())
    expect(onSubmit).not.toHaveBeenCalled()
    expect(view.textContent).toContain("VALID JSON REQUIRED")

    enter(emptyEditor, "null")
    act(() => view.querySelector<HTMLButtonElement>('[data-testid="submit-mrtr-input"]')?.click())
    expect(onSubmit).toHaveBeenCalledWith("mrtr-required-1", ["", "設定", "__proto__"])
    expect(JSON.stringify(onSubmit.mock.calls)).not.toContain(marker)
    expect(view.textContent).not.toContain(marker)
    expect(editors.every(editor => editor?.value === "")).toBe(true)
  })

  it("supports a request-state-only round and removes drafts when cancelled by unmount", async () => {
    const stateOnly = {
      ...required,
      payload: { ...required.payload, inputRequests: {} },
    } as McpTraceEvent
    const onSubmit = vi.fn(() => true)
    const view = await render(stateOnly, onSubmit)

    expect(view.querySelector("textarea")).toBeNull()
    act(() => view.querySelector<HTMLButtonElement>('[data-testid="submit-mrtr-input"]')?.click())
    expect(onSubmit).toHaveBeenCalledWith("mrtr-required-1", [])

    await act(async () => root?.unmount())
    root = undefined
    expect(document.body.textContent).not.toContain("ephemeral-special-key-marker")
  })
})
