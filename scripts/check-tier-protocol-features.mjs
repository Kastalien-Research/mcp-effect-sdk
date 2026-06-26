import { readFileSync, writeFileSync } from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { readinessEvidencePath } from "./readiness-evidence.mjs"

const __filename = fileURLToPath(import.meta.url)
const root = path.resolve(path.dirname(__filename), "..")
const sourceDir = path.join(root, "src/generated/mcp/2026-07-28")
const command = "pnpm run check:tier-protocol-features"

const files = {
  schemaJson: path.join(sourceDir, "schema.json"),
  schemaTs: path.join(sourceDir, "schema.ts.txt"),
  generatedProtocol: path.join(root, "src/generated/mcp/McpProtocol.generated.ts"),
  generatedSchema: path.join(root, "src/generated/mcp/McpSchema.generated.ts")
}

const sourceSchema = JSON.parse(readFileSync(files.schemaJson, "utf8"))
const sourceSchemaTs = readFileSync(files.schemaTs, "utf8")
const generatedProtocol = readFileSync(files.generatedProtocol, "utf8")
const generatedSchema = readFileSync(files.generatedSchema, "utf8")

const sourceVersion = readVersion(sourceSchemaTs, "LATEST_PROTOCOL_VERSION")
const generatedProtocolVersion = readVersion(generatedProtocol, "LATEST_PROTOCOL_VERSION")
const generatedSchemaVersion = readVersion(generatedSchema, "MCP_SCHEMA_VERSION")
const sourceDescriptors = sourceProtocolDescriptors(sourceSchemaTs)
const generatedDescriptors = generatedProtocolDescriptors(generatedProtocol)
const features = buildFeatures()
const failedFeatures = features.filter((feature) => feature.status !== "pass")
const exitCode = failedFeatures.length === 0 ? 0 : 1
const report = {
  evidenceKind: "static-interface",
  timestamp: new Date().toISOString(),
  command,
  exitCode,
  summary: {
    status: exitCode === 0 ? "pass" : "fail",
    protocolVersion: sourceVersion,
    featureCount: features.length,
    passed: features.length - failedFeatures.length,
    failed: failedFeatures.length
  },
  requirementIds: ["GR-TIER-001"],
  protocol: {
    version: sourceVersion,
    schemaDirectoryVersion: path.basename(sourceDir),
    generatedProtocolVersion,
    generatedSchemaVersion,
    jsonSchemaDialect: sourceSchema.$schema
  },
  sourceArtifacts: Object.fromEntries(
    Object.entries(files).map(([name, file]) => [name, path.relative(root, file)])
  ),
  features
}

const evidencePath = readinessEvidencePath("tier-protocol-features")
writeFileSync(evidencePath, `${JSON.stringify(report, null, 2)}\n`)
console.log(`Writing readiness evidence to ${evidencePath}`)

for (const feature of failedFeatures) {
  console.error(`Protocol feature freshness failed: ${feature.id}: ${feature.reason}`)
}
process.exit(exitCode)

function buildFeatures() {
  return [
    versionFeature(),
    jsonSchemaFeature(),
    descriptorFeature("client-requests", "CLIENT_REQUEST_DESCRIPTORS"),
    descriptorFeature("client-notifications", "CLIENT_NOTIFICATION_DESCRIPTORS"),
    descriptorFeature("server-requests", "SERVER_REQUEST_DESCRIPTORS"),
    descriptorFeature("server-notifications", "SERVER_NOTIFICATION_DESCRIPTORS"),
    methodListFeature(
      "client-request-methods",
      "CLIENT_REQUEST_METHODS",
      "CLIENT_REQUEST_DESCRIPTORS"
    ),
    methodListFeature(
      "client-notification-methods",
      "CLIENT_NOTIFICATION_METHODS",
      "CLIENT_NOTIFICATION_DESCRIPTORS"
    ),
    methodListFeature(
      "server-request-methods",
      "SERVER_REQUEST_METHODS",
      "SERVER_REQUEST_DESCRIPTORS"
    ),
    methodListFeature(
      "server-notification-methods",
      "SERVER_NOTIFICATION_METHODS",
      "SERVER_NOTIFICATION_DESCRIPTORS"
    ),
    derivedMethodFeature(
      "task-requests",
      "TASK_REQUEST_METHODS",
      generatedDescriptors.CLIENT_REQUEST_DESCRIPTORS
        .map((descriptor) => descriptor.method)
        .filter((method) => method.startsWith("tasks/"))
    ),
    derivedMethodFeature(
      "task-notifications",
      "TASK_NOTIFICATION_METHODS",
      generatedDescriptors.SERVER_NOTIFICATION_DESCRIPTORS
        .map((descriptor) => descriptor.method)
        .filter((method) => method.startsWith("notifications/tasks/"))
    ),
    derivedMethodFeature(
      "elicitation-notifications",
      "ELICITATION_NOTIFICATION_METHODS",
      generatedDescriptors.SERVER_NOTIFICATION_DESCRIPTORS
        .map((descriptor) => descriptor.method)
        .filter((method) => method.startsWith("notifications/elicitation/"))
    ),
    capabilityFeature("client-capabilities", "ClientCapabilities"),
    capabilityFeature("server-capabilities", "ServerCapabilities")
  ]
}

function versionFeature() {
  const identifiers = [sourceVersion, generatedProtocolVersion, generatedSchemaVersion]
  const directoryVersion = path.basename(sourceDir)
  const status = allEqual([...identifiers, directoryVersion]) ? "pass" : "fail"
  return {
    id: "protocol-version",
    kind: "version",
    identifiers,
    status,
    reason: status === "pass" ? "Generated protocol and schema versions match source." :
      "Generated protocol, generated schema, source, and directory versions must match."
  }
}

function jsonSchemaFeature() {
  // MCP 2026-07-28: server/discover replaces initialize; no ServerRequest union.
  const requiredDefinitions = [
    "DiscoverRequest",
    "DiscoverResult",
    "ClientRequest",
    "ClientNotification",
    "ServerNotification"
  ]
  const definitions = sourceSchema.$defs && typeof sourceSchema.$defs === "object"
    ? sourceSchema.$defs
    : {}
  const missing = requiredDefinitions.filter((name) => definitions[name] === undefined)
  const status =
    sourceSchema.$schema === "https://json-schema.org/draft/2020-12/schema" &&
    missing.length === 0
      ? "pass"
      : "fail"
  return {
    id: "schema-artifact",
    kind: "schema",
    identifiers: requiredDefinitions,
    status,
    reason: status === "pass" ? "Vendored schema artifact has protocol definitions." :
      `Missing or invalid schema metadata: ${missing.join(", ") || sourceSchema.$schema}`
  }
}

function descriptorFeature(id, descriptorName) {
  const expected = sourceDescriptors[descriptorName]
  const actual = generatedDescriptors[descriptorName]
  const diff = compareDescriptors(expected, actual)
  return {
    id,
    kind: "descriptor-group",
    identifiers: actual.map((descriptor) => descriptor.method),
    status: diff.length === 0 ? "pass" : "fail",
    sourceCount: expected.length,
    generatedCount: actual.length,
    reason: diff.length === 0 ?
      "Generated descriptors match vendored schema metadata." :
      diff.join("; ")
  }
}

function methodListFeature(id, methodListName, descriptorName) {
  const expected = generatedDescriptors[descriptorName].map((descriptor) => descriptor.method)
  return derivedMethodFeature(id, methodListName, expected)
}

function derivedMethodFeature(id, methodListName, expected) {
  const actual = parseConstArray(generatedProtocol, methodListName)
  const missing = expected.filter((method) => !actual.includes(method))
  const extra = actual.filter((method) => !expected.includes(method))
  return {
    id,
    kind: "method-list",
    identifiers: actual,
    status: missing.length === 0 && extra.length === 0 ? "pass" : "fail",
    sourceCount: expected.length,
    generatedCount: actual.length,
    reason: missing.length === 0 && extra.length === 0 ? "Generated method list is fresh." :
      `missing ${missing.join(", ") || "none"}; extra ${extra.join(", ") || "none"}`
  }
}

function capabilityFeature(id, definitionName) {
  const definitions = sourceSchema.$defs && typeof sourceSchema.$defs === "object"
    ? sourceSchema.$defs
    : {}
  const definition = definitions[definitionName]
  const identifiers = Object.keys(definition?.properties ?? {}).sort()
  const generatedMissing = identifiers.filter((identifier) => {
    const fieldPattern = new RegExp(`\\b${escapeRegExp(identifier)}:\\s+optional\\(`)
    return !fieldPattern.test(generatedSchema)
  })
  return {
    id,
    kind: "capability-group",
    identifiers,
    status: identifiers.length > 0 && generatedMissing.length === 0 ? "pass" : "fail",
    reason: generatedMissing.length === 0 ? "Generated schema exposes capability identifiers." :
      `Generated schema missing capability fields: ${generatedMissing.join(", ")}`
  }
}

function sourceProtocolDescriptors(sourceText) {
  const interfaceMethods = readInterfaceMethods(sourceText)
  const resultTypes = readResultTypesByMethod(sourceText)
  return {
    CLIENT_REQUEST_DESCRIPTORS: requestDescriptors(
      readUnionMembers(sourceText, "ClientRequest"),
      interfaceMethods,
      resultTypes
    ),
    CLIENT_NOTIFICATION_DESCRIPTORS: notificationDescriptors(
      readUnionMembers(sourceText, "ClientNotification"),
      interfaceMethods
    ),
    // The stateless draft has no ServerRequest union (no server-initiated
    // requests); descriptors collapse to an empty list.
    SERVER_REQUEST_DESCRIPTORS: requestDescriptors(
      readUnionMembers(sourceText, "ServerRequest", { optional: true }),
      interfaceMethods,
      resultTypes
    ),
    SERVER_NOTIFICATION_DESCRIPTORS: notificationDescriptors(
      readUnionMembers(sourceText, "ServerNotification"),
      interfaceMethods
    )
  }
}

function generatedProtocolDescriptors(sourceText) {
  return {
    CLIENT_REQUEST_DESCRIPTORS: parseConstArray(sourceText, "CLIENT_REQUEST_DESCRIPTORS"),
    CLIENT_NOTIFICATION_DESCRIPTORS: parseConstArray(sourceText, "CLIENT_NOTIFICATION_DESCRIPTORS"),
    SERVER_REQUEST_DESCRIPTORS: parseConstArray(sourceText, "SERVER_REQUEST_DESCRIPTORS"),
    SERVER_NOTIFICATION_DESCRIPTORS: parseConstArray(sourceText, "SERVER_NOTIFICATION_DESCRIPTORS")
  }
}

function readInterfaceMethods(sourceText) {
  const methods = new Map()
  const pattern =
    /export interface ([A-Za-z0-9_]+) extends [^{]+{\s+method: "([^"]+)";/g
  let match
  while ((match = pattern.exec(sourceText)) !== null) {
    methods.set(match[1], match[2])
  }
  return methods
}

function readUnionMembers(sourceText, typeName, options = {}) {
  const pattern = new RegExp(`export type ${typeName} =\\s*([\\s\\S]*?);`, "m")
  const match = sourceText.match(pattern)
  if (!match) {
    if (options.optional) {
      return []
    }
    throw new Error(`Could not find ${typeName} union in schema source`)
  }
  const members = [...match[1].matchAll(/\|\s+([A-Za-z0-9_]+)/g)].map((entry) => entry[1])
  if (members.length > 0) {
    return members
  }
  const single = match[1].trim().match(/^([A-Za-z0-9_]+)$/)
  return single ? [single[1]] : []
}

function readResultTypesByMethod(sourceText) {
  const results = new Map()
  const declarationPattern = /export (?:interface|type) ([A-Za-z0-9_]+Result)\b/g
  let match
  while ((match = declarationPattern.exec(sourceText)) !== null) {
    const category = readNearestCategory(sourceText, match.index)
    if (category) {
      results.set(category, match[1])
    }
  }
  return results
}

function readNearestCategory(sourceText, declarationStart) {
  const commentStart = sourceText.lastIndexOf("/**", declarationStart)
  const commentEnd = sourceText.lastIndexOf("*/", declarationStart)
  if (commentStart === -1 || commentEnd === -1 || commentEnd < commentStart) {
    return undefined
  }
  const betweenCommentAndDeclaration = sourceText.slice(commentEnd + 2, declarationStart)
  if (betweenCommentAndDeclaration.trim() !== "") {
    return undefined
  }
  return sourceText.slice(commentStart, commentEnd + 2).match(/\* @category `([^`]+)`/)?.[1]
}

function requestDescriptors(typeNames, interfaceMethods, resultTypes) {
  return typeNames.map((typeName) => {
    const method = requiredMethod(interfaceMethods, typeName)
    return {
      type: typeName,
      method,
      resultType: resultTypes.get(method) ?? emptyResultType(method)
    }
  })
}

function notificationDescriptors(typeNames, interfaceMethods) {
  return typeNames.map((typeName) => ({
    type: typeName,
    method: requiredMethod(interfaceMethods, typeName)
  }))
}

function requiredMethod(interfaceMethods, typeName) {
  const method = interfaceMethods.get(typeName)
  if (!method) {
    throw new Error(`${typeName} does not declare a literal method in schema source`)
  }
  return method
}

function emptyResultType(method) {
  // The draft gives every client request a concrete result; no empty-result
  // methods remain.
  throw new Error(`${method} is missing result metadata`)
}

function compareDescriptors(expected, actual) {
  const expectedJson = JSON.stringify(expected)
  const actualJson = JSON.stringify(actual)
  return expectedJson === actualJson
    ? []
    : [`expected ${expected.length} descriptor(s), generated ${actual.length}`]
}

function parseConstArray(sourceText, constName) {
  const marker = `export const ${constName} = `
  const start = sourceText.indexOf(marker)
  if (start === -1) {
    throw new Error(`Could not find generated ${constName}`)
  }
  const arrayStart = sourceText.indexOf("[", start)
  const arrayEnd = matchingBracket(sourceText, arrayStart)
  return JSON.parse(sourceText.slice(arrayStart, arrayEnd + 1))
}

function matchingBracket(sourceText, start) {
  let depth = 0
  for (let index = start; index < sourceText.length; index += 1) {
    if (sourceText[index] === "[") depth += 1
    if (sourceText[index] === "]") depth -= 1
    if (depth === 0) return index
  }
  throw new Error("Could not find array closing bracket")
}

function readVersion(sourceText, exportName) {
  const pattern = new RegExp(`export const ${exportName} = "([^"]+)"`)
  const match = sourceText.match(pattern)
  if (!match) {
    throw new Error(`Could not find ${exportName}`)
  }
  return match[1]
}

function allEqual(values) {
  return values.every((value) => value === values[0])
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
}
