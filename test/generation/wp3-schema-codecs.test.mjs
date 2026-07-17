import assert from "node:assert/strict"
import { createHash } from "node:crypto"
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { spawnSync } from "node:child_process"
import { fileURLToPath } from "node:url"
import test from "node:test"
import * as Schema from "effect/Schema"

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..")
const sourceSchemaPath = path.join(root, "sources/vendor/mcp-core/schema.json")
const sourceSchema = JSON.parse(readFileSync(sourceSchemaPath, "utf8"))
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
  assert.doesNotMatch(generator, /src["']?,\s*["']generated["']?,\s*["']mcp["']?,\s*["']2026-07-28/)
  assert.equal(existsSync(path.join(root, "src/generated/mcp/2026-07-28/schema.json")), false)
  assert.equal(existsSync(path.join(root, "src/generated/mcp/2026-07-28/schema.ts.txt")), false)
  assert.equal(existsSync(revisionedSchemaOutput), true)
  assert.equal(existsSync(unrevisionedSchemaOutput), false)
})

test("the generated codec registry exactly covers sorted pinned definitions", async () => {
  const Generated = await import("../../dist/generated/mcp/McpSchema.generated.js")

  assert.deepEqual(Generated.MCP_SCHEMA_DEFINITION_NAMES, definitionNames)
  assert.deepEqual(Object.keys(Generated.MCP_SCHEMA_CODECS), definitionNames)
  for (const name of definitionNames) {
    assert.equal(Generated.MCP_SCHEMA_CODECS[name], Generated[name], `${name} registry entry`)
    assert.equal(typeof Generated[name]?.ast, "object", `${name} must be an Effect Schema codec`)
  }
})

test("recursive JSON and base64 byte codecs round-trip encoded wire values", async () => {
  const Generated = await import("../../dist/generated/mcp/McpSchema.generated.js")
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

test("result discriminators, enums, bounds, and unions fail closed", async () => {
  const Generated = await import("../../dist/generated/mcp/McpSchema.generated.js")

  assert.equal(decodeFails(Generated.ListToolsResult, { tools: [], ttlMs: 0, cacheScope: "public" }), true)
  assert.equal(decodeFails(Generated.ListToolsResult, {
    resultType: "input_required",
    tools: [],
    ttlMs: 0,
    cacheScope: "public"
  }), true)
  assert.equal(decodeFails(Generated.InputRequiredResult, { resultType: "complete" }), true)
  assert.equal(decodeFails(Generated.InputRequiredResult, { resultType: "input_required" }), false)
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
  const Generated = await import("../../dist/generated/mcp/McpSchema.generated.js")

  for (const value of [Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY]) {
    assert.equal(decodeFails(Generated.JSONValue, value), true)
    assert.equal(decodeFails(Generated.Error, { code: value, message: "non-finite" }), true)
  }
})

test("EmptyResult preserves Result extensions and annotations", async () => {
  const Generated = await import("../../dist/generated/mcp/McpSchema.generated.js")
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
  const Generated = await import("../../dist/generated/mcp/McpSchema.generated.js")
  const fixtures = [
    [Generated.EmptyResult, { resultType: "complete", extension: "retained" }],
    [Generated.CacheableResult, { resultType: "complete", ttlMs: 0, cacheScope: "private" }],
    [Generated.PaginatedResult, { resultType: "complete", nextCursor: "next" }]
  ]

  for (const [schema, value] of fixtures) {
    assert.deepEqual(Schema.encodeSync(schema)(Schema.decodeUnknownSync(schema)(value)), value)
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
  const Generated = await import("../../dist/generated/mcp/McpSchema.generated.js")
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
        const outputPath = path.join(fixtureRoot, "src/generated/mcp/McpSchema.generated.ts")
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

test("unsupported oneOf and closed objects fail during semantic conversion", (t) => {
  const mutations = [
    {
      name: "oneOf",
      mutate(schemaJson) {
        schemaJson.$defs.OneOfProbe = {
          oneOf: [{ type: "string" }, { const: "overlap", type: "string" }]
        }
      },
      expected: /Unsupported oneOf/
    },
    {
      name: "additionalProperties false",
      mutate(schemaJson) {
        schemaJson.$defs.ClosedProbe = {
          additionalProperties: false,
          properties: { known: { type: "string" } },
          required: ["known"],
          type: "object"
        }
      },
      expected: /Unsupported additionalProperties false/
    }
  ]

  for (const mutation of mutations) {
    const fixtureRoot = makeGeneratorFixture()
    t.after(() => rmSync(fixtureRoot, { force: true, recursive: true }))
    mutateAndRepinSchema(fixtureRoot, mutation.mutate)
    const result = spawnSync(process.execPath, ["scripts/generate-mcp.mjs"], {
      cwd: fixtureRoot,
      encoding: "utf8"
    })
    assert.notEqual(result.status, 0, `${mutation.name} must fail closed`)
    assert.match(`${result.stdout}\n${result.stderr}`, mutation.expected, mutation.name)
  }
})

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

function makeGeneratorFixture() {
  const fixtureRoot = mkdtempSync(path.join(tmpdir(), "mcp-schema-generator-"))
  for (const relativePath of [
    "scripts/generate-mcp.mjs",
    "sources/vendor/mcp-core/schema.json",
    "sources/vendor/mcp-core/schema.ts",
    "src/generated/mcp/McpProtocol.generated.ts",
    "src/generated/mcp/McpSchema.generated.ts"
  ]) {
    const source = path.join(root, relativePath)
    const target = path.join(fixtureRoot, relativePath)
    mkdirSync(path.dirname(target), { recursive: true })
    cpSync(source, target, { recursive: true })
  }
  return fixtureRoot
}
