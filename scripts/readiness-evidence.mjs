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

export function runtimeEvidenceName(name, runtimeVersion = process.version) {
  return `${name}-node-${safeFileSegment(runtimeVersion)}`
}

export function writeConformanceEvidenceReport(options) {
  const report = buildConformanceEvidenceReport(options)
  assertConformanceEvidenceContract(report)
  const evidenceName = options.preserveByRuntime
    ? runtimeEvidenceName(options.name, report.runtime.version)
    : options.name
  const evidencePath = readinessEvidencePath(evidenceName)
  const serialized = `${JSON.stringify(report, null, 2)}\n`
  writeFileSync(evidencePath, serialized)
  mkdirSync(options.artifactDir, { recursive: true })
  writeFileSync(path.join(options.artifactDir, "evidence.json"), serialized)
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

export function buildConformanceEvidenceReport(options) {
  const summary = collectConformanceSummary(options.artifactDir)
  const authority = conformanceAuthority()
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
    specVersion: options.specVersion,
    conformancePackage: options.conformancePackage,
    runtime: currentRuntime(),
    packageManager: currentPackageManager(authority.packageManagerVersion),
    sourceRevisions: authority.sourceRevisions,
    ...(options.target === undefined ? {} : { target: options.target }),
    ...(options.qualification === undefined ? {} : { qualification: options.qualification }),
    artifactDir: reportArtifactDir(options.artifactDir),
    scenarioCount: summary.scenarioCount,
    checkCount: summary.checkCount,
    failureCount: summary.failureCount,
    warningCount: summary.warningCount,
    scenarios: summary.scenarios,
    failedChecks: summary.failedChecks,
    warningClassifications: summary.warningChecks.map((warning) => ({
      ...warning,
      classification: "blocking-unadjudicated-conformance-warning"
    }))
  }
}

export function assertConformanceEvidenceContract(report) {
  requireRecord(report, "conformance evidence")
  requireEqual(report.evidenceKind, "conformance-result", "evidenceKind")
  requireNonEmptyString(report.timestamp, "timestamp")
  requireNonEmptyString(report.command, "command")
  requireInteger(report.exitCode, "exitCode")
  requireNonEmptyString(report.suite, "suite")
  requireNonEmptyString(report.specVersion, "specVersion")
  requireNonEmptyString(report.artifactDir, "artifactDir")

  if (!Array.isArray(report.requirementIds) || report.requirementIds.length === 0) {
    throw new Error("Conformance evidence requires at least one requirement ID")
  }
  const registeredRequirements = registeredRequirementIds()
  for (const requirementId of report.requirementIds) {
    if (typeof requirementId !== "string" || !/^GR-[A-Z0-9-]+-\d+$/.test(requirementId)) {
      throw new Error(`Invalid conformance requirement ID: ${String(requirementId)}`)
    }
    if (!registeredRequirements.has(requirementId)) {
      throw new Error(`Unknown conformance requirement ID: ${requirementId}`)
    }
  }

  const authority = conformanceAuthority()
  requireEqual(report.specVersion, authority.protocolVersion, "specVersion")
  requireRecord(report.runtime, "runtime")
  requireEqual(report.runtime.name, "node", "runtime.name")
  requireEqual(report.runtime.version, process.version, "runtime.version")
  requireRecord(report.packageManager, "packageManager")
  requireEqual(report.packageManager.name, "pnpm", "packageManager.name")
  const actualPackageManager = currentPackageManager(authority.packageManagerVersion)
  requireEqual(
    report.packageManager.version,
    actualPackageManager.version,
    "packageManager.version"
  )
  requireRecord(report.sourceRevisions, "sourceRevisions")
  requireEqual(
    report.sourceRevisions.mcpCore,
    authority.sourceRevisions.mcpCore,
    "sourceRevisions.mcpCore"
  )
  requireEqual(
    report.sourceRevisions.mcpConformance,
    authority.sourceRevisions.mcpConformance,
    "sourceRevisions.mcpConformance"
  )
  if (Object.keys(report.sourceRevisions).length !== 2) {
    throw new Error("sourceRevisions must contain exactly mcpCore and mcpConformance")
  }

  requireRecord(report.conformancePackage, "conformancePackage")
  requireEqual(
    report.conformancePackage.name,
    "@modelcontextprotocol/conformance",
    "conformancePackage.name"
  )
  requireEqual(
    report.conformancePackage.version,
    authority.conformanceVersion,
    "conformancePackage.version"
  )
  requireRecord(report.summary, "summary")
  requireEqual(report.summary.suite, report.suite, "summary.suite")
  for (const count of ["scenarioCount", "checkCount", "failureCount", "warningCount"]) {
    requireNonNegativeInteger(report[count], count)
    requireEqual(report.summary[count], report[count], `summary.${count}`)
  }
  if (!Array.isArray(report.scenarios) || report.scenarios.length !== report.scenarioCount) {
    throw new Error("scenarios must match scenarioCount")
  }
  if (!Array.isArray(report.failedChecks) || report.failedChecks.length !== report.failureCount) {
    throw new Error("failedChecks must match failureCount")
  }
  if (
    !Array.isArray(report.warningClassifications) ||
    report.warningClassifications.length !== report.warningCount
  ) {
    throw new Error("warningClassifications must match warningCount")
  }
  for (const warning of report.warningClassifications) {
    requireRecord(warning, "warning classification")
    requireEqual(
      warning.classification,
      "blocking-unadjudicated-conformance-warning",
      "warning.classification"
    )
  }

  if (report.suite === "authorization") {
    requireRecord(report.target, "authorization target")
    const targetKeys = Object.keys(report.target)
    if (targetKeys.length !== 1 || targetKeys[0] !== "kind") {
      throw new Error("Authorization target provenance may contain only kind")
    }
    if (!["missing", "settings-file", "url"].includes(report.target.kind)) {
      throw new Error("Authorization target kind must be missing, settings-file, or url")
    }
  } else if (report.target !== undefined) {
    throw new Error("Only authorization evidence may include target provenance")
  }

  return report
}

export function conformanceEvidencePassed(harnessExitCode, report) {
  try {
    assertConformanceEvidenceContract(report)
  } catch {
    return false
  }
  return harnessExitCode === 0 &&
    report.exitCode === 0 &&
    report.scenarioCount > 0 &&
    report.checkCount > 0 &&
    report.failureCount === 0 &&
    report.warningCount === 0 &&
    report.failedChecks.length === 0 &&
    report.warningClassifications.length === 0
}

function collectConformanceSummary(outputDir) {
  const checkFiles = listCheckFiles(outputDir)
  const failedChecks = []
  const warningChecks = []
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
        warningChecks.push({
          scenario,
          id: check.id,
          name: check.name,
          specReferences: check.specReferences ?? []
        })
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
      status: scenarioFailureCount > 0
        ? "fail"
        : scenarioWarningCount > 0
          ? "warning"
          : "pass"
    })
  }

  return {
    scenarioCount: checkFiles.length,
    checkCount,
    failureCount: failedChecks.length,
    warningCount,
    warningChecks,
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

function conformanceAuthority() {
  const packageJson = JSON.parse(readFileSync(path.join(root, "package.json"), "utf8"))
  const manifest = JSON.parse(readFileSync(path.join(root, "sources/manifest.json"), "utf8"))
  const packageManagerMatch = /^pnpm@(.+)$/.exec(packageJson.packageManager ?? "")
  if (!packageManagerMatch) {
    throw new Error("package.json must pin a pnpm package manager version")
  }
  const sources = new Map(manifest.sources.map((source) => [source.id, source]))
  const mcpCore = sources.get("mcp-core")
  const mcpConformance = sources.get("mcp-conformance")
  if (!mcpCore?.revision || !mcpConformance?.revision || !mcpConformance?.version) {
    throw new Error("sources/manifest.json is missing MCP conformance authority")
  }
  return {
    protocolVersion: manifest.protocolVersion,
    packageManagerVersion: packageManagerMatch[1],
    conformanceVersion: mcpConformance.version,
    sourceRevisions: {
      mcpCore: mcpCore.revision,
      mcpConformance: mcpConformance.revision
    }
  }
}

function registeredRequirementIds() {
  const source = readFileSync(path.join(root, "docs/sdk-readiness-requirements.md"), "utf8")
  return new Set(Array.from(source.matchAll(/^\|\s*(GR-[A-Z0-9-]+-\d+)\s*\|/gm), (match) => match[1]))
}

function currentRuntime() {
  return { name: "node", version: process.version }
}

function currentPackageManager(expectedVersion) {
  const userAgent = process.env.npm_config_user_agent ?? ""
  const match = /^pnpm\/([^\s]+).*\bnode\/([^\s]+)\b/.exec(userAgent)
  if (!match) {
    throw new Error("Conformance evidence requires pnpm runtime provenance")
  }
  if (match[1] !== expectedVersion) {
    throw new Error(`Expected pnpm ${expectedVersion}; received ${match[1]}`)
  }
  const packageManagerNodeVersion = match[2].startsWith("v") ? match[2] : `v${match[2]}`
  if (packageManagerNodeVersion !== process.version) {
    throw new Error(`pnpm runtime Node version does not match ${process.version}`)
  }
  return { name: "pnpm", version: match[1] }
}

function safeFileSegment(value) {
  return String(value).replace(/[^a-z0-9._-]/gi, "-")
}

function requireRecord(value, name) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${name} must be an object`)
  }
}

function requireNonEmptyString(value, name) {
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`${name} must be a non-empty string`)
  }
}

function requireInteger(value, name) {
  if (!Number.isInteger(value)) {
    throw new Error(`${name} must be an integer`)
  }
}

function requireNonNegativeInteger(value, name) {
  requireInteger(value, name)
  if (value < 0) {
    throw new Error(`${name} must be non-negative`)
  }
}

function requireEqual(actual, expected, name) {
  if (actual !== expected) {
    throw new Error(`${name} must equal ${String(expected)}`)
  }
}
