import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"
import * as DevTools from "@effect/experimental/DevTools"

export const MCP_EFFECT_DEVTOOLS_URL = "MCP_EFFECT_DEVTOOLS_URL"

const resolveDevToolsUrl = (url = process.env[MCP_EFFECT_DEVTOOLS_URL]) => url

class InvalidDevToolsUrlError extends TypeError {
  readonly _tag = "InvalidDevToolsUrl"

  constructor(message: string) {
    super(message)
  }
}

export const validateDevToolsUrl = (value: string): string => {
  const url = new URL(value)

  if (url.protocol !== "ws:" && url.protocol !== "wss:") {
    throw new InvalidDevToolsUrlError(`${MCP_EFFECT_DEVTOOLS_URL} must use ws or wss`)
  }

  if (url.username !== "" || url.password !== "") {
    throw new InvalidDevToolsUrlError(`${MCP_EFFECT_DEVTOOLS_URL} must not include userinfo`)
  }

  return url.toString()
}

export const makeDevToolsRuntimeLayer = (
  url = process.env[MCP_EFFECT_DEVTOOLS_URL]
): Layer.Layer<never, never, never> => {
  const resolvedUrl = resolveDevToolsUrl(url)
  if (resolvedUrl === undefined || resolvedUrl === "") return Layer.empty
  return DevTools.layer(validateDevToolsUrl(resolvedUrl))
}

export const isDevToolsEnabled = (url = resolveDevToolsUrl(process.env[MCP_EFFECT_DEVTOOLS_URL])): boolean =>
  url !== undefined && url.length > 0

const SAFE_EXAMPLE_NAME = /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$/

export const runExample = <A, E, R>(name: string, main: Effect.Effect<A, E, R>): Effect.Effect<A, E, R> =>
  Effect.scoped(
    main.pipe(
      Effect.withSpan("mcp.example.run", {
        captureStackTrace: false,
        attributes: {
          "mcp.example.name": SAFE_EXAMPLE_NAME.test(name) ? name : "(redacted)"
        }
      }),
      Effect.provide(makeDevToolsRuntimeLayer())
    )
  )
