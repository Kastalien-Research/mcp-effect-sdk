import { existsSync, readdirSync, readFileSync } from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"
import * as Effect from "effect/Effect"
import * as NodeRuntime from "@effect/platform-node/NodeRuntime"
import ts from "typescript"
import { runScript } from "./lib/process.mjs"

const __filename = fileURLToPath(import.meta.url)
const defaultRoot = path.resolve(path.dirname(__filename), "..")
const root = path.resolve(process.env.MCP_EFFECT_OBSERVABILITY_ROOT ?? defaultRoot)
const inventoryPath = path.join(root, "docs/observability-inventory.json")
const allowedStatuses = new Set([
  "instrumented",
  "coveredByParentBoundary",
  "rootOnly",
  "generated",
  "pureExempt",
  "quarantined"
])
const allowedBoundaryStatuses = new Set(["coveredByParentBoundary", "rootOnly"])
const effectEntrypointFunctions = new Set([
  "runMain",
  "runPromise",
  "runPromiseExit",
  "runPromiseKill",
  "runPromiseReject",
  "runSync",
  "runSyncExit",
  "runSyncThrow",
  "runFork",
  "runForkScope",
  "runAsync"
])
const effectNamespaceModuleAliases = new Set([
  "effect",
  "@effect/platform-node/NodeRuntime",
  "@effect/platform/NodeRuntime"
])

const trackedTopLevelRoots = ["src", "examples", "apps", "scripts"]
const excludedDirs = new Set(["dist", ".git", ".local", ".github", "node_modules", "repos"])

const runCheckObservabilityCoverage = () =>
  Effect.gen(function* () {
    const violations = []
    const { entries: inventoryEntries, version } = readJson(inventoryPath, {
      entries: [],
      version: 0
    })

    if (!Array.isArray(inventoryEntries) || version !== 1) {
      violations.push("invalid-inventory")
    }

    const sortedEntries = [...inventoryEntries]
      .map((entry) => ({
        ...entry,
        normalizedPrefix: normalizePrefix(entry.pathPrefix ?? "")
      }))
      .sort((a, b) => b.normalizedPrefix.length - a.normalizedPrefix.length)

    /** @type {string[]} */
    const trackedFiles = []
    for (const rootName of trackedTopLevelRoots) {
      const rootPath = path.join(root, rootName)
      trackedFiles.push(...walkFiles(rootPath, rootName + "/"))
    }

    for (const filePath of trackedFiles) {
      const normalizedPath = normalizePath(filePath)
      const entry = classifyFile(normalizedPath, sortedEntries)
      if (!entry) {
        violations.push(`missing-classification:${normalizedPath}`)
        continue
      }
      if (!allowedStatuses.has(entry.status)) {
        violations.push(`invalid-status:${normalizedPath}:${entry.status}`)
      }
      if ((entry.status === "pureExempt" || entry.status === "generated") && !entry.rationale) {
        violations.push(`missing-rationale:${normalizedPath}:${entry.status}`)
      }
      if (entry.status === "quarantined" && !entry.prerequisite) {
        violations.push(`missing-prerequisite:${normalizedPath}`)
      }
      if (isPotentialEffectEntrypoint(filePath) && !allowedBoundaryStatuses.has(entry.status)) {
        violations.push(`effect-entrypoint-mapped-to-non-boundary:${normalizedPath}:${entry.status}`)
      }
    }

    for (const entry of sortedEntries) {
      if (entry.pathPrefix && !inventoryIncludesMatching(entry.pathPrefix, trackedFiles)) {
        violations.push(`stale-inventory-entry:${normalizePrefix(entry.pathPrefix)}`)
      }
    }

    if (violations.length > 0) {
      violations.sort()
      console.error("Observability coverage inventory check failed.")
      for (const violation of violations) {
        console.error(`- ${violation}`)
      }
      yield* Effect.fail(new Error("observability-coverage-check failed"))
    }

    console.log(
      `Observability coverage inventory check passed for ${trackedFiles.length} tracked files across ` +
        `${trackedTopLevelRoots.length} roots using ${sortedEntries.length} inventory rules.`
    )
  })

const runCheckObservabilityCoverageReport = () =>
  runCheckObservabilityCoverage().pipe(
    Effect.tapError((error) =>
      Effect.sync(() => {
        console.error("Observability coverage inventory check failed.")
        console.error(error instanceof Error ? error.message : String(error))
      })
    )
  )

if (process.argv[1]) {
  const invokedScriptPath = path.resolve(process.cwd(), process.argv[1])
  if (invokedScriptPath === fileURLToPath(import.meta.url)) {
    NodeRuntime.runMain(runScript("check:observability-coverage", runCheckObservabilityCoverageReport()))
  }
}

function walkFiles(folderPath, relativePrefix) {
  if (!existsSync(folderPath)) return []
  const output = []
  for (const entry of readdirSync(folderPath, { withFileTypes: true })) {
    if (excludedDirs.has(entry.name)) {
      continue
    }
    const filePath = path.join(folderPath, entry.name)
    if (entry.isDirectory()) {
      output.push(...walkFiles(filePath, `${relativePrefix}${entry.name}/`))
      continue
    }
    if (!entry.isFile()) continue
    output.push(normalizePath(`${relativePrefix}${entry.name}`))
  }
  return output
}

function classifyFile(relativePath, sortedEntries) {
  for (const entry of sortedEntries) {
    const prefix = normalizePrefix(entry.pathPrefix ?? "")
    if (matchesPrefix(relativePath, prefix)) {
      return entry
    }
  }
  return undefined
}

function matchesPrefix(filePath, prefix) {
  if (!prefix) return false
  const normalizedPrefix = normalizePrefix(prefix)
  if (filePath === normalizedPrefix) return true
  return filePath.startsWith(normalizedPrefix)
}

function normalizePrefix(prefix) {
  return normalizePath(prefix).replace(/\/+\*$/, "")
}

function normalizePath(filePath) {
  return filePath.replace(/\\/g, "/")
}

function isPotentialEffectEntrypoint(filePath) {
  const extension = path.extname(filePath).toLowerCase()
  if (![".ts", ".mts", ".cts", ".js", ".mjs", ".tsx", ".jsx"].includes(extension)) return false
  const absolutePath = path.join(root, filePath)
  const sourceText = readFileSync(absolutePath, "utf8")
  const scriptKind = scriptKindFromExtension(extension)
  const sourceFile = ts.createSourceFile(filePath, sourceText, ts.ScriptTarget.Latest, true, scriptKind)
  const importAliasState = collectImportAliases(sourceFile)
  const namespaceAliases = importAliasState.namespaceAliases
  const effectEntrypointAlias = importAliasState.effectEntrypointAlias
  let hasEntrypoint = false

  const shouldSkipNode = (node) =>
    ts.isFunctionLike(node) ||
    ts.isClassLike(node) ||
    ts.isModuleDeclaration(node) ||
    ts.isInterfaceDeclaration(node) ||
    ts.isTypeAliasDeclaration(node) ||
    ts.isEnumDeclaration(node)

  const visit = (node) => {
    if (hasEntrypoint) return
    if (shouldSkipNode(node)) return
    if (isEffectRunEntrypointCall(node, namespaceAliases, effectEntrypointAlias)) {
      hasEntrypoint = true
      return
    }
    ts.forEachChild(node, visit)
  }
  visit(sourceFile)
  return hasEntrypoint
}

function isEffectRunEntrypointCall(node, namespaceAliases, effectEntrypointAlias) {
  if (!ts.isCallExpression(node)) return false

  if (ts.isIdentifier(node.expression)) {
    const name = node.expression.text
    if (effectEntrypointAlias.has(name)) {
      return true
    }
    return false
  }

  if (!ts.isPropertyAccessExpression(node.expression)) return false
  const propertyName = node.expression.name.text
  if (!effectEntrypointFunctions.has(propertyName)) return false
  const objectExpr = node.expression.expression
  if (!ts.isIdentifier(objectExpr)) {
    return false
  }
  const objectText = objectExpr.text
  if (
    objectText === "Effect" ||
    objectText === "NodeRuntime" ||
    objectText === "Runtime" ||
    objectText === "Layer" ||
    objectText === "EffectRuntime"
  ) {
    return true
  }
  return namespaceAliases.has(objectText)
}

function collectImportAliases(sourceFile) {
  const aliases = new Set()
  const functionAliases = new Set()

  for (const node of sourceFile.statements) {
    if (!ts.isImportDeclaration(node)) continue
    if (node.importClause?.isTypeOnly) continue
    const moduleSpecifier = node.moduleSpecifier
    if (!ts.isStringLiteral(moduleSpecifier)) continue
    if (!effectNamespaceModuleAliases.has(moduleSpecifier.text)) continue

    const importClause = node.importClause
    const namedBindings = importClause?.namedBindings
    if (namedBindings !== undefined && ts.isNamespaceImport(namedBindings)) {
      aliases.add(namedBindings.name.text)
      continue
    }
    if (namedBindings === undefined || !ts.isNamedImports(namedBindings)) {
      continue
    }
    for (const element of namedBindings.elements) {
      const importedName = element.propertyName?.text ?? element.name.text
      if (!effectEntrypointFunctions.has(importedName)) {
        continue
      }
      functionAliases.add(element.name.text)
    }
  }

  let changed = true
  while (changed) {
    changed = false
    for (const node of sourceFile.statements) {
      if (!ts.isVariableStatement(node)) continue
      for (const declaration of node.declarationList.declarations) {
        const initializer = declaration.initializer
        if (initializer === undefined || !ts.isIdentifier(initializer)) continue
        if (!aliases.has(initializer.text)) continue
        const binding = declaration.name
        if (ts.isIdentifier(binding)) {
          if (!aliases.has(binding.text)) {
            aliases.add(binding.text)
            changed = true
          }
          continue
        }
        if (!ts.isObjectBindingPattern(binding)) {
          continue
        }
        for (const property of binding.elements) {
          const importedName = property.propertyName?.text ?? property.name.text
          if (!effectEntrypointFunctions.has(importedName)) {
            continue
          }
          if (!functionAliases.has(property.name.text)) {
            functionAliases.add(property.name.text)
            changed = true
          }
        }
      }
    }
  }

  return {
    namespaceAliases: aliases,
    effectEntrypointAlias: functionAliases
  }
}

function scriptKindFromExtension(extension) {
  switch (extension) {
    case ".ts":
    case ".mts":
    case ".cts":
      return ts.ScriptKind.TS
    case ".tsx":
      return ts.ScriptKind.TSX
    case ".jsx":
      return ts.ScriptKind.TSX
    case ".js":
    case ".mjs":
    case ".cjs":
      return ts.ScriptKind.JS
    default:
      return ts.ScriptKind.TS
  }
}

function inventoryIncludesMatching(prefix, trackedFiles) {
  const normalized = normalizePrefix(prefix)
  return trackedFiles.some((candidate) => matchesPrefix(candidate, normalized))
}

function readJson(filePath, defaults) {
  if (!existsSync(filePath)) {
    return defaults
  }
  return JSON.parse(readFileSync(filePath, "utf8"))
}
