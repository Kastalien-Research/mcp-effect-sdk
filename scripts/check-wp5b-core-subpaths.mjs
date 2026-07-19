import assert from "node:assert/strict"
import { existsSync, readFileSync } from "node:fs"
import { builtinModules } from "node:module"
import path from "node:path"
import { fileURLToPath } from "node:url"
import ts from "typescript"

const scriptRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")
const defaultEntrypoints = [
  "dist/client.d.ts",
  "dist/server.d.ts",
  "dist/protocol/2026-07-28.d.ts",
  "dist/client.js",
  "dist/server.js",
  "dist/protocol/2026-07-28.js"
]
const defaultDeclarationExports = new Map([
  ["dist/client.d.ts", [
    "CacheableClientMethod",
    "ClientCapabilitiesProvider",
    "ClientExtensionCapabilities",
    "ClientExtensionsProvider",
    "ClientRequestProfileContext",
    "ClientResultForMethod",
    "CoreClientCapabilities",
    "McpCache",
    "McpCacheAuthorization",
    "McpCacheAuthorizationProvider",
    "McpCacheEntry",
    "McpCacheError",
    "McpCacheKey",
    "McpCacheSelector",
    "McpCacheService",
    "McpClient",
    "McpClientError",
    "McpClientErrorReason",
    "McpClientOptions",
    "McpTransport",
    "SubscriptionFilter",
    "make",
    "serverInfoFromResult"
  ].sort()],
  ["dist/server.d.ts", [
    "CompiledJsonSchema",
    "ExtensionCapabilities",
    "JsonSchema",
    "JsonSchemaResolver",
    "JsonSchemaResolverOptions",
    "JsonSchemaResolverPolicy",
    "JsonSchemaResolverService",
    "JsonSchemaValidator",
    "JsonSchemaValidatorService",
    "McpServer",
    "McpServerOptions",
    "McpServerService",
    "PaginatedCollection",
    "PaginationCursor",
    "PaginationCursorService",
    "PaginationCursorState",
    "PaginationPolicy",
    "ServerNotification",
    "ServerScope",
    "ResolvedJsonSchemaBytes",
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
  ].sort()],
  ["dist/protocol/2026-07-28.d.ts", [
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
  ].sort()]
])
const forbiddenDomNames = /\b(?:Window|Document|HTMLElement|MessageEvent)\b/
const forbiddenDomLib = /\blib=["']dom(?:\.iterable)?["']/i
const builtins = new Set(builtinModules.map((specifier) => specifier.replace(/^node:/, "")))

const parseArguments = (arguments_) => {
  let root = scriptRoot
  const entrypoints = []
  let expectedExports
  for (let index = 0; index < arguments_.length; index += 1) {
    const argument = arguments_[index]
    const value = arguments_[index + 1]
    if (argument === "--root" && value !== undefined) {
      root = path.resolve(value)
      index += 1
    } else if (argument === "--entrypoint" && value !== undefined) {
      entrypoints.push(value)
      index += 1
    } else if (argument === "--expected-exports" && value !== undefined) {
      expectedExports = value === "" ? [] : value.split(",").map((name) => name.trim()).sort()
      index += 1
    } else {
      throw new Error(`unknown or incomplete argument: ${argument}`)
    }
  }
  const usesDefaultEntrypoints = entrypoints.length === 0
  return {
    root,
    entrypoints: usesDefaultEntrypoints ? defaultEntrypoints : entrypoints,
    expectedExports,
    usesDefaultEntrypoints
  }
}

const isDeclaration = (relative) => /\.d\.[cm]?ts$/.test(relative)

const moduleSpecifiers = (sourceFile) => {
  const specifiers = []
  const add = (node) => {
    if (node !== undefined && ts.isStringLiteralLike(node)) specifiers.push(node.text)
  }
  const visit = (node) => {
    if (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) {
      add(node.moduleSpecifier)
    } else if (ts.isImportEqualsDeclaration(node) &&
      ts.isExternalModuleReference(node.moduleReference)) {
      add(node.moduleReference.expression)
    } else if (ts.isCallExpression(node)) {
      const isDynamicImport = node.expression.kind === ts.SyntaxKind.ImportKeyword
      const isRequire = ts.isIdentifier(node.expression) && node.expression.text === "require"
      const isRequireResolve = ts.isPropertyAccessExpression(node.expression) &&
        ts.isIdentifier(node.expression.expression) &&
        node.expression.expression.text === "require" &&
        node.expression.name.text === "resolve"
      if (isDynamicImport || isRequire || isRequireResolve) add(node.arguments[0])
    } else if (ts.isImportTypeNode(node) && ts.isLiteralTypeNode(node.argument)) {
      add(node.argument.literal)
    }
    ts.forEachChild(node, visit)
  }
  visit(sourceFile)
  return specifiers
}

const isNodeBuiltin = (specifier) => {
  if (specifier.startsWith("node:")) return true
  if (specifier.startsWith("@")) return false
  return builtins.has(specifier) || builtins.has(specifier.split("/")[0])
}

const localCandidates = (relative, specifier) => {
  const resolved = path.posix.normalize(path.posix.join(path.posix.dirname(relative), specifier))
  if (isDeclaration(relative)) {
    if (resolved.endsWith(".js")) return [`${resolved.slice(0, -3)}.d.ts`, resolved]
    if (resolved.endsWith(".mjs")) return [`${resolved.slice(0, -4)}.d.mts`, resolved]
    if (resolved.endsWith(".cjs")) return [`${resolved.slice(0, -4)}.d.cts`, resolved]
    return [resolved, `${resolved}.d.ts`, path.posix.join(resolved, "index.d.ts")]
  }
  return [resolved, `${resolved}.js`, `${resolved}.mjs`, `${resolved}.cjs`, path.posix.join(resolved, "index.js")]
}

const resolveLocal = (root, relative, specifier) => {
  const candidates = localCandidates(relative, specifier)
  const resolved = candidates.find((candidate) => existsSync(path.join(root, candidate)))
  assert.notEqual(resolved, undefined, `unresolved local dependency ${specifier} from ${relative}`)
  return resolved
}

const { root, entrypoints, expectedExports, usesDefaultEntrypoints } = parseArguments(process.argv.slice(2))
const visited = new Set()
const pending = [...entrypoints]
while (pending.length > 0) {
  const relative = pending.pop()
  if (relative === undefined || visited.has(relative)) continue
  visited.add(relative)
  const absolute = path.join(root, relative)
  assert.equal(existsSync(absolute), true, `missing core output: ${relative}`)
  const source = readFileSync(absolute, "utf8")
  assert.doesNotMatch(source, forbiddenDomNames, `${relative} must be DOM-free`)
  assert.doesNotMatch(source, forbiddenDomLib, `${relative} must not reference the DOM library`)
  const sourceFile = ts.createSourceFile(
    absolute,
    source,
    ts.ScriptTarget.Latest,
    true,
    isDeclaration(relative) ? ts.ScriptKind.TS : ts.ScriptKind.JS
  )
  for (const specifier of moduleSpecifiers(sourceFile)) {
    assert.equal(isNodeBuiltin(specifier), false, `Node built-in ${specifier} imported by ${relative}`)
    if (specifier.startsWith(".")) pending.push(resolveLocal(root, relative, specifier))
  }
}

const declarationExpectations = usesDefaultEntrypoints
  ? new Map(defaultDeclarationExports)
  : new Map()
if (expectedExports !== undefined) {
  const declarationEntrypoints = entrypoints.filter(isDeclaration)
  assert.equal(declarationEntrypoints.length, 1, "--expected-exports requires one declaration entrypoint")
  declarationExpectations.set(declarationEntrypoints[0], expectedExports)
}

if (declarationExpectations.size > 0) {
  const rootNames = [...declarationExpectations.keys()].map((relative) => path.join(root, relative))
  const program = ts.createProgram({
    rootNames,
    options: {
      module: ts.ModuleKind.NodeNext,
      moduleResolution: ts.ModuleResolutionKind.NodeNext,
      target: ts.ScriptTarget.ES2022,
      skipLibCheck: true,
      noEmit: true
    }
  })
  const checker = program.getTypeChecker()
  for (const [relative, expected] of declarationExpectations) {
    const sourceFile = program.getSourceFile(path.join(root, relative))
    assert.notEqual(sourceFile, undefined, `missing declaration entrypoint: ${relative}`)
    const moduleSymbol = checker.getSymbolAtLocation(sourceFile)
    assert.notEqual(moduleSymbol, undefined, `declaration entrypoint is not a module: ${relative}`)
    const exports = checker.getExportsOfModule(moduleSymbol).map((symbol) => symbol.name).sort()
    assert.deepEqual(exports, expected, `declaration exports must match the expected public keys: ${relative}`)
    console.log(usesDefaultEntrypoints
      ? `Declaration exports (${relative}): ${exports.join(",")}`
      : `Declaration exports: ${exports.join(",")}`)
  }
}

console.log(`WP5B core emitted graphs are DOM/Node-free (${visited.size} files).`)
