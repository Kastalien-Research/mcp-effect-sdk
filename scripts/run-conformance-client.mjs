import { spawn } from "node:child_process"
import { existsSync, mkdirSync, readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"
import path from "node:path"
import {
  assertCompleteOfficialScenarioInventory,
  collectConformanceArtifactScenarios,
  loadOfficialScenarioInventory
} from "./conformance-inventory.mjs"
import { printConformanceIssueSummary } from "./report-conformance-failures.mjs"
import {
  conformanceEvidencePassed,
  writeConformanceEvidenceReport
} from "./readiness-evidence.mjs"

const __filename = fileURLToPath(import.meta.url)
const root = path.resolve(path.dirname(__filename), "..")
const conformancePackage = path.join(root, "test/conformance")
const conformancePackagePath = path.join(conformancePackage, "package.json")
const conformancePackageName = "@modelcontextprotocol/conformance"
const expectedConformanceVersion = "0.2.0-alpha.9"
const clientPath = path.join(root, "dist/examples/everything-client.js")
const specVersion = "2026-07-28"
const outputDir = createOutputDir("client-all")

if (!existsSync(clientPath)) {
  console.error("Missing built everything client. Run `pnpm run build` first.")
  process.exit(1)
}
if (!existsSync(conformancePackagePath)) {
  console.error("Missing test/conformance/package.json.")
  process.exit(1)
}

const conformancePackageJson = JSON.parse(readFileSync(conformancePackagePath, "utf8"))
const conformanceVersion = conformancePackageJson.devDependencies?.[conformancePackageName]
if (conformanceVersion !== expectedConformanceVersion) {
  console.error(`Expected ${conformancePackageName}@${expectedConformanceVersion}; received ${String(conformanceVersion)}`)
  process.exit(1)
}

const expectedScenarios = loadOfficialScenarioInventory({
  kind: "client",
  conformancePackage,
  specVersion
})
const command = `${process.execPath} ${clientPath}`
console.log(`Running all ${expectedScenarios.length} applicable MCP conformance client scenarios`)
console.log(`MCP conformance spec version: ${specVersion}`)
console.log(`Client command: ${command}`)
console.log(`Writing MCP conformance artifacts to ${outputDir}`)

const harnessExitCode = await run(packageManagerPath(), [
  "--dir",
  conformancePackage,
  "exec",
  "conformance",
  "client",
  "--suite",
  "all",
  "--spec-version",
  "2026-07-28",
  "--command",
  command,
  "--output-dir",
  outputDir
], root)

let result = harnessExitCode
try {
  assertCompleteOfficialScenarioInventory({
    kind: "client",
    expected: expectedScenarios,
    actual: collectConformanceArtifactScenarios(outputDir)
  })
} catch (error) {
  result = 1
  console.error(error instanceof Error ? error.message : String(error))
}

const evidencePath = writeConformanceEvidenceReport({
  name: "conformance-client",
  evidenceKind: "conformance-result",
  command: "pnpm run conformance:client",
  exitCode: result,
  requirementIds: ["GR-CONF-001"],
  suite: "client-all",
  specVersion,
  conformancePackage: {
    name: conformancePackageName,
    version: conformanceVersion
  },
  artifactDir: outputDir,
  preserveByRuntime: true
})
const evidence = JSON.parse(readFileSync(evidencePath, "utf8"))
console.log(`Writing readiness evidence to ${evidencePath}`)
printConformanceIssueSummary("MCP conformance complete client suite", outputDir)
process.exit(conformanceEvidencePassed(result, evidence) ? 0 : 1)

function run(command, args, cwd) {
  return new Promise((resolve) => {
    const child = spawn(command, args, { cwd, stdio: "inherit" })
    child.on("exit", (code) => resolve(code ?? 1))
  })
}

function packageManagerPath() {
  return process.platform === "win32" ? "pnpm.cmd" : "pnpm"
}

function createOutputDir(suiteName) {
  const rootDir = process.env.MCP_CONFORMANCE_OUTPUT_DIR
    ? path.resolve(root, process.env.MCP_CONFORMANCE_OUTPUT_DIR)
    : path.join(root, ".local", "conformance")
  const timestamp = new Date().toISOString().replaceAll(":", "-").replaceAll(".", "-")
  const runDir = path.join(rootDir, `${suiteName}-${timestamp}`)
  mkdirSync(runDir, { recursive: true })
  return runDir
}
