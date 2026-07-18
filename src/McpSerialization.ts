/**
 * MCP JSON-RPC serialization bridge.
 *
 * Translates between the SDK's internal message format
 * (_tag:"Request"/"Exit"/etc.) and MCP JSON-RPC wire format
 * (jsonrpc:"2.0", method, params, id, result, error).
 *
 * Two variants:
 * - mcpJson: for Streamable HTTP transport
 * - mcpNdJson: for stdio transport (newline-delimited)
 */
import {
  isClientNotificationMethod,
  isServerNotificationMethod
} from "./generated/mcp/2026-07-28/McpProtocol.generated.js"

// ---------------------------------------------------------------------------
// MCP JSON-RPC wire types
// ---------------------------------------------------------------------------

interface McpJsonRpcRequest {
  readonly jsonrpc: "2.0"
  readonly method: string
  readonly id?: number | string
  readonly params?: unknown
}

interface McpJsonRpcSuccessResponse {
  readonly jsonrpc: "2.0"
  readonly id: number | string
  readonly result: unknown
}

interface McpJsonRpcErrorResponse {
  readonly jsonrpc: "2.0"
  readonly id: number | string
  readonly error: {
    readonly code: number
    readonly message: string
    readonly data?: unknown
  }
}

type McpJsonRpcMessage =
  | McpJsonRpcRequest
  | McpJsonRpcSuccessResponse
  | McpJsonRpcErrorResponse

type EncodedBytes = Uint8Array | string
type McpInternalMessage =
  | Record<string, unknown>

interface McpSerializationParser {
  readonly decode: (bytes: EncodedBytes) => ReadonlyArray<McpInternalMessage>
  readonly encode: (response: unknown) => EncodedBytes | undefined
}

interface McpSerialization {
  readonly contentType: string
  readonly includesFraming: boolean
  readonly unsafeMake: () => McpSerializationParser
}

// ---------------------------------------------------------------------------
// Wire → Internal
// ---------------------------------------------------------------------------

function isServerResponse(
  msg: McpJsonRpcMessage
): msg is McpJsonRpcSuccessResponse | McpJsonRpcErrorResponse {
  return "result" in msg || "error" in msg
}

function decodeMcpMessage(msg: McpJsonRpcMessage): McpInternalMessage {
  if (isServerResponse(msg)) {
    if ("error" in msg && msg.error != null) {
      return {
        _tag: "Exit",
        requestId: String(msg.id),
        exit: {
          _tag: "Failure",
          cause: {
            _tag: "Fail",
            error: msg.error
          }
        }
      }
    }
    return {
      _tag: "Exit",
      requestId: String(msg.id),
      exit: {
        _tag: "Success",
        value: (msg as McpJsonRpcSuccessResponse).result
      }
    }
  }

  // Server-initiated request or notification
  const request = msg as McpJsonRpcRequest
  const hasId = request.id !== undefined && request.id !== null
  return {
    _tag: "Request",
    id: hasId ? String(request.id) : "",
    tag: request.method,
    payload: request.params ?? {},
    headers: []
  }
}

// ---------------------------------------------------------------------------
// Internal → Wire
// ---------------------------------------------------------------------------

function encodeMcpMessage(
  msg: Record<string, unknown>
): McpJsonRpcMessage | undefined {
  const tag = msg["_tag"] as string
  switch (tag) {
    case "Request": {
      const id = msg["id"] as string
      const method = msg["tag"] as string
      const payload = msg["payload"]
      const isNotification =
        id === "" ||
        isClientNotificationMethod(method) ||
        isServerNotificationMethod(method)
      const base: Record<string, unknown> = {
        jsonrpc: "2.0",
        method
      }
      if (!isNotification) {
        base["id"] = Number(id)
      }
      if (payload !== undefined && payload !== null) {
        base["params"] = payload
      }
      return base as unknown as McpJsonRpcMessage
    }
    case "Exit": {
      const requestId = msg["requestId"] as string
      // Suppress responses to notifications (empty requestId)
      if (!requestId) return undefined
      const exit = msg["exit"] as Record<string, unknown>
      if (exit["_tag"] === "Success") {
        return {
          jsonrpc: "2.0",
          id: Number(requestId),
          result: exit["value"] ?? {}
        }
      }
      // Failure — extract MCP error shape from cause
      const cause = exit["cause"] as Record<string, unknown>
      if (cause["_tag"] === "Fail") {
        const error = cause["error"] as Record<string, unknown>
        return {
          jsonrpc: "2.0",
          id: Number(requestId),
          error: {
            code: (error["code"] as number) ?? -32603,
            message: (error["message"] as string) ?? "Internal error",
            data: error["data"]
          }
        }
      }
      return {
        jsonrpc: "2.0",
        id: Number(requestId),
        error: {
          code: -32603,
          message: "Internal error",
          data: cause
        }
      }
    }
    // Filter out internal control messages
    case "Ack":
    case "Ping":
    case "Pong":
    case "Eof":
    case "Interrupt":
    case "Chunk":
    case "Defect":
    case "ClientProtocolError":
      return undefined
    default:
      return undefined
  }
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/** MCP JSON-RPC serialization for HTTP transport. */
export const mcpJson: McpSerialization = {
    contentType: "application/json",
    includesFraming: false,
    unsafeMake: (): McpSerializationParser => {
      const decoder = new TextDecoder()
      return {
        decode: (bytes) => {
          const text =
            typeof bytes === "string"
              ? bytes
              : decoder.decode(bytes)
          const parsed: unknown = JSON.parse(text)
          if (Array.isArray(parsed)) {
            return parsed.map(
              (m) => decodeMcpMessage(m as McpJsonRpcMessage)
            )
          }
          return [
            decodeMcpMessage(parsed as McpJsonRpcMessage)
          ]
        },
        encode: (response) => {
          if (Array.isArray(response)) {
            const encoded = response
              .map((m) =>
                encodeMcpMessage(m as Record<string, unknown>)
              )
              .filter(Boolean)
            if (encoded.length === 0) return undefined
            return JSON.stringify(
              encoded.length === 1 ? encoded[0] : encoded
            )
          }
          const encoded = encodeMcpMessage(
            response as Record<string, unknown>
          )
          return encoded ? JSON.stringify(encoded) : undefined
        }
      }
    }
  }

/** MCP newline-delimited JSON serialization for stdio transport. */
export const mcpNdJson: McpSerialization = {
    contentType: "application/x-ndjson",
    includesFraming: true,
    unsafeMake: (): McpSerializationParser => {
      const decoder = new TextDecoder()
      return {
        decode: (bytes) => {
          const text =
            typeof bytes === "string"
              ? bytes
              : decoder.decode(bytes)
          const lines = text
            .split("\n")
            .filter((line) => line.trim().length > 0)
          return lines.map((line) =>
            decodeMcpMessage(
              JSON.parse(line) as McpJsonRpcMessage
            )
          )
        },
        encode: (response) => {
          if (Array.isArray(response)) {
            const lines = response
              .map((m) =>
                encodeMcpMessage(m as Record<string, unknown>)
              )
              .filter(Boolean)
              .map((msg) => JSON.stringify(msg))
            return lines.length > 0
              ? lines.join("\n") + "\n"
              : undefined
          }
          const encoded = encodeMcpMessage(
            response as Record<string, unknown>
          )
          return encoded
            ? JSON.stringify(encoded) + "\n"
            : undefined
        }
      }
    }
  }

export const mcpSseJson: McpSerialization = {
    contentType: "text/event-stream",
    includesFraming: true,
    unsafeMake: (): McpSerializationParser => {
      const decoder = new TextDecoder()
      return {
        decode: (bytes) => {
          const text =
            typeof bytes === "string"
              ? bytes
              : decoder.decode(bytes)
          const trimmed = text.trim()
          if (!trimmed) {
            return []
          }
          if (!trimmed.startsWith("data:")) {
            const parsed: unknown = JSON.parse(trimmed)
            return Array.isArray(parsed)
              ? parsed.map((m) => decodeMcpMessage(m as McpJsonRpcMessage))
              : [decodeMcpMessage(parsed as McpJsonRpcMessage)]
          }
          return trimmed
            .split("\n\n")
            .filter((event) => event.trim().length > 0)
            .flatMap((event) => {
              const data = event
                .split("\n")
                .filter((line) => line.startsWith("data:"))
                .map((line) => line.slice(5).trimStart())
                .join("\n")
              return data
                ? [decodeMcpMessage(JSON.parse(data) as McpJsonRpcMessage)]
                : []
            })
        },
        encode: (response) => {
          const encodeOne = (value: unknown): string | undefined => {
            const encoded = encodeMcpMessage(value as Record<string, unknown>)
            if (encoded) {
              return `data: ${JSON.stringify(encoded)}\n\n`
            }
            const message = value as Record<string, unknown>
            if (message["_tag"] === "Exit" && !message["requestId"]) {
              return ": accepted\n\n"
            }
            return undefined
          }
          if (Array.isArray(response)) {
            const frames = response.map(encodeOne).filter(Boolean)
            return frames.length > 0 ? frames.join("") : undefined
          }
          return encodeOne(response)
        }
      }
    }
  }

// Re-export for test access
export { decodeMcpMessage as _decodeMcpMessage }
export { encodeMcpMessage as _encodeMcpMessage }
