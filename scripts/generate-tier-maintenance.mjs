// Projects real issue history into the SLA ledger and the GR-TIER-002 artifact.
//
// SEP-1730 requires Tier 1 SDKs to acknowledge and triage issues within two
// business days and resolve security or critical bugs within seven days. Those
// are elapsed-time commitments: no amount of engineering shortens them, and the
// only honest way to evidence them is to accumulate real incidents.
//
// So this script never invents entries. It reads GitHub, projects whatever
// genuinely qualifies into docs/maintenance/sla-ledger.json, and writes the
// readiness artifact only when there is something real to attest. With no
// qualifying history it says so and writes nothing, leaving GR-TIER-002 as
// `unknown` — "no evidence yet", which is true — rather than `fail`, which would
// claim we measured and missed.
//
// It also computes two things the per-incident ledger does not: the "github
// stats on issues" figure SEP-1730 actually validates a tier application
// against, and the horizon for its two-month relegation rule. Both are written
// into the ledger so `check:tier-relegation` can read them offline.
//
// Usage: node scripts/generate-tier-maintenance.mjs [--write-ledger]
import { execFileSync } from "node:child_process"
import prettier from "prettier"
import { writeFileSync } from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"

import { createChecker } from "./lib/check.mjs"
import {
  COVERED_HOLIDAY_YEARS,
  addBusinessDays,
  chicagoDayKey,
  classifyOutcome,
  policyEffectiveInstant
} from "./lib/sla.mjs"
import { writeTestEvidenceReport } from "./readiness-evidence.mjs"

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")
const checker = createChecker({ root, name: "Tier maintenance generation" })
const writeLedger = process.argv.includes("--write-ledger")

const TRIAGE_BUSINESS_DAYS = 2
const RESOLUTION_DAYS = 7

// The thresholds above are transcribed from the vendored SEP. Assert the
// vendored text still says so, rather than trusting a comment: if upstream
// changes the commitment, this fails instead of silently measuring the old one.
const sep = checker.requireText("sources/vendor/sep-1730/1730-sdks-tiering-system.md")
checker.requireAll("SEP-1730", sep, [
  "Acknowledge and triage issues within two business days",
  "Resolve security and critical bugs within seven days",
  // The relegation rule the horizon below encodes.
  "Issues are not addressed within two months"
])

// Same override convention as check-tier-operations.mjs, so the machinery can
// be exercised against a fixture ledger without touching committed evidence.
const ledgerPath = process.env.MCP_SLA_LEDGER_PATH ?? "docs/maintenance/sla-ledger.json"
const ledger = checker.requireJson(ledgerPath)
if (ledger === undefined) checker.report("unreachable")
const effectiveDate = new Date(policyEffectiveInstant(ledger.policyEffectiveDate))

const SECURITY_LABELS = new Set(["security", "p0", "critical", "incident"])

const issues = JSON.parse(
  execFileSync(
    "gh",
    [
      "issue",
      "list",
      "--state",
      "all",
      "--limit",
      "500",
      "--json",
      "number,title,url,createdAt,closedAt,state,labels,assignees,comments,author"
    ],
    { cwd: root, encoding: "utf8" }
  )
)

// SEP-1730 validates a tier application against "github stats on issues", and
// its worked example scores SDKs by a days-to-response figure (5 days → Tier 1,
// 10 → Tier 2, 100 → Tier 3). That is a different measure from the per-incident
// ledger below, and it is the one upstream actually applies — so compute it
// over the whole issue history, independent of the policy window.
//
// "Addressed" is deliberately generous: a label, an assignee, a non-author
// comment, or a close all count. The point is to measure whether anyone
// responded, not to grade the quality of the response.
const RELEGATION_MONTHS = 2

const firstResponseAt = (issue) => {
  const candidates = []
  if (issue.closedAt) candidates.push(new Date(issue.closedAt))
  for (const comment of issue.comments ?? []) {
    if (comment.author?.login && comment.author.login !== issue.author?.login) {
      candidates.push(new Date(comment.createdAt))
    }
  }
  // Labels and assignees carry no timestamp in this projection, so they can only
  // establish *that* a response happened, not when. Treat them as "addressed"
  // without contributing a response time.
  return candidates.length === 0 ? undefined : new Date(Math.min(...candidates.map((date) => date.getTime())))
}

const isAddressed = (issue) =>
  (issue.labels ?? []).length > 0 || (issue.assignees ?? []).length > 0 || firstResponseAt(issue) !== undefined

const daysBetween = (from, to) => (to.getTime() - from.getTime()) / 86400000

const now = new Date()
const supportStatsSamples = issues.map((issue) => {
  const opened = new Date(issue.createdAt)
  const responded = firstResponseAt(issue)
  return {
    issue: issue.number,
    url: issue.url,
    openedAt: issue.createdAt,
    addressed: isAddressed(issue),
    // An unanswered issue is not missing data — its response time is "at least
    // this long, and still counting". Excluding it would flatter the median.
    responseDays: responded === undefined ? daysBetween(opened, now) : daysBetween(opened, responded),
    responded: responded !== undefined
  }
})

const median = (values) => {
  if (values.length === 0) return null
  const sorted = [...values].sort((a, b) => a - b)
  const middle = Math.floor(sorted.length / 2)
  return sorted.length % 2 === 0 ? (sorted[middle - 1] + sorted[middle]) / 2 : sorted[middle]
}

const responseDays = supportStatsSamples.map((sample) => sample.responseDays)
const supportStats = {
  measure: "days from issue open to first maintainer response (label, assignee, non-author comment, or close)",
  source: "sources/vendor/sep-1730/1730-sdks-tiering-system.md",
  collectedAt: new Date().toISOString(),
  issues: supportStatsSamples.length,
  addressed: supportStatsSamples.filter((sample) => sample.addressed).length,
  unaddressed: supportStatsSamples.filter((sample) => !sample.addressed).length,
  medianResponseDays: median(responseDays) === null ? null : Number(median(responseDays).toFixed(1)),
  maxResponseDays: responseDays.length === 0 ? null : Number(Math.max(...responseDays).toFixed(1)),
  stillOpenAndUnaddressed: supportStatsSamples.filter((sample) => !sample.addressed).map((sample) => sample.issue)
}

// SEP-1730 relegation: "Issues are not addressed within two months." Recorded
// into the committed ledger so an offline gate can surface the cliff without
// needing network access on every verify.
const relegationHorizon = issues
  .filter((issue) => !isAddressed(issue))
  .map((issue) => {
    const opened = new Date(issue.createdAt)
    const deadline = new Date(opened)
    deadline.setUTCMonth(deadline.getUTCMonth() + RELEGATION_MONTHS)
    return {
      issue: issue.number,
      url: issue.url,
      openedAt: issue.createdAt,
      relegationAt: deadline.toISOString(),
      daysRemaining: Math.ceil(daysBetween(now, deadline))
    }
  })
  .sort((left, right) => left.daysRemaining - right.daysRemaining)

// The policy is not retroactive: an issue opened before the effective date was
// never covered by it, and counting it either way would be dishonest.
const qualifying = issues.filter((issue) => new Date(issue.createdAt) >= effectiveDate)

// A deadline computed against a year whose holidays are not enumerated would
// silently treat those holidays as business days. Fail loudly instead.
for (const issue of qualifying) {
  const year = chicagoDayKey(new Date(issue.createdAt)).slice(0, 4)
  if (!COVERED_HOLIDAY_YEARS.has(year)) {
    checker.fail(`Issue #${issue.number} opened in ${year}; add that year's federal holidays before attesting.`)
  }
}

const collectedAt = new Date().toISOString()
const entries = qualifying.map((issue) => {
  const labels = new Set((issue.labels ?? []).map((label) => label.name.toLowerCase()))
  const isSecurity = [...labels].some((label) => SECURITY_LABELS.has(label))
  const openedAt = new Date(issue.createdAt)
  const eventType = isSecurity ? "security-resolution" : "issue-triage"
  const deadlineAt = isSecurity
    ? new Date(openedAt.getTime() + RESOLUTION_DAYS * 86400000)
    : addBusinessDays(openedAt, TRIAGE_BUSINESS_DAYS)
  const closedAt = issue.closedAt ? new Date(issue.closedAt) : undefined
  const { met, closedLate, openPastDeadline, overdue } = classifyOutcome({ closedAt, deadlineAt, now: new Date() })

  return {
    id: `issue-${issue.number}-${eventType}`,
    eventType,
    issueOrEvent: { id: String(issue.number), url: issue.url },
    openedAt: openedAt.toISOString(),
    deadlineAt: deadlineAt.toISOString(),
    observedAt: collectedAt,
    response: {
      status: issue.state.toLowerCase(),
      observedAt: closedAt ? closedAt.toISOString() : null,
      url: issue.url
    },
    collection: {
      command: "node scripts/generate-tier-maintenance.mjs",
      collectedAt
    },
    outcome: {
      status: met ? "met" : overdue ? "missed" : "pending",
      exitCode: 0,
      details: met
        ? `Closed ${closedAt.toISOString()} within the ${eventType} deadline.`
        : closedLate
          ? `Closed ${closedAt.toISOString()}, after the ${eventType} deadline ${deadlineAt.toISOString()}.`
          : openPastDeadline
            ? `Still open past the ${eventType} deadline ${deadlineAt.toISOString()}.`
            : `Open and within the ${eventType} deadline ${deadlineAt.toISOString()}.`
    },
    requirementIds: ["GR-TIER-002"]
  }
})

const settled = entries.filter((entry) => entry.outcome.status !== "pending")
const missed = settled.filter((entry) => entry.outcome.status === "missed")

console.log(`Issues total: ${issues.length}`)
console.log(`Policy effective ${ledger.policyEffectiveDate}; covered by policy: ${qualifying.length}`)
console.log(`Settled: ${settled.length} (met ${settled.length - missed.length}, missed ${missed.length})`)
console.log("")
console.log("GitHub support stats (the measure SEP-1730 validates against):")
console.log(
  `  issues ${supportStats.issues}, addressed ${supportStats.addressed}, unaddressed ${supportStats.unaddressed}`
)
console.log(`  median response ${supportStats.medianResponseDays} days, max ${supportStats.maxResponseDays} days`)
if (relegationHorizon.length > 0) {
  const soonest = relegationHorizon[0]
  console.log("")
  console.log(`Relegation horizon: ${relegationHorizon.length} unaddressed issue(s).`)
  console.log(
    `  Soonest: #${soonest.issue} relegates ${soonest.relegationAt.slice(0, 10)} (${soonest.daysRemaining} days).`
  )
}

if (writeLedger) {
  const updated = { ...ledger, entries, supportStats, relegationHorizon }
  // The ledger stays human-maintainable — MAINTENANCE.md documents adding
  // private-advisory entries by hand — so it is Prettier-checked like any other
  // committed file. Format the generated output the same way rather than
  // exempting it, otherwise every regeneration would leave `lint` failing.
  const absoluteLedgerPath = path.join(root, ledgerPath)
  const formatted = await prettier.format(`${JSON.stringify(updated, null, 2)}\n`, {
    ...(await prettier.resolveConfig(absoluteLedgerPath)),
    filepath: absoluteLedgerPath
  })
  writeFileSync(absoluteLedgerPath, formatted)
  console.log(`Wrote ${entries.length} ledger entr${entries.length === 1 ? "y" : "ies"}.`)
}

if (settled.length === 0) {
  console.log("")
  console.log("No settled maintenance events since the policy effective date.")
  console.log("GR-TIER-002 stays `unknown`: there is no evidence yet, which is not the same as failing.")
  console.log("Re-run this once real issues have been triaged and resolved under the policy.")
  checker.report("Tier maintenance generation completed with no evidence to attest.")
  process.exit(0)
}

const evidencePath = writeTestEvidenceReport({
  name: "tier-maintenance",
  evidenceKind: "release-provenance",
  command: "node scripts/generate-tier-maintenance.mjs",
  exitCode: missed.length === 0 ? 0 : 1,
  requirementIds: ["GR-TIER-002"],
  suite: "tier-maintenance",
  summary: {
    policyEffectiveDate: ledger.policyEffectiveDate,
    source: "sources/vendor/sep-1730/1730-sdks-tiering-system.md",
    triageBusinessDays: TRIAGE_BUSINESS_DAYS,
    resolutionDays: RESOLUTION_DAYS,
    covered: qualifying.length,
    settled: settled.length,
    met: settled.length - missed.length,
    missed: missed.length,
    pending: entries.length - settled.length,
    supportStats,
    relegationHorizon
  },
  cases: settled.map((entry) => ({
    id: entry.id,
    case: entry.eventType,
    description: entry.outcome.details,
    command: entry.collection.command,
    exitCode: entry.outcome.status === "met" ? 0 : 1,
    status: entry.outcome.status === "met" ? "pass" : "fail"
  }))
})

console.log(`Writing readiness evidence to ${evidencePath}`)
checker.report("Tier maintenance generation completed.")
