import assert from "node:assert/strict"
import { existsSync, readFileSync } from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { test } from "node:test"

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..")
const read = (relative) => readFileSync(path.join(root, relative), "utf8")

test("package scripts expose cumulative WP4 HTTP and transport gates", () => {
  const scripts = JSON.parse(read("package.json")).scripts
  assert.equal(scripts["test:wp4-http"], "pnpm run build && node scripts/run-wp4-http-suite.mjs")
  assert.equal(scripts["test:wp4-transports"], "pnpm run build && node scripts/run-wp4-transports-suite.mjs")
  assert.equal(scripts["check:ts-sdk-parity"], "node scripts/check-ts-sdk-parity.mjs")
  for (const relative of [
    "scripts/run-wp4-http-suite.mjs",
    "scripts/run-wp4-transports-suite.mjs"
  ]) assert.equal(existsSync(path.join(root, relative)), true, relative)
})

test("verify owns package health while client auth remains a separate baseline", () => {
  const scripts = JSON.parse(read("package.json")).scripts
  assert.equal(
    scripts["conformance:client-auth"],
    "pnpm run build && node scripts/run-conformance-client-auth.mjs"
  )
  const verify = read("scripts/verify.mjs")
  for (const gate of [
    "check:ts-sdk-parity",
    "test:wp4-http",
    "test:wp4-transports",
    "e2e:draft"
  ]) assert.match(verify, new RegExp(`pnpm.*${gate.replaceAll(":", "\\:")}`), gate)
  assert.doesNotMatch(verify, /conformance:client-auth/)
})

test("parity is self-contained against the frozen draft and validates an explicit implementation/deferred ledger", () => {
  const ledgerPath = path.join(root, "docs/conformance/ts-sdk-parity-deferred.json")
  assert.equal(existsSync(ledgerPath), true)
  const ledger = JSON.parse(readFileSync(ledgerPath, "utf8"))
  assert.deepEqual(ledger.target, {
    protocolVersion: "2026-07-28",
    coreRevision: "26897cc322f356487da89113451bd16b520b9288"
  })
  assert.deepEqual(ledger.items.map(({ id, workPackage }) => ({ id, workPackage })), [
    { id: "wp5-core-feature-surface", workPackage: "WP5" },
    { id: "wp6-auth-hardening", workPackage: "WP6" },
    { id: "wp7-tasks-profile", workPackage: "WP7" },
    { id: "wp8-apps-server-view", workPackage: "WP8" },
    { id: "wp9-apps-host-preview", workPackage: "WP9" },
    { id: "wp10-release-candidate-qualification", workPackage: "WP10" },
    { id: "wp11-final-reconciliation-release", workPackage: "WP11" }
  ])
  assert.equal(new Set(ledger.items.map(({ id }) => id)).size, ledger.items.length)
  assert.equal(ledger.schemaVersion, 2)
  assert.equal(ledger.items[0].status, "implemented-locally")
  assert.equal(ledger.items.slice(1).every(({ status }) => status === "deferred"), true)
  for (const [index, item] of ledger.items.entries()) {
    const expectedKeys = [
      "expectations",
      "id",
      "notImplementedInWP4",
      "status",
      "workPackage"
    ]
    if (index === 0) expectedKeys.push("evidence")
    assert.deepEqual(Object.keys(item).sort(), expectedKeys.sort())
    for (const field of ["expectations", "notImplementedInWP4"]) {
      assert.equal(Array.isArray(item[field]) && item[field].length > 0, true, `${item.id}.${field}`)
      assert.equal(item[field].every((value) => typeof value === "string" && value.trim().length > 0), true)
    }
  }

  const parity = read("scripts/check-ts-sdk-parity.mjs")
  assert.match(parity, /ts-sdk-parity-deferred\.json/)
  assert.match(parity, /2026-07-28/)
  assert.doesNotMatch(parity, /workspaceRoot|tsc-sdk-reference|resources\/subscribe/)
})
