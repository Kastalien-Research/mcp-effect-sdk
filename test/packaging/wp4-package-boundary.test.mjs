import assert from "node:assert/strict"
import { execFileSync, spawnSync } from "node:child_process"
import {
  existsSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  symlinkSync
} from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"
import { test } from "node:test"

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..")
const legacySources = [
  "src/McpClientProtocol.ts",
  "src/McpSerialization.ts",
  "src/transport/HttpTransport.ts",
  "src/transport/SseClientTransport.ts",
  "src/transport/WebSocketClientTransport.ts"
]
const removedRootNames = [
  "HttpTransport",
  "StdioTransport",
  "SseClientTransport",
  "WebSocketClientTransport",
  "McpClientProtocol",
  "SamplingHandler",
  "ElicitationHandler",
  "RootsProvider"
]

test("the root and source tree retain only modern public transport boundaries", async () => {
  const rootApi = await import(pathToFileURL(path.join(root, "dist/index.js")).href)
  for (const name of removedRootNames) assert.equal(name in rootApi, false, name)
  for (const name of [
    "StdioClientTransport",
    "StdioServerTransport",
    "StreamableHttpClientTransport",
    "StreamableHttpServerTransport"
  ]) assert.equal(name in rootApi, true, name)

  for (const relative of legacySources) assert.equal(existsSync(path.join(root, relative)), false, relative)
  assert.doesNotMatch(readFileSync(path.join(root, "src/McpNotifications.ts"), "utf8"), /\bexport function outbound\b/)
  assert.doesNotMatch(readFileSync(path.join(root, "src/McpSchema.ts"), "utf8"), /\binitializePayload\b/)
  assert.doesNotMatch(readFileSync(path.join(root, "src/McpServer.ts"), "utf8"), /\binitializePayload\b/)
})

test("the deprecated subpath preserves only the existing marked client hooks", async () => {
  const packageJson = JSON.parse(readFileSync(path.join(root, "package.json"), "utf8"))
  assert.deepEqual(packageJson.exports["./deprecated"], {
    import: "./dist/deprecated.js",
    types: "./dist/deprecated.d.ts"
  })
  const deprecated = await import(pathToFileURL(path.join(root, "dist/deprecated.js")).href)
  assert.deepEqual(Object.keys(deprecated).sort(), [
    "ElicitationHandler",
    "RootsProvider",
    "SamplingHandler",
    "sendLoggingMessage"
  ])
  for (const value of Object.values(deprecated)) assert.equal(typeof value, "function")
  for (const relative of [
    "src/deprecated.ts",
    "src/client-handlers/ElicitationHandler.ts",
    "src/client-handlers/RootsProvider.ts",
    "src/client-handlers/SamplingHandler.ts"
  ]) assert.match(readFileSync(path.join(root, relative), "utf8"), /@deprecated/, relative)
})

test("a packed consumer can import root and deprecated while legacy subpaths stay sealed", () => {
  const temp = mkdtempSync(path.join(tmpdir(), "mcp-effect-sdk-wp4-pack-"))
  try {
    execFileSync("pnpm", ["pack", "--pack-destination", temp], { cwd: root, stdio: "ignore" })
    const tarball = path.join(temp, "mcp-effect-sdk-1.0.0.tgz")
    execFileSync("tar", ["-xzf", tarball, "-C", temp])
    const consumer = path.join(temp, "consumer")
    const modules = path.join(consumer, "node_modules")
    const packedModules = path.join(temp, "node_modules")
    mkdirSync(modules, { recursive: true })
    mkdirSync(packedModules, { recursive: true })
    symlinkSync(path.join(temp, "package"), path.join(modules, "mcp-effect-sdk"), "dir")
    symlinkSync(realpathSync(path.join(root, "node_modules/effect")), path.join(packedModules, "effect"), "dir")

    const probe = spawnSync(process.execPath, ["--input-type=module", "--eval", `
      const root = await import("mcp-effect-sdk")
      const deprecated = await import("mcp-effect-sdk/deprecated")
      const removed = ${JSON.stringify([
        "mcp-effect-sdk/transport/HttpTransport",
        "mcp-effect-sdk/transport/StdioTransport",
        "mcp-effect-sdk/transport/SseClientTransport",
        "mcp-effect-sdk/transport/WebSocketClientTransport",
        "mcp-effect-sdk/McpClientProtocol",
        "mcp-effect-sdk/McpSerialization"
      ])}
      for (const specifier of removed) {
        try { await import(specifier); throw new Error("legacy subpath resolved: " + specifier) }
        catch (error) { if (error.code !== "ERR_PACKAGE_PATH_NOT_EXPORTED") throw error }
      }
      console.log(JSON.stringify({ root: Object.keys(root), deprecated: Object.keys(deprecated) }))
    `], { cwd: consumer, encoding: "utf8" })
    assert.equal(probe.status, 0, probe.stderr)
    const result = JSON.parse(probe.stdout)
    for (const name of removedRootNames) assert.equal(result.root.includes(name), false, name)
    assert.deepEqual(result.deprecated.sort(), [
      "ElicitationHandler",
      "RootsProvider",
      "SamplingHandler",
      "sendLoggingMessage"
    ])
  } finally {
    rmSync(temp, { recursive: true, force: true })
  }
})
