import assert from "node:assert/strict"
import { execFileSync, spawnSync } from "node:child_process"
import {
  cpSync,
  existsSync,
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
const clientSpecifier = "mcp-effect-sdk/auth/client"
const protectedSpecifier = "mcp-effect-sdk/auth/protected-resource"
const clientKeys = [
  "AuthorizationCallbackInput", "AuthorizationChallenge", "AuthorizationClient",
  "AuthorizationClientStore", "AuthorizationCredentialHandle", "AuthorizationCrypto",
  "AuthorizationCryptoError", "AuthorizationDecodeError", "AuthorizationGrantHandle",
  "AuthorizationHttpClient", "AuthorizationHttpError", "AuthorizationInteraction",
  "AuthorizationInteractionError", "AuthorizationProtocolError", "AuthorizationScope",
  "AuthorizationScopeSet", "AuthorizationServerMetadata", "AuthorizationSigningKeyHandle",
  "AuthorizationStoreError", "AuthorizationTransactionHandle", "ProtectedResourceMetadata",
  "acquireAuthorization", "currentAuthorizationGrant", "respondToAuthorizationChallenge"
]
const protectedKeys = [
  "AuthorizationChallenge", "AuthorizationPolicyError", "AuthorizationPrincipal",
  "AuthorizationScope", "AuthorizationScopeSet", "BearerAuthorizationError",
  "ProtectedResourceMetadata", "TokenVerificationError", "TokenVerifier",
  "embedVerifiedAuthorizationPrincipal", "extractBearerToken", "insufficientScopeChallenge", "requireAuthorizationScopes",
  "serializeAuthorizationChallenge", "unauthorizedChallenge", "verifyBearerAuthorization",
  "verifyToken"
]
const expectedPackageExports = [
  ".", "./auth/client", "./auth/protected-resource", "./client", "./deprecated",
  "./integrations/effect-platform", "./protocol/2026-07-28", "./server",
  "./transport/http", "./transport/stdio"
]
const unchangedRuntimeKeys = {
  root: [
    "McpClient", "McpDispatcher", "McpModern", "McpSchema", "McpServer", "McpTransport",
    "McpWire", "OAuth", "OAuthErrors", "OAuthProviders", "StdioClientTransport",
    "StdioServerTransport", "StreamableHttpClientTransport", "StreamableHttpServerTransport"
  ],
  client: [
    "InputRequiredError", "InputRequiredPolicy", "McpCache", "McpCacheError",
    "McpClientError", "SubscriptionAbruptError", "SubscriptionProtocolError", "make",
    "serverInfoFromResult"
  ],
  server: [
    "HarmlessRawRequestState", "JsonSchemaResolver", "JsonSchemaValidator", "McpRequestContext",
    "McpServer", "PaginationCursor", "RequestStateError", "RequestStateReplayStore",
    "SecureRequestState", "clientCapabilities", "layer", "make", "makeDispatcher", "param",
    "prompt", "registerPrompt", "registerResource", "registerTool", "requestInput", "resource",
    "sendProgress", "sendPromptListChanged", "sendResourceListChanged", "sendResourceUpdated",
    "sendToolListChanged", "tool"
  ],
  protocol: [
    "FIRST_MODERN_PROTOCOL_VERSION", "HEADER_MISMATCH_ERROR_CODE", "MCP_BAGGAGE_META_KEY",
    "MCP_CLIENT_CAPABILITIES_META_KEY", "MCP_CLIENT_INFO_META_KEY", "MCP_LOG_LEVEL_META_KEY",
    "MCP_METHOD_HEADER", "MCP_NAME_HEADER", "MCP_PROTOCOL_VERSION_HEADER",
    "MCP_PROTOCOL_VERSION_META_KEY", "MCP_SERVER_INFO_META_KEY", "MCP_SUBSCRIPTION_ID_META_KEY",
    "MCP_TRACEPARENT_META_KEY", "MCP_TRACESTATE_META_KEY",
    "MISSING_REQUIRED_CLIENT_CAPABILITY_ERROR_CODE", "MODERN_PROTOCOL_VERSION", "McpErrors",
    "McpProtocol", "McpSchema", "McpWire", "SERVER_DISCOVER_METHOD",
    "SUBSCRIPTIONS_LISTEN_METHOD", "UNSUPPORTED_PROTOCOL_VERSION_ERROR_CODE", "serverInfoFromResult"
  ],
  deprecated: ["RootsProvider", "SamplingHandler", "sendLoggingMessage"],
  http: ["StreamableHttpClientTransport", "StreamableHttpServerTransport"]
}

const load = async (specifier) => {
  try {
    return await import(specifier)
  } catch (error) {
    assert.fail(`expected ${specifier} to resolve; received ${error?.code ?? error?.name}: ${error?.message}`)
  }
}

const linkInstalledPackage = (name, modules) => {
  const destination = path.join(modules, ...name.split("/"))
  mkdirSync(path.dirname(destination), { recursive: true })
  symlinkSync(realpathSync(path.join(root, "node_modules", ...name.split("/"))), destination, "dir")
}

const collectLocalGraph = (entry) => {
  const pending = [entry]
  const visited = new Set()
  while (pending.length > 0) {
    const file = pending.pop()
    if (visited.has(file)) continue
    assert.equal(existsSync(file), true, `auth entrypoint missing: ${path.relative(root, file)}`)
    visited.add(file)
    const source = readFileSync(file, "utf8")
    const specifiers = source.matchAll(/(?:from\s*|import\s*\(|export\s+\*\s+from\s*)["']([^"']+)["']/g)
    for (const match of specifiers) {
      const specifier = match[1]
      assert.doesNotMatch(specifier, /^(?:node:|@effect\/platform|@effect\/rpc|effect\/unstable)/)
      if (!specifier.startsWith(".")) continue
      const resolved = path.resolve(path.dirname(file), specifier)
      const candidates = file.endsWith(".d.ts") && resolved.endsWith(".js")
        ? [resolved.replace(/\.js$/, ".d.ts"), resolved]
        : [resolved, `${resolved}.js`, `${resolved}.d.ts`, path.join(resolved, "index.js"), path.join(resolved, "index.d.ts")]
      const target = candidates.find(existsSync)
      assert.ok(target, `unresolved local auth graph edge ${specifier} from ${path.relative(root, file)}`)
      pending.push(target)
    }
  }
  return [...visited]
}

test("package exports add only the two stable auth subpaths and preserve every existing public surface", async () => {
  const packageJson = JSON.parse(readFileSync(path.join(root, "package.json"), "utf8"))
  assert.deepEqual(Object.keys(packageJson.exports).sort(), expectedPackageExports)
  assert.deepEqual(packageJson.exports["./auth/client"], {
    import: "./dist/auth/client.js",
    types: "./dist/auth/client.d.ts"
  })
  assert.deepEqual(packageJson.exports["./auth/protected-resource"], {
    import: "./dist/auth/protected-resource.js",
    types: "./dist/auth/protected-resource.d.ts"
  })
  const modules = {
    root: await import("mcp-effect-sdk"),
    client: await import("mcp-effect-sdk/client"),
    server: await import("mcp-effect-sdk/server"),
    protocol: await import("mcp-effect-sdk/protocol/2026-07-28"),
    deprecated: await import("mcp-effect-sdk/deprecated"),
    http: await import("mcp-effect-sdk/transport/http")
  }
  for (const [name, expected] of Object.entries(unchangedRuntimeKeys)) {
    assert.deepEqual(Object.keys(modules[name]).sort(), expected, `${name} surface leaked WP6B symbols`)
  }
})

test("auth package imports expose exact keys while all auth deep paths remain sealed", async () => {
  const Client = await load(clientSpecifier)
  const Protected = await load(protectedSpecifier)
  assert.deepEqual(Object.keys(Client).sort(), clientKeys)
  assert.deepEqual(Object.keys(Protected).sort(), protectedKeys)
  for (const deep of [
    "mcp-effect-sdk/auth/client/services",
    "mcp-effect-sdk/auth/client/errors",
    "mcp-effect-sdk/auth/protected-resource/models",
    "mcp-effect-sdk/auth/protected-resource/services",
    "mcp-effect-sdk/auth/auth"
  ]) {
    await assert.rejects(import(deep), { code: "ERR_PACKAGE_PATH_NOT_EXPORTED" })
  }
})

test("emitted auth runtime and declaration graphs are Node, DOM, Web, Promise, and platform free", () => {
  const entries = [
    "dist/auth/client.js",
    "dist/auth/client.d.ts",
    "dist/auth/protected-resource.js",
    "dist/auth/protected-resource.d.ts"
  ].map((relative) => path.join(root, relative))
  const files = new Set(entries.flatMap(collectLocalGraph))
  const forbidden = /\b(?:Promise|fetch|Request|Response|Headers|AbortSignal|URL|Buffer|ServiceMap)\b|<reference\s+lib=["']dom["']|effect\/unstable|@effect\/platform|@effect\/rpc|node:/
  for (const file of files) {
    assert.doesNotMatch(readFileSync(file, "utf8"), forbidden, path.relative(root, file))
  }
  assert.ok(files.size >= 4)
})

test("actual tarball imports and typechecks both auth subpaths with one Effect and declared dependencies only", () => {
  const temp = mkdtempSync(path.join(tmpdir(), "mcp-effect-sdk-wp6b-pack-"))
  try {
    execFileSync("pnpm", ["pack", "--pack-destination", temp], { cwd: root, stdio: "ignore" })
    execFileSync("tar", ["-xzf", path.join(temp, "mcp-effect-sdk-1.0.0.tgz"), "-C", temp])
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
    cpSync(packed, path.join(modules, "mcp-effect-sdk"), { recursive: true })
    for (const name of declared) linkInstalledPackage(name, modules)

    writeFileSync(path.join(consumer, "runtime.mjs"), `
      import { createRequire } from "node:module"
      import { realpathSync } from "node:fs"
      const client = await import(${JSON.stringify(clientSpecifier)})
      const protectedResource = await import(${JSON.stringify(protectedSpecifier)})
      for (const specifier of [
        "mcp-effect-sdk/auth/client/services",
        "mcp-effect-sdk/auth/protected-resource/models",
        "mcp-effect-sdk/auth/auth"
      ]) {
        try { await import(specifier); throw new Error("deep path resolved: " + specifier) }
        catch (error) { if (error.code !== "ERR_PACKAGE_PATH_NOT_EXPORTED") throw error }
      }
      const consumerRequire = createRequire(import.meta.url)
      const packageRequire = createRequire(import.meta.resolve(${JSON.stringify(clientSpecifier)}))
      console.log(JSON.stringify({
        client: Object.keys(client).sort(),
        protectedResource: Object.keys(protectedResource).sort(),
        oneEffect: realpathSync(consumerRequire.resolve("effect")) === realpathSync(packageRequire.resolve("effect"))
      }))
    `)
    const runtime = spawnSync(process.execPath, ["runtime.mjs"], { cwd: consumer, encoding: "utf8" })
    assert.equal(runtime.status, 0, runtime.stderr)
    assert.deepEqual(JSON.parse(runtime.stdout), { client: clientKeys, protectedResource: protectedKeys, oneEffect: true })

    writeFileSync(path.join(consumer, "index.ts"), `
      import * as Effect from "effect/Effect"
      import * as Option from "effect/Option"
      import * as Redacted from "effect/Redacted"
      import * as Schema from "effect/Schema"
      import * as Client from ${JSON.stringify(clientSpecifier)}
      import * as Protected from ${JSON.stringify(protectedSpecifier)}
      declare global {
        interface AbortSignal {}
        interface QueuingStrategy<Value = unknown> {}
        interface ReadableStream<Value = unknown> {}
        interface URL {}
      }
      const scopes = Schema.decodeUnknownSync(Client.AuthorizationScopeSet)(["tools.read"])
      const request: Client.AuthorizationHttpRequest = {
        method: "POST",
        url: "https://issuer.example/token",
        headers: [["authorization", Redacted.make("secret")]],
        body: Redacted.make(new Uint8Array())
      }
      const service: Client.AuthorizationClientService = {
        currentGrant: () => Effect.succeed(Option.none()),
        acquire: () => Effect.die("not run"),
        respondToChallenge: () => Effect.die("not run")
      }
      const verifier: Protected.TokenVerifierService = { verify: () => Effect.die("not run") }
      void request
      void service
      void verifier
      void scopes
    `)
    writeFileSync(path.join(consumer, "tsconfig.json"), JSON.stringify({
      compilerOptions: {
        target: "ES2022",
        module: "NodeNext",
        moduleResolution: "NodeNext",
        strict: true,
        skipLibCheck: false,
        lib: ["ES2022"],
        types: [],
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
