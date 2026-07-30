import { existsSync, readFileSync, readdirSync } from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"
import * as Effect from "effect/Effect"
import * as NodeRuntime from "@effect/platform-node/NodeRuntime"
import { runScript } from "./lib/process.mjs"

const __filename = fileURLToPath(import.meta.url)
const root = path.resolve(path.dirname(__filename), "..")
const failures = []

if (existsSync(path.join(root, "mcp"))) {
  failures.push("Top-level mcp/ directory must be deleted or archived outside the active package root")
}

const reconciliationPath = path.join(root, "docs/conformance/historical-mcp-reconciliation.md")
if (!existsSync(reconciliationPath)) {
  failures.push("Missing docs/conformance/historical-mcp-reconciliation.md")
} else {
  const reconciliation = readFileSync(reconciliationPath, "utf8")
  for (const required of [
    "Historical test files reviewed",
    "Behavior ported",
    "Behavior intentionally dropped",
    "Replacement active files"
  ]) {
    if (!reconciliation.includes(required)) {
      failures.push(`historical-mcp-reconciliation.md missing: ${required}`)
    }
  }
}

const packageJsonPath = path.join(root, "package.json")
const packageJson = JSON.parse(readFileSync(packageJsonPath, "utf8"))
for (const [name, script] of Object.entries(packageJson.scripts ?? {})) {
  if (String(script).includes("mcp/")) {
    failures.push(`package script ${name} must not reference mcp/`)
  }
}

for (const filePath of walk(path.join(root, "src"))) {
  const text = readFileSync(filePath, "utf8")
  for (const specifier of moduleSpecifiers(text)) {
    if (targetsHistoricalMcp(filePath, specifier)) {
      failures.push(`Active source must not import top-level mcp/: ${relative(filePath)}`)
    }
  }
}

const runCheckHistoricalMcpCleanup = Effect.gen(function* () {
  if (failures.length > 0) {
    console.error("Historical MCP cleanup check failed:")
    for (const failure of failures) {
      console.error(`- ${failure}`)
    }
    yield* Effect.fail(new Error("Historical MCP cleanup check failed."))
  }

  console.log("Historical MCP cleanup check passed.")
})

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  NodeRuntime.runMain(runScript("check-historical-mcp-cleanup", runCheckHistoricalMcpCleanup))
}

function walk(dir) {
  const out = []
  if (!existsSync(dir)) return out
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const filePath = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      out.push(...walk(filePath))
    } else if (filePath.endsWith(".ts") || filePath.endsWith(".js") || filePath.endsWith(".mjs")) {
      out.push(filePath)
    }
  }
  return out
}

function relative(filePath) {
  return path.relative(root, filePath).replaceAll(path.sep, "/")
}

function moduleSpecifiers(sourceText) {
  const out = []
  for (const match of sourceText.matchAll(/\bfrom\s+["']([^"']+)["']/g)) {
    out.push(match[1])
  }
  for (const match of sourceText.matchAll(/\bimport\(\s*["']([^"']+)["']\s*\)/g)) {
    out.push(match[1])
  }
  return out
}

function targetsHistoricalMcp(importerPath, specifier) {
  if (!specifier.startsWith(".")) return false
  const resolved = path.resolve(path.dirname(importerPath), specifier)
  return relative(resolved).split("/")[0] === "mcp"
}
