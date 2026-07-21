import assert from "node:assert/strict"
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { pathToFileURL } from "node:url"

const root = path.resolve(import.meta.dirname, "..")
const verifierPath = path.join(root, "scripts", "verify-apps-ide-lanes.mjs")

assert.equal(existsSync(verifierPath), true, "expected the Apps/IDE composite verifier to exist")

const { parseCompositeArguments, runAppsIdeVerification } = await import(
  pathToFileURL(verifierPath).href
)

assert.throws(
  () => parseCompositeArguments(["--mode", "unknown", "--artifact-dir", "/tmp/artifacts"]),
  /fixture\|contract/,
)
assert.throws(
  () => parseCompositeArguments(["--mode", "fixture", "--artifact-dir", "relative"]),
  /absolute/,
)
assert.throws(
  () =>
    parseCompositeArguments(["--mode", "fixture", "--artifact-dir", path.join(root, "artifacts")]),
  /outside/,
)

const artifactDirectory = mkdtempSync(path.join(tmpdir(), "apps-ide-verifier-test-"))
const observedGateIds = []

try {
  const report = await runAppsIdeVerification({
    artifactDirectory,
    commit: "fedcba9876543210",
    includeConformance: false,
    mode: "contract",
    strictRepo: false,
    contractVerifierPath: path.join(artifactDirectory, "missing-apps-contract.mjs"),
    commandRunner: async gate => {
      observedGateIds.push(gate.id)
      return gate.id === "ide-focused"
        ? { exitCode: 7, stderr: "intentional IDE failure\n", stdout: "" }
        : { exitCode: 0, stderr: "", stdout: `${gate.id} passed\n` }
    },
  })

  assert.deepEqual(observedGateIds, ["ide-focused", "repository-hygiene"])
  assert.equal(report.schemaVersion, "1")
  assert.equal(report.kind, "apps-ide-lanes-verification")
  assert.equal(report.commit, "fedcba9876543210")
  assert.equal(report.overallStatus, "failed")
  assert.deepEqual(report.summary, {
    failed: 1,
    notConfigured: 1,
    notRun: 0,
    passed: 1,
    requiredUnmet: 2,
    total: 3,
  })

  const contractGate = report.gates.find(gate => gate.id === "apps-sdk-contract")
  assert.equal(contractGate?.status, "not-configured")
  assert.equal(contractGate?.required, true)
  assert.equal(
    contractGate?.command,
    `node ${path.join(artifactDirectory, "missing-apps-contract.mjs")}`,
  )
  assert.equal(contractGate?.cwd, root)
  assert.match(contractGate?.failureExcerpt ?? "", /not configured/i)

  const ideGate = report.gates.find(gate => gate.id === "ide-focused")
  assert.equal(ideGate?.status, "failed")
  assert.equal(ideGate?.exitCode, 7)

  for (const gate of report.gates) {
    assert.equal(typeof gate.id, "string")
    assert.equal(typeof gate.lane, "string")
    assert.equal(typeof gate.required, "boolean")
    assert.equal(typeof gate.durationMs, "number")
    assert.equal(typeof gate.inputs, "object")
    assert.equal(typeof gate.artifacts, "object")
  }

  const persisted = JSON.parse(readFileSync(path.join(artifactDirectory, "summary.json"), "utf8"))
  assert.equal(persisted.gates.length, 3)
  assert.match(readFileSync(path.join(artifactDirectory, "summary.md"), "utf8"), /failed/)

  const conformanceGateIds = []
  const conformanceReport = await runAppsIdeVerification({
    artifactDirectory: path.join(artifactDirectory, "with-conformance"),
    commit: "fedcba9876543210",
    includeConformance: true,
    mode: "fixture",
    strictRepo: false,
    commandRunner: async gate => {
      conformanceGateIds.push(gate.id)
      return { exitCode: 0, stderr: "", stdout: `${gate.id} passed\n` }
    },
  })
  assert.deepEqual(conformanceGateIds, [
    "ide-focused",
    "repository-hygiene",
    "official-server-conformance",
  ])
  const authorizationGate = conformanceReport.gates.find(
    gate => gate.id === "official-authorization-conformance",
  )
  assert.equal(authorizationGate?.status, "not-run")
  assert.equal(authorizationGate?.required, false)
  assert.match(authorizationGate?.failureExcerpt ?? "", /missing explicit target/i)
  assert.equal(conformanceReport.overallStatus, "passed")
} finally {
  rmSync(artifactDirectory, { force: true, recursive: true })
}

console.log("Apps/IDE verifier checks passed")
