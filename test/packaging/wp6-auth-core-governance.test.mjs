import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import { readFileSync } from "node:fs"
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
  "test/packaging/wp6-auth-core-governance.test.mjs"
]

const expectedTypeFixtures = [
  "test/types/wp6-client-runtime/tsconfig.json",
  "test/types/wp6b-auth-public/tsconfig.json",
  "test/types/wp6-auth-protected-resource/tsconfig.json"
]

const count = (source, needle) => source.split(needle).length - 1

test("WP6 focused aliases and cumulative gate execute every owned core witness exactly once", () => {
  for (const alias of [...focusedAliases, "test:wp6"]) {
    assert.equal(typeof packageJson.scripts[alias], "string", `${alias} is missing`)
  }

  const focused = focusedAliases.map((alias) => packageJson.scripts[alias]).join("\n")
  for (const file of [...expectedRuntimeTests, ...expectedTypeFixtures]) {
    assert.equal(count(focused, file), 1, `${file} must occur exactly once across focused aliases`)
  }
  assert.equal(focused.includes("conformance:authorization"), false)
  assert.equal(focused.includes("wp6-auth-governance.test.mjs"), false)

  const cumulative = packageJson.scripts["test:wp6"]
  for (const alias of focusedAliases) {
    assert.equal(count(cumulative, `pnpm run ${alias}`), 1, `${alias} must occur once in test:wp6`)
  }
  for (const file of [...expectedRuntimeTests, ...expectedTypeFixtures]) {
    assert.equal(cumulative.includes(file), false, "test:wp6 must compose aliases rather than duplicate witnesses")
  }
})

test("verify runs WP6 once and requires complete official conformance", () => {
  const verify = read("scripts/verify.mjs")
  assert.match(verify, /\["pnpm", \["run", "test:wp5-core"\]\],\s*\["pnpm", \["run", "test:wp6"\]\]/)
  assert.equal(count(verify, '["pnpm", ["run", "test:wp6"]]'), 1)
  assert.equal(count(verify, '["pnpm", ["run", "verify:conformance"]]'), 1)
  assert.doesNotMatch(verify, /\["pnpm", \["run", "conformance:authorization"\]\]/)
})

test("focused client-auth evidence remains pinned and fail-closed", () => {
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
  }
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
