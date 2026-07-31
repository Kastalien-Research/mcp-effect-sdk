import { existsSync, readFileSync } from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"
import * as Effect from "effect/Effect"
import * as NodeRuntime from "@effect/platform-node/NodeRuntime"
import { runScript } from "./lib/process.mjs"

import Ajv2020 from "ajv/dist/2020.js"
import addFormats from "ajv-formats"

import { deriveMaintenanceScorecard } from "./lib/sla.mjs"

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")
const failures = []
const exactLabels = [
  "bug",
  "enhancement",
  "question",
  "needs confirmation",
  "needs repro",
  "ready for work",
  "good first issue",
  "help wanted",
  "P0",
  "P1",
  "P2",
  "P3"
]

const maintenance = requireText("MAINTENANCE.md")
requireAll("MAINTENANCE.md", maintenance, [
  "creation to the first GitHub label event",
  "first exact `P0` label",
  "two business days",
  "seven calendar days",
  "append-only all-history ledger",
  "rolling official scorecard",
  "90%",
  "GR-TIER-002"
])

const security = requireText("SECURITY.md")
requireAll("SECURITY.md", security, ["seven calendar days", "GitHub Security Advisories"])

const escalation = requireText("docs/maintenance/p0-escalation.md")
requireAll("P0 escalation", escalation, [
  "manual",
  "exact `P0` label",
  "label application",
  "seven calendar days",
  "GitHub Security Advisory"
])

for (const template of [
  "bug-report.yml",
  "critical-incident.yml",
  "feature-request.yml",
  "question.yml",
  "config.yml"
]) {
  const source = requireText(`.github/ISSUE_TEMPLATE/${template}`)
  if (/^labels:/m.test(source)) {
    failures.push(`${template} must not auto-apply labels`)
  }
}

const labels = requireJson(".github/labels.json")
if (!Array.isArray(labels)) {
  failures.push(".github/labels.json must be an array")
} else {
  const names = labels.map((label) => label?.name)
  if (JSON.stringify(names) !== JSON.stringify(exactLabels)) {
    failures.push(`.github/labels.json must contain exactly, in order: ${exactLabels.join(", ")}`)
  }
  for (const label of labels) {
    if (!/^[0-9a-f]{6}$/i.test(label?.color ?? "")) {
      failures.push(`${String(label?.name)} has an invalid color`)
    }
    if (typeof label?.description !== "string" || label.description.length === 0) {
      failures.push(`${String(label?.name)} has no description`)
    }
  }
}

const historySchemaPath =
  process.env.MCP_SLA_HISTORY_SCHEMA_PATH ?? path.join(root, "docs/maintenance/sla-all-history.schema.json")
const historyPath = process.env.MCP_SLA_HISTORY_PATH ?? path.join(root, "docs/maintenance/sla-all-history.json")
const scorecardSchemaPath =
  process.env.MCP_SLA_SCHEMA_PATH ?? path.join(root, "docs/maintenance/sla-ledger.schema.json")
const scorecardPath = process.env.MCP_SLA_LEDGER_PATH ?? path.join(root, "docs/maintenance/sla-ledger.json")
const historySchema = requireJsonPath(historySchemaPath, displayPath(historySchemaPath))
const history = requireJsonPath(historyPath, displayPath(historyPath))
const scorecardSchema = requireJsonPath(scorecardSchemaPath, displayPath(scorecardSchemaPath))
const scorecard = requireJsonPath(scorecardPath, displayPath(scorecardPath))

validateSchemaDeclaration("all-history schema", historySchema)
validateSchemaDeclaration("rolling scorecard schema", scorecardSchema)
if (historySchema && history) {
  validateAgainstSchema("all-history ledger", historySchema, history, validateHistorySemantics)
}
if (scorecardSchema && scorecard) {
  validateAgainstSchema("rolling scorecard", scorecardSchema, scorecard, () => {})
}
if (history && scorecard) validateDerivedScorecard(history, scorecard)

const generator = requireText("scripts/generate-tier-maintenance.mjs")
requireAll("maintenance generator", generator, [
  "/timeline?per_page=100",
  '"labeled", "closed", "reopened"',
  "mergeImmutableHistory",
  "deriveMaintenanceScorecard",
  "triageComplianceThreshold",
  "sla-all-history.json",
  "official-tier-maintenance-audit"
])

const tierAudit = requireText(".github/workflows/tier-audit.yml")
requireAll("tier audit workflow", tierAudit, [
  "schedule:",
  "workflow_dispatch:",
  "issues: read",
  "conformance tier-check",
  "--days 90",
  "--write-ledger",
  ".local/tier-audit/sla-all-history.json",
  ".local/tier-audit/sla-ledger.json",
  "--spec-version 2026-07-28",
  '--client-cmd "node dist/examples/everything-client.js"'
])
const labelWorkflow = requireText(".github/workflows/labels.yml")
requireAll("label workflow", labelWorkflow, ["issues: write", "sync-github-labels.mjs --apply"])
const labelSync = requireText("scripts/sync-github-labels.mjs")
requireAll("label sync", labelSync, [
  "indexGitHubLabels",
  "normalizeGitHubLabelName(label.name)",
  "encodeURIComponent(existing.name)",
  "desiredNames.has(normalizeGitHubLabelName(label.name))"
])

const runCheckTierOperations = Effect.gen(function* () {
  if (failures.length > 0) {
    console.error("Tier operations check failed:")
    for (const failure of failures) console.error(`- ${failure}`)
    yield* Effect.fail(new Error("Tier operations check failed."))
  }

  console.log(
    "Tier operations check passed with exact labels, append-only timeline facts, and a derived rolling scorecard."
  )
  console.log(
    `Committed Tier score: triage ${Math.round(scorecard.triage.complianceRate * 100)}%, ` +
      `P0 ${scorecard.p0Resolution.met}/${scorecard.p0Resolution.total}; ` +
      `${scorecard.passed ? "passing" : "not yet passing"}.`
  )
})

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  NodeRuntime.runMain(runScript("check-tier-operations", runCheckTierOperations))
}

function validateSchemaDeclaration(name, schema) {
  if (schema?.$schema !== "https://json-schema.org/draft/2020-12/schema") {
    failures.push(`${name} must declare JSON Schema 2020-12`)
  }
}

function validateAgainstSchema(name, schema, value, semanticCheck) {
  try {
    const ajv = new Ajv2020({ allErrors: true, strict: true })
    addFormats(ajv)
    const validate = ajv.compile(schema)
    if (!validate(value)) {
      for (const error of validate.errors ?? []) {
        failures.push(`${name} schema: ${error.instancePath || "/"} ${error.message}`)
      }
      return
    }
    semanticCheck(value)
  } catch (error) {
    failures.push(`Unable to compile ${name} schema: ${error instanceof Error ? error.message : String(error)}`)
  }
}

function validateHistorySemantics(value) {
  const issueNumbers = new Set()
  const eventIds = new Set()
  const issueByNumber = new Map()
  let lastIssueKey = ""
  for (const [index, issue] of value.issues.entries()) {
    if (issueNumbers.has(issue.number)) {
      failures.push(`issues[${index}] duplicates issue #${issue.number}`)
    }
    issueNumbers.add(issue.number)
    issueByNumber.set(issue.number, issue)
    const key = `${issue.createdAt}:${String(issue.number).padStart(12, "0")}`
    if (key < lastIssueKey) failures.push("all-history issues are not in stable order")
    lastIssueKey = key
    if (Date.parse(issue.createdAt) > Date.parse(value.collectedAt)) {
      failures.push(`issue #${issue.number} is newer than collectedAt`)
    }
  }

  let lastEventKey = ""
  for (const [index, event] of value.events.entries()) {
    if (eventIds.has(event.id)) {
      failures.push(`events[${index}] duplicates timeline event ${event.id}`)
    }
    eventIds.add(event.id)
    const issue = issueByNumber.get(event.issue)
    if (issue === undefined) {
      failures.push(`events[${index}] references missing issue #${event.issue}`)
      continue
    }
    if (Date.parse(event.eventAt) < Date.parse(issue.createdAt)) {
      failures.push(`events[${index}] predates issue #${event.issue}`)
    }
    if (Date.parse(event.eventAt) > Date.parse(value.collectedAt)) {
      failures.push(`events[${index}] is newer than collectedAt`)
    }
    const key = `${event.eventAt}:${event.id}`
    if (key < lastEventKey) failures.push("all-history events are not in stable order")
    lastEventKey = key
  }
}

function validateDerivedScorecard(historyValue, scorecardValue) {
  if (
    scorecardValue.policyEffectiveDate !== historyValue.policyEffectiveDate ||
    JSON.stringify(scorecardValue.authority) !== JSON.stringify(historyValue.authority)
  ) {
    failures.push("rolling scorecard authority differs from the all-history ledger")
  }
  if (Date.parse(scorecardValue.collectedAt) < Date.parse(historyValue.collectedAt)) {
    failures.push("rolling scorecard predates its all-history source")
  }

  let expected
  try {
    expected = deriveMaintenanceScorecard({
      history: historyValue,
      collectedAt: scorecardValue.collectedAt,
      windowDays: scorecardValue.window.days,
      triageBusinessDays: scorecardValue.thresholds.triageBusinessDays,
      p0ResolutionCalendarDays: scorecardValue.thresholds.p0ResolutionCalendarDays,
      triageComplianceThreshold: scorecardValue.thresholds.triageComplianceRate,
      relegationMonths: 2
    })
  } catch (error) {
    failures.push(`Unable to derive rolling scorecard: ${error instanceof Error ? error.message : String(error)}`)
    return
  }
  const actual = {
    window: scorecardValue.window,
    entries: scorecardValue.entries,
    triage: scorecardValue.triage,
    p0Resolution: scorecardValue.p0Resolution,
    passed: scorecardValue.passed,
    relegationHorizon: scorecardValue.relegationHorizon
  }
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    failures.push("rolling scorecard is not the exact derivation of the append-only all-history ledger")
  }
}

function requireText(relativePath) {
  const absolute = path.join(root, relativePath)
  if (!existsSync(absolute)) {
    failures.push(`Missing ${relativePath}`)
    return ""
  }
  return readFileSync(absolute, "utf8")
}

function requireJson(relativePath) {
  const source = requireText(relativePath)
  if (!source) return undefined
  try {
    return JSON.parse(source)
  } catch (error) {
    failures.push(`${relativePath} is invalid JSON: ${error instanceof Error ? error.message : String(error)}`)
    return undefined
  }
}

function requireJsonPath(absolutePath, label) {
  if (!existsSync(absolutePath)) {
    failures.push(`Missing ${label}`)
    return undefined
  }
  try {
    return JSON.parse(readFileSync(absolutePath, "utf8"))
  } catch (error) {
    failures.push(`${label} is invalid JSON: ${error instanceof Error ? error.message : String(error)}`)
    return undefined
  }
}

function displayPath(absolutePath) {
  const relative = path.relative(root, absolutePath)
  return relative.startsWith("..") ? absolutePath : relative
}

function requireAll(name, source, needles) {
  const flattened = source.replace(/\s+/g, " ")
  for (const needle of needles) {
    if (!flattened.includes(needle.replace(/\s+/g, " "))) {
      failures.push(`${name} missing required text: ${needle}`)
    }
  }
}
