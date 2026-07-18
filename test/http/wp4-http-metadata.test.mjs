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
