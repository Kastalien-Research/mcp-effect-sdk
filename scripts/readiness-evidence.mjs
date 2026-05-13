import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"

const __filename = fileURLToPath(import.meta.url)
const root = path.resolve(path.dirname(__filename), "..")

export function readinessEvidencePath(name) {
  const rootDir = process.env.MCP_READINESS_EVIDENCE_DIR
    ? path.resolve(root, process.env.MCP_READINESS_EVIDENCE_DIR)
    : path.join(root, ".local", "readiness-evidence")
  mkdirSync(rootDir, { recursive: true })
  return path.join(rootDir, `${name}.json`)
}

export function writeConformanceEvidenceReport(options) {
  const report = buildConformanceEvidenceReport(options)
  const evidencePath = readinessEvidencePath(options.name)
  writeFileSync(evidencePath, `${JSON.stringify(report, null, 2)}\n`)
  return evidencePath
}

export function writeTestEvidenceReport(options) {
  const evidencePath = readinessEvidencePath(options.name)
  const report = {
    evidenceKind: options.evidenceKind,
    timestamp: new Date().toISOString(),
    command: options.command,
    exitCode: options.exitCode,
    summary: options.summary,
    requirementIds: options.requirementIds,
    suite: options.suite,
    cases: options.cases
  }
  if (options.scenarios !== undefined) {
    report.scenarios = options.scenarios
  }
  writeFileSync(evidencePath, `${JSON.stringify(report, null, 2)}\n`)
  return evidencePath
}

function buildConformanceEvidenceReport(options) {
  const summary = collectConformanceSummary(options.artifactDir)
  return {
    evidenceKind: options.evidenceKind,
    timestamp: new Date().toISOString(),
    command: options.command,
    exitCode: options.exitCode,
    summary: {
      suite: options.suite,
      scenarioCount: summary.scenarioCount,
      checkCount: summary.checkCount,
      failureCount: summary.failureCount,
      warningCount: summary.warningCount
    },
    requirementIds: options.requirementIds,
    suite: options.suite,
    artifactDir: reportArtifactDir(options.artifactDir),
    scenarioCount: summary.scenarioCount,
    checkCount: summary.checkCount,
    failureCount: summary.failureCount,
    warningCount: summary.warningCount,
    scenarios: summary.scenarios,
    failedChecks: summary.failedChecks
  }
}

function collectConformanceSummary(outputDir) {
  const checkFiles = listCheckFiles(outputDir)
  const failedChecks = []
  const scenarios = []
  let checkCount = 0
  let warningCount = 0

  for (const file of checkFiles) {
    const checks = JSON.parse(readFileSync(file, "utf8"))
    const scenario = scenarioNameFromCheckPath(file)
    let scenarioFailureCount = 0
    let scenarioWarningCount = 0
    for (const check of checks) {
      checkCount += 1
      if (check.status === "WARNING") {
        warningCount += 1
        scenarioWarningCount += 1
      }
      if (check.status !== "FAILURE") {
        continue
      }
      scenarioFailureCount += 1
      failedChecks.push({
        scenario,
        id: check.id,
        name: check.name,
        message: check.errorMessage ?? check.description,
        specReferences: check.specReferences ?? []
      })
    }
    scenarios.push({
      id: scenario,
      scenario,
      checkCount: checks.length,
      failureCount: scenarioFailureCount,
      warningCount: scenarioWarningCount,
      status: scenarioFailureCount === 0 ? "pass" : "fail"
    })
  }

  return {
    scenarioCount: checkFiles.length,
    checkCount,
    failureCount: failedChecks.length,
    warningCount,
    scenarios,
    failedChecks
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

function scenarioNameFromCheckPath(file) {
  return path
    .basename(path.dirname(file))
    .replace(/^(client|server)-/, "")
    .replace(/-\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}-\d{3}Z$/, "")
}

function reportArtifactDir(outputDir) {
  const relative = path.relative(root, outputDir)
  if (relative && !relative.startsWith("..") && !path.isAbsolute(relative)) {
    return relative
  }
  return outputDir
}
