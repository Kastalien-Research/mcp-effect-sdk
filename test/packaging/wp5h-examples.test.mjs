import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import path from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"
import { test } from "node:test"

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..")
const read = (relative) => readFileSync(path.join(root, relative), "utf8")
const activeExamples = [
  "src/examples/agent-facing-proof-servers.ts",
  "src/examples/core-protocol-catalog.ts",
  "src/examples/everything-client.ts",
  "src/examples/everything-server.ts"
]
const publicSdkEntrypoints = new Set([
  "../index.js",
  "../client.js",
  "../server.js",
  "../protocol/2026-07-28.js",
  "../transport/http.js",
  "../transport/stdio.js",
  "../deprecated.js"
])

const importSpecifiers = (source) => [
  ...source.matchAll(/\bfrom\s+["']([^"']+)["']/g),
  ...source.matchAll(/\bimport\s+["']([^"']+)["']/g)
].map((match) => match[1])

test("active examples import SDK code only through published entrypoint owners", () => {
  const invalid = []
  for (const relative of activeExamples) {
    for (const specifier of importSpecifiers(read(relative))) {
      if (specifier.startsWith("..") && !publicSdkEntrypoints.has(specifier)) {
        invalid.push(`${relative}: ${specifier}`)
      }
    }
  }
  assert.deepEqual(invalid, [])
})
test("library-style examples load and expose stable MRTR and scoped Subscription examples", async () => {
  const [catalog, agentFacing] = await Promise.all([
    import(pathToFileURL(path.join(root, "dist/examples/core-protocol-catalog.js")).href),
    import(pathToFileURL(path.join(root, "dist/examples/agent-facing-proof-servers.js")).href)
  ])
  assert.equal(typeof catalog.inputRequiredApprovalLayer, "object")
  assert.equal(typeof catalog.makeInputRequiredApprovalPolicy, "function")
  assert.equal(typeof catalog.resourceWorkspaceClient, "function")
  assert.equal(typeof agentFacing.discoverAndChooseEvalServer, "object")
})

test("executable examples remain controlled by subprocess E2E and conformance runners", () => {
  const draftRunner = read("scripts/run-draft-e2e.mjs")
  assert.match(draftRunner, /dist\/examples\/everything-server\.js/)
  assert.match(draftRunner, /dist\/examples\/everything-client\.js/)
  const conformanceServer = read("scripts/run-conformance-server.mjs")
  const conformanceClient = read("scripts/run-conformance-client-auth.mjs")
  assert.match(conformanceServer, /dist\/examples\/everything-server\.js/)
  assert.match(conformanceClient, /dist\/examples\/everything-client\.js/)
})

test("task-heavy examples remain excluded for WP7", () => {
  const tsconfig = JSON.parse(read("tsconfig.json"))
  assert.equal(tsconfig.exclude.includes("src/examples/task-heavy/**"), true)
  assert.equal(tsconfig.exclude.includes("src/McpTasks.ts"), true)
})
