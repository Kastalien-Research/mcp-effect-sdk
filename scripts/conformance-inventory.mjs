import { spawnSync } from "node:child_process"
import { existsSync, readdirSync } from "node:fs"
import path from "node:path"

const scenarioTimestamp = /-\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}-\d{3}Z$/

export function loadOfficialScenarioInventory({
  kind,
  conformancePackage,
  specVersion,
  run = spawnSync
}) {
  if (kind !== "client" && kind !== "server") {
    throw new Error(`Unsupported conformance inventory kind: ${String(kind)}`)
  }

  const result = run(packageManagerPath(), [
    "--dir",
    conformancePackage,
    "exec",
    "conformance",
    "list",
    `--${kind}`,
    "--spec-version",
    specVersion
  ], {
    encoding: "utf8"
  })

  if (result.error) throw result.error
  if (result.status !== 0) {
    throw new Error(
      `Unable to load official ${kind} conformance inventory: ${result.stderr || result.stdout}`
    )
  }

  const scenarios = Array.from(
    String(result.stdout).matchAll(/^\s+-\s+([^\s\[]+)(?:\s+\[[^\]]*\])?\s*$/gm),
    (match) => match[1]
  ).sort()
  if (scenarios.length === 0) {
    throw new Error(`Official ${kind} conformance inventory is empty`)
  }
  if (new Set(scenarios).size !== scenarios.length) {
    throw new Error(`Official ${kind} conformance inventory contains duplicates`)
  }
  return scenarios
}

export function collectConformanceArtifactScenarios(outputDir) {
  if (!existsSync(outputDir)) return []
  const scenarios = []

  const visit = (directory) => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const entryPath = path.join(directory, entry.name)
      if (entry.isDirectory()) {
        visit(entryPath)
      } else if (entry.name === "checks.json") {
        scenarios.push(scenarioFromChecksPath(outputDir, entryPath))
      }
    }
  }
  visit(outputDir)
  return scenarios.sort()
}

export function assertCompleteOfficialScenarioInventory({ kind, expected, actual }) {
  const expectedSet = new Set(expected)
  const actualSet = new Set(actual)
  const duplicates = actual.filter((scenario, index) => actual.indexOf(scenario) !== index)
  const missing = expected.filter((scenario) => !actualSet.has(scenario))
  const unexpected = actual.filter((scenario) => !expectedSet.has(scenario))

  if (duplicates.length === 0 && missing.length === 0 && unexpected.length === 0) return

  const details = []
  if (missing.length > 0) details.push(`missing: ${missing.join(", ")}`)
  if (unexpected.length > 0) details.push(`unexpected: ${unexpected.join(", ")}`)
  if (duplicates.length > 0) details.push(`duplicates: ${[...new Set(duplicates)].join(", ")}`)
  throw new Error(`Incomplete official ${kind} conformance artifacts (${details.join("; ")})`)
}

function scenarioFromChecksPath(outputDir, checksPath) {
  const relativeDirectory = path.relative(outputDir, path.dirname(checksPath))
  const segments = relativeDirectory.split(path.sep)
  const artifactDirectory = segments.pop()
  const scenario = artifactDirectory
    .replace(scenarioTimestamp, "")
    .replace(/^(client|server)-/, "")
  return [...segments, scenario].join("/")
}

function packageManagerPath() {
  return process.platform === "win32" ? "pnpm.cmd" : "pnpm"
}
