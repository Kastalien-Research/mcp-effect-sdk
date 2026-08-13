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
import { createOutputDir, packageManagerPath, runCommand, runScript } from "./lib/process.mjs"
import { printConformanceIssueSummary } from "./report-conformance-failures.mjs"
import { conformanceEvidencePassed, writeConformanceEvidenceReport } from "./readiness-evidence.mjs"

const __filename = fileURLToPath(import.meta.url)
const root = path.resolve(path.dirname(__filename), "..")
const conformancePackage = path.join(root, "test/conformance")
const conformancePackagePath = path.join(conformancePackage, "package.json")
const conformancePackageName = "@modelcontextprotocol/conformance"
const expectedConformanceVersion = "0.2.0-alpha.10"
const evidenceVariant = process.env.MCP_CONFORMANCE_EVIDENCE_VARIANT
if (evidenceVariant !== undefined && evidenceVariant !== "published") {
  throw new Error(`Unsupported conformance evidence variant: ${evidenceVariant}`)
}
const clientPath = process.env.MCP_CONFORMANCE_CLIENT_PATH
  ? path.resolve(root, process.env.MCP_CONFORMANCE_CLIENT_PATH)
  : path.join(root, "dist/examples/everything-client-2025.js")
const evidenceName =
  evidenceVariant === "published" ? "published-conformance-client-2025-11-25" : "conformance-client-2025-11-25"
const evidenceCommand =
  evidenceVariant === "published" ? "published artifact client-2025-11-25" : "pnpm run conformance:client:2025-11-25"
const specVersion = "2025-11-25"
const outputDir = createOutputDir("client-2025-11-25")

const conformancePackageJson = existsSync(conformancePackagePath)
  ? JSON.parse(readFileSync(conformancePackagePath, "utf8"))
  : {}
const conformanceVersion = conformancePackageJson.devDependencies?.[conformancePackageName]
const expectedScenarios = loadOfficialScenarioInventory({
  kind: "client",
  conformancePackage,
  specVersion
}).filter((scenario) => !scenario.startsWith("auth/"))
const command = `${process.execPath} ${clientPath}`

const runConformanceClient = Effect.gen(function* () {
  if (!existsSync(clientPath)) {
    yield* Effect.fail(new Error("Missing built everything client. Run `pnpm run build` first."))
  }
  if (!existsSync(conformancePackagePath)) {
    yield* Effect.fail(new Error("Missing test/conformance/package.json."))
  }
  if (conformanceVersion !== expectedConformanceVersion) {
    yield* Effect.fail(
      new Error(
        `Expected ${conformancePackageName}@${expectedConformanceVersion}; received ${String(conformanceVersion)}`
      )
    )
  }

  console.log(`Running all ${expectedScenarios.length} applicable MCP conformance client scenarios`)
  console.log(`MCP conformance spec version: ${specVersion}`)
  console.log(`Client command: ${command}`)
  console.log(`Writing MCP conformance artifacts to ${outputDir}`)

  const exitCodes = yield* Effect.forEach(
    expectedScenarios,
    (scenario) =>
      runCommand(
        packageManagerPath(),
        [
          "--dir",
          conformancePackage,
          "exec",
          "conformance",
          "client",
          "--scenario",
          scenario,
          "--spec-version",
          specVersion,
          "--command",
          command,
          "--output-dir",
          outputDir
        ],
        root,
        { label: `conformance.client.${scenario}` }
      ),
    { concurrency: 4 }
  )
  const harnessExitCode = exitCodes.some((exitCode) => exitCode !== 0) ? 1 : 0

  let result = harnessExitCode
  try {
    assertCompleteOfficialScenarioInventory({
      kind: "client",
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
    suite: "client-2025-11-25",
    specVersion,
    conformancePackage: {
      name: conformancePackageName,
      version: conformanceVersion
    },
    artifactDir: outputDir,
    preserveByRuntime: true
  })
  const evidence = JSON.parse(readFileSync(evidencePath, "utf8"))
  console.log(`Writing readiness evidence to ${evidencePath}`)
  printConformanceIssueSummary("MCP conformance complete client suite", outputDir)
  if (!conformanceEvidencePassed(result, evidence)) {
    yield* Effect.fail(new Error("MCP conformance client evidence reported failure"))
  }
})

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  NodeRuntime.runMain(runScript("run-conformance-client-2025", runConformanceClient))
}
