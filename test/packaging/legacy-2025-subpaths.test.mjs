import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import path from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"
import test from "node:test"

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..")
const load = (relative) => import(pathToFileURL(path.join(root, relative)).href)

const legacyExports = {
  "./protocol/2025-11-25": "protocol/2025-11-25",
  "./legacy/client": "legacy/client",
  "./legacy/server": "legacy/server",
  "./legacy/tasks": "legacy/tasks",
  "./legacy/resources": "legacy/resources",
  "./legacy/logging": "legacy/logging",
  "./legacy/transport/http": "legacy/http",
  "./legacy/transport/stdio": "legacy/stdio"
}

test("legacy package subpaths resolve to isolated built entrypoints", async () => {
  const packageJson = JSON.parse(readFileSync(path.join(root, "package.json"), "utf8"))
  for (const [subpath, output] of Object.entries(legacyExports)) {
    assert.deepEqual(packageJson.exports[subpath], {
      import: `./dist/${output}.js`,
      types: `./dist/${output}.d.ts`
    })
    await load(`dist/${output}.js`)
  }

  const protocol = await load("dist/protocol/2025-11-25.js")
  assert.equal(protocol.LEGACY_PROTOCOL_VERSION, "2025-11-25")
  assert.equal(protocol.McpProtocol.LATEST_PROTOCOL_VERSION, "2025-11-25")
  assert.equal(protocol.McpProtocol.SERVER_REQUEST_METHODS.includes("sampling/createMessage"), true)
  assert.equal(protocol.McpProtocol.CLIENT_REQUEST_METHODS.includes("initialize"), true)
  assert.equal("MODERN_PROTOCOL_VERSION" in protocol, false)

  const modern = await load("dist/protocol/2026-07-28.js")
  assert.equal("LEGACY_PROTOCOL_VERSION" in modern, false)
  assert.equal(modern.McpProtocol.SERVER_REQUEST_METHODS.length, 0)
})
