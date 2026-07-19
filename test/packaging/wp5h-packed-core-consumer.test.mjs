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
import { fileURLToPath } from "node:url"
import { test } from "node:test"

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..")

const linkInstalledPackage = (name, modules) => {
  const segments = name.split("/")
  const destination = path.join(modules, ...segments)
  mkdirSync(path.dirname(destination), { recursive: true })
  symlinkSync(realpathSync(path.join(root, "node_modules", ...segments)), destination, "dir")
}

test("actual tarball supports the complete WP5 public consumer with only declared dependencies and peers", () => {
  const temp = mkdtempSync(path.join(tmpdir(), "mcp-effect-sdk-wp5h-pack-"))
  try {
    execFileSync("pnpm", ["pack", "--pack-destination", temp], { cwd: root, stdio: "ignore" })
    const tarball = path.join(temp, "mcp-effect-sdk-1.0.0.tgz")
    execFileSync("tar", ["-xzf", tarball, "-C", temp])

    const packed = path.join(temp, "package")
    const packedPackage = JSON.parse(readFileSync(path.join(packed, "package.json"), "utf8"))
    const declared = new Set([
      ...Object.keys(packedPackage.dependencies ?? {}),
      ...Object.keys(packedPackage.peerDependencies ?? {})
    ])
    assert.deepEqual([...declared].sort(), ["@effect/platform", "ajv", "effect"])

    const consumer = path.join(temp, "consumer")
    const modules = path.join(consumer, "node_modules")
    mkdirSync(modules, { recursive: true })
    mkdirSync(path.join(modules, "@types"), { recursive: true })
    cpSync(packed, path.join(modules, "mcp-effect-sdk"), { recursive: true })
    for (const name of declared) linkInstalledPackage(name, modules)
    symlinkSync(realpathSync(path.join(root, "node_modules/@types/node")), path.join(modules, "@types/node"), "dir")

    writeFileSync(path.join(consumer, "runtime.mjs"), `
      import { createRequire } from "node:module"
      import { realpathSync } from "node:fs"
      const root = await import("mcp-effect-sdk")
      const client = await import("mcp-effect-sdk/client")
      const server = await import("mcp-effect-sdk/server")
      const protocol = await import("mcp-effect-sdk/protocol/2026-07-28")
      const stdio = await import("mcp-effect-sdk/transport/stdio")
      const http = await import("mcp-effect-sdk/transport/http")
      const deprecated = await import("mcp-effect-sdk/deprecated")
      const effectPlatform = await import("mcp-effect-sdk/integrations/effect-platform")
      for (const specifier of [
        "mcp-effect-sdk/McpClient",
        "mcp-effect-sdk/McpServer",
        "mcp-effect-sdk/client-handlers/ElicitationHandler",
        "mcp-effect-sdk/generated/mcp/2026-07-28/McpSchema.generated",
        "mcp-effect-sdk/auth/auth"
      ]) {
        try { await import(specifier); throw new Error("deep path resolved: " + specifier) }
        catch (error) { if (error.code !== "ERR_PACKAGE_PATH_NOT_EXPORTED") throw error }
      }
      const consumerRequire = createRequire(import.meta.url)
      const packageRequire = createRequire(import.meta.resolve("mcp-effect-sdk/client"))
      console.log(JSON.stringify({
        deprecated: Object.keys(deprecated).sort(),
        client: [typeof client.make, typeof client.InputRequiredPolicy.automatic],
        server: [typeof server.make, typeof server.requestInput, typeof server.JsonSchemaValidator],
        protocol: protocol.MODERN_PROTOCOL_VERSION,
        stdio: Object.keys(stdio).sort(),
        http: Object.keys(http).sort(),
        root: [typeof root.McpClient.make, typeof root.McpServer.make],
        effectPlatform: Object.keys(effectPlatform).length > 0,
        oneEffect: realpathSync(consumerRequire.resolve("effect")) === realpathSync(packageRequire.resolve("effect"))
      }))
    `)
    const runtime = spawnSync(process.execPath, ["runtime.mjs"], { cwd: consumer, encoding: "utf8" })
    assert.equal(runtime.status, 0, runtime.stderr)
    assert.deepEqual(JSON.parse(runtime.stdout), {
      deprecated: ["RootsProvider", "SamplingHandler", "sendLoggingMessage"],
      client: ["function", "function"],
      server: ["function", "function", "function"],
      protocol: "2026-07-28",
      stdio: ["StdioClientTransport", "StdioServerTransport"],
      http: ["StreamableHttpClientTransport", "StreamableHttpServerTransport"],
      root: ["function", "function"],
      effectPlatform: true,
      oneEffect: true
    })

    writeFileSync(path.join(consumer, "index.ts"), `
      import { Effect, Stream } from "effect"
      import * as Client from "mcp-effect-sdk/client"
      import * as Deprecated from "mcp-effect-sdk/deprecated"
      import * as Protocol from "mcp-effect-sdk/protocol/2026-07-28"
      import * as Server from "mcp-effect-sdk/server"
      import * as Http from "mcp-effect-sdk/transport/http"
      import * as Stdio from "mcp-effect-sdk/transport/stdio"
      // @ts-expect-error Elicitation has no deprecated service export.
      import { ElicitationHandler } from "mcp-effect-sdk/deprecated"
      const transport: Client.McpTransport<never> = { request: () => Stream.never }
      void Client.make({
        transport,
        inputRequired: Client.InputRequiredPolicy.automatic({
          elicitation: { form: () => Effect.succeed({ action: "accept", content: {} }) }
        })
      })
      void Server.make({
        serverInfo: { name: "packed", version: "1" },
        handlers: Effect.void,
        pagination: { pageSize: 10 }
      })
      void Server.requestInput({ requestState: "opaque" })
      const version: typeof Protocol.MODERN_PROTOCOL_VERSION = "2026-07-28"
      const info: Protocol.McpSchema.Implementation = { name: "packed", version: "1" }
      void Deprecated.RootsProvider
      void Deprecated.SamplingHandler
      void Deprecated.sendLoggingMessage
      void Http.StreamableHttpClientTransport.make
      void Stdio.StdioClientTransport.make
      void ElicitationHandler
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
