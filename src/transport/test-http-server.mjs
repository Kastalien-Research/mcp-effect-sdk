/**
 * MCP Streamable HTTP test server.
 *
 * Listens on a random port and prints PORT=XXXX to stderr.
 * Implements enough of the MCP Streamable HTTP protocol to test:
 * - POST with JSON response (initialize, ping, tools/list, etc.)
 * - POST with SSE response (tools/call)
 * - Session ID management (assign on init, validate after)
 * - 404 on expired/invalid session IDs
 * - 202 for notifications
 * - notifications/initialized triggers server push notification
 */

import { createServer } from "node:http"
import { randomUUID } from "node:crypto"

let activeSessionId = null

const server = createServer((req, res) => {
  // DELETE → session termination (accept but no-op)
  if (req.method === "DELETE") {
    activeSessionId = null
    res.writeHead(200)
    res.end()
    return
  }

  // GET → SSE stream (return 405 for now — deferred)
  if (req.method === "GET") {
    res.writeHead(405, { "Content-Type": "text/plain" })
    res.end("GET SSE not supported")
    return
  }

  if (req.method !== "POST") {
    res.writeHead(405, { "Content-Type": "text/plain" })
    res.end("Method not allowed")
    return
  }

  // Collect body
  let body = ""
  req.on("data", (chunk) => {
    body += chunk.toString()
  })

  req.on("end", () => {
    let msg
    try {
      msg = JSON.parse(body)
    } catch {
      res.writeHead(400, { "Content-Type": "text/plain" })
      res.end("Invalid JSON")
      return
    }

    // Session validation (skip for initialize)
    if (msg.method !== "initialize" && activeSessionId) {
      const clientSession = req.headers["mcp-session-id"]
      if (clientSession !== activeSessionId) {
        res.writeHead(404, { "Content-Type": "text/plain" })
        res.end("Session expired")
        return
      }
    }

    handleMessage(msg, req, res)
  })
})

function handleMessage(msg, req, res) {
  // Notifications → 202 (no body)
  if (msg.method && msg.id == null) {
    if (msg.method === "notifications/initialized") {
      // Send a server notification as SSE after initialized
      // (We'd do this via the GET stream in a real server,
      //  but for testing POST-based flow, just accept it.)
    }
    res.writeHead(202)
    res.end()
    return
  }

  if (msg.method === "initialize") {
    activeSessionId = randomUUID()
    const result = {
      protocolVersion: "2025-11-25",
      capabilities: {
        tools: { listChanged: true },
        prompts: {},
        logging: {}
      },
      serverInfo: {
        name: "test-http",
        version: "1.0.0"
      },
      instructions: "Test HTTP server instructions"
    }
    respondJson(res, msg.id, result, {
      "mcp-session-id": activeSessionId
    })
    return
  }

  if (msg.method === "ping") {
    respondJson(res, msg.id, {})
    return
  }

  if (msg.method === "tools/list") {
    respondJson(res, msg.id, {
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
    return
  }

  if (msg.method === "tools/call") {
    const args = msg.params?.arguments ?? {}
    const toolName = msg.params?.name ?? ""

    // "multi-sse" tool: respond with multiple SSE events
    if (toolName === "multi-sse") {
      respondMultiSse(res, msg.id)
      return
    }

    // "multiline-data" tool: respond with multi-line data:
    if (toolName === "multiline-data") {
      respondMultilineDataSse(res, msg.id)
      return
    }

    // "unknown-tool" → JSON-RPC error response
    if (toolName === "unknown-tool") {
      respondJsonRpcError(res, msg.id, -32601, "Tool not found")
      return
    }

    const result = {
      content: [
        {
          type: "text",
          text: args.text ?? "no input"
        }
      ]
    }
    // Respond via SSE to test SSE parsing
    respondSse(res, msg.id, result)
    return
  }

  if (msg.method === "prompts/list") {
    respondJson(res, msg.id, { prompts: [] })
    return
  }

  if (msg.method === "resources/list") {
    respondJson(res, msg.id, { resources: [] })
    return
  }

  if (msg.method === "logging/setLevel") {
    respondJson(res, msg.id, {})
    return
  }

  // Unknown method with id → empty result
  if (msg.id != null) {
    respondJson(res, msg.id, {})
    return
  }

  res.writeHead(202)
  res.end()
}

function respondJson(res, id, result, extraHeaders = {}) {
  const body = JSON.stringify({
    jsonrpc: "2.0",
    id,
    result
  })
  res.writeHead(200, {
    "Content-Type": "application/json",
    ...extraHeaders
  })
  res.end(body)
}

function respondSse(res, id, result) {
  res.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache",
    Connection: "keep-alive"
  })
  const data = JSON.stringify({
    jsonrpc: "2.0",
    id,
    result
  })
  res.write(`event: message\ndata: ${data}\n\n`)
  res.end()
}

function respondMultiSse(res, id) {
  res.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache",
    Connection: "keep-alive"
  })
  // First event: a notification
  const notif = JSON.stringify({
    jsonrpc: "2.0",
    method: "notifications/progress",
    params: {
      progressToken: "tok-1",
      progress: 50,
      total: 100
    }
  })
  res.write(`event: message\ndata: ${notif}\n\n`)
  // Second event: the actual result
  const result = JSON.stringify({
    jsonrpc: "2.0",
    id,
    result: {
      content: [{ type: "text", text: "multi-sse-done" }]
    }
  })
  res.write(`event: message\ndata: ${result}\n\n`)
  res.end()
}

function respondMultilineDataSse(res, id) {
  res.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache",
    Connection: "keep-alive"
  })
  // Per SSE spec, consecutive data: lines within one block
  // are concatenated with "\n". Since "\n" is valid JSON
  // whitespace between structural tokens, we split the JSON
  // at a property boundary so the concatenated result parses.
  const part1 = `{"jsonrpc":"2.0","id":${id},`
  const part2 = `"result":{"content":[{"type":"text","text":"multiline-ok"}]}}`
  res.write(`event: message\ndata: ${part1}\ndata: ${part2}\n\n`)
  res.end()
}

function respondJsonRpcError(res, id, code, message) {
  const body = JSON.stringify({
    jsonrpc: "2.0",
    id,
    error: { code, message }
  })
  res.writeHead(200, { "Content-Type": "application/json" })
  res.end(body)
}

server.listen(0, "127.0.0.1", () => {
  const addr = server.address()
  process.stderr.write(`PORT=${addr.port}\n`)
})

// Shut down cleanly on SIGTERM
process.on("SIGTERM", () => {
  server.close()
  process.exit(0)
})
