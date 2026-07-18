import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import path from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"
import { test } from "node:test"
import { Either, Schema } from "effect"

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..")
const wirePath = path.join(root, "dist/McpWire.js")
const serializationPath = path.join(root, "dist/McpSerialization.js")
const generatedPath = path.join(root, "dist/generated/mcp/2026-07-28/McpSchema.generated.js")

let wire
let wireLoadError
try {
  wire = await import(pathToFileURL(wirePath).href)
} catch (error) {
  wireLoadError = error
}

const requireWire = () => {
  assert.ifError(wireLoadError)
  assert.ok(wire, "McpWire module must exist")
  return wire
}

const right = (either) => {
  assert.equal(either._tag, "Right", either._tag === "Left" ? JSON.stringify(either.left) : undefined)
  return either.right
}

const leftTag = (either) => {
  assert.equal(either._tag, "Left")
  return either.left._tag
}

test("JsonRpcId preserves strings and integers and rejects every invalid ID class", () => {
  const { JsonRpcId } = requireWire()
  for (const value of ["001", "", "0", 0, -1, Number.MAX_SAFE_INTEGER]) {
    const decoded = Schema.decodeUnknownEither(JsonRpcId)(value)
    assert.equal(Either.isRight(decoded), true, String(value))
    assert.strictEqual(decoded.right, value)
    assert.strictEqual(Schema.encodeSync(JsonRpcId)(decoded.right), value)
  }
  for (const value of [null, true, false, [], {}, Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY, 1.5]) {
    assert.equal(Either.isLeft(Schema.decodeUnknownEither(JsonRpcId)(value)), true, String(value))
  }
})

test("request, success, and error envelopes preserve ID runtime types bidirectionally", () => {
  const api = requireWire()
  const messages = [
    { jsonrpc: "2.0", id: "001", method: "fixture/method", params: {} },
    { jsonrpc: "2.0", id: 0, method: "fixture/method" },
    { jsonrpc: "2.0", id: -1, result: { resultType: "complete" } },
    { jsonrpc: "2.0", id: "", error: { code: -32603, message: "failed", data: { retryable: false } } }
  ]
  for (const message of messages) {
    const decoded = right(api.decodeJsonRpc(message))
    assert.strictEqual(decoded.id, message.id)
    const text = right(api.encodeJsonRpcText(decoded))
    const roundTrip = right(api.decodeJsonRpcText(text))
    assert.strictEqual(roundTrip.id, message.id)
    assert.deepEqual(JSON.parse(text), message)
  }
})

test("notifications are identified only by ID absence", () => {
  const api = requireWire()
  const notification = right(api.decodeJsonRpc({
    jsonrpc: "2.0",
    method: "notifications/cancelled",
    params: { requestId: 1 }
  }))
  assert.equal(notification._tag, "Notification")
  assert.equal(Object.hasOwn(notification, "id"), false)

  for (const id of ["", 0]) {
    const request = right(api.decodeJsonRpc({
      jsonrpc: "2.0",
      id,
      method: "notifications/cancelled",
      params: { requestId: 1 }
    }))
    assert.equal(request._tag, "Request")
    assert.strictEqual(request.id, id)
  }
})

test("malformed JSON, batches, invalid envelopes, and ambiguous responses fail with typed errors", () => {
  const api = requireWire()
  assert.equal(leftTag(api.decodeJsonRpcText("{")), "ParseError")
  assert.equal(leftTag(api.decodeJsonRpc([])), "InvalidRequest")
  assert.equal(leftTag(api.decodeJsonRpc([{ jsonrpc: "2.0", id: 1, method: "fixture/method" }])), "InvalidRequest")

  const invalid = [
    { jsonrpc: "1.0", id: 1, method: "fixture/method" },
    { jsonrpc: "2.0", id: null, method: "fixture/method" },
    { jsonrpc: "2.0", id: 1 },
    { jsonrpc: "2.0", id: 1, result: { resultType: "complete" }, error: { code: -32603, message: "both" } },
    { jsonrpc: "2.0", error: { code: -32603, message: "missing id" } },
    { jsonrpc: "2.0", id: 1, error: { code: -32603, message: "extra", extra: true } },
    { jsonrpc: "2.0", id: 1, error: { code: -32603, message: "unsafe", data: { callback: () => undefined } } }
  ]
  for (const value of invalid) {
    assert.equal(leftTag(api.decodeJsonRpc(value)), "InvalidRequest")
  }
})

test("UTF-8 text and bytes round-trip without changing wire content", () => {
  const api = requireWire()
  const message = { jsonrpc: "2.0", id: "é-雪", method: "fixture/é", params: { text: "雪" } }
  const bytes = right(api.encodeJsonRpcBytes(message))
  assert.ok(bytes instanceof Uint8Array)
  const decoded = right(api.decodeJsonRpcBytes(bytes))
  assert.deepEqual(decoded, { _tag: "Request", ...message })
})

test("wire decoding agrees with representative revisioned generated codecs", async () => {
  const api = requireWire()
  const generated = await import(pathToFileURL(generatedPath).href)
  const fixtures = [
    [generated.JSONRPCRequest, { jsonrpc: "2.0", id: 1, method: "fixture/method", params: {} }],
    [generated.JSONRPCNotification, { jsonrpc: "2.0", method: "fixture/notification" }],
    [generated.JSONRPCResultResponse, { jsonrpc: "2.0", id: "result", result: { resultType: "complete" } }],
    [generated.JSONRPCErrorResponse, { jsonrpc: "2.0", id: "error", error: { code: -32603, message: "failed" } }]
  ]
  for (const [codec, fixture] of fixtures) {
    assert.equal(Either.isRight(Schema.decodeUnknownEither(codec)(fixture)), true)
    assert.equal(api.decodeJsonRpc(fixture)._tag, "Right")
  }
})

test("typed errors centralize JSON-RPC codes and default HTTP statuses", () => {
  const api = requireWire()
  const cases = [
    [new api.ParseError({ message: "parse" }), -32700, 400],
    [new api.InvalidRequest({ message: "request" }), -32600, 400],
    [new api.MethodNotFound({ message: "method" }), -32601, 404],
    [new api.InvalidParams({ message: "params" }), -32602, 400],
    [new api.InternalError({ message: "internal" }), -32603, 500],
    [new api.HeaderMismatchError({ message: "headers" }), -32020, 400],
    [new api.MissingRequiredClientCapabilityError({
      message: "capability",
      data: { requiredCapabilities: { elicitation: {} } }
    }), -32021, 400],
    [new api.UnsupportedProtocolVersionError({
      message: "version",
      data: { requested: "unknown", supported: ["2026-07-28"] }
    }), -32022, 400],
    [new api.SchemaValidationError({ message: "schema" }), -32602, 400],
    [new api.TransportError({ message: "transport" }), -32603, 500],
    [new api.HttpError({ message: "gateway", status: 502 }), -32603, 502]
  ]
  for (const [error, code, status] of cases) {
    assert.equal(api.toJsonRpcErrorObject(error).code, code, error._tag)
    assert.equal(api.defaultHttpStatus(error), status, error._tag)
  }
})

test("JSON-safe error projection preserves safe data and cause without leaking implementation values", () => {
  const api = requireWire()
  const error = new api.InternalError({
    message: "failed",
    data: { detail: "safe", callback: () => undefined },
    cause: new Error("boom")
  })
  const projected = api.toJsonRpcErrorObject(error)
  assert.deepEqual(projected, {
    code: -32603,
    message: "failed",
    data: {
      data: { detail: "safe" },
      cause: { name: "Error", message: "boom" }
    }
  })
  const text = JSON.stringify(projected)
  assert.equal(text.includes("stack"), false)
  assert.equal(text.includes("callback"), false)
})

test("the temporary serialization adapter preserves IDs and suppresses only absent notification responses", async () => {
  const serialization = await import(pathToFileURL(serializationPath).href)

  for (const id of ["001", "", 0, -1]) {
    const internal = serialization._decodeMcpMessage({
      jsonrpc: "2.0",
      id,
      method: "notifications/cancelled",
      params: { requestId: 1 }
    })
    assert.strictEqual(internal.id, id)
    assert.strictEqual(serialization._encodeMcpMessage(internal).id, id)
  }

  const notification = serialization._decodeMcpMessage({
    jsonrpc: "2.0",
    method: "notifications/cancelled",
    params: { requestId: 1 }
  })
  assert.equal(Object.hasOwn(notification, "id"), true)
  assert.strictEqual(notification.id, undefined)
  assert.equal(Object.hasOwn(serialization._encodeMcpMessage(notification), "id"), false)

  const zeroExit = serialization._encodeMcpMessage({
    _tag: "Exit",
    requestId: 0,
    exit: { _tag: "Success", value: { resultType: "complete" } }
  })
  assert.strictEqual(zeroExit.id, 0)
  assert.equal(serialization._encodeMcpMessage({
    _tag: "Exit",
    requestId: undefined,
    exit: { _tag: "Success", value: { resultType: "complete" } }
  }), undefined)
})

test("owned wire and serialization sources contain no coercive or duplicate loose boundary patterns", () => {
  const serialization = readFileSync(path.join(root, "src/McpSerialization.ts"), "utf8")
  const notifications = readFileSync(path.join(root, "src/McpNotifications.ts"), "utf8")
  const wireSource = (() => {
    try {
      return readFileSync(path.join(root, "src/McpWire.ts"), "utf8")
    } catch {
      return ""
    }
  })()
  const owned = `${serialization}\n${wireSource}`

  assert.doesNotMatch(owned, /\b(?:String|Number)\s*\([^)]*(?:requestId|\bid\b)[^)]*\)/)
  assert.doesNotMatch(owned, /\bid\s*===\s*["']{2}|["']{2}\s*===\s*\bid\b/)
  assert.doesNotMatch(owned, /!\s*requestId\b/)
  assert.doesNotMatch(serialization, /is(?:Client|Server)NotificationMethod/)
  assert.doesNotMatch(serialization, /interface\s+McpJsonRpc(?:Request|SuccessResponse|ErrorResponse|Message)/)
  assert.doesNotMatch(serialization, /readonly\s+id\?\s*:\s*(?:number\s*\|\s*string|string\s*\|\s*number)/)
  assert.doesNotMatch(notifications, /\bid:\s*["']{2}/)
  assert.match(wireSource, /Generated\.JSONRPC(?:Request|Notification|ResultResponse|ErrorResponse)/)
  assert.doesNotMatch(wireSource, /Schema\.Unknown[^\n]*(?:Request|Notification|Response|Message)/)
})
