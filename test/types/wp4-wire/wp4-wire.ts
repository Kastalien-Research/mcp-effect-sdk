import type { Either } from "effect"
import { McpWire } from "../../../src/index.js"

const stringId: McpWire.JsonRpcId = "001"
const numericId: McpWire.JsonRpcId = 0

// @ts-expect-error null is not a JSON-RPC request ID in MCP 2026-07-28
const nullId: McpWire.JsonRpcId = null
// @ts-expect-error booleans are not JSON-RPC request IDs
const booleanId: McpWire.JsonRpcId = false
// @ts-expect-error objects are not JSON-RPC request IDs
const objectId: McpWire.JsonRpcId = {}

const decoded: Either.Either<McpWire.JsonRpcMessage, McpWire.McpWireError> =
  McpWire.decodeJsonRpc({ jsonrpc: "2.0", id: stringId, method: "fixture/method" })
const encoded: Either.Either<string, McpWire.McpWireError> = McpWire.encodeJsonRpcText({
  jsonrpc: "2.0",
  id: numericId,
  method: "fixture/method"
})

void nullId
void booleanId
void objectId
void decoded
void encoded
