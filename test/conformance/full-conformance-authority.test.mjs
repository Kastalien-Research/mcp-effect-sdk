import assert from "node:assert/strict"
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { test } from "node:test"

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..")
const read = (relativePath) => readFileSync(path.join(root, relativePath), "utf8")

test("authoritative verification runs complete official server, client, and focused auth suites", () => {
  const scripts = JSON.parse(read("package.json")).scripts
  assert.equal(
    scripts["conformance:client"],
    "pnpm run build && node scripts/run-conformance-client.mjs"
  )
  assert.equal(
    scripts["conformance:run"],
    "pnpm run build && node scripts/run-conformance-suite.mjs"
  )
  assert.equal(
    scripts["conformance:client-auth"],
    "pnpm run build && node scripts/run-conformance-client-auth.mjs"
  )

  const verify = read("scripts/verify.mjs")
  assert.match(verify, /\["pnpm", \["run", "verify:conformance"\]\]/)
  const authoritativeConformance = read("scripts/verify-conformance.mjs")
  for (const command of [
    "conformance:run",
    "conformance:client",
    "conformance:client-auth"
  ]) {
    assert.match(
      authoritativeConformance,
      new RegExp(`\\["pnpm", \\["run", "${command}"\\]\\]`)
    )
  }
})

test("official client and server runners select every applicable 2026-07-28 scenario", () => {
  const client = read("scripts/run-conformance-client.mjs")
  const server = read("scripts/run-conformance-suite.mjs")

  for (const [name, source] of [["client", client], ["server", server]]) {
    assert.match(source, /"--suite",\s*"all"/, `${name} must use the complete official suite`)
    assert.match(source, /"--spec-version",\s*"2026-07-28"/, `${name} must pin the draft`)
    assert.match(source, /loadOfficialScenarioInventory/, `${name} must load the harness inventory`)
    assert.match(source, /assertCompleteOfficialScenarioInventory/, `${name} must verify artifact completeness`)
    assert.doesNotMatch(source, /--expected-failures/, `${name} must not allowlist failures`)
  }

  assert.doesNotMatch(server, /MCP_CONFORMANCE_SUITE/)
})

test("completeness is derived from the pinned harness inventory rather than a local scenario list", async () => {
  const {
    assertCompleteOfficialScenarioInventory,
    collectConformanceArtifactScenarios,
    loadOfficialScenarioInventory
  } = await import("../../scripts/conformance-inventory.mjs")

  const calls = []
  const inventory = loadOfficialScenarioInventory({
    kind: "client",
    conformancePackage: path.join(root, "test/conformance"),
    specVersion: "2026-07-28",
    run(command, args, options) {
      calls.push({ command, args, options })
      return {
        status: 0,
        stdout: [
          "Client scenarios (test against a client):",
          "  - tools_call [2025-06-18,2026-07-28]",
          "  - future-scenario [2026-07-28]",
          ""
        ].join("\n"),
        stderr: ""
      }
    }
  })

  assert.deepEqual(inventory, ["future-scenario", "tools_call"])
  assert.deepEqual(calls[0].args.slice(-4), [
    "list",
    "--client",
    "--spec-version",
    "2026-07-28"
  ])

  const outputDir = mkdtempSync(path.join(tmpdir(), "mcp-full-conformance-"))
  writeChecks(outputDir, "client-tools_call-2026-07-28T12-00-00-000Z")
  writeChecks(outputDir, "future-scenario-2026-07-28T12-00-00-000Z")
  const actual = collectConformanceArtifactScenarios(outputDir)
  assert.deepEqual(actual, inventory)
  assert.doesNotThrow(() => assertCompleteOfficialScenarioInventory({
    kind: "client",
    expected: inventory,
    actual
  }))
  assert.throws(
    () => assertCompleteOfficialScenarioInventory({
      kind: "client",
      expected: [...inventory, "new-upstream-scenario"],
      actual
    }),
    /missing: new-upstream-scenario/
  )
})

test("upstream-declared skipped checks remain explicit informational evidence", async () => {
  const { buildConformanceEvidenceReport } = await import("../../scripts/readiness-evidence.mjs")
  const artifactDir = mkdtempSync(path.join(tmpdir(), "mcp-skipped-conformance-"))
  const directory = path.join(artifactDir, "client-http-standard-headers-2026-07-28T12-00-00-000Z")
  mkdirSync(directory, { recursive: true })
  writeFileSync(path.join(directory, "checks.json"), `${JSON.stringify([{
    id: "upstream-skip",
    name: "legacy method not applicable",
    description: "The pinned harness declared this check skipped.",
    status: "SKIPPED",
    timestamp: "2026-07-28T12:00:00.000Z"
  }], null, 2)}\n`)

  const previousUserAgent = process.env.npm_config_user_agent
  try {
    process.env.npm_config_user_agent = `pnpm/10.11.1 npm/? node/${process.version} darwin arm64`
    const report = buildConformanceEvidenceReport({
      evidenceKind: "conformance-result",
      command: "pnpm run conformance:client",
      exitCode: 0,
      requirementIds: ["GR-CONF-001"],
      suite: "client-all",
      specVersion: "2026-07-28",
      conformancePackage: {
        name: "@modelcontextprotocol/conformance",
        version: "0.2.0-alpha.9"
      },
      artifactDir
    })
    assert.equal(report.skippedCount, 1)
    assert.equal(report.summary.skippedCount, 1)
    assert.deepEqual(report.skippedChecks.map(({ id, classification }) => ({ id, classification })), [{
      id: "upstream-skip",
      classification: "upstream-declared-skipped-informational"
    }])
    assert.equal(report.failureCount, 0)
    assert.equal(report.warningCount, 0)
  } finally {
    if (previousUserAgent === undefined) delete process.env.npm_config_user_agent
    else process.env.npm_config_user_agent = previousUserAgent
  }
})

function writeChecks(outputDir, scenarioDirectory) {
  const directory = path.join(outputDir, scenarioDirectory)
  mkdirSync(directory, { recursive: true })
  writeFileSync(path.join(directory, "checks.json"), "[]\n")
}
