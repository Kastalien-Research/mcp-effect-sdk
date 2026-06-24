// Self-hosted MCP 2026-07-28 (stateless draft) end-to-end harness.
//
// The external @modelcontextprotocol/conformance CLI only supports the
// 2025-* protocol versions and performs an `initialize` handshake, so it cannot
// validate a stateless draft server. This harness replaces it with a self-hosted
// round-trip: our draft server (`dist/examples/everything-server.js`) is started
// on an ephemeral localhost port and driven by our draft client
// (`dist/examples/everything-client.js`) over Streamable HTTP.
//
// It exercises every read-only request surface the draft server supports
// (discover, tools/list, tools/call, resources/list, resources/read,
// prompts/list, prompts/get) and asserts success + non-empty results. The
// `draft_e2e` client scenario performs those assertions in-process; this harness
// additionally runs the `tools_call` scenario as a second case.
//
// Readiness evidence is written to `.local/readiness-evidence/conformance.json`
// in the same shape `run-readiness-test-suite.mjs` (e2e) consumes, so
// `check:conformance-evidence` and the e2e gate stay green.
//
// See docs/draft-2026-07-28-migration.md.
import { spawn } from "node:child_process"
import { existsSync, writeFileSync } from "node:fs"
import { createConnection, createServer } from "node:net"
import { fileURLToPath } from "node:url"
import path from "node:path"
import { readinessEvidencePath } from "./readiness-evidence.mjs"

const __filename = fileURLToPath(import.meta.url)
const root = path.resolve(path.dirname(__filename), "..")
const host = process.env.HOST ?? "127.0.0.1"
const port = process.env.PORT ?? (await findOpenPort(host))
const url = `http://${host}:${port}/mcp`
const serverPath = path.join(root, "dist/examples/everything-server.js")
const clientPath = path.join(root, "dist/examples/everything-client.js")
const timeoutMs = Number(process.env.MCP_DRAFT_E2E_READY_TIMEOUT_MS ?? "15000")

// Each scenario exercises a slice of the draft request surface and asserts
// success + non-empty results (the assertions live in the client scenarios).
const scenarios = [
  {
    id: "draft-round-trip",
    scenario: "draft-round-trip",
    name: "draft_e2e",
    description:
      "discover + tools/list + tools/call + resources/list + resources/read + prompts/list + prompts/get over Streamable HTTP"
  },
  {
    id: "tools-call",
    scenario: "tools-call",
    name: "tools_call",
    description: "tools/list + tools/call non-empty content over Streamable HTTP"
  }
]

if (!existsSync(serverPath)) {
  console.error("Missing built example server. Run `pnpm run build` first.")
  process.exit(1)
}
if (!existsSync(clientPath)) {
  console.error("Missing built example client. Run `pnpm run build` first.")
  process.exit(1)
}

const server = spawn(process.execPath, [serverPath], {
  cwd: root,
  env: { ...process.env, HOST: host, PORT: String(port) },
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
  console.log(`Running self-hosted MCP 2026-07-28 draft e2e against ${url}`)

  const results = []
  for (const scenario of scenarios) {
    const exitCode = await runScenario(scenario.name)
    const status = exitCode === 0 ? "pass" : "fail"
    console.log(`  scenario ${scenario.scenario}: ${status} (exit ${exitCode})`)
    results.push({
      id: scenario.id,
      scenario: scenario.scenario,
      description: scenario.description,
      checkCount: 1,
      failureCount: exitCode === 0 ? 0 : 1,
      warningCount: 0,
      status
    })
  }

  const failureCount = results.reduce((acc, r) => acc + r.failureCount, 0)
  const exitCode = failureCount === 0 ? 0 : 1
  const evidencePath = writeEvidence(exitCode, results)
  console.log(`Writing readiness evidence to ${evidencePath}`)
  await cleanup()
  process.exit(exitCode)
} catch (error) {
  await cleanup()
  console.error(error instanceof Error ? error.message : String(error))
  // Best-effort failing evidence so the e2e gate has a record to read.
  try {
    writeEvidence(1, [])
  } catch {
    // ignore evidence write failures during error handling
  }
  process.exit(1)
}

function runScenario(scenarioName) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [clientPath, url], {
      cwd: root,
      env: { ...process.env, MCP_CONFORMANCE_SCENARIO: scenarioName },
      stdio: "inherit"
    })
    child.on("exit", (code) => resolve(code ?? 1))
  })
}

function writeEvidence(exitCode, results) {
  const checkCount = results.reduce((acc, r) => acc + r.checkCount, 0)
  const failureCount = results.reduce((acc, r) => acc + r.failureCount, 0)
  const warningCount = results.reduce((acc, r) => acc + r.warningCount, 0)
  const report = {
    evidenceKind: "conformance-result",
    timestamp: new Date().toISOString(),
    command: "pnpm run e2e:draft",
    exitCode,
    summary: {
      suite: "draft-e2e",
      scenarioCount: results.length,
      checkCount,
      failureCount,
      warningCount
    },
    requirementIds: ["GR-CONF-001"],
    suite: "draft-e2e",
    artifactDir: ".local/readiness-evidence",
    scenarioCount: results.length,
    checkCount,
    failureCount,
    warningCount,
    scenarios: results,
    failedChecks: results
      .filter((r) => r.status !== "pass")
      .map((r) => ({
        scenario: r.scenario,
        id: r.id,
        name: r.scenario,
        message: `Self-hosted draft scenario ${r.scenario} failed`,
        specReferences: []
      }))
  }
  const evidencePath = readinessEvidencePath("conformance")
  writeFileSync(evidencePath, `${JSON.stringify(report, null, 2)}\n`)
  return evidencePath
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
        console.log(`Draft e2e server ready at ${url}`)
        resolve()
        return
      }
      if (Date.now() - started > timeoutMs) {
        clearInterval(timer)
        reject(new Error(`Timed out waiting for draft e2e server at ${url}`))
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

function findOpenPort(listenHost) {
  return new Promise((resolve, reject) => {
    const probe = createServer()
    probe.once("error", reject)
    probe.listen(0, listenHost, () => {
      const address = probe.address()
      if (!address || typeof address !== "object") {
        probe.close(() => reject(new Error("Unable to allocate a localhost port")))
        return
      }
      const allocatedPort = String(address.port)
      probe.close(() => resolve(allocatedPort))
    })
  })
}
