import { existsSync, readFileSync } from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")
const failures = []
const read = (relative) => {
  const absolute = path.join(root, relative)
  if (!existsSync(absolute)) {
    failures.push(`Missing local parity input: ${relative}`)
    return ""
  }
  return readFileSync(absolute, "utf8")
}
const json = (relative) => {
  const source = read(relative)
  if (!source) return {}
  try {
    return JSON.parse(source)
  } catch {
    failures.push(`Invalid JSON parity input: ${relative}`)
    return {}
  }
}

const TARGET_VERSION = "2026-07-28"
const CORE_REVISION = "26897cc322f356487da89113451bd16b520b9288"
const TS_SDK_REVISION = "e81758caed29f6568ce8873f7f9a3bd65b017d9c"
const TS_SDK_VERSION = "2.0.0-beta.4"
const EXPECTED_CLIENT_METHODS = [
  "server/discover",
  "completion/complete",
  "prompts/get",
  "prompts/list",
  "resources/list",
  "resources/templates/list",
  "resources/read",
  "subscriptions/listen",
  "tools/call",
  "tools/list"
]
const EXPECTED_CLIENT_NOTIFICATIONS = ["notifications/cancelled"]
const EXPECTED_SERVER_NOTIFICATIONS = [
  "notifications/cancelled",
  "notifications/progress",
  "notifications/message",
  "notifications/resources/updated",
  "notifications/resources/list_changed",
  "notifications/tools/list_changed",
  "notifications/prompts/list_changed",
  "notifications/subscriptions/acknowledged"
]
const ACCOUNTED_IDS = [
  "wp5-core-feature-surface",
  "wp6-auth-hardening",
  "wp7-tasks-profile",
  "wp8-apps-server-view",
  "wp9-apps-host-preview",
  "wp10-release-candidate-qualification",
  "wp11-final-reconciliation-release"
]
const ACCOUNTED_WORK_PACKAGES = ["WP5", "WP6", "WP7", "WP8", "WP9", "WP10", "WP11"]

checkFrozenAuthority()
checkGeneratedProtocol()
checkModernClientAndTransportBoundary()
checkPackageBoundary()
checkExamplesAndRuntimeProof()
checkVerificationOwnership()
checkDeferredLedger()

if (failures.length > 0) {
  console.error("Frozen TypeScript SDK parity check failed:")
  for (const failure of failures) console.error(`- ${failure}`)
  process.exit(1)
}

console.log("Frozen MCP 2026-07-28 TypeScript SDK parity and deferred ledger pass.")

function checkFrozenAuthority() {
  const manifest = json("sources/manifest.json")
  equal(manifest.protocolVersion, TARGET_VERSION, "source manifest protocol version")
  const core = manifest.sources?.find(({ id }) => id === "mcp-core")
  equal(core?.revision, CORE_REVISION, "normative MCP core revision")
  equal(core?.role, "Normative MCP core contract and authoritative generated-schema input", "MCP core authority role")
  const oracle = manifest.sources?.find(({ id }) => id === "typescript-sdk-v2")
  equal(oracle?.revision, TS_SDK_REVISION, "TypeScript SDK oracle revision")
  equal(oracle?.version, TS_SDK_VERSION, "TypeScript SDK oracle version")
  equal(oracle?.role, "Differential design oracle only; never normative or runtime proof", "TypeScript SDK oracle role")

  const clientPackage = json("sources/vendor/typescript-sdk-v2/client-package.json")
  const serverPackage = json("sources/vendor/typescript-sdk-v2/server-package.json")
  equal(clientPackage.name, "@modelcontextprotocol/client", "vendored client oracle identity")
  equal(serverPackage.name, "@modelcontextprotocol/server", "vendored server oracle identity")
  equal(clientPackage.version, TS_SDK_VERSION, "vendored client oracle version")
  equal(serverPackage.version, TS_SDK_VERSION, "vendored server oracle version")
}

function checkGeneratedProtocol() {
  const protocol = read("src/generated/mcp/2026-07-28/McpProtocol.generated.ts")
  equal(constString(protocol, "LATEST_PROTOCOL_VERSION"), TARGET_VERSION, "generated protocol version")
  deepEqual(constStringArray(protocol, "CLIENT_REQUEST_METHODS"), EXPECTED_CLIENT_METHODS, "generated client requests")
  deepEqual(constStringArray(protocol, "CLIENT_NOTIFICATION_METHODS"), EXPECTED_CLIENT_NOTIFICATIONS, "generated client notifications")
  deepEqual(constStringArray(protocol, "SERVER_REQUEST_METHODS"), [], "generated server requests")
  deepEqual(constStringArray(protocol, "SERVER_NOTIFICATION_METHODS"), EXPECTED_SERVER_NOTIFICATIONS, "generated server notifications")
}

function checkModernClientAndTransportBoundary() {
  const client = read("src/McpClient.ts")
  for (const member of [
    "discover",
    "listTools",
    "callTool",
    "listResources",
    "listResourceTemplates",
    "readResource",
    "listPrompts",
    "getPrompt",
    "complete",
    "subscriptionsListen"
  ]) requirePattern(client, new RegExp(`readonly\\s+${member}\\s*:`), `McpClient.${member}`)
  for (const legacy of ["ping", "subscribe", "unsubscribe", "setLogLevel", "sendCancelled"]) {
    rejectPattern(client, new RegExp(`readonly\\s+${legacy}\\s*:`), `legacy McpClient.${legacy}`)
  }
  requirePattern(
    client,
    /readonly\s+transport:\s*McpTransport<TransportError>/,
    "object-form McpTransport client constructor"
  )
  requireText(client, "transport.request(request)", "direct request-stream consumption")
  rejectPattern(client, /Queue\.Dequeue|McpClientProtocol/, "client-owned direct queues or compatibility protocol")

  const transport = read("src/McpTransport.ts")
  requirePattern(transport, /request:\s*\(request:\s*JsonRpcRequest\)\s*=>\s*Stream\.Stream<ClientFrame,\s*E>/, "public request-stream transport")
  for (const relative of [
    "src/transport/StdioClientTransport.ts",
    "src/transport/StreamableHttpClientTransport.ts"
  ]) {
    const source = read(relative)
    requireText(source, "McpTransport<", `${relative} McpTransport result`)
    rejectPattern(source, /makeCompatibilityProtocol|McpClientProtocol/, `${relative} compatibility bridge`)
  }
  const stdio = read("src/transport/StdioClientTransport.ts")
  requireText(stdio, 'method: "notifications/cancelled"', "stdio interruption cancellation")

  const httpClient = read("src/transport/StreamableHttpClientTransport.ts")
  const httpServer = read("src/transport/StreamableHttpServerTransport.ts")
  requireText(httpClient, "standardRequestHeaders", "generated-backed HTTP client metadata")
  requireText(httpServer, 'request.method !== "POST"', "POST-only HTTP server")
  for (const source of [httpClient, httpServer]) {
    rejectPattern(source, /Mcp-Session-Id|sessionIdGenerator|onsessioninitialized|Last-Event-ID\s*:/, "session-era HTTP API")
  }
}

function checkPackageBoundary() {
  const packageJson = json("package.json")
  deepEqual(packageJson.exports?.["./deprecated"], {
    import: "./dist/deprecated.js",
    types: "./dist/deprecated.d.ts"
  }, "deprecated package subpath")

  const index = read("src/index.ts")
  const exports = [...index.matchAll(/export \* as (\w+) from/g)].map((match) => match[1])
  for (const name of [
    "StdioClientTransport",
    "StdioServerTransport",
    "StreamableHttpClientTransport",
    "StreamableHttpServerTransport"
  ]) includes(exports, name, `modern root export ${name}`)
  for (const name of [
    "HttpTransport",
    "StdioTransport",
    "SseClientTransport",
    "WebSocketClientTransport",
    "McpClientProtocol",
    "SamplingHandler",
    "RootsProvider"
  ]) excludes(exports, name, `removed root export ${name}`)

  for (const relative of [
    "src/McpClientProtocol.ts",
    "src/McpSerialization.ts",
    "src/transport/HttpTransport.ts",
    "src/transport/SseClientTransport.ts",
    "src/transport/WebSocketClientTransport.ts"
  ]) {
    if (existsSync(path.join(root, relative))) failures.push(`Deleted legacy source returned: ${relative}`)
  }

  const deprecated = read("src/deprecated.ts")
  for (const name of ["SamplingHandler", "RootsProvider", "sendLoggingMessage"]) {
    requireText(deprecated, name, `deprecated hook ${name}`)
  }
  rejectText(deprecated, "ElicitationHandler", "stable Elicitation deprecated service")
  requirePattern(deprecated, /@deprecated/g, "deprecated API annotations")
}

function checkExamplesAndRuntimeProof() {
  const clientExample = read("src/examples/everything-client.ts")
  const catalog = read("src/examples/core-protocol-catalog.ts")
  for (const source of [clientExample, catalog]) {
    requireText(source, "StreamableHttpClientTransport.make", "modern HTTP client example")
    requirePattern(source, /McpClient(?:Api)?\.make\(\{\s*transport,/, "object-form McpClient example")
  }
  requireText(catalog, "StdioClientTransport.make", "modern stdio client example")
  const runtime = read("scripts/check-sdk-runtime.mjs")
  requireText(runtime, 'from "../dist/deprecated.js"', "deprecated runtime import")
  requireText(runtime, "sendLoggingMessage", "deprecated logging runtime proof")
  rejectText(runtime, "initializePayload", "session-era runtime fixture")
}

function checkVerificationOwnership() {
  const packageJson = json("package.json")
  for (const name of [
    "check:ts-sdk-parity",
    "test:wp4-http",
    "test:wp4-transports",
    "e2e:draft",
    "conformance:client",
    "conformance:client-auth"
  ]) {
    if (typeof packageJson.scripts?.[name] !== "string") failures.push(`Missing package script: ${name}`)
  }
  const verify = read("scripts/verify.mjs")
  for (const gate of [
    "check:ts-sdk-parity",
    "test:wp4-http",
    "test:wp4-transports",
    "e2e:draft",
    "verify:conformance"
  ]) requireText(verify, `"${gate}"`, `verify gate ${gate}`)
  rejectText(verify, "conformance:client-auth", "package-health verify auth conformance coupling")

  const conformance = json("test/conformance/package.json")
  equal(conformance.devDependencies?.["@modelcontextprotocol/conformance"], "0.2.0-alpha.9", "frozen conformance package")
}

function checkDeferredLedger() {
  const ledger = json("docs/conformance/ts-sdk-parity-deferred.json")
  equal(ledger.schemaVersion, 2, "deferred ledger schema version")
  deepEqual(ledger.target, { protocolVersion: TARGET_VERSION, coreRevision: CORE_REVISION }, "deferred ledger target")
  deepEqual(ledger.oracle, {
    role: "differential-only",
    package: "@modelcontextprotocol/client",
    version: TS_SDK_VERSION,
    revision: TS_SDK_REVISION
  }, "deferred ledger oracle")
  deepEqual(ledger.items?.map(({ id }) => id), ACCOUNTED_IDS, "accounted ledger ids")
  equal(new Set((ledger.items ?? []).map(({ id }) => id)).size, ACCOUNTED_IDS.length,
    "accounted ledger unique id count")
  for (const [index, item] of (ledger.items ?? []).entries()) {
    const expectedKeys = [
      "expectations",
      "id",
      "notImplementedInWP4",
      "status",
      "workPackage"
    ]
    if (index === 0 || index === 1) expectedKeys.push("evidence")
    deepEqual(Object.keys(item).sort(), expectedKeys.sort(), `${item.id} exact fields`)
    equal(item.status, index <= 1 ? "implemented-locally" : "deferred", `${item.id} status`)
    equal(item.workPackage, ACCOUNTED_WORK_PACKAGES[index], `${item.id} work package`)
    for (const field of ["expectations", "notImplementedInWP4"]) {
      if (!Array.isArray(item[field]) || item[field].length === 0 ||
        item[field].some((value) => typeof value !== "string" || value.trim().length === 0)) {
        failures.push(`${item.id} must retain non-empty ${field} strings`)
      }
    }
    if (index === 0) {
      deepEqual(item.evidence, {
        report: ".superpowers/sdd/task-5-report.md",
        verificationCommands: ["pnpm run test:wp5-core", "pnpm run verify"],
        remoteIssueDisposition: "approval-required",
        qualification: "not-official-conformance-release-or-tier-evidence"
      }, "WP5 local implementation evidence boundary")
    }
    if (index === 1) {
      deepEqual(item.evidence, {
        report: ".superpowers/sdd/task-6-report.md",
        verificationCommands: [
          "pnpm run test:wp6",
          "pnpm run verify",
          "pnpm run conformance:client-auth"
        ],
        remoteIssueDisposition: "approval-required",
        externalAuthorizationQualification: "blocked-missing-approved-target",
        qualification: "local-client-auth-evidence-is-not-external-authorization-release-or-tier-evidence"
      }, "WP6 local implementation evidence boundary")
    }
  }
}

function constString(source, name) {
  return source.match(new RegExp(`export const ${name} = "([^"]+)" as const`))?.[1]
}

function constStringArray(source, name) {
  const body = source.match(new RegExp(`export const ${name} = \\[([\\s\\S]*?)\\] as const`))?.[1]
  if (body === undefined) return undefined
  return [...body.matchAll(/"([^"]+)"/g)].map((match) => match[1])
}

function equal(actual, expected, label) {
  if (actual !== expected) failures.push(`${label}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`)
}

function deepEqual(actual, expected, label) {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    failures.push(`${label}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`)
  }
}

function includes(values, expected, label) {
  if (!values.includes(expected)) failures.push(`${label} is missing`)
}

function excludes(values, forbidden, label) {
  if (values.includes(forbidden)) failures.push(`${label} is still present`)
}

function requireText(source, text, label) {
  if (!source.includes(text)) failures.push(`${label} is missing: ${text}`)
}

function rejectText(source, text, label) {
  if (source.includes(text)) failures.push(`${label} must not contain: ${text}`)
}

function requirePattern(source, pattern, label) {
  if (!pattern.test(source)) failures.push(`${label} is missing pattern: ${pattern}`)
}

function rejectPattern(source, pattern, label) {
  if (pattern.test(source)) failures.push(`${label} must not match: ${pattern}`)
}
