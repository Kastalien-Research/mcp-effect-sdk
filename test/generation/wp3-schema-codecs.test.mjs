import assert from "node:assert/strict"
import { createHash } from "node:crypto"
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { spawnSync } from "node:child_process"
import { fileURLToPath, pathToFileURL } from "node:url"
import test from "node:test"
import * as Schema from "effect/Schema"

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..")
const sourceSchemaPath = path.join(root, "sources/vendor/mcp-core/schema.json")
const sourceSchemaTsPath = path.join(root, "sources/vendor/mcp-core/schema.ts")
const sourceSchema = JSON.parse(readFileSync(sourceSchemaPath, "utf8"))
const sourceSchemaTs = readFileSync(sourceSchemaTsPath, "utf8")
const revisionedSchemaOutput = path.join(root, "src/generated/mcp/2026-07-28/McpSchema.generated.ts")
const unrevisionedSchemaOutput = path.join(root, "src/generated/mcp/McpSchema.generated.ts")
const definitionNames = Object.keys(sourceSchema.$defs).sort((left, right) =>
  left.localeCompare(right)
)

const decodeFails = (schema, value) => {
  try {
    Schema.decodeUnknownSync(schema)(value)
    return false
  } catch {
    return true
  }
}

test("the pinned vendor schema is the only generation authority", () => {
  const generator = readFileSync(path.join(root, "scripts/generate-mcp.mjs"), "utf8")

  assert.match(generator, /sources["']?,\s*["']vendor["']?,\s*["']mcp-core/)
  assert.doesNotMatch(generator, /sourceDir\s*=\s*path\.join\(root,\s*["']src["']?,\s*["']generated["']?/)
  assert.equal(existsSync(path.join(root, "src/generated/mcp/2026-07-28/schema.json")), false)
  assert.equal(existsSync(path.join(root, "src/generated/mcp/2026-07-28/schema.ts.txt")), false)
  assert.equal(existsSync(revisionedSchemaOutput), true)
  assert.equal(existsSync(unrevisionedSchemaOutput), false)
})

test("the generated codec registry exactly covers sorted pinned definitions", async () => {
  const Generated = await import("../../dist/generated/mcp/2026-07-28/McpSchema.generated.js")

  assert.deepEqual(Generated.MCP_SCHEMA_DEFINITION_NAMES, definitionNames)
  assert.deepEqual(Object.keys(Generated.MCP_SCHEMA_CODECS), definitionNames)
  for (const name of definitionNames) {
    assert.equal(Generated.MCP_SCHEMA_CODECS[name], Generated[name], `${name} registry entry`)
    assert.equal(typeof Generated[name]?.ast, "object", `${name} must be an Effect Schema codec`)
  }
})

test("generated named alias members match the pinned TypeScript source", async () => {
  const Generated = await import("../../dist/generated/mcp/2026-07-28/McpSchema.generated.js")
  assert.deepEqual(
    Generated.MCP_SCHEMA_NAMED_ALIAS_MEMBERS,
    namedDefinitionAliases(sourceSchemaTs, new Set(definitionNames))
  )
})

test("ClientResult and ServerResult enforce their pinned aggregate aliases", async () => {
  const Generated = await import("../../dist/generated/mcp/2026-07-28/McpSchema.generated.js")
  const complete = { resultType: "complete", extension: "retained" }
  assert.deepEqual(
    Schema.encodeSync(Generated.ClientResult)(Schema.decodeUnknownSync(Generated.ClientResult)(complete)),
    complete
  )
  assert.equal(decodeFails(Generated.ClientResult, {
    resultType: "input_required",
    requestState: "opaque"
  }), true)
  assert.equal(decodeFails(Generated.ClientResult, { resultType: "vendor_extension" }), true)

  const inputRequired = {
    resultType: "input_required",
    requestState: "opaque",
    extension: "retained"
  }
  assert.deepEqual(
    Schema.encodeSync(Generated.ServerResult)(
      Schema.decodeUnknownSync(Generated.ServerResult)(inputRequired)
    ),
    inputRequired
  )
  const callTool = { resultType: "complete", content: [], extension: "retained" }
  assert.deepEqual(
    Schema.encodeSync(Generated.ServerResult)(Schema.decodeUnknownSync(Generated.ServerResult)(callTool)),
    callTool
  )
  assert.equal(decodeFails(Generated.ServerResult, { resultType: "input_required" }), true)
  assert.equal(decodeFails(Generated.ServerResult, { resultType: "vendor_extension" }), true)
})

test("recursive JSON and base64 byte codecs round-trip encoded wire values", async () => {
  const Generated = await import("../../dist/generated/mcp/2026-07-28/McpSchema.generated.js")
  const json = {
    nested: ["value", 1, true, null, { deeper: [false] }]
  }
  assert.deepEqual(Schema.encodeSync(Generated.JSONValue)(Schema.decodeUnknownSync(Generated.JSONValue)(json)), json)

  const wire = {
    type: "image",
    data: "AQIDBA==",
    mimeType: "image/png"
  }
  const decoded = Schema.decodeUnknownSync(Generated.ImageContent)(wire)
  assert.deepEqual([...decoded.data], [1, 2, 3, 4])
  assert.deepEqual(Schema.encodeSync(Generated.ImageContent)(decoded), wire)
  assert.equal(decodeFails(Generated.ImageContent, { ...wire, data: "%%%" }), true)
})

test("default-open named and inline objects preserve extension fields", async (t) => {
  const Generated = await import("../../dist/generated/mcp/2026-07-28/McpSchema.generated.js")
  const text = {
    type: "text",
    text: "hello",
    vendorExtension: { retained: true }
  }
  const decodedText = Schema.decodeUnknownSync(Generated.TextContent)(text)
  assert.deepEqual(decodedText.vendorExtension, { retained: true })
  assert.deepEqual(Schema.encodeSync(Generated.TextContent)(decodedText), text)
  assert.deepEqual(Schema.encodeSync(Generated.TextContent)(new Generated.TextContent(text)), text)
  assert.deepEqual(Schema.encodeSync(Generated.TextContent)(Generated.TextContent.make(text)), text)

  const fixtureRoot = makeGeneratorFixture()
  t.after(() => rmSync(fixtureRoot, { force: true, recursive: true }))
  mutateAndRepinSchema(fixtureRoot, (schemaJson) => {
    schemaJson.$defs.NestedOpenProbe = {
      properties: {
        nested: {
          properties: { known: { type: "string" } },
          required: ["known"],
          type: "object"
        }
      },
      required: ["nested"],
      type: "object"
    }
  })
  const FixtureGenerated = await generateFixtureAndImport(fixtureRoot)
  const nested = {
    nested: { known: "value", nestedExtension: 1 },
    rootExtension: true
  }
  const decodedNested = Schema.decodeUnknownSync(FixtureGenerated.NestedOpenProbe)(nested)
  assert.equal(decodedNested.rootExtension, true)
  assert.equal(decodedNested.nested.nestedExtension, 1)
  assert.deepEqual(Schema.encodeSync(FixtureGenerated.NestedOpenProbe)(decodedNested), nested)
  assert.deepEqual(
    Schema.encodeSync(FixtureGenerated.NestedOpenProbe)(new FixtureGenerated.NestedOpenProbe(nested)),
    nested
  )
  assert.deepEqual(
    Schema.encodeSync(FixtureGenerated.NestedOpenProbe)(FixtureGenerated.NestedOpenProbe.make(nested)),
    nested
  )
})

test("required keys absent from properties remain required unconstrained fields", async (t) => {
  const fixtureRoot = makeGeneratorFixture()
  t.after(() => rmSync(fixtureRoot, { force: true, recursive: true }))
  mutateAndRepinSchema(fixtureRoot, (schemaJson) => {
    schemaJson.$defs.RequiredGhostNamed = {
      required: ["ghost"],
      type: "object"
    }
    schemaJson.$defs.RequiredGhostContainer = {
      properties: {
        nested: {
          required: ["ghost"],
          type: "object"
        }
      },
      required: ["nested"],
      type: "object"
    }
  })
  const Generated = await generateFixtureAndImport(fixtureRoot)

  assert.throws(() => Schema.encodeSync(Generated.RequiredGhostNamed)({}))
  assert.equal(decodeFails(Generated.RequiredGhostNamed, {}), true)
  const value = { ghost: { any: ["json", 1, true, null] } }
  const decoded = Schema.decodeUnknownSync(Generated.RequiredGhostNamed)(value)
  assert.deepEqual(Schema.encodeSync(Generated.RequiredGhostNamed)(decoded), value)
  assert.deepEqual(
    Schema.encodeSync(Generated.RequiredGhostNamed)(new Generated.RequiredGhostNamed(value)),
    value
  )
  assert.deepEqual(
    Schema.encodeSync(Generated.RequiredGhostNamed)(Generated.RequiredGhostNamed.make(value)),
    value
  )

  const nested = { nested: { ghost: "present" } }
  assert.equal(decodeFails(Generated.RequiredGhostContainer, { nested: {} }), true)
  assert.deepEqual(
    Schema.encodeSync(Generated.RequiredGhostContainer)(
      Schema.decodeUnknownSync(Generated.RequiredGhostContainer)(nested)
    ),
    nested
  )

  assertFixtureTypes(fixtureRoot, `
import * as Generated from "./src/generated/mcp/2026-07-28/McpSchema.generated.js"

const made = Generated.RequiredGhostNamed.make({ ghost: { any: true } })
const constructed = new Generated.RequiredGhostNamed({ ghost: "value" })
const madeGhost: unknown = made.ghost
const constructedGhost: unknown = constructed.ghost
// @ts-expect-error ghost is required
Generated.RequiredGhostNamed.make({})
// @ts-expect-error ghost is required
new Generated.RequiredGhostNamed({})
void madeGhost
void constructedGhost
`)
})

test("required arrays reject non-string and duplicate entries", (t) => {
  for (const [name, required, expected] of [
    ["non-string", [1], /required entries must be strings at InvalidRequired/],
    ["duplicate", ["ghost", "ghost"], /required entries must be unique at InvalidRequired/]
  ]) {
    const fixtureRoot = makeGeneratorFixture()
    t.after(() => rmSync(fixtureRoot, { force: true, recursive: true }))
    mutateAndRepinSchema(fixtureRoot, (schemaJson) => {
      schemaJson.$defs.InvalidRequired = { required, type: "object" }
    })
    const result = spawnSync(process.execPath, ["scripts/generate-mcp.mjs"], {
      cwd: fixtureRoot,
      encoding: "utf8"
    })
    assert.notEqual(result.status, 0, name)
    assert.match(`${result.stdout}\n${result.stderr}`, expected, name)
  }
})

test("typed additional properties exclude declared fields and preserve public known types", async (t) => {
  const fixtureRoot = makeGeneratorFixture()
  t.after(() => rmSync(fixtureRoot, { force: true, recursive: true }))
  mutateAndRepinSchema(fixtureRoot, (schemaJson) => {
    const typed = {
      additionalProperties: { type: "integer" },
      properties: { known: { type: "string" } },
      required: ["known"],
      type: "object"
    }
    schemaJson.$defs.TypedExtrasNamed = typed
    schemaJson.$defs.TypedExtrasContainer = {
      properties: { nested: typed },
      required: ["nested"],
      type: "object"
    }
  })
  const Generated = await generateFixtureAndImport(fixtureRoot)
  const value = { known: "value", extra: 1 }
  const decoded = Schema.decodeUnknownSync(Generated.TypedExtrasNamed)(value)
  assert.deepEqual(Schema.encodeSync(Generated.TypedExtrasNamed)(decoded), value)
  assert.deepEqual(Schema.encodeSync(Generated.TypedExtrasNamed)(Generated.TypedExtrasNamed.make(value)), value)
  assert.equal(decodeFails(Generated.TypedExtrasNamed, { known: "value", extra: "wrong" }), true)
  assert.throws(() => Schema.encodeSync(Generated.TypedExtrasNamed)({
    known: "value",
    extra: "wrong"
  }))

  const nested = { nested: value }
  assert.deepEqual(
    Schema.encodeSync(Generated.TypedExtrasContainer)(
      Schema.decodeUnknownSync(Generated.TypedExtrasContainer)(nested)
    ),
    nested
  )
  assert.equal(decodeFails(Generated.TypedExtrasContainer, {
    nested: { known: "value", extra: "wrong" }
  }), true)

  assertFixtureTypes(fixtureRoot, `
import * as Generated from "./src/generated/mcp/2026-07-28/McpSchema.generated.js"

const value = Generated.TypedExtrasNamed.make({ known: "value", extra: 1 })
const known: string = value.known
const extra: unknown = value.extra
// @ts-expect-error known retains its declared string type
Generated.TypedExtrasNamed.make({ known: 1, extra: 1 })
void known
void extra
`)
})

test("result discriminators, enums, bounds, and unions fail closed", async () => {
  const Generated = await import("../../dist/generated/mcp/2026-07-28/McpSchema.generated.js")

  assert.equal(decodeFails(Generated.ListToolsResult, { tools: [], ttlMs: 0, cacheScope: "public" }), true)
  assert.equal(decodeFails(Generated.ListToolsResult, {
    resultType: "input_required",
    tools: [],
    ttlMs: 0,
    cacheScope: "public"
  }), true)
  assert.equal(decodeFails(Generated.InputRequiredResult, { resultType: "complete" }), true)
  assert.equal(decodeFails(Generated.InputRequiredResult, { resultType: "input_required" }), true)
  assert.equal(decodeFails(Generated.InputRequiredResult, {
    resultType: "input_required",
    requestState: "opaque"
  }), false)
  const inputRequired = new Generated.InputRequiredResult({
    resultType: "input_required",
    requestState: "opaque"
  })
  assert.equal(inputRequired instanceof Generated.InputRequiredResult, true)
  assert.equal(decodeFails(Generated.Annotations, { priority: 1.01 }), true)
  assert.equal(decodeFails(Generated.CompleteResult, {
    resultType: "complete",
    completion: { values: Array.from({ length: 101 }, (_, index) => String(index)) }
  }), true)
  assert.equal(decodeFails(Generated.Role, "system"), true)
  assert.equal(decodeFails(Generated.ContentBlock, { type: "text", mimeType: "text/plain" }), true)

  assert.equal(decodeFails(Generated.ResultType, "vendor_extension"), false)
})

test("general JSON and number codecs reject non-finite values", async () => {
  const Generated = await import("../../dist/generated/mcp/2026-07-28/McpSchema.generated.js")

  for (const value of [Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY]) {
    assert.equal(decodeFails(Generated.JSONValue, value), true)
    assert.equal(decodeFails(Generated.Error, { code: value, message: "non-finite" }), true)
  }
})

test("EmptyResult preserves Result extensions and annotations", async () => {
  const Generated = await import("../../dist/generated/mcp/2026-07-28/McpSchema.generated.js")
  const value = {
    resultType: "complete",
    extension: { nested: [1, true, null] }
  }
  const decoded = Schema.decodeUnknownSync(Generated.EmptyResult)(value)
  assert.deepEqual(Schema.encodeSync(Generated.EmptyResult)(decoded), value)
  const annotations = Reflect.ownKeys(Generated.EmptyResult.ast.annotations).map(
    (key) => Generated.EmptyResult.ast.annotations[key]
  )
  assert.equal(annotations.includes("Common result fields."), true)
})

test("stable base result codecs round-trip", async () => {
  const Generated = await import("../../dist/generated/mcp/2026-07-28/McpSchema.generated.js")
  const fixtures = [
    [Generated.EmptyResult, { resultType: "complete", extension: "retained" }],
    [Generated.CacheableResult, { resultType: "complete", ttlMs: 0, cacheScope: "private" }],
    [Generated.PaginatedResult, { resultType: "complete", nextCursor: "next" }]
  ]

  for (const [schema, value] of fixtures) {
    assert.deepEqual(Schema.encodeSync(schema)(Schema.decodeUnknownSync(schema)(value)), value)
  }
})

test("every transitive Result interface descendant preserves extension fields", async () => {
  const Generated = await import("../../dist/generated/mcp/2026-07-28/McpSchema.generated.js")
  const descendants = resultInterfaceDescendants(sourceSchemaTs)
  const values = {
    CacheableResult: { resultType: "complete", ttlMs: 0, cacheScope: "private" },
    CallToolResult: { resultType: "complete", content: [] },
    CompleteResult: { resultType: "complete", completion: { values: [] } },
    DiscoverResult: {
      resultType: "complete",
      supportedVersions: ["2026-07-28"],
      capabilities: {},
      ttlMs: 0,
      cacheScope: "private"
    },
    GetPromptResult: { resultType: "complete", messages: [] },
    InputRequiredResult: { resultType: "input_required", requestState: "opaque" },
    ListPromptsResult: {
      resultType: "complete",
      prompts: [],
      ttlMs: 0,
      cacheScope: "private"
    },
    ListResourceTemplatesResult: {
      resultType: "complete",
      resourceTemplates: [],
      ttlMs: 0,
      cacheScope: "private"
    },
    ListResourcesResult: {
      resultType: "complete",
      resources: [],
      ttlMs: 0,
      cacheScope: "private"
    },
    ListToolsResult: {
      resultType: "complete",
      tools: [],
      ttlMs: 0,
      cacheScope: "private"
    },
    PaginatedResult: { resultType: "complete" },
    ReadResourceResult: {
      resultType: "complete",
      contents: [],
      ttlMs: 0,
      cacheScope: "private"
    },
    SubscriptionsListenResult: {
      resultType: "complete",
      _meta: { "io.modelcontextprotocol/subscriptionId": 7 }
    }
  }

  assert.deepEqual(descendants, Object.keys(values).sort())
  for (const name of descendants) {
    const value = { ...values[name], extension: { codec: name } }
    const decoded = Schema.decodeUnknownSync(Generated[name])(value)
    assert.deepEqual(Schema.encodeSync(Generated[name])(decoded), value, name)
    assert.deepEqual(Schema.encodeSync(Generated[name])(new Generated[name](decoded)), value, `${name} new`)
    assert.deepEqual(Schema.encodeSync(Generated[name])(Generated[name].make(decoded)), value, `${name}.make`)
  }
})

test("roots/list uses the generated optional params codec", async () => {
  const McpSchema = await import("../../dist/McpSchema.js")

  assert.equal(decodeFails(McpSchema.ListRoots.payloadSchema, undefined), false)
  assert.equal(decodeFails(McpSchema.ListRoots.payloadSchema, { _meta: { fixture: true } }), false)
  assert.equal(decodeFails(McpSchema.ListRoots.payloadSchema, "invalid"), true)
  assert.equal(decodeFails(McpSchema.ListRoots.payloadSchema, { _meta: "invalid" }), true)
})

test("retained public object codecs remain constructible", async () => {
  const Generated = await import("../../dist/generated/mcp/2026-07-28/McpSchema.generated.js")
  const constructibleNames = [
    "Annotations",
    "Implementation",
    "Resource",
    "ResourceTemplate",
    "TextResourceContents",
    "BlobResourceContents",
    "PromptArgument",
    "Prompt",
    "TextContent",
    "ImageContent",
    "AudioContent",
    "EmbeddedResource",
    "ResourceLink",
    "PromptMessage",
    "ToolAnnotations",
    "Tool",
    "DiscoverResult",
    "ListToolsResult",
    "CallToolResult",
    "ListResourcesResult",
    "ListResourceTemplatesResult",
    "ReadResourceResult",
    "ListPromptsResult",
    "GetPromptResult",
    "SamplingMessage",
    "ModelHint",
    "ModelPreferences",
    "CreateMessageResult",
    "CompleteResult",
    "Root",
    "ListRootsResult",
    "InputRequiredResult"
  ]

  for (const name of constructibleNames) {
    assert.equal(typeof Generated[name].make, "function", `${name}.make`)
    assert.equal(typeof Generated[name], "function", `${name} constructor`)
  }
})

test("required-array, discriminator, definition, and generated-file drift fail closed", (t) => {
  const mutations = [
    {
      name: "required array",
      mutate(fixtureRoot) {
        mutateJson(fixtureRoot, (schemaJson) => {
          schemaJson.$defs.CallToolResult.required = ["resultType"]
        })
      },
      expected: /schema\.json hash mismatch/
    },
    {
      name: "discriminator",
      mutate(fixtureRoot) {
        mutateJson(fixtureRoot, (schemaJson) => {
          schemaJson.$defs.TextContent.properties.type.const = "other"
        })
      },
      expected: /schema\.json hash mismatch/
    },
    {
      name: "definition",
      mutate(fixtureRoot) {
        mutateJson(fixtureRoot, (schemaJson) => {
          delete schemaJson.$defs.Resource
        })
      },
      expected: /schema\.json hash mismatch/
    },
    {
      name: "generated file",
      mutate(fixtureRoot) {
        const outputPath = path.join(fixtureRoot, "src/generated/mcp/2026-07-28/McpSchema.generated.ts")
        writeFileSync(outputPath, `${readFileSync(outputPath, "utf8")}\n// drift\n`)
      },
      expected: /Generated file is out of date/
    }
  ]

  for (const mutation of mutations) {
    const fixtureRoot = makeGeneratorFixture()
    t.after(() => rmSync(fixtureRoot, { force: true, recursive: true }))
    mutation.mutate(fixtureRoot)
    const result = spawnSync(process.execPath, ["scripts/generate-mcp.mjs", "--check"], {
      cwd: fixtureRoot,
      encoding: "utf8"
    })
    assert.notEqual(result.status, 0, `${mutation.name} drift must fail`)
    assert.match(`${result.stdout}\n${result.stderr}`, mutation.expected, mutation.name)
  }
})

test("allOf validates each member before structural merging", (t) => {
  const fixtureRoot = makeGeneratorFixture()
  t.after(() => rmSync(fixtureRoot, { force: true, recursive: true }))
  mutateAndRepinSchema(fixtureRoot, (schemaJson) => {
    schemaJson.$defs.AllOfProbe = {
      allOf: [
        { properties: { known: { type: "string" } }, required: ["known"], type: "object" },
        { properties: {}, type: "object", unsupportedKeyword: true }
      ]
    }
  })
  const result = spawnSync(process.execPath, ["scripts/generate-mcp.mjs"], {
    cwd: fixtureRoot,
    encoding: "utf8"
  })
  assert.notEqual(result.status, 0)
  assert.match(`${result.stdout}\n${result.stderr}`, /Unsupported schema construct at AllOfProbe\.allOf\[1\]: unsupportedKeyword/)
})

test("allOf and ref siblings preserve every intersection constraint", async (t) => {
  const fixtureRoot = makeGeneratorFixture()
  t.after(() => rmSync(fixtureRoot, { force: true, recursive: true }))
  mutateAndRepinSchema(fixtureRoot, (schemaJson) => {
    schemaJson.$defs.ErrorCodeDomain = {
      enum: [7, 8],
      type: "integer"
    }
    schemaJson.$defs.SpecificErrorCode = {
      $ref: "#/$defs/ErrorCodeDomain",
      const: 7
    }
    schemaJson.$defs.ImpossibleErrorCode = {
      $ref: "#/$defs/ErrorCodeDomain",
      const: 9
    }
    schemaJson.$defs.AllOfProbe = {
      allOf: [
        {
          additionalProperties: false,
          properties: {
            code: { minimum: 0, type: "integer" }
          },
          required: ["code"],
          type: "object"
        },
        {
          properties: {
            code: { maximum: 10, type: "integer" }
          },
          required: ["code"],
          type: "object"
        }
      ]
    }
    schemaJson.$defs.DisjointAllOfProbe = {
      allOf: [
        {
          properties: { left: { type: "string" } },
          required: ["left"],
          type: "object"
        },
        {
          properties: { right: { type: "integer" } },
          required: ["right"],
          type: "object"
        }
      ]
    }
    schemaJson.$defs.OverlapWithUniqueFieldsProbe = {
      allOf: [
        {
          properties: {
            code: { type: "integer" },
            data: { format: "byte", type: "string" },
            left: { type: "string" }
          },
          required: ["code", "data", "left"],
          type: "object"
        },
        {
          properties: {
            code: { const: 5, type: "integer" },
            right: { type: "boolean" }
          },
          required: ["code", "right"],
          type: "object"
        }
      ]
    }
  })
  const Generated = await generateFixtureAndImport(fixtureRoot)

  assert.deepEqual(
    Schema.encodeSync(Generated.SpecificErrorCode)(
      Schema.decodeUnknownSync(Generated.SpecificErrorCode)(7)
    ),
    7
  )
  assert.equal(decodeFails(Generated.SpecificErrorCode, 8), true)
  assert.throws(() => Schema.encodeSync(Generated.SpecificErrorCode)(8))
  assert.equal(decodeFails(Generated.ImpossibleErrorCode, 9), true)
  assert.throws(() => Schema.encodeSync(Generated.ImpossibleErrorCode)(9))

  const valid = { code: 5 }
  assert.deepEqual(
    Schema.encodeSync(Generated.AllOfProbe)(Schema.decodeUnknownSync(Generated.AllOfProbe)(valid)),
    valid
  )
  for (const invalid of [{ code: -1 }, { code: 11 }, { code: 5, extra: true }]) {
    assert.equal(decodeFails(Generated.AllOfProbe, invalid), true)
    assert.throws(
      () => Schema.encodeSync(Generated.AllOfProbe)(invalid),
      `encode must reject ${JSON.stringify(invalid)}`
    )
  }

  for (const [codec, value] of [
    [Generated.DisjointAllOfProbe, { left: "retained", right: 1 }],
    [Generated.OverlapWithUniqueFieldsProbe, {
      code: 5,
      data: "AQIDBA==",
      left: "retained",
      right: true
    }]
  ]) {
    assert.deepEqual(Schema.encodeSync(codec)(Schema.decodeUnknownSync(codec)(value)), value)
  }
  const transformed = Schema.decodeUnknownSync(Generated.OverlapWithUniqueFieldsProbe)({
    code: 5,
    data: "AQIDBA==",
    left: "retained",
    right: true
  })
  assert.deepEqual([...transformed.data], [1, 2, 3, 4])
})

test("byte transforms compose with ref siblings and encoded string constraints", async (t) => {
  const fixtureRoot = makeGeneratorFixture()
  t.after(() => rmSync(fixtureRoot, { force: true, recursive: true }))
  mutateAndRepinSchema(fixtureRoot, (schemaJson) => {
    schemaJson.$defs.StringWire = { type: "string" }
    schemaJson.$defs.ByteWire = { format: "byte", type: "string" }
    schemaJson.$defs.RefStringThenByte = {
      $ref: "#/$defs/StringWire",
      format: "byte"
    }
    schemaJson.$defs.RefByteWithMinimumWireLength = {
      $ref: "#/$defs/ByteWire",
      minLength: 8
    }
    schemaJson.$defs.AllOfByteWithMinimumWireLength = {
      allOf: [
        {
          properties: { data: { format: "byte", type: "string" } },
          required: ["data"],
          type: "object"
        },
        {
          properties: { data: { minLength: 8, type: "string" } },
          required: ["data"],
          type: "object"
        }
      ]
    }
  })
  const Generated = await generateFixtureAndImport(fixtureRoot)
  const validWire = "AQIDBA=="
  const validBytes = Uint8Array.from([1, 2, 3, 4])

  for (const codec of [Generated.RefStringThenByte, Generated.RefByteWithMinimumWireLength]) {
    const decoded = Schema.decodeUnknownSync(codec)(validWire)
    assert.deepEqual([...decoded], [...validBytes])
    assert.equal(Schema.encodeSync(codec)(decoded), validWire)
    assert.equal(decodeFails(codec, "AQ=="), codec === Generated.RefByteWithMinimumWireLength)
    assert.equal(decodeFails(codec, "%%%%%%%%"), true)
    if (codec === Generated.RefByteWithMinimumWireLength) {
      assert.throws(() => Schema.encodeSync(codec)(Uint8Array.from([1])))
    }
    assert.throws(() => Schema.encodeSync(codec)("not decoded bytes"))
  }

  const objectWire = { data: validWire }
  const decodedObject = Schema.decodeUnknownSync(
    Generated.AllOfByteWithMinimumWireLength
  )(objectWire)
  assert.deepEqual([...decodedObject.data], [...validBytes])
  assert.deepEqual(
    Schema.encodeSync(Generated.AllOfByteWithMinimumWireLength)(decodedObject),
    objectWire
  )
  assert.equal(decodeFails(Generated.AllOfByteWithMinimumWireLength, { data: "AQ==" }), true)
  assert.equal(decodeFails(Generated.AllOfByteWithMinimumWireLength, { data: "%%%%%%%%" }), true)
  assert.throws(() => Schema.encodeSync(Generated.AllOfByteWithMinimumWireLength)({
    data: Uint8Array.from([1])
  }))
})

test("multiple transforming allOf members fail generation", (t) => {
  const fixtureRoot = makeGeneratorFixture()
  t.after(() => rmSync(fixtureRoot, { force: true, recursive: true }))
  mutateAndRepinSchema(fixtureRoot, (schemaJson) => {
    schemaJson.$defs.CompetingByteTransforms = {
      allOf: [
        { format: "byte", type: "string" },
        { format: "byte", type: "string" }
      ]
    }
  })
  const result = spawnSync(process.execPath, ["scripts/generate-mcp.mjs"], {
    cwd: fixtureRoot,
    encoding: "utf8"
  })
  assert.notEqual(result.status, 0)
  assert.match(
    `${result.stdout}\n${result.stderr}`,
    /Unsupported multiple transforming allOf members at CompetingByteTransforms/
  )
})

test("mixed unions apply each bound only to applicable encoded instance types", async (t) => {
  const fixtureRoot = makeGeneratorFixture()
  t.after(() => rmSync(fixtureRoot, { force: true, recursive: true }))
  mutateAndRepinSchema(fixtureRoot, (schemaJson) => {
    const stringOrArray = [
      { type: "string" },
      { items: { type: "string" }, type: "array" }
    ]
    schemaJson.$defs.StringOrArrayMinLength = {
      anyOf: stringOrArray,
      minLength: 3
    }
    schemaJson.$defs.StringOrArrayMinItems = {
      anyOf: stringOrArray,
      minItems: 2
    }
    schemaJson.$defs.NumberOrStringMinimum = {
      anyOf: [{ type: "number" }, { type: "string" }],
      minimum: 0
    }
    schemaJson.$defs.MixedMultipleBounds = {
      anyOf: [...stringOrArray, { type: "number" }],
      minItems: 2,
      minLength: 3,
      minimum: 0
    }
  })
  const Generated = await generateFixtureAndImport(fixtureRoot)

  assertBidirectionalCases(Generated.StringOrArrayMinLength, ["abc", []], ["ab"])
  assertBidirectionalCases(Generated.StringOrArrayMinItems, ["x", ["a", "b"]], [["a"]])
  assertBidirectionalCases(Generated.NumberOrStringMinimum, [0, "unbounded"], [-1])
  assertBidirectionalCases(
    Generated.MixedMultipleBounds,
    ["abc", ["a", "b"], 0],
    ["ab", ["a"], -1]
  )
})

test("string bounds count Unicode code points instead of UTF-16 units or graphemes", async (t) => {
  const fixtureRoot = makeGeneratorFixture()
  t.after(() => rmSync(fixtureRoot, { force: true, recursive: true }))
  mutateAndRepinSchema(fixtureRoot, (schemaJson) => {
    schemaJson.$defs.UnicodeMinLength = {
      minLength: 2,
      type: "string"
    }
    schemaJson.$defs.UnicodeMaxLength = {
      maxLength: 1,
      type: "string"
    }
  })
  const Generated = await generateFixtureAndImport(fixtureRoot)
  const astralEmoji = "😀"
  const combiningSequence = "e\u0301"

  assertBidirectionalCases(
    Generated.UnicodeMinLength,
    [`${astralEmoji}a`, combiningSequence],
    [astralEmoji]
  )
  assertBidirectionalCases(
    Generated.UnicodeMaxLength,
    [astralEmoji],
    [combiningSequence]
  )
})

test("assertion-only bound fragments compose without widening unrelated keywords", async (t) => {
  const fixtureRoot = makeGeneratorFixture()
  t.after(() => rmSync(fixtureRoot, { force: true, recursive: true }))
  mutateAndRepinSchema(fixtureRoot, (schemaJson) => {
    schemaJson.$defs.StringAssertionAllOf = {
      allOf: [
        { type: "string" },
        { description: "A type-less string assertion.", minLength: 2 }
      ]
    }
    schemaJson.$defs.IntegerArray = {
      items: { type: "integer" },
      type: "array"
    }
    schemaJson.$defs.ArrayAssertionRefSibling = {
      $ref: "#/$defs/IntegerArray",
      minItems: 2
    }
    schemaJson.$defs.NumericAssertionAnyOf = {
      anyOf: [
        { minimum: 0 },
        { minimum: 10 }
      ]
    }
    schemaJson.$defs.AssertionOneOf = {
      oneOf: [
        { minLength: 2 },
        { minimum: 0 }
      ]
    }
    schemaJson.$defs.MultipleAssertionFamiliesAllOf = {
      allOf: [
        {
          anyOf: [
            { type: "string" },
            { items: { type: "integer" }, type: "array" },
            { type: "number" }
          ]
        },
        { minItems: 2, minLength: 2, minimum: 0 }
      ]
    }
    schemaJson.$defs.ByteAssertionAllOf = {
      allOf: [
        { format: "byte", type: "string" },
        { minLength: 8 }
      ]
    }
  })
  const Generated = await generateFixtureAndImport(fixtureRoot)

  assertBidirectionalCases(Generated.StringAssertionAllOf, ["ab"], ["a", 1])
  assertBidirectionalCases(Generated.ArrayAssertionRefSibling, [[1, 2]], [[1], "not-an-array"])
  assertBidirectionalCases(Generated.NumericAssertionAnyOf, [0, 10, "inapplicable"], [-1])
  assertBidirectionalCases(Generated.AssertionOneOf, ["a", -1], ["ab", 0, []])
  assertBidirectionalCases(
    Generated.MultipleAssertionFamiliesAllOf,
    ["ab", [1, 2], 0],
    ["a", [1], -1, true]
  )

  const wire = "AQIDBA=="
  const decoded = Schema.decodeUnknownSync(Generated.ByteAssertionAllOf)(wire)
  assert.deepEqual([...decoded], [1, 2, 3, 4])
  assert.equal(Schema.encodeSync(Generated.ByteAssertionAllOf)(decoded), wire)
  assert.equal(decodeFails(Generated.ByteAssertionAllOf, "AQ=="), true)
  assert.throws(() => Schema.encodeSync(Generated.ByteAssertionAllOf)(Uint8Array.from([1])))
})

test("invalid bound keyword values fail generation with recursive locations", (t) => {
  const invalidCases = []
  for (const keyword of ["minLength", "maxLength", "minItems", "maxItems"]) {
    for (const [label, value] of [
      ["negative", -1],
      ["fractional", 1.5],
      ["string", "1"],
      ["null", null]
    ]) {
      invalidCases.push({ keyword, label, value })
    }
  }
  for (const keyword of ["minimum", "maximum"]) {
    for (const [label, value] of [
      ["string", "0"],
      ["boolean", true],
      ["null", null]
    ]) {
      invalidCases.push({ keyword, label, value })
    }
  }

  const unexpectedlyGenerated = []
  for (const { keyword, label, value } of invalidCases) {
    const fixtureRoot = makeGeneratorFixture()
    t.after(() => rmSync(fixtureRoot, { force: true, recursive: true }))
    mutateAndRepinSchema(fixtureRoot, (schemaJson) => {
      schemaJson.$defs.InvalidBound = {
        allOf: [boundTargetSchema(keyword), { [keyword]: value }]
      }
    })
    const result = spawnSync(process.execPath, ["scripts/generate-mcp.mjs"], {
      cwd: fixtureRoot,
      encoding: "utf8"
    })
    if (result.status === 0) {
      unexpectedlyGenerated.push(`${keyword}:${label}`)
      continue
    }
    const expectation = ["minimum", "maximum"].includes(keyword)
      ? "expected a finite number"
      : "expected a non-negative integer"
    assert.match(
      `${result.stdout}\n${result.stderr}`,
      new RegExp(`Invalid ${keyword} at InvalidBound\\.allOf\\[1\\]\\.${keyword}: ${expectation}`),
      `${keyword}:${label}`
    )
  }

  for (const [keyword, literal] of [["minimum", "1e400"], ["maximum", "-1e400"]]) {
    const fixtureRoot = makeGeneratorFixture()
    t.after(() => rmSync(fixtureRoot, { force: true, recursive: true }))
    mutateAndRepinSchemaText(fixtureRoot, (source) => {
      const schemaJson = JSON.parse(source)
      schemaJson.$defs.InvalidBound = {
        allOf: [{ type: "number" }, { [keyword]: "__NON_FINITE__" }]
      }
      return `${JSON.stringify(schemaJson, null, 4)}\n`.replace('"__NON_FINITE__"', literal)
    })
    const result = spawnSync(process.execPath, ["scripts/generate-mcp.mjs"], {
      cwd: fixtureRoot,
      encoding: "utf8"
    })
    if (result.status === 0) {
      unexpectedlyGenerated.push(`${keyword}:non-finite`)
      continue
    }
    assert.match(
      `${result.stdout}\n${result.stderr}`,
      new RegExp(`Invalid ${keyword} at InvalidBound\\.allOf\\[1\\]\\.${keyword}: expected a finite number`)
    )
  }

  assert.deepEqual(unexpectedlyGenerated, [])
})

test("valid zero fractional and unsatisfiable bound shapes still generate", async (t) => {
  const fixtureRoot = makeGeneratorFixture()
  t.after(() => rmSync(fixtureRoot, { force: true, recursive: true }))
  mutateAndRepinSchema(fixtureRoot, (schemaJson) => {
    schemaJson.$defs.ValidNumericBounds = {
      maximum: 2.25,
      minimum: -1.5,
      type: "number"
    }
    schemaJson.$defs.ValidZeroStringBounds = {
      maxLength: 0,
      minLength: 0,
      type: "string"
    }
    schemaJson.$defs.ValidZeroArrayBounds = {
      items: { type: "integer" },
      maxItems: 0,
      minItems: 0,
      type: "array"
    }
    schemaJson.$defs.ValidUnsatisfiableStringBounds = {
      maxLength: 1,
      minLength: 2,
      type: "string"
    }
    schemaJson.$defs.ValidUnsatisfiableNumericBounds = {
      maximum: 0,
      minimum: 1,
      type: "number"
    }
  })
  const Generated = await generateFixtureAndImport(fixtureRoot)

  assertBidirectionalCases(Generated.ValidNumericBounds, [-1.5, 0, 2.25], [-2, 2.5])
  assertBidirectionalCases(Generated.ValidZeroStringBounds, [""], ["a"])
  assertBidirectionalCases(Generated.ValidZeroArrayBounds, [[]], [[1]])
  assertBidirectionalCases(Generated.ValidUnsatisfiableStringBounds, [], ["", "a", "ab"])
  assertBidirectionalCases(Generated.ValidUnsatisfiableNumericBounds, [], [0, 0.5, 1])
})

test("generated oneOf accepts exactly one matching branch", async (t) => {
  const fixtureRoot = makeGeneratorFixture()
  t.after(() => rmSync(fixtureRoot, { force: true, recursive: true }))
  mutateAndRepinSchema(fixtureRoot, (schemaJson) => {
    schemaJson.$defs.OneOfProbe = {
      oneOf: [
        {
          properties: { kind: { const: "overlap", type: "string" } },
          required: ["kind"],
          type: "object"
        },
        {
          properties: { kind: { type: "string" } },
          required: ["kind"],
          type: "object"
        }
      ]
    }
  })
  const Generated = await generateFixtureAndImport(fixtureRoot)
  assert.equal(decodeFails(Generated.OneOfProbe, { kind: "overlap" }), true)
  const decoded = Schema.decodeUnknownSync(Generated.OneOfProbe)({ kind: "distinct" })
  assert.deepEqual(Schema.encodeSync(Generated.OneOfProbe)(decoded), { kind: "distinct" })
  assert.throws(() => Schema.encodeSync(Generated.OneOfProbe)({ kind: "overlap" }))
})

test("generated closed objects reject unknown keys", async (t) => {
  const fixtureRoot = makeGeneratorFixture()
  t.after(() => rmSync(fixtureRoot, { force: true, recursive: true }))
  mutateAndRepinSchema(fixtureRoot, (schemaJson) => {
    schemaJson.$defs.ClosedProbe = {
      additionalProperties: false,
      properties: { known: { type: "string" } },
      required: ["known"],
      type: "object"
    }
  })
  const Generated = await generateFixtureAndImport(fixtureRoot)
  const decoded = Schema.decodeUnknownSync(Generated.ClosedProbe)({ known: "value" })
  assert.deepEqual(Schema.encodeSync(Generated.ClosedProbe)(decoded), { known: "value" })
  assert.equal(decodeFails(Generated.ClosedProbe, { known: "value", extra: true }), true)
  assert.throws(() => Schema.encodeSync(Generated.ClosedProbe)({ known: "value", extra: true }))
})

function resultInterfaceDescendants(sourceText) {
  const parentsByName = new Map()
  const pattern = /export interface\s+([A-Za-z0-9_]+)(?:\s+extends\s+([^\{]+))?\s*\{/g
  let match
  while ((match = pattern.exec(sourceText)) !== null) {
    parentsByName.set(
      match[1],
      (match[2] ?? "").split(",").map((name) => name.trim()).filter(Boolean)
    )
  }
  const descendants = new Set(["Result"])
  let changed = true
  while (changed) {
    changed = false
    for (const [name, parents] of parentsByName) {
      if (!descendants.has(name) && parents.some((parent) => descendants.has(parent))) {
        descendants.add(name)
        changed = true
      }
    }
  }
  descendants.delete("Result")
  return [...descendants].sort()
}

function namedDefinitionAliases(sourceText, definitionSet) {
  const aliases = {}
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
      && members.every((member) => /^[A-Za-z0-9_]+$/.test(member) && definitionSet.has(member))
    ) {
      aliases[match[1]] = members
    }
  }
  return aliases
}

function assertBidirectionalCases(schema, validValues, invalidValues) {
  for (const value of validValues) {
    assert.deepEqual(Schema.encodeSync(schema)(Schema.decodeUnknownSync(schema)(value)), value)
  }
  for (const value of invalidValues) {
    assert.equal(decodeFails(schema, value), true)
    assert.throws(() => Schema.encodeSync(schema)(value))
  }
}

function boundTargetSchema(keyword) {
  if (["minLength", "maxLength"].includes(keyword)) return { type: "string" }
  if (["minItems", "maxItems"].includes(keyword)) {
    return { items: { type: "string" }, type: "array" }
  }
  return { type: "number" }
}

function mutateJson(fixtureRoot, mutate) {
  const schemaPath = path.join(fixtureRoot, "sources/vendor/mcp-core/schema.json")
  const schemaJson = JSON.parse(readFileSync(schemaPath, "utf8"))
  mutate(schemaJson)
  writeFileSync(schemaPath, `${JSON.stringify(schemaJson, null, 4)}\n`)
}

function mutateAndRepinSchema(fixtureRoot, mutate) {
  const schemaPath = path.join(fixtureRoot, "sources/vendor/mcp-core/schema.json")
  const generatorPath = path.join(fixtureRoot, "scripts/generate-mcp.mjs")
  const originalBytes = readFileSync(schemaPath)
  const originalHash = createHash("sha256").update(originalBytes).digest("hex")
  const schemaJson = JSON.parse(originalBytes.toString("utf8"))
  mutate(schemaJson)
  const nextBytes = Buffer.from(`${JSON.stringify(schemaJson, null, 4)}\n`)
  writeFileSync(schemaPath, nextBytes)
  const nextHash = createHash("sha256").update(nextBytes).digest("hex")
  const generator = readFileSync(generatorPath, "utf8")
  assert.match(generator, new RegExp(originalHash))
  writeFileSync(generatorPath, generator.replace(originalHash, nextHash))
}

function mutateAndRepinSchemaText(fixtureRoot, mutate) {
  const schemaPath = path.join(fixtureRoot, "sources/vendor/mcp-core/schema.json")
  const generatorPath = path.join(fixtureRoot, "scripts/generate-mcp.mjs")
  const originalBytes = readFileSync(schemaPath)
  const originalHash = createHash("sha256").update(originalBytes).digest("hex")
  const nextBytes = Buffer.from(mutate(originalBytes.toString("utf8")))
  writeFileSync(schemaPath, nextBytes)
  const nextHash = createHash("sha256").update(nextBytes).digest("hex")
  const generator = readFileSync(generatorPath, "utf8")
  assert.match(generator, new RegExp(originalHash))
  writeFileSync(generatorPath, generator.replace(originalHash, nextHash))
}

async function generateFixtureAndImport(fixtureRoot) {
  const generated = spawnSync(process.execPath, ["scripts/generate-mcp.mjs"], {
    cwd: fixtureRoot,
    encoding: "utf8"
  })
  assert.equal(generated.status, 0, `${generated.stdout}\n${generated.stderr}`)

  writeFileSync(path.join(fixtureRoot, "package.json"), `${JSON.stringify({ type: "module" })}\n`)
  const outputDirectory = path.join(fixtureRoot, "dist")
  const generatedPath = path.join(
    fixtureRoot,
    "src/generated/mcp/2026-07-28/McpSchema.generated.ts"
  )
  const compiled = spawnSync(process.execPath, [
    path.join(root, "node_modules/typescript/bin/tsc"),
    "--pretty", "false",
    "--target", "ES2022",
    "--module", "NodeNext",
    "--moduleResolution", "NodeNext",
    "--skipLibCheck", "true",
    "--outDir", outputDirectory,
    generatedPath
  ], {
    cwd: fixtureRoot,
    encoding: "utf8"
  })
  assert.equal(compiled.status, 0, `${compiled.stdout}\n${compiled.stderr}`)
  return import(pathToFileURL(path.join(outputDirectory, "McpSchema.generated.js")).href)
}

function assertFixtureTypes(fixtureRoot, source) {
  const fixturePath = path.join(fixtureRoot, "type-fixture.ts")
  writeFileSync(fixturePath, source)
  const result = spawnSync(process.execPath, [
    path.join(root, "node_modules/typescript/bin/tsc"),
    "--pretty", "false",
    "--target", "ES2022",
    "--module", "NodeNext",
    "--moduleResolution", "NodeNext",
    "--skipLibCheck", "true",
    "--noEmit",
    fixturePath
  ], {
    cwd: fixtureRoot,
    encoding: "utf8"
  })
  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`)
}

function makeGeneratorFixture() {
  const fixtureRoot = mkdtempSync(path.join(tmpdir(), "mcp-schema-generator-"))
  for (const relativePath of [
    "scripts/generate-mcp.mjs",
    "sources/vendor/mcp-core/schema.json",
    "sources/vendor/mcp-core/schema.ts",
    "src/generated/mcp/2026-07-28/McpProtocol.generated.ts",
    "src/generated/mcp/2026-07-28/McpSchema.generated.ts"
  ]) {
    const source = path.join(root, relativePath)
    const target = path.join(fixtureRoot, relativePath)
    mkdirSync(path.dirname(target), { recursive: true })
    cpSync(source, target, { recursive: true })
  }
  symlinkSync(path.join(root, "node_modules"), path.join(fixtureRoot, "node_modules"), "dir")
  return fixtureRoot
}
