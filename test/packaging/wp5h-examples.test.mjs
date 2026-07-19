import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import path from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"
import { test } from "node:test"
import ts from "typescript"

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..")
const read = (relative) => readFileSync(path.join(root, relative), "utf8")
const activeExamples = [
  "src/examples/agent-facing-proof-servers.ts",
  "src/examples/core-protocol-catalog.ts",
  "src/examples/everything-client.ts",
  "src/examples/everything-server.ts"
]
const publicSdkEntrypoints = new Set([
  "../index.js",
  "../client.js",
  "../server.js",
  "../protocol/2026-07-28.js",
  "../transport/http.js",
  "../transport/stdio.js",
  "../deprecated.js"
])

const sourceFile = (relative, source = read(relative)) =>
  ts.createSourceFile(relative, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS)

const unwrapExpression = (expression) => {
  let current = expression
  while (ts.isParenthesizedExpression(current) ||
    ts.isAsExpression(current) ||
    ts.isTypeAssertionExpression(current) ||
    ts.isNonNullExpression(current) ||
    ts.isSatisfiesExpression(current)) {
    current = current.expression
  }
  return current
}

const staticStringValue = (expression) => {
  if (expression === undefined) return undefined
  const current = unwrapExpression(expression)
  if (ts.isStringLiteralLike(current)) return current.text
  if (ts.isBinaryExpression(current) && current.operatorToken.kind === ts.SyntaxKind.PlusToken) {
    const left = staticStringValue(current.left)
    const right = staticStringValue(current.right)
    return left === undefined || right === undefined ? undefined : left + right
  }
  if (ts.isTemplateExpression(current)) {
    let value = current.head.text
    for (const span of current.templateSpans) {
      const expression = staticStringValue(span.expression)
      if (expression === undefined) return undefined
      value += expression + span.literal.text
    }
    return value
  }
  return undefined
}

const importSpecifiers = (file) => {
  const specifiers = []
  const visit = (node) => {
    const value = staticStringValue(node)
    const parentValue = node.parent === undefined ? undefined : staticStringValue(node.parent)
    if (value?.startsWith("..") && !parentValue?.startsWith("..")) {
      specifiers.push(value)
    }
    ts.forEachChild(node, visit)
  }
  visit(file)
  return specifiers
}

const namedImportOwners = (file) => {
  const owners = []
  for (const statement of file.statements) {
    if (!ts.isImportDeclaration(statement) ||
      !ts.isStringLiteralLike(statement.moduleSpecifier) ||
      statement.importClause === undefined) continue
    const bindings = statement.importClause.namedBindings
    if (bindings !== undefined && ts.isNamedImports(bindings)) {
      for (const element of bindings.elements) {
        owners.push({
          name: (element.propertyName ?? element.name).text,
          specifier: statement.moduleSpecifier.text
        })
      }
    }
  }
  return owners
}

const rootImportViolations = (file, relative) => {
  const invalid = []
  const rootNamespaces = new Set(["OAuth", "OAuthProviders"])
  const root = "../index.js"
  const visit = (node) => {
    if (staticStringValue(node) === root && staticStringValue(node.parent) !== root) {
      const declaration = node.parent
      if (!ts.isImportDeclaration(declaration) || declaration.moduleSpecifier !== node) {
        invalid.push(`${relative}: root requires static named imports`)
      } else {
        const clause = declaration.importClause
        if (clause === undefined || clause.name !== undefined ||
          clause.namedBindings === undefined || !ts.isNamedImports(clause.namedBindings)) {
          invalid.push(`${relative}: root requires static named imports`)
        } else {
          for (const element of clause.namedBindings.elements) {
            const imported = (element.propertyName ?? element.name).text
            if (!rootNamespaces.has(imported)) invalid.push(`${relative}: root import ${imported}`)
          }
        }
      }
    }
    ts.forEachChild(node, visit)
  }
  visit(file)
  return invalid
}

const exampleImportViolations = (file, relative) => {
  const invalid = []
  invalid.push(...rootImportViolations(file, relative))
  for (const specifier of importSpecifiers(file)) {
    if (specifier.startsWith("..") && !publicSdkEntrypoints.has(specifier)) {
      invalid.push(`${relative}: ${specifier}`)
    }
  }
  const protocolNamespaces = new Set(["McpSchema", "McpProtocol", "McpErrors"])
  for (const { name, specifier } of namedImportOwners(file)) {
    if (protocolNamespaces.has(name) && specifier !== "../protocol/2026-07-28.js") {
      invalid.push(`${relative}: ${name} from ${specifier}`)
    }
  }
  return invalid
}

test("active examples import SDK code only through published entrypoint owners", () => {
  const invalid = []
  for (const relative of activeExamples) {
    invalid.push(...exampleImportViolations(sourceFile(relative), relative))
  }
  assert.deepEqual(invalid, [])
})

test("active examples route protocol namespaces and root APIs through their exact owners", () => {
  const invalid = []
  for (const relative of activeExamples) {
    invalid.push(...exampleImportViolations(sourceFile(relative), relative))
  }
  assert.deepEqual(invalid, [])
})

test("root ownership rejects aliases and every non-static-named import form", () => {
  const bypasses = [
    ["named alias", 'import { McpSchema as OAuth } from "../index.js"'],
    ["default", 'import Root from "../index.js"'],
    ["namespace", 'import * as Root from "../index.js"'],
    ["dynamic", 'void import("../index.js")'],
    ["require", 'require("../index.js")'],
    ["require.resolve", 'require.resolve("../index.js")'],
    ["parenthesized require", '(require)("../index.js")'],
    ["element require.resolve", 'require["resolve"]("../index.js")'],
    ["module.require", 'module.require("../index.js")'],
    ["aliased require", 'const load = require; load("../index.js")'],
    ["computed dynamic", 'void import("../" + "index.js")'],
    ["call wrapper", 'require.call(null, "../index.js")'],
    ["reflect wrapper", 'Reflect.apply(require, null, ["../index.js"])'],
    ["destructured alias", 'const { resolve: locate } = require; locate("../index.js")'],
    ["prefixed root", 'import { OAuth } from "./../index.js"'],
    ["dot-segment root", 'void import("../protocol/../index.js")'],
    ["templated prefixed root", 'void import(`./../${"index"}.js`)'],
    ["import equals", 'import Root = require("../index.js")'],
    ["export", 'export { McpSchema } from "../index.js"'],
    ["import type", 'type Root = import("../index.js")']
  ]
  const accepted = bypasses
    .filter(([, source]) => exampleImportViolations(sourceFile("synthetic.ts", source), "synthetic.ts").length === 0)
    .map(([label]) => label)
  assert.deepEqual(accepted, [])
})

test("example module traversal rejects static, dynamic, require, and type-only deep imports", () => {
  const synthetic = sourceFile("synthetic.ts", `
    import "../McpClient.js"
    export * from "../generated/example.js"
    import legacy = require("../internal/legacy.js")
    void import("../auth/auth.js")
    require("../transport/Concrete.js")
    require.resolve("../McpServer.js")
    ;(require)("../internal/parenthesized.js")
    require["resolve"]("../internal/element-access.js")
    module.require("../internal/module-require.js")
    const load = require
    load("../internal/aliased-require.js")
    void import("../internal/" + "computed-dynamic.js")
    require.call(null, "../internal/call-wrapper.js")
    Reflect.apply(require, null, ["../internal/reflect-wrapper.js"])
    const { resolve: locate } = require
    locate("../internal/destructured-alias.js")
    import "./../McpServer.js"
    void import("../internal/../McpClient.js")
    void import(\`./../\${"McpSchema"}.js\`)
    type Hidden = import("../McpSchema.js").Hidden
  `)
  assert.deepEqual(importSpecifiers(synthetic), [
    "../McpClient.js",
    "../generated/example.js",
    "../internal/legacy.js",
    "../auth/auth.js",
    "../transport/Concrete.js",
    "../McpServer.js",
    "../internal/parenthesized.js",
    "../internal/element-access.js",
    "../internal/module-require.js",
    "../internal/aliased-require.js",
    "../internal/computed-dynamic.js",
    "../internal/call-wrapper.js",
    "../internal/reflect-wrapper.js",
    "../internal/destructured-alias.js",
    "./../McpServer.js",
    "../internal/../McpClient.js",
    "./../McpSchema.js",
    "../McpSchema.js"
  ])
})
test("library-style examples load and expose stable MRTR and scoped Subscription examples", async () => {
  const [catalog, agentFacing] = await Promise.all([
    import(pathToFileURL(path.join(root, "dist/examples/core-protocol-catalog.js")).href),
    import(pathToFileURL(path.join(root, "dist/examples/agent-facing-proof-servers.js")).href)
  ])
  assert.equal(typeof catalog.inputRequiredApprovalLayer, "object")
  assert.equal(typeof catalog.makeInputRequiredApprovalPolicy, "function")
  assert.equal(typeof catalog.resourceWorkspaceClient, "function")
  assert.equal(typeof agentFacing.discoverAndChooseEvalServer, "object")
})

test("executable examples remain controlled by subprocess E2E and conformance runners", () => {
  const draftRunner = read("scripts/run-draft-e2e.mjs")
  assert.match(draftRunner, /dist\/examples\/everything-server\.js/)
  assert.match(draftRunner, /dist\/examples\/everything-client\.js/)
  const conformanceServer = read("scripts/run-conformance-server.mjs")
  const conformanceClient = read("scripts/run-conformance-client-auth.mjs")
  assert.match(conformanceServer, /dist\/examples\/everything-server\.js/)
  assert.match(conformanceClient, /dist\/examples\/everything-client\.js/)
})

test("task-heavy examples remain excluded for WP7", () => {
  const tsconfig = JSON.parse(read("tsconfig.json"))
  assert.equal(tsconfig.exclude.includes("src/examples/task-heavy/**"), true)
  assert.equal(tsconfig.exclude.includes("src/McpTasks.ts"), true)
})
