// Surfaces SEP-1730's relegation rule as an offline gate.
//
// "Tier Relegation Process ... Issues: Issues are not addressed within two
// months." That is the rule that takes a Tier away, and nothing in this
// repository modelled it: the readiness checker measures whether commitments are
// *evidenced*, not whether a deadline is approaching.
//
// This reads `relegationHorizon` out of the committed ledger, so it needs no
// network access and runs on every `verify`. `pnpm run generate:tier-maintenance
// --write-ledger` refreshes that data from GitHub.
//
// The staleness check matters as much as the deadline check: a ledger that
// stopped being refreshed would silently report an old, comfortable horizon.
import path from "node:path"
import { fileURLToPath } from "node:url"

import { createChecker } from "./lib/check.mjs"

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")
const checker = createChecker({ root, name: "Tier relegation check" })

// Warn well before the cliff. Two months is the rule; a fortnight is enough
// notice to actually triage a backlog.
const WARN_WITHIN_DAYS = 21
// A horizon computed long ago says nothing about today.
const MAX_LEDGER_AGE_DAYS = 45

const ledgerPath = process.env.MCP_SLA_LEDGER_PATH ?? "docs/maintenance/sla-ledger.json"
const ledger = checker.requireJson(ledgerPath)

if (ledger !== undefined) {
  const sep = checker.requireText("sources/vendor/sep-1730/1730-sdks-tiering-system.md")
  checker.requireAll("SEP-1730", sep, ["Issues are not addressed within two months"])

  const horizon = ledger.relegationHorizon
  if (!Array.isArray(horizon)) {
    checker.fail(
      `${ledgerPath} has no relegationHorizon. Run \`pnpm run generate:tier-maintenance --write-ledger\` to record it.`
    )
  } else {
    const collectedAt = ledger.supportStats?.collectedAt
    if (typeof collectedAt !== "string") {
      checker.fail(`${ledgerPath} has no supportStats.collectedAt, so the horizon cannot be dated.`)
    } else {
      const ageDays = (Date.now() - Date.parse(collectedAt)) / 86400000
      if (ageDays > MAX_LEDGER_AGE_DAYS) {
        checker.fail(
          `${ledgerPath} was collected ${Math.floor(ageDays)} days ago (limit ${MAX_LEDGER_AGE_DAYS}). ` +
            "Refresh it with `pnpm run generate:tier-maintenance --write-ledger`; a stale horizon reports a deadline that has already moved."
        )
      }
    }

    const now = Date.now()
    const relegated = []
    const imminent = []
    for (const entry of horizon) {
      const remaining = (Date.parse(entry.relegationAt) - now) / 86400000
      if (remaining <= 0) relegated.push({ ...entry, remaining })
      else if (remaining <= WARN_WITHIN_DAYS) imminent.push({ ...entry, remaining })
    }

    for (const entry of relegated) {
      checker.fail(
        `Issue #${entry.issue} has been unaddressed past two months (${entry.relegationAt.slice(0, 10)}). ` +
          `SEP-1730 relegates a Tier 1 SDK on this condition: ${entry.url}`
      )
    }

    if (relegated.length === 0 && imminent.length > 0) {
      // Not a failure — there is still time — but it must be visible, because
      // the whole point is that the deadline should not arrive unannounced.
      console.log(`Tier relegation warning: ${imminent.length} issue(s) approach the two-month rule.`)
      for (const entry of imminent) {
        console.log(
          `- #${entry.issue} relegates ${entry.relegationAt.slice(0, 10)} (${Math.ceil(entry.remaining)} days): ${entry.url}`
        )
      }
      console.log("Applying a label, an assignee, or a comment clears an issue from this horizon.")
    }

    if (horizon.length > 0 && relegated.length === 0 && imminent.length === 0) {
      console.log(
        `Tier relegation horizon: ${horizon.length} unaddressed issue(s), none within ${WARN_WITHIN_DAYS} days.`
      )
    }
  }
}

checker.report("Tier relegation check passed.")
