import { existsSync, readFileSync } from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")
const failures = []
const policyEffectiveDate = "2026-07-17"

const security = requireText("SECURITY.md")
requireAll("SECURITY.md", security, [
  `Effective date: ${policyEffectiveDate}`,
  "seven calendar days",
  "GitHub Security Advisories",
  "not evidence of historical compliance"
])

const maintenance = requireText("MAINTENANCE.md")
requireAll("MAINTENANCE.md", maintenance, [
  `Effective date: ${policyEffectiveDate}`,
  "two business days",
  "seven calendar days",
  "priority:P0",
  "GR-TIER-002",
  "gh issue view",
  "No period before the effective date"
])

const escalation = requireText("docs/maintenance/p0-escalation.md")
requireAll("docs/maintenance/p0-escalation.md", escalation, [
  "priority:P0",
  "critical-incident.yml",
  "GitHub Security Advisory",
  "seven calendar days",
  "docs/maintenance/sla-ledger.json"
])

const reconciliation = requireText("docs/conformance/extension-reconciliation.md")
requireAll("docs/conformance/extension-reconciliation.md", reconciliation, [
  "-32021",
  "HTTP 400",
  "_meta",
  "resultType",
  "io.modelcontextprotocol/ui",
  "explicit profile",
  "server/discover",
  "never legacy core `initialize`",
  "ui/initialize",
  "ui/notifications/initialized"
])

for (const template of ["bug-report.yml", "critical-incident.yml", "feature-request.yml", "config.yml"]) {
  requireText(`.github/ISSUE_TEMPLATE/${template}`)
}
const criticalTemplate = requireText(".github/ISSUE_TEMPLATE/critical-incident.yml")
requireAll("critical incident template", criticalTemplate, [
  "priority:P0",
  "triage:unreviewed",
  "type:bug",
  "Do not disclose security vulnerabilities"
])

const labels = requireJson(".github/labels.json")
const requiredLabels = [
  "priority:P0",
  "priority:P1",
  "triage:unreviewed",
  "type:bug",
  "type:feature",
  "type:security",
  "status:accepted",
  "status:needs-reproduction"
]
if (labels) {
  if (!Array.isArray(labels)) {
    failures.push(".github/labels.json must be an array")
  } else {
    for (const name of requiredLabels) {
      const label = labels.find((candidate) => candidate?.name === name)
      if (!label) failures.push(`.github/labels.json missing ${name}`)
      else if (!/^[0-9a-f]{6}$/i.test(label.color ?? "")) failures.push(`${name} must have a six-digit color`)
    }
  }
}

const schema = requireJson("docs/maintenance/sla-ledger.schema.json")
if (schema) {
  if (schema.$schema !== "https://json-schema.org/draft/2020-12/schema") {
    failures.push("SLA schema must declare JSON Schema 2020-12")
  }
  for (const property of ["schemaVersion", "policyEffectiveDate", "entries"]) {
    if (!schema.required?.includes(property)) failures.push(`SLA schema must require ${property}`)
  }
  const entryRequired = schema.$defs?.entry?.required ?? []
  for (const property of [
    "id",
    "eventType",
    "issueOrEvent",
    "openedAt",
    "deadlineAt",
    "observedAt",
    "response",
    "collection",
    "outcome",
    "requirementIds"
  ]) {
    if (!entryRequired.includes(property)) failures.push(`SLA entry schema must require ${property}`)
  }
}

const ledger = requireJson("docs/maintenance/sla-ledger.json")
if (ledger) {
  for (const error of validateLedger(ledger)) failures.push(`SLA ledger: ${error}`)
}

const packageJson = requireJson("package.json")
if (packageJson?.scripts?.["check:tier-operations"] !== "node scripts/check-tier-operations.mjs") {
  failures.push("package.json must expose check:tier-operations")
}
const verify = requireText("scripts/verify.mjs")
if (!verify.includes("check:tier-operations")) failures.push("verify must run check:tier-operations")

const readiness = requireText("scripts/check-sdk-readiness-requirements.mjs")
requireAll("readiness registry", readiness, [
  "docs/maintenance/sla-ledger.json",
  "pnpm run check:tier-operations"
])

for (const publicPath of ["README.md", "ROADMAP.md", "docs/conformance/sdk-tier-evidence.md"]) {
  const source = requireText(publicPath)
  if (/Tier\s*1\s*(badge|ready|achieved|compliant)/i.test(source)) {
    failures.push(`${publicPath} must not claim Tier 1 designation or readiness`)
  }
}

if (failures.length > 0) {
  console.error("Tier operations check failed:")
  for (const failure of failures) console.error(`- ${failure}`)
  process.exit(1)
}

console.log("Tier operations check passed; maintenance evidence remains non-retroactive.")

function validateLedger(value) {
  const errors = []
  if (!isRecord(value)) return ["root must be an object"]
  if (value.schemaVersion !== 1) errors.push("schemaVersion must be 1")
  if (value.policyEffectiveDate !== policyEffectiveDate) errors.push(`policyEffectiveDate must be ${policyEffectiveDate}`)
  if (!Array.isArray(value.entries)) return [...errors, "entries must be an array"]
  for (const [index, entry] of value.entries.entries()) validateEntry(entry, index, errors)
  return errors
}

function validateEntry(entry, index, errors) {
  const at = `entries[${index}]`
  if (!isRecord(entry)) {
    errors.push(`${at} must be an object`)
    return
  }
  for (const field of ["id", "eventType", "openedAt", "deadlineAt", "observedAt"]) {
    if (!nonEmpty(entry[field])) errors.push(`${at}.${field} must be non-empty`)
  }
  for (const field of ["openedAt", "deadlineAt", "observedAt"]) {
    if (nonEmpty(entry[field]) && Number.isNaN(Date.parse(entry[field]))) errors.push(`${at}.${field} must be an ISO timestamp`)
  }
  if (!isRecord(entry.issueOrEvent) || !nonEmpty(entry.issueOrEvent.id) || !nonEmpty(entry.issueOrEvent.url)) {
    errors.push(`${at}.issueOrEvent must identify the event and URL`)
  }
  if (!isRecord(entry.response) || !nonEmpty(entry.response.status) || !(entry.response.observedAt === null || validDate(entry.response.observedAt))) {
    errors.push(`${at}.response must record status and observedAt (timestamp or null)`)
  }
  if (!isRecord(entry.collection) || !validDate(entry.collection.collectedAt)) {
    errors.push(`${at}.collection must record collectedAt`)
  } else if (!nonEmpty(entry.collection.command) && !nonEmpty(entry.collection.method)) {
    errors.push(`${at}.collection must contain an exact command or collection method`)
  }
  if (!isRecord(entry.outcome) || !["met", "missed", "pending", "excluded"].includes(entry.outcome.status) || !Number.isInteger(entry.outcome.exitCode)) {
    errors.push(`${at}.outcome must record status and integer exitCode`)
  }
  if (!Array.isArray(entry.requirementIds) || !entry.requirementIds.includes("GR-TIER-002")) {
    errors.push(`${at}.requirementIds must map GR-TIER-002`)
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

function requireAll(name, source, needles) {
  for (const needle of needles) {
    if (!source.includes(needle)) failures.push(`${name} missing required text: ${needle}`)
  }
}

function isRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function nonEmpty(value) {
  return typeof value === "string" && value.trim().length > 0
}

function validDate(value) {
  return nonEmpty(value) && !Number.isNaN(Date.parse(value))
}
