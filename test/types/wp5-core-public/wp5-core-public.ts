import { Effect, Option, Stream } from "effect"
import * as Client from "mcp-effect-sdk/client"
import * as Deprecated from "mcp-effect-sdk/deprecated"
import * as Protocol from "mcp-effect-sdk/protocol/2026-07-28"
import * as Server from "mcp-effect-sdk/server"
import * as Http from "mcp-effect-sdk/transport/http"
import * as Stdio from "mcp-effect-sdk/transport/stdio"
// @ts-expect-error Elicitation is stable input-required policy, not a deprecated service export.
import { ElicitationHandler } from "mcp-effect-sdk/deprecated"

type AssertFalse<Value extends false> = Value
type DeprecatedHasElicitation = "ElicitationHandler" extends keyof typeof Deprecated ? true : false
type _NoDeprecatedElicitation = AssertFalse<DeprecatedHasElicitation>

declare const transport: Client.McpTransport<never>
const client = Client.make({
  transport,
  inputRequired: Client.InputRequiredPolicy.automatic({
    elicitation: {
      form: () => Effect.succeed({ action: "accept", content: {} })
    },
    roots: { list: Effect.succeed({ roots: [] }) },
    sampling: {
      handle: () => Effect.succeed({
        role: "assistant",
        content: { type: "text", text: "sample" },
        model: "example",
        stopReason: "endTurn"
      })
    }
  })
})

const server = Server.make({
  serverInfo: { name: "wp5-public", version: "1" },
  handlers: Server.registerTool({
    name: "approval",
    outputSchema: { type: "object", properties: { approved: { type: "boolean" } } },
    content: () => Effect.succeed({
      resultType: "complete",
      content: [{ type: "text", text: "approved" }],
      structuredContent: { approved: true }
    })
  }),
  pagination: { pageSize: 10 }
})

const input = Server.requestInput({
  inputRequests: {
    approval: {
      method: "elicitation/create",
      params: {
        mode: "form",
        message: "Approve?",
        requestedSchema: { type: "object", properties: {} }
      }
    }
  },
  requestState: "opaque"
})

const validator: Server.JsonSchemaValidatorService = {
  compile: () => Effect.succeed({ validate: () => Effect.void })
}
const pagination: Server.PaginationPolicy = { pageSize: 10 }
const cache: Client.McpCacheService = {
  get: () => Effect.succeed(Option.none()),
  set: () => Effect.void,
  invalidate: () => Effect.void
}

declare const subscription: Client.Subscription
const notifications: Stream.Stream<
  Client.SubscriptionNotification,
  Client.SubscriptionAbruptError | Client.SubscriptionProtocolError
> = subscription.notifications
const closure: Effect.Effect<Client.SubscriptionClosure> = subscription.closed

const version: typeof Protocol.MODERN_PROTOCOL_VERSION = "2026-07-28"
const info: Protocol.McpSchema.Implementation = { name: "public", version: "1" }

void Client.McpCache
void Deprecated.RootsProvider
void Deprecated.SamplingHandler
void Deprecated.sendLoggingMessage
void Http.StreamableHttpClientTransport.make
void Http.StreamableHttpServerTransport.toWebHandler
void Stdio.StdioClientTransport.make
void Stdio.StdioServerTransport.run
void ElicitationHandler
void client
void server
void input
void validator
void pagination
void cache
void notifications
void closure
void version
void info
void (null as unknown as _NoDeprecatedElicitation)
