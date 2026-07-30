// Collects the exact GitHub timeline facts used by the released MCP SDK Tier
// audit. The all-history ledger is append-only; the rolling scorecard is
// re-derived from those facts on every run.
import { execFileSync } from "node:child_process"
import { readFileSync, writeFileSync } from "node:fs"
import path from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"

import prettier from "prettier"
import * as Effect from "effect/Effect"
import * as NodeRuntime from "@effect/platform-node/NodeRuntime"

import { COVERED_HOLIDAY_YEARS, chicagoDayKey, deriveMaintenanceScorecard, mergeImmutableHistory } from "./lib/sla.mjs"
import { runScript } from "./lib/process.mjs"
import { writeTestEvidenceReport } from "./readiness-evidence.mjs"

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")

const runGenerateTierMaintenance = Effect.gen(function* () {
  const historyPath = process.env.MCP_SLA_HISTORY_PATH ?? "docs/maintenance/sla-all-history.json"
  const scorecardPath = process.env.MCP_SLA_LEDGER_PATH ?? "docs/maintenance/sla-ledger.json"
  const repository =
    process.env.MCP_TIER_GITHUB_REPOSITORY ?? process.env.GITHUB_REPOSITORY ?? "Kastalien-Research/mcp-effect-sdk"
  const writeLedgers = process.argv.includes("--write-ledger")
  const windowDays = numericArgument("--days", 90)
  const TRIAGE_BUSINESS_DAYS = 2
  const TRIAGE_COMPLIANCE_THRESHOLD = 0.9
  const P0_RESOLUTION_DAYS = 7
  const RELEGATION_MONTHS = 2
  const POLICY_URL = "https://modelcontextprotocol.io/community/sdk-tiers"
  const AUDIT_URL = "https://github.com/modelcontextprotocol/conformance/tree/main/.claude/skills/mcp-sdk-tier-audit"

  const previousHistory = JSON.parse(readFileSync(path.join(root, historyPath), "utf8"))
  const collectedAt = new Date().toISOString()
  const listedIssues = ghJson([
    "issue",
    "list",
    "--repo",
    repository,
    "--state",
    "all",
    "--limit",
    "500",
    "--json",
    "number,url,createdAt"
  ])

  const issues = listedIssues.map((issue) => ({
    number: issue.number,
    url: issue.url,
    createdAt: new Date(issue.createdAt).toISOString()
  }))
  const events = listedIssues.flatMap((issue) => {
    const pages = ghJson([
      "api",
      "--paginate",
      "--slurp",
      `repos/${repository}/issues/${issue.number}/timeline?per_page=100`,
      "-H",
      "Accept: application/vnd.github+json"
    ])
    return pages
      .flat()
      .filter((event) => ["labeled", "closed", "reopened"].includes(event.event))
      .map((event) => ({
        id: String(event.id),
        issue: issue.number,
        kind: event.event,
        ...(event.event === "labeled" ? { label: event.label?.name } : {}),
        eventAt: new Date(event.created_at).toISOString()
      }))
  })

  for (const issue of issues) {
    const year = chicagoDayKey(new Date(issue.createdAt)).slice(0, 4)
    if (!COVERED_HOLIDAY_YEARS.has(year)) {
      throw new Error(`Issue #${issue.number} opened in ${year}; add that year's federal holidays before attesting`)
    }
  }

  const history = mergeImmutableHistory(previousHistory, {
    $schema: "./sla-all-history.schema.json",
    schemaVersion: 1,
    policyEffectiveDate: previousHistory.policyEffectiveDate,
    collectedAt,
    authority: {
      tierPolicy: POLICY_URL,
      tierAudit: AUDIT_URL,
      repository
    },
    issues,
    events
  })
  const derived = deriveMaintenanceScorecard({
    history,
    collectedAt,
    windowDays,
    triageBusinessDays: TRIAGE_BUSINESS_DAYS,
    p0ResolutionCalendarDays: P0_RESOLUTION_DAYS,
    triageComplianceThreshold: TRIAGE_COMPLIANCE_THRESHOLD,
    relegationMonths: RELEGATION_MONTHS
  })
  const scorecard = {
    $schema: "./sla-ledger.schema.json",
    schemaVersion: 2,
    policyEffectiveDate: history.policyEffectiveDate,
    collectedAt,
    authority: history.authority,
    sourceLedger: "./sla-all-history.json",
    thresholds: {
      triageBusinessDays: TRIAGE_BUSINESS_DAYS,
      triageComplianceRate: TRIAGE_COMPLIANCE_THRESHOLD,
      p0ResolutionCalendarDays: P0_RESOLUTION_DAYS,
      timeZone: "America/Chicago"
    },
    ...derived
  }

  if (writeLedgers) {
    yield* Effect.promise(() => writeFormattedJson(historyPath, history))
    yield* Effect.promise(() => writeFormattedJson(scorecardPath, scorecard))
    console.log(
      `Wrote ${history.issues.length} issues and ${history.events.length} immutable timeline events to ${historyPath}.`
    )
    console.log(`Wrote the ${windowDays}-day official scorecard to ${scorecardPath}.`)
  }

  const evidencePath = writeTestEvidenceReport({
    name: "tier-maintenance",
    evidenceKind: "release-provenance",
    command: "node scripts/generate-tier-maintenance.mjs",
    exitCode: scorecard.passed ? 0 : 1,
    requirementIds: ["GR-TIER-002"],
    suite: "official-tier-maintenance-audit",
    summary: {
      collectedAt,
      policyEffectiveDate: history.policyEffectiveDate,
      authority: { tierPolicy: POLICY_URL, tierAudit: AUDIT_URL },
      scorecard,
      allHistory: {
        issueCount: history.issues.length,
        timelineEventCount: history.events.length
      }
    },
    cases: scorecard.entries.map((entry) => ({
      id: entry.id,
      case: entry.metric,
      description: entry.details,
      command: "node scripts/generate-tier-maintenance.mjs",
      exitCode: entry.status === "met" ? 0 : 1,
      status: entry.status === "met" ? "pass" : "fail"
    }))
  })

  console.log(
    `Rolling ${windowDays}-day triage: ${scorecard.triage.met}/${scorecard.triage.total} ` +
      `(${Math.round(scorecard.triage.complianceRate * 100)}%; threshold 90%).`
  )
  console.log(
    `P0 since policy: ${scorecard.p0Resolution.met}/${scorecard.p0Resolution.total} resolved within seven days.`
  )
  console.log(`Writing rolling official audit evidence to ${evidencePath}`)
  if (!scorecard.passed) {
    throw new Error("Tier maintenance scorecard failed the audit thresholds.")
  }
})

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  NodeRuntime.runMain(runScript("generate-tier-maintenance", runGenerateTierMaintenance))
}

function ghJson(args) {
  return JSON.parse(
    execFileSync("gh", args, {
      cwd: root,
      encoding: "utf8",
      env: process.env
    })
  )
}

async function writeFormattedJson(relativePath, value) {
  const absolute = path.join(root, relativePath)
  const formatted = await prettier.format(`${JSON.stringify(value, null, 2)}\n`, {
    ...(await prettier.resolveConfig(absolute)),
    filepath: absolute
  })
  writeFileSync(absolute, formatted)
}

function numericArgument(name, fallback) {
  const index = process.argv.indexOf(name)
  if (index === -1) return fallback
  const value = Number(process.argv[index + 1])
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error(`${name} must be a positive integer`)
  }
  return value
}
