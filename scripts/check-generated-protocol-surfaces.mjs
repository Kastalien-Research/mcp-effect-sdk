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
assert.deepEqual(
  keys(McpSchema.ServerRequestRpcs),
  [...Protocol.SERVER_REQUEST_METHODS],
  "Server request RPC group should match generated server request methods"
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

const sent = []
const outbound = McpNotifications.outbound({
  send: (message) => Effect.sync(() => sent.push(message))
})

await Effect.runPromise(outbound.sendInitialized())
await Effect.runPromise(outbound.sendRootsListChanged())

assert.deepEqual(
  sent.map((message) => message.tag),
  [
    Protocol.CLIENT_NOTIFICATION_METHOD_BY_TYPE.InitializedNotification,
    Protocol.CLIENT_NOTIFICATION_METHOD_BY_TYPE.RootsListChangedNotification
  ],
  "Outbound notification helpers should use generated notification metadata"
)

const encodedClientNotification = _encodeMcpMessage({
  _tag: "Request",
  id: "99",
  tag: Protocol.CLIENT_NOTIFICATION_METHOD_BY_TYPE.ProgressNotification,
  payload: { progressToken: "tok", progress: 1 }
})
assert.deepEqual(encodedClientNotification, {
  jsonrpc: "2.0",
  method: Protocol.CLIENT_NOTIFICATION_METHOD_BY_TYPE.ProgressNotification,
  params: { progressToken: "tok", progress: 1 }
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
