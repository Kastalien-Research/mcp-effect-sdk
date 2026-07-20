import { existsSync, readFileSync } from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"

const __filename = fileURLToPath(import.meta.url)
const root = path.resolve(path.dirname(__filename), "..")
const failures = []
const activeServerScenarios = [
  "draft-round-trip",
  "tools-call"
]

const requireFile = (relativePath) => {
  const filePath = path.join(root, relativePath)
  if (!existsSync(filePath)) {
    failures.push(`Missing ${relativePath}`)
    return ""
  }
  return readFileSync(filePath, "utf8")
}

const packageJson = JSON.parse(requireFile("package.json") || "{}")
const scripts = packageJson.scripts ?? {}
if (packageJson.packageManager !== "pnpm@10.11.1") {
  failures.push("package.json must pin packageManager to pnpm@10.11.1")
}
for (const [name, expected] of [
  ["check:conformance-evidence", "node scripts/check-conformance-evidence.mjs"],
  ["check:historical-mcp", "node scripts/check-historical-mcp-cleanup.mjs"],
  ["conformance:server", "node scripts/run-conformance-server.mjs"],
  ["conformance:client-auth", "node scripts/run-conformance-client-auth.mjs"],
  ["conformance:authorization", "node scripts/run-conformance-authorization.mjs"],
  ["conformance:run", "node scripts/run-conformance-suite.mjs"]
]) {
  if (!String(scripts[name] ?? "").includes(expected)) {
    failures.push(`package.json script ${name} must include: ${expected}`)
  }
}
const verifySource = requireFile("scripts/verify.mjs")
for (const required of [
  "check:conformance-evidence",
  "check:historical-mcp",
  "test:e2e",
  "e2e:draft"
]) {
  if (!verifySource.includes(required)) {
    failures.push(`scripts/verify.mjs must include ${required}`)
  }
}
if (verifySource.includes("conformance:client-auth")) {
  failures.push("scripts/verify.mjs must keep client-auth conformance separate from package health")
}
// `verify` owns local package health and draft E2E. Official server/core and
// client-auth conformance are separately runnable evidence lanes and must not
// be inferred from package health alone.
for (const forbidden of [/\bnpm\s/, /\bnpm\t/, /\bnpm\n/]) {
  for (const [name, value] of Object.entries(scripts)) {
    if (forbidden.test(String(value))) {
      failures.push(`package script ${name} must not run npm in this pnpm package`)
    }
  }
}

const workspaceSource = requireFile("pnpm-workspace.yaml")
for (const required of ['- "."', '- "test/conformance"']) {
  if (!workspaceSource.includes(required)) {
    failures.push(`pnpm-workspace.yaml must include ${required}`)
  }
}

const conformancePackage = JSON.parse(requireFile("test/conformance/package.json") || "{}")
if (conformancePackage.private !== true) {
  failures.push("test/conformance/package.json must be private")
}

const clientAuthRunner = requireFile("scripts/run-conformance-client-auth.mjs")
for (const required of [
  "test/conformance",
  "conformance",
  "client",
  "auth",
  "--spec-version",
  "2026-07-28",
  "--output-dir",
  "GR-CONF-001",
  "preserveByRuntime: true",
  "conformanceEvidencePassed(result, evidence)"
]) {
  if (!clientAuthRunner.includes(required)) {
    failures.push(`run-conformance-client-auth.mjs missing auth coverage marker: ${required}`)
  }
}
const authorizationRunner = requireFile("scripts/run-conformance-authorization.mjs")
for (const required of [
  "test/conformance",
  "conformance",
  "authorization",
  "--spec-version",
  "2026-07-28",
  "MCP_AUTHORIZATION_CONFORMANCE_FILE",
  "MCP_AUTHORIZATION_CONFORMANCE_URL",
  "#20",
  "--output-dir",
  "GR-CONF-001",
  'target: { kind: "settings-file" }',
  'target: { kind: "url" }',
  "conformanceEvidencePassed(result, evidence)"
]) {
  if (!authorizationRunner.includes(required)) {
    failures.push(`run-conformance-authorization.mjs missing authorization marker: ${required}`)
  }
}
for (const required of [
  "StringDecoder",
  "createRedactingWriter",
  'stdio: ["inherit", "pipe", "pipe"]',
  'child.on("close"',
  'child.once("error"',
  "for await (const chunk of readable)",
  'target.once("drain"',
  'target.once("close"',
  'target.once("error"',
  "target.write(output, (error) =>",
  "containOutputErrors",
  "stdoutSucceeded",
  "if (runResult.stdoutSucceeded)",
  "process.exitCode = conformanceEvidencePassed",
  "authorization.redactions"
]) {
  if (!authorizationRunner.includes(required)) {
    failures.push(`run-conformance-authorization.mjs missing output-redaction marker: ${required}`)
  }
}
if (/child\.(?:stdout|stderr)\.on\(["']data["']/.test(authorizationRunner)) {
  failures.push("run-conformance-authorization.mjs must not ignore destination backpressure")
}
if (authorizationRunner.includes("process.exit(conformanceEvidencePassed")) {
  failures.push("run-conformance-authorization.mjs must not force exit with pending output")
}
const evidenceWriter = requireFile("scripts/readiness-evidence.mjs")
for (const required of [
  "assertConformanceEvidenceContract(report)",
  'artifactPath: path.join(options.artifactDir, "evidence.json")',
  'classification: "blocking-unadjudicated-conformance-warning"',
  "registeredRequirementIds",
  'report.requirementIds[0] !== "GR-CONF-001"',
  '"SUCCESS", "INFO", "WARNING", "FAILURE"',
  "validateConformanceScenarios",
  "publishEvidencePair",
  "renameSync(artifactTemp, artifactPath)",
  "renameSync(readinessTemp, readinessPath)",
  "report.scenarioCount > 0",
  "report.checkCount > 0",
  "report.warningCount === 0",
  "sourceRevisions",
  "currentPackageManager"
]) {
  if (!evidenceWriter.includes(required)) {
    failures.push(`readiness-evidence.mjs missing fail-closed marker: ${required}`)
  }
}
const conformanceVersion = conformancePackage.devDependencies?.["@modelcontextprotocol/conformance"]
if (typeof conformanceVersion !== "string" || !conformanceVersion.startsWith("0.2.")) {
  failures.push("test/conformance must pin draft-targeted @modelcontextprotocol/conformance@0.2.x")
}

const tsconfig = JSON.parse(requireFile("tsconfig.json") || "{}")
const includes = Array.isArray(tsconfig.include) ? tsconfig.include.map(String) : []
if (!includes.some((entry) => entry === "src/**/*" || entry.startsWith("src/"))) {
  failures.push("tsconfig.json must include src/**/* so src/examples builds")
}

const exampleSource = requireFile("src/examples/everything-server.ts")
if (!exampleSource.includes('../protocol/2026-07-28.js') || !exampleSource.includes("McpProtocol")) {
  failures.push("everything-server.ts must use the published revisioned protocol entrypoint")
}
for (const forbidden of [
  "const tools = [",
  "const resources = [",
  "const prompts = [",
  'method: "notifications/message"',
  'method: "notifications/progress"',
  'method: "sampling/createMessage"',
  'method: "elicitation/create"'
]) {
  if (exampleSource.includes(forbidden)) {
    failures.push(`everything-server.ts must not hardcode protocol fixture behavior: ${forbidden}`)
  }
}
// MCP 2026-07-28 (stateless draft): McpServer.sample / elicit / elicitRaw are
// server-initiated requests, which the draft removed (replaced by MRTR /
// InputRequiredResult). The everything-server no longer registers tools that
// call them, so they are no longer required SDK-runtime markers. See
// docs/draft-2026-07-28-migration.md.
for (const required of [
  "McpServer.registerTool",
  "McpServer.registerResource",
  "McpServer.registerPrompt",
  "Deprecated.sendLoggingMessage",
  "McpServer.sendProgress"
]) {
  if (!exampleSource.includes(required)) {
    failures.push(`everything-server.ts must exercise SDK runtime API: ${required}`)
  }
}
if (!existsSync(path.join(root, "dist/examples/everything-server.js"))) {
  failures.push("dist/examples/everything-server.js is missing; run pnpm run build")
}

const scenarioMap = requireFile("docs/conformance/scenario-map.md")
for (const scenario of activeServerScenarios) {
  if (!scenarioMap.includes(`| ${scenario} |`)) {
    failures.push(`scenario-map.md must include self-hosted draft scenario ${scenario}`)
  }
}
for (const required of ["SDK feature", "Status", "Evidence"]) {
  if (!scenarioMap.includes(required)) {
    failures.push(`scenario-map.md must include ${required} column`)
  }
}

const tierEvidence = requireFile("docs/conformance/sdk-tier-evidence.md")
for (const required of [
  "Reproducible command",
  "Source inputs",
  "Conformance coverage",
  "Tier blockers",
  "Current evidenced tier"
]) {
  if (!tierEvidence.includes(required)) {
    failures.push(`sdk-tier-evidence.md missing section: ${required}`)
  }
}
if (existsSync(path.join(root, "docs/conformance/expected-failures.yml"))) {
  failures.push("docs/conformance/expected-failures.yml must not exist")
}

const dependencyPolicy = requireFile("docs/conformance/dependency-update-policy.md")
if (
  !dependencyPolicy.includes("pnpm") ||
  !dependencyPolicy.includes("test/conformance") ||
  !dependencyPolicy.includes("@modelcontextprotocol/conformance")
) {
  failures.push("dependency update policy must document the in-repo conformance package")
}
const versioningPolicy = requireFile("docs/conformance/versioning-policy.md")
if (!versioningPolicy.includes("stable release") || !versioningPolicy.includes("version")) {
  failures.push("versioning policy must document stable release/versioning status")
}

const readme = requireFile("README.md")
if (claimsUnevidencedTier(readme, tierEvidence)) {
  failures.push("README.md claims a tier or conformance level above the evidence report")
}

const workflow = requireFile(".github/workflows/verify.yml")
// MCP 2026-07-28: the workflow runs `pnpm run verify` for package health.
// Readiness/Tier qualification remains blocked until `conformance:run` records
// passing draft-targeted official MCP conformance evidence or an exact
// upstream/tool blocker.
for (const required of ["pnpm run verify"]) {
  if (!workflow.includes(required)) {
    failures.push(`verify.yml must run ${required}`)
  }
}
if (workflow.includes("external @modelcontextprotocol/conformance suite")) {
  failures.push(
    "verify.yml must not describe official conformance as obsolete for MCP 2026-07-28"
  )
}
for (const line of workflow.split("\n")) {
  const match = line.match(/uses:\s+[^@\s]+\/[^@\s]+@([^\s#]+)/)
  if (match && !/^[0-9a-f]{40}$/i.test(match[1])) {
    failures.push(`verify.yml must pin actions to full commit SHAs: ${line.trim()}`)
  }
}
for (const required of [
  "de0fac2e4500dabe0009e67214ff5f5447ce83dd",
  "53b83947a5a98c8d113130e565377fae1a50d02f"
]) {
  if (!workflow.includes(required)) {
    failures.push(`verify.yml missing pinned action SHA ${required}`)
  }
}

const runner = requireFile("scripts/run-conformance-suite.mjs")
for (const required of [
  "test/conformance",
  "--output-dir",
  "writeConformanceEvidenceReport",
  "GR-CONF-001",
  "--spec-version",
  "2026-07-28",
  "SIGTERM",
  "waitForReady",
  "canConnect"
]) {
  if (!runner.includes(required)) {
    failures.push(`run-conformance-suite.mjs missing lifecycle/boundary marker: ${required}`)
  }
}
if (runner.includes("pnpm --prefix ../conformance")) {
  failures.push("run-conformance-suite.mjs must not use pnpm in ../conformance")
}
for (const [file, source] of [
  ["scripts/run-conformance-suite.mjs", runner],
  ["test/conformance/package.json", requireFile("test/conformance/package.json")],
  ["package.json", JSON.stringify(packageJson)]
]) {
  if (source.includes("--expected-failures")) {
    failures.push(`${file} must not use --expected-failures`)
  }
  if (source.includes("expected-failures.yml")) {
    failures.push(`${file} must not reference expected-failures.yml`)
  }
}
if (runner.includes("../conformance") || runner.includes("npm --prefix")) {
  failures.push("run-conformance-suite.mjs must not depend on sibling ../conformance")
}
if (workflow.includes("../conformance") || workflow.includes("npm --prefix")) {
  failures.push("verify.yml must not depend on sibling ../conformance")
}

if (failures.length > 0) {
  console.error("Conformance evidence check failed:")
  for (const failure of failures) {
    console.error(`- ${failure}`)
  }
  process.exit(1)
}

console.log("Conformance evidence check passed.")

function claimsUnevidencedTier(readme, evidence) {
  const claimsTier = /Tier\s+[12]|full conformance|production ready/i.test(readme)
  const evidenceTier3 = /Current evidenced tier\s*\n+\s*Tier 3/i.test(evidence)
  return claimsTier && evidenceTier3
}
