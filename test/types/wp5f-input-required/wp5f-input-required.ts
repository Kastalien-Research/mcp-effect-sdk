import * as Effect from "effect/Effect"
import type * as Scope from "effect/Scope"
import * as Client from "../../../src/client.js"
import type { McpClientError } from "../../../src/McpClientError.js"
import type { McpTransport } from "../../../src/McpTransport.js"
import * as Server from "../../../src/server.js"
import type { InputRequiredResult } from "../../../src/McpSchema.js"

declare const transport: McpTransport<never>

const automatic: Effect.Effect<
  Client.McpClient<"automatic">,
  McpClientError,
  Scope.Scope
> = Client.make({ transport })

const manual: Effect.Effect<
  Client.McpClient<"manual">,
  McpClientError,
  Scope.Scope
> = Client.make({ transport, inputRequired: Client.InputRequiredPolicy.manual })

declare const manualClient: Client.McpClient<"manual">
const manualResult: Effect.Effect<
  Client.ClientResultForMethod<"tools/call">,
  McpClientError
> = manualClient.callTool({
  name: "resume",
  arguments: {},
  requestState: "opaque",
  inputResponses: { roots: { roots: [] } }
})

declare const automaticClient: Client.McpClient<"automatic">
const automaticResult = automaticClient.callTool({ name: "auto", arguments: {} })
// @ts-expect-error automatic result is complete-only
const automaticInput: Effect.Effect<InputRequiredResult, McpClientError> = automaticResult

const input = Server.requestInput({
  inputRequests: { roots: { method: "roots/list", params: {} } },
  requestState: "opaque"
})

automaticClient.callTool({ name: "resume-auto", arguments: {}, requestState: "opaque" })
// @ts-expect-error list methods never accept continuation fields
manualClient.listTools({ requestState: "opaque" })

void automatic
void manual
void manualResult
void automaticInput
void input
