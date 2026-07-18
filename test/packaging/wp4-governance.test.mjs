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

test("parity is self-contained against the frozen draft and validates a deferred ledger", () => {
  const ledgerPath = path.join(root, "docs/conformance/ts-sdk-parity-deferred.json")
  assert.equal(existsSync(ledgerPath), true)
  const ledger = JSON.parse(readFileSync(ledgerPath, "utf8"))
  assert.deepEqual(ledger.target, {
    protocolVersion: "2026-07-28",
    coreRevision: "26897cc322f356487da89113451bd16b520b9288"
  })
  assert.deepEqual(ledger.items.map(({ id }) => id), [
    "wp5-client-product-api",
    "wp6-auth-hardening",
    "wp7-extension-surfaces",
    "wp8-release-qualification"
  ])
  assert.equal(ledger.items.every(({ status }) => status === "deferred"), true)

  const parity = read("scripts/check-ts-sdk-parity.mjs")
  assert.match(parity, /ts-sdk-parity-deferred\.json/)
  assert.match(parity, /2026-07-28/)
  assert.doesNotMatch(parity, /workspaceRoot|tsc-sdk-reference|resources\/subscribe/)
})
