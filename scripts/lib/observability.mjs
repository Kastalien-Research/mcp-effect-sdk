import * as Layer from "effect/Layer"
import * as DevTools from "effect/unstable/devtools/DevTools"

export const MCP_EFFECT_DEVTOOLS_URL = "MCP_EFFECT_DEVTOOLS_URL"

class InvalidDevToolsUrlError extends TypeError {
  constructor(message) {
    super(message)
  }
}

export const validateDevToolsUrl = (value) => {
  const url = new URL(value)

  if (url.protocol !== "ws:" && url.protocol !== "wss:") {
    throw new InvalidDevToolsUrlError(`${MCP_EFFECT_DEVTOOLS_URL} must use ws or wss`)
  }

  if (url.username !== "" || url.password !== "") {
    throw new InvalidDevToolsUrlError(`${MCP_EFFECT_DEVTOOLS_URL} must not include userinfo`)
  }

  return url.toString()
}

export const makeDevToolsRuntimeLayer = (url = process.env[MCP_EFFECT_DEVTOOLS_URL]) => {
  if (url === undefined || url === "") return Layer.empty
  return DevTools.layer(validateDevToolsUrl(url))
}

export const isDevToolsEnabled = (url = process.env[MCP_EFFECT_DEVTOOLS_URL]) => url !== undefined && url.length > 0
