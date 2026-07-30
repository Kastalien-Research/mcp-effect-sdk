import assert from "node:assert/strict"
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import os from "node:os"
import path from "node:path"
import { spawnSync } from "node:child_process"
import test from "node:test"
import { fileURLToPath } from "node:url"

import { githubLabelNameSet, indexGitHubLabels, normalizeGitHubLabelName } from "../../scripts/lib/github-labels.mjs"
import { deriveMaintenanceScorecard, mergeImmutableHistory } from "../../scripts/lib/sla.mjs"

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..")
const checker = path.join(root, "scripts/check-tier-operations.mjs")
const historySchemaSource = readFileSync(path.join(root, "docs/maintenance/sla-all-history.schema.json"), "utf8")
const scorecardSchemaSource = readFileSync(path.join(root, "docs/maintenance/sla-ledger.schema.json"), "utf8")

test("committed all-history and rolling Tier evidence are internally consistent", () => {
  const result = spawnSync(process.execPath, [checker], {
    cwd: root,
    encoding: "utf8"
  })
  assert.equal(result.status, 0, `${result.stdout ?? ""}${result.stderr ?? ""}`)
})

test("label synchronization treats GitHub label names case-insensitively", () => {
  const current = [{ name: "Bug", color: "ffffff" }]
  const desired = [{ name: "bug", color: "000000" }]

  assert.equal(normalizeGitHubLabelName("P0"), "p0")
  assert.equal(indexGitHubLabels(current).get("bug"), current[0])
  assert.equal(githubLabelNameSet(desired).has(normalizeGitHubLabelName(current[0].name)), true)
})

test("rejects malformed rolling scorecard JSON", () => {
  assertInvalid(validHistory(), "{")
})

test("rejects properties excluded by either ledger schema", () => {
  assertInvalid({ ...validHistory(), unexpected: true }, scorecardFor(validHistory()))
  const history = validHistory()
  assertInvalid(history, { ...scorecardFor(history), unexpected: true })
})

test("rejects malformed historical timeline events instead of silently dropping them", () => {
  const history = validHistory()
  delete history.events[0].issue
  delete history.events[0].kind
  assertInvalid(history, scorecardFor(validHistory()))
})

test("rejects scorecard values that are not re-derived from timeline facts", () => {
  const history = validHistory()
  const scorecard = scorecardFor(history)
  scorecard.triage.passed = !scorecard.triage.passed
  assertInvalid(history, scorecard)
})

test("triage starts at creation and uses the earliest label event", () => {
  const history = validHistory()
  history.events.push(
    {
      id: "9991",
      issue: 1,
      kind: "labeled",
      label: "ready for work",
      eventAt: "2026-07-02T12:00:00.000Z"
    },
    {
      id: "9990",
      issue: 1,
      kind: "labeled",
      label: "bug",
      eventAt: "2026-07-01T13:00:00.000Z"
    }
  )
  const derived = derive(history)
  const entry = derived.entries.find(
    (candidate) => candidate.issue.number === 1 && candidate.metric === "triage-first-label"
  )
  assert.equal(entry.startAt, "2026-07-01T12:00:00.000Z")
  assert.deepEqual(entry.observedEvent, {
    kind: "labeled",
    label: "bug",
    eventAt: "2026-07-01T13:00:00.000Z"
  })
})

test("P0 resolution starts at the first exact P0 label and ends at a later close", () => {
  const history = validHistory()
  history.events.push(
    {
      id: "9900",
      issue: 1,
      kind: "labeled",
      label: "priority:P0",
      eventAt: "2026-07-01T13:00:00.000Z"
    },
    {
      id: "9901",
      issue: 1,
      kind: "closed",
      eventAt: "2026-07-02T12:00:00.000Z"
    },
    {
      id: "9902",
      issue: 1,
      kind: "reopened",
      eventAt: "2026-07-02T13:00:00.000Z"
    },
    {
      id: "9903",
      issue: 1,
      kind: "labeled",
      label: "P0",
      eventAt: "2026-07-03T12:00:00.000Z"
    },
    {
      id: "9904",
      issue: 1,
      kind: "closed",
      eventAt: "2026-07-04T12:00:00.000Z"
    }
  )
  const entry = derive(history).entries.find((candidate) => candidate.metric === "p0-resolution")
  assert.equal(entry.startAt, "2026-07-03T12:00:00.000Z")
  assert.equal(entry.observedAt, "2026-07-04T12:00:00.000Z")
  assert.equal(entry.status, "met")
})

test("the official Tier 1 rolling triage threshold is at least 90 percent", () => {
  const history = validHistory()
  const atThreshold = derive(history)
  assert.equal(atThreshold.triage.met, 9)
  assert.equal(atThreshold.triage.total, 10)
  assert.equal(atThreshold.triage.complianceRate, 0.9)
  assert.equal(atThreshold.triage.passed, true)

  history.events = history.events.filter((event) => event.issue !== 9)
  const belowThreshold = derive(history)
  assert.equal(belowThreshold.triage.complianceRate, 0.8)
  assert.equal(belowThreshold.triage.passed, false)
})

test("history refresh admits new facts but rejects any rewrite or disappearance", () => {
  const previous = validHistory()
  const current = structuredClone(previous)
  current.issues.push({
    number: 11,
    url: "https://github.com/example/sdk/issues/11",
    createdAt: "2026-07-11T12:00:00.000Z"
  })
  current.events.push({
    id: "1011",
    issue: 11,
    kind: "labeled",
    label: "question",
    eventAt: "2026-07-11T12:30:00.000Z"
  })
  const merged = mergeImmutableHistory(previous, current)
  assert.equal(merged.issues.length, 11)
  assert.equal(merged.events.length, 10)

  const changed = structuredClone(current)
  changed.events[0].label = "enhancement"
  assert.throws(() => mergeImmutableHistory(previous, changed), /Previously recorded timeline event/)

  const disappeared = structuredClone(current)
  disappeared.events = disappeared.events.filter((event) => event.id !== previous.events[0].id)
  assert.throws(() => mergeImmutableHistory(previous, disappeared), /changed or disappeared/)
})

function assertInvalid(history, scorecard) {
  const result = runChecker(history, scorecard)
  assert.notEqual(result.status, 0, `expected invalid evidence to fail:\n${result.output}`)
}

function runChecker(history, scorecard) {
  const temporary = mkdtempSync(path.join(os.tmpdir(), "mcp-sla-ledger-"))
  const historySchemaPath = path.join(temporary, "history-schema.json")
  const historyPath = path.join(temporary, "history.json")
  const scorecardSchemaPath = path.join(temporary, "scorecard-schema.json")
  const scorecardPath = path.join(temporary, "scorecard.json")
  writeFileSync(historySchemaPath, historySchemaSource)
  writeFileSync(historyPath, typeof history === "string" ? history : `${JSON.stringify(history, null, 2)}\n`)
  writeFileSync(scorecardSchemaPath, scorecardSchemaSource)
  writeFileSync(scorecardPath, typeof scorecard === "string" ? scorecard : `${JSON.stringify(scorecard, null, 2)}\n`)
  const result = spawnSync(process.execPath, [checker], {
    cwd: root,
    encoding: "utf8",
    env: {
      ...process.env,
      MCP_SLA_HISTORY_SCHEMA_PATH: historySchemaPath,
      MCP_SLA_HISTORY_PATH: historyPath,
      MCP_SLA_SCHEMA_PATH: scorecardSchemaPath,
      MCP_SLA_LEDGER_PATH: scorecardPath
    }
  })
  rmSync(temporary, { recursive: true, force: true })
  return {
    status: result.status,
    output: `${result.stdout ?? ""}${result.stderr ?? ""}`
  }
}

function validHistory() {
  const issues = Array.from({ length: 10 }, (_, index) => {
    const number = index + 1
    return {
      number,
      url: `https://github.com/example/sdk/issues/${number}`,
      createdAt: `2026-07-${String(number).padStart(2, "0")}T12:00:00.000Z`
    }
  })
  const events = issues.slice(0, 9).map((issue, index) => ({
    id: String(1000 + index),
    issue: issue.number,
    kind: "labeled",
    label: index % 2 === 0 ? "bug" : "enhancement",
    eventAt: new Date(Date.parse(issue.createdAt) + 3600000).toISOString()
  }))
  return {
    $schema: "./sla-all-history.schema.json",
    schemaVersion: 1,
    policyEffectiveDate: "2026-06-23",
    collectedAt: "2026-07-20T12:00:00.000Z",
    authority: {
      tierPolicy: "https://modelcontextprotocol.io/community/sdk-tiers",
      tierAudit: "https://github.com/modelcontextprotocol/conformance/tree/main/.claude/skills/mcp-sdk-tier-audit",
      repository: "example/sdk"
    },
    issues,
    events
  }
}

function derive(history) {
  return deriveMaintenanceScorecard({
    history,
    collectedAt: "2026-07-20T12:00:00.000Z",
    windowDays: 90,
    triageBusinessDays: 2,
    p0ResolutionCalendarDays: 7,
    triageComplianceThreshold: 0.9,
    relegationMonths: 2
  })
}

function scorecardFor(history) {
  return {
    $schema: "./sla-ledger.schema.json",
    schemaVersion: 2,
    policyEffectiveDate: history.policyEffectiveDate,
    collectedAt: "2026-07-20T12:00:00.000Z",
    authority: history.authority,
    sourceLedger: "./sla-all-history.json",
    thresholds: {
      triageBusinessDays: 2,
      triageComplianceRate: 0.9,
      p0ResolutionCalendarDays: 7,
      timeZone: "America/Chicago"
    },
    ...derive(history)
  }
}
