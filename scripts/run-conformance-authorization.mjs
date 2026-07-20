import { spawn } from "node:child_process"
import { existsSync, mkdirSync, readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"
import path from "node:path"
import { printConformanceIssueSummary } from "./report-conformance-failures.mjs"
import { writeConformanceEvidenceReport } from "./readiness-evidence.mjs"

const __filename = fileURLToPath(import.meta.url)
const root = path.resolve(path.dirname(__filename), "..")
const conformancePackage = path.join(root, "test/conformance")
const conformancePackagePath = path.join(conformancePackage, "package.json")
const conformancePackageName = "@modelcontextprotocol/conformance"
const specVersion = "2026-07-28"
const outputDir = createOutputDir("authorization")

if (!existsSync(conformancePackagePath)) {
  console.error("Missing test/conformance/package.json.")
  process.exit(1)
}

const conformancePackageJson = JSON.parse(readFileSync(conformancePackagePath, "utf8"))
const conformanceVersion = conformancePackageJson.devDependencies?.[conformancePackageName]
const args = buildAuthorizationArgs()

if (args.length === 0) {
  const evidencePath = writeConformanceEvidenceReport({
    name: "conformance-authorization",
    evidenceKind: "conformance-result",
    command: "pnpm run conformance:authorization",
    exitCode: 1,
    requirementIds: [],
    suite: "authorization",
    specVersion,
    conformancePackage: {
      name: conformancePackageName,
      version: conformanceVersion
    },
    target: { kind: "missing" },
    qualification: "blocked-missing-external-target",
    artifactDir: outputDir
  })
  console.error([
    "Missing authorization conformance target.",
    "Set MCP_AUTHORIZATION_CONFORMANCE_FILE to a conformance JSON settings file,",
    "or set MCP_AUTHORIZATION_CONFORMANCE_URL plus optional",
    "MCP_AUTHORIZATION_CLIENT_ID, MCP_AUTHORIZATION_CLIENT_SECRET, and",
    "MCP_AUTHORIZATION_CALLBACK_PORT. Draft authorization hardening is tracked by #20."
  ].join(" "))
  console.error(`Writing readiness evidence to ${evidencePath}`)
  process.exit(1)
}

console.log("Running MCP conformance authorization suite")
console.log(`MCP conformance spec version: ${specVersion}`)
console.log(`Writing MCP conformance artifacts to ${outputDir}`)

const result = await run(packageManagerPath(), [
  "--dir",
  conformancePackage,
  "exec",
  "conformance",
  "authorization",
  "--spec-version",
  "2026-07-28",
  "--output-dir",
  outputDir,
  ...args
], root)

const evidencePath = writeConformanceEvidenceReport({
  name: "conformance-authorization",
  evidenceKind: "conformance-result",
  command: "pnpm run conformance:authorization",
  exitCode: result,
  requirementIds: [],
  suite: "authorization",
  specVersion,
  conformancePackage: {
    name: conformancePackageName,
    version: conformanceVersion
  },
  artifactDir: outputDir
})
console.log(`Writing readiness evidence to ${evidencePath}`)
printConformanceIssueSummary("MCP conformance authorization suite", outputDir)
process.exit(result)

function buildAuthorizationArgs() {
  const settingsFile = process.env.MCP_AUTHORIZATION_CONFORMANCE_FILE
  if (settingsFile) {
    return ["--file", settingsFile]
  }

  const issuerUrl = process.env.MCP_AUTHORIZATION_CONFORMANCE_URL
  if (!issuerUrl) {
    return []
  }

  const args = ["--url", issuerUrl]
  appendOptional(args, "--client-id", process.env.MCP_AUTHORIZATION_CLIENT_ID)
  appendOptional(args, "--client-secret", process.env.MCP_AUTHORIZATION_CLIENT_SECRET)
  appendOptional(args, "--port", process.env.MCP_AUTHORIZATION_CALLBACK_PORT)
  return args
}

function appendOptional(args, flag, value) {
  if (value) {
    args.push(flag, value)
  }
}

function run(command, args, cwd) {
  return new Promise((resolve) => {
    const child = spawn(command, args, {
      cwd,
      stdio: "inherit"
    })
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
