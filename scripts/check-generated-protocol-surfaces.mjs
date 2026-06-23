import assert from "node:assert/strict"
import * as Effect from "effect/Effect"
import * as McpNotifications from "../dist/McpNotifications.js"
import * as McpSchema from "../dist/McpSchema.js"
import { _encodeMcpMessage } from "../dist/McpSerialization.js"
import * as Protocol from "../dist/generated/mcp/McpProtocol.generated.js"

const keys = (group) => Array.from(group.requests.keys())

assert.deepEqual(
  keys(McpSchema.ClientRequestRpcs),
  [...Protocol.CLIENT_REQUEST_METHODS],
  "Client request RPC group should match generated client request methods"
)
assert.deepEqual(
  keys(McpSchema.ClientNotificationRpcs),
  [...Protocol.CLIENT_NOTIFICATION_METHODS],
  "Client notification RPC group should match generated client notification methods"
)
// MCP 2026-07-28 stateless draft has no server-initiated requests: the
// ServerRequest union/group is gone. See docs/draft-2026-07-28-migration.md.
assert.deepEqual(
  [...Protocol.SERVER_REQUEST_METHODS],
  [],
  "Server request methods should be empty in the stateless draft"
)
assert.equal(
  McpSchema.ServerRequestRpcs,
  undefined,
  "ServerRequestRpcs should not be exported in the stateless draft"
)
assert.deepEqual(
  keys(McpSchema.ServerNotificationRpcs),
  [...Protocol.SERVER_NOTIFICATION_METHODS],
  "Server notification RPC group should match generated server notification methods"
)

for (const method of Protocol.CLIENT_REQUEST_METHODS) {
  assert.equal(Protocol.isClientRequestMethod(method), true)
}
for (const method of Protocol.CLIENT_NOTIFICATION_METHODS) {
  assert.equal(Protocol.isClientNotificationMethod(method), true)
}
for (const method of Protocol.SERVER_REQUEST_METHODS) {
  assert.equal(Protocol.isServerRequestMethod(method), true)
}
for (const method of Protocol.SERVER_NOTIFICATION_METHODS) {
  assert.equal(Protocol.isServerNotificationMethod(method), true)
}

assert.equal(Protocol.isClientRequestMethod("notifications/progress"), false)
assert.equal(Protocol.isServerNotificationMethod("tools/list"), false)

// The only client→server notification in the draft is notifications/cancelled.
const sent = []
const outbound = McpNotifications.outbound({
  send: (message) => Effect.sync(() => sent.push(message))
})

await Effect.runPromise(
  outbound.sendCancelled({ requestId: "1", reason: "user" })
)

assert.deepEqual(
  sent.map((message) => message.tag),
  [Protocol.CLIENT_NOTIFICATION_METHOD_BY_TYPE.CancelledNotification],
  "Outbound notification helpers should use generated notification metadata"
)

const encodedClientNotification = _encodeMcpMessage({
  _tag: "Request",
  id: "99",
  tag: Protocol.CLIENT_NOTIFICATION_METHOD_BY_TYPE.CancelledNotification,
  payload: { requestId: "1", reason: "user" }
})
assert.deepEqual(encodedClientNotification, {
  jsonrpc: "2.0",
  method: Protocol.CLIENT_NOTIFICATION_METHOD_BY_TYPE.CancelledNotification,
  params: { requestId: "1", reason: "user" }
})

const encodedServerNotification = _encodeMcpMessage({
  _tag: "Request",
  id: "100",
  tag: Protocol.SERVER_NOTIFICATION_METHOD_BY_TYPE.ToolListChangedNotification,
  payload: {}
})
assert.deepEqual(encodedServerNotification, {
  jsonrpc: "2.0",
  method: Protocol.SERVER_NOTIFICATION_METHOD_BY_TYPE.ToolListChangedNotification,
  params: {}
})

console.log("Generated protocol surfaces match active RPC and dispatch metadata.")
