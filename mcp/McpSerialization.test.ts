import { describe, expect, it } from "vitest"
import {
  mcpJson,
  mcpNdJson,
  _decodeMcpMessage,
  _encodeMcpMessage
} from "./McpSerialization.js"

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeParser(variant: "json" | "ndjson") {
  const ser = variant === "json" ? mcpJson : mcpNdJson
  return ser.unsafeMake()
}

// ---------------------------------------------------------------------------
// Decode: Wire → Internal
// ---------------------------------------------------------------------------

describe("decodeMcpMessage", () => {
  it("decodes a success response", () => {
    const wire = {
      jsonrpc: "2.0" as const,
      id: 42,
      result: { tools: [] }
    }
    const result = _decodeMcpMessage(wire) as Record<string, unknown>
    expect(result["_tag"]).toBe("Exit")
    expect(result["requestId"]).toBe("42")
    const exit = result["exit"] as Record<string, unknown>
    expect(exit["_tag"]).toBe("Success")
    expect(exit["value"]).toEqual({ tools: [] })
  })

  it("decodes an error response", () => {
    const wire = {
      jsonrpc: "2.0" as const,
      id: 7,
      error: { code: -32601, message: "Method not found" }
    }
    const result = _decodeMcpMessage(wire) as Record<string, unknown>
    expect(result["_tag"]).toBe("Exit")
    expect(result["requestId"]).toBe("7")
    const exit = result["exit"] as Record<string, unknown>
    expect(exit["_tag"]).toBe("Failure")
    const cause = exit["cause"] as Record<string, unknown>
    expect(cause["_tag"]).toBe("Fail")
    expect(cause["error"]).toEqual({
      code: -32601,
      message: "Method not found"
    })
  })

  it("decodes a server-initiated request (has method + id)", () => {
    const wire = {
      jsonrpc: "2.0" as const,
      id: 1,
      method: "sampling/createMessage",
      params: { messages: [] }
    }
    const result = _decodeMcpMessage(wire) as Record<string, unknown>
    expect(result["_tag"]).toBe("Request")
    expect(result["id"]).toBe("1")
    expect(result["tag"]).toBe("sampling/createMessage")
    expect(result["payload"]).toEqual({ messages: [] })
  })

  it("decodes a server notification (method, no id)", () => {
    const wire = {
      jsonrpc: "2.0" as const,
      method: "notifications/tools/list_changed"
    }
    const result = _decodeMcpMessage(wire) as Record<string, unknown>
    expect(result["_tag"]).toBe("Request")
    expect(result["id"]).toBe("")
    expect(result["tag"]).toBe("notifications/tools/list_changed")
    expect(result["payload"]).toEqual({})
  })

  it("handles id: 0 as valid (not falsy)", () => {
    const wire = {
      jsonrpc: "2.0" as const,
      id: 0,
      method: "ping"
    }
    const result = _decodeMcpMessage(wire) as Record<string, unknown>
    expect(result["id"]).toBe("0")
  })

  it("handles string id", () => {
    const wire = {
      jsonrpc: "2.0" as const,
      id: "abc-123",
      result: {}
    }
    const result = _decodeMcpMessage(wire) as Record<string, unknown>
    expect(result["requestId"]).toBe("abc-123")
  })
})

// ---------------------------------------------------------------------------
// Encode: Internal → Wire
// ---------------------------------------------------------------------------

describe("encodeMcpMessage", () => {
  it("encodes a client request", () => {
    const internal = {
      _tag: "Request",
      id: "5",
      tag: "tools/list",
      payload: {},
      headers: []
    }
    const wire = _encodeMcpMessage(internal) as unknown as
      Record<string, unknown>
    expect(wire["jsonrpc"]).toBe("2.0")
    expect(wire["id"]).toBe(5)
    expect(wire["method"]).toBe("tools/list")
    expect(wire["params"]).toEqual({})
  })

  it("encodes a client notification (no id)", () => {
    const internal = {
      _tag: "Request",
      id: "",
      tag: "notifications/initialized",
      payload: {}
    }
    const wire = _encodeMcpMessage(internal) as unknown as
      Record<string, unknown>
    expect(wire["jsonrpc"]).toBe("2.0")
    expect(wire["method"]).toBe("notifications/initialized")
    expect(wire["id"]).toBeUndefined()
  })

  it("encodes a success response to server request", () => {
    const internal = {
      _tag: "Exit",
      requestId: "3",
      exit: {
        _tag: "Success",
        value: { content: [], model: "test" }
      }
    }
    const wire = _encodeMcpMessage(internal) as unknown as
      Record<string, unknown>
    expect(wire["jsonrpc"]).toBe("2.0")
    expect(wire["id"]).toBe(3)
    expect(wire["result"]).toEqual({ content: [], model: "test" })
  })

  it("encodes an error response to server request", () => {
    const internal = {
      _tag: "Exit",
      requestId: "3",
      exit: {
        _tag: "Failure",
        cause: {
          _tag: "Fail",
          error: {
            code: -32600,
            message: "Invalid request",
            data: { detail: "missing field" }
          }
        }
      }
    }
    const wire = _encodeMcpMessage(internal) as unknown as
      Record<string, unknown>
    expect(wire["jsonrpc"]).toBe("2.0")
    expect(wire["id"]).toBe(3)
    const error = wire["error"] as Record<string, unknown>
    expect(error["code"]).toBe(-32600)
    expect(error["message"]).toBe("Invalid request")
    expect(error["data"]).toEqual({ detail: "missing field" })
  })

  it("suppresses Exit with empty requestId (notification ack)", () => {
    const internal = {
      _tag: "Exit",
      requestId: "",
      exit: { _tag: "Success", value: undefined }
    }
    expect(_encodeMcpMessage(internal)).toBeUndefined()
  })

  it("filters out Ack control message", () => {
    expect(
      _encodeMcpMessage({ _tag: "Ack", requestId: "1" })
    ).toBeUndefined()
  })

  it("filters out Ping control message", () => {
    expect(_encodeMcpMessage({ _tag: "Ping" })).toBeUndefined()
  })

  it("filters out Pong control message", () => {
    expect(_encodeMcpMessage({ _tag: "Pong" })).toBeUndefined()
  })

  it("filters out Eof control message", () => {
    expect(_encodeMcpMessage({ _tag: "Eof" })).toBeUndefined()
  })

  it("filters out Interrupt control message", () => {
    expect(
      _encodeMcpMessage({ _tag: "Interrupt", requestId: "1" })
    ).toBeUndefined()
  })

  it("filters out Chunk control message", () => {
    expect(
      _encodeMcpMessage({
        _tag: "Chunk",
        requestId: "1",
        values: [1, 2]
      })
    ).toBeUndefined()
  })
})

// ---------------------------------------------------------------------------
// mcpJson: round-trip encode/decode
// ---------------------------------------------------------------------------

describe("mcpJson", () => {
  it("has correct content type", () => {
    expect(mcpJson.contentType).toBe("application/json")
    expect(mcpJson.includesFraming).toBe(false)
  })

  it("round-trips a client request", () => {
    const parser = makeParser("json")
    const internal = {
      _tag: "Request",
      id: "1",
      tag: "tools/list",
      payload: { cursor: "abc" },
      headers: []
    }
    const wire = parser.encode(internal) as string
    expect(wire).toBeTruthy()
    const parsed = JSON.parse(wire)
    expect(parsed.jsonrpc).toBe("2.0")
    expect(parsed.id).toBe(1)
    expect(parsed.method).toBe("tools/list")

    const decoded = parser.decode(wire)
    expect(decoded).toHaveLength(1)
    const msg = decoded[0] as Record<string, unknown>
    // Wire round-trip for a request: it becomes a "Request"
    // with the same tag and payload
    expect(msg["_tag"]).toBe("Request")
    expect(msg["tag"]).toBe("tools/list")
  })

  it("round-trips a server response", () => {
    const parser = makeParser("json")
    const wire =
      '{"jsonrpc":"2.0","id":1,"result":{"tools":[]}}'
    const decoded = parser.decode(wire)
    expect(decoded).toHaveLength(1)
    const msg = decoded[0] as Record<string, unknown>
    expect(msg["_tag"]).toBe("Exit")
    expect(msg["requestId"]).toBe("1")
  })

  it("handles batch array", () => {
    const parser = makeParser("json")
    const wire = JSON.stringify([
      { jsonrpc: "2.0", id: 1, result: { a: 1 } },
      { jsonrpc: "2.0", id: 2, result: { b: 2 } }
    ])
    const decoded = parser.decode(wire)
    expect(decoded).toHaveLength(2)
  })

  it("preserves MCP error format", () => {
    const parser = makeParser("json")
    const wire = JSON.stringify({
      jsonrpc: "2.0",
      id: 5,
      error: {
        code: -32601,
        message: "Method not found",
        data: { method: "foo/bar" }
      }
    })
    const decoded = parser.decode(wire)
    const msg = decoded[0] as Record<string, unknown>
    const exit = msg["exit"] as Record<string, unknown>
    const cause = exit["cause"] as Record<string, unknown>
    const error = cause["error"] as Record<string, unknown>
    expect(error["code"]).toBe(-32601)
    expect(error["message"]).toBe("Method not found")
    expect(error["data"]).toEqual({ method: "foo/bar" })
  })

  it("encodes notification without id field", () => {
    const parser = makeParser("json")
    const wire = parser.encode({
      _tag: "Request",
      id: "",
      tag: "notifications/initialized",
      payload: {}
    }) as string
    const parsed = JSON.parse(wire)
    expect(parsed.id).toBeUndefined()
    expect(parsed.method).toBe("notifications/initialized")
  })

  it("returns undefined for control messages", () => {
    const parser = makeParser("json")
    expect(parser.encode({ _tag: "Ping" })).toBeUndefined()
    expect(parser.encode({ _tag: "Ack", requestId: "1" })).toBeUndefined()
  })
})

// ---------------------------------------------------------------------------
// mcpNdJson: newline-delimited encoding
// ---------------------------------------------------------------------------

describe("mcpNdJson", () => {
  it("has correct content type", () => {
    expect(mcpNdJson.contentType).toBe("application/x-ndjson")
    expect(mcpNdJson.includesFraming).toBe(true)
  })

  it("encodes with trailing newline", () => {
    const parser = makeParser("ndjson")
    const wire = parser.encode({
      _tag: "Request",
      id: "1",
      tag: "ping",
      payload: {},
      headers: []
    }) as string
    expect(wire.endsWith("\n")).toBe(true)
    // Single line
    expect(wire.trim().split("\n")).toHaveLength(1)
  })

  it("decodes multi-line input", () => {
    const parser = makeParser("ndjson")
    const input = [
      '{"jsonrpc":"2.0","id":1,"result":{}}',
      '{"jsonrpc":"2.0","method":"notifications/tools/list_changed"}'
    ].join("\n")
    const decoded = parser.decode(input)
    expect(decoded).toHaveLength(2)
    expect(
      (decoded[0] as Record<string, unknown>)["_tag"]
    ).toBe("Exit")
    expect(
      (decoded[1] as Record<string, unknown>)["_tag"]
    ).toBe("Request")
  })

  it("ignores blank lines", () => {
    const parser = makeParser("ndjson")
    const input =
      '{"jsonrpc":"2.0","id":1,"result":{}}\n\n\n'
    const decoded = parser.decode(input)
    expect(decoded).toHaveLength(1)
  })

  it("round-trips a request through ndjson", () => {
    const parser = makeParser("ndjson")
    const internal = {
      _tag: "Request",
      id: "2",
      tag: "tools/call",
      payload: { name: "read", arguments: {} },
      headers: []
    }
    const wire = parser.encode(internal) as string
    expect(wire).toBeTruthy()
    const decoded = parser.decode(wire)
    expect(decoded).toHaveLength(1)
    const msg = decoded[0] as Record<string, unknown>
    expect(msg["tag"]).toBe("tools/call")
  })
})
