import { spawn } from "node:child_process"
import { existsSync, readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"
import path from "node:path"
import {
  assertCompleteOfficialScenarioInventory,
  collectConformanceArtifactScenarios,
  loadOfficialScenarioInventory
} from "./conformance-inventory.mjs"
import { createOutputDir, findOpenPort, packageManagerPath, run, waitForReady } from "./lib/process.mjs"
import { printConformanceIssueSummary } from "./report-conformance-failures.mjs"
import { conformanceEvidencePassed, writeConformanceEvidenceReport } from "./readiness-evidence.mjs"

const __filename = fileURLToPath(import.meta.url)
const root = path.resolve(path.dirname(__filename), "..")
const conformancePackage = path.join(root, "test/conformance")
const conformancePackagePath = path.join(conformancePackage, "package.json")
const conformancePackageName = "@modelcontextprotocol/conformance"
const host = process.env.HOST ?? "127.0.0.1"
const port = process.env.PORT ?? (await findOpenPort(host))
const url = `http://${host}:${port}/mcp`
const serverPath = path.join(root, "dist/examples/everything-server.js")
const suite = "all"
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
  await waitForReady({
    child: server,
    host,
    port,
    url,
    timeoutMs,
    describe: "conformance server",
    readOutput: () => serverOutput
  })
  console.log(`Conformance server ready at ${url}`)
  console.log(`Running MCP conformance server suite against ${url}`)
  console.log(`Writing MCP conformance artifacts to ${outputDir}`)
  const expectedScenarios = loadOfficialScenarioInventory({
    kind: "server",
    conformancePackage,
    specVersion
  })
  console.log(`Official applicable server inventory: ${expectedScenarios.length} scenarios`)
  const harnessExitCode = await run(
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
    root
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
