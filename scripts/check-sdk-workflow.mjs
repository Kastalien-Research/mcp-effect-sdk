import { existsSync, readFileSync } from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const root = path.resolve(__dirname, "..")
const workspaceRoot = path.resolve(root, "..")

const requiredPaths = [
  "modelcontextprotocol/schema/2025-11-25/schema.json",
  "modelcontextprotocol/schema/2025-11-25/schema.ts",
  "modelcontextprotocol/seps/1730-sdks-tiering-system.md",
  "modelcontextprotocol/seps/1686-tasks.md",
  "modelcontextprotocol/seps/2133-extensions.md",
  "conformance",
  "mcp-effect-sdk/docs/sdk-generator-workflow.md",
  "mcp-effect-sdk/src/generated/mcp/McpSchema.generated.ts",
  "mcp-effect-sdk/src/generated/mcp/McpProtocol.generated.ts"
]

const requiredScripts = [
  "build",
  "check:invariants",
  "check:sdk-workflow",
  "verify"
]

const failures = []

for (const relativePath of requiredPaths) {
  const absolutePath = path.join(workspaceRoot, relativePath)
  if (!existsSync(absolutePath)) {
    failures.push(`Missing required workflow input: ${relativePath}`)
  }
}

const packageJsonPath = path.join(root, "package.json")
const packageJson = JSON.parse(readFileSync(packageJsonPath, "utf8"))
const scripts = packageJson.scripts ?? {}

for (const scriptName of requiredScripts) {
  if (typeof scripts[scriptName] !== "string") {
    failures.push(`Missing package script: ${scriptName}`)
  }
}

if (scripts.test?.includes("no test specified")) {
  failures.push("The package test script still contains the npm placeholder.")
}

if (failures.length > 0) {
  console.error("SDK workflow check failed.")
  for (const failure of failures) {
    console.error(`- ${failure}`)
  }
  process.exit(1)
}

console.log("SDK workflow check passed.")
