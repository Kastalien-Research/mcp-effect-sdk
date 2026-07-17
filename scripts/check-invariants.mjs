import { existsSync, readdirSync, readFileSync } from "node:fs"
import path from "node:path"
import ts from "typescript"
import { fileURLToPath } from "node:url"

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const root = path.resolve(__dirname, "..")
const printBaseline = process.argv.includes("--print-baseline")

const baselinePath = path.join(root, "invariants-baseline.json")

/** @type {Array<{ id: string, message: string, file?: string, line?: number }>} */
const violations = []

function relative(filePath) {
  return path.relative(root, filePath).replaceAll(path.sep, "/")
}

function addViolation(kind, filePath, line, message, column) {
  const rel = filePath ? relative(filePath) : "_package"
  const id = line === undefined ? `${kind}:${rel}` : column === undefined ? `${kind}:${rel}:${line}` : `${kind}:${rel}:${line}:${column}`
  violations.push({ id, message, file: rel, line, column })
}

function walk(dir, predicate = () => true) {
  /** @type {string[]} */
  const out = []
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const filePath = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      out.push(...walk(filePath, predicate))
    } else if (predicate(filePath)) {
      out.push(filePath)
    }
  }
  return out
}

function readJson(filePath) {
  return JSON.parse(readFileSync(filePath, "utf8"))
}

function checkRoadmapInvariants() {
  const roadmap = path.join(root, "ROADMAP.md")
  const content = readFileSync(roadmap, "utf8")
  for (const required of [
    "## Invariants",
    "The SDK is generated from MCP schema/spec artifacts",
    "Public SDK APIs must not use `any`",
    "Ad hoc repair scripts"
  ]) {
    if (!content.includes(required)) {
      addViolation("roadmap-missing-invariant", roadmap, undefined, `Missing invariant text: ${required}`)
    }
  }
}

function checkGeneratedBanners() {
  for (const rel of [
    "src/generated/mcp/McpProtocol.generated.ts",
    "src/generated/mcp/2026-07-28/McpSchema.generated.ts"
  ]) {
    const filePath = path.join(root, rel)
    if (!existsSync(filePath)) {
      addViolation("missing-generated-file", filePath, undefined, `${rel} is missing`)
      continue
    }
    const content = readFileSync(filePath, "utf8")
    if (!content.includes("Generated") || !content.includes("Do not edit manually.")) {
      addViolation("missing-generated-banner", filePath, undefined, `${rel} is missing generated-file banner`)
    }
  }
}

function checkTsconfigBoundary() {
  const tsconfigPath = path.join(root, "tsconfig.json")
  const tsconfig = readJson(tsconfigPath)
  const includes = Array.isArray(tsconfig.include) ? tsconfig.include : []
  if (includes.some((entry) => targetsHistoricalMcpTree(String(entry)))) {
    addViolation("tsconfig-includes-historical-mcp", tsconfigPath, undefined, "tsconfig must not include historical mcp/")
  }
}

function targetsHistoricalMcpTree(specifier) {
  let normalized = specifier.replaceAll("\\", "/")
  while (normalized.startsWith("./")) {
    normalized = normalized.slice(2)
  }
  const firstSegment = normalized.split("/")[0]
  return firstSegment === "mcp"
}

function checkExplicitAny() {
  const src = path.join(root, "src")
  if (!existsSync(src)) return
  const files = walk(src, (filePath) => filePath.endsWith(".ts") && !filePath.includes("/generated/"))
  for (const filePath of files) {
    const sourceText = readFileSync(filePath, "utf8")
    const sourceFile = ts.createSourceFile(filePath, sourceText, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS)
    const visit = (node) => {
      if (node.kind === ts.SyntaxKind.AnyKeyword && !hasAllowInvariantAnyComment(sourceText, node)) {
        const position = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile))
        addViolation("explicit-any", filePath, position.line + 1, "Do not use any in active SDK source", position.character + 1)
      }
      ts.forEachChild(node, visit)
    }
    visit(sourceFile)
  }
}

function hasAllowInvariantAnyComment(sourceText, node) {
  const lineStart = sourceText.lastIndexOf("\n", node.getFullStart()) + 1
  const lineEnd = sourceText.indexOf("\n", node.getEnd())
  const line = sourceText.slice(lineStart, lineEnd === -1 ? sourceText.length : lineEnd)
  return line.includes("@allow-invariant-any")
}

function checkHistoricalImports() {
  const src = path.join(root, "src")
  if (!existsSync(src)) return
  const files = walk(src, (filePath) => filePath.endsWith(".ts"))
  for (const filePath of files) {
    const sourceText = readFileSync(filePath, "utf8")
    const sourceFile = ts.createSourceFile(filePath, sourceText, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS)
    for (const statement of sourceFile.statements) {
      const specifier = getModuleSpecifierText(statement)
      if (specifier && moduleSpecifierTargetsHistoricalMcp(filePath, specifier)) {
        const position = sourceFile.getLineAndCharacterOfPosition(statement.getStart(sourceFile))
        addViolation("imports-historical-mcp", filePath, position.line + 1, "Active source must not import from historical mcp/", position.character + 1)
      }
    }
  }
}

function getModuleSpecifierText(statement) {
  if (
    (ts.isImportDeclaration(statement) || ts.isExportDeclaration(statement)) &&
    statement.moduleSpecifier &&
    ts.isStringLiteral(statement.moduleSpecifier)
  ) {
    return statement.moduleSpecifier.text
  }
  return undefined
}

function moduleSpecifierTargetsHistoricalMcp(importerPath, specifier) {
  if (!specifier.startsWith(".")) return false
  const resolved = path.resolve(path.dirname(importerPath), specifier)
  const rel = relative(resolved)
  return rel.split("/")[0] === "mcp"
}

const adHocScriptExtensions = new Set([".js", ".mjs", ".cjs", ".ts"])
const adHocRepairScriptNames = new Set(["rewrite", "clean-fix"])

function isAdHocRootScript(name) {
  const parsed = path.parse(name)
  if (!adHocScriptExtensions.has(parsed.ext)) return false
  if (adHocRepairScriptNames.has(parsed.name)) return true
  for (const prefix of ["fix-", "inspect-", "test-"]) {
    if (parsed.name.startsWith(prefix)) return true
  }
  return false
}

function checkAdHocRootScripts() {
  const names = readdirSync(root)
  for (const name of names) {
    if (isAdHocRootScript(name)) {
      addViolation("adhoc-root-script", path.join(root, name), undefined, "Ad hoc repair/debug scripts must not live at package root")
    }
  }
}

checkRoadmapInvariants()
checkGeneratedBanners()
checkTsconfigBoundary()
checkExplicitAny()
checkHistoricalImports()
checkAdHocRootScripts()

violations.sort((a, b) => a.id.localeCompare(b.id))

if (printBaseline) {
  console.log(JSON.stringify({
    version: 1,
    accepted: violations.map((violation) => violation.id)
  }, null, 2))
  process.exit(0)
}

if (!existsSync(baselinePath)) {
  console.error("Missing invariants-baseline.json. Run:")
  console.error("  node scripts/check-invariants.mjs --print-baseline")
  process.exit(1)
}

const baseline = readJson(baselinePath)
const accepted = new Set(Array.isArray(baseline.accepted) ? baseline.accepted : [])
const current = new Set(violations.map((violation) => violation.id))
const newViolations = violations.filter((violation) => !accepted.has(violation.id))
const resolvedViolations = [...accepted].filter((id) => !current.has(id))
const explicitAnyCount = violations.filter((violation) => violation.id.startsWith("explicit-any:")).length

if (newViolations.length > 0) {
  console.error("Invariant check failed. New violations:")
  for (const violation of newViolations) {
    const location = violation.line ? `${violation.file}:${violation.line}` : violation.file
    console.error(`- ${violation.id} (${location}) ${violation.message}`)
  }
  process.exit(1)
}

if (resolvedViolations.length > 0) {
  console.error("Invariant baseline has resolved entries. Remove these from invariants-baseline.json:")
  for (const id of resolvedViolations) {
    console.error(`- ${id}`)
  }
  process.exit(1)
}

console.log(
  `Invariant check passed with ${violations.length} accepted existing violation(s); explicit any count: ${explicitAnyCount}.`
)
