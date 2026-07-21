import assert from "node:assert/strict"
import { once } from "node:events"
import { createServer } from "node:net"
import { spawn } from "node:child_process"
import { test } from "node:test"

const request = async (url, id, method, params = {}) => {
  const response = await fetch(url, {
    method: "POST",
    headers: {
      accept: "application/json, text/event-stream",
      "content-type": "application/json",
      "mcp-method": method,
      "mcp-protocol-version": "2026-07-28"
    },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id,
      method,
      params: {
        ...params,
        _meta: {
          "io.modelcontextprotocol/protocolVersion": "2026-07-28",
          "io.modelcontextprotocol/clientCapabilities": {}
        }
      }
    })
  })
  return response.json()
}

const reservePort = async () => {
  const server = createServer()
  server.listen(0, "127.0.0.1")
  await once(server, "listening")
  const address = server.address()
  assert.equal(typeof address, "object")
  assert.ok(address)
  const { port } = address
  server.close()
  await once(server, "close")
  return port
}

const startEverythingServer = async () => {
  const port = await reservePort()
  const child = spawn(process.execPath, ["dist/examples/everything-server.js"], {
    env: { ...process.env, HOST: "127.0.0.1", PORT: String(port) },
    stdio: ["ignore", "pipe", "pipe"]
  })
  const output = []
  child.stdout.on("data", (chunk) => output.push(chunk.toString()))
  child.stderr.on("data", (chunk) => output.push(chunk.toString()))
  await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error(output.join(""))), 5_000)
    child.stdout.on("data", (chunk) => {
      if (chunk.toString().includes("everything server running")) {
        clearTimeout(timeout)
        resolve()
      }
    })
    child.once("error", reject)
    child.once("exit", (code) => reject(new Error(`Everything server exited with ${code}: ${output.join("")}`)))
  })
  return { child, url: `http://127.0.0.1:${port}/mcp` }
}

test("Everything server advertises the optional header_probe value schema", async (t) => {
  const { child, url } = await startEverythingServer()
  t.after(() => child.kill("SIGTERM"))

  const listed = await request(url, 1, "tools/list")
  assert.ok(listed.result, JSON.stringify(listed))
  const tool = listed.result.tools.find(({ name }) => name === "header_probe")

  assert.ok(tool)
  assert.deepEqual(tool.inputSchema.properties.value, {
    type: "string",
    "x-mcp-header": "Value"
  })
  assert.deepEqual(tool.inputSchema.required, [])
})
