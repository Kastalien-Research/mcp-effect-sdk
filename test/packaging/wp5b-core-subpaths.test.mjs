import assert from "node:assert/strict"
import { execFileSync, spawnSync } from "node:child_process"
import {
  mkdtempSync,
  mkdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync
} from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"
import { test } from "node:test"

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..")
const expectedExports = [
  ".",
  "./client",
  "./deprecated",
  "./integrations/effect-platform",
  "./protocol/2026-07-28",
  "./server",
  "./transport/http",
  "./transport/stdio"
]
const clientKeys = ["McpClientError", "make", "serverInfoFromResult"]
const serverKeys = [
  "McpServer",
  "clientCapabilities",
  "layer",
  "make",
  "makeDispatcher",
  "prompt",
  "registerPrompt",
  "registerResource",
  "registerTool",
  "resource",
  "sendProgress",
  "sendPromptListChanged",
  "sendResourceListChanged",
  "sendResourceUpdated",
  "sendToolListChanged",
  "tool"
]
const protocolKeys = [
  "FIRST_MODERN_PROTOCOL_VERSION",
  "HEADER_MISMATCH_ERROR_CODE",
  "MCP_BAGGAGE_META_KEY",
  "MCP_CLIENT_CAPABILITIES_META_KEY",
  "MCP_CLIENT_INFO_META_KEY",
  "MCP_LOG_LEVEL_META_KEY",
  "MCP_METHOD_HEADER",
  "MCP_NAME_HEADER",
  "MCP_PROTOCOL_VERSION_HEADER",
  "MCP_PROTOCOL_VERSION_META_KEY",
  "MCP_SERVER_INFO_META_KEY",
  "MCP_SUBSCRIPTION_ID_META_KEY",
  "MCP_TRACEPARENT_META_KEY",
  "MCP_TRACESTATE_META_KEY",
  "MISSING_REQUIRED_CLIENT_CAPABILITY_ERROR_CODE",
  "MODERN_PROTOCOL_VERSION",
  "McpErrors",
  "McpProtocol",
  "McpSchema",
  "McpWire",
  "SERVER_DISCOVER_METHOD",
  "SUBSCRIPTIONS_LISTEN_METHOD",
  "UNSUPPORTED_PROTOCOL_VERSION_ERROR_CODE",
  "serverInfoFromResult"
]
const clientDeclarationNames = [...clientKeys,
  "ClientCapabilitiesProvider",
  "ClientExtensionCapabilities",
  "ClientExtensionsProvider",
  "ClientRequestProfileContext",
  "ClientResultForMethod",
  "CoreClientCapabilities",
  "McpClient",
  "McpClientErrorReason",
  "McpClientOptions",
  "McpTransport",
  "SubscriptionFilter"
].sort()
const serverDeclarationNames = [...serverKeys,
  "ExtensionCapabilities",
  "McpServerOptions",
  "McpServerService",
  "ServerNotification",
  "ServerScope"
].sort()

const declarationExports = (relative) => {
  const source = readFileSync(path.join(root, relative), "utf8")
  const names = []
  for (const match of source.matchAll(/export\s+(?:type\s+)?\{([\s\S]*?)\}\s+from/g)) {
    for (const item of match[1].split(",")) {
      const name = item.trim().replace(/^type\s+/, "").split(/\s+as\s+/)[1] ??
        item.trim().replace(/^type\s+/, "").split(/\s+as\s+/)[0]
      if (name) names.push(name)
    }
  }
  for (const match of source.matchAll(/export\s+\*\s+as\s+([A-Za-z0-9_]+)/g)) names.push(match[1])
  return names.sort()
}

test("package exports and root namespaces expose exactly the stable WP5B core boundary", async () => {
  const packageJson = JSON.parse(readFileSync(path.join(root, "package.json"), "utf8"))
  assert.deepEqual(Object.keys(packageJson.exports).sort(), expectedExports)
  assert.deepEqual(packageJson.exports["./client"], {
    import: "./dist/client.js",
    types: "./dist/client.d.ts"
  })
  assert.deepEqual(packageJson.exports["./server"], {
    import: "./dist/server.js",
    types: "./dist/server.d.ts"
  })
  assert.deepEqual(packageJson.exports["./protocol/2026-07-28"], {
    import: "./dist/protocol/2026-07-28.js",
    types: "./dist/protocol/2026-07-28.d.ts"
  })

  const client = await import(pathToFileURL(path.join(root, "dist/client.js")).href)
  const server = await import(pathToFileURL(path.join(root, "dist/server.js")).href)
  const protocol = await import(pathToFileURL(path.join(root, "dist/protocol/2026-07-28.js")).href)
  const rootApi = await import(pathToFileURL(path.join(root, "dist/index.js")).href)
  assert.deepEqual(Object.keys(client).sort(), clientKeys)
  assert.deepEqual(Object.keys(server).sort(), serverKeys)
  assert.deepEqual(Object.keys(protocol).sort(), protocolKeys)
  assert.deepEqual(declarationExports("dist/client.d.ts"), clientDeclarationNames)
  assert.deepEqual(declarationExports("dist/server.d.ts"), serverDeclarationNames)
  assert.deepEqual(declarationExports("dist/protocol/2026-07-28.d.ts"), protocolKeys)
  assert.strictEqual(rootApi.McpClient.make, client.make)
  assert.strictEqual(rootApi.McpServer.make, server.make)
  assert.deepEqual(Object.keys(rootApi.McpClient).sort(), clientKeys)
  assert.deepEqual(Object.keys(rootApi.McpServer).sort(), serverKeys)
})

test("packed core subpaths import with only Effect while deep paths stay sealed", () => {
  const temp = mkdtempSync(path.join(tmpdir(), "mcp-effect-sdk-wp5b-pack-"))
  try {
    execFileSync("pnpm", ["pack", "--pack-destination", temp], { cwd: root, stdio: "ignore" })
    execFileSync("tar", ["-xzf", path.join(temp, "mcp-effect-sdk-1.0.0.tgz"), "-C", temp])
    const consumer = path.join(temp, "consumer")
    const modules = path.join(consumer, "node_modules")
    const packedModules = path.join(temp, "node_modules")
    mkdirSync(modules, { recursive: true })
    mkdirSync(path.join(modules, "@types"), { recursive: true })
    mkdirSync(packedModules, { recursive: true })
    symlinkSync(path.join(temp, "package"), path.join(modules, "mcp-effect-sdk"), "dir")
    symlinkSync(realpathSync(path.join(root, "node_modules/effect")), path.join(modules, "effect"), "dir")
    symlinkSync(realpathSync(path.join(root, "node_modules/effect")), path.join(packedModules, "effect"), "dir")
    symlinkSync(realpathSync(path.join(root, "node_modules/@types/node")), path.join(modules, "@types/node"), "dir")

    const runtime = spawnSync(process.execPath, ["--input-type=module", "--eval", `
      const client = await import("mcp-effect-sdk/client")
      const server = await import("mcp-effect-sdk/server")
      const protocol = await import("mcp-effect-sdk/protocol/2026-07-28")
      for (const specifier of [
        "mcp-effect-sdk/McpClient",
        "mcp-effect-sdk/McpServer",
        "mcp-effect-sdk/generated/mcp/2026-07-28/McpSchema.generated"
      ]) {
        try { await import(specifier); throw new Error("deep path resolved: " + specifier) }
        catch (error) { if (error.code !== "ERR_PACKAGE_PATH_NOT_EXPORTED") throw error }
      }
      console.log(JSON.stringify({
        client: Object.keys(client).sort(),
        server: Object.keys(server).sort(),
        protocol: Object.keys(protocol).sort()
      }))
    `], { cwd: consumer, encoding: "utf8" })
    assert.equal(runtime.status, 0, runtime.stderr)
    assert.deepEqual(JSON.parse(runtime.stdout), {
      client: clientKeys,
      server: serverKeys,
      protocol: protocolKeys
    })

    writeFileSync(path.join(consumer, "index.ts"), `
      import { Effect, Stream } from "effect"
      import { make as makeClient, type McpTransport } from "mcp-effect-sdk/client"
      import { make as makeServer } from "mcp-effect-sdk/server"
      import { MODERN_PROTOCOL_VERSION, McpSchema } from "mcp-effect-sdk/protocol/2026-07-28"
      const transport: McpTransport<never> = { request: () => Stream.never }
      void makeClient({ transport })
      void makeServer({ serverInfo: { name: "packed", version: "1" }, handlers: Effect.void })
      const version: typeof MODERN_PROTOCOL_VERSION = "2026-07-28"
      const info: McpSchema.Implementation = { name: "packed", version: "1" }
      void version
      void info
    `)
    writeFileSync(path.join(consumer, "tsconfig.json"), JSON.stringify({
      compilerOptions: {
        target: "ES2022",
        module: "NodeNext",
        moduleResolution: "NodeNext",
        strict: true,
        skipLibCheck: false,
        lib: ["ES2022"],
        types: ["node"],
        noEmit: true
      },
      include: ["index.ts"]
    }))
    const typecheck = spawnSync(path.join(root, "node_modules/.bin/tsc"), ["-p", "tsconfig.json"], {
      cwd: consumer,
      encoding: "utf8"
    })
    assert.equal(typecheck.status, 0, `${typecheck.stdout}\n${typecheck.stderr}`)
  } finally {
    rmSync(temp, { recursive: true, force: true })
  }
})

test("emitted core runtime and declaration graphs are DOM-free and Node-free", () => {
  execFileSync(process.execPath, ["scripts/check-wp5b-core-subpaths.mjs"], {
    cwd: root,
    stdio: "inherit"
  })
})
