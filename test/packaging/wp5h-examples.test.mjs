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

const importSpecifiers = (file) => {
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
  const isRoot = (node) => ts.isStringLiteralLike(node) && node.text === root
  const visit = (node) => {
    if (ts.isImportDeclaration(node) && isRoot(node.moduleSpecifier)) {
      const clause = node.importClause
      if (clause === undefined || clause.name !== undefined ||
        clause.namedBindings === undefined || !ts.isNamedImports(clause.namedBindings)) {
        invalid.push(`${relative}: root requires static named imports`)
      } else {
        for (const element of clause.namedBindings.elements) {
          const imported = (element.propertyName ?? element.name).text
          if (!rootNamespaces.has(imported)) invalid.push(`${relative}: root import ${imported}`)
        }
      }
    } else if (ts.isExportDeclaration(node) && isRoot(node.moduleSpecifier)) {
      invalid.push(`${relative}: root export`)
    } else if (ts.isImportEqualsDeclaration(node) &&
      ts.isExternalModuleReference(node.moduleReference) &&
      isRoot(node.moduleReference.expression)) {
      invalid.push(`${relative}: root import equals`)
    } else if (ts.isCallExpression(node)) {
      const isDynamicImport = node.expression.kind === ts.SyntaxKind.ImportKeyword
      const isRequire = ts.isIdentifier(node.expression) && node.expression.text === "require"
      const isRequireResolve = ts.isPropertyAccessExpression(node.expression) &&
        ts.isIdentifier(node.expression.expression) &&
        node.expression.expression.text === "require" &&
        node.expression.name.text === "resolve"
      if ((isDynamicImport || isRequire || isRequireResolve) && isRoot(node.arguments[0])) {
        invalid.push(`${relative}: root call import`)
      }
    } else if (ts.isImportTypeNode(node) && ts.isLiteralTypeNode(node.argument) &&
      isRoot(node.argument.literal)) {
      invalid.push(`${relative}: root import type`)
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
