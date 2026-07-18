import { Effect } from "effect"
import type { HeaderMismatchError } from "../../../src/McpWire.js"
import type { JsonRpcRequest } from "../../../src/McpWire.js"
import * as HttpMetadata from "../../../src/transport/HttpMetadata.js"

declare const request: JsonRpcRequest

const encoded: string = HttpMetadata.encodeHeaderValue("header value")
const decoded: Effect.Effect<string, HeaderMismatchError> =
  HttpMetadata.decodeHeaderValue(encoded)
const headers: Effect.Effect<Readonly<Record<string, string>>, HeaderMismatchError> =
  HttpMetadata.standardRequestHeaders(request)
const validated: Effect.Effect<void, HeaderMismatchError> =
  HttpMetadata.validateStandardRequestHeaders(request, {
    "MCP-Protocol-Version": "2026-07-28",
    "Mcp-Method": request.method
  })

void decoded
void headers
void validated
