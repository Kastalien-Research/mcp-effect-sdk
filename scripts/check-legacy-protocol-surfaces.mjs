import assert from "node:assert/strict"
import * as Protocol from "../dist/generated/mcp/2025-11-25/McpProtocol.generated.js"

const expectedClientRequests = [
  "ping",
  "initialize",
  "completion/complete",
  "logging/setLevel",
  "prompts/get",
  "prompts/list",
  "resources/list",
  "resources/templates/list",
  "resources/read",
  "resources/subscribe",
  "resources/unsubscribe",
  "tools/call",
  "tools/list",
  "tasks/get",
  "tasks/result",
  "tasks/list",
  "tasks/cancel"
]
const expectedServerRequests = [
  "ping",
  "sampling/createMessage",
  "roots/list",
  "elicitation/create",
  "tasks/get",
  "tasks/result",
  "tasks/list",
  "tasks/cancel"
]
const expectedClientNotifications = [
  "notifications/cancelled",
  "notifications/progress",
  "notifications/initialized",
  "notifications/roots/list_changed",
  "notifications/tasks/status"
]
const expectedServerNotifications = [
  "notifications/cancelled",
  "notifications/progress",
  "notifications/message",
  "notifications/resources/updated",
  "notifications/resources/list_changed",
  "notifications/tools/list_changed",
  "notifications/prompts/list_changed",
  "notifications/elicitation/complete",
  "notifications/tasks/status"
]

assert.deepEqual([...Protocol.CLIENT_REQUEST_METHODS], expectedClientRequests)
assert.deepEqual([...Protocol.SERVER_REQUEST_METHODS], expectedServerRequests)
assert.deepEqual([...Protocol.CLIENT_NOTIFICATION_METHODS], expectedClientNotifications)
assert.deepEqual([...Protocol.SERVER_NOTIFICATION_METHODS], expectedServerNotifications)

for (const method of expectedClientRequests) {
  assert.equal(Protocol.isClientRequestMethod(method), true)
  assert.ok(Protocol.CLIENT_REQUEST_PAYLOAD_CODEC_BY_METHOD[method])
  assert.ok(Protocol.CLIENT_REQUEST_RESULT_CODEC_BY_METHOD[method])
}
for (const method of expectedServerRequests) {
  assert.equal(Protocol.isServerRequestMethod(method), true)
  assert.ok(Protocol.SERVER_REQUEST_PAYLOAD_CODEC_BY_METHOD[method])
  assert.ok(Protocol.SERVER_REQUEST_RESULT_CODEC_BY_METHOD[method])
}
for (const method of expectedClientNotifications) {
  assert.equal(Protocol.isClientNotificationMethod(method), true)
  assert.ok(Protocol.CLIENT_NOTIFICATION_PAYLOAD_CODEC_BY_METHOD[method])
}
for (const method of expectedServerNotifications) {
  assert.equal(Protocol.isServerNotificationMethod(method), true)
  assert.ok(Protocol.SERVER_NOTIFICATION_PAYLOAD_CODEC_BY_METHOD[method])
}

console.log("MCP 2025-11-25 generated protocol inventory is complete.")
