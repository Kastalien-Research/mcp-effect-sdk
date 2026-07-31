import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { test } from "node:test"

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..")
const read = (relative) => readFileSync(path.join(root, relative), "utf8")
const packageJson = JSON.parse(read("package.json"))

const focused = {
  "test:results": [
    "test/core/wp5-result-metadata.test.mjs",
    "test/client/wp5-result-decoding.test.mjs",
    "test/types/wp5-core-result/tsconfig.json"
  ],
  "test:construction": [
    "test/client/wp5b-client-construction.test.mjs",
    "test/server/wp5b-server-construction.test.mjs",
    "test/types/wp5b-client-construction/tsconfig.json",
    "test/types/wp5b-server-construction/tsconfig.json"
  ],
  "test:json-schema": [
    "test/schema/wp5c-json-schema.test.mjs",
    "test/server/wp5c-tool-output-schema.test.mjs",
    "test/types/wp5c-json-schema/tsconfig.json"
  ],
  "test:pagination-cache": [
    "test/server/wp5d-pagination.test.mjs",
    "test/client/wp5d-cache.test.mjs",
    "test/http/wp5d-http-catalog.test.mjs",
    "test/types/wp5d-pagination-cache/tsconfig.json"
  ],
  "test:progress-cancellation": [
    "test/server/wp5e-progress-cancellation.test.mjs",
    "test/client/wp5e-progress-cancellation.test.mjs",
    "test/types/wp5e-progress-cancellation/tsconfig.json"
  ],
  "test:input-required": [
    "test/client/wp5f-input-required.test.mjs",
    "test/server/wp5f-input-required.test.mjs",
    "test/security/wp5f-request-state.test.mjs",
    "test/types/wp5f-input-required/tsconfig.json",
    "test/types/wp5f-request-state/tsconfig.json"
  ],
  "test:subscriptions": ["test/client/wp5g-subscription.test.mjs", "test/types/wp5g-subscription/tsconfig.json"],
  "test:deprecated-boundary": ["test/packaging/wp5h-deprecated-boundary.test.mjs"],
  "test:examples": ["test/packaging/wp5h-examples.test.mjs"],
  "test:packaging": [
    "test/packaging/wp5b-core-subpaths.test.mjs",
    "test/packaging/wp5h-governance.test.mjs",
    "test/packaging/wp5h-packed-core-consumer.test.mjs",
    "test/types/wp5b-core-subpaths/tsconfig.json",
    "test/types/wp5-core-public/tsconfig.json"
  ]
}

test("authoritative focused core aliases invoke direct bounded files", () => {
  for (const [name, required] of Object.entries(focused)) {
    const command = packageJson.scripts[name]
    assert.equal(typeof command, "string", name)
    assert.match(command, /pnpm run build/, `${name} build`)
    for (const relative of required)
      assert.match(command, new RegExp(relative.replaceAll(".", "\\.")), `${name}: ${relative}`)
    // A focused alias names its files directly. Delegating to another alias is
    // how the old wp5a..wp5g cascade grew: each layer re-ran everything below
    // it, so a single `test:core` re-ran the earliest suites ten times over.
    assert.doesNotMatch(command, /pnpm run test:(?!build)/, `${name} must not delegate to another test alias`)
  }
})

test("the superseded wp5a..wp5g cascade is gone rather than merely unreferenced", () => {
  const surviving = Object.keys(packageJson.scripts).filter((name) => /wp\d/i.test(name))
  assert.deepEqual(surviving, [], "no package script may be named after a work package")
})

test("test:core executes every focused alias exactly once", () => {
  const command = packageJson.scripts["test:core"]
  assert.equal(typeof command, "string")
  const invoked = [...command.matchAll(/pnpm run (test:[a-z0-9-]+)/g)].map((match) => match[1])
  assert.deepEqual(invoked, Object.keys(focused))
  assert.equal(new Set(invoked).size, invoked.length)
})

test("verify owns the authoritative core gate and not a stale partial aggregate", () => {
  const verify = read("scripts/verify.mjs")
  assert.match(verify, /\["pnpm", \["run", "test:core"\]\]/)
  for (const focusedAlias of Object.keys(focused)) {
    assert.doesNotMatch(
      verify,
      new RegExp(`\\["pnpm", \\["run", "${focusedAlias}"\\]\\]`),
      `verify must reach ${focusedAlias} through test:core, not as a separate gate`
    )
  }
})

test("the deferred ledger distinguishes local WP5 implementation from later deferrals", () => {
  const ledger = JSON.parse(read("docs/conformance/ts-sdk-parity-deferred.json"))
  assert.equal(ledger.schemaVersion, 2)
  const [wp5, wp6, ...later] = ledger.items
  assert.equal(wp5.id, "wp5-core-feature-surface")
  assert.equal(wp5.status, "implemented-locally")
  assert.deepEqual(wp5.evidence, {
    report: ".superpowers/sdd/task-5-report.md",
    verificationCommands: ["pnpm run test:core", "pnpm run verify"],
    remoteIssueDisposition: "approval-required",
    qualification: "not-official-conformance-release-or-tier-evidence"
  })
  assert.equal(wp6.id, "wp6-auth-hardening")
  assert.equal(wp6.status, "implemented-locally")
  assert.deepEqual(wp6.evidence, {
    report: ".superpowers/sdd/task-6-report.md",
    verificationCommands: ["pnpm run test:auth", "pnpm run verify", "pnpm run conformance:client-auth"],
    remoteIssueDisposition: "approval-required",
    externalAuthorizationQualification: "blocked-missing-approved-target",
    qualification: "local-client-auth-evidence-is-not-external-authorization-release-or-tier-evidence"
  })
  assert.deepEqual(
    later.map(({ workPackage, status }) => ({ workPackage, status })),
    ["WP7", "WP8", "WP9", "WP10", "WP11"].map((workPackage) => ({
      workPackage,
      status: "deferred"
    }))
  )
})

// These assertions are about what the prose claims, not how it is wrapped.
// Prettier owns the line breaks in Markdown, so match against a single-line
// projection instead of the raw bytes.
const prose = (relative) => read(relative).replace(/\s+/g, " ")

test("documentation distinguishes self-hosted regression evidence from official qualification", () => {
  assert.match(prose("docs/migration-2026-07-28.md"), /pnpm run verify:conformance/)
  assert.match(prose("docs/conformance/scenario-map.md"), /same-commit composite/)
  const tier = prose("docs/conformance/sdk-tier-evidence.md")
  assert.match(tier, /does not claim an SDK Working Group designation/)
  assert.match(tier, /do(?:es)? not replace the official conformance composite/)
})
