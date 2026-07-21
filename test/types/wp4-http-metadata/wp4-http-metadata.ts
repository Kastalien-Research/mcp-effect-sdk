import { Effect } from "effect"
import type { HeaderMismatchError } from "../../../src/McpWire.js"
import type { JsonRpcRequest } from "../../../src/McpWire.js"
import type { Tool } from "../../../src/McpSchema.js"
import * as HttpMetadata from "../../../src/transport/HttpMetadata.js"

declare const request: JsonRpcRequest
declare const tool: Tool
declare const plan: HttpMetadata.HttpToolHeaderPlan
declare const argumentsValue: unknown
declare const warningSink: HttpMetadata.HttpToolWarningSink<"warning-error", never>

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
const analyzed: Effect.Effect<
  HttpMetadata.HttpToolHeaderPlan,
  HttpMetadata.InvalidToolHeaderDefinition
> = HttpMetadata.analyzeToolHeaders(tool)
const extracted: Effect.Effect<Readonly<Record<string, string>>, HeaderMismatchError> =
  HttpMetadata.extractToolHeaders(plan, argumentsValue)
const customValidated: Effect.Effect<void, HeaderMismatchError> =
  HttpMetadata.validateToolHeaders(plan, argumentsValue, {})
const filtered: Effect.Effect<
  HttpMetadata.HttpToolCatalog<Tool>,
  "warning-error"
> = HttpMetadata.filterHttpTools([tool], warningSink)

void decoded
void headers
void validated
void analyzed
void extracted
void customValidated
void filtered
