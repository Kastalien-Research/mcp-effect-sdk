import type { JSONObject } from "../generated/mcp/2026-07-28/McpSchema.generated.js"
import { cloneStrictJson, invalidStrictJson } from "./StrictJson.js"

export type ExtensionCapabilities = Readonly<Record<string, JSONObject>>

const namespaceLabel = /^[A-Za-z](?:[A-Za-z0-9-]*[A-Za-z0-9])?$/
const memberName = /^(?:[A-Za-z0-9](?:[A-Za-z0-9._-]*[A-Za-z0-9])?)?$/

const isExtensionCapabilityName = (name: string): boolean => {
  const parts = name.split("/")
  if (parts.length !== 2 || !memberName.test(parts[1] ?? "")) return false
  const namespace = (parts[0] ?? "").split(".")
  return namespace.length >= 2 && namespace.every((label) => namespaceLabel.test(label))
}

export const normalizeExtensionCapabilities = (
  extensions: ExtensionCapabilities | undefined
): ExtensionCapabilities | undefined => {
  if (extensions === undefined) return undefined
  const canonical = cloneStrictJson(extensions)
  if (canonical === invalidStrictJson ||
    typeof canonical !== "object" || canonical === null || Array.isArray(canonical)) {
    throw new Error("Invalid extension capabilities")
  }
  for (const [name, settings] of Object.entries(canonical)) {
    if (!isExtensionCapabilityName(name)) {
      throw new Error(`Invalid extension capability name: ${name}`)
    }
    if (typeof settings !== "object" || settings === null || Array.isArray(settings)) {
      throw new Error(`Invalid extension capability settings: ${name}`)
    }
  }
  return canonical as ExtensionCapabilities
}
