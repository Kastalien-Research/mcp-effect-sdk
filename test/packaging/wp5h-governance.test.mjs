import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { test } from "node:test"

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..")
const read = (relative) => readFileSync(path.join(root, relative), "utf8")
const packageJson = JSON.parse(read("package.json"))

const focused = {
  "test:wp5-results": [
    "test/core/wp5-result-metadata.test.mjs",
    "test/client/wp5-result-decoding.test.mjs",
    "test/types/wp5-core-result/tsconfig.json"
  ],
  "test:wp5-construction": [
    "test/client/wp5b-client-construction.test.mjs",
    "test/server/wp5b-server-construction.test.mjs",
    "test/types/wp5b-client-construction/tsconfig.json",
    "test/types/wp5b-server-construction/tsconfig.json"
  ],
  "test:wp5-json-schema": [
    "test/schema/wp5c-json-schema.test.mjs",
    "test/server/wp5c-tool-output-schema.test.mjs",
    "test/types/wp5c-json-schema/tsconfig.json"
  ],
  "test:wp5-pagination-cache": [
    "test/server/wp5d-pagination.test.mjs",
    "test/client/wp5d-cache.test.mjs",
    "test/http/wp5d-http-catalog.test.mjs",
    "test/types/wp5d-pagination-cache/tsconfig.json"
  ],
  "test:wp5-progress-cancellation": [
    "test/server/wp5e-progress-cancellation.test.mjs",
    "test/client/wp5e-progress-cancellation.test.mjs",
    "test/types/wp5e-progress-cancellation/tsconfig.json"
  ],
  "test:wp5-input-required": [
    "test/client/wp5f-input-required.test.mjs",
    "test/server/wp5f-input-required.test.mjs",
    "test/security/wp5f-request-state.test.mjs",
    "test/types/wp5f-input-required/tsconfig.json",
    "test/types/wp5f-request-state/tsconfig.json"
  ],
  "test:wp5-subscriptions": [
    "test/client/wp5g-subscription.test.mjs",
    "test/types/wp5g-subscription/tsconfig.json"
  ],
  "test:wp5-deprecated": ["test/packaging/wp5h-deprecated-boundary.test.mjs"],
  "test:wp5-examples": ["test/packaging/wp5h-examples.test.mjs"],
  "test:wp5-package": [
    "test/packaging/wp5b-core-subpaths.test.mjs",
    "test/packaging/wp5h-governance.test.mjs",
    "test/packaging/wp5h-packed-core-consumer.test.mjs",
    "test/types/wp5b-core-subpaths/tsconfig.json",
    "test/types/wp5-core-public/tsconfig.json"
  ]
}

test("authoritative focused WP5 aliases invoke direct bounded files", () => {
  for (const [name, required] of Object.entries(focused)) {
    const command = packageJson.scripts[name]
    assert.equal(typeof command, "string", name)
    assert.match(command, /pnpm run build/, `${name} build`)
    for (const relative of required) assert.match(command, new RegExp(relative.replaceAll(".", "\\.")), `${name}: ${relative}`)
    for (const forbidden of [
      "test:wp5a", "test:wp5b", "test:wp5c", "test:wp5d", "test:wp5e", "test:wp5f-policy", "test:wp5g"
    ]) {
      assert.doesNotMatch(command, new RegExp(`pnpm run ${forbidden}(?:\\s|$)`), `${name}: ${forbidden}`)
    }
  }
})
test("test:wp5-core executes every focused alias exactly once", () => {
  const command = packageJson.scripts["test:wp5-core"]
  assert.equal(typeof command, "string")
  const invoked = [...command.matchAll(/pnpm run (test:wp5-[a-z-]+)/g)].map((match) => match[1])
  assert.deepEqual(invoked, Object.keys(focused))
  assert.equal(new Set(invoked).size, invoked.length)
})

test("verify owns the authoritative WP5 gate and not a stale partial aggregate", () => {
  const verify = read("scripts/verify.mjs")
  assert.match(verify, /\["pnpm", \["run", "test:wp5-core"\]\]/)
  assert.doesNotMatch(verify, /\["pnpm", \["run", "test:wp5e"\]\]/)
})

test("the deferred ledger distinguishes local WP5 implementation from later deferrals", () => {
  const ledger = JSON.parse(read("docs/conformance/ts-sdk-parity-deferred.json"))
  assert.equal(ledger.schemaVersion, 2)
  const [wp5, ...later] = ledger.items
  assert.equal(wp5.id, "wp5-core-feature-surface")
  assert.equal(wp5.status, "implemented-locally")
  assert.deepEqual(wp5.evidence, {
    report: ".superpowers/sdd/task-5-report.md",
    verificationCommands: ["pnpm run test:wp5-core", "pnpm run verify"],
    remoteIssueDisposition: "approval-required",
    qualification: "not-official-conformance-release-or-tier-evidence"
  })
  assert.deepEqual(later.map(({ workPackage, status }) => ({ workPackage, status })),
    ["WP6", "WP7", "WP8", "WP9", "WP10", "WP11"].map((workPackage) => ({
      workPackage,
      status: "deferred"
    })))
})

test("documentation records local completion without issue, conformance, release, or Tier overclaim", () => {
  assert.match(read("docs/draft-2026-07-28-migration.md"), /pnpm run test:wp5-core/)
  for (const relative of [
    "docs/conformance/scenario-map.md",
    "docs/conformance/sdk-tier-evidence.md"
  ]) {
    const source = read(relative)
    assert.match(source, /Local WP5 implementation is not remote issue closure\./)
  }
  const tier = read("docs/conformance/sdk-tier-evidence.md")
  assert.match(tier, /Tier 3\./)
  assert.match(tier, /not MCP conformance qualification/)
})
