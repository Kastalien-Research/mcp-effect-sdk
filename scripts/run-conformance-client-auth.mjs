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
  : path.join(root, "dist/examples/everything-client.js")
const evidenceName = evidenceVariant === "published" ? "published-conformance-client-auth" : "conformance-client-auth"
const evidenceCommand =
  evidenceVariant === "published" ? "published artifact client-auth" : "pnpm run conformance:client-auth"
const specVersion = "2026-07-28"
const outputDir = createOutputDir("client-auth")

const expectedScenarios = [
  "auth/metadata-default",
  "auth/metadata-var1",
  "auth/metadata-var2",
  "auth/metadata-var3",
  "auth/basic-cimd",
  "auth/scope-from-www-authenticate",
  "auth/scope-from-scopes-supported",
  "auth/scope-omitted-when-undefined",
  "auth/scope-step-up",
  "auth/scope-retry-limit",
  "auth/token-endpoint-auth-basic",
  "auth/token-endpoint-auth-post",
  "auth/token-endpoint-auth-none",
  "auth/pre-registration"
].sort()

const conformancePackageJson = existsSync(conformancePackagePath)
  ? JSON.parse(readFileSync(conformancePackagePath, "utf8"))
  : {}
const conformanceVersion = conformancePackageJson.devDependencies?.[conformancePackageName]
const command = `${process.execPath} ${clientPath}`

const runConformanceClientAuth = Effect.gen(function* () {
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

  const officialClientInventory = loadOfficialScenarioInventory({
    kind: "client",
    conformancePackage,
    specVersion
  })
  const missingFromOfficialInventory = expectedScenarios.filter(
    (scenario) => !officialClientInventory.includes(scenario)
  )
  if (missingFromOfficialInventory.length > 0) {
    yield* Effect.fail(
      new Error(
        `The pinned official harness is missing auth suite scenarios: ${missingFromOfficialInventory.join(", ")}`
      )
    )
  }

  console.log("Running MCP conformance client auth suite")
  console.log(`MCP conformance spec version: ${specVersion}`)
  console.log(`Official applicable client auth inventory: ${expectedScenarios.length} scenarios`)
  console.log(`Client command: ${command}`)
  console.log(`Writing MCP conformance artifacts to ${outputDir}`)

  const harnessExitCode = yield* runCommand(
    packageManagerPath(),
    [
      "--dir",
      conformancePackage,
      "exec",
      "conformance",
      "client",
      "--suite",
      "auth",
      "--spec-version",
      "2026-07-28",
      "--command",
      command,
      "--output-dir",
      outputDir
    ],
    root,
    { label: "conformance.client-auth" }
  )

  let result = harnessExitCode
  try {
    assertCompleteOfficialScenarioInventory({
      kind: "client auth",
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
    suite: "client-auth",
    specVersion,
    conformancePackage: {
      name: conformancePackageName,
      version: conformanceVersion
    },
    artifactDir: outputDir,
    preserveByRuntime: true
  })
  const evidence = JSON.parse(readFileSync(evidencePath, "utf8"))
  const exitCode = conformanceEvidencePassed(result, evidence) ? 0 : 1

  console.log(`Writing readiness evidence to ${evidencePath}`)
  printConformanceIssueSummary("MCP conformance client auth suite", outputDir)
  if (exitCode !== 0) {
    yield* Effect.fail(new Error("MCP conformance client auth evidence reported failure"))
  }
})

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  NodeRuntime.runMain(runScript("run-conformance-client-auth", runConformanceClientAuth))
}
