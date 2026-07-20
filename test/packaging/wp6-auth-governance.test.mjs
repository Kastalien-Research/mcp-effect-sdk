import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync
} from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { test } from "node:test"

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..")
const read = (relative) => readFileSync(path.join(root, relative), "utf8")
const packageJson = JSON.parse(read("package.json"))

const focusedAliases = [
  "test:wp6-auth-client",
  "test:wp6-auth-protected-resource",
  "test:wp6-auth-http",
  "test:wp6-auth-types",
  "test:wp6-auth-package"
]

const expectedRuntimeTests = [
  "test/auth/wp6-client-runtime.test.mjs",
  "test/auth/wp6b-client-boundary.test.mjs",
  "test/auth/wp6b-protected-resource-boundary.test.mjs",
  "test/auth/wp6c-discovery.test.mjs",
  "test/auth/wp6c-registration.test.mjs",
  "test/auth/wp6c-scopes.test.mjs",
  "test/auth/wp6c-security.test.mjs",
  "test/auth/wp6d-client-token.test.mjs",
  "test/auth/wp6d-client-transaction.test.mjs",
  "test/http/wp6-http-client-auth.test.mjs",
  "test/http/wp6-http-protected-resource.test.mjs",
  "test/packaging/wp6b-auth-subpaths.test.mjs",
  "test/packaging/wp6-auth-examples.test.mjs",
  "test/packaging/wp6-auth-governance.test.mjs"
]

const expectedTypeFixtures = [
  "test/types/wp6-client-runtime/tsconfig.json",
  "test/types/wp6b-auth-public/tsconfig.json",
  "test/types/wp6-auth-protected-resource/tsconfig.json"
]

const count = (source, needle) => source.split(needle).length - 1

test("WP6 focused aliases and cumulative gate execute every owned witness exactly once", () => {
  for (const alias of [...focusedAliases, "test:wp6"]) {
    assert.equal(typeof packageJson.scripts[alias], "string", `${alias} is missing`)
  }

  const focused = focusedAliases.map((alias) => packageJson.scripts[alias]).join("\n")
  for (const file of [...expectedRuntimeTests, ...expectedTypeFixtures]) {
    assert.equal(count(focused, file), 1, `${file} must occur exactly once across focused aliases`)
  }
  assert.equal(focused.includes("conformance:client-auth"), false)
  assert.equal(focused.includes("conformance:authorization"), false)

  const cumulative = packageJson.scripts["test:wp6"]
  for (const alias of focusedAliases) {
    assert.equal(count(cumulative, `pnpm run ${alias}`), 1, `${alias} must occur once in test:wp6`)
  }
  for (const file of [...expectedRuntimeTests, ...expectedTypeFixtures]) {
    assert.equal(cumulative.includes(file), false, "test:wp6 must compose aliases rather than duplicate witnesses")
  }
})

test("verify runs exactly test:wp6 immediately after test:wp5-core and never runs official conformance", () => {
  const verify = read("scripts/verify.mjs")
  assert.match(verify, /\["pnpm", \["run", "test:wp5-core"\]\],\s*\["pnpm", \["run", "test:wp6"\]\]/)
  assert.equal(count(verify, '["pnpm", ["run", "test:wp6"]]'), 1)
  assert.doesNotMatch(verify, /\["pnpm", \["run", "conformance:(?:client-auth|authorization)"\]\]/)
})

test("official client-auth evidence is pinned exactly and cannot report success with failed checks", () => {
  const runner = read("scripts/run-conformance-client-auth.mjs")
  const evidence = read("scripts/readiness-evidence.mjs")
  const harness = JSON.parse(read("test/conformance/package.json"))
  assert.equal(harness.devDependencies["@modelcontextprotocol/conformance"], "0.2.0-alpha.9")
  assert.match(runner, /expectedConformanceVersion\s*=\s*["']0\.2\.0-alpha\.9["']/)
  assert.match(runner, /--spec-version["'],\s*["']2026-07-28["']/)
  assert.match(runner, /conformanceEvidencePassed\(result, evidence\)/)
  assert.match(evidence, /report\.failureCount\s*===\s*0/)
  assert.match(evidence, /report\.warningCount\s*===\s*0/)
})

test("conformance evidence cannot be written without complete requirement and provenance fields", async () => {
  const evidenceModule = await import("../../scripts/readiness-evidence.mjs")
  assert.equal(typeof evidenceModule.assertConformanceEvidenceContract, "function")
  assert.equal(typeof evidenceModule.buildConformanceEvidenceReport, "function")

  const temp = mkdtempSync(path.join(tmpdir(), "mcp-wp6-evidence-contract-"))
  const previousRoot = process.env.MCP_READINESS_EVIDENCE_DIR
  try {
    process.env.MCP_READINESS_EVIDENCE_DIR = temp
    const artifactDir = path.join(temp, "client-auth-fixture")
    writeChecks(artifactDir, [{
      id: "client-auth-success",
      name: "client auth succeeds",
      status: "SUCCESS",
      specReferences: []
    }])
    assert.throws(() => evidenceModule.writeConformanceEvidenceReport({
      name: "conformance-client-auth",
      evidenceKind: "conformance-result",
      command: "pnpm run conformance:client-auth",
      exitCode: 0,
      requirementIds: [],
      suite: "client-auth",
      specVersion: "2026-07-28",
      conformancePackage: {
        name: "@modelcontextprotocol/conformance",
        version: "0.2.0-alpha.9"
      },
      artifactDir,
      preserveByRuntime: true
    }), /requirement/i)

    const validPath = evidenceModule.writeConformanceEvidenceReport({
      name: "conformance-client-auth",
      evidenceKind: "conformance-result",
      command: "pnpm run conformance:client-auth",
      exitCode: 0,
      requirementIds: ["GR-CONF-001"],
      suite: "client-auth",
      specVersion: "2026-07-28",
      conformancePackage: {
        name: "@modelcontextprotocol/conformance",
        version: "0.2.0-alpha.9"
      },
      artifactDir,
      preserveByRuntime: true
    })
    const report = JSON.parse(readFileSync(validPath, "utf8"))
    assert.deepEqual(report.runtime, { name: "node", version: process.version })
    assert.deepEqual(report.packageManager, { name: "pnpm", version: "10.11.1" })
    assert.deepEqual(report.sourceRevisions, {
      mcpCore: "26897cc322f356487da89113451bd16b520b9288",
      mcpConformance: "ce25103b1baa6e0653e0b7bf4f79de385ea7a116"
    })
    assert.match(path.basename(validPath), new RegExp(`node-${escapeRegex(process.version)}\\.json$`))
    assert.deepEqual(
      JSON.parse(readFileSync(path.join(artifactDir, "evidence.json"), "utf8")),
      report
    )

    const incomplete = structuredClone(report)
    delete incomplete.runtime
    assert.throws(
      () => evidenceModule.assertConformanceEvidenceContract(incomplete),
      /runtime/i
    )
    const unknownRequirement = structuredClone(report)
    unknownRequirement.requirementIds = ["GR-CONF-999"]
    assert.throws(
      () => evidenceModule.assertConformanceEvidenceContract(unknownRequirement),
      /unknown.*requirement/i
    )
  } finally {
    if (previousRoot === undefined) delete process.env.MCP_READINESS_EVIDENCE_DIR
    else process.env.MCP_READINESS_EVIDENCE_DIR = previousRoot
    rmSync(temp, { recursive: true, force: true })
  }
})

test("per-runtime evidence names are distinct and unadjudicated warnings block success", async () => {
  const evidenceModule = await import("../../scripts/readiness-evidence.mjs")
  assert.equal(typeof evidenceModule.runtimeEvidenceName, "function")
  assert.equal(typeof evidenceModule.conformanceEvidencePassed, "function")
  assert.notEqual(
    evidenceModule.runtimeEvidenceName("conformance-client-auth", "v22.22.3"),
    evidenceModule.runtimeEvidenceName("conformance-client-auth", "v24.15.0")
  )

  const report = {
    evidenceKind: "conformance-result",
    timestamp: "2026-07-20T00:00:00.000Z",
    command: "pnpm run conformance:client-auth",
    exitCode: 0,
    requirementIds: ["GR-CONF-001"],
    summary: {
      suite: "client-auth",
      scenarioCount: 1,
      checkCount: 1,
      failureCount: 0,
      warningCount: 1
    },
    suite: "client-auth",
    specVersion: "2026-07-28",
    conformancePackage: {
      name: "@modelcontextprotocol/conformance",
      version: "0.2.0-alpha.9"
    },
    runtime: { name: "node", version: "v22.22.3" },
    packageManager: { name: "pnpm", version: "10.11.1" },
    sourceRevisions: {
      mcpCore: "26897cc322f356487da89113451bd16b520b9288",
      mcpConformance: "ce25103b1baa6e0653e0b7bf4f79de385ea7a116"
    },
    artifactDir: ".local/conformance/client-auth-fixture",
    scenarioCount: 1,
    checkCount: 1,
    failureCount: 0,
    warningCount: 1,
    scenarios: [{
      id: "warning-fixture",
      scenario: "warning-fixture",
      checkCount: 1,
      failureCount: 0,
      warningCount: 1,
      status: "pass"
    }],
    failedChecks: [],
    warningClassifications: [{
      scenario: "warning-fixture",
      id: "warning",
      name: "warning",
      specReferences: [],
      classification: "blocking-unadjudicated-conformance-warning"
    }]
  }
  assert.equal(evidenceModule.conformanceEvidencePassed(0, report), false)
  const emptyReport = structuredClone(report)
  emptyReport.summary.scenarioCount = 0
  emptyReport.summary.checkCount = 0
  emptyReport.summary.warningCount = 0
  emptyReport.scenarioCount = 0
  emptyReport.checkCount = 0
  emptyReport.warningCount = 0
  emptyReport.scenarios = []
  emptyReport.warningClassifications = []
  assert.equal(evidenceModule.conformanceEvidencePassed(0, emptyReport), false)
})

test("configured external authorization records only its safe target mode", () => {
  for (const fixture of [
    {
      kind: "settings-file",
      env: { MCP_AUTHORIZATION_CONFORMANCE_FILE: "/private/synthetic/settings.json" },
      forbidden: ["/private/synthetic/settings.json"]
    },
    {
      kind: "url",
      env: {
        MCP_AUTHORIZATION_CONFORMANCE_URL: "https://issuer.synthetic.example",
        MCP_AUTHORIZATION_CLIENT_ID: "synthetic-client",
        MCP_AUTHORIZATION_CLIENT_SECRET: "synthetic-secret",
        MCP_AUTHORIZATION_CALLBACK_PORT: "41719"
      },
      forbidden: [
        "https://issuer.synthetic.example",
        "synthetic-client",
        "synthetic-secret",
        "41719"
      ]
    }
  ]) {
    const temp = mkdtempSync(path.join(tmpdir(), `mcp-wp6-auth-${fixture.kind}-`))
    try {
      const bin = path.join(temp, "bin")
      const evidenceRoot = path.join(temp, "evidence")
      const artifactRoot = path.join(temp, "artifacts")
      mkdirSync(bin, { recursive: true })
      const fakePnpm = path.join(bin, "pnpm")
      writeFileSync(fakePnpm, `#!/usr/bin/env node
const fs = require("node:fs")
const path = require("node:path")
const index = process.argv.indexOf("--output-dir")
if (index < 0) process.exit(2)
const output = process.argv[index + 1]
const scenario = path.join(output, "authorization-fixture")
fs.mkdirSync(scenario, { recursive: true })
fs.writeFileSync(path.join(scenario, "checks.json"), JSON.stringify([{
  id: "authorization-success",
  name: "authorization succeeds",
  status: "SUCCESS",
  specReferences: []
}]))
`)
      chmodSync(fakePnpm, 0o755)
      const env = {
        ...process.env,
        ...fixture.env,
        PATH: `${bin}:${process.env.PATH ?? ""}`,
        MCP_READINESS_EVIDENCE_DIR: evidenceRoot,
        MCP_CONFORMANCE_OUTPUT_DIR: artifactRoot,
        npm_config_user_agent: `pnpm/10.11.1 npm/? node/${process.version}`
      }
      if (fixture.kind === "settings-file") {
        delete env.MCP_AUTHORIZATION_CONFORMANCE_URL
        delete env.MCP_AUTHORIZATION_CLIENT_ID
        delete env.MCP_AUTHORIZATION_CLIENT_SECRET
        delete env.MCP_AUTHORIZATION_CALLBACK_PORT
      } else {
        delete env.MCP_AUTHORIZATION_CONFORMANCE_FILE
      }
      const result = spawnSync(process.execPath, ["scripts/run-conformance-authorization.mjs"], {
        cwd: root,
        env,
        encoding: "utf8"
      })
      assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`)
      const evidenceFile = readdirSync(evidenceRoot)
        .find((name) => name.startsWith("conformance-authorization"))
      assert.ok(evidenceFile)
      const evidenceText = readFileSync(path.join(evidenceRoot, evidenceFile), "utf8")
      const evidence = JSON.parse(evidenceText)
      assert.deepEqual(evidence.target, { kind: fixture.kind })
      assert.deepEqual(evidence.requirementIds, ["GR-CONF-001"])
      for (const value of fixture.forbidden) assert.equal(evidenceText.includes(value), false)
    } finally {
      rmSync(temp, { recursive: true, force: true })
    }
  }
})

test("missing external authorization target exits one with a safe machine-readable blocker", () => {
  const temp = mkdtempSync(path.join(tmpdir(), "mcp-wp6-auth-missing-target-"))
  try {
    const env = { ...process.env, MCP_READINESS_EVIDENCE_DIR: temp, MCP_CONFORMANCE_OUTPUT_DIR: temp }
    for (const key of [
      "MCP_AUTHORIZATION_CONFORMANCE_FILE",
      "MCP_AUTHORIZATION_CONFORMANCE_URL",
      "MCP_AUTHORIZATION_CLIENT_ID",
      "MCP_AUTHORIZATION_CLIENT_SECRET",
      "MCP_AUTHORIZATION_CALLBACK_PORT"
    ]) delete env[key]
    const result = spawnSync(process.execPath, ["scripts/run-conformance-authorization.mjs"], {
      cwd: root,
      env,
      encoding: "utf8"
    })
    assert.equal(result.status, 1)
    assert.match(result.stderr, /Missing authorization conformance target/)
    const evidenceFile = readdirSync(temp).find((name) => name === "conformance-authorization.json")
    assert.ok(evidenceFile)
    const evidence = JSON.parse(readFileSync(path.join(temp, evidenceFile), "utf8"))
    assert.equal(evidence.conformancePackage.version, "0.2.0-alpha.9")
    assert.equal(evidence.specVersion, "2026-07-28")
    assert.equal(evidence.exitCode, 1)
    assert.deepEqual(evidence.target, { kind: "missing" })
    assert.equal(evidence.qualification, "blocked-missing-external-target")
    assert.equal(JSON.stringify(evidence).includes("MCP_AUTHORIZATION_CLIENT_SECRET"), false)
  } finally {
    rmSync(temp, { recursive: true, force: true })
  }
})

test("authorization governance records local implementation without claiming qualification or issue closure", () => {
  const parity = JSON.parse(read("docs/conformance/ts-sdk-parity-deferred.json"))
  const wp6 = parity.items.find((item) => item.id === "wp6-auth-hardening")
  assert.equal(wp6.status, "implemented-locally")
  assert.equal(wp6.evidence.remoteIssueDisposition, "approval-required")
  assert.equal(wp6.evidence.externalAuthorizationQualification, "blocked-missing-approved-target")

  for (const relative of [
    "docs/conformance/scenario-map.md",
    "docs/conformance/sdk-tier-evidence.md",
    "docs/draft-2026-07-28-migration.md"
  ]) {
    const source = read(relative)
    assert.match(source, /#20[^\n]*(?:implemented locally|Implemented locally)/)
    assert.match(source, /approval[- ]gated|approval required/i)
    assert.match(source, /not (?:official )?(?:authorization )?conformance|does not (?:prove|establish)/i)
  }

  const tier = read("scripts/check-tier-protocol-features.mjs")
  const readiness = read("scripts/check-sdk-readiness-requirements.mjs")
  assert.match(tier, /issue:\s*["']#20["'][\s\S]*?implementationStatus:\s*["']implemented-locally["']/)
  assert.doesNotMatch(tier, /issue:\s*["']#20["'][\s\S]*?implementationStatus:\s*["']deferred-wp6["']/)
  assert.match(readiness, /issue:\s*["']#20["'][\s\S]*?implementationStatus:\s*["']implemented-locally["']/)
})

test("the real TypeScript SDK parity validator accepts the implemented WP6 ledger", () => {
  const parity = spawnSync(process.execPath, ["scripts/check-ts-sdk-parity.mjs"], {
    cwd: root,
    encoding: "utf8"
  })
  assert.equal(parity.status, 0, `${parity.stdout}\n${parity.stderr}`)
})

test("the readiness validator requires the exact locally implemented #20 status", () => {
  const readiness = read("scripts/check-sdk-readiness-requirements.mjs")
  const requiredStatuses = readiness.match(/const requiredStatuses = \{[\s\S]*?\n  \}/)?.[0] ?? ""
  assert.match(requiredStatuses, /["']#20["']:\s*["']implemented-locally["']/)
  assert.doesNotMatch(requiredStatuses, /["']#20["']:\s*["']deferred-wp6["']/)
})

test("deprecated DCR fallback stays inside the stable auth client boundary", () => {
  const migration = read("docs/draft-2026-07-28-migration.md")
  assert.match(migration, /DCR[^\n]*deprecated fallback/i)
  assert.match(migration, /mcp-effect-sdk\/auth\/client/)
  for (const relative of ["src/examples/everything-client.ts", "src/index.ts"]) {
    assert.doesNotMatch(read(relative), /OAuthProviders|OAuthErrors|\bOAuth\b/)
  }
  assert.match(read("src/auth/client/registration.ts"), /application_type/)
})

function writeChecks(artifactDir, checks) {
  const scenario = path.join(artifactDir, "fixture")
  mkdirSync(scenario, { recursive: true })
  writeFileSync(path.join(scenario, "checks.json"), JSON.stringify(checks))
}

function escapeRegex(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
}
