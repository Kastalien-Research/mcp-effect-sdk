import { existsSync, readFileSync } from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"
import * as ts from "typescript"

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
  ["conformance:run", "node scripts/run-conformance-suite.mjs"]
]) {
  if (!String(scripts[name] ?? "").includes(expected)) {
    failures.push(`package.json script ${name} must include: ${expected}`)
  }
}
const verifySource = requireFile("scripts/verify.mjs")
for (const required of ["check:conformance-evidence", "check:historical-mcp"]) {
  if (!verifySource.includes(required)) {
    failures.push(`scripts/verify.mjs must include ${required}`)
  }
}
if (!verifySource.includes("conformance:client-auth")) {
  failures.push("scripts/verify.mjs must include conformance:client-auth")
}
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
  "--output-dir"
]) {
  if (!clientAuthRunner.includes(required)) {
    failures.push(`run-conformance-client-auth.mjs missing auth coverage marker: ${required}`)
  }
}
if (
  conformancePackage.devDependencies?.["@modelcontextprotocol/conformance"] !== "0.1.15"
) {
  failures.push("test/conformance must pin @modelcontextprotocol/conformance to 0.1.15")
}

const tsconfig = JSON.parse(requireFile("tsconfig.json") || "{}")
const includes = Array.isArray(tsconfig.include) ? tsconfig.include.map(String) : []
if (!includes.some((entry) => entry === "src/**/*" || entry.startsWith("src/"))) {
  failures.push("tsconfig.json must include src/**/* so src/examples builds")
}

const exampleSource = requireFile("src/examples/everything-server.ts")
if (!exampleSource.includes("McpProtocol.generated")) {
  failures.push("everything-server.ts must use package generated protocol facts")
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
for (const required of [
  "McpServer.registerTool",
  "McpServer.registerResource",
  "McpServer.registerPrompt",
  "McpServer.sample",
  "McpServer.elicit",
  "McpServer.sendLoggingMessage",
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
for (const scenario of listActiveServerScenarios()) {
  if (!scenarioMap.includes(`| ${scenario} |`)) {
    failures.push(`scenario-map.md must include active server scenario ${scenario}`)
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
for (const required of ["pnpm run verify", "pnpm run conformance:run"]) {
  if (!workflow.includes(required)) {
    failures.push(`verify.yml must run ${required}`)
  }
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

function listActiveServerScenarios() {
  const conformanceIndexPath = path.resolve(root, "../conformance/src/scenarios/index.ts")
  if (!existsSync(conformanceIndexPath)) {
    failures.push("Missing ../conformance/src/scenarios/index.ts for generated active scenario list")
    return []
  }

  const sourceFile = readTypescriptSource(conformanceIndexPath)
  const imports = readNamedImports(sourceFile, conformanceIndexPath)
  const all = readScenarioList(sourceFile, "allClientScenariosList", imports)
  const pending = new Set(readScenarioList(sourceFile, "pendingClientScenariosList", imports))
  return all.filter((scenario) => !pending.has(scenario)).sort()
}

function readTypescriptSource(filePath) {
  return ts.createSourceFile(
    filePath,
    readFileSync(filePath, "utf8"),
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS
  )
}

function readNamedImports(sourceFile, ownerPath) {
  const imports = new Map()
  for (const statement of sourceFile.statements) {
    if (!ts.isImportDeclaration(statement) || !ts.isStringLiteral(statement.moduleSpecifier)) {
      continue
    }
    const namedBindings = statement.importClause?.namedBindings
    if (!namedBindings || !ts.isNamedImports(namedBindings)) {
      continue
    }
    const importPath = resolveTypescriptImport(ownerPath, statement.moduleSpecifier.text)
    for (const element of namedBindings.elements) {
      imports.set(element.name.text, importPath)
    }
  }
  return imports
}

function resolveTypescriptImport(ownerPath, specifier) {
  const resolved = path.resolve(path.dirname(ownerPath), specifier)
  return resolved.endsWith(".ts") ? resolved : `${resolved}.ts`
}

function readScenarioList(sourceFile, variableName, imports) {
  const declaration = findVariableDeclaration(sourceFile, variableName)
  if (!declaration || !declaration.initializer || !ts.isArrayLiteralExpression(declaration.initializer)) {
    failures.push(`Unable to generate conformance scenarios from ${variableName}`)
    return []
  }

  const scenarios = []
  for (const element of declaration.initializer.elements) {
    if (!ts.isNewExpression(element) || !ts.isIdentifier(element.expression)) {
      failures.push(`${variableName} contains unsupported scenario expression: ${element.getText(sourceFile)}`)
      continue
    }
    const className = element.expression.text
    const sourcePath = imports.get(className)
    if (!sourcePath || !existsSync(sourcePath)) {
      failures.push(`Unable to resolve conformance scenario class ${className}`)
      continue
    }
    const scenarioName = readScenarioName(sourcePath, className)
    if (scenarioName) {
      scenarios.push(scenarioName)
    }
  }
  return scenarios
}

function findVariableDeclaration(sourceFile, variableName) {
  let found
  const visit = (node) => {
    if (
      ts.isVariableDeclaration(node) &&
      ts.isIdentifier(node.name) &&
      node.name.text === variableName
    ) {
      found = node
      return
    }
    ts.forEachChild(node, visit)
  }
  visit(sourceFile)
  return found
}

function readScenarioName(sourcePath, className) {
  const sourceFile = readTypescriptSource(sourcePath)
  for (const statement of sourceFile.statements) {
    if (!ts.isClassDeclaration(statement) || statement.name?.text !== className) {
      continue
    }
    for (const member of statement.members) {
      if (
        ts.isPropertyDeclaration(member) &&
        ts.isIdentifier(member.name) &&
        member.name.text === "name" &&
        member.initializer &&
        ts.isStringLiteral(member.initializer)
      ) {
        return member.initializer.text
      }
    }
  }
  failures.push(`Unable to read scenario name from ${sourcePath}#${className}`)
  return undefined
}
