import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"
import * as Schema from "effect/Schema"
import * as McpSchema from "../dist/McpSchema.js"

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const root = path.resolve(__dirname, "..")
const schemaJsonPath = path.join(root, "src/generated/mcp/2025-11-25/schema.json")

const schemaJson = JSON.parse(readFileSync(schemaJsonPath, "utf8"))
const stableDefinitions = schemaJson.$defs
const stableDefinitionNames = Object.keys(stableDefinitions).sort((left, right) =>
  left.localeCompare(right)
)

assert.equal(McpSchema.MCP_SCHEMA_VERSION, "2025-11-25")
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
        type: "object",
        properties: {
          query: {
            type: "string"
          }
        },
        required: ["query"]
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
      structuredContent: {
        ok: true
      },
      isError: false,
      _meta: {
        fixture: true
      }
    }
  },
  {
    name: "InitializeResult",
    schema: McpSchema.InitializeResult,
    value: {
      protocolVersion: "2025-11-25",
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
      _meta: {
        fixture: true
      }
    }
  },
  {
    name: "TaskStatusNotificationParams",
    schema: McpSchema.TaskStatusNotificationParams,
    value: {
      taskId: "task-1",
      status: "working",
      statusMessage: "running",
      createdAt: "2026-05-01T12:00:00Z",
      lastUpdatedAt: "2026-05-01T12:00:01Z",
      ttl: 60,
      pollInterval: 1,
      _meta: {
        fixture: true
      }
    }
  }
]

for (const fixture of fixtures) {
  const decoded = Schema.decodeUnknownSync(fixture.schema)(fixture.value)
  const encoded = Schema.encodeSync(fixture.schema)(decoded)
  assert.deepEqual(encoded, fixture.value, `${fixture.name} should round-trip`)
}

console.log(`Generated schema fixtures passed for ${fixtures.length} schema(s).`)
