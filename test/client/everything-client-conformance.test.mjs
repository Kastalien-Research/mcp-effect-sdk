import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import test from "node:test"
import path from "node:path"
import { fileURLToPath } from "node:url"

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..")
const client = path.join(root, "dist/examples/everything-client.js")

const draftScenarios = [
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

test("everything client registers every applicable draft conformance scenario", () => {
  for (const scenario of draftScenarios) {
    const result = spawnSync(process.execPath, [client, "http://127.0.0.1:1/mcp"], {
      encoding: "utf8",
      env: { ...process.env, MCP_CONFORMANCE_SCENARIO: scenario }
    })
    assert.doesNotMatch(result.stderr, /Unknown scenario:/, scenario)
  }
})
