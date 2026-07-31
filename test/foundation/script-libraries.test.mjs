import assert from "node:assert/strict"
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { test } from "node:test"
import * as Effect from "effect/Effect"
import * as Fiber from "effect/Fiber"

import { createChecker } from "../../scripts/lib/check.mjs"
import { buildEvidenceReport, schemaErrors, writeEvidence } from "../../scripts/lib/evidence.mjs"
import {
  canConnect,
  createOutputDir,
  findOpenPort,
  packageManagerPath,
  runCommand
} from "../../scripts/lib/process.mjs"
import { SCENARIOS } from "../../scripts/lib/agent-eval-scenarios.mjs"
import { withholdAnswerKeys } from "../../scripts/lib/mcp-agent-harness.mjs"
import { classifyOutcome } from "../../scripts/lib/sla.mjs"

const scratch = () => mkdtempSync(path.join(tmpdir(), "mcp-script-lib-"))

test("createOutputDir sanitizes a suite name before it reaches the filesystem", () => {
  const root = scratch()
  try {
    const runDir = createOutputDir("client/../escape", { root, envVar: "MCP_TEST_OUTPUT_DIR_UNSET" })
    // A slash would have created a nested directory the artifact collectors
    // never walk; the whole segment must stay one directory deep.
    assert.equal(path.dirname(path.dirname(runDir)), path.join(root, ".local"))
    assert.doesNotMatch(path.basename(runDir), /[/\\]/)
    assert.match(path.basename(runDir), /^client----escape-/)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test("createOutputDir honours its environment override relative to root", () => {
  const root = scratch()
  try {
    process.env.MCP_TEST_OUTPUT_DIR = "artifacts"
    const runDir = createOutputDir("suite", { root, envVar: "MCP_TEST_OUTPUT_DIR" })
    assert.equal(path.dirname(runDir), path.join(root, "artifacts"))
  } finally {
    delete process.env.MCP_TEST_OUTPUT_DIR
    rmSync(root, { recursive: true, force: true })
  }
})

test("packageManagerPath selects the Windows shim only on Windows", () => {
  assert.equal(packageManagerPath(), process.platform === "win32" ? "pnpm.cmd" : "pnpm")
})

test("findOpenPort returns a port that is genuinely free, and canConnect agrees", async () => {
  const port = await findOpenPort("127.0.0.1")
  assert.match(port, /^\d+$/)
  assert.equal(await canConnect("127.0.0.1", Number(port)), false)
})

test("runCommand resolves a process exit code", async () => {
  const status = await Effect.runPromise(runCommand(process.execPath, ["-e", "process.exit(7)"]))
  assert.equal(status, 7)
})

test("runCommand resolves a zero exit code rather than falling back to a truthy default", async () => {
  // `code ?? 1` guards against Node reporting a null exit code; a naive `code || 1`
  // would have miscoded a clean exit as a failure. Exercise both edges directly.
  assert.equal(await Effect.runPromise(runCommand(process.execPath, ["-e", "process.exit(0)"])), 0)
  assert.equal(await Effect.runPromise(runCommand(process.execPath, ["-e", "process.exit(3)"])), 3)
})

test("runCommand escalates cancellation when a child ignores SIGTERM", { timeout: 5_000 }, async () => {
  const root = scratch()
  const pidPath = path.join(root, "child.pid")
  let pid
  try {
    const childProgram = [
      'const { writeFileSync } = require("node:fs")',
      "writeFileSync(process.argv[1], String(process.pid))",
      'process.on("SIGTERM", () => {})',
      "setInterval(() => {}, 1_000)"
    ].join(";")
    const fiber = Effect.runFork(
      runCommand(process.execPath, ["-e", childProgram, pidPath], undefined, {
        forceKillAfterMs: 50
      })
    )

    for (let attempt = 0; attempt < 100 && pid === undefined; attempt += 1) {
      try {
        const candidate = Number(readFileSync(pidPath, "utf8"))
        if (Number.isSafeInteger(candidate) && candidate > 0) pid = candidate
      } catch (error) {
        if (error?.code !== "ENOENT") throw error
      }
      if (pid === undefined) await new Promise((resolve) => setTimeout(resolve, 10))
    }
    assert.equal(Number.isSafeInteger(pid) && pid > 0, true, "stubborn child pid was not written")

    await Effect.runPromise(Fiber.interrupt(fiber))
    await new Promise((resolve) => setTimeout(resolve, 150))
    assert.throws(() => process.kill(pid, 0), { code: "ESRCH" })
  } finally {
    if (Number.isInteger(pid)) {
      try {
        process.kill(pid, "SIGKILL")
      } catch {
        // The child already exited, which is the successful cleanup path.
      }
    }
    rmSync(root, { recursive: true, force: true })
  }
})

test("requireAll matches prose across re-wrapped lines", () => {
  const checker = createChecker({ root: scratch(), name: "fixture" })
  const wrapped = "This policy starts on its effective date. Its presence is not\nevidence of historical compliance."
  checker.requireAll("doc", wrapped, ["not evidence of historical compliance"])
  assert.deepEqual(checker.failures, [])
})

test("requireAll still reports genuinely absent text", () => {
  const checker = createChecker({ root: scratch(), name: "fixture" })
  checker.requireAll("doc", "unrelated prose", ["a required commitment"])
  assert.equal(checker.failures.length, 1)
  assert.match(checker.failures[0], /missing required text/)
})

test("requireText and requireJson accumulate rather than throw", () => {
  const root = scratch()
  try {
    writeFileSync(path.join(root, "broken.json"), "{")
    const checker = createChecker({ root, name: "fixture" })
    assert.equal(checker.requireText("absent.md"), "")
    assert.equal(checker.requireJson("broken.json"), undefined)
    assert.equal(checker.failures.length, 2)
    assert.match(checker.failures[0], /Missing absent\.md/)
    assert.match(checker.failures[1], /invalid JSON/)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test("buildEvidenceReport emits the envelope the readiness checker requires", () => {
  const report = buildEvidenceReport({
    evidenceKind: "agent-eval-result",
    command: "pnpm run eval:agent",
    exitCode: 0,
    requirementIds: ["GR-AGENT-001"],
    suite: "agent-salience",
    summary: { passed: 1 },
    scenarios: [{ id: "discover-and-choose" }]
  })
  for (const field of ["evidenceKind", "timestamp", "command", "exitCode", "requirementIds", "suite", "summary"]) {
    assert.ok(report[field] !== undefined, `envelope carries ${field}`)
  }
  assert.equal(report.scenarios.length, 1)
  assert.doesNotThrow(() => new Date(report.timestamp).toISOString())
})

test("buildEvidenceReport preserves a failing exit code rather than normalizing it", () => {
  // artifactResult fails the requirement on any non-zero exitCode, so a
  // generator must be able to record a real failure.
  const report = buildEvidenceReport({
    evidenceKind: "agent-eval-result",
    command: "c",
    exitCode: 1,
    requirementIds: ["GR-AGENT-001"],
    suite: "s",
    summary: {}
  })
  assert.equal(report.exitCode, 1)
})

test("writeEvidence refuses to emit an artifact that violates its schema", () => {
  const root = scratch()
  try {
    const schema = {
      $schema: "https://json-schema.org/draft/2020-12/schema",
      type: "object",
      required: ["evidenceKind", "passRate"],
      properties: { evidenceKind: { const: "agent-eval-result" }, passRate: { type: "number" } }
    }
    const targetPath = path.join(root, "evidence.json")
    assert.throws(
      () => writeEvidence({ targetPath, report: { evidenceKind: "agent-eval-result" }, schema }),
      /Refusing to write/
    )
    // A malformed artifact reads as `invalid`, which is worse than an absent
    // one reading as `unknown` — so nothing may be left behind.
    assert.equal(schemaErrors(schema, { evidenceKind: "agent-eval-result", passRate: 1 }).length, 0)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test("writeEvidence writes atomically and the bytes round-trip", () => {
  const root = scratch()
  try {
    const targetPath = path.join(root, "evidence.json")
    const report = buildEvidenceReport({
      evidenceKind: "agent-eval-result",
      command: "c",
      exitCode: 0,
      requirementIds: ["GR-AGENT-001"],
      suite: "s",
      summary: {},
      scenarios: [{ id: "one" }]
    })
    writeEvidence({ targetPath, report })
    assert.deepEqual(JSON.parse(readFileSync(targetPath, "utf8")), report)
    // Rewriting must not trip over its own staging file.
    writeEvidence({ targetPath, report })
    assert.deepEqual(JSON.parse(readFileSync(targetPath, "utf8")), report)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

// --- Agent eval scoring -------------------------------------------------
// The scoring functions decide what the GR-AGENT-* evidence claims, so they are
// tested offline against synthetic runs. No network, no API key.

const snapshotOf = (selected) => ({
  offered: [],
  selected: selected.map((entry, order) => ({ isError: false, input: {}, order, ...entry })),
  ignored: [],
  retried: [],
  failed: selected.filter((entry) => entry.isError),
  counts: { offered: 0, selected: selected.length, ignored: 0, retried: 0, failed: 0 }
})
const briefOf = (value) => ({ text: JSON.stringify(value) })
const scenario = (id) => SCENARIOS.find((candidate) => candidate.id === id)

test("ambiguity scoring rejects the vague tool even when the specific one was also called", () => {
  const brief = briefOf({ goal: "g", goodAffordance: "archive_paid_invoice", ambiguousAffordance: "process" })
  const both = scenario("ambiguous-affordance").score({
    snapshot: snapshotOf([
      { kind: "tool", name: "archive_paid_invoice" },
      { kind: "tool", name: "process" }
    ]),
    brief
  })
  assert.equal(both.passed, false, "calling the ambiguous tool as well is not a pass")

  const clean = scenario("ambiguous-affordance").score({
    snapshot: snapshotOf([{ kind: "tool", name: "archive_paid_invoice" }]),
    brief
  })
  assert.equal(clean.passed, true)
})

test("resource-first scoring requires the read to precede the call, not merely occur", () => {
  const brief = briefOf({
    policyVersion: "deploy-2026-05",
    requiredToolArgument: "policyVersion"
  })
  const after = scenario("resource-before-action").score({
    snapshot: snapshotOf([
      { kind: "tool", name: "approve_deployment_window", input: { policyVersion: "deploy-2026-05" } },
      { kind: "resource", name: "eval://resource-first/policy" }
    ]),
    brief
  })
  assert.equal(after.passed, false, "reading the policy after acting defeats the scenario")
  assert.match(after.reason, /without reading the policy/)

  const before = scenario("resource-before-action").score({
    snapshot: snapshotOf([
      { kind: "resource", name: "eval://resource-first/policy" },
      { kind: "tool", name: "approve_deployment_window", input: { policyVersion: "deploy-2026-05" } }
    ]),
    brief
  })
  assert.equal(before.passed, true)
})

test("resource-first scoring distinguishes never calling the tool from calling it wrongly", () => {
  const brief = briefOf({ policyVersion: "deploy-2026-05", requiredToolArgument: "policyVersion" })
  const never = scenario("resource-before-action").score({
    snapshot: snapshotOf([{ kind: "resource", name: "eval://resource-first/policy" }]),
    brief
  })
  assert.match(never.reason, /never called the tool/)

  const wrong = scenario("resource-before-action").score({
    snapshot: snapshotOf([
      { kind: "resource", name: "eval://resource-first/policy" },
      { kind: "tool", name: "approve_deployment_window", input: { policyVersion: "wrong" } }
    ]),
    brief
  })
  assert.equal(wrong.passed, false)
  assert.match(wrong.reason, /passed policyVersion=wrong/)
})

test("recovery scoring requires an actual failure, not just a correct final call", () => {
  const brief = briefOf({ expectedRetry: { ticketId: "TCK-42", responseTone: "calm" } })
  const noFailure = scenario("failure-recovery").score({
    snapshot: snapshotOf([
      { kind: "tool", name: "draft_support_reply", input: { ticketId: "TCK-42", responseTone: "calm" } }
    ]),
    brief
  })
  assert.equal(noFailure.passed, false, "the failure path must actually be exercised")

  const recovered = scenario("failure-recovery").score({
    snapshot: snapshotOf([
      { kind: "tool", name: "draft_support_reply", input: { ticketId: "42" }, isError: true },
      { kind: "tool", name: "draft_support_reply", input: { ticketId: "TCK-42", responseTone: "calm" } }
    ]),
    brief
  })
  assert.equal(recovered.passed, true)
})

test("observability scoring requires every one of the five affordance paths", () => {
  const brief = briefOf({ allowedKinds: ["offered", "selected", "ignored", "retried", "failed"] })
  const snapshot = snapshotOf([{ kind: "tool", name: "summarize_affordance_trace" }])
  const partial = scenario("affordance-observability").score({
    snapshot,
    brief,
    traceEvents: [{ kind: "offered" }, { kind: "selected" }]
  })
  assert.equal(partial.passed, false)
  assert.match(partial.reason, /Missing trace kinds: ignored, retried, failed/)

  const complete = scenario("affordance-observability").score({
    snapshot,
    brief,
    traceEvents: ["offered", "selected", "ignored", "retried", "failed"].map((kind) => ({ kind }))
  })
  assert.equal(complete.passed, true)
})

test("answer keys are withheld from the model but visible to the scorer", () => {
  const raw = JSON.stringify({ goal: "do the thing", goodAffordance: "the_right_tool", policyVersion: "v1" })
  const visible = JSON.parse(withholdAnswerKeys(raw))
  assert.equal(visible.goal, "do the thing")
  assert.equal(visible.policyVersion, "v1", "content the task genuinely needs stays visible")
  assert.equal("goodAffordance" in visible, false, "the answer key must not reach the model")
})

// --- SLA outcome classification ------------------------------------------

test("SLA classification files a late close as missed, not pending", () => {
  // The regression this guards: a closed-but-late issue satisfies neither
  // "met" nor a naive "still open past the deadline" test, so it silently
  // became `pending`. Six issues closed late reported as two settled until
  // this was fixed, and an empty ledger could never have exposed it.
  const deadlineAt = new Date("2026-06-25T21:14:09Z")
  const now = new Date("2026-07-26T00:00:00Z")

  const late = classifyOutcome({ closedAt: new Date("2026-07-26T00:00:00Z"), deadlineAt, now })
  assert.equal(late.met, false)
  assert.equal(late.overdue, true, "a close after the deadline is a miss")
  assert.equal(late.closedLate, true)

  const onTime = classifyOutcome({ closedAt: new Date("2026-06-24T09:00:00Z"), deadlineAt, now })
  assert.equal(onTime.met, true)
  assert.equal(onTime.overdue, false)

  const openAndOverdue = classifyOutcome({ closedAt: undefined, deadlineAt, now })
  assert.equal(openAndOverdue.overdue, true)
  assert.equal(openAndOverdue.openPastDeadline, true)

  const openAndWithin = classifyOutcome({ closedAt: undefined, deadlineAt: new Date("2026-08-01T00:00:00Z"), now })
  assert.equal(openAndWithin.met, false)
  assert.equal(openAndWithin.overdue, false, "open and inside the deadline is pending, not missed")
})
