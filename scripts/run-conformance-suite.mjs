import { spawn } from "node:child_process"
import { existsSync } from "node:fs"
import { fileURLToPath } from "node:url"
import path from "node:path"

const __filename = fileURLToPath(import.meta.url)
const root = path.resolve(path.dirname(__filename), "..")
const conformancePackage = path.join(root, "test/conformance")
const host = process.env.HOST ?? "127.0.0.1"
const port = process.env.PORT ?? "3000"
const url = `http://${host}:${port}/mcp`
const serverPath = path.join(root, "dist/examples/everything-server.js")
const baselinePath = path.join(root, "docs/conformance/expected-failures.yml")
const timeoutMs = Number(process.env.MCP_CONFORMANCE_READY_TIMEOUT_MS ?? "15000")

if (!existsSync(serverPath)) {
  console.error("Missing built example server. Run `pnpm run build` first.")
  process.exit(1)
}

if (!existsSync(path.join(conformancePackage, "package.json"))) {
  console.error("Missing test/conformance/package.json.")
  process.exit(1)
}

const server = spawn(process.execPath, [serverPath], {
  cwd: root,
  env: { ...process.env, HOST: host, PORT: port },
  stdio: ["ignore", "pipe", "pipe"]
})

let serverOutput = ""
server.stdout.on("data", (chunk) => {
  const text = chunk.toString()
  serverOutput += text
  process.stdout.write(text)
})
server.stderr.on("data", (chunk) => {
  const text = chunk.toString()
  serverOutput += text
  process.stderr.write(text)
})

const cleanup = () =>
  new Promise((resolve) => {
    if (server.killed || server.exitCode !== null) {
      resolve()
      return
    }
    const timer = setTimeout(() => {
      server.kill("SIGKILL")
      resolve()
    }, 5000)
    server.once("exit", () => {
      clearTimeout(timer)
      resolve()
    })
    server.kill("SIGTERM")
  })

try {
  await waitForReady()
  console.log(`Running MCP conformance server suite against ${url}`)
  const result = await run(packageManagerPath(), [
    "--dir",
    conformancePackage,
    "exec",
    "conformance",
    "server",
    "--url",
    url,
    "--suite",
    process.env.MCP_CONFORMANCE_SUITE ?? "active",
    "--expected-failures",
    baselinePath
  ], root)
  await cleanup()
  process.exit(result)
} catch (error) {
  await cleanup()
  console.error(error instanceof Error ? error.message : String(error))
  process.exit(1)
}

function waitForReady() {
  return new Promise((resolve, reject) => {
    const started = Date.now()
    const timer = setInterval(async () => {
      if (server.exitCode !== null) {
        clearInterval(timer)
        reject(new Error(`Server exited before readiness. Output:\n${serverOutput}`))
        return
      }
      try {
        const response = await fetch(url, { method: "GET" })
        if (response.status === 405) {
          clearInterval(timer)
          console.log(`Conformance server ready at ${url}`)
          resolve()
          return
        }
      } catch {
        // Retry until timeout.
      }
      if (Date.now() - started > timeoutMs) {
        clearInterval(timer)
        reject(new Error(`Timed out waiting for conformance server at ${url}`))
      }
    }, 250)
  })
}

function run(command, args, cwd) {
  return new Promise((resolve) => {
    const child = spawn(command, args, {
      cwd,
      stdio: "inherit"
    })
    child.on("exit", (code) => resolve(code ?? 1))
  })
}

function packageManagerPath() {
  return process.platform === "win32" ? "pnpm.cmd" : "pnpm"
}
