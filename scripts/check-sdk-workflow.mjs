import { existsSync, readFileSync } from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const root = path.resolve(__dirname, "..")

const requiredPackagePaths = [
  "docs/sdk-generator-workflow.md",
  "docs/acceptance-gates/sdk-generator.md",
  "src/generated/mcp/McpSchema.generated.ts",
  "src/generated/mcp/McpProtocol.generated.ts"
]

const requiredGateHeadings = [
  "## Phase 0: Workflow Grounding",
  "## Phase 1: Package-Local Generator Entrypoint",
  "## Phase 2: Generated Protocol Metadata",
  "## Phase 3: Generated Schema Surface",
  "## Phase 4: Generated Client, Server, Notifications, And Dispatch",
  "## Phase 5: Task Runtime Boundary",
  "## Phase 6: Conformance Evidence And Example Server",
  "## Phase 7: Extension Opt-In Gates",
  "## Phase 8: Historical Test Reconciliation",
  "## Gate Discipline"
]

const requiredScripts = [
  "build",
  "check:generated",
  "check:invariants",
  "check:sdk-workflow",
  "generate:mcp",
  "verify"
]

const failures = []

for (const relativePath of requiredPackagePaths) {
  const absolutePath = path.join(root, relativePath)
  if (!existsSync(absolutePath)) {
    failures.push(`Missing required package workflow input: ${relativePath}`)
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

const gatePath = path.join(root, "docs/acceptance-gates/sdk-generator.md")
if (existsSync(gatePath)) {
  const gateContent = readFileSync(gatePath, "utf8")
  for (const heading of requiredGateHeadings) {
    if (!gateContent.includes(heading)) {
      failures.push(`Missing SDK generator acceptance gate heading: ${heading}`)
    }
  }
}

if (failures.length > 0) {
  console.error("SDK workflow check failed.")
  for (const failure of failures) {
    console.error(`- ${failure}`)
  }
  process.exit(1)
}

console.log("SDK workflow check passed.")
