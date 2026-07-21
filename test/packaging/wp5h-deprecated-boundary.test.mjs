import assert from "node:assert/strict"
import { existsSync, readFileSync } from "node:fs"
import path from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"
import { test } from "node:test"

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..")
const read = (relative) => readFileSync(path.join(root, relative), "utf8")
const load = (relative) => import(pathToFileURL(path.join(root, relative)).href)

test("deprecated exposes only marked Roots, Sampling, and Logging migration hooks", async () => {
  const deprecated = await load("dist/deprecated.js")
  assert.deepEqual(Object.keys(deprecated).sort(), [
    "RootsProvider",
    "SamplingHandler",
    "sendLoggingMessage"
  ])

  assert.equal(existsSync(path.join(root, "src/client-handlers/ElicitationHandler.ts")), false)
  for (const relative of [
    "src/deprecated.ts",
    "src/client-handlers/RootsProvider.ts",
    "src/client-handlers/SamplingHandler.ts"
  ]) {
    assert.match(read(relative), /@deprecated/, relative)
  }
  assert.doesNotMatch(read("src/deprecated.ts"), /ElicitationHandler/)
})
test("deprecated hooks do not leak into stable entrypoints", async () => {
  const [rootApi, client, server] = await Promise.all([
    load("dist/index.js"),
    load("dist/client.js"),
    load("dist/server.js")
  ])
  for (const api of [rootApi, client, server]) {
    for (const name of ["ElicitationHandler", "RootsProvider", "SamplingHandler", "sendLoggingMessage"]) {
      assert.equal(name in api, false, name)
    }
  }
})

test("stable Elicitation is owned by input-required policy and never restores server requests", async () => {
  const [client, server, protocol, deprecated] = await Promise.all([
    load("dist/client.js"),
    load("dist/server.js"),
    load("dist/protocol/2026-07-28.js"),
    load("dist/deprecated.js")
  ])
  assert.equal(typeof client.InputRequiredPolicy.automatic, "function")
  const policy = client.InputRequiredPolicy.automatic({
    elicitation: {
      form: () => {
        throw new Error("type-only test handler")
      }
    }
  })
  assert.equal(policy.mode, "automatic")
  assert.equal(typeof policy.elicitation.form, "function")
  assert.equal(typeof server.requestInput, "function")
  assert.deepEqual(protocol.McpProtocol.SERVER_REQUEST_METHODS, [])
  assert.equal("ElicitationHandler" in deprecated, false)
})
