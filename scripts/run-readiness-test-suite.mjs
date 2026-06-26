import { spawnSync } from "node:child_process"
import { existsSync, readFileSync } from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { readinessEvidencePath, writeTestEvidenceReport } from "./readiness-evidence.mjs"

const __filename = fileURLToPath(import.meta.url)
const root = path.resolve(path.dirname(__filename), "..")
const suiteName = process.argv[2]

const suites = {
  unit: {
    evidenceName: "unit-tests",
    evidenceKind: "unit-test-result",
    requirementIds: ["GR-TEST-002"],
    command: "pnpm run test:unit",
    cases: [
      caseDefinition("build-dist", "Build TypeScript before runtime unit checks.", "build"),
      caseDefinition(
        "generated-protocol-surfaces",
        "Generated protocol method sets, guards, and notification encoding.",
        "check:generated-protocol-surfaces"
      ),
      caseDefinition(
        "generated-schema-fixtures",
        "Generated schema constants and representative schema round trips.",
        "check:schema-fixtures"
      ),
      caseDefinition(
        "extension-boundary-errors",
        "Extension capability normalization and invalid-name error paths.",
        "check:extensions"
      )
    ]
  },
  integration: {
    evidenceName: "integration-tests",
    evidenceKind: "integration-test-result",
    requirementIds: ["GR-TEST-003"],
    command: "pnpm run test:integration",
    cases: [
      caseDefinition("build-dist", "Build TypeScript before integration checks.", "build"),
      caseDefinition(
        "sdk-runtime-affordances",
        "Server tool, resource, prompt, and notifications (draft surface).",
        "check:sdk-runtime"
      )
      // task-runtime-lifecycle removed: core tasks left the protocol in MCP
      // 2026-07-28 and become the io.modelcontextprotocol/tasks extension (#15).
    ]
  },
  e2e: {
    evidenceName: "e2e",
    evidenceKind: "e2e-result",
    requirementIds: ["GR-TEST-004"],
    command: "pnpm run test:e2e",
    cases: [
      // MCP 2026-07-28 (stateless draft): this is local package-health E2E,
      // not a substitute for official draft-targeted MCP conformance.
      // See docs/draft-2026-07-28-migration.md.
      caseDefinition(
        "mcp-draft-e2e",
        "Self-hosted MCP 2026-07-28 draft round-trip against the built Everything server.",
        "e2e:draft"
      )
    ]
  }
}

if (!Object.hasOwn(suites, suiteName)) {
  console.error("Usage: node scripts/run-readiness-test-suite.mjs <unit|integration|e2e>")
  process.exit(1)
}

const suite = suites[suiteName]
const cases = []

for (const testCase of suite.cases) {
  const result = runCase(testCase)
  cases.push(result)
  if (result.exitCode !== 0) {
    break
  }
}

const exitCode = cases.every((testCase) => testCase.status === "pass") ? 0 : 1
const draftE2eReport = suiteName === "e2e" ? readDraftE2eReport() : undefined
const evidencePath = writeTestEvidenceReport({
  name: suite.evidenceName,
  evidenceKind: suite.evidenceKind,
  command: suite.command,
  exitCode,
  summary: buildSummary(suiteName, cases, draftE2eReport),
  requirementIds: suite.requirementIds,
  suite: suiteName,
  cases,
  scenarios: draftE2eReport?.scenarios
})

console.log(`Writing readiness evidence to ${evidencePath}`)
process.exit(exitCode)

function caseDefinition(id, description, scriptName) {
  return {
    id,
    case: id,
    description,
    command: ["pnpm", ["run", scriptName]]
  }
}

function runCase(testCase) {
  const [command, args] = testCase.command
  console.log(`Running readiness test case ${testCase.id}: ${formatCommand(command, args)}`)
  const result = spawnSync(command, args, {
    cwd: root,
    encoding: "utf8"
  })
  process.stdout.write(result.stdout ?? "")
  process.stderr.write(result.stderr ?? "")

  const exitCode = result.status ?? 1
  return {
    id: testCase.id,
    case: testCase.case,
    description: testCase.description,
    command: formatCommand(command, args),
    exitCode,
    status: exitCode === 0 ? "pass" : "fail"
  }
}

function buildSummary(name, cases, conformanceReport) {
  const failed = cases.filter((testCase) => testCase.status !== "pass").length
  const summary = {
    suite: name,
    caseCount: cases.length,
    passed: cases.length - failed,
    failed
  }
  if (conformanceReport !== undefined) {
    summary.scenarioCount = conformanceReport.scenarioCount ?? 0
    summary.checkCount = conformanceReport.checkCount ?? 0
    summary.failureCount = conformanceReport.failureCount ?? failed
    summary.warningCount = conformanceReport.warningCount ?? 0
  }
  return summary
}

function readDraftE2eReport() {
  const reportPath = readinessEvidencePath("draft-e2e")
  if (!existsSync(reportPath)) {
    return undefined
  }
  try {
    return JSON.parse(readFileSync(reportPath, "utf8"))
  } catch {
    return undefined
  }
}

function formatCommand(command, args) {
  return [command, ...args].join(" ")
}
