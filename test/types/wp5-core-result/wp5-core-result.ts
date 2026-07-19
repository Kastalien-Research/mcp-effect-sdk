import type * as Effect from "effect/Effect"
import type * as Option from "effect/Option"
import * as McpClient from "../../../src/McpClient.js"
import * as McpModern from "../../../src/McpModern.js"
import type { Implementation, InputRequiredResult } from "../../../src/McpSchema.js"

declare const unknownResult: unknown
const resultInfo: Option.Option<Implementation> = McpModern.serverInfoFromResult(unknownResult)
void resultInfo

declare const client: McpClient.McpClient
const discoveredInfo: Effect.Effect<Option.Option<Implementation>> = client.serverInfo
void discoveredInfo

type ToolCallResult = McpClient.ClientResultForMethod<"tools/call">
declare const toolCallResult: ToolCallResult
if (toolCallResult.resultType === "input_required") {
  const inputRequired: InputRequiredResult = toolCallResult
  void inputRequired.requestState
} else {
  const complete: "complete" = toolCallResult.resultType
  void complete
  void toolCallResult.content
}

type ReadResourceResult = McpClient.ClientResultForMethod<"resources/read">
type GetPromptResult = McpClient.ClientResultForMethod<"prompts/get">
type ListToolsResult = McpClient.ClientResultForMethod<"tools/list">

type Assert<T extends true> = T
type IsNever<T> = [T] extends [never] ? true : false
type _ReadPreservesInput = Assert<IsNever<Extract<ReadResourceResult, { resultType: "input_required" }>> extends false ? true : false>
type _PromptPreservesInput = Assert<IsNever<Extract<GetPromptResult, { resultType: "input_required" }>> extends false ? true : false>
type _ListIsCompleteOnly = Assert<IsNever<Extract<ListToolsResult, { resultType: "input_required" }>>>

const discover = McpModern.makeDiscoverResult({
  capabilities: {},
  ttlMs: 0,
  cacheScope: "private"
})
// @ts-expect-error server identity is result metadata, never a top-level discovery field
void discover.serverInfo

void (0 as unknown as _ReadPreservesInput)
void (0 as unknown as _PromptPreservesInput)
void (0 as unknown as _ListIsCompleteOnly)
