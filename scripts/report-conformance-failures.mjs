import { existsSync, readdirSync, readFileSync } from "node:fs"
import path from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"

const __filename = fileURLToPath(import.meta.url)
const root = path.resolve(path.dirname(__filename), "..")

export function collectConformanceIssues(outputDir) {
  const files = listCheckFiles(outputDir)
  const issues = []
  for (const file of files) {
    const checks = JSON.parse(readFileSync(file, "utf8"))
    const scenario = scenarioNameFromCheckPath(file)
    for (const check of checks) {
      if (!["FAILURE", "WARNING", "SKIPPED"].includes(check.status)) {
        continue
      }
      issues.push({
        scenario,
        id: check.id,
        status: check.status,
        name: check.name,
        message: check.errorMessage ?? check.description,
        specReferences: check.specReferences ?? []
      })
    }
  }
  return issues
}

function scenarioNameFromCheckPath(file) {
  return path
    .basename(path.dirname(file))
    .replace(/^server-/, "")
    .replace(/-\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}-\d{3}Z$/, "")
}

export function printConformanceIssueSummary(label, outputDir) {
  const issues = collectConformanceIssues(outputDir)
  const failures = issues.filter((issue) => issue.status === "FAILURE")
  const warnings = issues.filter((issue) => issue.status === "WARNING")
  const skipped = issues.filter((issue) => issue.status === "SKIPPED")

  console.log("")
  console.log(`${label} issue summary:`)
  console.log(`- artifact dir: ${path.relative(root, outputDir)}`)
  console.log(`- failures: ${failures.length}`)
  console.log(`- warnings: ${warnings.length}`)
  console.log(`- skipped checks: ${skipped.length}`)

  for (const issue of issues) {
    const refs = issue.specReferences
      .map((reference) => reference.id)
      .filter(Boolean)
      .join(", ")
    const suffix = refs ? ` [${refs}]` : ""
    console.log(`- ${issue.status}: ${issue.scenario} :: ${issue.id} :: ${issue.message}${suffix}`)
  }
}

function listCheckFiles(outputDir) {
  if (!existsSync(outputDir)) {
    return []
  }
  const files = []
  const visit = (dir) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const entryPath = path.join(dir, entry.name)
      if (entry.isDirectory()) {
        visit(entryPath)
      } else if (entry.name === "checks.json") {
        files.push(entryPath)
      }
    }
  }
  visit(outputDir)
  return files.sort()
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const outputDir = process.argv[2]
    ? path.resolve(root, process.argv[2])
    : latestConformanceRunDir()
  if (!outputDir) {
    console.error("No conformance output directory found.")
    process.exit(1)
  }
  printConformanceIssueSummary("MCP conformance", outputDir)
}

function latestConformanceRunDir() {
  const conformanceRoot = path.join(root, ".local", "conformance")
  if (!existsSync(conformanceRoot)) {
    return undefined
  }
  const dirs = readdirSync(conformanceRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => path.join(conformanceRoot, entry.name))
    .sort()
  return dirs.at(-1)
}
