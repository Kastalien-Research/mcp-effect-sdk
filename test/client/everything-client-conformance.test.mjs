import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import { readFileSync } from "node:fs"
import test from "node:test"
import path from "node:path"
import { fileURLToPath } from "node:url"

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..")
const client = path.join(root, "dist/examples/everything-client.js")
const read = (relative) => readFileSync(path.join(root, relative), "utf8")

const stableScenarios = [
  "request-metadata",
  "auth/offline-access-scope",
  "auth/offline-access-not-supported",
  "auth/authorization-server-migration",
  "auth/iss-supported",
  "auth/iss-not-advertised",
  "auth/iss-supported-missing",
  "auth/iss-wrong-issuer",
  "auth/iss-unexpected",
  "auth/iss-normalized",
  "auth/metadata-issuer-mismatch",
  "sep-2322-client-request-state",
  "http-standard-headers",
  "http-custom-headers",
  "http-invalid-tool-headers",
  "json-schema-ref-no-deref"
]

test("everything client registers every applicable MCP 2026-07-28 conformance scenario", () => {
  for (const scenario of stableScenarios) {
    const result = spawnSync(process.execPath, [client, "http://127.0.0.1:1/mcp"], {
      encoding: "utf8",
      env: { ...process.env, MCP_CONFORMANCE_SCENARIO: scenario }
    })
    assert.doesNotMatch(result.stderr, /Unknown scenario:/, scenario)
  }
})

test("local MCP 2026-07-28 e2e does not reuse the official tools_call fixture contract", () => {
  const clientSource = read("examples/everything-client.ts")
  const stableRunner = read("scripts/run-2026-07-28-e2e.mjs")
  assert.match(clientSource, /registerScenario\("tools_call", runToolsCallClient\)/)
  assert.match(clientSource, /registerScenario\("stable_tools_call", runStableToolsCallClient\)/)
  assert.match(stableRunner, /name: "stable_tools_call"/)
})
