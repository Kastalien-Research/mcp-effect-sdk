import { Effect, Stream } from "effect"
import {
  SubscriptionAbruptError,
  SubscriptionProtocolError,
  type McpClient,
  type Subscription,
  type SubscriptionAbruptReason,
  type SubscriptionClosure,
  type SubscriptionFilter,
  type SubscriptionNotification,
  type SubscriptionProtocolReason
} from "mcp-effect-sdk/client"

declare const client: McpClient
declare const subscription: Subscription

const opened: Effect.Effect<Subscription, import("mcp-effect-sdk/client").McpClientError, import("effect").Scope.Scope> =
  client.subscriptionsListen({
    toolsListChanged: true,
    resourceSubscriptions: ["file:///one"]
  })
const filter: SubscriptionFilter = subscription.acknowledgedFilter
const notifications: Stream.Stream<
  SubscriptionNotification,
  SubscriptionAbruptError | SubscriptionProtocolError
> = subscription.notifications
const close: Effect.Effect<void> = subscription.close
const closed: Effect.Effect<SubscriptionClosure> = subscription.closed

const abruptReason: SubscriptionAbruptReason = new SubscriptionAbruptError({
  reason: "Transport",
  cause: null as never
}).reason
const protocolReason: SubscriptionProtocolReason = new SubscriptionProtocolError({
  reason: "Frame",
  cause: null as never
}).reason

declare const closure: SubscriptionClosure
switch (closure._tag) {
  case "CallerClosed": break
  case "Graceful": closure.result.resultType satisfies "complete"; break
  case "Abrupt": closure.error satisfies SubscriptionAbruptError; break
  case "ProtocolError": closure.error satisfies SubscriptionProtocolError; break
  default: closure satisfies never
}

void opened
void filter
void notifications
void close
void closed
void abruptReason
void protocolReason

// @ts-expect-error subscriptions are filter-only and do not accept progress options
client.subscriptionsListen({}, { progress: { token: "subscription-progress" } })
// @ts-expect-error the typed stream excludes acknowledgement lifecycle frames
const acknowledgement: SubscriptionNotification = { jsonrpc: "2.0", method: "notifications/subscriptions/acknowledged", params: { notifications: {} } }
void acknowledgement
