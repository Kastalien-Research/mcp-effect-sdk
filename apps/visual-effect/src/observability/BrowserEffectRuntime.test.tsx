import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"
import * as Tracer from "effect/Tracer"
import { act, StrictMode } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, describe, expect, it } from "vitest"
import {
  BrowserEffectRuntime,
  type BrowserManagedRuntime,
  makeBrowserEffectRuntime,
  useBrowserEffectRuntime,
} from "./BrowserEffectRuntime"

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })

describe("BrowserEffectRuntime", () => {
  let root: Root | undefined
  let container: HTMLDivElement | undefined
  let suppliedRuntime: BrowserManagedRuntime | undefined

  afterEach(async () => {
    if (root) {
      await act(async () => {
        root?.unmount()
      })
    }
    await suppliedRuntime?.dispose()
    container?.remove()
    root = undefined
    container = undefined
    suppliedRuntime = undefined
  })

  it("keeps a supplied runtime caller-owned across Strict Mode probes and unmount", async () => {
    const ended: Array<string> = []
    const tracer = Tracer.make({
      span: options => {
        const span = new Tracer.NativeSpan(options)
        const end = span.end.bind(span)
        span.end = (time, exit) => {
          end(time, exit)
          ended.push(span.name)
        }
        return span
      },
    })

    const runtime = makeBrowserEffectRuntime(Layer.succeed(Tracer.Tracer, tracer))
    suppliedRuntime = runtime

    const Probe = () => {
      const { runSync } = useBrowserEffectRuntime()
      return (
        <button
          type="button"
          onClick={() => {
            runSync(Effect.void.pipe(Effect.withSpan("mcp.ide.ui.probe")))
          }}
        >
          Run
        </button>
      )
    }

    container = document.createElement("div")
    document.body.append(container)
    root = createRoot(container)
    await act(async () => {
      root?.render(
        <StrictMode>
          <BrowserEffectRuntime runtime={runtime}>
            <Probe />
          </BrowserEffectRuntime>
        </StrictMode>,
      )
    })
    await act(async () => {
      container?.querySelector("button")?.click()
    })

    expect(ended).toContain("mcp.ide.ui.probe")
    await act(async () => {
      root?.unmount()
    })
    root = undefined
    expect(() => runtime.runSync(Effect.void)).not.toThrow()
  })
})
