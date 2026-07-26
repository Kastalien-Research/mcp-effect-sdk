import { existsSync, readFileSync } from "node:fs"
import { schemaErrors } from "./lib/evidence.mjs"
import path from "node:path"
import { fileURLToPath } from "node:url"

const __filename = fileURLToPath(import.meta.url)
const root = path.resolve(path.dirname(__filename), "..")
const failures = []
// Markers assert what a script does, not how Prettier wrapped it. A RegExp
// marker matches across whitespace; a string marker stays an exact match.
const matches = (source, required) => (typeof required === "string" ? source.includes(required) : required.test(source))

const activeServerScenarios = ["draft-round-trip", "tools-call"]

const requireFile = (relativePath) => {
  const filePath = path.join(root, relativePath)
  if (!existsSync(filePath)) {
    failures.push(`Missing ${relativePath}`)
    return ""
  }
  return readFileSync(filePath, "utf8")
}

const requireJson = (relativePath) => {
  const source = requireFile(relativePath)
  if (source === "") return undefined
  try {
    return JSON.parse(source)
  } catch (error) {
    failures.push(`${relativePath} is invalid JSON: ${error.message}`)
    return undefined
  }
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
  ["conformance:client", "node scripts/run-conformance-client.mjs"],
  ["conformance:client-auth", "node scripts/run-conformance-client-auth.mjs"],
  ["conformance:authorization", "node scripts/run-conformance-authorization.mjs"],
  ["conformance:run", "node scripts/run-conformance-suite.mjs"],
  ["verify:conformance", "node scripts/verify-conformance.mjs"]
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
  "e2e:draft",
  "verify:conformance"
]) {
  if (!verifySource.includes(required)) {
    failures.push(`scripts/verify.mjs must include ${required}`)
  }
}
if (verifySource.includes("conformance:client-auth")) {
  failures.push("scripts/verify.mjs must keep client-auth conformance separate from package health")
}
const verifyConformanceSource = requireFile("scripts/verify-conformance.mjs")
for (const required of ["conformance:run", "conformance:client", "conformance:client-auth"]) {
  if (!verifyConformanceSource.includes(required)) {
    failures.push(`scripts/verify-conformance.mjs must include ${required}`)
  }
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
const clientRunner = requireFile("scripts/run-conformance-client.mjs")
for (const required of [
  "test/conformance",
  "conformance",
  "client",
  /"--suite",\s*"all"/,
  "--spec-version",
  "2026-07-28",
  "loadOfficialScenarioInventory",
  "collectConformanceArtifactScenarios",
  "assertCompleteOfficialScenarioInventory",
  "GR-CONF-001",
  "conformanceEvidencePassed(result, evidence)"
]) {
  if (!matches(clientRunner, required)) {
    failures.push(`run-conformance-client.mjs missing complete client marker: ${required}`)
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
  "settleConformanceEvidenceReport"
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
  "captureRedacted",
  "publishArtifactLogs",
  '"stdout.log"',
  '"stderr.log"',
  "clearConformanceEvidence",
  "settleConformanceEvidenceReport",
  "normalizedChildExitCode",
  "process.exit(configuredExitCode)",
  "authorization.redactions"
]) {
  if (!authorizationRunner.includes(required)) {
    failures.push(`run-conformance-authorization.mjs missing output-redaction marker: ${required}`)
  }
}
if (/child\.(?:stdout|stderr)\.on\(["']data["']/.test(authorizationRunner)) {
  failures.push("run-conformance-authorization.mjs must consume child output through owned capture")
}
if (/process\.(?:once|on)\(["'](?:beforeExit|exit)["']/.test(authorizationRunner)) {
  failures.push("run-conformance-authorization.mjs must not use process lifecycle listeners as evidence owners")
}
if (/process\.(?:stdout|stderr)\.write/.test(authorizationRunner)) {
  failures.push("run-conformance-authorization.mjs must keep terminal output non-authoritative")
}
for (const obsolete of [
  "forwardRedacted",
  "writeWithBackpressure",
  "finalizeAuthorizationEvidenceAtExit",
  "outputTargetSucceeded"
]) {
  if (authorizationRunner.includes(obsolete)) {
    failures.push(`run-conformance-authorization.mjs retains obsolete terminal lifecycle owner: ${obsolete}`)
  }
}
const evidenceWriter = requireFile("scripts/readiness-evidence.mjs")
for (const required of [
  "assertConformanceEvidenceContract(report)",
  'artifactPath: path.join(options.artifactDir, "evidence.json")',
  'classification: "blocking-unadjudicated-conformance-warning"',
  'classification: "upstream-declared-skipped-informational"',
  "registeredRequirementIds",
  'report.requirementIds[0] !== "GR-CONF-001"',
  '"SUCCESS", "INFO", "WARNING", "FAILURE", "SKIPPED"',
  "validateConformanceScenarios",
  "publishEvidencePair",
  "clearConformanceEvidence",
  "settleConformanceEvidenceReport",
  "options.exitCode === 0 ? 0 : 1",
  "conformanceEvidencePassed(normalizedChildExitCode, candidate)",
  "artifactBytes !== readinessBytes",
  "removeEvidenceFile",
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
  failures.push("tsconfig.json must include src/**/* so the SDK builds")
}

const examplesTsconfig = JSON.parse(requireFile("examples/tsconfig.json") || "{}")
if (examplesTsconfig.compilerOptions?.outDir !== "../dist/examples") {
  failures.push("examples/tsconfig.json must emit to ../dist/examples so conformance harnesses can spawn them")
}

const exampleSource = requireFile("examples/everything-server.ts")
if (!exampleSource.includes("mcp-effect-sdk/protocol/2026-07-28") || !exampleSource.includes("McpProtocol")) {
  failures.push("everything-server.ts must use the published revisioned protocol entrypoint")
}
for (const forbidden of [
  "const tools = [",
  "const resources = [",
  "const prompts = [",
  'method: "notifications/message"',
  'method: "notifications/progress"'
]) {
  if (exampleSource.includes(forbidden)) {
    failures.push(`everything-server.ts must not hardcode protocol fixture behavior: ${forbidden}`)
  }
}
// MCP 2026-07-28 MRTR embeds sampling and elicitation request descriptors in
// InputRequiredResult, so their method literals are valid fixture behavior.
// The removed server-initiated request APIs themselves must stay absent.
for (const removed of ["McpServer.sample(", "McpServer.elicit(", "McpServer.elicitRaw("]) {
  if (exampleSource.includes(removed)) {
    failures.push(`everything-server.ts must not call removed server request API: ${removed}`)
  }
}
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
  if (!new RegExp(`\\|\\s*${scenario}\\s*\\|`).test(scenarioMap)) {
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
  failures.push("verify.yml must not describe official conformance as obsolete for MCP 2026-07-28")
}
for (const line of workflow.split("\n")) {
  const match = line.match(/uses:\s+[^@\s]+\/[^@\s]+@([^\s#]+)/)
  if (match && !/^[0-9a-f]{40}$/i.test(match[1])) {
    failures.push(`verify.yml must pin actions to full commit SHAs: ${line.trim()}`)
  }
}
for (const required of ["de0fac2e4500dabe0009e67214ff5f5447ce83dd", "53b83947a5a98c8d113130e565377fae1a50d02f"]) {
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
  'const suite = "all"',
  /"--suite",\s*"all"/,
  "loadOfficialScenarioInventory",
  "collectConformanceArtifactScenarios",
  "assertCompleteOfficialScenarioInventory"
]) {
  if (!matches(runner, required)) {
    failures.push(`run-conformance-suite.mjs missing lifecycle/boundary marker: ${required}`)
  }
}
if (runner.includes("MCP_CONFORMANCE_SUITE")) {
  failures.push("run-conformance-suite.mjs must not allow a partial suite override")
}
// The readiness probe moved into the shared process library so the suite,
// client-auth, authorization, and draft-e2e runners cannot drift apart. Assert
// it in its canonical home rather than in one caller: the requirement is that a
// TCP readiness probe backs `waitForReady`, not where the bytes sit.
const processLibrary = requireFile("scripts/lib/process.mjs")
for (const required of ["canConnect", "waitForReady", "findOpenPort"]) {
  if (!matches(processLibrary, required)) {
    failures.push(`lib/process.mjs missing lifecycle/boundary marker: ${required}`)
  }
}
const inventory = requireFile("scripts/conformance-inventory.mjs")
for (const required of [
  '"list"',
  "`--${kind}`",
  '"--spec-version"',
  "collectConformanceArtifactScenarios",
  "assertCompleteOfficialScenarioInventory"
]) {
  if (!inventory.includes(required)) {
    failures.push(`conformance-inventory.mjs missing official inventory marker: ${required}`)
  }
}
if (runner.includes("pnpm --prefix ../conformance")) {
  failures.push("run-conformance-suite.mjs must not use pnpm in ../conformance")
}
for (const [file, source] of [
  ["scripts/run-conformance-suite.mjs", runner],
  ["scripts/run-conformance-client.mjs", clientRunner],
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

// The adjudicated blocker ledger is the one thing that can turn a failing
// conformance run into a passing GR-CONF-001, so its shape is validated here —
// on every verify — rather than only on the path that consumes it. A ledger
// that has drifted from its schema must be caught even during a clean run.
const blockersPath = "docs/conformance/conformance-blockers.json"
if (existsSync(path.join(root, blockersPath))) {
  const blockersSchema = requireJson(`${blockersPath.replace(/\.json$/, "")}.schema.json`)
  const blockers = requireJson(blockersPath)
  if (blockersSchema && blockers) {
    for (const message of schemaErrors(blockersSchema, blockers)) {
      failures.push(`${blockersPath}${message}`)
    }
    // Every adjudication must name a test that actually exists, or the
    // "proven by a reproducer" claim is unfalsifiable.
    const reproducers = requireFile("test/conformance/alpha9-contradictions.test.mjs")
    for (const entry of blockers.blocked ?? []) {
      if (!reproducers.includes(entry.reproducerTest)) {
        failures.push(`${blockersPath} names a reproducer that does not exist: ${entry.reproducerTest}`)
      }
    }
  }
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
