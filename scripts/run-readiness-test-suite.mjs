import { spawnSync } from "node:child_process"
import { existsSync, readFileSync } from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"
import * as Effect from "effect/Effect"
import * as NodeRuntime from "@effect/platform-node/NodeRuntime"
import { readinessEvidencePath, writeTestEvidenceReport } from "./readiness-evidence.mjs"
import { runScript } from "./lib/process.mjs"

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
        "Server tool, resource, prompt, and notification behavior for MCP 2026-07-28.",
        "check:sdk-runtime"
      ),
      caseDefinition(
        "runtime-2026-07-28-compliance",
        "Final-schema façades, request-owned logging, and concurrent notification isolation.",
        "test:runtime-2026-07-28"
      ),
      caseDefinition(
        "runtime-2025-11-25-compliance",
        "Stateful lifecycle, bidirectional routing, Tasks, subscriptions, logging, and HTTP sessions.",
        "test:legacy"
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
      // This is local package-health E2E, not a substitute for official MCP
      // 2026-07-28 conformance.
      // See docs/migration-2026-07-28.md.
      caseDefinition(
        "mcp-2026-07-28-e2e",
        "Self-hosted MCP 2026-07-28 round-trip against the built Everything server.",
        "e2e:2026-07-28"
      ),
      caseDefinition(
        "mcp-2025-11-25-e2e",
        "Self-hosted stateful MCP 2025-11-25 round-trips over duplex and Streamable HTTP transports.",
        "e2e:2025-11-25"
      )
    ]
  }
}

const runReadinessTestSuite = Effect.gen(function* () {
  if (!Object.hasOwn(suites, suiteName)) {
    yield* Effect.fail(new Error("Usage: node scripts/run-readiness-test-suite.mjs <unit|integration|e2e>"))
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
  const stableE2eReport = suiteName === "e2e" ? readStableE2eReport() : undefined
  const evidencePath = writeTestEvidenceReport({
    name: suite.evidenceName,
    evidenceKind: suite.evidenceKind,
    command: suite.command,
    exitCode,
    summary: buildSummary(suiteName, cases, stableE2eReport),
    requirementIds: suite.requirementIds,
    suite: suiteName,
    cases,
    scenarios: stableE2eReport?.scenarios
  })

  console.log(`Writing readiness evidence to ${evidencePath}`)
  if (exitCode !== 0) {
    yield* Effect.fail(new Error(`${suiteName} readiness suite failed`))
  }
})

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  NodeRuntime.runMain(runScript("run-readiness-test-suite", runReadinessTestSuite))
}

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

function readStableE2eReport() {
  const reportPath = readinessEvidencePath("2026-07-28-e2e")
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
