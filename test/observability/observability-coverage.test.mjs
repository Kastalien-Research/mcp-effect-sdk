import { spawnSync } from "node:child_process"
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import assert from "node:assert/strict"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { test } from "node:test"

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..")
const inventoryPath = path.join(root, "docs/observability-inventory.json")
const inventory = JSON.parse(readFileSync(inventoryPath, "utf8"))
const packageScriptsPath = path.join(root, "package.json")
const packageScripts = JSON.parse(readFileSync(packageScriptsPath, "utf8")).scripts
const quarantineEntries = (inventory.entries ?? []).filter((entry) => entry.status === "quarantined")
const readScriptSource = (relativePath) => readFileSync(path.join(root, relativePath), "utf8")

test("observability coverage gate script passes with current repo state", () => {
  const result = spawnSync(process.execPath, ["scripts/check-observability-coverage.mjs"], {
    cwd: root,
    encoding: "utf8"
  })
  assert.equal(result.status, 0, `gate script failed: ${result.stderr || result.stdout}`)
})

test("coverage gate rejects aliased effect run entrypoints in non-boundary files", () => {
  const fixtureRoot = mkdtempSync(path.join(tmpdir(), "obs-coverage-alias-fail-"))
  try {
    mkdirSync(path.join(fixtureRoot, "src"), { recursive: true })
    mkdirSync(path.join(fixtureRoot, "docs"), { recursive: true })
    writeFileSync(
      path.join(fixtureRoot, "docs/observability-inventory.json"),
      JSON.stringify({
        version: 1,
        entries: [
          {
            pathPrefix: "src/",
            status: "instrumented",
            rationale: "fixture expects non-boundary status to validate gate behavior"
          }
        ]
      })
    )
    writeFileSync(
      path.join(fixtureRoot, "src/aliased-entrypoint.ts"),
      ['import * as Fx from "effect"', "Fx.runPromise(Fx.succeed(1))"].join("\n")
    )

    const result = spawnSync(process.execPath, ["scripts/check-observability-coverage.mjs"], {
      cwd: root,
      encoding: "utf8",
      env: {
        ...process.env,
        MCP_EFFECT_OBSERVABILITY_ROOT: fixtureRoot
      }
    })

    assert.equal(
      result.status,
      1,
      `aliased entrypoint in non-boundary file should fail the gate: ${result.stderr || result.stdout}`
    )
  } finally {
    rmSync(fixtureRoot, { recursive: true, force: true })
  }
})

test("coverage gate accepts aliased effect run entrypoints in boundary files", () => {
  const fixtureRoot = mkdtempSync(path.join(tmpdir(), "obs-coverage-alias-ok-"))
  try {
    mkdirSync(path.join(fixtureRoot, "src"), { recursive: true })
    mkdirSync(path.join(fixtureRoot, "docs"), { recursive: true })
    writeFileSync(
      path.join(fixtureRoot, "docs/observability-inventory.json"),
      JSON.stringify({
        version: 1,
        entries: [
          {
            pathPrefix: "src/",
            status: "rootOnly",
            rationale: "fixture root should permit effect entrypoint boundary status"
          }
        ]
      })
    )
    writeFileSync(
      path.join(fixtureRoot, "src/aliased-entrypoint.ts"),
      ['import * as Fx from "effect"', "Fx.runPromise(Fx.succeed(1))"].join("\n")
    )

    const result = spawnSync(process.execPath, ["scripts/check-observability-coverage.mjs"], {
      cwd: root,
      encoding: "utf8",
      env: {
        ...process.env,
        MCP_EFFECT_OBSERVABILITY_ROOT: fixtureRoot
      }
    })

    assert.equal(
      result.status,
      0,
      `boundary classification should pass with aliased entrypoint: ${result.stderr || result.stdout}`
    )
  } finally {
    rmSync(fixtureRoot, { recursive: true, force: true })
  }
})

test("coverage gate catches aliased NodeRuntime entrypoints and rejects non-boundary usage", () => {
  const fixtureRoot = mkdtempSync(path.join(tmpdir(), "obs-coverage-noderuntime-"))
  try {
    mkdirSync(path.join(fixtureRoot, "scripts"), { recursive: true })
    mkdirSync(path.join(fixtureRoot, "docs"), { recursive: true })
    writeFileSync(
      path.join(fixtureRoot, "docs/observability-inventory.json"),
      JSON.stringify({
        version: 1,
        entries: [
          {
            pathPrefix: "scripts/",
            status: "instrumented",
            rationale: "fixture expects rejection when aliased NodeRuntime entrypoint is non-boundary"
          }
        ]
      })
    )
    writeFileSync(
      path.join(fixtureRoot, "scripts/aliased-entrypoint.ts"),
      [
        'import * as Runtime from "@effect/platform-node/NodeRuntime"',
        'import * as Effect from "effect"',
        "Runtime.runMain(Effect.never)"
      ].join("\n")
    )

    const failResult = spawnSync(process.execPath, ["scripts/check-observability-coverage.mjs"], {
      cwd: root,
      encoding: "utf8",
      env: {
        ...process.env,
        MCP_EFFECT_OBSERVABILITY_ROOT: fixtureRoot
      }
    })

    assert.equal(
      failResult.status,
      1,
      `aliased NodeRuntime entrypoint in non-boundary file should fail the gate: ${failResult.stderr || failResult.stdout}`
    )
  } finally {
    rmSync(fixtureRoot, { recursive: true, force: true })
  }

  const boundaryFixtureRoot = mkdtempSync(path.join(tmpdir(), "obs-coverage-noderuntime-ok-"))
  try {
    mkdirSync(path.join(boundaryFixtureRoot, "scripts"), { recursive: true })
    mkdirSync(path.join(boundaryFixtureRoot, "docs"), { recursive: true })
    writeFileSync(
      path.join(boundaryFixtureRoot, "docs/observability-inventory.json"),
      JSON.stringify({
        version: 1,
        entries: [
          {
            pathPrefix: "scripts/",
            status: "coveredByParentBoundary",
            rationale: "fixture boundary permits NodeRuntime entrypoint"
          }
        ]
      })
    )
    writeFileSync(
      path.join(boundaryFixtureRoot, "scripts/aliased-entrypoint.ts"),
      ['import * as Runtime from "@effect/platform-node/NodeRuntime"', "Runtime.runFork(Promise.resolve(1))"].join("\n")
    )

    const passResult = spawnSync(process.execPath, ["scripts/check-observability-coverage.mjs"], {
      cwd: root,
      encoding: "utf8",
      env: {
        ...process.env,
        MCP_EFFECT_OBSERVABILITY_ROOT: boundaryFixtureRoot
      }
    })

    assert.equal(
      passResult.status,
      0,
      `boundary classification should pass with aliased NodeRuntime entrypoint: ${passResult.stderr || passResult.stdout}`
    )
  } finally {
    rmSync(boundaryFixtureRoot, { recursive: true, force: true })
  }
})

test("coverage gate recognizes aliased NodeRuntime imports from @effect/platform/NodeRuntime", () => {
  const fixtureRoot = mkdtempSync(path.join(tmpdir(), "obs-coverage-nodeplatform-"))
  try {
    mkdirSync(path.join(fixtureRoot, "scripts"), { recursive: true })
    mkdirSync(path.join(fixtureRoot, "docs"), { recursive: true })
    writeFileSync(
      path.join(fixtureRoot, "docs/observability-inventory.json"),
      JSON.stringify({
        version: 1,
        entries: [
          {
            pathPrefix: "scripts/",
            status: "coveredByParentBoundary",
            rationale: "boundary permits platform NodeRuntime alias entrypoint"
          }
        ]
      })
    )
    writeFileSync(
      path.join(fixtureRoot, "scripts/aliased-entrypoint.ts"),
      ['import * as Runtime from "@effect/platform/NodeRuntime"', "Runtime.runFork(Promise.resolve(1))"].join("\n")
    )

    const passResult = spawnSync(process.execPath, ["scripts/check-observability-coverage.mjs"], {
      cwd: root,
      encoding: "utf8",
      env: {
        ...process.env,
        MCP_EFFECT_OBSERVABILITY_ROOT: fixtureRoot
      }
    })

    assert.equal(
      passResult.status,
      0,
      `coverage gate should recognize alias for @effect/platform/NodeRuntime: ${passResult.stderr || passResult.stdout}`
    )
  } finally {
    rmSync(fixtureRoot, { recursive: true, force: true })
  }
})

test("coverage gate catches named-effect import aliases used as entrypoints", () => {
  const fixtureRoot = mkdtempSync(path.join(tmpdir(), "obs-coverage-named-alias-"))
  try {
    mkdirSync(path.join(fixtureRoot, "scripts"), { recursive: true })
    mkdirSync(path.join(fixtureRoot, "docs"), { recursive: true })
    writeFileSync(
      path.join(fixtureRoot, "docs/observability-inventory.json"),
      JSON.stringify({
        version: 1,
        entries: [
          {
            pathPrefix: "scripts/",
            status: "coveredByParentBoundary",
            rationale: "boundary test for named import alias entrypoint"
          }
        ]
      })
    )
    writeFileSync(
      path.join(fixtureRoot, "scripts/aliased-entrypoint.ts"),
      ['import { runMain as boot } from "@effect/platform-node/NodeRuntime"', "boot(Promise.resolve(1))"].join("\n")
    )

    const passResult = spawnSync(process.execPath, ["scripts/check-observability-coverage.mjs"], {
      cwd: root,
      encoding: "utf8",
      env: {
        ...process.env,
        MCP_EFFECT_OBSERVABILITY_ROOT: fixtureRoot
      }
    })

    assert.equal(
      passResult.status,
      0,
      `named alias import should be recognized as effect entrypoint: ${passResult.stderr || passResult.stdout}`
    )
  } finally {
    rmSync(fixtureRoot, { recursive: true, force: true })
  }
})

test("coverage gate catches named aliases from effect module", () => {
  const fixtureRoot = mkdtempSync(path.join(tmpdir(), "obs-coverage-effect-named-alias-"))
  try {
    mkdirSync(path.join(fixtureRoot, "scripts"), { recursive: true })
    mkdirSync(path.join(fixtureRoot, "docs"), { recursive: true })
    writeFileSync(
      path.join(fixtureRoot, "docs/observability-inventory.json"),
      JSON.stringify({
        version: 1,
        entries: [
          {
            pathPrefix: "scripts/",
            status: "rootOnly",
            rationale: "effect named alias should still be recognized"
          }
        ]
      })
    )
    writeFileSync(
      path.join(fixtureRoot, "scripts/aliased-entrypoint.ts"),
      ['import { runPromise as execute } from "effect"', "execute(Promise.resolve(1))"].join("\n")
    )

    const passResult = spawnSync(process.execPath, ["scripts/check-observability-coverage.mjs"], {
      cwd: root,
      encoding: "utf8",
      env: {
        ...process.env,
        MCP_EFFECT_OBSERVABILITY_ROOT: fixtureRoot
      }
    })

    assert.equal(
      passResult.status,
      0,
      `named import alias from effect should be recognized: ${passResult.stderr || passResult.stdout}`
    )
  } finally {
    rmSync(fixtureRoot, { recursive: true, force: true })
  }
})

test("coverage gate does not treat runPromise from non-effect modules as an effect entrypoint", () => {
  const fixtureRoot = mkdtempSync(path.join(tmpdir(), "obs-coverage-runpromise-non-effect-"))
  try {
    mkdirSync(path.join(fixtureRoot, "scripts"), { recursive: true })
    mkdirSync(path.join(fixtureRoot, "docs"), { recursive: true })
    writeFileSync(
      path.join(fixtureRoot, "docs/observability-inventory.json"),
      JSON.stringify({
        version: 1,
        entries: [
          {
            pathPrefix: "scripts/",
            status: "instrumented",
            rationale: "non-effect runPromise should not trigger effect entrypoint classification"
          }
        ]
      })
    )
    writeFileSync(
      path.join(fixtureRoot, "scripts/non-effect-runpromise.ts"),
      ['import { runPromise } from "unrelated/module"', "runPromise(() => Promise.resolve(1))"].join("\n")
    )

    const result = spawnSync(process.execPath, ["scripts/check-observability-coverage.mjs"], {
      cwd: root,
      encoding: "utf8",
      env: {
        ...process.env,
        MCP_EFFECT_OBSERVABILITY_ROOT: fixtureRoot
      }
    })

    assert.equal(
      result.status,
      0,
      `unrelated runPromise import should not be treated as effect entrypoint: ${result.stderr || result.stdout}`
    )
  } finally {
    rmSync(fixtureRoot, { recursive: true, force: true })
  }
})

test("coverage gate follows local aliases of effect namespace imports for entrypoint detection", () => {
  const fixtureRoot = mkdtempSync(path.join(tmpdir(), "obs-coverage-namespace-alias-"))
  try {
    mkdirSync(path.join(fixtureRoot, "scripts"), { recursive: true })
    mkdirSync(path.join(fixtureRoot, "docs"), { recursive: true })
    writeFileSync(
      path.join(fixtureRoot, "docs/observability-inventory.json"),
      JSON.stringify({
        version: 1,
        entries: [
          {
            pathPrefix: "scripts/",
            status: "coveredByParentBoundary",
            rationale: "aliasing a namespace import should still be treated as entrypoint"
          }
        ]
      })
    )
    writeFileSync(
      path.join(fixtureRoot, "scripts/aliased-entrypoint.ts"),
      [
        'import * as Runtime from "@effect/platform-node/NodeRuntime"',
        "const AliasedRuntime = Runtime",
        "const { runFork } = Runtime",
        "AliasedRuntime.runFork(Promise.resolve(1))",
        "runFork(Promise.resolve(1))"
      ].join("\n")
    )

    const result = spawnSync(process.execPath, ["scripts/check-observability-coverage.mjs"], {
      cwd: root,
      encoding: "utf8",
      env: {
        ...process.env,
        MCP_EFFECT_OBSERVABILITY_ROOT: fixtureRoot
      }
    })

    assert.equal(
      result.status,
      0,
      `namespace aliasing should allow effect entrypoint recognition: ${result.stderr || result.stdout}`
    )
  } finally {
    rmSync(fixtureRoot, { recursive: true, force: true })
  }
})

test("coverage gate follows chained local aliases of effect namespace imports", () => {
  const fixtureRoot = mkdtempSync(path.join(tmpdir(), "obs-coverage-namespace-alias-chain-"))
  try {
    mkdirSync(path.join(fixtureRoot, "scripts"), { recursive: true })
    mkdirSync(path.join(fixtureRoot, "docs"), { recursive: true })
    writeFileSync(
      path.join(fixtureRoot, "docs/observability-inventory.json"),
      JSON.stringify({
        version: 1,
        entries: [
          {
            pathPrefix: "scripts/",
            status: "rootOnly",
            rationale: "chained namespace alias should still be recognized as entrypoint owner"
          }
        ]
      })
    )
    writeFileSync(
      path.join(fixtureRoot, "scripts/aliased-entrypoint.ts"),
      [
        'import * as Runtime from "@effect/platform-node/NodeRuntime"',
        "const runtimeAlias = Runtime",
        "const runtimeAliasChain = runtimeAlias",
        "runtimeAliasChain.runFork(Promise.resolve(1))"
      ].join("\n")
    )

    const result = spawnSync(process.execPath, ["scripts/check-observability-coverage.mjs"], {
      cwd: root,
      encoding: "utf8",
      env: {
        ...process.env,
        MCP_EFFECT_OBSERVABILITY_ROOT: fixtureRoot
      }
    })

    assert.equal(result.status, 0, `chained namespace aliasing should be recognized: ${result.stderr || result.stdout}`)
  } finally {
    rmSync(fixtureRoot, { recursive: true, force: true })
  }
})

test("coverage gate ignores type-only imports when detecting effect entrypoints", () => {
  const fixtureRoot = mkdtempSync(path.join(tmpdir(), "obs-coverage-type-only-import-"))
  try {
    mkdirSync(path.join(fixtureRoot, "scripts"), { recursive: true })
    mkdirSync(path.join(fixtureRoot, "docs"), { recursive: true })
    writeFileSync(
      path.join(fixtureRoot, "docs/observability-inventory.json"),
      JSON.stringify({
        version: 1,
        entries: [
          {
            pathPrefix: "scripts/",
            status: "instrumented",
            rationale: "type-only imports should not classify as runtime entrypoints"
          }
        ]
      })
    )
    writeFileSync(
      path.join(fixtureRoot, "scripts/type-only-entrypoint.ts"),
      ['import type { runPromise as typedRun } from "effect"', "typedRun(Promise.resolve(1))"].join("\n")
    )

    const result = spawnSync(process.execPath, ["scripts/check-observability-coverage.mjs"], {
      cwd: root,
      encoding: "utf8",
      env: {
        ...process.env,
        MCP_EFFECT_OBSERVABILITY_ROOT: fixtureRoot
      }
    })

    assert.equal(
      result.status,
      0,
      `type-only imports should not trigger effect-entrypoint classification: ${result.stderr || result.stdout}`
    )
  } finally {
    rmSync(fixtureRoot, { recursive: true, force: true })
  }
})

test("observability inventory captures quarantined folders with a prerequisite", () => {
  const required = ["examples/task-heavy/", "examples/typescript-sdk-ports/"]
  for (const prefix of required) {
    const entry = quarantineEntries.find((candidate) => candidate.pathPrefix === prefix)
    assert.ok(entry, `missing quarantined entry for ${prefix}`)
    assert.ok(
      typeof entry.prerequisite === "string" && entry.prerequisite.length > 0,
      `quarantined entry for ${prefix} must include prerequisite`
    )
  }
})

test("observability inventory uses only supported coverage statuses", () => {
  const allowed = new Set([
    "instrumented",
    "coveredByParentBoundary",
    "rootOnly",
    "generated",
    "pureExempt",
    "quarantined"
  ])
  for (const entry of inventory.entries ?? []) {
    assert.ok(allowed.has(entry.status), `unknown status ${entry.status} for ${entry.pathPrefix}`)
    assert.equal(typeof entry.pathPrefix, "string", `missing pathPrefix for ${JSON.stringify(entry)}`)
    assert.ok(entry.pathPrefix.length > 0, `empty pathPrefix is not allowed`)
  }
})

test("observability inventory preserves required metadata by status and path", () => {
  const seenPrefixes = new Set()
  for (const entry of inventory.entries ?? []) {
    assert.equal(typeof entry.pathPrefix, "string", `pathPrefix must be a string: ${JSON.stringify(entry)}`)
    assert.equal(entry.pathPrefix.length > 0, true, `pathPrefix must not be empty: ${JSON.stringify(entry)}`)
    assert.equal(seenPrefixes.has(entry.pathPrefix), false, `duplicate pathPrefix ${entry.pathPrefix}`)
    seenPrefixes.add(entry.pathPrefix)

    if (entry.status === "pureExempt" || entry.status === "generated") {
      assert.equal(
        typeof entry.rationale,
        "string",
        `${entry.pathPrefix} requires a rationale for status ${entry.status}`
      )
      assert.equal(entry.rationale.length > 0, true, `${entry.pathPrefix} rationale must be non-empty`)
    }
    if (entry.status === "quarantined") {
      assert.equal(
        typeof entry.prerequisite,
        "string",
        `${entry.pathPrefix} requires a prerequisite for quarantined status`
      )
      assert.equal(entry.prerequisite.length > 0, true, `${entry.pathPrefix} prerequisite must be non-empty`)
    }
  }
})

test("observability coverage gate script uses NodeRuntime.runMain and no process exit", () => {
  const source = readScriptSource("scripts/check-observability-coverage.mjs")
  assert.equal(
    source.includes("NodeRuntime.runMain"),
    true,
    "check-observability-coverage should execute via NodeRuntime.runMain"
  )
  assert.equal(
    source.includes("process.exit("),
    false,
    "check-observability-coverage should not call process.exit directly"
  )
})

test("migrated script-level typecheck checks use NodeRuntime.runMain and no process.exit", () => {
  const targets = [
    "scripts/check-stdio-types.mjs",
    "scripts/check-http-client-types.mjs",
    "scripts/check-http-metadata-types.mjs",
    "scripts/check-http-server-types.mjs"
  ]
  for (const target of targets) {
    const source = readScriptSource(target)
    assert.equal(source.includes("NodeRuntime.runMain"), true, `${target} should execute via NodeRuntime.runMain`)
    assert.equal(source.includes("process.exit("), false, `${target} should not call process.exit directly`)
  }
})

test("migrated suite-level run scripts use NodeRuntime.runMain and no process.exit", () => {
  // scripts/run-conformance-authorization.mjs is exempt from the no-process.exit
  // assertion only: it wires runScript/NodeRuntime.runMain normally but supplies a
  // custom teardown that calls process.exit on every outcome, because its
  // output-lifecycle matrix (.superpowers/sdd/task-6f-output-lifecycle-matrix.md)
  // requires an explicit exit code even on success, which runMain's default
  // teardown does not provide. See the matching entry in
  // observability-contracts.test.mjs's SCRIPT_ENTRYPOINT_EXEMPTIONS map.
  const PROCESS_EXIT_EXEMPT = new Set(["scripts/run-conformance-authorization.mjs"])
  const runScripts = readdirSync(path.join(root, "scripts"))
    .filter((name) => /^run-.*\.mjs$/.test(name))
    .map((name) => `scripts/${name}`)
    .sort()
  for (const target of runScripts) {
    const source = readScriptSource(target)
    assert.equal(source.includes("NodeRuntime.runMain"), true, `${target} should execute via NodeRuntime.runMain`)
    if (!PROCESS_EXIT_EXEMPT.has(target)) {
      assert.equal(source.includes("process.exit("), false, `${target} should not call process.exit directly`)
    }
    assert.equal(source.includes("runScript("), true, `${target} should use the shared runScript boundary`)
  }
})

test("migrated top-level script entrypoints use NodeRuntime.runMain and runScript", () => {
  // scripts/release-via-tag.mjs and scripts/check-source-snapshots.mjs are
  // deliberately excluded from this list: both must run with zero installed
  // dependencies (ships in the unpacked npm tarball /
  // test/packaging/wp5h-packed-core-consumer.test.mjs, and copied into an
  // isolated git-only workspace / test/source-refresh.integration.test.mjs,
  // respectively), so neither can import effect/NodeRuntime and neither is a
  // "migrated" runScript-boundary script. See the matching entries in
  // observability-contracts.test.mjs's SCRIPT_ENTRYPOINT_EXEMPTIONS map.
  const migratedScripts = [
    "scripts/verify.mjs",
    "scripts/verify-conformance.mjs",
    "scripts/sync-github-labels.mjs",
    "scripts/check-dispatcher-types.mjs",
    "scripts/check-wire-types.mjs",
    "scripts/check-type-fixtures.mjs",
    "scripts/check-effect-foundation.mjs",
    "scripts/check-historical-mcp-cleanup.mjs",
    "scripts/check-extension-boundary.mjs",
    "scripts/check-sdk-workflow.mjs",
    "scripts/check-ts-sdk-parity.mjs",
    "scripts/check-tier-protocol-features.mjs",
    "scripts/check-tier-operations.mjs",
    "scripts/check-conformance-evidence.mjs",
    "scripts/check-sdk-readiness-requirements.mjs",
    "scripts/report-conformance-failures.mjs",
    "scripts/generate-mcp.mjs",
    "scripts/generate-docs-coverage.mjs",
    "scripts/generate-tier-maintenance.mjs",
    "scripts/generate-release-provenance.mjs",
    "scripts/generate-conformance-composite.mjs",
    "scripts/verify-apps-ide-lanes.mjs",
    "scripts/vendor-effect.mjs",
    "scripts/refresh-source-snapshot.mjs",
    "scripts/check-effect-lsp.mjs"
  ]
  for (const target of migratedScripts) {
    const source = readScriptSource(target)
    assert.equal(source.includes("NodeRuntime.runMain"), true, `${target} should execute via NodeRuntime.runMain`)
    assert.equal(source.includes("runScript("), true, `${target} should use the shared runScript boundary`)
    assert.equal(source.includes("process.exit("), false, `${target} should not call process.exit directly`)
  }
})

test("package-script entrypoint aliases route through run-script-entrypoint", () => {
  const expectedRunner = "node scripts/run-script-entrypoint.mjs"
  const sharedEntrypoints = [
    { name: "check:effect-lsp", target: "scripts/check-effect-lsp.mjs" },
    { name: "check:agent-evidence", target: "scripts/check-agent-evidence.mjs" },
    { name: "check:generated-protocol-surfaces", target: "scripts/check-generated-protocol-surfaces.mjs" },
    { name: "check:schema-fixtures", target: "scripts/check-generated-schema-fixtures.mjs" },
    { name: "check:sdk-runtime", target: "scripts/check-sdk-runtime.mjs" },
    { name: "check:tasks", target: "scripts/check-task-runtime.mjs" },
    { name: "check:tier-relegation", target: "scripts/check-tier-relegation.mjs" },
    { name: "verify:published-package", target: "scripts/verify-published-package.mjs" }
  ]

  for (const { name, target } of sharedEntrypoints) {
    const expected = `${expectedRunner} ${target} ${name}`
    const command = packageScripts[name]
    assert.equal(typeof command, "string", `${name} must still be configured in package scripts`)
    assert.equal(command, expected, `${name} must run through the shared script entrypoint runner`)
  }

  const runnerSource = readScriptSource("scripts/run-script-entrypoint.mjs")
  assert.equal(
    runnerSource.includes("NodeRuntime.runMain"),
    true,
    "run-script-entrypoint should use NodeRuntime.runMain"
  )
  assert.equal(
    runnerSource.includes("runScript("),
    true,
    "run-script-entrypoint should use the shared runScript boundary"
  )
  assert.equal(
    runnerSource.includes("process.exit("),
    false,
    "run-script-entrypoint should not call process.exit directly"
  )
  assert.equal(
    runnerSource.includes("process.exitCode"),
    false,
    "run-script-entrypoint should not set process exitCode directly"
  )
})

test("run-script-entrypoint preserves delegated script arguments", () => {
  const fixtureDir = mkdtempSync(path.join(tmpdir(), "run-script-entrypoint-args-"))
  const fixturePath = path.join(fixtureDir, "argv-fixture.mjs")
  const outputPath = path.join(fixtureDir, "argv.log")

  try {
    writeFileSync(
      fixturePath,
      [
        'import { writeFileSync } from "node:fs"',
        `writeFileSync(${JSON.stringify(outputPath)}, process.argv.slice(2).join("|"))`,
        "export const ok = true\n"
      ].join("\n")
    )

    const withLabel = spawnSync(
      process.execPath,
      ["scripts/run-script-entrypoint.mjs", fixturePath, "check:fixture", "alpha", "beta"],
      {
        cwd: root,
        encoding: "utf8"
      }
    )
    assert.equal(
      withLabel.status,
      0,
      `run-script-entrypoint failed with labeled args: ${withLabel.stderr || withLabel.stdout}`
    )
    assert.equal(readFileSync(outputPath, "utf8"), "alpha|beta")

    const withoutLabel = spawnSync(process.execPath, ["scripts/run-script-entrypoint.mjs", fixturePath], {
      cwd: root,
      encoding: "utf8"
    })
    assert.equal(
      withoutLabel.status,
      0,
      `run-script-entrypoint failed without label: ${withoutLabel.stderr || withoutLabel.stdout}`
    )
    assert.equal(readFileSync(outputPath, "utf8"), "")
  } finally {
    rmSync(fixtureDir, { recursive: true, force: true })
  }
})

test("coverage gate rejects invalid inventory status codes", () => {
  const fixtureRoot = mkdtempSync(path.join(tmpdir(), "obs-coverage-invalid-status-"))
  try {
    mkdirSync(path.join(fixtureRoot, "src"), { recursive: true })
    mkdirSync(path.join(fixtureRoot, "docs"), { recursive: true })
    writeFileSync(
      path.join(fixtureRoot, "docs/observability-inventory.json"),
      JSON.stringify({
        version: 1,
        entries: [
          {
            pathPrefix: "src/",
            status: "not-a-real-status"
          }
        ]
      })
    )
    writeFileSync(path.join(fixtureRoot, "src/entrypoint.ts"), 'console.log("no entrypoint")')

    const result = spawnSync(process.execPath, ["scripts/check-observability-coverage.mjs"], {
      cwd: root,
      encoding: "utf8",
      env: {
        ...process.env,
        MCP_EFFECT_OBSERVABILITY_ROOT: fixtureRoot
      }
    })

    assert.equal(result.status, 1, `invalid status should fail: ${result.stderr || result.stdout}`)
  } finally {
    rmSync(fixtureRoot, { recursive: true, force: true })
  }
})

test("coverage gate rejects pureExempt entries without rationale", () => {
  const fixtureRoot = mkdtempSync(path.join(tmpdir(), "obs-coverage-pure-exempt-"))
  try {
    mkdirSync(path.join(fixtureRoot, "src"), { recursive: true })
    mkdirSync(path.join(fixtureRoot, "docs"), { recursive: true })
    writeFileSync(
      path.join(fixtureRoot, "docs/observability-inventory.json"),
      JSON.stringify({
        version: 1,
        entries: [
          {
            pathPrefix: "src/",
            status: "pureExempt"
          }
        ]
      })
    )
    writeFileSync(path.join(fixtureRoot, "src/entrypoint.ts"), 'console.log("not effect code")')

    const result = spawnSync(process.execPath, ["scripts/check-observability-coverage.mjs"], {
      cwd: root,
      encoding: "utf8",
      env: {
        ...process.env,
        MCP_EFFECT_OBSERVABILITY_ROOT: fixtureRoot
      }
    })

    assert.equal(result.status, 1, `missing rationale should fail: ${result.stderr || result.stdout}`)
  } finally {
    rmSync(fixtureRoot, { recursive: true, force: true })
  }
})

test("coverage gate rejects generated entries without rationale", () => {
  const fixtureRoot = mkdtempSync(path.join(tmpdir(), "obs-coverage-generated-no-rationale-"))
  try {
    mkdirSync(path.join(fixtureRoot, "src"), { recursive: true })
    mkdirSync(path.join(fixtureRoot, "docs"), { recursive: true })
    writeFileSync(
      path.join(fixtureRoot, "docs/observability-inventory.json"),
      JSON.stringify({
        version: 1,
        entries: [
          {
            pathPrefix: "src/",
            status: "generated"
          }
        ]
      })
    )
    writeFileSync(path.join(fixtureRoot, "src/entrypoint.ts"), 'console.log("generated-ish")')

    const result = spawnSync(process.execPath, ["scripts/check-observability-coverage.mjs"], {
      cwd: root,
      encoding: "utf8",
      env: {
        ...process.env,
        MCP_EFFECT_OBSERVABILITY_ROOT: fixtureRoot
      }
    })

    assert.equal(result.status, 1, `missing rationale should fail: ${result.stderr || result.stdout}`)
  } finally {
    rmSync(fixtureRoot, { recursive: true, force: true })
  }
})

test("coverage gate rejects quarantined entries without prerequisite", () => {
  const fixtureRoot = mkdtempSync(path.join(tmpdir(), "obs-coverage-quarantine-prereq-"))
  try {
    mkdirSync(path.join(fixtureRoot, "src"), { recursive: true })
    mkdirSync(path.join(fixtureRoot, "docs"), { recursive: true })
    writeFileSync(
      path.join(fixtureRoot, "docs/observability-inventory.json"),
      JSON.stringify({
        version: 1,
        entries: [
          {
            pathPrefix: "src/",
            status: "quarantined",
            rationale: "Needs rework"
          }
        ]
      })
    )
    writeFileSync(path.join(fixtureRoot, "src/entrypoint.ts"), 'console.log("quarantine")')

    const result = spawnSync(process.execPath, ["scripts/check-observability-coverage.mjs"], {
      cwd: root,
      encoding: "utf8",
      env: {
        ...process.env,
        MCP_EFFECT_OBSERVABILITY_ROOT: fixtureRoot
      }
    })

    assert.equal(result.status, 1, `missing prerequisite should fail: ${result.stderr || result.stdout}`)
  } finally {
    rmSync(fixtureRoot, { recursive: true, force: true })
  }
})

test("coverage gate rejects stale inventory entries", () => {
  const fixtureRoot = mkdtempSync(path.join(tmpdir(), "obs-coverage-stale-entry-"))
  try {
    mkdirSync(path.join(fixtureRoot, "src"), { recursive: true })
    mkdirSync(path.join(fixtureRoot, "docs"), { recursive: true })
    writeFileSync(path.join(fixtureRoot, "src/entrypoint.ts"), 'console.log("active")')
    writeFileSync(
      path.join(fixtureRoot, "docs/observability-inventory.json"),
      JSON.stringify({
        version: 1,
        entries: [
          {
            pathPrefix: "legacy/",
            status: "instrumented",
            rationale: "Orphaned rule"
          },
          {
            pathPrefix: "src/",
            status: "coveredByParentBoundary",
            rationale: "Tracked root"
          }
        ]
      })
    )

    const result = spawnSync(process.execPath, ["scripts/check-observability-coverage.mjs"], {
      cwd: root,
      encoding: "utf8",
      env: {
        ...process.env,
        MCP_EFFECT_OBSERVABILITY_ROOT: fixtureRoot
      }
    })

    assert.equal(result.status, 1, `stale entry should fail: ${result.stderr || result.stdout}`)
  } finally {
    rmSync(fixtureRoot, { recursive: true, force: true })
  }
})

test("coverage gate rejects missing coverage classification for tracked files", () => {
  const fixtureRoot = mkdtempSync(path.join(tmpdir(), "obs-coverage-missing-classification-"))
  try {
    mkdirSync(path.join(fixtureRoot, "src"), { recursive: true })
    mkdirSync(path.join(fixtureRoot, "docs"), { recursive: true })
    writeFileSync(
      path.join(fixtureRoot, "docs/observability-inventory.json"),
      JSON.stringify({
        version: 1,
        entries: []
      })
    )
    writeFileSync(path.join(fixtureRoot, "src/unclassified.ts"), 'console.log("unknown")')

    const result = spawnSync(process.execPath, ["scripts/check-observability-coverage.mjs"], {
      cwd: root,
      encoding: "utf8",
      env: {
        ...process.env,
        MCP_EFFECT_OBSERVABILITY_ROOT: fixtureRoot
      }
    })

    assert.equal(result.status, 1, `missing classification should fail: ${result.stderr || result.stdout}`)
  } finally {
    rmSync(fixtureRoot, { recursive: true, force: true })
  }
})

test("coverage gate rejects invalid inventory version", () => {
  const fixtureRoot = mkdtempSync(path.join(tmpdir(), "obs-coverage-inventory-version-"))
  try {
    mkdirSync(path.join(fixtureRoot, "docs"), { recursive: true })
    writeFileSync(
      path.join(fixtureRoot, "docs/observability-inventory.json"),
      JSON.stringify({
        version: 2,
        entries: []
      })
    )

    const result = spawnSync(process.execPath, ["scripts/check-observability-coverage.mjs"], {
      cwd: root,
      encoding: "utf8",
      env: {
        ...process.env,
        MCP_EFFECT_OBSERVABILITY_ROOT: fixtureRoot
      }
    })

    assert.equal(result.status, 1, `wrong version should fail: ${result.stderr || result.stdout}`)
  } finally {
    rmSync(fixtureRoot, { recursive: true, force: true })
  }
})

test("coverage gate applies longest-prefix inventory rule before fallback", () => {
  const fixtureRoot = mkdtempSync(path.join(tmpdir(), "obs-coverage-longest-prefix-"))
  try {
    mkdirSync(path.join(fixtureRoot, "src"), { recursive: true })
    mkdirSync(path.join(fixtureRoot, "src/generated"), { recursive: true })
    mkdirSync(path.join(fixtureRoot, "docs"), { recursive: true })

    writeFileSync(
      path.join(fixtureRoot, "docs/observability-inventory.json"),
      JSON.stringify({
        version: 1,
        entries: [
          {
            pathPrefix: "src/",
            status: "instrumented",
            rationale: "Fallback bucket"
          },
          {
            pathPrefix: "src/generated/",
            status: "generated",
            rationale: "Generated code bucket"
          }
        ]
      })
    )

    writeFileSync(
      path.join(fixtureRoot, "src/generated/entrypoint.ts"),
      ['import * as Effect from "effect"', "Effect.runPromise(Effect.succeed(1))"].join("\n")
    )

    const result = spawnSync(process.execPath, ["scripts/check-observability-coverage.mjs"], {
      cwd: root,
      encoding: "utf8",
      env: {
        ...process.env,
        MCP_EFFECT_OBSERVABILITY_ROOT: fixtureRoot
      }
    })

    assert.equal(
      result.status,
      1,
      `longest-prefix should classify generated file as non-boundary when effect entrypoint exists: ${result.stderr || result.stdout}`
    )
  } finally {
    rmSync(fixtureRoot, { recursive: true, force: true })
  }
})

test("coverage gate prefers deeper file-specific override over parent quarantined bucket", () => {
  const fixtureRoot = mkdtempSync(path.join(tmpdir(), "obs-coverage-specific-override-"))
  try {
    mkdirSync(path.join(fixtureRoot, "examples"), { recursive: true })
    mkdirSync(path.join(fixtureRoot, "examples/typescript-sdk-ports"), { recursive: true })
    mkdirSync(path.join(fixtureRoot, "docs"), { recursive: true })

    writeFileSync(
      path.join(fixtureRoot, "docs/observability-inventory.json"),
      JSON.stringify({
        version: 1,
        entries: [
          {
            pathPrefix: "examples/",
            status: "coveredByParentBoundary",
            rationale: "Fallback examples bucket"
          },
          {
            pathPrefix: "examples/typescript-sdk-ports/",
            status: "quarantined",
            rationale: "Example group quarantined",
            prerequisite: "Re-author to current SDK"
          },
          {
            pathPrefix: "examples/typescript-sdk-ports/smoke.ts",
            status: "rootOnly",
            rationale: "Smoke harness is an explicit root boundary"
          }
        ]
      })
    )

    writeFileSync(
      path.join(fixtureRoot, "examples/typescript-sdk-ports/smoke.ts"),
      ['import * as Fx from "effect"', "Fx.runMain(Fx.sleep(1))"].join("\n")
    )

    const result = spawnSync(process.execPath, ["scripts/check-observability-coverage.mjs"], {
      cwd: root,
      encoding: "utf8",
      env: {
        ...process.env,
        MCP_EFFECT_OBSERVABILITY_ROOT: fixtureRoot
      }
    })

    assert.equal(
      result.status,
      0,
      `specific override should allow boundary status on quarantined subtree file: ${result.stderr || result.stdout}`
    )
  } finally {
    rmSync(fixtureRoot, { recursive: true, force: true })
  }
})

test("coverage gate does not treat type-only entrypoint imports as runtime calls", () => {
  const fixtureRoot = mkdtempSync(path.join(tmpdir(), "obs-coverage-type-only-runtime-call-"))
  try {
    mkdirSync(path.join(fixtureRoot, "scripts"), { recursive: true })
    mkdirSync(path.join(fixtureRoot, "docs"), { recursive: true })
    writeFileSync(
      path.join(fixtureRoot, "docs/observability-inventory.json"),
      JSON.stringify({
        version: 1,
        entries: [
          {
            pathPrefix: "scripts/",
            status: "rootOnly",
            rationale: "root scripts allowed"
          }
        ]
      })
    )
    writeFileSync(
      path.join(fixtureRoot, "scripts/type-only-entrypoint.ts"),
      ['import type * as Fx from "effect"', "Fx.runPromise(Fx.succeed(1))"].join("\n")
    )

    const result = spawnSync(process.execPath, ["scripts/check-observability-coverage.mjs"], {
      cwd: root,
      encoding: "utf8",
      env: {
        ...process.env,
        MCP_EFFECT_OBSERVABILITY_ROOT: fixtureRoot
      }
    })

    assert.equal(
      result.status,
      0,
      `type-only import should not be treated as runtime entrypoint: ${result.stderr || result.stdout}`
    )
  } finally {
    rmSync(fixtureRoot, { recursive: true, force: true })
  }
})
