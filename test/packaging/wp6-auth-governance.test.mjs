import assert from "node:assert/strict"
import { spawn, spawnSync } from "node:child_process"
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
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

test("final conformance scenario evidence is closed and aggregate-consistent", async (t) => {
  const evidenceModule = await import("../../scripts/readiness-evidence.mjs")
  const temp = mkdtempSync(path.join(tmpdir(), "mcp-wp6-final-scenario-"))
  const previousRoot = process.env.MCP_READINESS_EVIDENCE_DIR
  try {
    const artifactDir = path.join(temp, "artifact")
    process.env.MCP_READINESS_EVIDENCE_DIR = path.join(temp, "readiness")
    writeChecks(artifactDir, [{
      id: "success",
      name: "success",
      status: "SUCCESS",
      specReferences: []
    }])
    const evidencePath = evidenceModule.writeConformanceEvidenceReport(
      conformanceOptions(artifactDir)
    )
    const valid = JSON.parse(readFileSync(evidencePath, "utf8"))
    assert.equal(evidenceModule.conformanceEvidencePassed(0, valid), true)

    for (const [name, mutate] of [
      ["missing shape", (report) => { report.scenarios[0] = {} }],
      ["skipped status", (report) => { report.scenarios[0].status = "SKIPPED" }],
      ["unknown status", (report) => { report.scenarios[0].status = "UNKNOWN" }],
      ["inconsistent status", (report) => { report.scenarios[0].status = "fail" }],
      ["aggregate mismatch", (report) => { report.scenarios[0].checkCount = 0 }],
      ["extra field", (report) => { report.scenarios[0].secret = "synthetic" }],
      ["duplicate identity", (report) => {
        report.scenarios.push(structuredClone(report.scenarios[0]))
        report.scenarioCount = 2
        report.summary.scenarioCount = 2
        report.checkCount = 2
        report.summary.checkCount = 2
      }]
    ]) {
      await t.test(name, () => {
        const corrupted = structuredClone(valid)
        mutate(corrupted)
        assert.throws(
          () => evidenceModule.assertConformanceEvidenceContract(corrupted),
          /scenario|status|count|duplicate|field/i
        )
        assert.equal(evidenceModule.conformanceEvidencePassed(0, corrupted), false)
      })
    }
  } finally {
    if (previousRoot === undefined) delete process.env.MCP_READINESS_EVIDENCE_DIR
    else process.env.MCP_READINESS_EVIDENCE_DIR = previousRoot
    rmSync(temp, { recursive: true, force: true })
  }
})

test("unknown, skipped, malformed, and empty conformance checks fail construction", async () => {
  const evidenceModule = await import("../../scripts/readiness-evidence.mjs")
  for (const fixture of [
    [{ id: "unknown", name: "unknown", status: "UNRECOGNIZED", specReferences: [] }],
    [{ id: "skipped", name: "skipped", status: "SKIPPED", specReferences: [] }],
    [{ id: "missing-status", name: "missing status", specReferences: [] }],
    []
  ]) {
    const temp = mkdtempSync(path.join(tmpdir(), "mcp-wp6-check-status-"))
    const previousRoot = process.env.MCP_READINESS_EVIDENCE_DIR
    try {
      const evidenceRoot = path.join(temp, "readiness")
      const artifactDir = path.join(temp, "artifact")
      process.env.MCP_READINESS_EVIDENCE_DIR = evidenceRoot
      writeChecks(artifactDir, fixture)
      assert.throws(
        () => evidenceModule.writeConformanceEvidenceReport(
          conformanceOptions(artifactDir, { preserveByRuntime: true })
        ),
        /check|status|empty/i
      )
      const readinessPath = path.join(
        evidenceRoot,
        `${evidenceModule.runtimeEvidenceName("conformance-client-auth", process.version)}.json`
      )
      assert.equal(existsSync(readinessPath), false)
      assert.equal(existsSync(path.join(artifactDir, "evidence.json")), false)
    } finally {
      if (previousRoot === undefined) delete process.env.MCP_READINESS_EVIDENCE_DIR
      else process.env.MCP_READINESS_EVIDENCE_DIR = previousRoot
      rmSync(temp, { recursive: true, force: true })
    }
  }
})

test("conformance evidence rejects a registry-real but suite-inappropriate requirement", async () => {
  const evidenceModule = await import("../../scripts/readiness-evidence.mjs")
  const temp = mkdtempSync(path.join(tmpdir(), "mcp-wp6-requirement-map-"))
  const previousRoot = process.env.MCP_READINESS_EVIDENCE_DIR
  try {
    const evidenceRoot = path.join(temp, "readiness")
    const artifactDir = path.join(temp, "artifact")
    process.env.MCP_READINESS_EVIDENCE_DIR = evidenceRoot
    writeChecks(artifactDir, [{
      id: "success",
      name: "success",
      status: "SUCCESS",
      specReferences: []
    }])
    assert.throws(
      () => evidenceModule.writeConformanceEvidenceReport(conformanceOptions(artifactDir, {
        requirementIds: ["GR-TEST-002"]
      })),
      /requirement|conformance/i
    )
    assert.equal(existsSync(path.join(evidenceRoot, "conformance-client-auth.json")), false)
    assert.equal(existsSync(path.join(artifactDir, "evidence.json")), false)
  } finally {
    if (previousRoot === undefined) delete process.env.MCP_READINESS_EVIDENCE_DIR
    else process.env.MCP_READINESS_EVIDENCE_DIR = previousRoot
    rmSync(temp, { recursive: true, force: true })
  }
})

test("conformance evidence publication is manifest-first, atomic, and failure-clean", async () => {
  const evidenceModule = await import("../../scripts/readiness-evidence.mjs")

  const artifactFailure = mkdtempSync(path.join(tmpdir(), "mcp-wp6-artifact-failure-"))
  let previousRoot = process.env.MCP_READINESS_EVIDENCE_DIR
  try {
    const evidenceRoot = path.join(artifactFailure, "readiness")
    const artifactDir = path.join(artifactFailure, "artifact")
    process.env.MCP_READINESS_EVIDENCE_DIR = evidenceRoot
    writeChecks(artifactDir, [{ id: "success", name: "success", status: "SUCCESS" }])
    mkdirSync(path.join(artifactDir, "evidence.json"))
    assert.throws(
      () => evidenceModule.writeConformanceEvidenceReport(conformanceOptions(artifactDir)),
      /EISDIR|directory|rename/i
    )
    assert.equal(existsSync(path.join(evidenceRoot, "conformance-client-auth.json")), false)
    assert.deepEqual(readdirSync(artifactDir).sort(), ["evidence.json", "fixture"])
  } finally {
    if (previousRoot === undefined) delete process.env.MCP_READINESS_EVIDENCE_DIR
    else process.env.MCP_READINESS_EVIDENCE_DIR = previousRoot
    rmSync(artifactFailure, { recursive: true, force: true })
  }

  const readinessFailure = mkdtempSync(path.join(tmpdir(), "mcp-wp6-readiness-failure-"))
  previousRoot = process.env.MCP_READINESS_EVIDENCE_DIR
  try {
    const evidenceRoot = path.join(readinessFailure, "readiness")
    const artifactDir = path.join(readinessFailure, "artifact")
    const readinessPath = path.join(evidenceRoot, "conformance-client-auth.json")
    process.env.MCP_READINESS_EVIDENCE_DIR = evidenceRoot
    writeChecks(artifactDir, [{ id: "success", name: "success", status: "SUCCESS" }])
    mkdirSync(readinessPath, { recursive: true })
    assert.throws(
      () => evidenceModule.writeConformanceEvidenceReport(conformanceOptions(artifactDir)),
      /EISDIR|directory|rename/i
    )
    assert.equal(statSync(readinessPath).isFile(), false)
    assert.equal(statSync(path.join(artifactDir, "evidence.json")).isFile(), true)
    assert.deepEqual(readdirSync(artifactDir).sort(), ["evidence.json", "fixture"])
    assert.deepEqual(readdirSync(evidenceRoot).sort(), ["conformance-client-auth.json"])
  } finally {
    if (previousRoot === undefined) delete process.env.MCP_READINESS_EVIDENCE_DIR
    else process.env.MCP_READINESS_EVIDENCE_DIR = previousRoot
    rmSync(readinessFailure, { recursive: true, force: true })
  }
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
for (const value of process.argv.slice(2)) {
  const split = Math.max(1, Math.floor(value.length / 2))
  process.stdout.write(value.slice(0, split))
  process.stdout.write(value.slice(split) + "\\n")
  process.stderr.write(value.slice(0, split))
  process.stderr.write(value.slice(split) + "\\n")
}
const lateFlag = process.argv.includes("--client-secret") ? "--client-secret" : "--file"
const lateValue = process.argv[process.argv.indexOf(lateFlag) + 1]
const lateSplit = Math.max(1, Math.floor(lateValue.length / 2))
process.stdout.write("safe-harness-output\\n")
process.stderr.write("safe-harness-output\\n")
process.stdout.write(lateValue.slice(0, lateSplit))
process.stderr.write(lateValue.slice(0, lateSplit))
const lateWriter = require("node:child_process").spawn(process.execPath, [
  "-e",
  'setTimeout(() => { process.stdout.write(process.argv[1] + "\\\\nlate-safe-output\\\\n"); process.stderr.write(process.argv[1] + "\\\\nlate-safe-output\\\\n"); }, 75)',
  lateValue.slice(lateSplit)
], { stdio: ["ignore", "inherit", "inherit"] })
lateWriter.unref()
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
      const processOutput = `${result.stdout}\n${result.stderr}`
      const delayedValue = fixture.kind === "settings-file"
        ? fixture.env.MCP_AUTHORIZATION_CONFORMANCE_FILE
        : fixture.env.MCP_AUTHORIZATION_CLIENT_SECRET
      const delayedPrefix = delayedValue.slice(0, Math.max(1, Math.floor(delayedValue.length / 2)))
      assert.deepEqual(evidence.target, { kind: fixture.kind })
      assert.deepEqual(evidence.requirementIds, ["GR-CONF-001"])
      assert.match(processOutput, /safe-harness-output/)
      assert.match(processOutput, /late-safe-output/)
      assert.equal(processOutput.includes(delayedPrefix), false)
      for (const value of fixture.forbidden) {
        assert.equal(evidenceText.includes(value), false)
        assert.equal(processOutput.includes(value), false)
      }
    } finally {
      rmSync(temp, { recursive: true, force: true })
    }
  }
})

test("authorization output redaction finalizes only after child streams close", () => {
  const runner = read("scripts/run-conformance-authorization.mjs")
  assert.match(runner, /child\.on\(["']close["']/)
  assert.doesNotMatch(runner, /child\.on\(["']exit["']/)
})

test("configured authorization launch failure writes safe failing evidence", () => {
  const temp = mkdtempSync(path.join(tmpdir(), "mcp-wp6-auth-launch-failure-"))
  try {
    const evidenceRoot = path.join(temp, "evidence")
    const artifactRoot = path.join(temp, "artifacts")
    const configured = {
      MCP_AUTHORIZATION_CONFORMANCE_URL: "https://launch-failure.synthetic.example",
      MCP_AUTHORIZATION_CLIENT_ID: "launch-failure-client",
      MCP_AUTHORIZATION_CLIENT_SECRET: "launch-failure-value",
      MCP_AUTHORIZATION_CALLBACK_PORT: "41991"
    }
    const result = spawnSync(process.execPath, ["scripts/run-conformance-authorization.mjs"], {
      cwd: root,
      env: {
        ...process.env,
        ...configured,
        PATH: temp,
        MCP_READINESS_EVIDENCE_DIR: evidenceRoot,
        MCP_CONFORMANCE_OUTPUT_DIR: artifactRoot,
        npm_config_user_agent: "pnpm/10.11.1 npm/? node/" + process.version
      },
      encoding: "utf8"
    })
    assert.equal(result.status, 1)
    const evidenceFile = readdirSync(evidenceRoot)
      .find((name) => name === "conformance-authorization.json")
    assert.ok(evidenceFile)
    const evidenceText = readFileSync(path.join(evidenceRoot, evidenceFile), "utf8")
    const evidence = JSON.parse(evidenceText)
    assert.equal(evidence.exitCode, 1)
    assert.deepEqual(evidence.target, { kind: "url" })
    assert.deepEqual(evidence.requirementIds, ["GR-CONF-001"])
    assert.deepEqual(
      JSON.parse(readFileSync(path.join(artifactRoot, readdirSync(artifactRoot)[0], "evidence.json"), "utf8")),
      evidence
    )
    const processOutput = result.stdout + "\n" + result.stderr
    for (const value of Object.values(configured)) {
      assert.equal(processOutput.includes(value), false)
      assert.equal(evidenceText.includes(value), false)
    }
  } finally {
    rmSync(temp, { recursive: true, force: true })
  }
})

test("authorization output forwarding retains a paused destination through drain", async () => {
  const temp = mkdtempSync(path.join(tmpdir(), "mcp-wp6-auth-backpressure-"))
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
const scenario = path.join(output, "authorization-backpressure")
fs.mkdirSync(scenario, { recursive: true })
fs.writeFileSync(path.join(scenario, "checks.json"), JSON.stringify([{
  id: "authorization-success",
  name: "authorization succeeds",
  status: "SUCCESS",
  specReferences: []
}]))
process.stdout.write("safe-backpressure-start:" + "x".repeat(262144) + ":safe-backpressure-end\\n")
`)
    chmodSync(fakePnpm, 0o755)
    const result = await new Promise((resolve, reject) => {
      const child = spawn(process.execPath, ["scripts/run-conformance-authorization.mjs"], {
        cwd: root,
        env: {
          ...process.env,
          PATH: bin + ":" + (process.env.PATH ?? ""),
          MCP_AUTHORIZATION_CONFORMANCE_FILE: "/synthetic/backpressure-settings.json",
          MCP_READINESS_EVIDENCE_DIR: evidenceRoot,
          MCP_CONFORMANCE_OUTPUT_DIR: artifactRoot,
          npm_config_user_agent: "pnpm/10.11.1 npm/? node/" + process.version
        },
        stdio: ["ignore", "pipe", "pipe"]
      })
      const stdout = []
      const stderr = []
      child.stdout.pause()
      child.stderr.on("data", (chunk) => stderr.push(chunk))
      const resume = setTimeout(() => {
        child.stdout.on("data", (chunk) => stdout.push(chunk))
        child.stdout.resume()
      }, 250)
      child.once("error", reject)
      child.once("close", (code) => {
        clearTimeout(resume)
        resolve({
          code,
          stdout: Buffer.concat(stdout).toString("utf8"),
          stderr: Buffer.concat(stderr).toString("utf8")
        })
      })
    })
    assert.equal(result.code, 0, result.stdout + "\n" + result.stderr)
    assert.match(result.stdout, /safe-backpressure-start:/)
    assert.match(result.stdout, /:safe-backpressure-end/)
    const payload = result.stdout.match(/safe-backpressure-start:(x*):safe-backpressure-end/)?.[1]
    assert.equal(payload?.length, 262144)
  } finally {
    rmSync(temp, { recursive: true, force: true })
  }
})

test("authorization output forwarding awaits a small accepted final write", () => {
  const temp = mkdtempSync(path.join(tmpdir(), "mcp-wp6-auth-write-completion-"))
  try {
    const bin = path.join(temp, "bin")
    const evidenceRoot = path.join(temp, "evidence")
    const artifactRoot = path.join(temp, "artifacts")
    const hook = path.join(temp, "delay-final-write.mjs")
    const marker = "safe-delayed-final-write"
    mkdirSync(bin, { recursive: true })
    writeAuthorizationHarness(bin, marker)
    writeFileSync(hook, `
const originalWrite = process.stdout.write.bind(process.stdout)
process.stdout.write = function delayedWrite(chunk, encoding, callback) {
  if (String(chunk).includes("${marker}")) {
    const args = [chunk]
    if (typeof encoding === "function") args.push(encoding)
    else {
      if (encoding !== undefined) args.push(encoding)
      if (callback !== undefined) args.push(callback)
    }
    setTimeout(() => originalWrite(...args), 150)
    return true
  }
  return originalWrite(...arguments)
}
`)
    const result = spawnSync(process.execPath, [
      "--import",
      hook,
      "scripts/run-conformance-authorization.mjs"
    ], {
      cwd: root,
      env: authorizationFixtureEnv(bin, evidenceRoot, artifactRoot),
      encoding: "utf8"
    })
    assert.equal(result.status, 0, result.stdout + "\n" + result.stderr)
    assert.match(result.stdout, new RegExp(marker))
  } finally {
    rmSync(temp, { recursive: true, force: true })
  }
})

test("authorization output forwarding turns an accepted delayed write failure into failing evidence", () => {
  const temp = mkdtempSync(path.join(tmpdir(), "mcp-wp6-auth-write-failure-"))
  try {
    const bin = path.join(temp, "bin")
    const evidenceRoot = path.join(temp, "evidence")
    const artifactRoot = path.join(temp, "artifacts")
    const hook = path.join(temp, "fail-final-write.mjs")
    const marker = "safe-delayed-write-failure"
    mkdirSync(bin, { recursive: true })
    writeAuthorizationHarness(bin, marker)
    writeFileSync(hook, `
const originalWrite = process.stdout.write.bind(process.stdout)
process.stdout.write = function failedWrite(chunk, encoding, callback) {
  if (String(chunk).includes("${marker}")) {
    const completion = typeof encoding === "function" ? encoding : callback
    if (typeof completion === "function") {
      setTimeout(() => completion(new Error("synthetic delayed write failure")), 75)
    }
    return true
  }
  return originalWrite(...arguments)
}
`)
    const result = spawnSync(process.execPath, [
      "--import",
      hook,
      "scripts/run-conformance-authorization.mjs"
    ], {
      cwd: root,
      env: authorizationFixtureEnv(bin, evidenceRoot, artifactRoot),
      encoding: "utf8"
    })
    assert.equal(result.status, 1, result.stdout + "\n" + result.stderr)
    const readinessPath = path.join(evidenceRoot, "conformance-authorization.json")
    const readinessText = readFileSync(readinessPath, "utf8")
    const readiness = JSON.parse(readinessText)
    const manifestPath = path.join(artifactRoot, readdirSync(artifactRoot)[0], "evidence.json")
    assert.equal(readiness.exitCode, 1)
    assert.deepEqual(readiness.target, { kind: "settings-file" })
    assert.equal(readFileSync(manifestPath, "utf8"), readinessText)
    assert.doesNotMatch(result.stdout + "\n" + result.stderr, /synthetic delayed write failure/)
  } finally {
    rmSync(temp, { recursive: true, force: true })
  }
})

test("authorization output forwarding turns destination close into failing evidence", () => {
  const temp = mkdtempSync(path.join(tmpdir(), "mcp-wp6-auth-write-close-"))
  try {
    const bin = path.join(temp, "bin")
    const evidenceRoot = path.join(temp, "evidence")
    const artifactRoot = path.join(temp, "artifacts")
    const hook = path.join(temp, "close-final-write.mjs")
    const marker = "safe-destination-close"
    mkdirSync(bin, { recursive: true })
    writeAuthorizationHarness(bin, marker)
    writeFileSync(hook, `
const originalWrite = process.stdout.write.bind(process.stdout)
process.stdout.write = function closedWrite(chunk) {
  if (String(chunk).includes("${marker}")) {
    setTimeout(() => process.stdout.emit("close"), 75)
    return true
  }
  return originalWrite(...arguments)
}
`)
    const result = spawnSync(process.execPath, [
      "--import",
      hook,
      "scripts/run-conformance-authorization.mjs"
    ], {
      cwd: root,
      env: authorizationFixtureEnv(bin, evidenceRoot, artifactRoot),
      encoding: "utf8"
    })
    assert.equal(result.status, 1, result.stdout + "\n" + result.stderr)
    assertAuthorizationFailureEvidence(evidenceRoot, artifactRoot)
  } finally {
    rmSync(temp, { recursive: true, force: true })
  }
})

for (const accepted of [true, false]) {
  test(`authorization output forwarding settles a silent ${accepted ? "accepted" : "backpressured"} write`, () => {
    const temp = mkdtempSync(path.join(tmpdir(), `mcp-wp6-auth-silent-write-${accepted}-`))
    try {
      const bin = path.join(temp, "bin")
      const evidenceRoot = path.join(temp, "evidence")
      const artifactRoot = path.join(temp, "artifacts")
      const hook = path.join(temp, "silent-final-write.mjs")
      const marker = `safe-silent-write-${accepted}`
      mkdirSync(bin, { recursive: true })
      writeAuthorizationHarness(bin, marker)
      writeFileSync(hook, `
const originalWrite = process.stdout.write.bind(process.stdout)
process.stdout.write = function silentWrite(chunk) {
  if (String(chunk).includes("${marker}")) {
    return ${accepted}
  }
  return originalWrite(...arguments)
}
`)
      const result = spawnSync(process.execPath, [
        "--import",
        hook,
        "scripts/run-conformance-authorization.mjs"
      ], {
        cwd: root,
        env: authorizationFixtureEnv(bin, evidenceRoot, artifactRoot),
        encoding: "utf8"
      })
      assert.equal(result.status, 1, result.stdout + "\n" + result.stderr)
      assertAuthorizationFailureEvidence(evidenceRoot, artifactRoot)
      assert.doesNotMatch(result.stderr, /unsettled top-level await/i)
    } finally {
      rmSync(temp, { recursive: true, force: true })
    }
  })
}

test("authorization output forwarding contains a post-callback destination error", () => {
  const temp = mkdtempSync(path.join(tmpdir(), "mcp-wp6-auth-post-callback-error-"))
  try {
    const bin = path.join(temp, "bin")
    const evidenceRoot = path.join(temp, "evidence")
    const artifactRoot = path.join(temp, "artifacts")
    const hook = path.join(temp, "post-callback-error.mjs")
    const marker = "safe-post-callback-error"
    mkdirSync(bin, { recursive: true })
    writeAuthorizationHarness(bin, marker)
    writeFileSync(hook, `
const originalWrite = process.stdout.write.bind(process.stdout)
process.stdout.write = function postCallbackError(chunk, encoding, callback) {
  if (String(chunk).includes("${marker}")) {
    const completion = typeof encoding === "function" ? encoding : callback
    if (typeof completion === "function") completion()
    queueMicrotask(() => {
      process.stdout.emit("error", new Error("synthetic post-callback destination error"))
    })
    return true
  }
  return originalWrite(...arguments)
}
`)
    const result = spawnSync(process.execPath, [
      "--import",
      hook,
      "scripts/run-conformance-authorization.mjs"
    ], {
      cwd: root,
      env: authorizationFixtureEnv(bin, evidenceRoot, artifactRoot),
      encoding: "utf8"
    })
    assert.equal(result.status, 1, result.stdout + "\n" + result.stderr)
    assertAuthorizationFailureEvidence(evidenceRoot, artifactRoot)
    assert.doesNotMatch(
      result.stdout + "\n" + result.stderr,
      /synthetic post-callback destination error|Unhandled ['"]error['"] event/
    )
  } finally {
    rmSync(temp, { recursive: true, force: true })
  }
})

test("authorization output forwarding contains a failed sink through termination", () => {
  const temp = mkdtempSync(path.join(tmpdir(), "mcp-wp6-auth-failed-sink-"))
  try {
    const bin = path.join(temp, "bin")
    const evidenceRoot = path.join(temp, "evidence")
    const artifactRoot = path.join(temp, "artifacts")
    const hook = path.join(temp, "repeat-failed-write.mjs")
    const sinkReport = path.join(temp, "sink-report.json")
    const marker = "safe-repeated-pipe-failure"
    mkdirSync(bin, { recursive: true })
    writeAuthorizationHarness(bin, marker)
    writeFileSync(hook, `
import fs from "node:fs"
const originalWrite = process.stdout.write.bind(process.stdout)
let failed = false
let writesAfterFailure = 0
process.stdout.write = function failedWrite(chunk, encoding, callback) {
  if (failed) {
    writesAfterFailure++
    return originalWrite(...arguments)
  }
  if (String(chunk).includes("${marker}")) {
    const completion = typeof encoding === "function" ? encoding : callback
    setTimeout(() => {
      failed = true
      if (typeof completion === "function") {
        completion(new Error("synthetic repeated pipe failure"))
      }
      process.stdout.emit("error", new Error("synthetic repeated pipe failure"))
    }, 75)
    return true
  }
  return originalWrite(...arguments)
}
process.once("beforeExit", () => {
  fs.writeFileSync(${JSON.stringify(sinkReport)}, JSON.stringify({
    writesAfterFailure,
    errorListeners: process.stdout.listenerCount("error")
  }))
})
`)
    const result = spawnSync(process.execPath, [
      "--import",
      hook,
      "scripts/run-conformance-authorization.mjs"
    ], {
      cwd: root,
      env: authorizationFixtureEnv(bin, evidenceRoot, artifactRoot),
      encoding: "utf8"
    })
    assert.equal(result.status, 1, result.stdout + "\n" + result.stderr)
    assertAuthorizationFailureEvidence(evidenceRoot, artifactRoot)
    const sink = JSON.parse(readFileSync(sinkReport, "utf8"))
    assert.equal(sink.writesAfterFailure, 0)
    assert.ok(sink.errorListeners >= 1)
    assert.doesNotMatch(
      result.stdout + "\n" + result.stderr,
      /synthetic repeated pipe failure|Unhandled ['"]error['"] event/
    )
  } finally {
    rmSync(temp, { recursive: true, force: true })
  }
})

test("authorization output forwarding cleans waiters after a synchronous write throw", () => {
  const temp = mkdtempSync(path.join(tmpdir(), "mcp-wp6-auth-write-throw-"))
  try {
    const bin = path.join(temp, "bin")
    const evidenceRoot = path.join(temp, "evidence")
    const artifactRoot = path.join(temp, "artifacts")
    const hook = path.join(temp, "throw-final-write.mjs")
    const listenerReport = path.join(temp, "listeners.json")
    const marker = "safe-synchronous-write-throw"
    mkdirSync(bin, { recursive: true })
    writeAuthorizationHarness(bin, marker)
    writeFileSync(hook, `
import fs from "node:fs"
const originalWrite = process.stdout.write.bind(process.stdout)
const baseline = {
  drain: process.stdout.listenerCount("drain"),
  close: process.stdout.listenerCount("close"),
  error: process.stdout.listenerCount("error")
}
process.stdout.write = function throwingWrite(chunk) {
  if (String(chunk).includes("${marker}")) {
    throw new Error("synthetic synchronous write throw")
  }
  return originalWrite(...arguments)
}
process.once("beforeExit", () => {
  fs.writeFileSync(${JSON.stringify(listenerReport)}, JSON.stringify({
    drain: process.stdout.listenerCount("drain") - baseline.drain,
    close: process.stdout.listenerCount("close") - baseline.close,
    error: process.stdout.listenerCount("error") - baseline.error
  }))
})
`)
    const result = spawnSync(process.execPath, [
      "--import",
      hook,
      "scripts/run-conformance-authorization.mjs"
    ], {
      cwd: root,
      env: authorizationFixtureEnv(bin, evidenceRoot, artifactRoot),
      encoding: "utf8"
    })
    assert.equal(result.status, 1, result.stdout + "\n" + result.stderr)
    assertAuthorizationFailureEvidence(evidenceRoot, artifactRoot)
    const listeners = JSON.parse(readFileSync(listenerReport, "utf8"))
    assert.equal(listeners.drain, 0)
    assert.equal(listeners.close, 0)
    assert.ok(listeners.error <= 1)
  } finally {
    rmSync(temp, { recursive: true, force: true })
  }
})

test("authorization output forwarding is launch-safe and backpressure-aware", () => {
  const runner = read("scripts/run-conformance-authorization.mjs")
  assert.match(runner, /child\.once\(["']error["']/)
  assert.match(runner, /for await \(const chunk of readable\)/)
  assert.match(runner, /target\.once\(["']drain["']/)
  assert.match(runner, /target\.once\(["']close["']/)
  assert.match(runner, /target\.once\(["']error["']/)
  assert.match(runner, /process\.once\(["']beforeExit["']/)
  assert.match(runner, /target\.write\(output,\s*\(error\)\s*=>/)
  assert.match(runner, /containOutputErrors/)
  assert.match(runner, /observeOutputTarget/)
  assert.match(runner, /outputTargetSucceeded/)
  assert.match(runner, /stdoutSucceeded/)
  assert.match(runner, /if \(runResult\.stdoutSucceeded\)/)
  assert.match(runner, /process\.exitCode\s*=\s*conformanceEvidencePassed/)
  assert.doesNotMatch(runner, /process\.exit\(conformanceEvidencePassed/)
  assert.doesNotMatch(runner, /child\.(?:stdout|stderr)\.on\(["']data["']/)
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

function conformanceOptions(artifactDir, overrides = {}) {
  return {
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
    ...overrides
  }
}

function escapeRegex(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
}

function writeAuthorizationHarness(bin, marker) {
  const fakePnpm = path.join(bin, "pnpm")
  writeFileSync(fakePnpm, `#!/usr/bin/env node
const fs = require("node:fs")
const path = require("node:path")
const index = process.argv.indexOf("--output-dir")
if (index < 0) process.exit(2)
const output = process.argv[index + 1]
const scenario = path.join(output, "authorization-write-completion")
fs.mkdirSync(scenario, { recursive: true })
fs.writeFileSync(path.join(scenario, "checks.json"), JSON.stringify([{
  id: "authorization-success",
  name: "authorization succeeds",
  status: "SUCCESS",
  specReferences: []
}]))
process.stdout.write(${JSON.stringify(marker + "\n")})
`)
  chmodSync(fakePnpm, 0o755)
}

function authorizationFixtureEnv(bin, evidenceRoot, artifactRoot) {
  return {
    ...process.env,
    PATH: bin + ":" + (process.env.PATH ?? ""),
    MCP_AUTHORIZATION_CONFORMANCE_FILE: "/synthetic/write-completion-settings.json",
    MCP_READINESS_EVIDENCE_DIR: evidenceRoot,
    MCP_CONFORMANCE_OUTPUT_DIR: artifactRoot,
    npm_config_user_agent: "pnpm/10.11.1 npm/? node/" + process.version
  }
}

function assertAuthorizationFailureEvidence(evidenceRoot, artifactRoot) {
  const readinessPath = path.join(evidenceRoot, "conformance-authorization.json")
  const readinessText = readFileSync(readinessPath, "utf8")
  const readiness = JSON.parse(readinessText)
  const manifestPath = path.join(artifactRoot, readdirSync(artifactRoot)[0], "evidence.json")
  assert.equal(readiness.exitCode, 1)
  assert.deepEqual(readiness.target, { kind: "settings-file" })
  assert.equal(readFileSync(manifestPath, "utf8"), readinessText)
}
