import assert from "node:assert/strict"
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import os from "node:os"
import path from "node:path"
import { spawnSync } from "node:child_process"
import test from "node:test"
import { fileURLToPath } from "node:url"

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..")
const checker = path.join(root, "scripts/check-tier-operations.mjs")
const schemaSource = readFileSync(path.join(root, "docs/maintenance/sla-ledger.schema.json"), "utf8")

test("rejects malformed ledger JSON", () => {
  assertInvalid("{")
})

test("rejects properties excluded by the ledger schema", () => {
  assertInvalid({ ...validLedger(), unexpected: true })
})

test("rejects invalid event URLs", () => {
  const ledger = validLedger()
  ledger.entries[0].issueOrEvent.url = "not a URI"
  assertInvalid(ledger)
})

test("rejects unknown event types", () => {
  const ledger = validLedger()
  ledger.entries[0].eventType = "other"
  assertInvalid(ledger)
})

test("rejects entries opened before the policy effective date", () => {
  const ledger = validLedger()
  ledger.entries[0].openedAt = "2026-07-16T23:59:59-05:00"
  assertInvalid(ledger)
})

test("rejects missing outcome details", () => {
  const ledger = validLedger()
  delete ledger.entries[0].outcome.details
  assertInvalid(ledger)
})

test("rejects malformed readiness requirement IDs", () => {
  const ledger = validLedger()
  ledger.entries[0].requirementIds.push("not-a-requirement")
  assertInvalid(ledger)
})

test("command collection requires an integer exit code", () => {
  const ledger = validLedger()
  ledger.entries[0].outcome.exitCode = null
  assertInvalid(ledger)
})

test("manual collection requires null exit code and explicit method status", () => {
  const withInteger = manualLedger()
  withInteger.entries[0].outcome.exitCode = 0
  assertInvalid(withInteger)

  const withoutStatus = manualLedger()
  delete withoutStatus.entries[0].collection.status
  assertInvalid(withoutStatus)
})

test("accepts schema-valid command and manual evidence", () => {
  assertValid(validLedger())
  assertValid(manualLedger())
})

function assertInvalid(ledger) {
  const result = runChecker(ledger)
  assert.notEqual(result.status, 0, `expected invalid ledger to fail:\n${result.output}`)
}

function assertValid(ledger) {
  const result = runChecker(ledger)
  assert.equal(result.status, 0, result.output)
}

function runChecker(ledger) {
  const temporary = mkdtempSync(path.join(os.tmpdir(), "mcp-sla-ledger-"))
  const schemaPath = path.join(temporary, "schema.json")
  const ledgerPath = path.join(temporary, "ledger.json")
  writeFileSync(schemaPath, schemaSource)
  writeFileSync(ledgerPath, typeof ledger === "string" ? ledger : `${JSON.stringify(ledger, null, 2)}\n`)
  const result = spawnSync(process.execPath, [checker], {
    cwd: root,
    encoding: "utf8",
    env: {
      ...process.env,
      MCP_SLA_SCHEMA_PATH: schemaPath,
      MCP_SLA_LEDGER_PATH: ledgerPath
    }
  })
  rmSync(temporary, { recursive: true, force: true })
  return { status: result.status, output: `${result.stdout ?? ""}${result.stderr ?? ""}` }
}

function validLedger() {
  return {
    $schema: "./sla-ledger.schema.json",
    schemaVersion: 1,
    policyEffectiveDate: "2026-07-17",
    entries: [{
      id: "issue-42-triage",
      eventType: "issue-triage",
      issueOrEvent: {
        id: "issue-42",
        url: "https://github.com/Kastalien-Research/mcp-effect-sdk/issues/42"
      },
      openedAt: "2026-07-17T09:00:00-05:00",
      deadlineAt: "2026-07-21T09:00:00-05:00",
      observedAt: "2026-07-17T10:00:00-05:00",
      response: {
        status: "triaged",
        observedAt: "2026-07-17T10:00:00-05:00",
        url: "https://github.com/Kastalien-Research/mcp-effect-sdk/issues/42#issuecomment-1"
      },
      collection: {
        command: "gh issue view 42 --repo Kastalien-Research/mcp-effect-sdk --json number,url,createdAt,updatedAt,closedAt,labels,author,comments",
        collectedAt: "2026-07-17T10:05:00-05:00"
      },
      outcome: {
        status: "met",
        exitCode: 0,
        details: "Triage response observed within the deadline."
      },
      requirementIds: ["GR-TIER-002"]
    }]
  }
}

function manualLedger() {
  const ledger = validLedger()
  ledger.entries[0] = {
    ...ledger.entries[0],
    id: "advisory-redacted-resolution",
    eventType: "security-resolution",
    issueOrEvent: {
      id: "GHSA-redacted",
      url: "https://github.com/Kastalien-Research/mcp-effect-sdk/security/advisories"
    },
    collection: {
      method: "Maintainer review of the private GitHub Security Advisory audit trail; public fields are redacted.",
      status: "complete",
      collectedAt: "2026-07-17T10:05:00-05:00"
    },
    outcome: {
      status: "met",
      exitCode: null,
      details: "Resolution timestamp was confirmed in the private advisory audit trail."
    }
  }
  return ledger
}
