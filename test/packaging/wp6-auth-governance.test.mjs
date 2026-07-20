import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import { mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs"
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
  const harness = JSON.parse(read("test/conformance/package.json"))
  assert.equal(harness.devDependencies["@modelcontextprotocol/conformance"], "0.2.0-alpha.9")
  assert.match(runner, /expectedConformanceVersion\s*=\s*["']0\.2\.0-alpha\.9["']/)
  assert.match(runner, /--spec-version["'],\s*["']2026-07-28["']/)
  assert.match(runner, /failureCount\s*===\s*0/)
  assert.match(runner, /warningClassifications/)
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

test("deprecated DCR fallback stays inside the stable auth client boundary", () => {
  const migration = read("docs/draft-2026-07-28-migration.md")
  assert.match(migration, /DCR[^\n]*deprecated fallback/i)
  assert.match(migration, /mcp-effect-sdk\/auth\/client/)
  for (const relative of ["src/examples/everything-client.ts", "src/index.ts"]) {
    assert.doesNotMatch(read(relative), /OAuthProviders|OAuthErrors|\bOAuth\b/)
  }
  assert.match(read("src/auth/client/registration.ts"), /application_type/)
})
