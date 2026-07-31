// Install the published package into an isolated consumer and exercise every
// stable export subpath. This is intentionally registry-backed release
// evidence; local tarball behavior is covered by the package-health suite.
import { execFileSync } from "node:child_process"
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { fileURLToPath } from "node:url"

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")
const packageJson = JSON.parse(readFileSync(path.join(root, "package.json"), "utf8"))
const packageName = packageJson.name
const version = process.argv[2] ?? packageJson.version
if (version !== packageJson.version || !/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(version)) {
  throw new Error(`Published verification requires package.json stable version ${packageJson.version}`)
}
const requestedPackageSpec = process.argv[3]
const packageSpec =
  requestedPackageSpec?.endsWith(".tgz") && !requestedPackageSpec.startsWith("https://")
    ? path.resolve(root, requestedPackageSpec)
    : (requestedPackageSpec ?? `${packageName}@${version}`)
if (packageSpec.endsWith(".tgz") && !packageSpec.startsWith("https://") && !existsSync(packageSpec)) {
  throw new Error(`Release tarball does not exist: ${packageSpec}`)
}
const stableEntryPoints = Object.keys(packageJson.exports ?? {}).filter(
  (subpath) => !subpath.startsWith("./experimental/")
)
if (stableEntryPoints.length === 0) {
  throw new Error("package.json must declare stable export subpaths")
}
const consumer = mkdtempSync(path.join(tmpdir(), "mcp-effect-sdk-published-consumer-"))

try {
  writeFileSync(
    path.join(consumer, "package.json"),
    `${JSON.stringify({ name: "mcp-effect-sdk-published-consumer", private: true, type: "module" }, null, 2)}\n`
  )
  execFileSync(
    "npm",
    [
      "install",
      "--ignore-scripts",
      "--no-audit",
      "--no-fund",
      "--package-lock=false",
      packageSpec,
      "effect@3.22.0",
      "@effect/platform@0.97.0"
    ],
    { cwd: consumer, stdio: "inherit" }
  )
  writeFileSync(
    path.join(consumer, "verify.mjs"),
    `
      import { readFileSync } from "node:fs"
      import { realpathSync } from "node:fs"
      import { createRequire } from "node:module"
      import * as AuthClient from "${packageName}/auth/client"
      import * as AuthProtectedResource from "${packageName}/auth/protected-resource"
      import * as Client from "${packageName}/client"
      import * as Deprecated from "${packageName}/deprecated"
      import * as EffectPlatform from "${packageName}/integrations/effect-platform"
      import * as Http from "${packageName}/transport/http"
      import * as Protocol from "${packageName}/protocol/2026-07-28"
      import * as Root from "${packageName}"
      import * as Server from "${packageName}/server"
      import * as Stdio from "${packageName}/transport/stdio"

      const installed = JSON.parse(
        readFileSync(new URL("./node_modules/${packageName}/package.json", import.meta.url), "utf8")
      )
      const stableEntryPoints = ${JSON.stringify(stableEntryPoints)}
      for (const subpath of stableEntryPoints) {
        const specifier = subpath === "." ? "${packageName}" : "${packageName}" + subpath.slice(1)
        const imported = await import(specifier)
        if (Object.keys(imported).length === 0) throw new Error(specifier + " has no public exports")
      }
      const consumerRequire = createRequire(import.meta.url)
      const packageRequire = createRequire(import.meta.resolve("${packageName}/client"))
      const checks = {
        version: installed.version,
        protocolVersion: Protocol.MODERN_PROTOCOL_VERSION,
        stableEntryPointCount: stableEntryPoints.length,
        subscriptionResponse: typeof Protocol.McpSchema.SubscriptionsListenResultResponse,
        rootClient: typeof Root.McpClient.make,
        rootServer: typeof Root.McpServer.make,
        client: typeof Client.make,
        server: typeof Server.make,
        httpClient: typeof Http.StreamableHttpClientTransport.make,
        httpServer: typeof Http.StreamableHttpServerTransport.toWebHandler,
        stdioClient: typeof Stdio.StdioClientTransport.make,
        stdioServer: typeof Stdio.StdioServerTransport.run,
        authClient: typeof AuthClient.makeAuthorizationClient,
        protectedResource: typeof AuthProtectedResource.requireAuthorizationScopes,
        deprecatedLogging: typeof Deprecated.sendLoggingMessage,
        effectPlatform: Object.keys(EffectPlatform).length > 0,
        oneEffect:
          realpathSync(consumerRequire.resolve("effect")) === realpathSync(packageRequire.resolve("effect"))
      }
      for (const [name, value] of Object.entries(checks)) {
        const expected = name === "version"
          ? ${JSON.stringify(version)}
          : name === "protocolVersion"
            ? "2026-07-28"
            : name === "stableEntryPointCount"
              ? stableEntryPoints.length
              : name === "effectPlatform" || name === "oneEffect"
                ? true
            : "function"
        if (value !== expected) throw new Error(\`\${name}: expected \${expected}, received \${value}\`)
      }
      process.stdout.write(JSON.stringify(checks))
    `
  )
  const output = execFileSync(process.execPath, ["verify.mjs"], {
    cwd: consumer,
    encoding: "utf8"
  })
  console.log(`Published consumer verification passed: ${output}`)
} finally {
  rmSync(consumer, { recursive: true, force: true })
}
