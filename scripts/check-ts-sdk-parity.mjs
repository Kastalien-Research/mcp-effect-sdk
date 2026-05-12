import { existsSync, readFileSync } from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"
import ts from "typescript"

const __filename = fileURLToPath(import.meta.url)
const root = path.resolve(path.dirname(__filename), "..")
const workspaceRoot = path.resolve(root, "..")
const referenceRoot = path.join(workspaceRoot, "tsc-sdk-reference")
const conformanceRoot = path.join(workspaceRoot, "conformance")

const failures = []

const requiredReferenceFiles = [
  "packages/core/src/auth/errors.ts",
  "packages/core/src/shared/auth.ts",
  "packages/core/src/shared/authUtils.ts",
  "packages/client/src/client/auth.ts",
  "packages/client/src/client/client.ts",
  "packages/client/src/client/streamableHttp.ts",
  "packages/client/src/client/sse.ts",
  "packages/client/src/client/stdio.ts",
  "packages/client/src/client/websocket.ts",
  "packages/middleware/express/src/middleware/hostHeaderValidation.ts",
  "packages/middleware/node/src/streamableHttp.ts",
  "packages/server/src/server/mcp.ts",
  "packages/server/src/server/middleware/hostHeaderValidation.ts",
  "packages/server/src/server/server.ts",
  "packages/server/src/server/streamableHttp.ts",
  "packages/server/src/server/stdio.ts",
  "test/conformance/src/everythingClient.ts",
  "test/conformance/src/everythingServer.ts",
  "test/conformance/src/helpers/conformanceOAuthProvider.ts",
  "test/conformance/src/helpers/withOAuthRetry.ts"
]

const requiredConformanceFiles = [
  "SDK_INTEGRATION.md",
  "src/index.ts",
  "src/runner/client.ts",
  "src/runner/server.ts",
  "src/scenarios/index.ts",
  "examples/servers/typescript/everything-server.ts",
  "examples/clients/typescript/everything-client.ts"
]

const localRequiredFiles = [
  "package.json",
  "scripts/verify.mjs",
  "scripts/run-conformance-suite.mjs",
  "scripts/check-conformance-evidence.mjs",
  "src/McpClient.ts",
  "src/McpServer.ts",
  "src/McpSchema.ts",
  "src/McpNotifications.ts",
  "src/index.ts",
  "src/examples/everything-server.ts",
  "src/transport/StdioServerTransport.ts",
  "src/transport/StreamableHttpServerTransport.ts",
  "src/transport/StdioClientTransport.ts",
  "src/transport/StreamableHttpClientTransport.ts",
  "src/transport/SseClientTransport.ts",
  "src/transport/WebSocketClientTransport.ts"
]

for (const file of requiredReferenceFiles) {
  requireReference(file)
}

for (const file of requiredConformanceFiles) {
  requireConformance(file)
}

for (const file of localRequiredFiles) {
  requireLocal(file)
}

const localPackageJson = readLocalJson("package.json")
const localScripts = localPackageJson.scripts ?? {}
const allLocalSource = [
  ...localRequiredFiles,
  "scripts/run-conformance-client-auth.mjs",
  "src/examples/everything-client.ts",
  "src/conformance/everything-client.ts",
  "src/auth/OAuthClientProvider.ts",
  "src/auth/auth.ts",
  "src/auth/providers.ts",
  "src/auth/errors.ts"
].map(readLocalIfExists).join("\n")

checkConformanceIntegrationContract()
checkSdkPublicSurfaceParity()
checkAuthParity()
checkTransportParity()
checkEverythingServerParity()
checkEverythingClientParity()
checkGeneratedBackedRouting()
checkRuntimeProof()

if (failures.length > 0) {
  console.error("TypeScript SDK parity check failed:")
  for (const failure of failures) {
    console.error(`- ${failure}`)
  }
  process.exit(1)
}

console.log("TypeScript SDK parity check passed.")

function checkConformanceIntegrationContract() {
  const guide = requireConformance("SDK_INTEGRATION.md")
  requireText(guide, "conformance SDK integration guide", "MCP_CONFORMANCE_SCENARIO")
  requireText(guide, "conformance SDK integration guide", "MCP_CONFORMANCE_CONTEXT")
  requireText(guide, "conformance SDK integration guide", "--suite auth")
  requireText(guide, "conformance SDK integration guide", "everything-client")
  requireText(guide, "conformance SDK integration guide", "everything-server")

  requireScript(
    "conformance:run",
    "node scripts/run-conformance-suite.mjs",
    "server conformance runner"
  )
  requireScript(
    "conformance:client-auth",
    "node scripts/run-conformance-client-auth.mjs",
    "client auth conformance runner"
  )

  const verify = requireLocal("scripts/verify.mjs")
  requireText(verify, "verify gate", "check:ts-sdk-parity")
  requireText(verify, "verify gate", "conformance:client-auth")

  const clientAuthRunner = requireLocal("scripts/run-conformance-client-auth.mjs")
  for (const text of [
    "test/conformance",
    "conformance",
    "client",
    "auth",
    "--output-dir",
    "--command"
  ]) {
    requireText(clientAuthRunner, "client auth conformance runner", text)
  }
}

function checkSdkPublicSurfaceParity() {
  const referenceClient = requireReference("packages/client/src/client/client.ts")
  const referenceServer = requireReference("packages/server/src/server/mcp.ts")
  const referenceLowLevelServer = requireReference("packages/server/src/server/server.ts")
  const localClient = requireLocal("src/McpClient.ts")
  const localServer = requireLocal("src/McpServer.ts")
  const localIndex = requireLocal("src/index.ts")

  for (const [label, referenceText, localText] of [
    ["tools/list client method", "async listTools(", "listTools:"],
    ["tools/call client method", "async callTool(", "callTool:"],
    ["resources/list client method", "async listResources(", "listResources:"],
    ["resources/read client method", "async readResource(", "readResource:"],
    ["resources/templates/list client method", "async listResourceTemplates(", "listResourceTemplates:"],
    ["resources/subscribe client method", "async subscribeResource(", "subscribe:"],
    ["resources/unsubscribe client method", "async unsubscribeResource(", "unsubscribe:"],
    ["prompts/list client method", "async listPrompts(", "listPrompts:"],
    ["prompts/get client method", "async getPrompt(", "getPrompt:"],
    ["completion/complete client method", "async complete(", "complete:"],
    ["logging/setLevel client method", "async setLoggingLevel(", "setLogLevel:"],
    ["ping client method", "async ping(", "ping:"]
  ]) {
    requireText(referenceClient, `TypeScript SDK ${label}`, referenceText)
    requireText(localClient, `Effect SDK ${label}`, localText)
  }

  for (const [label, referenceText, localText] of [
    ["tool registration", "registerTool<", "export const registerTool"],
    ["resource registration", "registerResource(", "export const registerResource"],
    ["resource templates", "export class ResourceTemplate", "addResourceTemplate"],
    ["prompt registration", "registerPrompt<", "export const registerPrompt"]
  ]) {
    requireText(referenceServer, `TypeScript SDK ${label}`, referenceText)
    requireText(localServer, `Effect SDK ${label}`, localText)
  }

  for (const [label, referenceText, localText] of [
    ["server sampling request helper", "async createMessage(", "export const sample"],
    ["server elicitation request helper", "async elicitInput(", "export const elicit"],
    ["server roots request helper", "async listRoots(", "export const listRoots"],
    ["server logging notification helper", "async sendLoggingMessage(", "export const sendLoggingMessage"],
    ["server resource update notification helper", "async sendResourceUpdated(", "export const sendResourceUpdated"]
  ]) {
    requireText(referenceLowLevelServer, `TypeScript SDK ${label}`, referenceText)
    requireText(localServer, `Effect SDK ${label}`, localText)
  }

  for (const text of [
    "export * as SamplingHandler",
    "export * as ElicitationHandler",
    "export * as RootsProvider",
    "export * as StdioServerTransport",
    "export * as StreamableHttpServerTransport",
    "export * as StdioClientTransport",
    "export * as StreamableHttpClientTransport",
    "export * as SseClientTransport",
    "export * as WebSocketClientTransport"
  ]) {
    requireText(localIndex, "Effect SDK root exports", text)
  }
}

function checkAuthParity() {
  const referenceAuthSource = [
    "packages/client/src/client/auth.ts",
    "packages/client/src/client/streamableHttp.ts",
    "packages/core/src/auth/errors.ts",
    "packages/core/src/shared/auth.ts",
    "packages/core/src/shared/authUtils.ts",
    "test/conformance/src/everythingClient.ts",
    "test/conformance/src/helpers/conformanceOAuthProvider.ts",
    "test/conformance/src/helpers/withOAuthRetry.ts"
  ].map(requireReference).join("\n")

  for (const text of [
    "export interface OAuthClientProvider",
    "OAuthClientMetadata",
    "OAuthClientInformation",
    "OAuthTokens",
    "redirectToAuthorization",
    "saveCodeVerifier",
    "codeVerifier",
    "addClientAuthentication",
    "validateResourceURL",
    "invalidateCredentials",
    "saveDiscoveryState",
    "discoveryState"
  ]) {
    requireText(referenceAuthSource, "TypeScript SDK OAuth client provider", text)
    requireText(allLocalSource, "Effect SDK OAuth client provider parity", text)
  }

  for (const text of [
    "UnauthorizedError",
    "WWW-Authenticate",
    "OAuthProtectedResourceMetadata",
    "OAuthMetadata",
    "resourceUrlFromServerUrl",
    "checkResourceAllowed"
  ]) {
    requireText(referenceAuthSource, "TypeScript SDK OAuth core helpers", text)
    requireText(allLocalSource, "Effect SDK OAuth core helper parity", text)
  }

  for (const text of [
    "ConformanceOAuthProvider",
    "withOAuthRetry",
    "ClientCredentialsProvider",
    "PrivateKeyJwtProvider",
    "auth/client-credentials-jwt",
    "auth/client-credentials-basic",
    "auth/pre-registration",
    "auth/cross-app-access-complete-flow"
  ]) {
    requireText(referenceAuthSource, "TypeScript SDK auth conformance client", text)
    requireText(allLocalSource, "Effect SDK auth conformance client parity", text)
  }
}

function checkTransportParity() {
  const referenceServerTransport = requireReference("packages/server/src/server/streamableHttp.ts")
  const referenceTransportSecuritySource = [
    "packages/client/src/client/auth.ts",
    "packages/client/src/client/streamableHttp.ts",
    "packages/middleware/express/src/middleware/hostHeaderValidation.ts",
    "packages/middleware/node/src/streamableHttp.ts",
    "packages/server/src/server/middleware/hostHeaderValidation.ts",
    "packages/server/src/server/streamableHttp.ts"
  ].map(requireReference).join("\n")
  const localServerTransport = requireLocal("src/transport/StreamableHttpServerTransport.ts")
  const localHttpClient = requireLocal("src/transport/HttpTransport.ts")
  const localSseClient = requireLocal("src/transport/SseClientTransport.ts")
  const localWebSocketClient = requireLocal("src/transport/WebSocketClientTransport.ts")

  for (const text of [
    "sessionIdGenerator",
    "onsessioninitialized",
    "onsessionclosed",
    "enableJsonResponse",
    "eventStore",
    "retryInterval",
    "supportedProtocolVersions",
    "authInfo",
    "handleRequest",
    "DELETE",
    "GET"
  ]) {
    requireText(referenceServerTransport, "TypeScript SDK streamable HTTP server transport", text)
    requireText(
      localServerTransport,
      "Effect SDK streamable HTTP server transport parity",
      text
    )
  }

  for (const text of [
    "allowedHosts",
    "allowedOrigins",
    "enableDnsRebindingProtection",
    "authorization",
    "Bearer"
  ]) {
    requireText(
      referenceTransportSecuritySource,
      "TypeScript SDK HTTP security/auth transport behavior",
      text
    )
    requireText(allLocalSource, "Effect SDK HTTP security/auth transport parity", text)
  }

  for (const [fileLabel, source] of [
    ["Effect SDK streamable HTTP client transport", localHttpClient],
    ["Effect SDK SSE client transport", localSseClient],
    ["Effect SDK WebSocket client transport", localWebSocketClient]
  ]) {
    if (source.includes("not implemented")) {
      failures.push(`${fileLabel} contains a non-implementation marker.`)
    }
  }
}

function checkEverythingServerParity() {
  const referenceEverythingServer = requireConformance(
    "examples/servers/typescript/everything-server.ts"
  )
  const localEverythingServer = requireLocal("src/examples/everything-server.ts")
  const localServerAst = inspectTypeScriptSource(
    "src/examples/everything-server.ts",
    localEverythingServer
  )

  for (const text of [
    "registerTool",
    "registerResource",
    "registerPrompt",
    "StreamableHTTPServerTransport",
    "test_tool_with_logging",
    "test_tool_with_progress",
    "test_sampling",
    "test_elicitation",
    "test_elicitation_sep1034_defaults",
    "test_elicitation_sep1330_enums",
    "json_schema_2020_12_tool",
    "test_prompt_with_embedded_resource"
  ]) {
    requireText(referenceEverythingServer, "TypeScript conformance Everything server", text)
  }

  for (const text of [
    "McpServer.registerTool",
    "McpServer.registerResource",
    "McpServer.registerPrompt",
    "StreamableHttpServerTransport",
    "test_tool_with_logging",
    "test_tool_with_progress",
    "test_sampling",
    "test_elicitation",
    "test_elicitation_sep1034_defaults",
    "test_elicitation_sep1330_enums",
    "json_schema_2020_12_tool",
    "test_prompt_with_embedded_resource"
  ]) {
    requireText(localEverythingServer, "Effect SDK conformance Everything server", text)
  }

  requireNamespaceImport(
    localServerAst,
    "Effect SDK conformance Everything server",
    "McpServer",
    "../McpServer.js"
  )
  requireNamespaceImport(
    localServerAst,
    "Effect SDK conformance Everything server",
    "StreamableHttpServerTransport",
    "../transport/StreamableHttpServerTransport.js"
  )
  for (const call of [
    "McpServer.registerTool",
    "McpServer.registerResource",
    "McpServer.registerPrompt",
    "McpServer.sample",
    "McpServer.elicit",
    "McpServer.sendLoggingMessage",
    "McpServer.sendProgress",
    "StreamableHttpServerTransport.toWebHandler"
  ]) {
    requireAstCall(localServerAst, "Effect SDK conformance Everything server", call)
  }
  for (const toolName of [
    "test_tool_with_logging",
    "test_tool_with_progress",
    "test_sampling",
    "test_elicitation",
    "test_elicitation_sep1034_defaults",
    "test_elicitation_sep1330_enums",
    "json_schema_2020_12_tool"
  ]) {
    requireRegisteredName(
      localServerAst,
      "Effect SDK conformance Everything server tool registration",
      "McpServer.registerTool",
      toolName
    )
  }
  requireRegisteredName(
    localServerAst,
    "Effect SDK conformance Everything server prompt registration",
    "McpServer.registerPrompt",
    "test_prompt_with_embedded_resource"
  )
  for (const forbidden of [
    "tools",
    "resources",
    "prompts"
  ]) {
    rejectArrayFixtureDeclaration(
      localServerAst,
      "Effect SDK conformance Everything server",
      forbidden
    )
  }
  for (const forbidden of [
    "handleMessage",
    "callTool",
    "readResource",
    "getPrompt"
  ]) {
    rejectFunctionDeclaration(
      localServerAst,
      "Effect SDK conformance Everything server",
      forbidden
    )
  }

  for (const forbidden of [
    "const tools = [",
    "const resources = [",
    "const prompts = [",
    "function handleMessage(",
    "function callTool(",
    "function readResource(",
    "function getPrompt("
  ]) {
    rejectText(localEverythingServer, "Effect SDK conformance Everything server", forbidden)
  }
}

function checkEverythingClientParity() {
  const referenceEverythingClient = requireReference("test/conformance/src/everythingClient.ts")
  for (const text of [
    "MCP_CONFORMANCE_SCENARIO",
    "MCP_CONFORMANCE_CONTEXT",
    "registerScenario",
    "registerScenarios",
    "runAuthClient",
    "withOAuthRetry",
    "ClientCredentialsProvider",
    "PrivateKeyJwtProvider",
    "auth/client-credentials-jwt",
    "auth/client-credentials-basic"
  ]) {
    requireText(referenceEverythingClient, "TypeScript SDK Everything client", text)
    requireText(allLocalSource, "Effect SDK Everything client parity", text)
  }
}

function checkGeneratedBackedRouting() {
  const localServer = requireLocal("src/McpServer.ts")
  const localClient = requireLocal("src/McpClient.ts")
  const localNotifications = requireLocal("src/McpNotifications.ts")
  const protocol = requireLocal("src/generated/mcp/McpProtocol.generated.ts")

  for (const text of [
    "CLIENT_REQUEST_DESCRIPTORS",
    "SERVER_REQUEST_DESCRIPTORS",
    "CLIENT_NOTIFICATION_DESCRIPTORS",
    "SERVER_NOTIFICATION_DESCRIPTORS",
    "CLIENT_REQUEST_METHOD_BY_TYPE",
    "SERVER_REQUEST_METHOD_BY_TYPE",
    "CLIENT_NOTIFICATION_METHOD_BY_TYPE",
    "SERVER_NOTIFICATION_METHOD_BY_TYPE"
  ]) {
    requireText(protocol, "generated MCP protocol metadata", text)
  }

  for (const text of [
    "CLIENT_REQUEST_METHOD_BY_TYPE",
    "SERVER_REQUEST_METHOD_BY_TYPE"
  ]) {
    requireText(localClient, "Effect SDK client generated-backed routing", text)
  }

  for (const text of [
    "CLIENT_REQUEST_METHOD_BY_TYPE",
    "SERVER_REQUEST_METHOD_BY_TYPE",
    "CLIENT_NOTIFICATION_METHOD_BY_TYPE",
    "SERVER_NOTIFICATION_METHOD_BY_TYPE"
  ]) {
    requireText(localServer, "Effect SDK server generated-backed routing", text)
  }

  for (const text of [
    "CLIENT_NOTIFICATION_METHOD_BY_TYPE",
    "SERVER_NOTIFICATION_METHOD_BY_TYPE"
  ]) {
    requireText(localNotifications, "Effect SDK notification generated-backed routing", text)
  }
}

function checkRuntimeProof() {
  const runtimeProof = requireLocal("scripts/check-sdk-runtime.mjs")
  for (const text of [
    "McpServer.registerTool",
    "server.callTool",
    "McpServer.registerResource",
    "server.findResource",
    "McpServer.registerPrompt",
    "server.getPromptResult",
    "McpServer.sample",
    "McpServer.listRoots",
    "McpServer.elicit",
    "McpServer.sendLoggingMessage",
    "McpServer.sendProgress"
  ]) {
    requireText(runtimeProof, "Effect SDK runtime proof", text)
  }
}

function requireScript(name, command, label) {
  if (!String(localScripts[name] ?? "").includes(command)) {
    failures.push(`package.json missing ${label}: script ${name} must include ${command}`)
  }
}

function requireText(source, label, text) {
  if (!source.includes(text)) {
    failures.push(`${label} missing: ${text}`)
  }
}

function rejectText(source, label, text) {
  if (source.includes(text)) {
    failures.push(`${label} must not contain: ${text}`)
  }
}

function requireLocal(relativePath) {
  return requireFile(root, relativePath, "local SDK")
}

function requireReference(relativePath) {
  return requireFile(referenceRoot, relativePath, "TypeScript SDK reference")
}

function requireConformance(relativePath) {
  return requireFile(conformanceRoot, relativePath, "MCP conformance reference")
}

function requireFile(base, relativePath, label) {
  const file = path.join(base, relativePath)
  if (!existsSync(file)) {
    failures.push(`Missing ${label} file: ${relativePath}`)
    return ""
  }
  return readFileSync(file, "utf8")
}

function readLocalIfExists(relativePath) {
  const file = path.join(root, relativePath)
  return existsSync(file) ? readFileSync(file, "utf8") : ""
}

function readLocalJson(relativePath) {
  const source = requireLocal(relativePath)
  if (!source) {
    return {}
  }
  return JSON.parse(source)
}

function inspectTypeScriptSource(relativePath, source) {
  const sourceFile = ts.createSourceFile(
    relativePath,
    source,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS
  )
  const analysis = {
    calls: new Map(),
    namespaceImports: new Map(),
    registeredNames: new Map(),
    arrayDeclarations: new Set(),
    functionDeclarations: new Set()
  }

  const visit = (node) => {
    if (ts.isImportDeclaration(node) && node.importClause?.namedBindings) {
      const namedBindings = node.importClause.namedBindings
      if (ts.isNamespaceImport(namedBindings) && ts.isStringLiteral(node.moduleSpecifier)) {
        analysis.namespaceImports.set(namedBindings.name.text, node.moduleSpecifier.text)
      }
    }

    if (ts.isCallExpression(node)) {
      const callName = propertyAccessName(node.expression)
      if (callName) {
        analysis.calls.set(callName, (analysis.calls.get(callName) ?? 0) + 1)
        collectRegisteredName(analysis, callName, node.arguments[0])
      }
    }

    if (
      ts.isVariableDeclaration(node) &&
      ts.isIdentifier(node.name) &&
      node.initializer &&
      ts.isArrayLiteralExpression(node.initializer)
    ) {
      analysis.arrayDeclarations.add(node.name.text)
    }

    if (ts.isFunctionDeclaration(node) && node.name) {
      analysis.functionDeclarations.add(node.name.text)
    }

    ts.forEachChild(node, visit)
  }

  visit(sourceFile)
  return analysis
}

function collectRegisteredName(analysis, callName, argument) {
  if (!argument || !ts.isObjectLiteralExpression(argument)) {
    return
  }
  const nameProperty = argument.properties.find((property) =>
    ts.isPropertyAssignment(property) &&
    property.name &&
    ts.isIdentifier(property.name) &&
    property.name.text === "name"
  )
  if (
    !nameProperty ||
    !ts.isPropertyAssignment(nameProperty) ||
    !ts.isStringLiteral(nameProperty.initializer)
  ) {
    return
  }
  const names = analysis.registeredNames.get(callName) ?? new Set()
  names.add(nameProperty.initializer.text)
  analysis.registeredNames.set(callName, names)
}

function propertyAccessName(expression) {
  if (!ts.isPropertyAccessExpression(expression) || !ts.isIdentifier(expression.expression)) {
    return undefined
  }
  return `${expression.expression.text}.${expression.name.text}`
}

function requireNamespaceImport(analysis, label, name, modulePath) {
  if (analysis.namespaceImports.get(name) !== modulePath) {
    failures.push(`${label} must import ${name} from ${modulePath}`)
  }
}

function requireAstCall(analysis, label, callName) {
  if (!analysis.calls.has(callName)) {
    failures.push(`${label} must call ${callName}`)
  }
}

function requireRegisteredName(analysis, label, callName, name) {
  if (!analysis.registeredNames.get(callName)?.has(name)) {
    failures.push(`${label} missing ${callName} name: ${name}`)
  }
}

function rejectArrayFixtureDeclaration(analysis, label, name) {
  if (analysis.arrayDeclarations.has(name)) {
    failures.push(`${label} must not declare array fixture: ${name}`)
  }
}

function rejectFunctionDeclaration(analysis, label, name) {
  if (analysis.functionDeclarations.has(name)) {
    failures.push(`${label} must not declare raw handler function: ${name}`)
  }
}
