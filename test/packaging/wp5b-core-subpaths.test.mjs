import assert from "node:assert/strict"
import { execFileSync, spawnSync } from "node:child_process"
import {
  cpSync,
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
const packageAnalysisFixture = path.join(root, "test/fixtures/wp5b-package-analysis")
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
const clientKeys = ["McpCache", "McpCacheError", "McpClientError", "make", "serverInfoFromResult"]
const serverKeys = [
  "JsonSchemaResolver",
  "JsonSchemaValidator",
  "McpServer",
  "PaginationCursor",
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

const linkInstalledPackage = (name, modules) => {
  const segments = name.split("/")
  const destination = path.join(modules, ...segments)
  mkdirSync(path.dirname(destination), { recursive: true })
  symlinkSync(realpathSync(path.join(root, "node_modules", ...segments)), destination, "dir")
}

test("package exports and root namespaces expose exactly the stable WP5B core boundary", async () => {
  const packageJson = JSON.parse(readFileSync(path.join(root, "package.json"), "utf8"))
  assert.equal(packageJson.dependencies?.ajv, "8.20.0", "Ajv must be a declared runtime dependency")
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
  assert.strictEqual(rootApi.McpClient.make, client.make)
  assert.strictEqual(rootApi.McpServer.make, server.make)
  assert.deepEqual(Object.keys(rootApi.McpClient).sort(), clientKeys)
  assert.deepEqual(Object.keys(rootApi.McpServer).sort(), serverKeys)
})

test("packed core subpaths import with declared dependencies while deep paths stay sealed", () => {
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
    const packedPackageJson = JSON.parse(readFileSync(path.join(temp, "package/package.json"), "utf8"))
    for (const name of Object.keys(packedPackageJson.dependencies ?? {})) {
      linkInstalledPackage(name, packedModules)
    }
    linkInstalledPackage("effect", modules)
    linkInstalledPackage("effect", packedModules)
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

test("emitted core graphs are platform-free and declarations expose exact public keys", () => {
  execFileSync(process.execPath, ["scripts/check-wp5b-core-subpaths.mjs"], {
    cwd: root,
    stdio: "inherit"
  })
})

test("default declaration analysis rejects real entrypoint type, interface, and export-star leaks", async (t) => {
  const mutations = [
    ["client type", "dist/client.d.ts", "\nexport type Wp5bLeakedClientType = string\n"],
    ["server interface", "dist/server.d.ts", "\nexport interface Wp5bLeakedServerInterface { readonly leak: true }\n"],
    ["protocol export star", "dist/protocol/2026-07-28.d.ts", "\nexport * from \"./wp5b-leaked.js\"\n"]
  ]
  for (const [label, relative, addition] of mutations) {
    await t.test(label, () => {
      const temp = mkdtempSync(path.join(tmpdir(), "mcp-effect-sdk-wp5b-declarations-"))
      try {
        cpSync(path.join(root, "dist"), path.join(temp, "dist"), { recursive: true })
        const target = path.join(temp, relative)
        writeFileSync(target, `${readFileSync(target, "utf8")}${addition}`)
        if (label === "protocol export star") {
          writeFileSync(
            path.join(temp, "dist/protocol/wp5b-leaked.d.ts"),
            "export type Wp5bLeakedProtocolStar = string\n"
          )
        }
        const result = spawnSync(process.execPath, [
          "scripts/check-wp5b-core-subpaths.mjs",
          "--root",
          temp
        ], { cwd: root, encoding: "utf8" })
        assert.notEqual(result.status, 0, result.stdout)
        assert.match(`${result.stdout}\n${result.stderr}`, /declaration exports must match/)
      } finally {
        rmSync(temp, { recursive: true, force: true })
      }
    })
  }
})

const runPackageAnalysisFixture = (entrypoint, ...extra) => spawnSync(
  process.execPath,
  [
    "scripts/check-wp5b-core-subpaths.mjs",
    "--root",
    packageAnalysisFixture,
    "--entrypoint",
    entrypoint,
    ...extra
  ],
  { cwd: root, encoding: "utf8" }
)

for (const [entrypoint, builtin] of [
  ["runtime-side-effect.js", "buffer"],
  ["runtime-static.js", "crypto"],
  ["runtime-dynamic.js", "buffer"]
]) {
  test(`package analysis rejects ${builtin} from ${entrypoint}`, () => {
    const result = runPackageAnalysisFixture(entrypoint)
    assert.notEqual(result.status, 0, result.stdout)
    assert.match(`${result.stdout}\n${result.stderr}`, new RegExp(`Node built-in.*${builtin}`))
  })
}

test("package analysis resolves local declaration exports and export-star names exactly", () => {
  const result = runPackageAnalysisFixture(
    "api.d.ts",
    "--expected-exports",
    "LocalAlias,LocalInterface,ReexportedAlias"
  )
  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`)
  assert.match(result.stdout, /Declaration exports: LocalAlias,LocalInterface,ReexportedAlias/)
})
