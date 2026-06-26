/**
 * Simple MCP echo server for testing stdio transport.
 * Reads newline-delimited JSON from stdin, responds on stdout.
 *
 * Supports: initialize, ping, tools/list, tools/call,
 * prompts/list, resources/list, logging/setLevel.
 *
 * After receiving notifications/initialized, sends a
 * notifications/tools/list_changed notification to the client.
 */

let buffer = ""

process.stdin.setEncoding("utf8")
process.stdin.on("data", (chunk) => {
  buffer += chunk
  const lines = buffer.split("\n")
  buffer = lines.pop()
  for (const line of lines) {
    if (!line.trim()) continue
    try {
      const msg = JSON.parse(line)
      if (msg.method === "initialize") {
        respond(msg.id, {
          protocolVersion: "2026-07-28",
          capabilities: {
            tools: { listChanged: true },
            prompts: {},
            logging: {}
          },
          serverInfo: {
            name: "test-echo",
            version: "1.0.0"
          },
          instructions: "Test server instructions"
        })
      } else if (msg.method === "ping") {
        respond(msg.id, {})
      } else if (msg.method === "tools/list") {
        respond(msg.id, {
          tools: [
            {
              name: "echo",
              description: "Echoes input",
              inputSchema: {
                type: "object",
                properties: {
                  text: { type: "string" }
                }
              }
            }
          ]
        })
      } else if (msg.method === "tools/call") {
        const args = msg.params?.arguments ?? {}
        respond(msg.id, {
          content: [
            {
              type: "text",
              text: args.text ?? "no input"
            }
          ]
        })
      } else if (msg.method === "prompts/list") {
        respond(msg.id, { prompts: [] })
      } else if (msg.method === "resources/list") {
        respond(msg.id, { resources: [] })
      } else if (msg.method === "logging/setLevel") {
        respond(msg.id, {})
      } else if (
        msg.method === "notifications/initialized"
      ) {
        // After client says initialized, send a
        // tool list changed notification
        notify("notifications/tools/list_changed")
      } else if (msg.method && msg.id != null) {
        respond(msg.id, {})
      }
      // Other notifications (no id) — no response
    } catch {
      // Skip malformed
    }
  }
})

function respond(id, result) {
  const response = JSON.stringify({
    jsonrpc: "2.0",
    id,
    result
  })
  process.stdout.write(response + "\n")
}

function notify(method, params) {
  const notification = JSON.stringify({
    jsonrpc: "2.0",
    method,
    ...(params ? { params } : {})
  })
  process.stdout.write(notification + "\n")
}
