import assert from "node:assert/strict"
import path from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"
import { test } from "node:test"
import { Effect, Either } from "effect"

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..")
let api
try {
  api = await import(pathToFileURL(path.join(root, "dist/transport/HttpMetadata.js")).href)
} catch {
  api = undefined
}

const requireApi = () => {
  assert.notEqual(api, undefined, "modern HTTP metadata kernel is missing")
  return api
}

const request = (method, params = {}) => ({
  _tag: "Request",
  jsonrpc: "2.0",
  id: "metadata",
  method,
  params: {
    ...params,
    _meta: {
      "io.modelcontextprotocol/protocolVersion": "2026-07-28",
      "io.modelcontextprotocol/clientCapabilities": {}
    }
  }
})

test("HTTP metadata values use exact plain and base64-sentinel encoding", async () => {
  const metadata = requireApi()
  const cases = [
    ["", ""],
    ["us-west1", "us-west1"],
    ["hello world", "hello world"],
    ["hello\tworld", "hello\tworld"],
    ["Hello, 世界", "=?base64?SGVsbG8sIOS4lueVjA==?="],
    [" padded ", "=?base64?IHBhZGRlZCA=?="],
    ["\tpadded", "=?base64?CXBhZGRlZA==?="],
    ["line1\nline2", "=?base64?bGluZTEKbGluZTI=?="],
    ["line1\rline2", "=?base64?bGluZTENbGluZTI=?="],
    ["=?base64?literal?=", "=?base64?PT9iYXNlNjQ/bGl0ZXJhbD89?="]
  ]

  for (const [plain, encoded] of cases) {
    assert.equal(metadata.encodeHeaderValue(plain), encoded, plain)
    assert.equal(await Effect.runPromise(metadata.decodeHeaderValue(encoded)), plain, plain)
  }
})

test("HTTP metadata decoding rejects malformed sentinels, unsafe plain values, and invalid UTF-8", async () => {
  const metadata = requireApi()
  const invalid = [
    " leading",
    "trailing ",
    "line1\nline2",
    "é",
    "=?base64?***?=",
    "=?base64?YQ?=",
    "=?base64?YQ===?=",
    "=?base64?YWI?=",
    "=?base64?/w==?="
  ]

  for (const value of invalid) {
    const result = await Effect.runPromise(metadata.decodeHeaderValue(value).pipe(Effect.either))
    assert.equal(Either.isLeft(result), true, value)
    assert.equal(result.left._tag, "HeaderMismatchError", value)
    assert.equal(result.left.code, -32020, value)
  }

  assert.equal(
    await Effect.runPromise(metadata.decodeHeaderValue("=?Base64?literal?=")),
    "=?Base64?literal?="
  )
})

test("generated request descriptors produce only the required standard HTTP headers", async () => {
  const metadata = requireApi()
  const cases = [
    [request("server/discover"), undefined],
    [request("tools/list"), undefined],
    [request("tools/call", { name: "echo", arguments: {} }), "echo"],
    [request("prompts/get", { name: "Hello, 世界" }), "=?base64?SGVsbG8sIOS4lueVjA==?="],
    [request("resources/read", { uri: "file:///one" }), "file:///one"]
  ]

  for (const [message, name] of cases) {
    const headers = await Effect.runPromise(metadata.standardRequestHeaders(message))
    assert.equal(headers["MCP-Protocol-Version"], "2026-07-28")
    assert.equal(headers["Mcp-Method"], message.method)
    assert.equal(headers["Mcp-Name"], name)
    assert.deepEqual(
      Object.keys(headers).sort(),
      name === undefined
        ? ["MCP-Protocol-Version", "Mcp-Method"].sort()
        : ["MCP-Protocol-Version", "Mcp-Method", "Mcp-Name"].sort()
    )
  }
})

test("standard HTTP metadata validation is header-name insensitive and value sensitive", async () => {
  const metadata = requireApi()
  const message = request("tools/call", { name: "echo", arguments: {} })
  await Effect.runPromise(metadata.validateStandardRequestHeaders(message, {
    "mcp-protocol-version": "2026-07-28",
    "MCP-METHOD": "tools/call",
    "mCp-NaMe": "echo"
  }))

  const invalid = [
    {},
    { "MCP-Protocol-Version": "2026-07-28", "Mcp-Method": "Tools/call", "Mcp-Name": "echo" },
    { "MCP-Protocol-Version": "2026-07-28", "Mcp-Method": "tools/call", "Mcp-Name": "Echo" },
    { "MCP-Protocol-Version": "2026-07-27", "Mcp-Method": "tools/call", "Mcp-Name": "echo" },
    { "MCP-Protocol-Version": "2026-07-28", "Mcp-Method": "tools/call" }
  ]
  for (const headers of invalid) {
    const result = await Effect.runPromise(
      metadata.validateStandardRequestHeaders(message, headers).pipe(Effect.either)
    )
    assert.equal(Either.isLeft(result), true)
    assert.equal(result.left._tag, "HeaderMismatchError")
  }

  const unexpectedName = await Effect.runPromise(metadata.validateStandardRequestHeaders(
    request("tools/list"),
    {
      "MCP-Protocol-Version": "2026-07-28",
      "Mcp-Method": "tools/list",
      "Mcp-Name": "unexpected"
    }
  ).pipe(Effect.either))
  assert.equal(Either.isLeft(unexpectedName), true)
})

const annotatedTool = {
  name: "deploy",
  inputSchema: {
    type: "object",
    properties: {
      region: { type: "string", "x-mcp-header": "Region" },
      enabled: { type: "boolean", "x-mcp-header": "Enabled" },
      attempts: { type: "integer", "x-mcp-header": "Attempts" },
      options: {
        type: "object",
        properties: {
          trace: { type: "string", "x-mcp-header": "Trace_ID" }
        }
      }
    }
  }
}

const analyze = async (tool = annotatedTool) =>
  Effect.runPromise(requireApi().analyzeToolHeaders(tool))

const expectInvalidTool = async (inputSchema) => {
  const result = await Effect.runPromise(requireApi().analyzeToolHeaders({
    name: "invalid-tool",
    inputSchema
  }).pipe(Effect.either))
  assert.equal(Either.isLeft(result), true)
  assert.equal(result.left._tag, "InvalidToolHeaderDefinition")
  assert.equal(result.left.toolName, "invalid-tool")
  assert.equal(typeof result.left.reason, "string")
}

test("tool header analysis accepts only unique tchar names on pure property chains", async () => {
  const plan = await analyze()
  assert.deepEqual(plan, {
    toolName: "deploy",
    bindings: [
      { path: ["region"], name: "Region", headerName: "Mcp-Param-Region", valueType: "string" },
      { path: ["enabled"], name: "Enabled", headerName: "Mcp-Param-Enabled", valueType: "boolean" },
      { path: ["attempts"], name: "Attempts", headerName: "Mcp-Param-Attempts", valueType: "integer" },
      { path: ["options", "trace"], name: "Trace_ID", headerName: "Mcp-Param-Trace_ID", valueType: "string" }
    ]
  })

  for (const name of ["", "has space", "bad:name", "bad\tname", "é", "line\nname"]) {
    await expectInvalidTool({
      type: "object",
      properties: { value: { type: "string", "x-mcp-header": name } }
    })
  }

  await expectInvalidTool({
    type: "object",
    properties: {
      first: { type: "string", "x-mcp-header": "Trace" },
      second: { type: "string", "x-mcp-header": "TRACE" }
    }
  })
})

test("tool header analysis rejects unsupported values and annotations outside pure properties", async () => {
  for (const schema of [
    { type: "object", "x-mcp-header": "Root" },
    { type: "object", properties: { value: { type: "number", "x-mcp-header": "Value" } } },
    { type: "object", properties: { value: { type: "null", "x-mcp-header": "Value" } } },
    { type: "object", properties: { value: { type: "array", "x-mcp-header": "Value" } } },
    { type: "object", properties: { value: { type: "object", "x-mcp-header": "Value" } } },
    { type: "object", properties: { value: { type: ["string", "null"], "x-mcp-header": "Value" } } },
    { type: "object", properties: { value: { oneOf: [{ type: "string", "x-mcp-header": "Value" }] } } },
    { type: "object", properties: { value: { anyOf: [{ type: "string", "x-mcp-header": "Value" }] } } },
    { type: "object", properties: { value: { allOf: [{ type: "string", "x-mcp-header": "Value" }] } } },
    { type: "object", properties: { value: { not: { type: "string", "x-mcp-header": "Value" } } } },
    { type: "object", properties: { value: { if: { type: "string", "x-mcp-header": "Value" } } } },
    { type: "object", properties: { value: { then: { type: "string", "x-mcp-header": "Value" } } } },
    { type: "object", properties: { value: { else: { type: "string", "x-mcp-header": "Value" } } } },
    { type: "object", properties: { value: { $ref: "#/$defs/value", "x-mcp-header": "Value" } } },
    { type: "object", properties: { values: { type: "array", items: { type: "string", "x-mcp-header": "Value" } } } },
    { type: "object", $defs: { value: { type: "string", "x-mcp-header": "Value" } } }
  ]) {
    await expectInvalidTool(schema)
  }

  let accessorCalled = false
  const accessorSchema = { type: "object" }
  Object.defineProperty(accessorSchema, "unknown-keyword", {
    enumerable: true,
    get() {
      accessorCalled = true
      return { "x-mcp-header": "Hidden", type: "string" }
    }
  })
  await expectInvalidTool(accessorSchema)
  assert.equal(accessorCalled, false)
})

test("tool header extraction encodes nested scalar values and omits missing or null data", async () => {
  const metadata = requireApi()
  const plan = await analyze()
  assert.deepEqual(await Effect.runPromise(metadata.extractToolHeaders(plan, {
    region: "Hello, 世界",
    enabled: false,
    attempts: -12,
    options: { trace: "a b" }
  })), {
    "Mcp-Param-Region": "=?base64?SGVsbG8sIOS4lueVjA==?=",
    "Mcp-Param-Enabled": "false",
    "Mcp-Param-Attempts": "-12",
    "Mcp-Param-Trace_ID": "a b"
  })
  assert.deepEqual(await Effect.runPromise(metadata.extractToolHeaders(plan, {
    region: null,
    options: {}
  })), {})

  for (const argumentsValue of [
    { region: 42 },
    { enabled: "false" },
    { attempts: 1.5 },
    { attempts: Number.MAX_SAFE_INTEGER + 1 }
  ]) {
    const result = await Effect.runPromise(
      metadata.extractToolHeaders(plan, argumentsValue).pipe(Effect.either)
    )
    assert.equal(Either.isLeft(result), true)
    assert.equal(result.left._tag, "HeaderMismatchError")
    assert.equal(result.left.code, -32020)
  }
})

test("tool header validation compares strings and booleans exactly and integers numerically", async () => {
  const metadata = requireApi()
  const plan = await analyze()
  const argumentsValue = {
    region: "us-west1",
    enabled: true,
    attempts: 42,
    options: { trace: null }
  }
  await Effect.runPromise(metadata.validateToolHeaders(plan, argumentsValue, {
    "mcp-param-region": "us-west1",
    "MCP-PARAM-ENABLED": "true",
    "Mcp-Param-Attempts": "42.0",
    "Unrelated": "ignored"
  }))

  const invalid = [
    { "Mcp-Param-Enabled": "true", "Mcp-Param-Attempts": "42" },
    { "Mcp-Param-Region": "US-WEST1", "Mcp-Param-Enabled": "true", "Mcp-Param-Attempts": "42" },
    { "Mcp-Param-Region": "us-west1", "Mcp-Param-Enabled": "TRUE", "Mcp-Param-Attempts": "42" },
    { "Mcp-Param-Region": "us-west1", "Mcp-Param-Enabled": "true", "Mcp-Param-Attempts": "42x" },
    { "Mcp-Param-Region": "us-west1", "Mcp-Param-Enabled": "true", "Mcp-Param-Attempts": "9007199254740992" },
    { "Mcp-Param-Region": "us-west1", "Mcp-Param-Enabled": "true", "Mcp-Param-Attempts": "43" },
    { "Mcp-Param-Region": "us-west1", "Mcp-Param-Enabled": "true", "Mcp-Param-Attempts": "42", "Mcp-Param-Trace_ID": "unexpected" },
    { "Mcp-Param-Region": "=?base64?***?=", "Mcp-Param-Enabled": "true", "Mcp-Param-Attempts": "42" }
  ]
  for (const headers of invalid) {
    const result = await Effect.runPromise(
      metadata.validateToolHeaders(plan, argumentsValue, headers).pipe(Effect.either)
    )
    assert.equal(Either.isLeft(result), true)
    assert.equal(result.left._tag, "HeaderMismatchError")
    assert.equal(result.left.code, -32020)
  }
})

test("tool integer header comparison is exact and never relies on floating-point rounding", async () => {
  const metadata = requireApi()
  const plan = await analyze()

  for (const header of ["42", "42.0", "4.2e1", "420e-1"]) {
    await Effect.runPromise(metadata.validateToolHeaders(plan, { attempts: 42 }, {
      "Mcp-Param-Attempts": header
    }))
  }

  for (const [body, header] of [
    [42, "42.0000000000000000000001"],
    [Number.MAX_SAFE_INTEGER, "9007199254740990.9999999999999999"],
    [Number.MIN_SAFE_INTEGER, "-9007199254740990.9999999999999999"],
    [42, "42e999999"]
  ]) {
    const result = await Effect.runPromise(metadata.validateToolHeaders(plan, { attempts: body }, {
      "Mcp-Param-Attempts": header
    }).pipe(Effect.either))
    assert.equal(Either.isLeft(result), true, header)
    assert.equal(result.left._tag, "HeaderMismatchError", header)
    assert.equal(result.left.code, -32020, header)
  }
})

test("HTTP tool filtering excludes invalid definitions and emits structured safe warnings", async () => {
  const metadata = requireApi()
  const plainTool = {
    name: "plain",
    inputSchema: {
      type: "object",
      oneOf: [{ properties: { value: { type: "string" } } }]
    }
  }
  const invalidName = {
    name: "invalid-name",
    description: "must not leak: synthetic-secret",
    inputSchema: {
      type: "object",
      properties: { value: { type: "string", "x-mcp-header": "bad name" } }
    }
  }
  const invalidType = {
    name: "invalid-type",
    inputSchema: {
      type: "object",
      properties: { value: { type: "number", "x-mcp-header": "Value" } }
    }
  }
  const tools = [annotatedTool, invalidName, plainTool, invalidType]
  const warnings = []
  const catalog = await Effect.runPromise(metadata.filterHttpTools(
    tools,
    (warning) => Effect.sync(() => warnings.push(warning))
  ))

  assert.deepEqual(catalog.tools.map(({ name }) => name), ["deploy", "plain"])
  assert.equal(catalog.tools[0], annotatedTool)
  assert.equal(catalog.tools[1], plainTool)
  assert.deepEqual(Object.keys(catalog.plans), ["deploy", "plain"])
  assert.equal(catalog.plans.deploy.bindings.length, 4)
  assert.deepEqual(catalog.plans.plain.bindings, [])
  assert.equal(Object.isFrozen(catalog.plans), true)
  assert.throws(() => {
    catalog.plans.deploy = catalog.plans.plain
  }, TypeError)
  assert.deepEqual(warnings, [
    {
      _tag: "InvalidHttpToolHeader",
      toolName: "invalid-name",
      reason: "invalid-header-name"
    },
    {
      _tag: "InvalidHttpToolHeader",
      toolName: "invalid-type",
      reason: "unsupported-property-type"
    }
  ])
  assert.equal(JSON.stringify(warnings).includes("synthetic-secret"), false)
  assert.deepEqual(tools.map(({ name }) => name), [
    "deploy",
    "invalid-name",
    "plain",
    "invalid-type"
  ])

  const sinkFailure = await Effect.runPromise(metadata.filterHttpTools(
    [invalidName],
    () => Effect.fail("warning-sink-failed")
  ).pipe(Effect.either))
  assert.equal(Either.isLeft(sinkFailure), true)
  assert.equal(sinkFailure.left, "warning-sink-failed")
})
