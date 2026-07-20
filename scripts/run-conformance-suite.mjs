import { spawn } from "node:child_process"
import { existsSync, mkdirSync, readFileSync } from "node:fs"
import { createConnection, createServer } from "node:net"
import { fileURLToPath } from "node:url"
import path from "node:path"
import { printConformanceIssueSummary } from "./report-conformance-failures.mjs"
import {
  conformanceEvidencePassed,
  writeConformanceEvidenceReport
} from "./readiness-evidence.mjs"

const __filename = fileURLToPath(import.meta.url)
const root = path.resolve(path.dirname(__filename), "..")
const conformancePackage = path.join(root, "test/conformance")
const conformancePackagePath = path.join(conformancePackage, "package.json")
const conformancePackageName = "@modelcontextprotocol/conformance"
const host = process.env.HOST ?? "127.0.0.1"
const port = process.env.PORT ?? await findOpenPort(host)
const url = `http://${host}:${port}/mcp`
const serverPath = path.join(root, "dist/examples/everything-server.js")
const suite = process.env.MCP_CONFORMANCE_SUITE ?? "draft"
const specVersion = "2026-07-28"
const outputDir = createOutputDir(suite)
const timeoutMs = Number(process.env.MCP_CONFORMANCE_READY_TIMEOUT_MS ?? "15000")

if (!existsSync(serverPath)) {
  console.error("Missing built example server. Run `pnpm run build` first.")
  process.exit(1)
}

if (!existsSync(conformancePackagePath)) {
  console.error("Missing test/conformance/package.json.")
  process.exit(1)
}

const conformancePackageJson = JSON.parse(readFileSync(conformancePackagePath, "utf8"))
const conformanceVersion = conformancePackageJson.devDependencies?.[conformancePackageName]

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
  console.log(`Writing MCP conformance artifacts to ${outputDir}`)
  const result = await run(packageManagerPath(), [
    "--dir",
    conformancePackage,
    "exec",
    "conformance",
    "server",
    "--url",
    url,
    "--suite",
    suite,
    "--spec-version",
    "2026-07-28",
    "--output-dir",
    outputDir
  ], root)
  const evidencePath = writeConformanceEvidenceReport({
    name: "conformance",
    evidenceKind: "conformance-result",
    command: "pnpm run conformance:run",
    exitCode: result,
    requirementIds: ["GR-CONF-001"],
    suite,
    specVersion,
    conformancePackage: {
      name: conformancePackageName,
      version: conformanceVersion
    },
    artifactDir: outputDir
  })
  const evidence = JSON.parse(readFileSync(evidencePath, "utf8"))
  console.log(`Writing readiness evidence to ${evidencePath}`)
  printConformanceIssueSummary("MCP conformance server suite", outputDir)
  await cleanup()
  process.exit(conformanceEvidencePassed(result, evidence) ? 0 : 1)
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
      const ready = await canConnect(host, Number(port))
      if (ready) {
        clearInterval(timer)
        console.log(`Conformance server ready at ${url}`)
        resolve()
        return
      }
      if (Date.now() - started > timeoutMs) {
        clearInterval(timer)
        reject(new Error(`Timed out waiting for conformance server at ${url}`))
      }
    }, 250)
  })
}

function canConnect(connectHost, connectPort) {
  return new Promise((resolve) => {
    const socket = createConnection({ host: connectHost, port: connectPort })
    socket.once("connect", () => {
      socket.destroy()
      resolve(true)
    })
    socket.once("error", () => {
      socket.destroy()
      resolve(false)
    })
    socket.setTimeout(500, () => {
      socket.destroy()
      resolve(false)
    })
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

function createOutputDir(suiteName) {
  const rootDir = process.env.MCP_CONFORMANCE_OUTPUT_DIR
    ? path.resolve(root, process.env.MCP_CONFORMANCE_OUTPUT_DIR)
    : path.join(root, ".local", "conformance")
  const timestamp = new Date().toISOString().replaceAll(":", "-").replaceAll(".", "-")
  const safeSuiteName = suiteName.replace(/[^a-z0-9_-]/gi, "-")
  const runDir = path.join(rootDir, `${safeSuiteName}-${timestamp}`)
  mkdirSync(runDir, { recursive: true })
  return runDir
}

function findOpenPort(listenHost) {
  return new Promise((resolve, reject) => {
    const server = createServer()
    server.once("error", reject)
    server.listen(0, listenHost, () => {
      const address = server.address()
      if (!address || typeof address !== "object") {
        server.close(() => reject(new Error("Unable to allocate a localhost port")))
        return
      }
      const allocatedPort = String(address.port)
      server.close(() => resolve(allocatedPort))
    })
  })
}
