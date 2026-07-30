"use client"

import * as DevTools from "@effect/experimental/DevTools"
import * as Effect from "effect/Effect"
import * as Fiber from "effect/Fiber"
import * as Layer from "effect/Layer"
import * as ManagedRuntime from "effect/ManagedRuntime"
import {
  createContext,
  type ReactNode,
  useContext,
  useEffect,
  useMemo,
} from "react"

export const NEXT_PUBLIC_MCP_EFFECT_DEVTOOLS_URL =
  "NEXT_PUBLIC_MCP_EFFECT_DEVTOOLS_URL"

const singletonKey = Symbol.for(
  "mcp-effect-sdk/visual-effect/browser-runtime",
)

export type BrowserManagedRuntime = ManagedRuntime.ManagedRuntime<never, never>

interface SingletonState {
  readonly runtime: BrowserManagedRuntime
  references: number
  disposalGeneration: number
}

type RuntimeGlobal = typeof globalThis & {
  [singletonKey]?: SingletonState
}

export interface BrowserEffectRuntimeApi {
  readonly runSync: <A, E>(effect: Effect.Effect<A, E>) => A
  readonly runPromise: <A, E>(
    effect: Effect.Effect<A, E>,
    options?: { readonly signal?: AbortSignal },
  ) => Promise<A>
  readonly runFork: <A, E>(
    effect: Effect.Effect<A, E>,
  ) => Fiber.RuntimeFiber<A, E>
  readonly interrupt: <A, E>(fiber: Fiber.RuntimeFiber<A, E>) => Promise<void>
}

export const validateBrowserDevToolsUrl = (value: string): string => {
  const url = new URL(value)
  if (url.protocol !== "ws:" && url.protocol !== "wss:") {
    throw new TypeError(
      `${NEXT_PUBLIC_MCP_EFFECT_DEVTOOLS_URL} must use ws or wss`,
    )
  }
  if (url.username !== "" || url.password !== "") {
    throw new TypeError(
      `${NEXT_PUBLIC_MCP_EFFECT_DEVTOOLS_URL} must not include userinfo`,
    )
  }
  return url.toString()
}

export const makeBrowserDevToolsLayer = (
  url = process.env.NEXT_PUBLIC_MCP_EFFECT_DEVTOOLS_URL,
): Layer.Layer<never> =>
  url === undefined || url === ""
    ? Layer.empty
    : DevTools.layer(validateBrowserDevToolsUrl(url))

export const makeBrowserEffectRuntime = (
  layer: Layer.Layer<never> = makeBrowserDevToolsLayer(),
): BrowserManagedRuntime => ManagedRuntime.make(layer)

const globalRuntimeState = (): SingletonState => {
  const owner = globalThis as RuntimeGlobal
  const existing = owner[singletonKey]
  if (existing !== undefined) return existing
  const created: SingletonState = {
    runtime: makeBrowserEffectRuntime(),
    references: 0,
    disposalGeneration: 0,
  }
  owner[singletonKey] = created
  return created
}

const apiFor = (runtime: BrowserManagedRuntime): BrowserEffectRuntimeApi => ({
  runSync: effect => runtime.runSync(effect),
  runPromise: (effect, options) => runtime.runPromise(effect, options),
  runFork: effect => runtime.runFork(effect),
  interrupt: fiber =>
    runtime.runPromise(
      Fiber.interrupt(fiber).pipe(Effect.asVoid),
    ),
})

const BrowserRuntimeContext = createContext<BrowserEffectRuntimeApi | null>(null)

const acquireSingleton = (state: SingletonState): (() => void) => {
  state.references += 1
  state.disposalGeneration += 1
  return () => {
    state.references = Math.max(0, state.references - 1)
    const generation = ++state.disposalGeneration
    queueMicrotask(() => {
      if (state.references !== 0 || state.disposalGeneration !== generation) return
      const owner = globalThis as RuntimeGlobal
      if (owner[singletonKey] === state) delete owner[singletonKey]
      void state.runtime.dispose()
    })
  }
}

export const BrowserEffectRuntime = ({
  children,
  runtime,
}: {
  readonly children: ReactNode
  readonly runtime?: BrowserManagedRuntime
}) => {
  const state = useMemo(
    () => (runtime === undefined ? globalRuntimeState() : undefined),
    [runtime],
  )
  const selectedRuntime = runtime ?? state?.runtime
  if (selectedRuntime === undefined) {
    throw new Error("Browser Effect runtime could not be initialized")
  }
  const api = useMemo(() => apiFor(selectedRuntime), [selectedRuntime])

  useEffect(() => {
    if (state !== undefined) return acquireSingleton(state)
    return () => {
      void selectedRuntime.dispose()
    }
  }, [selectedRuntime, state])

  return (
    <BrowserRuntimeContext.Provider value={api}>
      {children}
    </BrowserRuntimeContext.Provider>
  )
}

export const useBrowserEffectRuntime = (): BrowserEffectRuntimeApi => {
  const runtime = useContext(BrowserRuntimeContext)
  return useMemo(
    () => runtime ?? apiFor(globalRuntimeState().runtime),
    [runtime],
  )
}

export const runBrowserSync = <A, E>(effect: Effect.Effect<A, E>): A =>
  globalRuntimeState().runtime.runSync(effect)

export const runBrowserPromise = <A, E>(
  effect: Effect.Effect<A, E>,
  options?: { readonly signal?: AbortSignal },
): Promise<A> => globalRuntimeState().runtime.runPromise(effect, options)

export const runBrowserFork = <A, E>(
  effect: Effect.Effect<A, E>,
): Fiber.RuntimeFiber<A, E> => globalRuntimeState().runtime.runFork(effect)
