import type * as Scope from "effect/Scope"
import * as Effect from "effect/Effect"
import type { McpClientError } from "../../../src/McpClientError.js"
import type { McpTransport } from "../../../src/McpTransport.js"
import type { McpWireError } from "../../../src/McpErrors.js"
import * as McpClient from "../../../src/McpClient.js"

declare const transport: McpTransport<McpWireError>

const client: Effect.Effect<
  McpClient.McpClient,
  McpClientError,
  Scope.Scope
> = McpClient.make({
  transport,
  clientInfo: { name: "typed-client", version: "1.0.0" }
})

void client
