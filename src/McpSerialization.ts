/**
 * Temporary compatibility bridge between Effect RPC-style internal messages
 * and the exact MCP 2026-07-28 JSON-RPC wire kernel.
 *
 * Dispatcher and transport ownership move in Tasks 4B-4D. This adapter keeps
 * legacy transports green without weakening IDs or envelope validation.
 */
import * as Either from "effect/Either"
import {
  decodeJsonRpc,
  decodeJsonRpcText,
  InternalError,
  InvalidRequest,
  type JsonRpcId,
  type JsonRpcMessage,
  McpErrorBase,
  toJsonRpcErrorObject
} from "./McpWire.js"

type EncodedBytes = Uint8Array | string

export type McpInternalMessage =
  | {
      readonly _tag: "Request"
      readonly id: JsonRpcId | undefined
      readonly tag: string
      readonly payload: unknown
      readonly headers: ReadonlyArray<unknown>
    }
  | {
      readonly _tag: "Exit"
      readonly requestId: JsonRpcId
      readonly exit: Record<string, unknown>
    }

interface McpSerializationParser {
  readonly decode: (bytes: EncodedBytes) => ReadonlyArray<McpInternalMessage>
  readonly encode: (response: unknown) => EncodedBytes | undefined
}

interface McpSerialization {
  readonly contentType: string
  readonly includesFraming: boolean
  readonly unsafeMake: () => McpSerializationParser
}

function decodeMcpMessage(input: JsonRpcMessage | unknown): McpInternalMessage {
  const msg = asRecord(input)?.["_tag"] === undefined
    ? unwrap(decodeJsonRpc(input))
    : input as JsonRpcMessage
  switch (msg._tag) {
    case "SuccessResponse":
      return {
        _tag: "Exit",
        requestId: msg.id,
        exit: { _tag: "Success", value: msg.result }
      }
    case "ErrorResponse":
      return {
        _tag: "Exit",
        requestId: msg.id,
        exit: {
          _tag: "Failure",
          cause: { _tag: "Fail", error: msg.error }
        }
      }
    case "Request":
      return {
        _tag: "Request",
        id: msg.id,
        tag: msg.method,
        payload: msg.params ?? {},
        headers: []
      }
    case "Notification":
      return {
        _tag: "Request",
        id: undefined,
        tag: msg.method,
        payload: msg.params ?? {},
        headers: []
      }
  }
}

function encodeMcpMessage(msg: Record<string, unknown>): Record<string, unknown> | undefined {
  switch (msg["_tag"]) {
    case "Request": {
      const id = msg["id"] as JsonRpcId | undefined
      const method = msg["tag"]
      const payload = msg["payload"]
      const wire: Record<string, unknown> = { jsonrpc: "2.0", method }
      if (id !== undefined) wire["id"] = id
      if (payload !== undefined && payload !== null) wire["params"] = payload
      return exactWireRecord(wire)
    }
    case "Exit": {
      const requestId = msg["requestId"] as JsonRpcId | undefined
      if (requestId === undefined) return undefined
      const exit = asRecord(msg["exit"])
      if (exit?.["_tag"] === "Success") {
        return exactWireRecord({
          jsonrpc: "2.0",
          id: requestId,
          result: exit["value"] ?? { resultType: "complete" }
        })
      }
      const cause = asRecord(exit?.["cause"])
      const failure = cause?.["_tag"] === "Fail" ? asRecord(cause["error"]) : undefined
      const error = failure && Number.isInteger(failure["code"]) && typeof failure["message"] === "string"
        ? new McpErrorBase({
            code: failure["code"] as number,
            message: failure["message"],
            data: failure["data"],
            cause: failure["cause"]
          })
        : new InternalError({ message: "Internal error", cause: cause ?? exit })
      return exactWireRecord({
        jsonrpc: "2.0",
        id: requestId,
        error: toJsonRpcErrorObject(error)
      })
    }
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

const exactWireRecord = (wire: unknown): Record<string, unknown> => {
  const decoded = unwrap(decodeJsonRpc(wire))
  const { _tag: _, ...record } = decoded
  return record
}

const decodeOne = (input: string | Uint8Array): McpInternalMessage =>
  decodeMcpMessage(unwrap(decodeJsonRpcText(
    typeof input === "string" ? input : new TextDecoder("utf-8", { fatal: true }).decode(input)
  )))

const encodeSingle = (response: unknown): string | undefined => {
  if (!Array.isArray(response)) {
    const encoded = encodeMcpMessage(asRecord(response) ?? {})
    return encoded === undefined ? undefined : JSON.stringify(encoded)
  }
  const encoded = response
    .map((message) => encodeMcpMessage(asRecord(message) ?? {}))
    .filter((message): message is Record<string, unknown> => message !== undefined)
  if (encoded.length === 0) return undefined
  if (encoded.length > 1) throw new InvalidRequest({ message: "JSON-RPC batches are not supported" })
  return JSON.stringify(encoded[0])
}

const unwrap = <A, E>(either: Either.Either<A, E>): A => {
  if (Either.isLeft(either)) throw either.left
  return either.right
}

const asRecord = (value: unknown): Record<string, unknown> | undefined =>
  typeof value === "object" && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined

/** MCP JSON serialization retained for legacy HTTP clients until Task 4D. */
export const mcpJson: McpSerialization = {
  contentType: "application/json",
  includesFraming: false,
  unsafeMake: () => ({
    decode: (bytes) => [decodeOne(bytes)],
    encode: encodeSingle
  })
}

/** MCP NDJSON framing retained until the Task 4C stdio replacement. */
export const mcpNdJson: McpSerialization = {
  contentType: "application/x-ndjson",
  includesFraming: true,
  unsafeMake: () => ({
    decode: (bytes) => {
      const text = typeof bytes === "string"
        ? bytes
        : new TextDecoder("utf-8", { fatal: true }).decode(bytes)
      return text
        .split("\n")
        .filter((line) => line.trim().length > 0)
        .map(decodeOne)
    },
    encode: (response) => {
      const messages = Array.isArray(response) ? response : [response]
      const lines = messages
        .map((message) => encodeMcpMessage(asRecord(message) ?? {}))
        .filter((message): message is Record<string, unknown> => message !== undefined)
        .map((message) => JSON.stringify(message))
      return lines.length === 0 ? undefined : `${lines.join("\n")}\n`
    }
  })
}

/** Legacy SSE framing retained only for compatibility until Task 4D. */
export const mcpSseJson: McpSerialization = {
  contentType: "text/event-stream",
  includesFraming: true,
  unsafeMake: () => ({
    decode: (bytes) => {
      const text = typeof bytes === "string"
        ? bytes
        : new TextDecoder("utf-8", { fatal: true }).decode(bytes)
      const trimmed = text.trim()
      if (!trimmed) return []
      if (!trimmed.startsWith("data:")) return [decodeOne(trimmed)]
      return trimmed
        .split("\n\n")
        .filter((event) => event.trim().length > 0)
        .flatMap((event) => {
          const data = event
            .split("\n")
            .filter((line) => line.startsWith("data:"))
            .map((line) => line.slice(5).trimStart())
            .join("\n")
          return data ? [decodeOne(data)] : []
        })
    },
    encode: (response) => {
      const encodeOne = (value: unknown): string | undefined => {
        const message = asRecord(value) ?? {}
        const encoded = encodeMcpMessage(message)
        if (encoded) return `data: ${JSON.stringify(encoded)}\n\n`
        if (message["_tag"] === "Exit" && message["requestId"] === undefined) {
          return ": accepted\n\n"
        }
        return undefined
      }
      const frames = (Array.isArray(response) ? response : [response])
        .map(encodeOne)
        .filter((frame): frame is string => frame !== undefined)
      return frames.length === 0 ? undefined : frames.join("")
    }
  })
}

export { decodeMcpMessage as _decodeMcpMessage }
export { encodeMcpMessage as _encodeMcpMessage }
