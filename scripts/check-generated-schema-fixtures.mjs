import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"
import * as Schema from "effect/Schema"
import * as McpSchema from "../dist/McpSchema.js"
import * as Generated from "../dist/generated/mcp/2026-07-28/McpSchema.generated.js"

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const root = path.resolve(__dirname, "..")
const schemaJsonPath = path.join(root, "sources/vendor/mcp-core/schema.json")

const schemaJson = JSON.parse(readFileSync(schemaJsonPath, "utf8"))
const stableDefinitions = schemaJson.$defs
const stableDefinitionNames = Object.keys(stableDefinitions).sort((left, right) =>
  left.localeCompare(right)
)

assert.equal(McpSchema.MCP_SCHEMA_VERSION, "2026-07-28")
assert.deepEqual(McpSchema.MCP_SCHEMA_DEFINITION_NAMES, stableDefinitionNames)
assert.deepEqual(Object.keys(McpSchema.MCP_SCHEMA_CODECS), stableDefinitionNames)
for (const name of stableDefinitionNames) {
  assert.equal(McpSchema.MCP_SCHEMA_CODECS[name], Generated[name])
}

const requestMeta = {
  "io.modelcontextprotocol/protocolVersion": "2026-07-28",
  "io.modelcontextprotocol/clientCapabilities": {}
}

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
      resultType: "complete",
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
  },
  {
    name: "EmptyResult",
    schema: Generated.EmptyResult,
    value: {
      resultType: "complete",
      extension: { retained: true }
    }
  },
  {
    name: "CacheableResult",
    schema: Generated.CacheableResult,
    value: {
      resultType: "complete",
      ttlMs: 0,
      cacheScope: "private"
    }
  },
  {
    name: "PaginatedResult",
    schema: Generated.PaginatedResult,
    value: {
      resultType: "complete",
      nextCursor: "next"
    }
  },
  {
    name: "GetPromptResult",
    schema: McpSchema.GetPromptResult,
    value: {
      resultType: "complete",
      messages: [{ role: "assistant", content: { type: "text", text: "hello" } }]
    }
  },
  {
    name: "CompleteResult",
    schema: McpSchema.CompleteResult,
    value: {
      resultType: "complete",
      completion: { values: ["one", "two"], total: 2, hasMore: false }
    }
  },
  {
    name: "SubscriptionsListenResult",
    schema: Generated.SubscriptionsListenResult,
    value: {
      resultType: "complete",
      _meta: { "io.modelcontextprotocol/subscriptionId": 7 }
    }
  },
  {
    name: "InputRequiredResult",
    schema: McpSchema.InputRequiredResult,
    value: {
      resultType: "input_required",
      requestState: "opaque-state"
    }
  },
  {
    name: "CreateMessageResult",
    schema: McpSchema.CreateMessageResult,
    value: {
      role: "assistant",
      content: { type: "text", text: "sampled" },
      model: "fixture-model",
      stopReason: "endTurn"
    }
  },
  {
    name: "ListRootsResult",
    schema: McpSchema.ListRootsResult,
    value: {
      roots: [{ uri: "file:///tmp", name: "tmp" }]
    }
  },
  {
    name: "ElicitResult",
    schema: McpSchema.ElicitResult,
    value: {
      action: "accept",
      content: { approved: true }
    }
  },
  {
    name: "CallToolRequest",
    schema: Generated.CallToolRequest,
    value: {
      jsonrpc: "2.0",
      id: "request-1",
      method: "tools/call",
      params: { _meta: requestMeta, name: "search", arguments: { query: "effect" } }
    }
  },
  {
    name: "ProgressNotification",
    schema: Generated.ProgressNotification,
    value: {
      jsonrpc: "2.0",
      method: "notifications/progress",
      params: { progressToken: "request-1", progress: 0.5 }
    }
  },
  {
    name: "ImageContent",
    schema: McpSchema.ImageContent,
    value: {
      type: "image",
      data: "AQIDBA==",
      mimeType: "image/png"
    }
  },
  {
    name: "RecursiveJSON",
    schema: Generated.JSONValue,
    value: {
      nested: ["text", 42, true, null, { deep: [false] }]
    }
  }
]

for (const fixture of fixtures) {
  const decoded = Schema.decodeUnknownSync(fixture.schema)(fixture.value)
  const encoded = Schema.encodeSync(fixture.schema)(decoded)
  assert.deepEqual(encoded, fixture.value, `${fixture.name} should round-trip`)
}

const negativeFixtures = [
  ["missing complete resultType", McpSchema.ListToolsResult, { tools: [], ttlMs: 0, cacheScope: "public" }],
  ["wrong complete discriminator", McpSchema.ListToolsResult, { resultType: "input_required", tools: [], ttlMs: 0, cacheScope: "public" }],
  ["wrong input-required discriminator", McpSchema.InputRequiredResult, { resultType: "complete" }],
  ["invalid enum", Generated.Role, "system"],
  ["invalid numeric bound", Generated.Annotations, { priority: 2 }],
  ["invalid array bound", Generated.CompleteResult, { resultType: "complete", completion: { values: Array.from({ length: 101 }, (_, index) => String(index)) } }],
  ["invalid byte", Generated.AudioContent, { type: "audio", data: "%%%", mimeType: "audio/wav" }],
  ["malformed union", Generated.ContentBlock, { type: "text", mimeType: "text/plain" }]
]

for (const [name, schema, value] of negativeFixtures) {
  assert.throws(() => Schema.decodeUnknownSync(schema)(value), `${name} should fail to decode`)
}

console.log(`Generated schema fixtures passed (${fixtures.length} round-trips, ${negativeFixtures.length} negative cases).`)
