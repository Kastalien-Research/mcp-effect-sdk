import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"
import * as Schema from "effect/Schema"
import * as McpSchema from "../dist/McpSchema.js"

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const root = path.resolve(__dirname, "..")
const schemaJsonPath = path.join(root, "src/generated/mcp/2026-07-28/schema.json")

const schemaJson = JSON.parse(readFileSync(schemaJsonPath, "utf8"))
const stableDefinitions = schemaJson.$defs
const stableDefinitionNames = Object.keys(stableDefinitions).sort((left, right) =>
  left.localeCompare(right)
)

assert.equal(McpSchema.MCP_SCHEMA_VERSION, "2026-07-28")
assert.deepEqual(McpSchema.MCP_SCHEMA_DEFINITION_NAMES, stableDefinitionNames)
assert.deepEqual(McpSchema.MCP_SCHEMA_DEFINITIONS, stableDefinitions)

const fixtures = [
  {
    name: "Resource",
    schema: McpSchema.Resource,
    value: {
      uri: "file:///tmp/notes.md",
      name: "notes",
      title: "Notes",
      description: "Working notes",
      mimeType: "text/markdown",
      annotations: {
        audience: ["user"],
        priority: 0.75,
        lastModified: "2026-05-01T12:00:00Z"
      },
      size: 42,
      _meta: {
        source: "fixture"
      }
    }
  },
  {
    name: "Tool",
    schema: McpSchema.Tool,
    value: {
      name: "search",
      title: "Search",
      description: "Search indexed documents",
      inputSchema: {
        $schema: "https://json-schema.org/draft/2020-12/schema",
        type: "object",
        $defs: {
          queryText: {
            type: "string",
            minLength: 1
          }
        },
        properties: {
          query: {
            $ref: "#/$defs/queryText"
          },
          mode: {
            oneOf: [
              { const: "semantic" },
              { const: "keyword" }
            ]
          }
        },
        if: {
          properties: {
            mode: { const: "semantic" }
          }
        },
        then: {
          required: ["query"]
        },
        required: ["query"]
      },
      outputSchema: {
        $schema: "https://json-schema.org/draft/2020-12/schema",
        anyOf: [
          {
            type: "array",
            items: { type: "string" }
          },
          { type: "null" }
        ]
      },
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false
      },
      _meta: {
        fixture: true
      }
    }
  },
  {
    name: "CallToolResult",
    schema: McpSchema.CallToolResult,
    value: {
      content: [
        {
          type: "text",
          text: "ok"
        }
      ],
      structuredContent: ["ok", 1, true, null],
      isError: false,
      _meta: {
        fixture: true
      }
    }
  },
  {
    name: "DiscoverResult",
    schema: McpSchema.DiscoverResult,
    value: {
      resultType: "complete",
      supportedVersions: ["2026-07-28"],
      capabilities: {
        tools: {
          listChanged: true
        }
      },
      serverInfo: {
        name: "fixture-server",
        title: "Fixture Server",
        version: "1.0.0"
      },
      instructions: "Fixture instructions",
      ttlMs: 0,
      cacheScope: "private",
      _meta: {
        fixture: true
      }
    }
  },
  {
    name: "ListToolsResult",
    schema: McpSchema.ListToolsResult,
    value: {
      resultType: "complete",
      ttlMs: 10_000,
      cacheScope: "public",
      tools: [
        {
          name: "cached-search",
          inputSchema: {
            type: "object",
            unevaluatedProperties: false,
            properties: {
              query: { type: "string" }
            }
          }
        }
      ]
    }
  },
  {
    name: "ListResourcesResult",
    schema: McpSchema.ListResourcesResult,
    value: {
      resultType: "complete",
      ttlMs: 5_000,
      cacheScope: "private",
      resources: [
        {
          uri: "file:///tmp/cacheable-resource.md",
          name: "cacheable-resource"
        }
      ]
    }
  },
  {
    name: "ListResourceTemplatesResult",
    schema: McpSchema.ListResourceTemplatesResult,
    value: {
      resultType: "complete",
      ttlMs: 5_000,
      cacheScope: "public",
      resourceTemplates: [
        {
          uriTemplate: "file:///tmp/{name}.md",
          name: "cacheable-template"
        }
      ]
    }
  },
  {
    name: "ListPromptsResult",
    schema: McpSchema.ListPromptsResult,
    value: {
      resultType: "complete",
      ttlMs: 5_000,
      cacheScope: "private",
      prompts: [
        {
          name: "cacheable-prompt"
        }
      ]
    }
  },
  {
    name: "ReadResourceResult",
    schema: McpSchema.ReadResourceResult,
    value: {
      resultType: "complete",
      ttlMs: 2_500,
      cacheScope: "private",
      contents: [
        {
          uri: "file:///tmp/cacheable-resource.md",
          text: "cached"
        }
      ]
    }
  }
]

for (const fixture of fixtures) {
  const decoded = Schema.decodeUnknownSync(fixture.schema)(fixture.value)
  const encoded = Schema.encodeSync(fixture.schema)(decoded)
  assert.deepEqual(encoded, fixture.value, `${fixture.name} should round-trip`)
}

console.log(`Generated schema fixtures passed for ${fixtures.length} schema(s).`)
