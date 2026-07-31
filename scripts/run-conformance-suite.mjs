import { spawn } from "node:child_process"
import { existsSync, readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"
import path from "node:path"
import * as Effect from "effect/Effect"
import * as NodeRuntime from "@effect/platform-node/NodeRuntime"
import {
  assertCompleteOfficialScenarioInventory,
  collectConformanceArtifactScenarios,
  loadOfficialScenarioInventory
} from "./conformance-inventory.mjs"
import {
  createOutputDir,
  findOpenPort,
  packageManagerPath,
  runCommand,
  runScript,
  waitForReady
} from "./lib/process.mjs"
import { printConformanceIssueSummary } from "./report-conformance-failures.mjs"
import { conformanceEvidencePassed, writeConformanceEvidenceReport } from "./readiness-evidence.mjs"

const __filename = fileURLToPath(import.meta.url)
const root = path.resolve(path.dirname(__filename), "..")
const conformancePackage = path.join(root, "test/conformance")
const conformancePackagePath = path.join(conformancePackage, "package.json")
const conformancePackageName = "@modelcontextprotocol/conformance"
const host = process.env.HOST ?? "127.0.0.1"
const evidenceVariant = process.env.MCP_CONFORMANCE_EVIDENCE_VARIANT
if (evidenceVariant !== undefined && evidenceVariant !== "published") {
  throw new Error(`Unsupported conformance evidence variant: ${evidenceVariant}`)
}
const serverPath = process.env.MCP_CONFORMANCE_SERVER_PATH
  ? path.resolve(root, process.env.MCP_CONFORMANCE_SERVER_PATH)
  : path.join(root, "dist/examples/everything-server.js")
const evidenceName = evidenceVariant === "published" ? "published-conformance" : "conformance"
const evidenceCommand = evidenceVariant === "published" ? "published artifact server-all" : "pnpm run conformance:run"
const suite = "all"
const specVersion = "2026-07-28"
const timeoutMs = Number(process.env.MCP_CONFORMANCE_READY_TIMEOUT_MS ?? "15000")

const runConformanceSuite = Effect.gen(function* () {
  const port = process.env.PORT ?? (yield* Effect.promise(() => findOpenPort(host)))
  const url = `http://${host}:${port}/mcp`
  if (!existsSync(serverPath)) {
    yield* Effect.fail(new Error("Missing built example server. Run `pnpm run build` first."))
  }
  if (!existsSync(conformancePackagePath)) {
    yield* Effect.fail(new Error("Missing test/conformance/package.json."))
  }
  const conformancePackageJson = JSON.parse(readFileSync(conformancePackagePath, "utf8"))
  const conformanceVersion = conformancePackageJson.devDependencies?.[conformancePackageName]
  const outputDir = createOutputDir(suite)
  let server

  try {
    server = startConformanceServer({ root, host, port, serverPath })
    const expectedScenarios = loadOfficialScenarioInventory({
      kind: "server",
      conformancePackage,
      specVersion
    })
    console.log(`Official applicable server inventory: ${expectedScenarios.length} scenarios`)

    yield* Effect.promise(() =>
      waitForReady({
        child: server.process,
        host,
        port,
        url,
        timeoutMs,
        describe: "conformance server",
        readOutput: () => server.output()
      })
    )
    console.log(`Conformance server ready at ${url}`)
    console.log(`Running MCP conformance server suite against ${url}`)
    console.log(`Writing MCP conformance artifacts to ${outputDir}`)

    const harnessExitCode = yield* runCommand(
      packageManagerPath(),
      [
        "--dir",
        conformancePackage,
        "exec",
        "conformance",
        "server",
        "--url",
        url,
        "--suite",
        "all",
        "--spec-version",
        "2026-07-28",
        "--output-dir",
        outputDir
      ],
      root,
      { label: "conformance.server" }
    )

    let result = harnessExitCode
    try {
      assertCompleteOfficialScenarioInventory({
        kind: "server",
        expected: expectedScenarios,
        actual: collectConformanceArtifactScenarios(outputDir)
      })
    } catch (error) {
      result = 1
      console.error(error instanceof Error ? error.message : String(error))
    }
    const evidencePath = writeConformanceEvidenceReport({
      name: evidenceName,
      evidenceKind: "conformance-result",
      command: evidenceCommand,
      exitCode: result,
      requirementIds: ["GR-CONF-001"],
      suite,
      specVersion,
      conformancePackage: {
        name: conformancePackageName,
        version: conformanceVersion
      },
      artifactDir: outputDir,
      preserveByRuntime: evidenceVariant === "published"
    })
    const evidence = JSON.parse(readFileSync(evidencePath, "utf8"))
    console.log(`Writing readiness evidence to ${evidencePath}`)
    printConformanceIssueSummary("MCP conformance server suite", outputDir)
    if (!conformanceEvidencePassed(result, evidence)) {
      yield* Effect.fail(new Error("conformance server suite evidence reported failure"))
    }
  } finally {
    if (server !== undefined) {
      yield* Effect.promise(() => server.cleanup())
    }
  }
})

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  NodeRuntime.runMain(runScript("run-conformance-suite", runConformanceSuite))
}

function startConformanceServer({ root, host, port, serverPath }) {
  const child = spawn(process.execPath, [serverPath], {
    cwd: root,
    env: { ...process.env, HOST: host, PORT: port },
    stdio: ["ignore", "pipe", "pipe"]
  })

  let serverOutput = ""
  const capture = (chunk) => {
    const text = chunk.toString()
    serverOutput += text
    process.stdout.write(text)
  }
  child.stdout.on("data", capture)
  child.stderr.on("data", capture)

  return {
    process: child,
    output: () => serverOutput,
    cleanup: () =>
      new Promise((resolve) => {
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
}
