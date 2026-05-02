/**
 * Schema compliance tests for McpSchema.ts against MCP 2025-11-25.
 *
 * Tests decode (parse server JSON), encode (produce valid wire JSON),
 * and reject (invalid messages fail with useful errors).
 *
 * No server, transport, or agent loop needed — just JSON fixtures
 * and Schema.decodeUnknownSync / Schema.encodeSync.
 */
import { Schema } from "effect"
import { describe, expect, it } from "vitest"
import * as Mcp from "./McpSchema.js"

// =========================================================================
// Helpers
// =========================================================================

const decode = <A, I>(
  schema: Schema.Schema<A, I, never>,
  input: unknown
): A => Schema.decodeUnknownSync(schema)(input)

const encode = <A, I>(
  schema: Schema.Schema<A, I, never>,
  value: A
): I => Schema.encodeSync(schema)(value)

const decodeFails = <A, I>(
  schema: Schema.Schema<A, I, never>,
  input: unknown
): void => {
  expect(() => Schema.decodeUnknownSync(schema)(input)).toThrow()
}

// =========================================================================
// Gap 8: Annotations — lastModified
// =========================================================================

describe("Annotations", () => {
  it("decodes with lastModified", () => {
    const result = decode(Mcp.Annotations, {
      audience: ["user"],
      lastModified: "2025-01-12T15:00:58Z",
      priority: 0.8,
    })
    expect(result.lastModified).toBe("2025-01-12T15:00:58Z")
    expect(result.audience).toEqual(["user"])
    expect(result.priority).toBe(0.8)
  })

  it("decodes without lastModified (optional)", () => {
    const result = decode(Mcp.Annotations, { priority: 0.5 })
    expect(result.lastModified).toBeUndefined()
  })
})

// =========================================================================
// Gap 7: Implementation — description, icons, websiteUrl
// =========================================================================

describe("Implementation", () => {
  it("decodes with all new fields", () => {
    const result = decode(Mcp.Implementation, {
      name: "test-server",
      version: "1.0.0",
      title: "Test Server",
      description: "A test MCP server",
      websiteUrl: "https://example.com",
      icons: [{ src: "https://example.com/icon.png" }],
    })
    expect(result.description).toBe("A test MCP server")
    expect(result.websiteUrl).toBe("https://example.com")
    expect(result.icons).toHaveLength(1)
  })

  it("decodes with only required fields", () => {
    const result = decode(Mcp.Implementation, {
      name: "minimal",
      version: "0.1.0",
    })
    expect(result.description).toBeUndefined()
    expect(result.icons).toBeUndefined()
    expect(result.websiteUrl).toBeUndefined()
  })
})

// =========================================================================
// Gap 5: _meta on entities
// =========================================================================

describe("_meta on entities", () => {
  it("Resource accepts _meta and icons", () => {
    const result = decode(Mcp.Resource, {
      uri: "file:///test.txt",
      name: "test",
      _meta: { custom: "value" },
      icons: [{ src: "data:image/png;base64,abc" }],
    })
    expect(result._meta).toEqual({ custom: "value" })
    expect(result.icons).toHaveLength(1)
  })

  it("ResourceTemplate accepts _meta and icons", () => {
    const result = decode(Mcp.ResourceTemplate, {
      uriTemplate: "file:///{path}",
      name: "files",
      _meta: { tag: 1 },
      icons: [],
    })
    expect(result._meta).toEqual({ tag: 1 })
  })

  it("Prompt accepts _meta and icons", () => {
    const result = decode(Mcp.Prompt, {
      name: "summarize",
      _meta: { source: "builtin" },
      icons: [{ src: "https://example.com/icon.svg", theme: "dark" }],
    })
    expect(result._meta).toEqual({ source: "builtin" })
    expect(result.icons![0]!.theme).toBe("dark")
  })

  it("Root accepts _meta", () => {
    const result = decode(Mcp.Root, {
      uri: "file:///workspace",
      _meta: { workspace: true },
    })
    expect(result._meta).toEqual({ workspace: true })
  })

  it("Tool accepts _meta", () => {
    const result = decode(Mcp.Tool, {
      name: "read_file",
      inputSchema: { type: "object", properties: {} },
      _meta: { category: "filesystem" },
    })
    expect(result._meta).toEqual({ category: "filesystem" })
  })

  it("TextContent accepts _meta", () => {
    const result = decode(Mcp.TextContent, {
      type: "text",
      text: "hello",
      _meta: { source: "tool" },
    })
    expect(result._meta).toEqual({ source: "tool" })
  })

  it("ImageContent accepts _meta", () => {
    const result = decode(Mcp.ImageContent, {
      type: "image",
      data: "AAAA",
      mimeType: "image/png",
      _meta: { width: 100 },
    })
    expect(result._meta).toEqual({ width: 100 })
  })

  it("AudioContent accepts _meta", () => {
    const result = decode(Mcp.AudioContent, {
      type: "audio",
      data: "AAAA",
      mimeType: "audio/wav",
      _meta: {},
    })
    expect(result._meta).toEqual({})
  })

  it("EmbeddedResource accepts _meta", () => {
    const result = decode(Mcp.EmbeddedResource, {
      type: "resource",
      resource: { uri: "file:///a.txt", text: "content" },
      _meta: { embedded: true },
    })
    expect(result._meta).toEqual({ embedded: true })
  })
})

// =========================================================================
// Gap 2: ContentBlock vs SamplingMessageContentBlock
// =========================================================================

describe("ContentBlock", () => {
  it("accepts text, image, audio, embedded, resource_link", () => {
    decode(Mcp.ContentBlock, { type: "text", text: "hello" })
    decode(Mcp.ContentBlock, {
      type: "image",
      data: "AAAA",
      mimeType: "image/png",
    })
    decode(Mcp.ContentBlock, {
      type: "audio",
      data: "AAAA",
      mimeType: "audio/wav",
    })
    decode(Mcp.ContentBlock, {
      type: "resource",
      resource: { uri: "file:///a.txt", text: "hi" },
    })
    decode(Mcp.ContentBlock, {
      type: "resource_link",
      uri: "file:///b.txt",
      name: "b",
    })
  })

  it("rejects tool_use (belongs in SamplingMessageContentBlock)", () => {
    decodeFails(Mcp.ContentBlock, {
      type: "tool_use",
      id: "t1",
      name: "read",
      input: {},
    })
  })

  it("rejects tool_result (belongs in SamplingMessageContentBlock)", () => {
    decodeFails(Mcp.ContentBlock, {
      type: "tool_result",
      toolUseId: "t1",
      content: [],
    })
  })
})

describe("SamplingMessageContentBlock", () => {
  it("accepts text, image, audio, tool_use, tool_result", () => {
    decode(Mcp.SamplingMessageContentBlock, {
      type: "text",
      text: "hello",
    })
    decode(Mcp.SamplingMessageContentBlock, {
      type: "tool_use",
      id: "t1",
      name: "read",
      input: {},
    })
    decode(Mcp.SamplingMessageContentBlock, {
      type: "tool_result",
      toolUseId: "t1",
      content: [],
    })
  })

  it("rejects resource_link (belongs in ContentBlock)", () => {
    decodeFails(Mcp.SamplingMessageContentBlock, {
      type: "resource_link",
      uri: "file:///a.txt",
      name: "a",
    })
  })

  it("rejects embedded resource (belongs in ContentBlock)", () => {
    decodeFails(Mcp.SamplingMessageContentBlock, {
      type: "resource",
      resource: { uri: "file:///a.txt", text: "hi" },
    })
  })
})

// =========================================================================
// Gap 10 + 1: SamplingMessage and CreateMessageResult
// =========================================================================

describe("SamplingMessage", () => {
  it("decodes with single content block", () => {
    const result = decode(Mcp.SamplingMessage, {
      role: "user",
      content: { type: "text", text: "hello" },
    })
    expect(result.role).toBe("user")
  })

  it("decodes with array of content blocks", () => {
    const result = decode(Mcp.SamplingMessage, {
      role: "assistant",
      content: [
        { type: "text", text: "I'll call the tool" },
        { type: "tool_use", id: "t1", name: "read_file", input: {} },
      ],
    })
    expect(Array.isArray(result.content)).toBe(true)
  })

  it("decodes with _meta", () => {
    const result = decode(Mcp.SamplingMessage, {
      role: "user",
      content: { type: "text", text: "hi" },
      _meta: { turn: 3 },
    })
    expect(result._meta).toEqual({ turn: 3 })
  })
})

describe("CreateMessageResult", () => {
  it("decodes with content and role (required per spec)", () => {
    const result = decode(Mcp.CreateMessageResult, {
      content: { type: "text", text: "response text" },
      model: "claude-3-haiku",
      role: "assistant",
      stopReason: "end_turn",
    })
    expect(result.role).toBe("assistant")
    expect(result.model).toBe("claude-3-haiku")
  })

  it("decodes with array content", () => {
    const result = decode(Mcp.CreateMessageResult, {
      content: [
        { type: "text", text: "done" },
        {
          type: "tool_result",
          toolUseId: "t1",
          content: [{ type: "text", text: "file contents" }],
        },
      ],
      model: "claude-3-opus",
      role: "assistant",
    })
    expect(Array.isArray(result.content)).toBe(true)
  })

  it("rejects without content", () => {
    decodeFails(Mcp.CreateMessageResult, {
      model: "claude-3-haiku",
      role: "assistant",
    })
  })

  it("rejects without role", () => {
    decodeFails(Mcp.CreateMessageResult, {
      content: { type: "text", text: "hi" },
      model: "claude-3-haiku",
    })
  })
})

// =========================================================================
// Gap 4: task field on CallTool and CreateMessage
// =========================================================================

describe("CallTool payload", () => {
  it("decodes with task metadata", () => {
    const payload = {
      name: "read_file",
      arguments: { path: "/tmp/test.txt" },
      task: { ttl: 30000 },
    }
    const result = decode(Mcp.CallTool.payloadSchema, payload)
    expect(result.task).toEqual({ ttl: 30000 })
  })

  it("decodes without task (optional)", () => {
    const payload = {
      name: "read_file",
      arguments: { path: "/tmp/test.txt" },
    }
    const result = decode(Mcp.CallTool.payloadSchema, payload)
    expect(result.task).toBeUndefined()
  })
})

describe("CreateMessage payload", () => {
  it("decodes with task metadata", () => {
    const payload = {
      messages: [
        { role: "user", content: { type: "text", text: "hello" } },
      ],
      maxTokens: 1024,
      task: { ttl: 60000 },
    }
    const result = decode(Mcp.CreateMessage.payloadSchema, payload)
    expect(result.task).toEqual({ ttl: 60000 })
  })

  it("uses full Tool type (not SamplingTool)", () => {
    const payload = {
      messages: [
        { role: "user", content: { type: "text", text: "hello" } },
      ],
      maxTokens: 1024,
      tools: [
        {
          name: "read_file",
          inputSchema: {
            type: "object",
            properties: { path: { type: "string" } },
          },
          outputSchema: {
            type: "object",
            properties: { content: { type: "string" } },
          },
          execution: { taskSupport: "optional" },
          annotations: { readOnlyHint: true },
        },
      ],
    }
    const result = decode(Mcp.CreateMessage.payloadSchema, payload)
    expect(result.tools![0]!.name).toBe("read_file")
    expect(result.tools![0]!.outputSchema).toBeDefined()
    expect(result.tools![0]!.execution).toEqual({ taskSupport: "optional" })
  })
})

// =========================================================================
// Gap 3 + 9: Elicitation — form mode, URL mode, schema types
// =========================================================================

describe("Elicitation", () => {
  it("decodes form-mode payload (no explicit mode)", () => {
    const payload = {
      message: "Enter your API key",
      requestedSchema: {
        type: "object",
        properties: {
          apiKey: { type: "string", title: "API Key" },
        },
        required: ["apiKey"],
      },
    }
    const result = decode(Mcp.Elicit.payloadSchema, payload)
    expect(result).toHaveProperty("message", "Enter your API key")
    expect(result).toHaveProperty("requestedSchema")
  })

  it("decodes form-mode payload (explicit mode)", () => {
    const payload = {
      mode: "form",
      message: "Confirm settings",
      requestedSchema: {
        type: "object",
        properties: {
          confirm: { type: "boolean", default: true },
        },
      },
      task: { ttl: 10000 },
    }
    const result = decode(Mcp.Elicit.payloadSchema, payload)
    expect(result).toHaveProperty("task")
  })

  it("decodes URL-mode payload", () => {
    const payload = {
      mode: "url",
      elicitationId: "elicit-123",
      message: "Please authenticate",
      url: "https://auth.example.com/login?state=abc",
    }
    const result = decode(Mcp.Elicit.payloadSchema, payload)
    expect(result).toHaveProperty("url")
    expect(result).toHaveProperty("elicitationId", "elicit-123")
  })

  it("URL mode with task metadata", () => {
    const payload = {
      mode: "url",
      elicitationId: "e-456",
      message: "OAuth flow",
      url: "https://oauth.example.com/authorize",
      task: { ttl: 120000 },
    }
    const result = decode(Mcp.Elicit.payloadSchema, payload)
    expect(result).toHaveProperty("task")
  })
})

describe("PrimitiveSchemaDefinition", () => {
  it("decodes string schema", () => {
    const result = decode(Mcp.PrimitiveSchemaDefinition, {
      type: "string",
      title: "Name",
      minLength: 1,
      maxLength: 100,
    })
    expect(result.type).toBe("string")
  })

  it("decodes string schema with format", () => {
    const result = decode(Mcp.PrimitiveSchemaDefinition, {
      type: "string",
      format: "email",
      title: "Email Address",
    })
    expect(result).toHaveProperty("format", "email")
  })

  it("decodes number schema", () => {
    const result = decode(Mcp.PrimitiveSchemaDefinition, {
      type: "number",
      minimum: 0,
      maximum: 100,
      title: "Score",
    })
    expect(result.type).toBe("number")
  })

  it("decodes integer schema", () => {
    const result = decode(Mcp.PrimitiveSchemaDefinition, {
      type: "integer",
      minimum: 1,
      maximum: 10,
    })
    expect(result.type).toBe("integer")
  })

  it("decodes boolean schema", () => {
    const result = decode(Mcp.PrimitiveSchemaDefinition, {
      type: "boolean",
      title: "Enable feature",
      default: false,
    })
    expect(result.type).toBe("boolean")
  })

  it("decodes untitled enum schema", () => {
    const result = decode(Mcp.PrimitiveSchemaDefinition, {
      type: "string",
      enum: ["small", "medium", "large"],
      default: "medium",
    })
    expect(result).toHaveProperty("enum")
  })

  it("decodes titled enum schema (oneOf)", () => {
    const result = decode(Mcp.PrimitiveSchemaDefinition, {
      type: "string",
      oneOf: [
        { const: "sm", title: "Small" },
        { const: "md", title: "Medium" },
        { const: "lg", title: "Large" },
      ],
    })
    expect(result).toHaveProperty("oneOf")
  })

  it("decodes multi-select enum schema", () => {
    const result = decode(Mcp.PrimitiveSchemaDefinition, {
      type: "array",
      items: {
        type: "string",
        enum: ["read", "write", "admin"],
      },
      minItems: 1,
    })
    expect(result.type).toBe("array")
  })
})

// =========================================================================
// Gap 12: SamplingTool replaced by Tool
// =========================================================================

describe("SamplingTool removal", () => {
  it("SamplingTool is not exported", () => {
    expect(
      (Mcp as Record<string, unknown>)["SamplingTool"]
    ).toBeUndefined()
  })
})

// =========================================================================
// Round-trip: encode then decode preserves structure
// =========================================================================

describe("round-trip", () => {
  it("Resource round-trips with all fields", () => {
    const original = Mcp.Resource.make({
      uri: "file:///test.txt",
      name: "test",
      title: "Test File",
      description: "A test file",
      mimeType: "text/plain",
      annotations: { priority: 0.9, lastModified: "2025-06-01T00:00:00Z" },
      icons: [{ src: "https://example.com/icon.png" }],
      size: 1024,
      _meta: { custom: "data" },
    })
    const encoded = encode(Mcp.Resource, original)
    const decoded = decode(Mcp.Resource, encoded)
    expect(decoded.uri).toBe(original.uri)
    expect(decoded.annotations?.lastModified).toBe("2025-06-01T00:00:00Z")
    expect(decoded.icons).toHaveLength(1)
    expect(decoded._meta).toEqual({ custom: "data" })
  })

  it("Tool round-trips with _meta and execution", () => {
    const original = Mcp.Tool.make({
      name: "search",
      inputSchema: { type: "object", properties: {} },
      outputSchema: { type: "object", properties: {} },
      execution: { taskSupport: "optional" },
      _meta: { category: "search" },
      icons: [{ src: "data:image/svg+xml;base64,PHN2Zz4=" }],
    })
    const encoded = encode(Mcp.Tool, original)
    const decoded = decode(Mcp.Tool, encoded)
    expect(decoded._meta).toEqual({ category: "search" })
    expect(decoded.execution?.taskSupport).toBe("optional")
  })

  it("Implementation round-trips with new fields", () => {
    const original = {
      name: "my-server",
      version: "2.0.0",
      description: "My MCP server",
      websiteUrl: "https://example.com",
      icons: [
        { src: "https://example.com/logo.png", theme: "light" as const },
      ],
    }
    const decoded = decode(Mcp.Implementation, original)
    const encoded = encode(Mcp.Implementation, decoded)
    const roundTripped = decode(Mcp.Implementation, encoded)
    expect(roundTripped.description).toBe("My MCP server")
    expect(roundTripped.websiteUrl).toBe("https://example.com")
    expect(roundTripped.icons![0]!.theme).toBe("light")
  })
})

// =========================================================================
// HIGH RISK: Initialize handshake
// =========================================================================

describe("Initialize handshake", () => {
  it("decodes InitializeResult (minimal server response)", () => {
    const result = decode(Mcp.InitializeResult, {
      protocolVersion: "2025-11-25",
      capabilities: {},
      serverInfo: { name: "test-server", version: "1.0.0" },
    })
    expect(result.protocolVersion).toBe("2025-11-25")
    expect(result.serverInfo.name).toBe("test-server")
  })

  it("decodes InitializeResult with full capabilities", () => {
    const result = decode(Mcp.InitializeResult, {
      protocolVersion: "2025-11-25",
      capabilities: {
        tools: { listChanged: true },
        resources: { subscribe: true, listChanged: true },
        prompts: { listChanged: false },
        logging: {},
        completions: {},
        tasks: {
          list: {},
          cancel: {},
          requests: { tools: { call: {} } },
        },
      },
      serverInfo: {
        name: "full-server",
        version: "2.0.0",
        description: "Full featured",
        websiteUrl: "https://example.com",
      },
      instructions: "Use tools carefully.",
    })
    expect(result.capabilities.tools?.listChanged).toBe(true)
    expect(result.capabilities.resources?.subscribe).toBe(true)
    expect(result.capabilities.tasks?.cancel).toBeDefined()
    expect(result.instructions).toBe("Use tools carefully.")
  })

  it("decodes Initialize payload (client request)", () => {
    const payload = {
      protocolVersion: "2025-11-25",
      capabilities: {
        roots: { listChanged: true },
        sampling: { tools: {} },
        elicitation: {},
        tasks: {
          list: {},
          cancel: {},
          requests: {
            sampling: { createMessage: {} },
            elicitation: { create: {} },
          },
        },
      },
      clientInfo: { name: "test-client", version: "0.1.0" },
    }
    const result = decode(Mcp.Initialize.payloadSchema, payload)
    expect(result.protocolVersion).toBe("2025-11-25")
    expect(result.capabilities.roots?.listChanged).toBe(true)
    expect(result.capabilities.sampling?.tools).toBeDefined()
    expect(result.clientInfo.name).toBe("test-client")
  })

  it("rejects InitializeResult without protocolVersion", () => {
    decodeFails(Mcp.InitializeResult, {
      capabilities: {},
      serverInfo: { name: "test", version: "1.0.0" },
    })
  })

  it("rejects InitializeResult without serverInfo", () => {
    decodeFails(Mcp.InitializeResult, {
      protocolVersion: "2025-11-25",
      capabilities: {},
    })
  })

  it("rejects Initialize payload without clientInfo", () => {
    decodeFails(Mcp.Initialize.payloadSchema, {
      protocolVersion: "2025-11-25",
      capabilities: {},
    })
  })
})

// =========================================================================
// HIGH RISK: Notifications — silent failure if schema is wrong
// =========================================================================

describe("Notifications", () => {
  it("decodes LoggingMessageNotification with string data", () => {
    const result = decode(Mcp.LoggingMessageNotification.payloadSchema, {
      level: "error",
      logger: "db",
      data: "connection failed",
    })
    expect(result.level).toBe("error")
    expect(result.logger).toBe("db")
    expect(result.data).toBe("connection failed")
  })

  it("decodes LoggingMessageNotification with object data", () => {
    const result = decode(Mcp.LoggingMessageNotification.payloadSchema, {
      level: "info",
      data: { query: "SELECT 1", duration: 42 },
    })
    expect(result.data).toEqual({ query: "SELECT 1", duration: 42 })
  })

  it("rejects LoggingMessageNotification with invalid level", () => {
    decodeFails(Mcp.LoggingMessageNotification.payloadSchema, {
      level: "trace",
      data: "test",
    })
  })

  it("decodes CancelledNotification with numeric id", () => {
    const result = decode(Mcp.CancelledNotification.payloadSchema, {
      requestId: 42,
      reason: "user cancelled",
    })
    expect(result.requestId).toBe(42)
    expect(result.reason).toBe("user cancelled")
  })

  it("decodes CancelledNotification with string id", () => {
    const result = decode(Mcp.CancelledNotification.payloadSchema, {
      requestId: "req-abc",
    })
    expect(result.requestId).toBe("req-abc")
  })

  it("decodes ProgressNotification", () => {
    const result = decode(Mcp.ProgressNotification.payloadSchema, {
      progressToken: "tok-1",
      progress: 50,
      total: 100,
      message: "Processing...",
    })
    expect(result.progressToken).toBe("tok-1")
    expect(result.progress).toBe(50)
    expect(result.total).toBe(100)
  })

  it("decodes ProgressNotification with numeric token", () => {
    const result = decode(Mcp.ProgressNotification.payloadSchema, {
      progressToken: 7,
    })
    expect(result.progressToken).toBe(7)
  })

  it("decodes TaskStatusNotification", () => {
    const result = decode(Mcp.TaskStatusNotification.payloadSchema, {
      taskId: "task-123",
      status: "working",
      createdAt: "2025-01-01T00:00:00Z",
      lastUpdatedAt: "2025-01-01T00:01:00Z",
      ttl: 30000,
    })
    expect(result.taskId).toBe("task-123")
    expect(result.status).toBe("working")
    expect(result.ttl).toBe(30000)
  })

  it("decodes TaskStatusNotification with null ttl", () => {
    const result = decode(Mcp.TaskStatusNotification.payloadSchema, {
      taskId: "task-456",
      status: "completed",
      createdAt: "2025-01-01T00:00:00Z",
      lastUpdatedAt: "2025-01-01T00:02:00Z",
      ttl: null,
    })
    expect(result.ttl).toBeNull()
  })

  it("decodes ResourceUpdatedNotification", () => {
    const result = decode(Mcp.ResourceUpdatedNotification.payloadSchema, {
      uri: "file:///data/config.json",
    })
    expect(result.uri).toBe("file:///data/config.json")
  })

  it("decodes simple notifications (undefined payload)", () => {
    decode(Mcp.ResourceListChangedNotification.payloadSchema, undefined)
    decode(Mcp.ToolListChangedNotification.payloadSchema, undefined)
    decode(Mcp.PromptListChangedNotification.payloadSchema, undefined)
    decode(Mcp.InitializedNotification.payloadSchema, undefined)
    decode(Mcp.RootsListChangedNotification.payloadSchema, undefined)
  })

  it("simple notifications accept _meta", () => {
    const withMeta = { _meta: { source: "test" } }
    decode(Mcp.ResourceListChangedNotification.payloadSchema, withMeta)
    decode(Mcp.ToolListChangedNotification.payloadSchema, withMeta)
    decode(Mcp.PromptListChangedNotification.payloadSchema, withMeta)
    decode(Mcp.InitializedNotification.payloadSchema, withMeta)
    decode(Mcp.RootsListChangedNotification.payloadSchema, withMeta)
  })
})

// =========================================================================
// HIGH RISK: McpError — dropping error responses silently
// =========================================================================

describe("McpError", () => {
  it("decodes with code and message", () => {
    const result = decode(Mcp.McpError, {
      code: -32600,
      message: "Invalid request",
    })
    expect(result.code).toBe(-32600)
    expect(result.message).toBe("Invalid request")
  })

  it("decodes with data field", () => {
    const result = decode(Mcp.McpError, {
      code: -32603,
      message: "Internal error",
      data: { stack: "Error at line 42" },
    })
    expect(result.data).toEqual({ stack: "Error at line 42" })
  })

  it("rejects without code", () => {
    decodeFails(Mcp.McpError, { message: "missing code" })
  })

  it("rejects without message", () => {
    decodeFails(Mcp.McpError, { code: -32600 })
  })
})

describe("Typed error subclasses", () => {
  it("ParseError has code -32700", () => {
    const err = new Mcp.ParseError({ message: "bad JSON" })
    expect(err.code).toBe(-32700)
    expect(err.message).toBe("bad JSON")
  })

  it("InvalidRequest has code -32600", () => {
    const err = new Mcp.InvalidRequest({ message: "bad request" })
    expect(err.code).toBe(-32600)
  })

  it("MethodNotFound has code -32601", () => {
    const err = new Mcp.MethodNotFound({ message: "unknown method" })
    expect(err.code).toBe(-32601)
  })

  it("InvalidParams has code -32602", () => {
    const err = new Mcp.InvalidParams({ message: "bad params" })
    expect(err.code).toBe(-32602)
  })

  it("InternalError has code -32603", () => {
    const err = new Mcp.InternalError({ message: "server crash" })
    expect(err.code).toBe(-32603)
  })

  it("InternalError.notImplemented is predefined", () => {
    expect(Mcp.InternalError.notImplemented.message).toBe(
      "Not implemented"
    )
    expect(Mcp.InternalError.notImplemented.code).toBe(-32603)
  })
})

// =========================================================================
// HIGH RISK: ContentBlock propagation through CallToolResult, PromptMessage
// =========================================================================

describe("ContentBlock propagation", () => {
  it("CallToolResult accepts ResourceLink", () => {
    const result = decode(Mcp.CallToolResult, {
      content: [
        { type: "resource_link", uri: "file:///a.txt", name: "a" },
      ],
    })
    expect(result.content).toHaveLength(1)
  })

  it("CallToolResult accepts EmbeddedResource", () => {
    const result = decode(Mcp.CallToolResult, {
      content: [
        {
          type: "resource",
          resource: { uri: "file:///a.txt", text: "content" },
        },
      ],
    })
    expect(result.content).toHaveLength(1)
  })

  it("CallToolResult accepts mixed content types", () => {
    const result = decode(Mcp.CallToolResult, {
      content: [
        { type: "text", text: "File contents:" },
        {
          type: "resource",
          resource: { uri: "file:///a.txt", text: "hello" },
        },
        { type: "resource_link", uri: "file:///b.txt", name: "b" },
      ],
    })
    expect(result.content).toHaveLength(3)
  })

  it("CallToolResult rejects ToolUseContent", () => {
    decodeFails(Mcp.CallToolResult, {
      content: [
        { type: "tool_use", id: "t1", name: "read", input: {} },
      ],
    })
  })

  it("CallToolResult rejects ToolResultContent", () => {
    decodeFails(Mcp.CallToolResult, {
      content: [
        { type: "tool_result", toolUseId: "t1", content: [] },
      ],
    })
  })

  it("PromptMessage accepts EmbeddedResource", () => {
    const result = decode(Mcp.PromptMessage, {
      role: "user",
      content: {
        type: "resource",
        resource: { uri: "file:///a.txt", text: "content" },
      },
    })
    expect(result.content.type).toBe("resource")
  })

  it("PromptMessage accepts ResourceLink", () => {
    const result = decode(Mcp.PromptMessage, {
      role: "assistant",
      content: {
        type: "resource_link",
        uri: "file:///b.txt",
        name: "b",
      },
    })
    expect(result.content.type).toBe("resource_link")
  })

  it("PromptMessage rejects ToolUseContent", () => {
    decodeFails(Mcp.PromptMessage, {
      role: "assistant",
      content: {
        type: "tool_use",
        id: "t1",
        name: "read",
        input: {},
      },
    })
  })

  it("PromptMessage rejects ToolResultContent", () => {
    decodeFails(Mcp.PromptMessage, {
      role: "user",
      content: {
        type: "tool_result",
        toolUseId: "t1",
        content: [],
      },
    })
  })
})

// =========================================================================
// HIGH RISK: ResourceContents _meta propagation
// =========================================================================

describe("ResourceContents _meta propagation", () => {
  it("TextResourceContents inherits _meta", () => {
    const result = decode(Mcp.TextResourceContents, {
      uri: "file:///test.txt",
      text: "hello",
      _meta: { encoding: "utf-8" },
    })
    expect(result._meta).toEqual({ encoding: "utf-8" })
  })

  it("BlobResourceContents inherits _meta", () => {
    const result = decode(Mcp.BlobResourceContents, {
      uri: "file:///test.bin",
      blob: "AAAA",
      _meta: { compressed: true },
    })
    expect(result._meta).toEqual({ compressed: true })
  })

  it("ReadResourceResult contents carry _meta", () => {
    const result = decode(Mcp.ReadResourceResult, {
      contents: [
        {
          uri: "file:///a.txt",
          text: "content",
          _meta: { version: 2 },
        },
      ],
    })
    expect(result.contents[0]!._meta).toEqual({ version: 2 })
  })
})

// =========================================================================
// HIGH RISK: ElicitResult — outgoing response from client
// =========================================================================

describe("ElicitResult", () => {
  it("decodes accept action with content", () => {
    const result = decode(Mcp.ElicitResult, {
      action: "accept",
      content: { apiKey: "sk-123" },
    })
    expect(result.action).toBe("accept")
  })

  it("decodes decline action", () => {
    const result = decode(Mcp.ElicitResult, {
      action: "decline",
    })
    expect(result.action).toBe("decline")
  })

  it("decodes cancel action", () => {
    const result = decode(Mcp.ElicitResult, {
      action: "cancel",
    })
    expect(result.action).toBe("cancel")
  })

  it("rejects unknown action", () => {
    decodeFails(Mcp.ElicitResult, {
      action: "retry",
    })
  })
})

// =========================================================================
// HIGH RISK: SamplingMessage edge cases
// =========================================================================

describe("SamplingMessage edge cases", () => {
  it("decodes empty content array", () => {
    const result = decode(Mcp.SamplingMessage, {
      role: "assistant",
      content: [],
    })
    expect(Array.isArray(result.content)).toBe(true)
  })

  it("rejects single resource_link content (wrong union)", () => {
    decodeFails(Mcp.SamplingMessage, {
      role: "user",
      content: {
        type: "resource_link",
        uri: "file:///a.txt",
        name: "a",
      },
    })
  })

  it("rejects resource_link in content array", () => {
    decodeFails(Mcp.SamplingMessage, {
      role: "user",
      content: [
        { type: "resource_link", uri: "file:///a.txt", name: "a" },
      ],
    })
  })

  it("rejects embedded resource in content array", () => {
    decodeFails(Mcp.SamplingMessage, {
      role: "user",
      content: [
        {
          type: "resource",
          resource: { uri: "file:///a.txt", text: "hi" },
        },
      ],
    })
  })

  it("CreateMessageResult accepts empty content array", () => {
    const result = decode(Mcp.CreateMessageResult, {
      content: [],
      model: "claude-3-haiku",
      role: "assistant",
    })
    expect(Array.isArray(result.content)).toBe(true)
  })
})
