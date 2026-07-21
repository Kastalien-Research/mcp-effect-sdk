import { existsSync, readFileSync } from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"
import Ajv2020 from "ajv/dist/2020.js"
import addFormats from "ajv-formats"

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

const schemaPath = process.env.MCP_SLA_SCHEMA_PATH ?? path.join(root, "docs/maintenance/sla-ledger.schema.json")
const ledgerPath = process.env.MCP_SLA_LEDGER_PATH ?? path.join(root, "docs/maintenance/sla-ledger.json")
const schema = requireJsonPath(schemaPath, displayPath(schemaPath))
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

const ledger = requireJsonPath(ledgerPath, displayPath(ledgerPath))
if (schema && ledger) {
  try {
    const ajv = new Ajv2020({ allErrors: true, strict: true })
    addFormats(ajv)
    const validate = ajv.compile(schema)
    if (!validate(ledger)) {
      for (const error of validate.errors ?? []) {
        failures.push(`SLA ledger schema: ${error.instancePath || "/"} ${error.message}`)
      }
    } else {
      enforceNonRetroactivity(ledger)
    }
  } catch (error) {
    failures.push(`Unable to compile SLA ledger schema: ${error instanceof Error ? error.message : String(error)}`)
  }
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

function enforceNonRetroactivity(ledger) {
  const effectiveAt = Date.parse(`${ledger.policyEffectiveDate}T00:00:00-05:00`)
  for (const [index, entry] of ledger.entries.entries()) {
    if (Date.parse(entry.openedAt) < effectiveAt) {
      failures.push(`SLA ledger non-retroactivity: entries[${index}].openedAt predates ${ledger.policyEffectiveDate} in America/Chicago`)
    }
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
  for (const needle of needles) {
    if (!source.includes(needle)) failures.push(`${name} missing required text: ${needle}`)
  }
}
