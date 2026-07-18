import assert from "node:assert/strict"
import { createHash } from "node:crypto"
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { spawnSync } from "node:child_process"
import os from "node:os"
import path from "node:path"
import test from "node:test"
import { fileURLToPath, pathToFileURL } from "node:url"
import * as Schema from "effect/Schema"
import tsImport from "typescript"

const ts = tsImport.default ?? tsImport
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..")
const sourceTsPath = path.join(root, "sources/vendor/mcp-core/schema.ts")
const sourceJsonPath = path.join(root, "sources/vendor/mcp-core/schema.json")
const revisionedProtocolSourcePath = path.join(
  root,
  "src/generated/mcp/2026-07-28/McpProtocol.generated.ts"
)
const obsoleteProtocolSourcePath = path.join(root, "src/generated/mcp/McpProtocol.generated.ts")
const revisionedProtocolDistPath = path.join(
  root,
  "dist/generated/mcp/2026-07-28/McpProtocol.generated.js"
)
const obsoleteProtocolDistPath = path.join(root, "dist/generated/mcp/McpProtocol.generated.js")
const schemaDistPath = path.join(root, "dist/generated/mcp/2026-07-28/McpSchema.generated.js")

const sourceTs = readFileSync(sourceTsPath, "utf8")
const sourceJson = JSON.parse(readFileSync(sourceJsonPath, "utf8"))
const authoritative = readAuthoritativeProtocol(sourceTs, sourceJson)

const protocolModule = async () =>
  importFresh(existsSync(revisionedProtocolDistPath) ? revisionedProtocolDistPath : obsoleteProtocolDistPath)

test("protocol artifact is physically revisioned and obsolete references are absent", () => {
  assert.equal(existsSync(revisionedProtocolSourcePath), true)
  assert.equal(existsSync(obsoleteProtocolSourcePath), false)

  const files = [
    "src/McpClient.ts",
    "src/McpClientProtocol.ts",
    "src/McpNotifications.ts",
    "src/McpSchema.ts",
    "src/McpSerialization.ts",
    "src/McpServer.ts",
    "src/examples/core-protocol-catalog.ts",
    "src/examples/everything-server.ts",
    "scripts/check-extension-boundary.mjs",
    "scripts/check-generated-protocol-surfaces.mjs",
    "scripts/check-invariants.mjs",
    "scripts/check-sdk-readiness-requirements.mjs",
    "scripts/check-sdk-workflow.mjs",
    "scripts/check-tier-protocol-features.mjs",
    "scripts/check-ts-sdk-parity.mjs",
    "scripts/generate-mcp.mjs",
    "sources/manifest.json",
    "test/generation/wp3-schema-codecs.test.mjs",
    "README.md",
    "ROADMAP.md",
    "docs/acceptance-gates/sdk-generator.md",
    "docs/draft-2026-07-28-migration.md",
    "docs/phase-6-conformance-evidence.md"
  ]
  const obsoleteReference = /generated\/mcp\/McpProtocol\.generated/
  const offenders = files.filter((relativePath) => {
    const absolutePath = path.join(root, relativePath)
    return existsSync(absolutePath) && obsoleteReference.test(readFileSync(absolutePath, "utf8"))
  })
  assert.deepEqual(offenders, [])
})

test("generated descriptors structurally match both pinned authorities", async () => {
  const protocol = await protocolModule()
  assert.deepEqual(protocol.CLIENT_REQUEST_DESCRIPTORS, authoritative.clientRequests)
  assert.deepEqual(protocol.CLIENT_NOTIFICATION_DESCRIPTORS, authoritative.clientNotifications)
  assert.deepEqual(protocol.SERVER_REQUEST_DESCRIPTORS, authoritative.serverRequests)
  assert.deepEqual(protocol.SERVER_NOTIFICATION_DESCRIPTORS, authoritative.serverNotifications)
})

test("descriptor and codec registries contain the exact revisioned schema codecs", async () => {
  const [protocol, generated] = await Promise.all([
    protocolModule(),
    importFresh(schemaDistPath)
  ])

  for (const [prefix, descriptors, request] of [
    ["CLIENT_REQUEST", authoritative.clientRequests, true],
    ["CLIENT_NOTIFICATION", authoritative.clientNotifications, false],
    ["SERVER_REQUEST", authoritative.serverRequests, true],
    ["SERVER_NOTIFICATION", authoritative.serverNotifications, false]
  ]) {
    for (const descriptor of descriptors) {
      assert.strictEqual(protocol[`${prefix}_DESCRIPTOR_BY_TYPE`][descriptor.type], descriptorFrom(protocol, prefix, descriptor.type))
      assert.strictEqual(protocol[`${prefix}_DESCRIPTOR_BY_METHOD`][descriptor.method], descriptorFrom(protocol, prefix, descriptor.type))
      assert.strictEqual(protocol[`${prefix}_CODEC_BY_TYPE`][descriptor.type], generated[descriptor.type])
      assert.strictEqual(protocol[`${prefix}_CODEC_BY_METHOD`][descriptor.method], generated[descriptor.type])
      assert.strictEqual(protocol[`${prefix}_PARAMS_CODEC_BY_TYPE`][descriptor.type], generated[descriptor.paramsType])
      assert.strictEqual(protocol[`${prefix}_PARAMS_CODEC_BY_METHOD`][descriptor.method], generated[descriptor.paramsType])
      if (request) {
        assert.strictEqual(protocol[`${prefix}_RESULT_CODEC_BY_TYPE`][descriptor.type], generated[descriptor.resultType])
        assert.strictEqual(protocol[`${prefix}_RESULT_CODEC_BY_METHOD`][descriptor.method], generated[descriptor.resultType])
      }
    }
  }

  for (const [exportName, schemaName] of [
    ["CLIENT_REQUEST_CODEC", "ClientRequest"],
    ["CLIENT_NOTIFICATION_CODEC", "ClientNotification"],
    ["SERVER_NOTIFICATION_CODEC", "ServerNotification"],
    ["JSONRPC_REQUEST_CODEC", "JSONRPCRequest"],
    ["JSONRPC_NOTIFICATION_CODEC", "JSONRPCNotification"],
    ["JSONRPC_RESULT_RESPONSE_CODEC", "JSONRPCResultResponse"],
    ["JSONRPC_ERROR_RESPONSE_CODEC", "JSONRPCErrorResponse"],
    ["JSONRPC_RESPONSE_CODEC", "JSONRPCResponse"],
    ["JSONRPC_MESSAGE_CODEC", "JSONRPCMessage"]
  ]) {
    assert.strictEqual(protocol[exportName], generated[schemaName])
  }
  assert.equal("SERVER_REQUEST_CODEC" in protocol, false)
})

test("active envelope, params, result, and JSON-RPC union codecs enforce wire shapes", async () => {
  const protocol = await protocolModule()
  const decode = (codec, value) => Schema.decodeUnknownSync(codec)(value)
  const encode = (codec, value) => Schema.encodeSync(codec)(value)

  const callTool = {
    jsonrpc: "2.0",
    id: 1,
    method: "tools/call",
    params: { _meta: {}, name: "fixture" }
  }
  assert.deepEqual(encode(protocol.CLIENT_REQUEST_CODEC, decode(protocol.CLIENT_REQUEST_CODEC, callTool)), callTool)

  const cancelled = {
    jsonrpc: "2.0",
    method: "notifications/cancelled",
    params: { requestId: 1 }
  }
  assert.deepEqual(encode(protocol.CLIENT_NOTIFICATION_CODEC, decode(protocol.CLIENT_NOTIFICATION_CODEC, cancelled)), cancelled)

  const listChanged = { jsonrpc: "2.0", method: "notifications/tools/list_changed" }
  assert.deepEqual(encode(protocol.SERVER_NOTIFICATION_CODEC, decode(protocol.SERVER_NOTIFICATION_CODEC, listChanged)), listChanged)
  assert.deepEqual(decode(protocol.JSONRPC_MESSAGE_CODEC, callTool), callTool)

  assert.throws(() => decode(protocol.CLIENT_REQUEST_RESULT_CODEC_BY_METHOD["tools/list"], { tools: [] }))
  assert.throws(() => decode(protocol.CLIENT_REQUEST_RESULT_CODEC_BY_METHOD["tools/list"], {
    resultType: "wrong",
    tools: []
  }))
  assert.doesNotThrow(() => decode(protocol.CLIENT_REQUEST_RESULT_CODEC_BY_METHOD["tools/list"], {
    resultType: "complete",
    tools: [],
    ttlMs: 0,
    cacheScope: "private"
  }))
  assert.doesNotThrow(() => decode(protocol.SERVER_NOTIFICATION_CODEC_BY_METHOD["notifications/tools/list_changed"], listChanged))
  assert.throws(() => decode(protocol.SERVER_NOTIFICATION_CODEC_BY_METHOD["notifications/progress"], {
    jsonrpc: "2.0",
    method: "notifications/progress"
  }))
})

test("HTTP metadata emits exact Mcp-Method and only the normative Mcp-Name sources", async () => {
  const protocol = await protocolModule()
  const expectedNameSources = new Map([
    ["tools/call", "params.name"],
    ["resources/read", "params.uri"],
    ["prompts/get", "params.name"]
  ])
  const descriptors = [
    ...protocol.CLIENT_REQUEST_DESCRIPTORS,
    ...protocol.CLIENT_NOTIFICATION_DESCRIPTORS,
    ...protocol.SERVER_REQUEST_DESCRIPTORS,
    ...protocol.SERVER_NOTIFICATION_DESCRIPTORS
  ]
  for (const descriptor of descriptors) {
    assert.equal(descriptor.http.methodHeader, descriptor.method)
    assert.equal(descriptor.http.nameSource, expectedNameSources.get(descriptor.method) ?? null)
  }
})

test("McpSchema active RPC groups are thin facades over generated registries", async () => {
  const [protocol, facade] = await Promise.all([
    protocolModule(),
    importFresh(path.join(root, "dist/McpSchema.js"))
  ])
  for (const descriptor of authoritative.clientRequests) {
    const rpc = facade.ClientRequestRpcs.requests.get(descriptor.method)
    assert.ok(rpc)
    assert.equal(rpc.tag, descriptor.method)
    assert.strictEqual(rpc.payloadSchema, protocol.CLIENT_REQUEST_PARAMS_CODEC_BY_METHOD[descriptor.method])
    assert.strictEqual(rpc.successSchema, protocol.CLIENT_REQUEST_RESULT_CODEC_BY_METHOD[descriptor.method])
  }
  for (const [groupName, descriptors, prefix] of [
    ["ClientNotificationRpcs", authoritative.clientNotifications, "CLIENT_NOTIFICATION"],
    ["ServerNotificationRpcs", authoritative.serverNotifications, "SERVER_NOTIFICATION"]
  ]) {
    for (const descriptor of descriptors) {
      const rpc = facade[groupName].requests.get(descriptor.method)
      assert.ok(rpc)
      assert.strictEqual(rpc.payloadSchema, protocol[`${prefix}_PAYLOAD_CODEC_BY_METHOD`][descriptor.method])
    }
  }
  assert.equal(facade.ServerRequestRpcs, undefined)
})

test("protocol generation fails closed on representative repinned disagreements", () => {
  const mutations = [
    {
      name: "membership disagreement",
      file: "schema.json",
      mutate(value) {
        value.$defs.ClientRequest.anyOf.pop()
        return JSON.stringify(value, null, 4) + "\n"
      },
      error: /ClientRequest.*(membership|disagree)/i
    },
    {
      name: "method disagreement",
      file: "schema.json",
      mutate(value) {
        value.$defs.ListToolsRequest.properties.method.const = "tools/list-mutated"
        return JSON.stringify(value, null, 4) + "\n"
      },
      error: /ListToolsRequest.*method.*disagree/i
    },
    {
      name: "params disagreement",
      file: "schema.ts",
      mutate(value) {
        return value.replace(
          /(export interface CallToolRequest extends JSONRPCRequest \{\s*method: "tools\/call";\s*params: )CallToolRequestParams/,
          "$1CompleteRequestParams"
        )
      },
      error: /CallToolRequest.*params.*disagree/i
    },
    {
      name: "result disagreement",
      file: "schema.json",
      mutate(value) {
        value.$defs.ListToolsResultResponse.properties.result.$ref = "#/$defs/CallToolResult"
        return JSON.stringify(value, null, 4) + "\n"
      },
      error: /ListToolsRequest.*result.*disagree/i
    },
    {
      name: "duplicate union member",
      file: "schema.ts",
      mutate(value) {
        return value.replace(
          "  | ListToolsRequest;\n\n/** @internal */\nexport type ClientNotification",
          "  | ListToolsRequest\n  | ListToolsRequest;\n\n/** @internal */\nexport type ClientNotification"
        )
      },
      error: /ClientRequest.*duplicate.*ListToolsRequest/i
    },
    {
      name: "invalid HTTP name source",
      file: "schema.json",
      mutate(value) {
        value.$defs.CallToolRequestParams.properties.name.type = "integer"
        return JSON.stringify(value, null, 4) + "\n"
      },
      error: /tools\/call.*params\.name.*string/i
    }
  ]

  for (const mutation of mutations) {
    const result = runMutation(mutation)
    assert.notEqual(result.status, 0, `${mutation.name} unexpectedly generated successfully`)
    assert.match(`${result.stderr}\n${result.stdout}`, mutation.error, mutation.name)
  }
})

function descriptorFrom(protocol, prefix, type) {
  return protocol[`${prefix}_DESCRIPTORS`].find((descriptor) => descriptor.type === type)
}

function readAuthoritativeProtocol(tsText, json) {
  const file = ts.createSourceFile("schema.ts", tsText, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS)
  const aliases = new Map()
  const interfaces = new Map()
  const resultsByMethod = new Map()
  for (const statement of file.statements) {
    if (ts.isTypeAliasDeclaration(statement)) aliases.set(statement.name.text, statement)
    if (ts.isInterfaceDeclaration(statement)) {
      interfaces.set(statement.name.text, statement)
      if (statement.name.text.endsWith("Result")) {
        const method = categoryMethod(statement)
        if (method) resultsByMethod.set(method, statement.name.text)
      }
    }
  }

  const groups = [
    ["clientRequests", "ClientRequest", "client-to-server", true, false],
    ["clientNotifications", "ClientNotification", "client-to-server", false, false],
    ["serverRequests", "ServerRequest", "server-to-client", true, true],
    ["serverNotifications", "ServerNotification", "server-to-client", false, false]
  ]
  return Object.fromEntries(groups.map(([key, aliasName, direction, request, optional]) => {
    const alias = aliases.get(aliasName)
    if (!alias) {
      assert.equal(optional, true, `missing authoritative ${aliasName}`)
      return [key, []]
    }
    const members = typeReferenceMembers(alias.type, aliasName)
    assert.equal(new Set(members).size, members.length, `${aliasName} contains duplicate members`)
    const descriptors = members.map((type) => {
      const methodProperty = inheritedProperty(interfaces, type, "method")
      const paramsProperty = inheritedProperty(interfaces, type, "params")
      assert.ok(methodProperty && ts.isLiteralTypeNode(methodProperty.type) && ts.isStringLiteral(methodProperty.type.literal))
      assert.ok(paramsProperty && ts.isTypeReferenceNode(paramsProperty.type) && ts.isIdentifier(paramsProperty.type.typeName))
      const method = methodProperty.type.literal.text
      const paramsType = paramsProperty.type.typeName.text
      const jsonDefinition = json.$defs[type]
      assert.equal(jsonDefinition.properties.method.const, method, `${type} method disagreement`)
      assert.equal(refName(jsonDefinition.properties.params.$ref), paramsType, `${type} params disagreement`)
      assert.equal(jsonDefinition.required.includes("params"), !paramsProperty.questionToken, `${type} params optionality disagreement`)
      const descriptor = {
        type,
        method,
        paramsType,
        paramsOptional: Boolean(paramsProperty.questionToken),
        direction,
        http: {
          methodHeader: method,
          nameSource: httpNameSource(method)
        }
      }
      if (request) {
        const resultType = resultsByMethod.get(method)
        assert.ok(resultType, `${type} has no structurally mapped result`)
        assertResultResponse(json, type, resultType)
        return { ...descriptor, resultType }
      }
      return descriptor
    })
    assertJsonGroupMembership(json, aliasName, members)
    return [key, descriptors]
  }))
}

function typeReferenceMembers(node, aliasName) {
  const nodes = ts.isUnionTypeNode(node) ? node.types : [node]
  return nodes.map((member) => {
    assert.ok(ts.isTypeReferenceNode(member) && ts.isIdentifier(member.typeName), `${aliasName} uses unsupported syntax`)
    assert.equal(member.typeArguments?.length ?? 0, 0, `${aliasName} uses generic members`)
    return member.typeName.text
  })
}

function inheritedProperty(interfaces, name, propertyName, seen = new Set()) {
  assert.equal(seen.has(name), false, `interface inheritance cycle at ${name}`)
  seen.add(name)
  const declaration = interfaces.get(name)
  assert.ok(declaration, `missing interface ${name}`)
  const own = declaration.members.find(
    (member) => ts.isPropertySignature(member) && ts.isIdentifier(member.name) && member.name.text === propertyName
  )
  if (own) return own
  for (const heritage of declaration.heritageClauses ?? []) {
    for (const type of heritage.types) {
      assert.ok(ts.isIdentifier(type.expression), `${name} uses unsupported heritage syntax`)
      const inherited = inheritedProperty(interfaces, type.expression.text, propertyName, new Set(seen))
      if (inherited) return inherited
    }
  }
  return undefined
}

function categoryMethod(node) {
  for (const tag of ts.getJSDocTags(node)) {
    if (tag.tagName.text !== "category") continue
    const comment = typeof tag.comment === "string" ? tag.comment : ""
    const match = comment.match(/`([^`/]+\/[^`]+)`/)
    if (match) return match[1]
  }
  return undefined
}

function assertJsonGroupMembership(json, groupName, members) {
  const definition = json.$defs[groupName]
  assert.ok(definition, `JSON schema missing ${groupName}`)
  const jsonMembers = definition.anyOf
    ? definition.anyOf.map((member) => refName(member.$ref))
    : members.length === 1 && definition.properties?.method?.const
      ? [members[0]]
      : []
  assert.deepEqual(new Set(jsonMembers), new Set(members), `${groupName} membership disagreement`)
}

function assertResultResponse(json, requestType, resultType) {
  const response = json.$defs[`${resultType}Response`]
  if (!response) {
    assert.ok(json.$defs[resultType], `${requestType} result definition missing`)
    return
  }
  const result = response.properties?.result
  const refs = result?.$ref ? [refName(result.$ref)] : (result?.anyOf ?? []).map((member) => refName(member.$ref))
  assert.equal(refs.includes(resultType), true, `${requestType} result disagreement`)
  assert.equal(
    refs.filter((name) => name !== resultType).every((name) => name === "InputRequiredResult"),
    true,
    `${requestType} result response has unsupported alternatives`
  )
}

function refName(ref) {
  assert.match(ref ?? "", /^#\/\$defs\/[A-Za-z0-9_]+$/)
  return ref.slice("#/$defs/".length)
}

function httpNameSource(method) {
  if (method === "tools/call" || method === "prompts/get") return "params.name"
  if (method === "resources/read") return "params.uri"
  return null
}

async function importFresh(filePath) {
  return import(`${pathToFileURL(filePath).href}?wp3b=${Date.now()}-${Math.random()}`)
}

function runMutation(mutation) {
  const fixtureRoot = mkdtempSync(path.join(os.tmpdir(), "mcp-effect-sdk-wp3b-"))
  try {
    mkdirSync(path.join(fixtureRoot, "scripts"), { recursive: true })
    mkdirSync(path.join(fixtureRoot, "sources/vendor/mcp-core"), { recursive: true })
    cpSync(path.join(root, "scripts/generate-mcp.mjs"), path.join(fixtureRoot, "scripts/generate-mcp.mjs"))
    cpSync(sourceTsPath, path.join(fixtureRoot, "sources/vendor/mcp-core/schema.ts"))
    cpSync(sourceJsonPath, path.join(fixtureRoot, "sources/vendor/mcp-core/schema.json"))
    const target = path.join(fixtureRoot, "sources/vendor/mcp-core", mutation.file)
    const original = readFileSync(target, "utf8")
    const parsed = mutation.file.endsWith(".json") ? JSON.parse(original) : original
    const mutated = mutation.mutate(parsed)
    assert.notEqual(mutated, original, `${mutation.name} fixture did not mutate its source`)
    writeFileSync(target, mutated)

    const generatorPath = path.join(fixtureRoot, "scripts/generate-mcp.mjs")
    let generator = readFileSync(generatorPath, "utf8")
    for (const fileName of ["schema.ts", "schema.json"]) {
      const vendoredPath = path.join(fixtureRoot, "sources/vendor/mcp-core", fileName)
      const digest = createHash("sha256").update(readFileSync(vendoredPath)).digest("hex")
      const originalDigest = createHash("sha256").update(readFileSync(path.join(root, "sources/vendor/mcp-core", fileName))).digest("hex")
      generator = generator.replaceAll(originalDigest, digest)
    }
    writeFileSync(generatorPath, generator)
    return spawnSync(process.execPath, [generatorPath], { cwd: fixtureRoot, encoding: "utf8" })
  } finally {
    rmSync(fixtureRoot, { recursive: true, force: true })
  }
}
