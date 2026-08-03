import { readFileSync } from "node:fs"
import { join } from "node:path"

export function loadEnv(root = process.cwd()): Record<string, string> {
  let text: string
  try {
    text = readFileSync(join(root, ".env"), "utf8")
  } catch {
    return {}
  }
  const out: Record<string, string> = {}
  for (const line of text.split("\n")) {
    const t = line.trim()
    if (!t || t.startsWith("#")) continue
    const eq = t.indexOf("=")
    if (eq < 1) continue
    const key = t.slice(0, eq).trim()
    let val = t.slice(eq + 1).trim()
    if (val.startsWith('"') && val.endsWith('"')) val = val.slice(1, -1)
    out[key] = val
  }
  return out
}

export interface MercuryConfig {
  apiKey: string
  baseUrl: string
}

export function mercuryConfig(
  env: Record<string, string | undefined>
): MercuryConfig {
  const apiKey = env["INCEPTION_API_KEY"]
  if (!apiKey) throw new Error("INCEPTION_API_KEY missing")
  return {
    apiKey,
    baseUrl: env["INCEPTION_BASE_URL"] ?? "https://api.inceptionlabs.ai/v1"
  }
}
