import { Effect, Option } from "effect"
import {
  make,
  type ClientProgressOptions,
  type ClientRequestOptions,
  type McpClient,
  type ProgressHandler
} from "mcp-effect-sdk/client"
import {
  McpRequestContext,
  sendProgress,
  type McpRequestContextService,
  type ProgressUpdate
} from "mcp-effect-sdk/server"
import type { McpSchema, McpWire } from "mcp-effect-sdk/protocol/2026-07-28"

const handler: ProgressHandler = (progress) => Effect.sync(() => {
  const token: typeof McpSchema.ProgressToken.Type = progress.progressToken
  void token
})
const progress: ClientProgressOptions = { token: 0, onProgress: handler }
const requestOptions: ClientRequestOptions = { progress }

declare const client: McpClient
void client.discover(requestOptions)
void client.listTools({}, requestOptions)
void client.callTool({ name: "typed", arguments: {} }, requestOptions)
void client.listResources({}, requestOptions)
void client.listResourceTemplates({}, requestOptions)
void client.readResource({ uri: "file:///typed" }, requestOptions)
void client.listPrompts({}, requestOptions)
void client.getPrompt({ name: "typed" }, requestOptions)
void client.complete({
  ref: { type: "ref/prompt", name: "typed" },
  argument: { name: "value", value: "" }
}, requestOptions)
void client.subscriptionsListen({}, requestOptions)

const update: ProgressUpdate = { progress: 0, total: 1, message: "typed" }
const send: Effect.Effect<void, McpWire.SchemaValidationError, McpRequestContext> = sendProgress(update)
const contextProgram = Effect.gen(function*() {
  const context: McpRequestContextService = yield* McpRequestContext
  const token: Option.Option<typeof McpSchema.ProgressToken.Type> = context.progressToken
  const cancelled: Effect.Effect<void> = context.cancelled
  const isCancelled: Effect.Effect<boolean> = context.isCancelled
  // @ts-expect-error stable request context never exposes the raw dispatcher sink
  context.notificationSink
  return { token, cancelled, isCancelled }
})

void make
void send
void contextProgram

// @ts-expect-error progress updates derive their token from request context
sendProgress({ progressToken: "cross-owner", progress: 1 })
// @ts-expect-error high-level cancellation is Effect interruption, not a manual handle
client.cancel("request")
// @ts-expect-error AbortSignal is not part of the Effect-native request options
const invalidOptions: ClientRequestOptions = { signal: new AbortController().signal }
void invalidOptions
