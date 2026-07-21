import assert from "node:assert/strict"
import { existsSync, readFileSync } from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"

const __filename = fileURLToPath(import.meta.url)
const root = path.resolve(path.dirname(__filename), "..")
const failures = []

const requireFile = (relativePath) => {
  const filePath = path.join(root, relativePath)
  if (!existsSync(filePath)) {
    failures.push(`Missing ${relativePath}`)
    return ""
  }
  return readFileSync(filePath, "utf8")
}

const extensionDocs = requireFile("docs/extensions.md")
for (const required of [
  "Extensions are disabled by default.",
  "mcp-effect-sdk/experimental/tasks",
  "outside the stable SemVer",
  "namespace/name",
  "not core MCP conformance evidence"
]) {
  if (!extensionDocs.includes(required)) {
    failures.push(`docs/extensions.md missing required policy text: ${required}`)
  }
}

const serverSource = requireFile("src/McpServer.ts")
for (const required of [
  "export { normalizeExtensionCapabilities }",
  "export type { ExtensionCapabilities }",
  "capabilities.extensions = normalizeExtensionCapabilities"
]) {
  if (!serverSource.includes(required)) {
    failures.push(`src/McpServer.ts missing extension boundary marker: ${required}`)
  }
}

const sharedExtensionSource = requireFile("src/internal/ExtensionCapabilities.ts")
for (const required of [
  "export type ExtensionCapabilities",
  "export const normalizeExtensionCapabilities",
  "Invalid extension capability name",
  "Invalid extension capability settings"
]) {
  if (!sharedExtensionSource.includes(required)) {
    failures.push(`src/internal/ExtensionCapabilities.ts missing extension boundary marker: ${required}`)
  }
}

for (const rel of [
  "src/generated/mcp/2026-07-28/McpProtocol.generated.ts",
  "src/generated/mcp/2026-07-28/McpSchema.generated.ts"
]) {
  const source = requireFile(rel)
  if (source.includes("normalizeExtensionCapabilities") || source.includes("ExtensionCapabilities")) {
    failures.push(`${rel} must not import or define extension policy code`)
  }
}

const tierEvidence = requireFile("docs/conformance/sdk-tier-evidence.md")
if (!tierEvidence.includes("Extension behavior is excluded from core conformance evidence.")) {
  failures.push("sdk-tier-evidence.md must exclude extension behavior from core conformance evidence")
}

const packageJson = JSON.parse(requireFile("package.json") || "{}")
assert.deepEqual(packageJson.exports?.["./experimental/tasks"], {
  import: "./dist/experimental/tasks.js",
  types: "./dist/experimental/tasks.d.ts"
})
if (packageJson.scripts?.["check:extensions"] !== "node scripts/check-extension-boundary.mjs") {
  failures.push("package.json must define check:extensions")
}

const verifySource = requireFile("scripts/verify.mjs")
if (!verifySource.includes("check:extensions")) {
  failures.push("scripts/verify.mjs must run check:extensions")
}

if (failures.length > 0) {
  console.error("Extension boundary check failed:")
  for (const failure of failures) {
    console.error(`- ${failure}`)
  }
  process.exit(1)
}

const server = await import("../dist/McpServer.js")
assert.equal(server.normalizeExtensionCapabilities(undefined), undefined)
assert.deepEqual(
  server.normalizeExtensionCapabilities({ "io.modelcontextprotocol/example": { enabled: true } }),
  { "io.modelcontextprotocol/example": { enabled: true } }
)
assert.throws(
  () => server.normalizeExtensionCapabilities({ "not-namespaced": {} }),
  /Invalid extension capability name/
)
assert.deepEqual(
  server.normalizeExtensionCapabilities({ "com.example/": { enabled: true } }),
  { "com.example/": { enabled: true } }
)
assert.throws(
  () => server.normalizeExtensionCapabilities({ "io.modelcontextprotocol/example": null }),
  /Invalid extension capability settings/
)

console.log("Extension boundary check passed.")
