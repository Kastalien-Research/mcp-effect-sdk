import { readFileSync, writeFileSync } from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const root = path.resolve(__dirname, "..")
const sourceDir = path.join(root, "src/generated/mcp/2025-11-25")
const protocolOutputPath = path.join(root, "src/generated/mcp/McpProtocol.generated.ts")
const schemaOutputPath = path.join(root, "src/generated/mcp/McpSchema.generated.ts")

const checkOnly = process.argv.includes("--check")

const schemaJsonPath = path.join(sourceDir, "schema.json")
const schemaTsPath = path.join(sourceDir, "schema.ts.txt")

const schemaJson = JSON.parse(readFileSync(schemaJsonPath, "utf8"))
const schemaTs = readFileSync(schemaTsPath, "utf8")
const schemaDefinitions = readSchemaDefinitions(schemaJson)
const emptyResultMethods = new Set([
  "ping",
  "logging/setLevel",
  "resources/subscribe",
  "resources/unsubscribe"
])

const protocolVersion = readProtocolVersion(schemaTs)
assertStableSchema(schemaJson, protocolVersion)

const interfaceMethods = readInterfaceMethods(schemaTs)
const clientRequests = readUnionMembers(schemaTs, "ClientRequest")
const clientNotifications = readUnionMembers(schemaTs, "ClientNotification")
const serverRequests = readUnionMembers(schemaTs, "ServerRequest")
const serverNotifications = readUnionMembers(schemaTs, "ServerNotification")
const clientRequestMethodMap = methodMapForTypes(clientRequests)
const clientNotificationMethodMap = methodMapForTypes(clientNotifications)
const serverRequestMethodMap = methodMapForTypes(serverRequests)
const serverNotificationMethodMap = methodMapForTypes(serverNotifications)
const resultTypesByMethod = readResultTypesByMethod(schemaTs)
const clientRequestResultTypeMap = resultTypeMapForRequests(clientRequestMethodMap)
const serverRequestResultTypeMap = resultTypeMapForRequests(serverRequestMethodMap)
const clientRequestDescriptors = requestDescriptorsFor(
  clientRequestMethodMap,
  clientRequestResultTypeMap
)
const serverRequestDescriptors = requestDescriptorsFor(
  serverRequestMethodMap,
  serverRequestResultTypeMap
)
const clientNotificationDescriptors = notificationDescriptorsFor(clientNotificationMethodMap)
const serverNotificationDescriptors = notificationDescriptorsFor(serverNotificationMethodMap)

assertCompleteRequestResultMetadata(clientRequestResultTypeMap, "ClientRequest")
assertCompleteRequestResultMetadata(serverRequestResultTypeMap, "ServerRequest")
assertKnownEmptyResultMethods()

const outputs = new Map([
  [protocolOutputPath, generateProtocolFile()],
  [schemaOutputPath, generateSchemaFile()]
])

let changed = false
for (const [filePath, content] of outputs) {
  const existing = readFileSync(filePath, "utf8")
  if (existing !== content) {
    changed = true
    if (checkOnly) {
      console.error(`Generated file is out of date: ${relative(filePath)}`)
      continue
    }
    writeFileSync(filePath, content)
  }
}

if (changed && checkOnly) {
  process.exit(1)
}

if (checkOnly) {
  console.log("Generated MCP outputs are up to date.")
} else {
  console.log("Generated MCP outputs updated.")
}

function readProtocolVersion(sourceText) {
  const match = sourceText.match(/export const LATEST_PROTOCOL_VERSION = "([^"]+)"/)
  if (!match) {
    throw new Error(`Could not find LATEST_PROTOCOL_VERSION in ${relative(schemaTsPath)}`)
  }
  return match[1]
}

function assertStableSchema(schema, expectedVersion) {
  const defs = schema.$defs && typeof schema.$defs === "object" ? schema.$defs : {}
  const requiredDefs = ["InitializeRequest", "InitializeResult", "JSONRPCRequest"]
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

function readUnionMembers(sourceText, typeName) {
  const pattern = new RegExp(`export type ${typeName} =\\n([\\s\\S]*?);`, "m")
  const match = sourceText.match(pattern)
  if (!match) {
    throw new Error(`Could not find ${typeName} union in ${relative(schemaTsPath)}`)
  }
  return [...match[1].matchAll(/\|\s+([A-Za-z0-9_]+)/g)].map((entry) => entry[1])
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
  const comment = sourceText.slice(commentStart, commentEnd + 2)
  return comment.match(/\* @category `([^`]+)`/)?.[1]
}

function methodsForTypes(typeNames) {
  return typeNames.map((typeName) => {
    const method = interfaceMethods.get(typeName)
    if (!method) {
      throw new Error(`${typeName} does not declare a literal method in ${relative(schemaTsPath)}`)
    }
    return method
  })
}

function methodMapForTypes(typeNames) {
  return Object.fromEntries(typeNames.map((typeName) => [typeName, interfaceMethods.get(typeName)]))
}

function resultTypeMapForRequests(requestMethodMap) {
  return Object.fromEntries(
    Object.entries(requestMethodMap).map(([requestType, method]) => [
      requestType,
      resultTypeForRequest(requestType, method)
    ])
  )
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

function requestDescriptorsFor(requestMethodMap, requestResultTypeMap) {
  return Object.entries(requestMethodMap).map(([requestType, method]) => ({
    type: requestType,
    method,
    resultType: requestResultTypeMap[requestType]
  }))
}

function notificationDescriptorsFor(notificationMethodMap) {
  return Object.entries(notificationMethodMap).map(([notificationType, method]) => ({
    type: notificationType,
    method
  }))
}

function assertCompleteRequestResultMetadata(requestResultTypeMap, unionName) {
  const missing = Object.entries(requestResultTypeMap)
    .filter(([, resultType]) => typeof resultType !== "string")
    .map(([requestType]) => requestType)
  if (missing.length > 0) {
    throw new Error(`${unionName} is missing request/result metadata: ${missing.join(", ")}`)
  }
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
  const clientRequestMethods = methodsForTypes(clientRequests)
  const clientNotificationMethods = methodsForTypes(clientNotifications)
  const serverRequestMethods = methodsForTypes(serverRequests)
  const serverNotificationMethods = methodsForTypes(serverNotifications)
  const taskRequestMethods = clientRequestMethods.filter((method) => method.startsWith("tasks/"))
  const taskNotificationMethods = serverNotificationMethods.filter((method) =>
    method.startsWith("notifications/tasks/")
  )
  const elicitationNotificationMethods = serverNotificationMethods.filter((method) =>
    method.startsWith("notifications/elicitation/")
  )

  return `${generatedBanner("vendored modelcontextprotocol schema.ts")}

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

function generateSchemaFile() {
  const existing = readFileSync(schemaOutputPath, "utf8")
  const block = generateSchemaDefinitionBlock()
  const start = "// <generated-schema-definitions>"
  const end = "// </generated-schema-definitions>"
  const startIndex = existing.indexOf(start)
  const endIndex = existing.indexOf(end)
  if (startIndex === -1 || endIndex === -1 || endIndex < startIndex) {
    throw new Error(`${relative(schemaOutputPath)} is missing generated schema definition markers`)
  }
  return `${existing.slice(0, startIndex)}${block}${existing.slice(endIndex + end.length)}`
}

function generateSchemaDefinitionBlock() {
  const names = Object.keys(schemaDefinitions)
  return `// <generated-schema-definitions>
// Stable MCP $defs registry generated from schema.json. Do not edit this block.
export const MCP_SCHEMA_VERSION = ${json(protocolVersion)} as const

export const MCP_SCHEMA_DEFINITION_NAMES = ${constArray(names)}
export type McpSchemaDefinitionName = typeof MCP_SCHEMA_DEFINITION_NAMES[number]

/**
 * Raw JSON Schema from the stable MCP schema artifact.
 *
 * This is intentionally runtime-neutral: Effect codecs below expose selected
 * ergonomic schemas, while this registry preserves every stable $defs entry for
 * generator parity checks and later generated client/server work.
 */
export type McpRawJsonSchema = unknown

export const MCP_SCHEMA_DEFINITIONS = ${json(schemaDefinitions)} as const satisfies {
  readonly [Name in McpSchemaDefinitionName]: McpRawJsonSchema
}
// </generated-schema-definitions>`
}

function generatedBanner(sourceName) {
  return `/**
 * Generated from ${sourceName} for stable ${protocolVersion}.
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
