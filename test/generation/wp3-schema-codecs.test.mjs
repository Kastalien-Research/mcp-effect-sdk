import assert from "node:assert/strict"
import { existsSync, readFileSync } from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"
import test from "node:test"
import * as Schema from "effect/Schema"

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..")
const sourceSchemaPath = path.join(root, "sources/vendor/mcp-core/schema.json")
const sourceSchema = JSON.parse(readFileSync(sourceSchemaPath, "utf8"))
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

