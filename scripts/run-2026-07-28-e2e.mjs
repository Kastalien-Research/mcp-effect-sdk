// Self-hosted MCP 2026-07-28 end-to-end harness.
//
// This harness is package-health evidence, not MCP conformance qualification.
// It starts the example server (`dist/examples/everything-server.js`) on an
// ephemeral localhost port and drives it with the example client
// (`dist/examples/everything-client.js`) over Streamable HTTP.
//
// It exercises every read-only request surface the example server supports
// (discover, tools/list, tools/call, resources/list, resources/read,
// prompts/list, prompts/get) and asserts success + non-empty results. The
// The `stable_e2e` client scenario performs those assertions in-process; this harness
// additionally runs the `tools_call` scenario as a second case.
//
// Readiness evidence is written to `.local/readiness-evidence/2026-07-28-e2e.json`
// so local E2E cannot be mistaken for official MCP conformance evidence.
//
// See docs/migration-2026-07-28.md.

import { spawn } from "node:child_process"
import { existsSync, writeFileSync } from "node:fs"
import * as Effect from "effect/Effect"
import * as NodeRuntime from "@effect/platform-node/NodeRuntime"
import { fileURLToPath } from "node:url"
import path from "node:path"
import { findOpenPort, runScript, waitForReady } from "./lib/process.mjs"
import { readinessEvidencePath } from "./readiness-evidence.mjs"

const __filename = fileURLToPath(import.meta.url)
const root = path.resolve(path.dirname(__filename), "..")
const host = process.env.HOST ?? "127.0.0.1"
const serverPath = path.join(root, "dist/examples/everything-server.js")
const clientPath = path.join(root, "dist/examples/everything-client.js")
const timeoutMs = Number(process.env.MCP_2026_07_28_E2E_READY_TIMEOUT_MS ?? "15000")

// Each scenario exercises a slice of the released request surface and asserts
// success + non-empty results (the assertions live in the client scenarios).
const scenarios = [
  {
    id: "stable-e2e",
    scenario: "stable_e2e",
    name: "stable_e2e",
    description: [
      "discover + tools/list + tools/call + resources/list + resources/read",
      "+ prompts/list + prompts/get over Streamable HTTP"
    ].join(" ")
  },
  {
    id: "stable-tools-call",
    scenario: "stable_tools_call",
    name: "stable_tools_call",
    description: "tools/list + tools/call non-empty content over Streamable HTTP"
  }
]

const runE2eSuite = Effect.gen(function* () {
  const port = process.env.PORT ?? (yield* Effect.promise(() => findOpenPort(host)))
  const url = `http://${host}:${port}/mcp`

  if (!existsSync(serverPath)) {
    yield* Effect.fail(new Error("Missing built example server. Run `pnpm run build` first."))
  }
  if (!existsSync(clientPath)) {
    yield* Effect.fail(new Error("Missing built example client. Run `pnpm run build` first."))
  }

  const server = startServer({ root, host, port, serverPath })
  try {
    yield* Effect.promise(() =>
      waitForReady({
        child: server.process,
        host,
        port,
        url,
        timeoutMs,
        describe: "2026-07-28 e2e server",
        readOutput: () => server.output
      })
    )

    console.log(`MCP 2026-07-28 e2e server ready at ${url}`)
    console.log(`Running self-hosted MCP 2026-07-28 e2e against ${url}`)

    const results = []
    for (const scenario of scenarios) {
      const exitCode = yield* runScenario({ clientPath, root, scenario: scenario.name, url })
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
    writeEvidence(exitCode, results)
    if (exitCode !== 0) {
      yield* Effect.fail(new Error("2026-07-28 e2e scenario suite failed"))
    }
  } catch (error) {
    try {
      writeEvidence(1, [])
    } catch {
      // ignore evidence write failures during error handling
    }
    yield* Effect.fail(error)
  } finally {
    yield* Effect.promise(() => cleanup(server.process))
  }
})

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  NodeRuntime.runMain(runScript("run-2026-07-28-e2e", runE2eSuite))
}

function runScenario({ clientPath, root, scenario, url }) {
  return Effect.async((resume) => {
    const child = spawn(process.execPath, [clientPath, url], {
      cwd: root,
      env: { ...process.env, MCP_CONFORMANCE_SCENARIO: scenario },
      stdio: "inherit"
    })

    const handleError = (error) => {
      resume(Effect.fail(error))
    }

    child.once("error", handleError)
    child.once("exit", (code) => {
      resume(Effect.succeed(code ?? 1))
    })

    return () => {
      if (child.exitCode === null) child.kill("SIGTERM")
    }
  })
}

function startServer({ root, host, port, serverPath }) {
  const server = spawn(process.execPath, [serverPath], {
    cwd: root,
    env: { ...process.env, HOST: host, PORT: String(port) },
    stdio: ["ignore", "pipe", "pipe"]
  })

  let serverOutput = ""
  const capture = (chunk) => {
    const text = chunk.toString()
    serverOutput += text
    process.stdout.write(text)
  }
  server.stdout.on("data", capture)
  server.stderr.on("data", capture)

  return {
    process: server,
    output: () => serverOutput
  }
}

function cleanup(child) {
  return new Promise((resolve) => {
    if (child.killed || child.exitCode !== null) {
      resolve()
      return
    }
    const timer = setTimeout(() => {
      child.kill("SIGKILL")
      resolve()
    }, 5000)
    child.once("exit", () => {
      clearTimeout(timer)
      resolve()
    })
    child.kill("SIGTERM")
  })
}

function writeEvidence(exitCode, results) {
  const checkCount = results.reduce((acc, r) => acc + r.checkCount, 0)
  const failureCount = results.reduce((acc, r) => acc + r.failureCount, 0)
  const warningCount = results.reduce((acc, r) => acc + r.warningCount, 0)
  const report = {
    evidenceKind: "e2e-result",
    timestamp: new Date().toISOString(),
    command: "pnpm run e2e:2026-07-28",
    exitCode,
    summary: {
      suite: "2026-07-28-e2e",
      scenarioCount: results.length,
      checkCount,
      failureCount,
      warningCount
    },
    requirementIds: ["GR-TEST-004"],
    suite: "2026-07-28-e2e",
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
        message: `Self-hosted MCP 2026-07-28 scenario ${r.scenario} failed`,
        specReferences: []
      }))
  }
  const evidencePath = readinessEvidencePath("2026-07-28-e2e")
  writeFileSync(evidencePath, `${JSON.stringify(report, null, 2)}\n`)
  return evidencePath
}
