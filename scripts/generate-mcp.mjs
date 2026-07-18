import { createHash } from "node:crypto"
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"
import tsImport from "typescript"

const ts = tsImport.default ?? tsImport

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const root = path.resolve(__dirname, "..")
const sourceDir = path.join(root, "sources", "vendor", "mcp-core")
const protocolOutputPath = path.join(root, "src/generated/mcp", "2026-07-28", "McpProtocol.generated.ts")
const obsoleteProtocolOutputPath = path.join(root, "src/generated/mcp/McpProtocol.generated.ts")
const schemaOutputPath = path.join(root, "src/generated/mcp", "2026-07-28", "McpSchema.generated.ts")

const checkOnly = process.argv.includes("--check")

const schemaJsonPath = path.join(sourceDir, "schema.json")
const schemaTsPath = path.join(sourceDir, "schema.ts")

const schemaJsonBytes = readFileSync(schemaJsonPath)
const schemaTsBytes = readFileSync(schemaTsPath)
assertPinnedSource(schemaJsonPath, schemaJsonBytes, "9281c4890630e2d1e61792fa23b4084c4ea360cd58519610cd050545ab7b8708")
assertPinnedSource(schemaTsPath, schemaTsBytes, "c56f0ad2395f9f7109a903a304344a61c65555cb0b2d28c1635cc32497221c87")
const schemaJson = JSON.parse(schemaJsonBytes.toString("utf8"))
const schemaTs = schemaTsBytes.toString("utf8")
const schemaTsFile = ts.createSourceFile(
  schemaTsPath,
  schemaTs,
  ts.ScriptTarget.Latest,
  true,
  ts.ScriptKind.TS
)
if (schemaTsFile.parseDiagnostics.length > 0) {
  const diagnostic = schemaTsFile.parseDiagnostics[0]
  throw new Error(
    `Could not structurally parse ${relative(schemaTsPath)}: ${ts.flattenDiagnosticMessageText(diagnostic.messageText, "\n")}`
  )
}
const structuralDeclarations = readStructuralDeclarations(schemaTsFile)
const schemaDefinitions = readSchemaDefinitions(schemaJson)
const namedDefinitionAliases = readNamedDefinitionAliases(
  schemaTs,
  new Set(Object.keys(schemaDefinitions))
)
const interfaceParentsByName = readInterfaceInheritance(schemaTs)
const resultInterfaceNames = readTransitiveInterfaceFamily(interfaceParentsByName, "Result")
const atLeastOneRequirements = readAtLeastOneRequirements(schemaTs)
assertResultInterfacesHaveDefinitions()
// The draft (2026-07-28) protocol gives every client request a concrete
// result type, so there are no methods that resolve to the bare EmptyResult.
// Legacy empty-result methods (ping, logging/setLevel, resources/subscribe,
// resources/unsubscribe) were removed in the stateless redesign.
const emptyResultMethods = new Set([])

const protocolVersion = readProtocolVersion()
assertStableSchema(schemaJson, protocolVersion)

const clientRequests = readProtocolAliasMembers("ClientRequest")
const clientNotifications = readProtocolAliasMembers("ClientNotification")
// The stateless draft has no server-initiated requests: server→client
// interaction now flows through MRTR (InputRequiredResult) and
// subscriptions/listen, so the ServerRequest union is absent by design.
const serverRequests = readProtocolAliasMembers("ServerRequest", { optional: true })
const serverNotifications = readProtocolAliasMembers("ServerNotification")
assertJsonGroupMembership("ClientRequest", clientRequests)
assertJsonGroupMembership("ClientNotification", clientNotifications)
assertJsonGroupMembership("ServerRequest", serverRequests, { optional: true })
assertJsonGroupMembership("ServerNotification", serverNotifications)
const resultTypesByMethod = readResultTypesByMethod()
const recursiveJsonNames = new Set(["JSONValue", "JSONObject", "JSONArray"])
const boundKeywords = ["minimum", "maximum", "minLength", "maxLength", "minItems", "maxItems"]
const supportedSchemaKeywords = new Set([
  "$ref",
  "additionalProperties",
  "allOf",
  "anyOf",
  "const",
  "description",
  "enum",
  "format",
  "items",
  ...boundKeywords,
  "oneOf",
  "properties",
  "required",
  "type"
])
const clientRequestDescriptors = requestDescriptorsFor(clientRequests, "client-to-server", "ClientRequest")
const serverRequestDescriptors = requestDescriptorsFor(serverRequests, "server-to-client", "ServerRequest")
const clientNotificationDescriptors = notificationDescriptorsFor(
  clientNotifications,
  "client-to-server",
  "ClientNotification"
)
const serverNotificationDescriptors = notificationDescriptorsFor(
  serverNotifications,
  "server-to-client",
  "ServerNotification"
)
assertDirectionDescriptorDisjoint(
  "client-to-server",
  clientRequestDescriptors,
  clientNotificationDescriptors
)
assertDirectionDescriptorDisjoint(
  "server-to-client",
  serverRequestDescriptors,
  serverNotificationDescriptors
)
const clientRequestMethodMap = methodMapForDescriptors(clientRequestDescriptors)
const clientNotificationMethodMap = methodMapForDescriptors(clientNotificationDescriptors)
const serverRequestMethodMap = methodMapForDescriptors(serverRequestDescriptors)
const serverNotificationMethodMap = methodMapForDescriptors(serverNotificationDescriptors)
assertKnownEmptyResultMethods()

const outputs = new Map([
  [protocolOutputPath, generateProtocolFile()],
  [schemaOutputPath, generateSchemaFile()]
])

let changed = false
for (const [filePath, content] of outputs) {
  const existing = existsSync(filePath) ? readFileSync(filePath, "utf8") : undefined
  if (existing !== content) {
    changed = true
    if (checkOnly) {
      console.error(`Generated file is out of date: ${relative(filePath)}`)
      continue
    }
    mkdirSync(path.dirname(filePath), { recursive: true })
    writeFileSync(filePath, content)
  }
}

if (changed && checkOnly) {
  process.exit(1)
}

if (existsSync(obsoleteProtocolOutputPath)) {
  if (checkOnly) {
    console.error(`Obsolete generated file must be removed: ${relative(obsoleteProtocolOutputPath)}`)
    process.exit(1)
  }
  rmSync(obsoleteProtocolOutputPath)
}

if (checkOnly) {
  console.log("Generated MCP outputs are up to date.")
} else {
  console.log("Generated MCP outputs updated.")
}

function readProtocolVersion() {
  const declarations = structuralDeclarations.variables.get("LATEST_PROTOCOL_VERSION") ?? []
  if (declarations.length !== 1) {
    throw new Error(`Expected exactly one LATEST_PROTOCOL_VERSION declaration in ${relative(schemaTsPath)}`)
  }
  const initializer = declarations[0].initializer
  if (!initializer || !ts.isStringLiteral(initializer)) {
    throw new Error(`LATEST_PROTOCOL_VERSION must be a string literal in ${relative(schemaTsPath)}`)
  }
  return initializer.text
}

function assertPinnedSource(filePath, bytes, expectedSha256) {
  const actualSha256 = createHash("sha256").update(bytes).digest("hex")
  if (actualSha256 !== expectedSha256) {
    throw new Error(
      `${relative(filePath)} hash mismatch: expected ${expectedSha256}, got ${actualSha256}`
    )
  }
}

function assertStableSchema(schema, expectedVersion) {
  const defs = schema.$defs && typeof schema.$defs === "object" ? schema.$defs : {}
  // The stateless draft replaces the initialize handshake with server/discover,
  // so DiscoverRequest/DiscoverResult are the lifecycle anchors we require.
  const requiredDefs = ["DiscoverRequest", "DiscoverResult", "JSONRPCRequest"]
  const missingDefs = requiredDefs.filter((definitionName) => !defs[definitionName])
  if (schema.$schema !== "https://json-schema.org/draft/2020-12/schema") {
    throw new Error(`${relative(schemaJsonPath)} is not a JSON Schema 2020-12 artifact`)
  }
  if (missingDefs.length > 0) {
    throw new Error(
      `${relative(schemaJsonPath)} is missing MCP definitions for ${expectedVersion}: ${
        missingDefs.join(", ")
      }`
    )
  }
}

function readSchemaDefinitions(schema) {
  const defs = schema.$defs && typeof schema.$defs === "object" ? schema.$defs : undefined
  if (!defs) {
    throw new Error(`${relative(schemaJsonPath)} does not contain a $defs object`)
  }
  return Object.fromEntries(
    Object.entries(defs).sort(([left], [right]) => left.localeCompare(right))
  )
}

function readStructuralDeclarations(sourceFile) {
  const aliases = new Map()
  const interfaces = new Map()
  const variables = new Map()
  const append = (map, name, declaration) => {
    const declarations = map.get(name) ?? []
    declarations.push(declaration)
    map.set(name, declarations)
  }
  for (const statement of sourceFile.statements) {
    if (ts.isTypeAliasDeclaration(statement)) {
      append(aliases, statement.name.text, statement)
    } else if (ts.isInterfaceDeclaration(statement)) {
      append(interfaces, statement.name.text, statement)
    } else if (ts.isVariableStatement(statement)) {
      for (const declaration of statement.declarationList.declarations) {
        if (ts.isIdentifier(declaration.name)) append(variables, declaration.name.text, declaration)
      }
    }
  }
  return { aliases, interfaces, variables }
}

function oneStructuralDeclaration(map, name, kind, options = {}) {
  const declarations = map.get(name) ?? []
  if (declarations.length === 0 && options.optional) return undefined
  if (declarations.length !== 1) {
    throw new Error(
      `${name} must have exactly one ${kind} declaration in ${relative(schemaTsPath)}; found ${declarations.length}`
    )
  }
  return declarations[0]
}

function readProtocolAliasMembers(typeName, options = {}) {
  const declaration = oneStructuralDeclaration(
    structuralDeclarations.aliases,
    typeName,
    "type alias",
    options
  )
  if (!declaration) return []
  const nodes = ts.isUnionTypeNode(declaration.type) ? declaration.type.types : [declaration.type]
  const members = nodes.map((node) => {
    if (
      !ts.isTypeReferenceNode(node)
      || !ts.isIdentifier(node.typeName)
      || (node.typeArguments?.length ?? 0) !== 0
    ) {
      throw new Error(`${typeName} contains unsupported member syntax: ${node.getText(schemaTsFile)}`)
    }
    return node.typeName.text
  })
  assertNoDuplicates(members, `${typeName} type`)
  return members
}

function assertJsonGroupMembership(groupName, typeNames, options = {}) {
  const definition = schemaDefinitions[groupName]
  if (!definition) {
    if (options.optional && typeNames.length === 0) return
    throw new Error(`${relative(schemaJsonPath)} is missing ${groupName}`)
  }
  let jsonTypes
  if (Array.isArray(definition.anyOf)) {
    jsonTypes = definition.anyOf.map((member, index) => {
      if (!member || typeof member !== "object" || typeof member.$ref !== "string") {
        throw new Error(`${groupName}.anyOf[${index}] must be a definition reference`)
      }
      return referenceName(member.$ref)
    })
  } else if (typeNames.length === 1) {
    const concrete = schemaDefinitions[typeNames[0]]
    if (canonicalCodecShape(definition) !== canonicalCodecShape(concrete)) {
      throw new Error(`${groupName} codec shape disagrees with ${typeNames[0]}`)
    }
    jsonTypes = [...typeNames]
  } else {
    throw new Error(`${groupName} must use an anyOf definition for ${typeNames.length} members`)
  }
  assertNoDuplicates(jsonTypes, `${groupName} JSON member`)
  if (
    jsonTypes.length !== typeNames.length
    || jsonTypes.some((typeName) => !typeNames.includes(typeName))
  ) {
    throw new Error(
      `${groupName} membership disagrees between ${relative(schemaTsPath)} and ${relative(schemaJsonPath)}`
    )
  }
}

function canonicalCodecShape(value) {
  return JSON.stringify(normalizeCodecShape(value))
}

function normalizeCodecShape(value, parentKey = "") {
  if (Array.isArray(value)) {
    const values = value.map((item) => normalizeCodecShape(item))
    return parentKey === "required" ? values.sort() : values
  }
  if (!value || typeof value !== "object") return value
  return Object.fromEntries(
    Object.keys(value)
      .filter((key) => key !== "description")
      .sort()
      .map((key) => [key, normalizeCodecShape(value[key], key)])
  )
}

function assertNoDuplicates(values, label) {
  const duplicates = values.filter((value, index) => values.indexOf(value) !== index)
  if (duplicates.length > 0) {
    throw new Error(`${label} duplicate: ${[...new Set(duplicates)].join(", ")}`)
  }
}

function readMessageMetadata(typeName) {
  const methodProperty = readInheritedProperty(typeName, "method")
  if (
    !methodProperty?.type
    || !ts.isLiteralTypeNode(methodProperty.type)
    || !ts.isStringLiteral(methodProperty.type.literal)
  ) {
    throw new Error(`${typeName} must declare a literal string method`)
  }
  const paramsProperty = readInheritedProperty(typeName, "params")
  if (
    !paramsProperty?.type
    || !ts.isTypeReferenceNode(paramsProperty.type)
    || !ts.isIdentifier(paramsProperty.type.typeName)
    || (paramsProperty.type.typeArguments?.length ?? 0) !== 0
  ) {
    throw new Error(`${typeName} must declare params as a named schema type`)
  }
  const method = methodProperty.type.literal.text
  const paramsType = paramsProperty.type.typeName.text
  const paramsOptional = Boolean(paramsProperty.questionToken)
  const jsonDefinition = schemaDefinitions[typeName]
  if (!jsonDefinition) throw new Error(`${relative(schemaJsonPath)} is missing ${typeName}`)
  const jsonMethod = jsonDefinition.properties?.method?.const
  if (jsonMethod !== method) {
    throw new Error(`${typeName} method disagrees: TypeScript ${method}, JSON ${String(jsonMethod)}`)
  }
  const jsonParamsRef = jsonDefinition.properties?.params?.$ref
  const jsonParamsType = typeof jsonParamsRef === "string" ? referenceName(jsonParamsRef) : undefined
  if (jsonParamsType !== paramsType) {
    throw new Error(`${typeName} params disagree: TypeScript ${paramsType}, JSON ${String(jsonParamsType)}`)
  }
  const jsonParamsOptional = !(jsonDefinition.required ?? []).includes("params")
  if (jsonParamsOptional !== paramsOptional) {
    throw new Error(
      `${typeName} params optionality disagrees: TypeScript ${paramsOptional}, JSON ${jsonParamsOptional}`
    )
  }
  if (!schemaDefinitions[paramsType]) {
    throw new Error(`${typeName} params schema ${paramsType} is missing from ${relative(schemaJsonPath)}`)
  }
  return { type: typeName, method, paramsType, paramsOptional }
}

function readInheritedProperty(typeName, propertyName, ancestry = []) {
  if (ancestry.includes(typeName)) {
    throw new Error(`Unsupported interface inheritance cycle: ${[...ancestry, typeName].join(" -> ")}`)
  }
  const declaration = oneStructuralDeclaration(
    structuralDeclarations.interfaces,
    typeName,
    "interface"
  )
  const own = declaration.members.filter(
    (member) => ts.isPropertySignature(member)
      && ts.isIdentifier(member.name)
      && member.name.text === propertyName
  )
  if (own.length > 1) throw new Error(`${typeName} declares duplicate ${propertyName} properties`)
  if (own.length === 1) return own[0]
  const inherited = []
  for (const clause of declaration.heritageClauses ?? []) {
    if (clause.token !== ts.SyntaxKind.ExtendsKeyword) {
      throw new Error(`${typeName} uses unsupported interface heritage syntax`)
    }
    for (const heritageType of clause.types) {
      if (!ts.isIdentifier(heritageType.expression) || heritageType.typeArguments?.length) {
        throw new Error(`${typeName} uses unsupported interface heritage syntax`)
      }
      const property = readInheritedProperty(
        heritageType.expression.text,
        propertyName,
        [...ancestry, typeName]
      )
      if (property) inherited.push(property)
    }
  }
  if (inherited.length > 1) {
    throw new Error(`${typeName} inherits ambiguous ${propertyName} properties`)
  }
  return inherited[0]
}

function readInterfaceInheritance(sourceText) {
  const parentsByName = new Map()
  const pattern = /export interface\s+([A-Za-z0-9_]+)(?:\s+extends\s+([^\{]+))?\s*\{/g
  let match
  while ((match = pattern.exec(sourceText)) !== null) {
    parentsByName.set(
      match[1],
      (match[2] ?? "").split(",").map((name) => name.trim()).filter(Boolean)
    )
  }
  return parentsByName
}

function readNamedDefinitionAliases(sourceText, definitionNames) {
  const aliases = new Map()
  const pattern = /export type\s+([A-Za-z0-9_]+)\s*=\s*([\s\S]*?);/g
  let match
  while ((match = pattern.exec(sourceText)) !== null) {
    const members = match[2]
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .trim()
      .replace(/^\|\s*/, "")
      .split("|")
      .map((member) => member.trim())
    if (
      members.length > 0
      && members.every((member) => /^[A-Za-z0-9_]+$/.test(member) && definitionNames.has(member))
    ) {
      aliases.set(match[1], members)
    }
  }
  return aliases
}

function readTransitiveInterfaceFamily(parentsByName, rootName) {
  if (!parentsByName.has(rootName)) {
    throw new Error(`Could not find ${rootName} interface in ${relative(schemaTsPath)}`)
  }
  const family = new Set([rootName])
  let changed = true
  while (changed) {
    changed = false
    for (const [name, parents] of parentsByName) {
      if (!family.has(name) && parents.some((parent) => family.has(parent))) {
        family.add(name)
        changed = true
      }
    }
  }
  return family
}

function readAtLeastOneRequirements(sourceText) {
  const requirements = new Map()
  const pattern = /export interface\s+([A-Za-z0-9_]+)(?:\s+extends\s+[^\{]+)?\s*\{/g
  let match
  while ((match = pattern.exec(sourceText)) !== null) {
    const precedingComment = sourceText
      .slice(0, match.index)
      .match(/\/\*\*((?:(?!\*\/)[\s\S])*)\*\/\s*$/)
    if (!precedingComment) continue
    const comment = precedingComment[0]
    const requirement = comment.match(/At least one of `([^`]+)` or `([^`]+)` MUST be present\./)
    if (requirement) requirements.set(match[1], [requirement[1], requirement[2]])
  }
  return requirements
}

function assertResultInterfacesHaveDefinitions() {
  const missing = [...resultInterfaceNames].filter((name) => !schemaDefinitions[name])
  if (missing.length > 0) {
    throw new Error(`Result-derived interfaces missing from schema.json: ${missing.join(", ")}`)
  }
  for (const [name, propertyNames] of atLeastOneRequirements) {
    const properties = schemaDefinitions[name]?.properties ?? {}
    const missingProperties = propertyNames.filter((propertyName) => !properties[propertyName])
    if (missingProperties.length > 0) {
      throw new Error(`${name} at-least-one fields missing from schema.json: ${missingProperties.join(", ")}`)
    }
  }
}

function readResultTypesByMethod() {
  const results = new Map()
  for (const [name, declarations] of structuralDeclarations.interfaces) {
    if (!name.endsWith("Result")) continue
    if (declarations.length !== 1) {
      throw new Error(`${name} must have exactly one interface declaration`)
    }
    const category = readCategoryMethod(declarations[0])
    if (category) {
      if (results.has(category)) {
        throw new Error(`Duplicate result metadata for ${category}: ${results.get(category)}, ${name}`)
      }
      results.set(category, name)
    }
  }
  return results
}

function readCategoryMethod(declaration) {
  const tags = ts.getJSDocTags(declaration)
    .filter((tag) => tag.tagName.text === "category")
    .map((tag) => typeof tag.comment === "string"
      ? tag.comment
      : (tag.comment ?? []).map((part) => part.text).join(""))
  const methodLikeTags = tags.filter((comment) => comment.includes("/") || comment.includes("`"))
  if (methodLikeTags.length === 0) return undefined
  const match = tags.length === 1
    ? tags[0].match(/^`([A-Za-z0-9_.-]+(?:\/[A-Za-z0-9_.-]+)+)`$/)
    : undefined
  if (!match) {
    const position = schemaTsFile.getLineAndCharacterOfPosition(declaration.getStart(schemaTsFile))
    throw new Error(
      `${declaration.name.text} at ${relative(schemaTsPath)}:${position.line + 1} @category metadata must contain exactly one exact backticked method literal; got ${tags.map((tag) => JSON.stringify(tag)).join(", ") || "none"}`
    )
  }
  return match[1]
}

function methodMapForDescriptors(descriptors) {
  return Object.fromEntries(descriptors.map(({ type, method }) => [type, method]))
}

function resultTypeForRequest(requestType, method) {
  const resultType = resultTypesByMethod.get(method)
  if (resultType) {
    return resultType
  }
  if (emptyResultMethods.has(method)) {
    return "EmptyResult"
  }
  throw new Error(`${requestType} (${method}) is missing request/result metadata`)
}

function requestDescriptorsFor(typeNames, direction, groupName) {
  const descriptors = typeNames.map((typeName) => {
    const metadata = readMessageMetadata(typeName)
    const resultType = resultTypeForRequest(typeName, metadata.method)
    assertJsonResultMetadata(typeName, resultType)
    return {
      ...metadata,
      direction,
      http: readHttpMetadata(metadata),
      resultType
    }
  })
  assertUniqueDescriptors(descriptors, groupName)
  return descriptors
}

function notificationDescriptorsFor(typeNames, direction, groupName) {
  const descriptors = typeNames.map((typeName) => {
    const metadata = readMessageMetadata(typeName)
    return {
      ...metadata,
      direction,
      http: readHttpMetadata(metadata)
    }
  })
  assertUniqueDescriptors(descriptors, groupName)
  return descriptors
}

function assertUniqueDescriptors(descriptors, groupName) {
  assertNoDuplicates(descriptors.map(({ type }) => type), `${groupName} descriptor type`)
  assertNoDuplicates(descriptors.map(({ method }) => method), `${groupName} descriptor method`)
}

function assertDirectionDescriptorDisjoint(direction, requestDescriptors, notificationDescriptors) {
  assertDescriptorFieldDisjoint(direction, "method", requestDescriptors, notificationDescriptors)
  assertDescriptorFieldDisjoint(direction, "type", requestDescriptors, notificationDescriptors)
}

function assertDescriptorFieldDisjoint(direction, field, requestDescriptors, notificationDescriptors) {
  const requestsByValue = new Map(requestDescriptors.map((descriptor) => [descriptor[field], descriptor]))
  for (const notification of notificationDescriptors) {
    const request = requestsByValue.get(notification[field])
    if (request) {
      throw new Error(
        `${direction} ${field} collision for ${notification[field]}: ${request.type} and ${notification.type}`
      )
    }
  }
}

function assertJsonResultMetadata(requestType, resultType) {
  if (!schemaDefinitions[resultType]) {
    throw new Error(`${requestType} result ${resultType} is missing from ${relative(schemaJsonPath)}`)
  }
  const response = schemaDefinitions[`${resultType}Response`]
  if (!response) return
  const result = response.properties?.result
  const refs = typeof result?.$ref === "string"
    ? [referenceName(result.$ref)]
    : Array.isArray(result?.anyOf)
      ? result.anyOf.map((member, index) => {
        if (typeof member?.$ref !== "string") {
          throw new Error(`${resultType}Response.result.anyOf[${index}] must be a definition reference`)
        }
        return referenceName(member.$ref)
      })
      : []
  assertNoDuplicates(refs, `${resultType}Response result`)
  if (
    !refs.includes(resultType)
    || refs.some((name) => name !== resultType && name !== "InputRequiredResult")
  ) {
    throw new Error(`${requestType} result disagrees: expected ${resultType}, JSON has ${refs.join(", ")}`)
  }
}

function readHttpMetadata({ method, paramsType }) {
  const nameSource = method === "tools/call" || method === "prompts/get"
    ? "params.name"
    : method === "resources/read"
      ? "params.uri"
      : null
  if (nameSource) {
    const propertyName = nameSource.slice("params.".length)
    const paramsDefinition = schemaDefinitions[paramsType]
    if (
      !paramsDefinition
      || paramsDefinition.type !== "object"
      || !paramsDefinition.properties
      || typeof paramsDefinition.properties !== "object"
      || Array.isArray(paramsDefinition.properties)
    ) {
      throw new Error(
        `${method} HTTP name source params schema ${paramsType} must be an object with a properties object`
      )
    }
    const property = paramsDefinition.properties[propertyName]
    if (
      property?.type !== "string"
      || !(paramsDefinition.required ?? []).includes(propertyName)
      || (propertyName === "uri" && property.format !== "uri")
    ) {
      throw new Error(
        `${method} HTTP ${nameSource} must be a required primitive ${propertyName === "uri" ? "URI string" : "string"}`
      )
    }
  }
  return { methodHeader: method, nameSource }
}

function assertKnownEmptyResultMethods() {
  const requestMethods = new Set([
    ...Object.values(clientRequestMethodMap),
    ...Object.values(serverRequestMethodMap)
  ])
  const missing = [...emptyResultMethods].filter((method) => !requestMethods.has(method))
  if (missing.length > 0) {
    throw new Error(`Known EmptyResult methods are not stable MCP requests: ${missing.join(", ")}`)
  }
}

function generateProtocolFile() {
  const clientRequestMethods = clientRequestDescriptors.map(({ method }) => method)
  const clientNotificationMethods = clientNotificationDescriptors.map(({ method }) => method)
  const serverRequestMethods = serverRequestDescriptors.map(({ method }) => method)
  const serverNotificationMethods = serverNotificationDescriptors.map(({ method }) => method)
  const taskRequestMethods = clientRequestMethods.filter((method) => method.startsWith("tasks/"))
  const taskNotificationMethods = serverNotificationMethods.filter((method) =>
    method.startsWith("notifications/tasks/")
  )
  const elicitationNotificationMethods = serverNotificationMethods.filter((method) =>
    method.startsWith("notifications/elicitation/")
  )

  return `${generatedBanner("vendored modelcontextprotocol schema.ts")}

import * as Schema from "effect/Schema"
import * as Generated from "./McpSchema.generated.js"

export const LATEST_PROTOCOL_VERSION = ${json(protocolVersion)} as const

const methodByType = <
  Descriptors extends ReadonlyArray<{ readonly type: string; readonly method: string }>
>(
  descriptors: Descriptors
): { readonly [Descriptor in Descriptors[number] as Descriptor["type"]]: Descriptor["method"] } =>
  Object.fromEntries(descriptors.map(({ type, method }) => [type, method])) as {
    readonly [Descriptor in Descriptors[number] as Descriptor["type"]]: Descriptor["method"]
  }

const resultTypeByType = <
  Descriptors extends ReadonlyArray<{ readonly type: string; readonly resultType: string }>
>(
  descriptors: Descriptors
): {
  readonly [Descriptor in Descriptors[number] as Descriptor["type"]]: Descriptor["resultType"]
} =>
  Object.fromEntries(descriptors.map(({ type, resultType }) => [type, resultType])) as {
    readonly [Descriptor in Descriptors[number] as Descriptor["type"]]: Descriptor["resultType"]
  }

const resultTypeByMethod = <
  Descriptors extends ReadonlyArray<{ readonly method: string; readonly resultType: string }>
>(
  descriptors: Descriptors
): {
  readonly [Descriptor in Descriptors[number] as Descriptor["method"]]: Descriptor["resultType"]
} =>
  Object.fromEntries(descriptors.map(({ method, resultType }) => [method, resultType])) as {
    readonly [Descriptor in Descriptors[number] as Descriptor["method"]]: Descriptor["resultType"]
  }

const paramsTypeByType = <
  Descriptors extends ReadonlyArray<{ readonly type: string; readonly paramsType: string }>
>(descriptors: Descriptors): {
  readonly [Descriptor in Descriptors[number] as Descriptor["type"]]: Descriptor["paramsType"]
} => Object.fromEntries(descriptors.map(({ type, paramsType }) => [type, paramsType])) as {
  readonly [Descriptor in Descriptors[number] as Descriptor["type"]]: Descriptor["paramsType"]
}

const paramsTypeByMethod = <
  Descriptors extends ReadonlyArray<{ readonly method: string; readonly paramsType: string }>
>(descriptors: Descriptors): {
  readonly [Descriptor in Descriptors[number] as Descriptor["method"]]: Descriptor["paramsType"]
} => Object.fromEntries(descriptors.map(({ method, paramsType }) => [method, paramsType])) as {
  readonly [Descriptor in Descriptors[number] as Descriptor["method"]]: Descriptor["paramsType"]
}

const methodSet = <Methods extends ReadonlyArray<string>>(
  methods: Methods
): ReadonlySet<Methods[number]> => new Set(methods)

export const CLIENT_REQUEST_DESCRIPTORS = ${constArray(clientRequestDescriptors)}
export type ClientRequestDescriptor = typeof CLIENT_REQUEST_DESCRIPTORS[number]
export type ClientRequestType = ClientRequestDescriptor["type"]
export type ClientRequestMethod = ClientRequestDescriptor["method"]
export type ClientRequestResultType = ClientRequestDescriptor["resultType"]
export type ClientResultTypeForMethod<Method extends ClientRequestMethod> =
  Extract<ClientRequestDescriptor, { readonly method: Method }>["resultType"]
export type ClientResultTypeForType<Type extends ClientRequestType> =
  Extract<ClientRequestDescriptor, { readonly type: Type }>["resultType"]

export const CLIENT_NOTIFICATION_DESCRIPTORS = ${constArray(clientNotificationDescriptors)}
export type ClientNotificationDescriptor = typeof CLIENT_NOTIFICATION_DESCRIPTORS[number]
export type ClientNotificationType = ClientNotificationDescriptor["type"]
export type ClientNotificationMethod = ClientNotificationDescriptor["method"]

export const SERVER_REQUEST_DESCRIPTORS = ${constArray(serverRequestDescriptors)}
export type ServerRequestDescriptor = typeof SERVER_REQUEST_DESCRIPTORS[number]
export type ServerRequestType = ServerRequestDescriptor["type"]
export type ServerRequestMethod = ServerRequestDescriptor["method"]
export type ServerRequestResultType = ServerRequestDescriptor["resultType"]
export type ServerResultTypeForMethod<Method extends ServerRequestMethod> =
  Extract<ServerRequestDescriptor, { readonly method: Method }>["resultType"]
export type ServerResultTypeForType<Type extends ServerRequestType> =
  Extract<ServerRequestDescriptor, { readonly type: Type }>["resultType"]

export const SERVER_NOTIFICATION_DESCRIPTORS = ${constArray(serverNotificationDescriptors)}
export type ServerNotificationDescriptor = typeof SERVER_NOTIFICATION_DESCRIPTORS[number]
export type ServerNotificationType = ServerNotificationDescriptor["type"]
export type ServerNotificationMethod = ServerNotificationDescriptor["method"]

export const CLIENT_REQUEST_TYPES = ${constArray(clientRequests)}
export const CLIENT_NOTIFICATION_TYPES = ${constArray(clientNotifications)}
export const SERVER_REQUEST_TYPES = ${constArray(serverRequests)}
export const SERVER_NOTIFICATION_TYPES = ${constArray(serverNotifications)}

export const CLIENT_REQUEST_METHODS = ${constArray(clientRequestMethods)}
export const CLIENT_NOTIFICATION_METHODS = ${constArray(clientNotificationMethods)}
export const SERVER_REQUEST_METHODS = ${constArray(serverRequestMethods)}
export const SERVER_NOTIFICATION_METHODS = ${constArray(serverNotificationMethods)}

export const CLIENT_REQUEST_METHOD_BY_TYPE = methodByType(CLIENT_REQUEST_DESCRIPTORS)
export const CLIENT_NOTIFICATION_METHOD_BY_TYPE = methodByType(CLIENT_NOTIFICATION_DESCRIPTORS)
export const SERVER_REQUEST_METHOD_BY_TYPE = methodByType(SERVER_REQUEST_DESCRIPTORS)
export const SERVER_NOTIFICATION_METHOD_BY_TYPE = methodByType(SERVER_NOTIFICATION_DESCRIPTORS)

export const CLIENT_REQUEST_PARAMS_TYPE_BY_TYPE = paramsTypeByType(CLIENT_REQUEST_DESCRIPTORS)
export const CLIENT_REQUEST_PARAMS_TYPE_BY_METHOD = paramsTypeByMethod(CLIENT_REQUEST_DESCRIPTORS)
export const CLIENT_NOTIFICATION_PARAMS_TYPE_BY_TYPE = paramsTypeByType(CLIENT_NOTIFICATION_DESCRIPTORS)
export const CLIENT_NOTIFICATION_PARAMS_TYPE_BY_METHOD = paramsTypeByMethod(CLIENT_NOTIFICATION_DESCRIPTORS)
export const SERVER_REQUEST_PARAMS_TYPE_BY_TYPE = paramsTypeByType(SERVER_REQUEST_DESCRIPTORS)
export const SERVER_REQUEST_PARAMS_TYPE_BY_METHOD = paramsTypeByMethod(SERVER_REQUEST_DESCRIPTORS)
export const SERVER_NOTIFICATION_PARAMS_TYPE_BY_TYPE = paramsTypeByType(SERVER_NOTIFICATION_DESCRIPTORS)
export const SERVER_NOTIFICATION_PARAMS_TYPE_BY_METHOD = paramsTypeByMethod(SERVER_NOTIFICATION_DESCRIPTORS)

${generateProtocolRegistries("CLIENT_REQUEST", clientRequestDescriptors, { request: true })}

${generateProtocolRegistries("CLIENT_NOTIFICATION", clientNotificationDescriptors)}

${generateProtocolRegistries("SERVER_REQUEST", serverRequestDescriptors, { request: true })}

${generateProtocolRegistries("SERVER_NOTIFICATION", serverNotificationDescriptors)}

export const CLIENT_REQUEST_CODEC = Generated.ClientRequest
export const CLIENT_NOTIFICATION_CODEC = Generated.ClientNotification
export const SERVER_NOTIFICATION_CODEC = Generated.ServerNotification
export const JSONRPC_REQUEST_CODEC = Generated.JSONRPCRequest
export const JSONRPC_NOTIFICATION_CODEC = Generated.JSONRPCNotification
export const JSONRPC_RESULT_RESPONSE_CODEC = Generated.JSONRPCResultResponse
export const JSONRPC_ERROR_RESPONSE_CODEC = Generated.JSONRPCErrorResponse
export const JSONRPC_RESPONSE_CODEC = Generated.JSONRPCResponse
export const JSONRPC_MESSAGE_CODEC = Generated.JSONRPCMessage

export const CLIENT_REQUEST_RESULT_TYPE_BY_TYPE = resultTypeByType(CLIENT_REQUEST_DESCRIPTORS)
export const CLIENT_REQUEST_RESULT_TYPE_BY_METHOD = resultTypeByMethod(CLIENT_REQUEST_DESCRIPTORS)
export const SERVER_REQUEST_RESULT_TYPE_BY_TYPE = resultTypeByType(SERVER_REQUEST_DESCRIPTORS)
export const SERVER_REQUEST_RESULT_TYPE_BY_METHOD = resultTypeByMethod(SERVER_REQUEST_DESCRIPTORS)

export const CLIENT_REQUEST_METHOD_SET = methodSet(CLIENT_REQUEST_METHODS)
export const CLIENT_NOTIFICATION_METHOD_SET = methodSet(CLIENT_NOTIFICATION_METHODS)
export const SERVER_REQUEST_METHOD_SET = methodSet(SERVER_REQUEST_METHODS)
export const SERVER_NOTIFICATION_METHOD_SET = methodSet(SERVER_NOTIFICATION_METHODS)

export const isClientRequestMethod = (method: string): method is ClientRequestMethod =>
  CLIENT_REQUEST_METHOD_SET.has(method as ClientRequestMethod)

export const isClientNotificationMethod = (method: string): method is ClientNotificationMethod =>
  CLIENT_NOTIFICATION_METHOD_SET.has(method as ClientNotificationMethod)

export const isServerRequestMethod = (method: string): method is ServerRequestMethod =>
  SERVER_REQUEST_METHOD_SET.has(method as ServerRequestMethod)

export const isServerNotificationMethod = (method: string): method is ServerNotificationMethod =>
  SERVER_NOTIFICATION_METHOD_SET.has(method as ServerNotificationMethod)

export const TASK_REQUEST_METHODS = ${constArray(taskRequestMethods)}
export const TASK_NOTIFICATION_METHODS = ${constArray(taskNotificationMethods)}
export const ELICITATION_NOTIFICATION_METHODS = ${constArray(elicitationNotificationMethods)}
`
}

function generateProtocolRegistries(prefix, descriptors, options = {}) {
  const descriptorByType = objectLiteral(descriptors.map((descriptor, index) => [
    descriptor.type,
    `${prefix}_DESCRIPTORS[${index}]`
  ]))
  const descriptorByMethod = objectLiteral(descriptors.map((descriptor, index) => [
    descriptor.method,
    `${prefix}_DESCRIPTORS[${index}]`
  ]))
  const codecByType = objectLiteral(descriptors.map((descriptor) => [
    descriptor.type,
    `Generated.${descriptor.type}`
  ]))
  const codecByMethod = objectLiteral(descriptors.map((descriptor) => [
    descriptor.method,
    `Generated.${descriptor.type}`
  ]))
  const paramsByType = objectLiteral(descriptors.map((descriptor) => [
    descriptor.type,
    `Generated.${descriptor.paramsType}`
  ]))
  const paramsByMethod = objectLiteral(descriptors.map((descriptor) => [
    descriptor.method,
    `Generated.${descriptor.paramsType}`
  ]))
  const payloadByType = objectLiteral(descriptors.map((descriptor) => [
    descriptor.type,
    descriptor.paramsOptional
      ? `Schema.UndefinedOr(Generated.${descriptor.paramsType})`
      : `Generated.${descriptor.paramsType}`
  ]))
  const payloadByMethod = objectLiteral(descriptors.map((descriptor) => [
    descriptor.method,
    `${prefix}_PAYLOAD_CODEC_BY_TYPE[${json(descriptor.type)}]`
  ]))
  const resultRegistries = options.request
    ? `
export const ${prefix}_RESULT_CODEC_BY_TYPE = ${objectLiteral(descriptors.map((descriptor) => [
      descriptor.type,
      `Generated.${descriptor.resultType}`
    ]))}
export const ${prefix}_RESULT_CODEC_BY_METHOD = ${objectLiteral(descriptors.map((descriptor) => [
      descriptor.method,
      `Generated.${descriptor.resultType}`
    ]))}`
    : ""
  return `export const ${prefix}_DESCRIPTOR_BY_TYPE = ${descriptorByType}
export const ${prefix}_DESCRIPTOR_BY_METHOD = ${descriptorByMethod}
export const ${prefix}_CODEC_BY_TYPE = ${codecByType}
export const ${prefix}_CODEC_BY_METHOD = ${codecByMethod}
export const ${prefix}_PARAMS_CODEC_BY_TYPE = ${paramsByType}
export const ${prefix}_PARAMS_CODEC_BY_METHOD = ${paramsByMethod}
export const ${prefix}_PAYLOAD_CODEC_BY_TYPE = ${payloadByType}
export const ${prefix}_PAYLOAD_CODEC_BY_METHOD = ${payloadByMethod}${resultRegistries}`
}

function objectLiteral(entries) {
  if (entries.length === 0) return "{} as const"
  return `{\n${entries.map(([key, expression]) => `  ${json(key)}: ${expression}`).join(",\n")}\n} as const`
}

function generateSchemaFile() {
  return `${generatedBanner("vendored modelcontextprotocol schema.json")}

import * as Schema from "effect/Schema"

const optional = Schema.optional

const required = <Codec extends Schema.Schema.All>(codec: Codec): Codec =>
  (codec as Schema.Schema.AnyNoContext).pipe(Schema.filter(
    (value: unknown) => value !== undefined,
    { message: () => "Expected required property" }
  )) as unknown as Codec

const isOneOfMatch = (schema: Schema.Schema.All, input: unknown): boolean =>
  Schema.decodeUnknownEither(schema as Schema.Schema.AnyNoContext)(input)._tag === "Right"

const isTypeMatch = (schema: Schema.Schema.All, input: unknown): boolean =>
  Schema.encodeUnknownEither(schema as Schema.Schema.AnyNoContext)(input)._tag === "Right"

const mergeIntersectionValues = (left: unknown, right: unknown): unknown => {
  if (
    typeof left === "object" && left !== null && !Array.isArray(left)
    && typeof right === "object" && right !== null && !Array.isArray(right)
  ) {
    return Object.assign(Object.create(Object.getPrototypeOf(left)), left, right)
  }
  return left
}

type ExactIntersection<Left extends Schema.Schema.All, Right extends Schema.Schema.All> =
  Schema.Schema<
    Schema.Schema.Type<Left> & Schema.Schema.Type<Right>,
    Schema.Schema.Encoded<Left> & Schema.Schema.Encoded<Right>
  >

const exactIntersection = <
  Left extends Schema.Schema.All,
  Right extends Schema.Schema.All
>(
  left: Left,
  right: Right
): ExactIntersection<Left, Right> => {
  const encoded = Schema.Unknown.pipe(Schema.filter(
    (input) => isOneOfMatch(left, input) && isOneOfMatch(right, input),
    { message: () => "Expected a value matching every intersection member" }
  ))
  const decoded = Schema.Unknown.pipe(Schema.filter(
    (value) => isTypeMatch(left, value) && isTypeMatch(right, value),
    { message: () => "Expected a value matching every intersection member" }
  ))
  try {
    const representation = Schema.extend(
      left as Schema.Schema.Any,
      right as Schema.Schema.Any
    )
    return Schema.transform(encoded, decoded, {
      strict: true,
      decode: (input) => Schema.decodeUnknownSync(
        representation as unknown as Schema.Schema.AnyNoContext
      )(input),
      encode: (value) => {
        // Validate the original decoded value before the structural codec has
        // an opportunity to strip fields while encoding.
        Schema.encodeUnknownSync(left as Schema.Schema.AnyNoContext)(value)
        Schema.encodeUnknownSync(right as Schema.Schema.AnyNoContext)(value)
        return Schema.encodeUnknownSync(
          representation as unknown as Schema.Schema.AnyNoContext
        )(value)
      }
    }) as unknown as ExactIntersection<Left, Right>
  } catch {
    // Effect cannot structurally extend every valid JSON Schema intersection
    // (for example, Int with an integer literal). Decode and encode both
    // members, merging object representations so no member's fields or class
    // prototype are discarded.
    return Schema.transform(encoded, decoded, {
      strict: true,
      decode: (input) => mergeIntersectionValues(
        Schema.decodeUnknownSync(left as Schema.Schema.AnyNoContext)(input),
        Schema.decodeUnknownSync(right as Schema.Schema.AnyNoContext)(input)
      ),
      encode: (value) => mergeIntersectionValues(
        Schema.encodeUnknownSync(left as Schema.Schema.AnyNoContext)(value),
        Schema.encodeUnknownSync(right as Schema.Schema.AnyNoContext)(value)
      )
    }) as unknown as ExactIntersection<Left, Right>
  }
}

const withEncodedConstraint = <Codec extends Schema.Schema.All>(
  codec: Codec,
  constraint: Schema.Schema.All
): Codec => Schema.compose(
  constraint as Schema.Schema.AnyNoContext,
  codec as Schema.Schema.AnyNoContext,
  { strict: false }
) as unknown as Codec

const withEncodedBounds = <Codec extends Schema.Schema.All>(
  codec: Codec,
  bounds: {
    readonly minimum?: number
    readonly maximum?: number
    readonly minLength?: number
    readonly maxLength?: number
    readonly minItems?: number
    readonly maxItems?: number
  }
): Codec => withEncodedConstraint(codec, Schema.Unknown.pipe(Schema.filter(
  (input) => {
    if (typeof input === "number") {
      if (bounds.minimum !== undefined && input < bounds.minimum) return false
      if (bounds.maximum !== undefined && input > bounds.maximum) return false
    }
    if (typeof input === "string") {
      const length = Array.from(input).length
      if (bounds.minLength !== undefined && length < bounds.minLength) return false
      if (bounds.maxLength !== undefined && length > bounds.maxLength) return false
    }
    if (Array.isArray(input)) {
      if (bounds.minItems !== undefined && input.length < bounds.minItems) return false
      if (bounds.maxItems !== undefined && input.length > bounds.maxItems) return false
    }
    return true
  },
  { message: () => "Expected encoded value to satisfy applicable bounds" }
)))

const typedObject = <
  Fields extends Schema.Struct.Fields,
  Value extends Schema.Schema.AnyNoContext
>(
  fields: Fields,
  fieldNames: ReadonlyArray<string>,
  value: Value
) => Schema.Struct(
  fields,
  Schema.Record({
    key: Schema.String.pipe(Schema.filter((key) => !fieldNames.includes(key))),
    value
  })
) as unknown as Schema.TypeLiteral<
  Fields,
  readonly [{ readonly key: typeof Schema.String; readonly value: typeof Schema.Unknown }]
>

const oneOf = <Members extends readonly [
  Schema.Schema.AnyNoContext,
  Schema.Schema.AnyNoContext,
  ...Schema.Schema.AnyNoContext[]
]>(...members: Members) =>
  Schema.compose(
    Schema.Unknown.pipe(Schema.filter(
      (input) => members.filter((member) => isOneOfMatch(member, input)).length === 1,
      { message: () => "Expected exactly one matching oneOf member" }
    )),
    Schema.Union(...members),
    { strict: false }
  )

${generateRecursiveJsonCodecs()}

${generateDefinitionCodecs()}

${generateSchemaRegistry()}
`
}

function generateRecursiveJsonCodecs() {
  for (const name of recursiveJsonNames) {
    if (!schemaDefinitions[name]) {
      throw new Error(`${relative(schemaJsonPath)} is missing recursive JSON definition ${name}`)
    }
  }
  return `export type JSONValue = string | number | boolean | null | JSONObject | JSONArray
export type JSONObject = { readonly [key: string]: JSONValue }
export type JSONArray = ReadonlyArray<JSONValue>

export const JSONValue: Schema.Schema<JSONValue> = Schema.suspend(() =>
  Schema.Union(Schema.String, Schema.Finite, Schema.Boolean, Schema.Null, JSONObject, JSONArray)
)
export const JSONObject: Schema.Schema<JSONObject> = Schema.Record({ key: Schema.String, value: JSONValue })
export const JSONArray: Schema.Schema<JSONArray> = Schema.Array(JSONValue)`
}

function generateDefinitionCodecs() {
  return definitionOrder()
    .filter((name) => !recursiveJsonNames.has(name))
    .map((name) => generateNamedCodec(name, schemaDefinitions[name]))
    .join("\n\n")
}

function definitionOrder() {
  const ordered = []
  const visited = new Set(recursiveJsonNames)
  const visiting = new Set()
  const visit = (name) => {
    if (visited.has(name)) return
    if (visiting.has(name)) {
      throw new Error(`Unsupported recursive schema definitions involving ${name}`)
    }
    const definition = schemaDefinitions[name]
    if (!definition) throw new Error(`Unknown MCP schema definition ${name}`)
    visiting.add(name)
    for (const dependency of referencedDefinitions(definition)) visit(dependency)
    for (const dependency of namedDefinitionAliases.get(name) ?? []) visit(dependency)
    visiting.delete(name)
    visited.add(name)
    ordered.push(name)
  }
  for (const name of Object.keys(schemaDefinitions)) visit(name)
  return ordered
}

function referencedDefinitions(fragment) {
  const names = new Set()
  const visit = (value) => {
    if (Array.isArray(value)) {
      for (const item of value) visit(item)
      return
    }
    if (!value || typeof value !== "object") return
    if (typeof value.$ref === "string") names.add(referenceName(value.$ref))
    for (const [key, item] of Object.entries(value)) {
      if (key !== "$ref") visit(item)
    }
  }
  visit(fragment)
  return names
}

function generateNamedCodec(name, definition) {
  validateSchemaFragment(definition, name)
  if (name === "MetaObject") {
    return `export const MetaObject = Schema.Record({ key: Schema.String, value: Schema.Unknown }).annotations(${json({ description: definition.description })})`
  }
  if (["RequestMetaObject", "NotificationMetaObject", "ResultMetaObject", "SubscriptionsListenResultMeta"].includes(name)) {
    return `export const ${name} = ${objectExpression({ ...definition, additionalProperties: {} }, name)}${definition.description ? `.annotations(${json({ description: definition.description })})` : ""}`
  }
  if (name === "ResultType") {
    return `export const ResultType = Schema.String.annotations(${json({ description: definition.description })})`
  }
  if (name === "EmptyResult") {
    const resultDefinition = schemaDefinitions.Result
    if (!resultDefinition) throw new Error("EmptyResult requires the Result definition")
    return `export const EmptyResult = ${schemaExpression({
      ...resultDefinition,
      description: definition.description ?? resultDefinition.description,
      properties: {
        ...resultDefinition.properties,
        resultType: {
          ...resultDefinition.properties?.resultType,
          const: "complete"
        }
      }
    }, name)}`
  }
  if (name === "ListRootsRequest") {
    const params = definition.properties?.params
    if (!params) throw new Error("ListRootsRequest requires a params definition")
    const fields = generateObjectFields(name, definition, {
      params: "ListRootsRequestParams"
    })
    return `export const ListRootsRequestParams = ${schemaExpression(params, "ListRootsRequest.params")}

${generateOpenClass(name, fields, definition.description)}`
  }
  const aliasMembers = namedDefinitionAliases.get(name)
  if (aliasMembers) {
    const expression = aliasMembers.length === 1
      ? aliasMembers[0]
      : `Schema.Union(${aliasMembers.join(", ")})`
    return `export const ${name} = ${expression}`
  }
  if (definition.type === "object" && resultInterfaceNames.has(name) && name !== "Result") {
    const fields = generateObjectFields(name, definition)
    return generateOpenClass(name, fields, definition.description, { applyAtLeastOne: true })
  }
  if (definition.type === "object" && !hasIndexSignature(definition)) {
    const fields = generateObjectFields(name, definition)
    return generateOpenClass(name, fields, definition.description)
  }
  return `export const ${name} = ${schemaExpression(definition, name)}`
}

function generateOpenClass(name, fields, description, options = {}) {
  const struct = `Schema.Struct({
${fields}
}, Schema.Record({ key: Schema.String, value: Schema.Unknown }))`
  const fieldsOr = options.applyAtLeastOne ? applyAtLeastOneRequirement(name, struct) : struct
  const annotations = description ? `, ${json({ description })}` : ""
  return `const ${name}OpenFields = ${struct}
const ${name}ClassFields = ${fieldsOr.replace(struct, `${name}OpenFields`)}

export class ${name} extends Schema.Class<${name}>("mcp/generated/${protocolVersion}/${name}")(
${name}ClassFields as unknown as Schema.Struct<typeof ${name}OpenFields.fields>${annotations}
) {
  constructor(props: Schema.Schema.Type<typeof ${name}OpenFields>, options?: Schema.MakeOptions) {
    super(props, options)
  }

  readonly [key: string]: unknown
}`
}

function applyAtLeastOneRequirement(name, expression) {
  const propertyNames = atLeastOneRequirements.get(name)
  if (!propertyNames) return expression
  const predicate = propertyNames
    .map((propertyName) => `value[${json(propertyName)}] !== undefined`)
    .join(" || ")
  const message = `At least one of ${propertyNames.map((propertyName) => `\`${propertyName}\``).join(" or ")} MUST be present.`
  return `${expression}.pipe(Schema.filter(
  (value) => ${predicate},
  { message: () => ${json(message)} }
))`
}

function hasIndexSignature(definition) {
  return Object.prototype.hasOwnProperty.call(definition, "additionalProperties")
}

function generateObjectFields(definitionName, definition, overrides = {}) {
  const required = new Set(requiredPropertyNames(definition, definitionName))
  return objectFieldNames(definition, definitionName)
    .sort((left, right) => left.localeCompare(right))
    .map((propertyName) => {
      let propertyDefinition = definition.properties?.[propertyName]
      if (propertyName === "resultType" && definitionName !== "Result") {
        propertyDefinition = {
          ...propertyDefinition,
          const: definitionName === "InputRequiredResult" ? "input_required" : "complete"
        }
      }
      const expression = overrides[propertyName]
        ?? (propertyDefinition
          ? schemaExpression(propertyDefinition, `${definitionName}.${propertyName}`)
          : missingRequiredPropertyExpression(definition, `${definitionName}.${propertyName}`))
      const propertySchema = required.has(propertyName) ? expression : `optional(${expression})`
      return `  ${json(propertyName)}: ${propertySchema}`
    })
    .join(",\n")
}

function schemaExpression(fragment, location) {
  validateSchemaFragment(fragment, location)
  let expression
  if (fragment.$ref) {
    expression = referenceName(fragment.$ref)
    const sibling = Object.fromEntries(
      Object.entries(fragment).filter(([key]) => ![
        "$ref",
        "description",
        ...boundKeywords
      ].includes(key))
    )
    if (Object.keys(sibling).length > 0) {
      const siblingExpression = schemaExpression(sibling, `${location}.$refSiblings`)
      const referenceTransforms = hasByteTransform(schemaDefinitions[referenceName(fragment.$ref)])
      const siblingTransforms = hasByteTransform(sibling)
      if (referenceTransforms && siblingTransforms) {
        throw new Error(`Unsupported multiple transforming schemas at ${location}`)
      }
      expression = referenceTransforms
        ? `withEncodedConstraint(${expression}, ${siblingExpression})`
        : siblingTransforms
          ? `withEncodedConstraint(${siblingExpression}, ${expression})`
          : `exactIntersection(${expression}, ${siblingExpression})`
    }
  } else if (Object.prototype.hasOwnProperty.call(fragment, "const")) {
    expression = `Schema.Literal(${json(fragment.const)})`
  } else if (Array.isArray(fragment.enum)) {
    if (fragment.enum.length === 0) throw new Error(`Unsupported empty enum at ${location}`)
    expression = `Schema.Literal(${fragment.enum.map((value) => json(value)).join(", ")})`
  } else if (fragment.oneOf) {
    if (fragment.oneOf.length < 2) throw new Error(`Unsupported oneOf at ${location}`)
    expression = `oneOf(${fragment.oneOf.map((member, index) => schemaExpression(member, `${location}[${index}]`)).join(", ")})`
  } else if (fragment.anyOf) {
    const members = fragment.anyOf
    if (members.length === 0) throw new Error(`Unsupported empty union at ${location}`)
    expression = `Schema.Union(${members.map((member, index) => schemaExpression(member, `${location}[${index}]`)).join(", ")})`
  } else if (fragment.allOf) {
    if (fragment.allOf.length < 2) throw new Error(`Unsupported allOf at ${location}`)
    const members = fragment.allOf.map((member, index) => ({
      expression: schemaExpression(member, `${location}.allOf[${index}]`),
      transforms: hasByteTransform(member)
    }))
    const transformingMembers = members.filter((member) => member.transforms)
    if (transformingMembers.length > 1) {
      throw new Error(`Unsupported multiple transforming allOf members at ${location}`)
    }
    expression = transformingMembers.length === 1
      ? members
        .filter((member) => !member.transforms)
        .reduce(
          (codec, member) => `withEncodedConstraint(${codec}, ${member.expression})`,
          transformingMembers[0].expression
        )
      : members
        .map((member) => member.expression)
        .reduce((left, right) => `exactIntersection(${left}, ${right})`)
  } else if (Array.isArray(fragment.type)) {
    expression = `Schema.Union(${fragment.type.map((type, index) => schemaExpression({ type }, `${location}.type[${index}]`)).join(", ")})`
  } else {
    expression = expressionForType(fragment, location)
  }
  expression = applyBounds(expression, fragment, location)
  if (fragment.description) expression += `.annotations(${json({ description: fragment.description })})`
  return expression
}

function expressionForType(fragment, location) {
  if (fragment.format === "byte") return "Schema.Uint8ArrayFromBase64"
  if (fragment.format && !["uri", "uri-template"].includes(fragment.format)) {
    throw new Error(`Unsupported string format ${json(fragment.format)} at ${location}`)
  }
  switch (fragment.type) {
    case "string": return "Schema.String"
    case "number": return "Schema.Finite"
    case "integer": return "Schema.Int"
    case "boolean": return "Schema.Boolean"
    case "null": return "Schema.Null"
    case "array":
      if (!fragment.items) throw new Error(`Unsupported array without items at ${location}`)
      return `Schema.Array(${schemaExpression(fragment.items, `${location}.items`)})`
    case "object": return objectExpression(fragment, location)
    case undefined:
      if (Object.keys(fragment).every((key) => key === "description" || boundKeywords.includes(key))) {
        return "Schema.Unknown"
      }
      break
  }
  throw new Error(`Unsupported schema construct at ${location}: ${json(fragment)}`)
}

function objectExpression(fragment, location) {
  const required = new Set(requiredPropertyNames(fragment, location))
  const propertyNames = objectFieldNames(fragment, location)
  if (propertyNames.length === 0 && !Object.prototype.hasOwnProperty.call(fragment, "additionalProperties")) {
    return "Schema.Record({ key: Schema.String, value: Schema.Unknown })"
  }
  const fields = propertyNames
    .sort((left, right) => left.localeCompare(right))
    .map((propertyName) => {
      const propertyDefinition = fragment.properties?.[propertyName]
      const property = propertyDefinition
        ? schemaExpression(propertyDefinition, `${location}.${propertyName}`)
        : missingRequiredPropertyExpression(fragment, `${location}.${propertyName}`)
      return `${json(propertyName)}: ${required.has(propertyName) ? property : `optional(${property})`}`
    })
    .join(", ")
  if (fragment.additionalProperties === false) {
    return `Schema.Struct({ ${fields} }).annotations(${json({
      parseOptions: { onExcessProperty: "error" }
    })})`
  }
  if (
    Object.prototype.hasOwnProperty.call(fragment, "additionalProperties")
    && fragment.additionalProperties !== true
  ) {
    return `typedObject({ ${fields} }, ${constArray(propertyNames)}, ${schemaExpression(
      fragment.additionalProperties,
      `${location}.additionalProperties`
    )})`
  }
  return `Schema.Struct({ ${fields} }, Schema.Record({ key: Schema.String, value: Schema.Unknown }))`
}

function objectFieldNames(fragment, location) {
  return [...new Set([
    ...Object.keys(fragment.properties ?? {}),
    ...requiredPropertyNames(fragment, location)
  ])]
}

function requiredPropertyNames(fragment, location) {
  if (fragment.required === undefined) return []
  if (!Array.isArray(fragment.required)) {
    throw new Error(`required must be an array at ${location}`)
  }
  if (fragment.required.some((name) => typeof name !== "string")) {
    throw new Error(`required entries must be strings at ${location}`)
  }
  if (new Set(fragment.required).size !== fragment.required.length) {
    throw new Error(`required entries must be unique at ${location}`)
  }
  return fragment.required
}

function missingRequiredPropertyExpression(fragment, location) {
  if (fragment.additionalProperties === false) {
    return `Schema.Unknown.pipe(Schema.filter(() => false, { message: () => ${json(
      `Required property ${location} is forbidden by additionalProperties: false`
    )} }))`
  }
  if (
    Object.prototype.hasOwnProperty.call(fragment, "additionalProperties")
    && fragment.additionalProperties !== true
  ) {
    return `required(${schemaExpression(fragment.additionalProperties, `${location}.additionalProperties`)})`
  }
  return "required(Schema.Unknown)"
}

function applyBounds(base, fragment) {
  const bounds = Object.fromEntries(
    boundKeywords.filter((keyword) => fragment[keyword] !== undefined)
      .map((keyword) => [keyword, fragment[keyword]])
  )
  return Object.keys(bounds).length === 0
    ? base
    : `withEncodedBounds(${base}, ${json(bounds)})`
}

function hasByteTransform(fragment, visited = new Set()) {
  if (!fragment || typeof fragment !== "object") return false
  if (fragment.format === "byte") return true
  if (fragment.$ref) {
    const name = referenceName(fragment.$ref)
    if (visited.has(name)) return false
    visited.add(name)
    if (hasByteTransform(schemaDefinitions[name], visited)) return true
  }
  for (const value of Object.values(fragment.properties ?? {})) {
    if (hasByteTransform(value, new Set(visited))) return true
  }
  if (fragment.items && hasByteTransform(fragment.items, new Set(visited))) return true
  if (
    fragment.additionalProperties
    && typeof fragment.additionalProperties === "object"
    && hasByteTransform(fragment.additionalProperties, new Set(visited))
  ) return true
  for (const keyword of ["allOf", "anyOf", "oneOf"]) {
    for (const member of fragment[keyword] ?? []) {
      if (hasByteTransform(member, new Set(visited))) return true
    }
  }
  return false
}

function validateSchemaFragment(fragment, location) {
  if (!fragment || typeof fragment !== "object" || Array.isArray(fragment)) {
    throw new Error(`Unsupported schema construct at ${location}: ${json(fragment)}`)
  }
  const unknownKeywords = Object.keys(fragment).filter((key) => !supportedSchemaKeywords.has(key))
  if (unknownKeywords.length > 0) {
    throw new Error(`Unsupported schema construct at ${location}: ${unknownKeywords.join(", ")}`)
  }
  validateBoundKeywords(fragment, location)
  requiredPropertyNames(fragment, location)
  for (const keyword of ["allOf", "anyOf", "oneOf"]) {
    const members = fragment[keyword]
    if (members === undefined) continue
    if (!Array.isArray(members)) {
      throw new Error(`Unsupported schema construct at ${location}.${keyword}: expected an array`)
    }
    members.forEach((member, index) => validateSchemaFragment(member, `${location}.${keyword}[${index}]`))
  }
  for (const [propertyName, property] of Object.entries(fragment.properties ?? {})) {
    validateSchemaFragment(property, `${location}.properties.${propertyName}`)
  }
  if (fragment.items) validateSchemaFragment(fragment.items, `${location}.items`)
  if (fragment.additionalProperties && typeof fragment.additionalProperties === "object") {
    validateSchemaFragment(fragment.additionalProperties, `${location}.additionalProperties`)
  }
}

function validateBoundKeywords(fragment, location) {
  for (const keyword of ["minimum", "maximum"]) {
    if (!Object.prototype.hasOwnProperty.call(fragment, keyword)) continue
    const value = fragment[keyword]
    if (typeof value !== "number" || !Number.isFinite(value)) {
      const received = typeof value === "number" && !Number.isFinite(value)
        ? String(value)
        : json(value)
      throw new Error(
        `Invalid ${keyword} at ${location}.${keyword}: expected a finite number, received ${received}`
      )
    }
  }
  for (const keyword of ["minLength", "maxLength", "minItems", "maxItems"]) {
    if (!Object.prototype.hasOwnProperty.call(fragment, keyword)) continue
    const value = fragment[keyword]
    if (!Number.isInteger(value) || value < 0) {
      throw new Error(
        `Invalid ${keyword} at ${location}.${keyword}: expected a non-negative integer, received ${json(value)}`
      )
    }
  }
}

function referenceName(reference) {
  const match = reference.match(/^#\/\$defs\/([A-Za-z0-9_]+)$/)
  if (!match || !schemaDefinitions[match[1]]) {
    throw new Error(`Unsupported schema reference ${reference}`)
  }
  return match[1]
}

function generateSchemaRegistry() {
  const names = Object.keys(schemaDefinitions)
  return `// MCP draft $defs codec registry generated from schema.json. Do not edit.
export const MCP_SCHEMA_VERSION = ${json(protocolVersion)} as const

export const MCP_SCHEMA_DEFINITION_NAMES = ${constArray(names)}
export type McpSchemaDefinitionName = typeof MCP_SCHEMA_DEFINITION_NAMES[number]

export const MCP_SCHEMA_NAMED_ALIAS_MEMBERS = ${constObject(
    Object.fromEntries(namedDefinitionAliases)
  )}

export const MCP_SCHEMA_CODECS = {
${names.map((name) => `  ${json(name)}: ${name}`).join(",\n")}
} as const satisfies { readonly [Name in McpSchemaDefinitionName]: Schema.Schema.All }`
}

function generatedBanner(sourceName) {
  return `/**
 * Generated from ${sourceName} for MCP draft ${protocolVersion}.
 * Do not edit manually.
 */`
}

function constArray(values) {
  return `${json(values)} as const`
}

function constObject(value) {
  return `${json(value)} as const`
}

function json(value) {
  return JSON.stringify(value, null, 2)
}

function relative(filePath) {
  return path.relative(root, filePath).replaceAll(path.sep, "/")
}
